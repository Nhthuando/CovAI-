import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import {parse as parseEnvironment} from 'dotenv';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { resolveSnapshotAccess, withProjectGuard } from './projectAccess.service.js';
import { projectEditableWorkspaceRoot } from './projectFileVersion.service.js';
import { captureWorkspaceFiles } from './projectWorkspacePublish.service.js';
import { withPreparedProjectWorkspace } from './projectWorkspacePreparation.service.js';
import { containedPath, readFullSystemConfig } from './fullSystemConfig.service.js';
import { inspectSystemSetupSource } from './fullSystemSetup.service.js';
import { inferFullSystemPlan, systemPackageFiles } from './fullSystemPlan.service.js';
import { requiredStartupEnvironment, startupEnvironmentFiles, referencedEnvironment, managedEnvironmentNames, buildAutomaticTestEnvironment } from './fullSystemEnvironment.service.js';
import { readAssessmentTestEnvironment } from './fullSystemRuntime.service.js';
import { suiteDigest } from './systemSuiteManifest.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { setupEnvironmentRequest } from '../validators/systemAssessment.validator.js';

const exec = promisify(execFile);
const relative = z.string().min(1).max(512).refine(value => !value.includes('\\') && !value.split('/').includes('..') && !/^(?:\/|[a-z]:|https?:)/i.test(value), 'Use a project-relative path');
const health = z.string().max(512).regex(/^\/[A-Za-z0-9/_.:-]*$/, 'Use a local readiness path without secrets or query parameters');
export const systemSetupConfig = z.object({
    frontend: z.object({directory:relative}).strict(),
    backend: z.object({directory:relative,healthPath:health,readiness:z.literal('http').optional()}).strict(),
    database: z.object({engine:z.enum(['mysql','postgres','sqlite','mongodb']),initSql:relative.refine(value=>value.endsWith('.sql')).optional(),prismaSchema:relative.refine(value=>value.endsWith('.prisma')).optional(),schemaStrategy:z.enum(['push','migrate']).optional()}).strict().nullable(),
    services:z.object({redis:z.boolean().optional()}).strict().optional(),
    unified:z.boolean().optional(),frontendOnly:z.boolean().optional(),backendOnly:z.boolean().optional(),
}).strict();
export const setupApplyRequest = z.object({config:systemSetupConfig,expectedWorkspaceRevision:z.number().int().nonnegative(),expectedSourceHash:z.string().regex(/^[a-f0-9]{64}$/),expectedSetupHash:z.string().regex(/^[a-f0-9]{64}$/),reviewed:z.literal(true)}).strict();

const setupFile = '.covai/system-test.json';
const setupHash = root => suiteDigest(fs.existsSync(containedPath(root,setupFile)) ? fs.readFileSync(containedPath(root,setupFile)) : 'NO_SYSTEM_SETUP');
const sourceHash = async root => suiteDigest([...await captureWorkspaceFiles(root)].map(([name,file])=>({path:name,sha256:file.sha256})).sort((a,b)=>a.path.localeCompare(b.path)));
const serviceLabel = name => /STRIPE/i.test(name) ? 'Stripe' : /OPENAI/i.test(name) ? 'OpenAI' : /ANTHROPIC/i.test(name) ? 'Anthropic' : /GEMINI|GOOGLE.*API/i.test(name) ? 'Gemini' : /RESEND/i.test(name) ? 'Resend' : /TWILIO/i.test(name) ? 'Twilio' : /SENDGRID/i.test(name) ? 'SendGrid' : 'Application';

export const inspectProjectTestEnvironment = ({rootDir,source,config}) => {
    const rows = new Map();
    for (const pkg of source.packages) {
        const prefix=pkg.directory==='.'?'':pkg.directory+'/';
        // A parent package must not claim a nested package's credential file.
        const files=systemPackageFiles(source,pkg).map(file=>({...file,path:file.path.slice(prefix.length)}));
        const selected=config && [config.frontend.directory,config.backend.directory].includes(pkg.directory);
        const preferStart=!!config && !config.unified && config.backend.directory===pkg.directory;
        const mandatory=selected ? requiredStartupEnvironment(startupEnvironmentFiles(files,pkg.scripts,{preferStart})) : [];
        const sdk=requiredStartupEnvironment(files,{startupOnly:false});
        const references=[...referencedEnvironment(files),...sdk];
        const managed=new Set([...managedEnvironmentNames(files,config?.backend.directory===pkg.directory?config:null),...Object.keys(buildAutomaticTestEnvironment({files,port:1,backendUrl:'http://127.0.0.1',frontendUrl:'http://127.0.0.1'}))]);
        const env=readAssessmentTestEnvironment(containedPath(rootDir,pkg.directory));
        for (const item of references) {
            const required=mandatory.some(row=>row.name===item.name);
            const identity=`${pkg.directory}:${item.name}`;
            const present=typeof env[item.name]==='string' && !!env[item.name].trim();
            const integration=sdk.find(row=>row.name===item.name)?.integration || serviceLabel(item.name);
            const existing=rows.get(identity);
            rows.set(identity,{name:item.name,service:integration,required,status:managed.has(item.name)?'MANAGED':present?'PRESENT':required?'MISSING':'MAY_BE_NEEDED',envFile:prefix+'.env.test',sourceFiles:[...new Set([...(existing?.sourceFiles||[]),prefix+item.sourceFile])],purpose:required?`${integration} is initialized during application startup.`:`${integration} configuration is referenced by the application; a tested workflow may need it.`,guidance:managed.has(item.name)?'Created or overridden for the isolated test runtime.':present?'Present in the test environment; the provider has not been contacted.':'Add a test or sandbox value to this file, then check again.'});
        }
    }
    return [...rows.values()].sort((a,b)=>(a.status==='MISSING'?-1:0)-(b.status==='MISSING'?-1:0)||a.envFile.localeCompare(b.envFile)||a.name.localeCompare(b.name));
};

const checkDocker = async required => {
    if (!required) return {status:'NOT_REQUIRED',required:false,message:'No container service is required by this setup.'};
    try {await exec('docker',['version','--format','{{.Server.Version}}'],{timeout:4000,windowsHide:true,maxBuffer:4096});return {status:'AVAILABLE',required:true,message:'Docker engine is responding.'};}
    catch {return {status:'UNAVAILABLE',required:true,message:'Start Docker Desktop on the CovAI server, wait for the engine, then check again.'};}
};

export const inspectSystemSetup = async ({rootDir,workspaceRevision=0,dependencies={}}) => {
    const source=inspectSystemSetupSource(rootDir);
    const issues=[];
    let configured=null;
    if (fs.existsSync(containedPath(rootDir,setupFile))) {
        try {configured=systemSetupConfig.parse(readFullSystemConfig(rootDir));}
        catch {issues.push({code:'INVALID_SETUP',message:'The saved startup setup is invalid. Review the detected setup or edit the configuration below.'});}
    }
    const inferred=source.packages.length ? inferFullSystemPlan(source,{allowSchemaDraft:true}) : null;
    const candidate=configured || (inferred && systemSetupConfig.safeParse(inferred).success ? inferred : null);
    if (!configured && !candidate && source.packages.length) issues.push({code:'SETUP_REQUIRED',message:'CovAI could not determine one unambiguous startup setup. Review the detected packages and supply the configuration, or generate a setup draft.'});
    if (!source.packages.length) issues.push({code:'UNSUPPORTED_STACK',message:'No supported Node.js application package was found. This runner needs a compatible package.json and startup scripts; other languages require an additional runtime adapter.'});
    if (candidate) {
        for (const [kind,directory] of [['Frontend',candidate.frontend.directory],['Backend',candidate.backend.directory]]) {
            const pkg=source.packages.find(row=>row.directory===directory);
            if(!pkg || !['dev','start','serve','preview'].some(name=>typeof pkg.scripts[name]==='string'))issues.push({code:'START_SCRIPT_REQUIRED',message:`${kind}: add a supported start script in ${directory==='.'?'':directory+'/'}package.json.`});
        }
        for(const name of [candidate.database?.initSql,candidate.database?.prismaSchema].filter(Boolean)) {
            if (name === '.covai/generated-schema.sql') continue;
            if(!fs.existsSync(containedPath(rootDir,name)))issues.push({code:'SCHEMA_REQUIRED',message:`Include the database schema file ${name} in the imported project.`});
        }
    }
    const environment=inspectProjectTestEnvironment({rootDir,source,config:candidate});
    const missing=environment.filter(row=>row.status==='MISSING');
    const dockerRequired=!!candidate && (['mysql','postgres','mongodb'].includes(candidate.database?.engine)||!!candidate.services?.redis);
    const docker=candidate ? await (dependencies.checkDocker||checkDocker)(dockerRequired) : {status:'NOT_CHECKED',required:null,message:'Choose startup setup before checking local services.'};
    if(missing.length)issues.push({code:'ENVIRONMENT_REQUIRED',message:`${missing.length} startup environment variable(s) need test values.`});
    if(docker.status==='UNAVAILABLE')issues.push({code:'DOCKER_REQUIRED',message:docker.message});
    return {schemaVersion:1,ready:issues.length===0,status:!source.packages.length?'UNSUPPORTED':issues.length?'NEEDS_SETUP':'READY',workspaceRevision,sourceHash:await sourceHash(rootDir),setupHash:setupHash(rootDir),configured:!!configured,sourceInspection:source.inspection,candidateConfig:candidate,packages:source.packages.map(pkg=>({directory:pkg.directory,startScripts:['dev','start','serve','preview'].filter(name=>typeof pkg.scripts[name]==='string')})),services:candidate?{frontend:candidate.frontend.directory,backend:candidate.backend.directory,healthPath:candidate.backend?.healthPath||'/',topology:candidate.frontendOnly?'UI application; no backend identified':candidate.backendOnly?'API application':candidate.unified?'Unified application':'Frontend and backend',database:candidate.database?.engine||'Not required',schema:candidate.database?.prismaSchema||candidate.database?.initSql||null,redis:!!candidate.services?.redis}:null,environment,docker,issues,limitations:['Checks inspect bounded source and test environment presence; they do not start the application or validate provider credentials.','Only .env.test is used for credentials in managed test runs. Production .env values are not reused.','Custom launchers, dynamic environment helpers and uninspected files can require additional configuration at runtime.']};
};

export const systemSetupPreflight = async ({snapshotId,userId,db=prisma,dependencies={}}) => {
    const {snapshot,project}=await resolveSnapshotAccess({snapshotId,userId,capability:'project.read',db});
    return inspectSystemSetup({rootDir:projectEditableWorkspaceRoot(snapshot),workspaceRevision:project.workspaceRevision,dependencies});
};

// Credentials are written only to the owned project's .env.test files. They
// never enter project versions, operation payloads, job logs or AI context.
export const saveSystemTestEnvironment = async ({snapshotId,userId,input,db=prisma,dependencies={}}) => {
    input=setupEnvironmentRequest.parse(input);
    const {snapshot}=await resolveSnapshotAccess({snapshotId,userId,capability:'evidence.approve',db});
    return withProjectGuard({projectId:snapshot.projectId,userId,capability:'evidence.approve',db},async(tx,access)=>{
        if(access.project.workspaceRevision!==input.expectedWorkspaceRevision)throw new ServiceError('Project changed. Check setup again before saving test values.',409);
        if(await tx.job.findFirst({where:{projectId:snapshot.projectId,status:{in:['QUEUED','RUNNING']}}}))throw new ServiceError('Wait for active project jobs before changing test values.',409);
        const rootDir=projectEditableWorkspaceRoot(snapshot);
        const report=await inspectSystemSetup({rootDir,dependencies:{...dependencies,checkDocker:async()=>({status:'NOT_CHECKED'})}});
        const allowed=new Set(report.environment.filter(row=>row.required && row.status!=='MANAGED').map(row=>`${row.envFile}:${row.name}`));
        const groups=new Map();
        for(const variable of input.variables) {
            if(!allowed.has(`${variable.envFile}:${variable.name}`))throw new ServiceError('Only detected required external test variables can be saved. Check setup again.',422);
            if(!groups.has(variable.envFile))groups.set(variable.envFile,readAssessmentTestEnvironment(path.dirname(containedPath(rootDir,variable.envFile))));
            groups.get(variable.envFile)[variable.name]=variable.value;
        }
        const writes=[...groups].map(([name,values])=>{
            const content=Object.entries(values).map(([key,value])=>{
                const quote=['"',"'",'`'].find(quote=>!value.includes(quote));
                if(!quote)throw new ServiceError('A test value contains an unsupported combination of quote characters.',422);
                return `${key}=${quote}${value}${quote}`;
            }).join('\n')+'\n';
            if(Buffer.byteLength(content)>64*1024)throw new ServiceError('Test environment values cannot be encoded in a file up to 64 KiB.',422);
            const decoded=parseEnvironment(content);
            if(Object.entries(values).some(([key,value])=>decoded[key]!==value))throw new ServiceError('Test environment values cannot be encoded without changing their contents.',422);
            return {file:containedPath(rootDir,name),content};
        });
        for(const {file,content} of writes) {
            const temporary=file+'.'+crypto.randomUUID()+'.tmp';
            try {fs.writeFileSync(temporary,content,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
            finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
        }
        return {saved:input.variables.length};
    });
};

export const applySystemSetup = async ({snapshotId,userId,input,db=prisma,dependencies={}}) => {
    const {snapshot,project}=await resolveSnapshotAccess({snapshotId,userId,capability:'evidence.approve',db});
    const config=systemSetupConfig.parse(input.config);
    const root=projectEditableWorkspaceRoot(snapshot);
    if(await sourceHash(root)!==input.expectedSourceHash || setupHash(root)!==input.expectedSetupHash || project.workspaceRevision!==input.expectedWorkspaceRevision)throw new ServiceError('Project files changed. Check setup again before applying.',409);
    if(!input.reviewed)throw new ServiceError('Review the startup setup before applying.',400);
    if(await db.job.findFirst({where:{snapshotId,status:{in:['QUEUED','RUNNING']}}}))throw new ServiceError('Wait for the active job before changing startup setup.',409);
    return (dependencies.withPreparedWorkspace||withPreparedProjectWorkspace)({projectId:snapshot.projectId,snapshotId,userId,capability:'evidence.approve',expectedWorkspaceRevision:input.expectedWorkspaceRevision,type:'SYSTEM_TEST_SETUP',input:{config,reviewed:true}},async context=>{
        if(await sourceHash(context.rootDir)!==input.expectedSourceHash || setupHash(context.rootDir)!==input.expectedSetupHash)throw new ServiceError('Project files changed while preparing setup. Check again.',409);
        const file=containedPath(context.rootDir,setupFile);
        fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n','utf8');
        readFullSystemConfig(context.rootDir);
        const checked=await inspectSystemSetup({rootDir:context.rootDir,dependencies:{...dependencies,checkDocker:async()=>({status:'NOT_CHECKED'})}});
        if(checked.issues.some(row=>['START_SCRIPT_REQUIRED','SCHEMA_REQUIRED','INVALID_SETUP'].includes(row.code)))throw new ServiceError(checked.issues.map(row=>row.message).join(' '),422);
        return {configured:true,message:'Startup setup saved. Check the environment before running tests.'};
    });
};
