import fs from 'node:fs';
import crypto from 'node:crypto';
import { currentDependencyCache, canCacheProjectDependencies, copyDependencyTree, isDependencyWorkspace } from './projectDependencyCache.service.js';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dockerRunner } from './dockerRunner.service.js';
import { addJobLog } from './job.service.js';
import { resolvePackageRuntime, runtimeDependencyFingerprint } from './projectRuntimePlan.service.js';
import { ServiceError } from '../utils/serviceError.js';

const exec=promisify(execFile),pending=new Map();
const tooling=['vite','next','react-scripts','@vue/cli-service','astro','nuxt','@angular/cli','webpack-dev-server','parcel','tsx','ts-node','nodemon','express','fastify','koa'];
export const redactRuntimeOutput = (output,env={}) => {
    let text=String(output || '').replace(/\x1b\[[0-9;]*m/g,'');
    for(const [key,value] of Object.entries({...process.env,...env}))if(value&&/PASSWORD|SECRET|TOKEN|KEY|URL/i.test(key))text=text.replaceAll(value,'[redacted]');
    return text.replace(/(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s'"`]+/gi,'[redacted connection URL]').slice(-2000);
};
export const verifyRuntimeTooling = async plan => {
    const declared={...plan.pkg.dependencies,...plan.pkg.devDependencies};
    const required=tooling.filter(name=>declared[name]);
    if(!required.length)return;
    // Resolve from the app's own ESM context, without executing imported code or
    // borrowing CovAI's tools through PATH/NODE_PATH. Hoisted workspace deps work.
    const code=`import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const missing=[];for(const name of ${JSON.stringify(required)}){try{const file=fileURLToPath(import.meta.resolve(name));const relative=path.relative(${JSON.stringify(plan.repositoryRoot)},fs.realpathSync(file));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error();}catch{missing.push(name);}}if(missing.length){console.error(missing.join(', '));process.exitCode=1;}`;
    try {await exec(process.execPath,['--input-type=module','--eval',code],{cwd:plan.directory,windowsHide:true,timeout:15000,env:{...process.env,NODE_PATH:'',NODE_OPTIONS:''}});}
    catch(error){const failure=new ServiceError(`Application dependencies are incomplete: ${String(error.stderr || required.join(', ')).trim().slice(0,300)}. Local runtime packages could not be resolved after installation.`,422);failure.code='AUT_DEPENDENCY_MISSING';throw failure;}
};
const log=async(jobId,level,message)=>{if(jobId)await addJobLog(jobId,level,`[Project runtime] ${message}`);};
export const prepareProjectDependencies = async ({directory,repositoryRoot=directory,jobId,signal,env={},dependencies={}}) => {
    const plan=resolvePackageRuntime({directory,repositoryRoot});
    const previous=pending.get(plan.installRoot);
    const task=(async()=>{
        if(previous)await previous;
        if(signal?.aborted)throw new ServiceError('Dependency preparation canceled',409);
        const stamp=path.join(plan.installRoot,'.covai-system-test','runtime-dependencies.json');
        const fingerprint=runtimeDependencyFingerprint(plan.installRoot);
        const manifestFingerprint=runtimeDependencyFingerprint(plan.installRoot,{includeLocks:false});
        const verify=dependencies.verify || verifyRuntimeTooling;
        try {
            const stored=JSON.parse(fs.readFileSync(stamp,'utf8'));
            if(stored.fingerprint===fingerprint) {await verify(plan);return plan;}
        } catch { /* A missing/invalid receipt or incomplete install is reconciled. */ }
        const cache = currentDependencyCache();
        const eligible = cache && canCacheProjectDependencies(plan);
        const cacheKey = crypto.createHash('sha256').update(`${path.relative(repositoryRoot,plan.installRoot)}:${fingerprint}`).digest('hex');
        const cached = eligible && cache.entries.get(cacheKey);
        const modules = path.join(plan.installRoot, 'node_modules');
        // Managed runner preparation can create partial node_modules before AUT
        // setup. Replace it only inside a registered disposable execution copy;
        // never overlay packages or delete dependencies in an imported project.
        if (cached && (!fs.existsSync(modules) || isDependencyWorkspace(modules))) {
            try {
                if(fs.existsSync(modules))fs.rmSync(modules,{recursive:true,force:true,maxRetries:5,retryDelay:100});
                await copyDependencyTree(cached.directory, modules);
                // Freeze the exact resolution from this job's first successful
                // install, including projects imported without a lockfile.
                for(const [name,content] of cached.locks) fs.writeFileSync(path.join(plan.installRoot,name),content);
                await verify(plan);
                fs.mkdirSync(path.dirname(stamp), {recursive:true});
                fs.writeFileSync(stamp, JSON.stringify({fingerprint:runtimeDependencyFingerprint(plan.installRoot)}));
                await log(jobId,'INFO','Reused prepared dependencies in a fresh execution copy (job-local cache).');
                return plan;
            } catch {
                // This directory was absent before our copy, so only our partial
                // output is removed. The ordinary install remains authoritative.
                fs.rmSync(modules,{recursive:true,force:true,maxRetries:5,retryDelay:100});
                cache.entries.delete(cacheKey);
                await log(jobId,'WARN','Prepared dependency reuse was unavailable; installing normally.');
            }
        }
        await log(jobId,'INFO',`Preparing ${plan.manager}${plan.version?'@'+plan.version:''} dependencies (${path.relative(repositoryRoot,plan.installRoot).replaceAll('\\','/') || '.'}); dev and optional runtime packages included.`);
        const run=dependencies.run || dockerRunner.run;
        const options={snapshotPath:plan.installRoot,jobId,forceHost:true,timeoutMs:600000,signal,
            env:{...env,...plan.env,PATH:process.env.PATH || '',NODE_OPTIONS:'',...(plan.manager==='npm'?{npm_config_yes:'true'}:{})}};
        let result=await run({...options,command:plan.install});
        if(!result.success && plan.repairInstall && /EUSAGE|package\.json.*(?:in sync|lock)|Missing:.*from lock file|Invalid:.*lock file/i.test((result.stderr || '')+(result.stdout || ''))) {
            await log(jobId,'WARN','Lockfile does not match the manifest. Resolving it once in the execution copy; original project files remain unchanged.');
            result=await run({...options,command:plan.repairInstall});
        }
        if(signal?.aborted)throw new ServiceError('Dependency preparation canceled',409);
        if(!result.success) {
            const detail=redactRuntimeOutput(result.stderr || result.stdout || 'No installation output',env);
            const failure=new ServiceError(`Application dependency installation failed (${plan.manager}, exit ${result.exitCode ?? 'unknown'}). ${detail}`,422);
            failure.code='AUT_DEPENDENCY_INSTALL_FAILED';throw failure;
        }
        await verify(plan);
        if (eligible && fs.existsSync(modules) && runtimeDependencyFingerprint(plan.installRoot,{includeLocks:false}) === manifestFingerprint && !cache.entries.has(cacheKey)) {
            const target = path.join(cache.root, cacheKey);
            try {
                await copyDependencyTree(modules, target);
                const locks=['package-lock.json','npm-shrinkwrap.json'].filter(name=>fs.existsSync(path.join(plan.installRoot,name))).map(name=>[name,fs.readFileSync(path.join(plan.installRoot,name))]);
                cache.entries.set(cacheKey, {directory:target,locks});
            } catch { await log(jobId,'WARN','Dependency template preparation was unavailable; future runs will install normally.'); }
        }
        fs.mkdirSync(path.dirname(stamp),{recursive:true});
        fs.writeFileSync(stamp,JSON.stringify({fingerprint:runtimeDependencyFingerprint(plan.installRoot),manager:plan.manager,version:plan.version || null,node:process.versions.node}));
        return plan;
    })();
    pending.set(plan.installRoot,task);
    try{return await task;}finally{if(pending.get(plan.installRoot)===task)pending.delete(plan.installRoot);}
};
