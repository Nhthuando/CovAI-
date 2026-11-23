import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { requiredStartupEnvironment, startupEnvironmentFiles, referencedEnvironment, managedEnvironmentNames, buildAutomaticTestEnvironment, environmentFeatureMap, hardcodedServiceCredentials } from './fullSystemEnvironment.service.js';
import { EXTERNAL_SERVICES, serviceForEnvName, serviceForPackage, isLiveCredential } from './externalServiceCatalog.service.js';
import { readAssessmentTestEnvironment, readAssessmentTestEnvironmentFile } from './fullSystemRuntime.service.js';
import { clearSystemTestSecrets, listSystemTestSecretNames, storeSystemTestSecrets, validateSystemTestSecret } from './systemTestSecrets.service.js';
import { assertColocatedWorkerForSecret } from './aiEvaluation/ephemeralSecret.service.js';
import { suiteDigest } from './systemSuiteManifest.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { humanizeVendorToken, vendorTokenForEnvName } from '../utils/vendorToken.js';
import { parseRequest, setupEnvironmentRequest, setupEnvironmentImportRequest, setupEnvironmentDeleteRequest } from '../validators/systemAssessment.validator.js';

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
const providerDetails = ({id,label,category,testKeyUrl,testKeyHint}) => ({id,label,category,testKeyUrl,testKeyHint});
const providerByLabel = new Map(EXTERNAL_SERVICES.map(service=>[service.label,service]));

export const inspectProjectTestEnvironment = ({rootDir,source,config,legacyFiles=new Set()}) => {
    const rows = new Map();
    const featureMap = environmentFeatureMap(source.files);
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
        const directory=containedPath(rootDir,pkg.directory);
        const envFile=prefix+'.env.test';
        const env=readAssessmentTestEnvironmentFile(directory);
        const memory=new Set(listSystemTestSecretNames(directory).names);
        for (const item of references) {
            const required=mandatory.some(row=>row.name===item.name);
            const identity=`${pkg.directory}:${item.name}`;
            const inMemory=memory.has(item.name);
            const present=inMemory || typeof env[item.name]==='string' && !!env[item.name].trim();
            const isManaged=managed.has(item.name);
            if(!isManaged && Object.hasOwn(env,item.name) && fs.existsSync(containedPath(rootDir,envFile)))legacyFiles.add(envFile);
            const sdkLabel=sdk.find(row=>row.name===item.name && providerByLabel.has(row.integration))?.integration;
            const provider=serviceForEnvName(item.name) || providerByLabel.get(sdkLabel);
            const integration=provider?.label || sdk.find(row=>row.name===item.name)?.integration || 'Application';
            const existing=rows.get(identity);
            rows.set(identity,{name:item.name,service:integration,provider:provider ? providerDetails(provider) : null,features:featureMap.get(item.name) ?? [],required,status:isManaged?'MANAGED':present?'PRESENT':required?'MISSING':'MAY_BE_NEEDED',...(!isManaged && present ? {storage:inMemory?'MEMORY':'FILE'} : {}),envFile,sourceFiles:[...new Set([...(existing?.sourceFiles||[]),prefix+item.sourceFile])],purpose:required?`${integration} is initialized during application startup.`:`${integration} configuration is referenced by the application; a tested workflow may need it.`,guidance:isManaged?'Created or overridden for the isolated test runtime.':present?'Present in the test environment; the provider has not been contacted.':'Enter a test or sandbox value, then check again.'});
        }
    }
    return [...rows.values()].sort((a,b)=>(a.status==='MISSING'?-1:0)-(b.status==='MISSING'?-1:0)||a.envFile.localeCompare(b.envFile)||a.name.localeCompare(b.name));
};

const inspectExternalServices = (source, environment, rootDir, config) => {
    const services = new Map();
    const group = provider => {
        if (!services.has(provider.id)) {
            const details = provider.inferred ? provider : {...providerDetails(provider),inferred:false};
            services.set(provider.id,{...details,variables:[],features:new Map(),sourceFiles:new Set(),hardcoded:[],needsConfig:false});
        }
        return services.get(provider.id);
    };
    for (const pkg of source.packages) {
        for (const name of Object.keys(pkg.dependencies ?? {})) {
            const provider = serviceForPackage(name);
            if (provider) group(provider).sourceFiles.add(pkg.directory === '.' ? 'package.json' : pkg.directory + '/package.json');
        }
    }
    const addRow = (service, row) => {
        const {name,status,required,envFile} = row;
        service.variables.push({name,status,required,envFile});
        service.needsConfig ||= status === 'MISSING' || status === 'MAY_BE_NEEDED' && row.features.length > 0;
        for (const feature of row.features) service.features.set(JSON.stringify(feature),feature);
        for (const sourceFile of row.sourceFiles) service.sourceFiles.add(sourceFile);
    };
    for (const row of environment) {
        if (!row.provider) continue;
        addRow(group(row.provider), row);
    }
    for (const row of environment) {
        if (row.provider !== null || row.status === 'MANAGED' || (!row.required && !row.features.length)) continue;
        const token = vendorTokenForEnvName(row.name);
        if (!token) continue;
        const defaultLabel = humanizeVendorToken(token);
        const label = token !== 'APP' && row.service && row.service !== 'Application' ? row.service : defaultLabel;
        const service = group({
            id: `env:${token}`,
            label,
            category: 'other',
            testKeyUrl: null,
            testKeyHint: 'Use a sandbox or test value from this provider, never a production key.',
            inferred: true,
        });
        if (service.label === defaultLabel) service.label = label;
        addRow(service, row);
    }
    const providers = new Map(EXTERNAL_SERVICES.map(provider=>[provider.id,provider]));
    for (const {serviceId,sourceFile,line,envName,features} of hardcodedServiceCredentials(source.files)) {
        const service = group(providers.get(serviceId));
        service.hardcoded.push({sourceFile,line,envName});
        service.sourceFiles.add(sourceFile);
        for (const feature of features) service.features.set(JSON.stringify(feature),feature);
    }
    const rank = {NEEDS_CONFIG:0,HARDCODED:1,READY:2,OPTIONAL:3};
    return [...services.values()].map(({needsConfig,features,sourceFiles,...service})=>{
        const required = service.variables.filter(variable=>variable.required);
        const status = needsConfig ? 'NEEDS_CONFIG'
            : service.hardcoded.length && !service.variables.length ? 'HARDCODED'
            : required.length && required.every(variable=>['PRESENT','MANAGED'].includes(variable.status)) ? 'READY' : 'OPTIONAL';
        const finding = service.hardcoded[0];
        if (status === 'HARDCODED') {
            const directory = config?.backend.directory ?? source.packages.find(pkg=>
                systemPackageFiles(source,pkg).some(file=>file.path===finding.sourceFile))?.directory;
            if (directory) {
                const envFile = directory === '.' ? '.env.test' : directory + '/.env.test';
                const env = readAssessmentTestEnvironmentFile(containedPath(rootDir,directory));
                const memory = new Set(listSystemTestSecretNames(containedPath(rootDir,directory)).names);
                for (const name of new Set(service.hardcoded.map(item=>item.envName))) {
                    const storage = memory.has(name) ? 'MEMORY' : env[name]?.trim() ? 'FILE' : undefined;
                    service.variables.push({name,envFile,required:false,status:storage?'PRESENT':'MISSING',...(storage && {storage})});
                }
            }
        }
        const guidance = status === 'HARDCODED'
            ? `Move the key in ${finding.sourceFile}:${finding.line} to process.env.${finding.envName}, then add a test key here.`
            : service.testKeyHint;
        return {...service,status,features:[...features.values()],sourceFiles:[...sourceFiles].sort(),guidance};
    }).sort((a,b)=>rank[a.status]-rank[b.status] || a.label.localeCompare(b.label));
};

const checkDocker = async required => {
    if (!required || process.env.COVAI_USE_DOCKER_DB !== 'true') {
        return {
            status: 'NOT_REQUIRED',
            required: false,
            mode: 'MOCK_DB',
            message: 'Schema-aware Mock DB is active; no container service is required by this setup.',
        };
    }
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
            if(!pkg || (!['dev','start','serve','preview'].some(name=>typeof pkg.scripts[name]==='string') && !(pkg.entryFile && (kind==='Backend' || candidate.frontend.directory===candidate.backend.directory))))issues.push({code:'START_SCRIPT_REQUIRED',message:`${kind}: add a supported start script in ${directory==='.'?'':directory+'/'}package.json${kind==='Backend' ? ' or a server entry file (server.js, app.js, index.js)' : ''}.`});
        }
        for(const name of [candidate.database?.initSql,candidate.database?.prismaSchema].filter(Boolean)) {
            if (name === '.covai/generated-schema.sql') continue;
            if(!fs.existsSync(containedPath(rootDir,name)))issues.push({code:'SCHEMA_REQUIRED',message:`Include the database schema file ${name} in the imported project.`});
        }
    }
    const legacyFiles=new Set();
    const environment=inspectProjectTestEnvironment({rootDir,source,config:candidate,legacyFiles});
    const expiresAt=Math.max(0,...source.packages.map(pkg=>listSystemTestSecretNames(containedPath(rootDir,pkg.directory)).expiresAt ?? 0));
    const updatedAt=Math.max(0,...source.packages.map(pkg=>listSystemTestSecretNames(containedPath(rootDir,pkg.directory)).updatedAt ?? 0));
    const secrets={storage:'MEMORY',expiresAt:expiresAt?new Date(expiresAt).toISOString():null,updatedAt:updatedAt?new Date(updatedAt).toISOString():null,legacyFiles:[...legacyFiles].sort()};
    const externalServices=inspectExternalServices(source,environment,rootDir,candidate);
    const missing=environment.filter(row=>row.status==='MISSING');
    const dockerRequired=!!candidate && (['mysql','postgres','mongodb'].includes(candidate.database?.engine)||!!candidate.services?.redis);
    const docker=candidate ? await (dependencies.checkDocker||checkDocker)(dockerRequired) : {status:'NOT_CHECKED',required:null,message:'Choose startup setup before checking local services.'};
    if(missing.length)issues.push({code:'ENVIRONMENT_REQUIRED',message:`${missing.length} startup environment variable(s) need test values.`});
    if(docker.status==='UNAVAILABLE')issues.push({code:'DOCKER_REQUIRED',message:docker.message});
    return {schemaVersion:1,ready:issues.length===0,status:!source.packages.length?'UNSUPPORTED':issues.length?'NEEDS_SETUP':'READY',workspaceRevision,sourceHash:await sourceHash(rootDir),setupHash:setupHash(rootDir),configured:!!configured,sourceInspection:source.inspection,candidateConfig:candidate,packages:source.packages.map(pkg=>({directory:pkg.directory,startScripts:['dev','start','serve','preview'].filter(name=>typeof pkg.scripts[name]==='string')})),services:candidate?{frontend:candidate.frontend.directory,backend:candidate.backend.directory,healthPath:candidate.backend?.healthPath||'/',topology:candidate.frontendOnly?'UI application; no backend identified':candidate.backendOnly?'API application':candidate.unified?'Unified application':'Frontend and backend',database:candidate.database?.engine||'Not required',schema:candidate.database?.prismaSchema||candidate.database?.initSql||null,redis:!!candidate.services?.redis}:null,environment,secrets,externalServices,docker,issues,limitations:['Checks inspect bounded source and test environment presence; they do not start the application or validate provider credentials.','Test keys entered here are kept in server memory for this session only and are never written to disk.','Custom launchers, dynamic environment helpers and uninspected files can require additional configuration at runtime.']};
};

export const systemSetupPreflight = async ({snapshotId,userId,db=prisma,dependencies={}}) => {
    const {snapshot,project}=await resolveSnapshotAccess({snapshotId,userId,capability:'project.read',db});
    return inspectSystemSetup({rootDir:projectEditableWorkspaceRoot(snapshot),workspaceRevision:project.workspaceRevision,dependencies});
};

const withTestEnvironment = async ({snapshotId,userId,input,db=prisma,dependencies={}}, action) => {
    const {snapshot}=await resolveSnapshotAccess({snapshotId,userId,capability:'evidence.approve',db});
    return withProjectGuard({projectId:snapshot.projectId,userId,capability:'evidence.approve',db},async(tx,access)=>{
        if(access.project.workspaceRevision!==input.expectedWorkspaceRevision)throw new ServiceError('Project changed. Check setup again before saving test values.',409);
        if(!input.dryRun && await tx.job.findFirst({where:{projectId:snapshot.projectId,status:{in:['QUEUED','RUNNING']}}}))throw new ServiceError('Wait for active project jobs before changing test values.',409);
        const rootDir=projectEditableWorkspaceRoot(snapshot);
        const report=await inspectSystemSetup({rootDir,dependencies:{...dependencies,checkDocker:async()=>({status:'NOT_CHECKED'})}});
        const rows=report.environment.filter(row=>row.status!=='MANAGED');
        for (const service of report.externalServices) {
            if (service.status==='HARDCODED') rows.push(...service.variables.map(variable=>({...variable,service:service.label})));
        }
        return action(rootDir,rows,report);
    });
};

// Keep credentials in process memory for the owned project's test session.
const writeTestEnvironment = (rootDir, rows, variables) => {
    const liveNames=[...new Set(variables.filter(({name,value})=>isLiveCredential(name,value)).map(({name})=>name))];
    if(liveNames.length)throw new ServiceError('Live credentials are not allowed for testing. Use test or sandbox keys.',422,'LIVE_CREDENTIAL_REJECTED',{variables:liveNames});
    const allowed=new Set(rows.map(row=>`${row.envFile}:${row.name}`));
    const groups=new Map();
    for(const variable of variables) {
        if(!allowed.has(`${variable.envFile}:${variable.name}`))throw new ServiceError('Only detected test variables can be saved. Check setup again.',422);
        validateSystemTestSecret(variable.value);
        if(!groups.has(variable.envFile))groups.set(variable.envFile,Object.create(null));
        groups.get(variable.envFile)[variable.name]=variable.value;
    }
    const destinations=[...groups].map(([envFile,values])=>[path.dirname(containedPath(rootDir,envFile)),values]);
    if(destinations.length)assertColocatedWorkerForSecret();
    for(const [directory,values] of destinations)storeSystemTestSecrets(directory,values);
    return {saved:variables.length};
};

export const saveSystemTestEnvironment = async options => {
    const input=parseRequest(setupEnvironmentRequest,options.input);
    return withTestEnvironment({...options,input},(rootDir,rows)=>writeTestEnvironment(rootDir,rows,input.variables));
};

export const deleteSystemTestEnvironment = async options => {
    const input=parseRequest(setupEnvironmentDeleteRequest,options.input);
    return withTestEnvironment({...options,input},(rootDir,rows,report)=>{
        for(const pkg of report.packages)clearSystemTestSecrets(containedPath(rootDir,pkg.directory));
        const removedFiles=input.removeLegacyFiles?report.secrets.legacyFiles:[];
        for(const file of removedFiles)fs.unlinkSync(containedPath(rootDir,file));
        return {cleared:true,removedFiles};
    });
};

export const importSystemTestEnvironment = async options => {
    const input=parseRequest(setupEnvironmentImportRequest,options.input);
    return withTestEnvironment({...options,input},(rootDir,rows)=>{
        const recognized=[], ignored=[], rejected=[], variables=[];
        const byName=new Map();
        for(const row of rows) {
            if(!byName.has(row.name))byName.set(row.name,[]);
            byName.get(row.name).push(row);
        }
        for(const [name,value] of Object.entries(parseEnvironment(input.content))) {
            const destinations=byName.get(name);
            if(isLiveCredential(name,value))rejected.push({name,reason:'LIVE_KEY'});
            else if(!destinations)ignored.push(name);
            else if(!value.trim())rejected.push({name,reason:'EMPTY'});
            else for(const {envFile,service,status} of destinations) {
                recognized.push({name,envFile,service,action:status==='PRESENT'?'replace':'add'});
                variables.push({name,envFile,value});
            }
        }
        if(!input.dryRun)writeTestEnvironment(rootDir,rows,variables);
        return {recognized,ignored,rejected,saved:!input.dryRun};
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
