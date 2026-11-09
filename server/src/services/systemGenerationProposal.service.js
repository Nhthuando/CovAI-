import { assertSystemSuiteStorage, systemSuiteError } from './systemSuiteAvailability.service.js';
import { requireFullStackMode } from './systemExecutionPolicy.service.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '../config/prisma.js';
import { resolveSnapshotAccess } from './projectAccess.service.js';
import { projectEditableWorkspaceRoot } from './projectFileVersion.service.js';
import { withPreparedProjectWorkspace } from './projectWorkspacePreparation.service.js';
import { stagePreparedPublication } from './projectOperationWorkspace.service.js';
import { captureSystemSuiteManifest, suiteDigest } from './systemSuiteManifest.service.js';
import { commitSystemSuiteVersion } from './systemSuiteVersion.service.js';
import { generateColdStartSystemTests } from './verifiedSystemGeneration.service.js';
import { containedPath, resolveSystemRepositoryRoot } from './fullSystemConfig.service.js';
import { syncSystemScenarioCatalog, updateScenarioDraft } from './systemScenarioCatalog.service.js';
import { validateGeneratedTestCode } from '../validators/aiTestCode.validator.js';
import { validateFullSystemTest } from './systemTestEvidence.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { SYSTEM_PROMPT_VERSION } from './systemTestPrompt.service.js';
import { currentAiJobBudget, createAiJobBudget, withAiJobBudget } from './aiJobBudget.service.js';
import { generateText } from './gemini.service.js';
import { withGeminiChannel } from './geminiTokenTracker.service.js';
import { ensureFullSystemSetup } from './fullSystemSetup.service.js';

export const createSystemGenerationDraft = async ({snapshotId,userId,framework,targetRoutes,executionMode,model,signal=AbortSignal.timeout(10*60*1000),db=prisma,dependencies={}}) => {
    executionMode=requireFullStackMode(executionMode);
    if(!currentAiJobBudget())return withAiJobBudget(createAiJobBudget({maxRequests:6,signal}),()=>createSystemGenerationDraft({snapshotId,userId,framework,targetRoutes,executionMode,model,signal,db,dependencies}));
    if(signal?.aborted)throw new ServiceError('Generation canceled',409);
    const {snapshot,project} = await resolveSnapshotAccess({snapshotId,userId,capability:'ai.use',db});
    try { assertSystemSuiteStorage(db);await db.systemSuiteState.findUnique({where:{snapshotId}}); }
    catch(error) {throw systemSuiteError(error);}
    const baseline = await captureSystemSuiteManifest({rootDir:projectEditableWorkspaceRoot(snapshot)});
    const revision = await db.systemRequirementRevision.findFirst({where:{snapshotId,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
    let draft;
    await withPreparedProjectWorkspace({projectId:snapshot.projectId,snapshotId,userId,capability:'ai.use',expectedWorkspaceRevision:project.workspaceRevision,type:'AI_SYSTEM_DRAFT',publish:false,input:{framework,targetRoutes,executionMode,model:model||null}},async context=>{
        const rootDir = resolveSystemRepositoryRoot(path.join(context.rootDir,context.analysisRelative));
        const configNames = framework==='cypress'?['cypress.config.js','cypress.config.ts','cypress.config.mjs','cypress.config.cjs']:['playwright.config.js','playwright.config.ts','playwright.config.mjs','playwright.config.cjs'];
        const existing = new Set();
        for(const name of configNames)try{await fs.access(path.join(rootDir,name));existing.add(name);}catch(error){if(error.code!=='ENOENT')throw error;}
        let systemConfigExisted=true;
        try{await fs.access(path.join(rootDir,'.covai/system-test.json'));}catch(error){if(error.code!=='ENOENT')throw error;systemConfigExisted=false;}
        const aiGenerate = dependencies.generate
            ? (model ? (prompt, instruction, config) => dependencies.generate(prompt, model, instruction, config) : dependencies.generate)
            : (model ? (prompt, instruction, config) => withGeminiChannel("E2E_TEST", () => generateText(prompt, model, instruction, config)) : ((...args) => withGeminiChannel("E2E_TEST", () => generateText(...args))));
        const setup = executionMode === 'full' ? await (dependencies.setup || ensureFullSystemSetup)({ rootDir, model, dependencies: { generate: aiGenerate } }) : null;
        const generated = await (dependencies.generate || generateColdStartSystemTests)({rootDir,framework,targetRoutes,executionMode,model,requirements:revision?.contentJson||null});
        const filePath = framework==='cypress'?`cypress/e2e/covai-${suiteDigest(generated.code).slice(0,12)}.cy.js`:`tests/e2e/covai-${suiteDigest(generated.code).slice(0,12)}.spec.mjs`;
        if(signal?.aborted)throw new ServiceError('Generation canceled',409);
        const setupChanges = [];
        if(setup?.generated && setup.config?.database?.initSql === '.covai/generated-schema.sql')setupChanges.push({path:path.relative(context.rootDir,path.join(rootDir,setup.config.database.initSql)).replaceAll('\\','/'),content:await fs.readFile(path.join(rootDir,setup.config.database.initSql),'utf8'),beforeHash:null});
        if(executionMode==='full' && !systemConfigExisted)setupChanges.push({path:path.relative(context.rootDir,path.join(rootDir,'.covai/system-test.json')).replaceAll('\\','/'),content:await fs.readFile(path.join(rootDir,'.covai/system-test.json'),'utf8'),beforeHash:null});
        if(generated.configCreated && !existing.has(generated.configPath)) setupChanges.push({path:path.relative(context.rootDir,path.join(rootDir,generated.configPath)).replaceAll('\\','/'),content:await fs.readFile(path.join(rootDir,generated.configPath),'utf8'),beforeHash:null});
        const relative = path.relative(context.rootDir,path.join(rootDir,filePath)).replaceAll('\\','/');
        const meta = {kind:'SYSTEM_GENERATION_DRAFT',framework,executionMode,promptVersion:SYSTEM_PROMPT_VERSION,model:model||null,contextHash:generated.contextHash||null,attempts:generated.generationAttempts||null,aiUsage:currentAiJobBudget()?.snapshot()||null,sourceHash:baseline.sourceHash,suiteHash:baseline.suiteHash,workspaceRevision:project.workspaceRevision,setupChanges,scenarioCount:generated.scenarioCount,scenarios:generated.generationMetadata?.scenarios||[],metadataStatus:generated.generationMetadata?.metadataStatus||'CODE_ONLY',requirementRevisionId:revision?.id||null,applied:false};
        await stagePreparedPublication(async tx=>{draft=await tx.aiTest.create({data:{projectId:snapshot.projectId,snapshotId,filePath:relative,content:generated.code,status:'DRAFT',mode:framework==='cypress'?'CYPRESS_E2E':'PLAYWRIGHT_E2E',metaJson:JSON.stringify(meta)}});});
    });
    return {aiTestId:draft.id,filePath:draft.filePath,code:draft.content,candidateHash:suiteDigest(draft.content),...JSON.parse(draft.metaJson),verificationStatus:'NOT_VERIFIED',state:'DRAFT'};
};

export const latestSystemGenerationDraft = async ({snapshotId,userId,db=prisma}) => {
    const {project}=await resolveSnapshotAccess({snapshotId,userId,capability:'project.read',db});
    const candidates=await db.aiTest.findMany({where:{snapshotId,status:'DRAFT',metaJson:{contains:'SYSTEM_GENERATION_DRAFT'}},orderBy:{createdAt:'desc'},take:20});
    for(const draft of candidates){
        const meta=JSON.parse(draft.metaJson);
        if(meta.kind==='SYSTEM_GENERATION_DRAFT' && meta.executionMode==='full')return {aiTestId:draft.id,filePath:draft.filePath,code:draft.content,candidateHash:suiteDigest(draft.content),...meta,stale:project.workspaceRevision!==meta.workspaceRevision,verificationStatus:'NOT_VERIFIED',state:'DRAFT'};
    }
    return null;
};

export const applySystemGenerationDraft = async ({snapshotId,draftId,userId,input,db=prisma}) => {
    const {snapshot,project} = await resolveSnapshotAccess({snapshotId,userId,capability:'evidence.approve',db});
    const draft = await db.aiTest.findFirst({where:{id:draftId,snapshotId}});
    if(!draft)throw new ServiceError('Generation draft not found',404);
    const meta = JSON.parse(draft.metaJson||'{}');
    if(meta.kind!=='SYSTEM_GENERATION_DRAFT')throw new ServiceError('This draft is not a System Test proposal',409);
    requireFullStackMode(meta.executionMode);
    if(input.expectedCandidateHash!==suiteDigest(draft.content)||!input.reviewed)throw new ServiceError('Review the exact generated tests before applying',409);
    if(meta.applied)return {aiTestId:draft.id,versionId:meta.versionId,reused:true};
    if(project.workspaceRevision!==meta.workspaceRevision)throw new ServiceError('Workspace changed after generation. Generate a new draft.',409);
    if(meta.setupChanges.length && !input.approveSharedSetup)throw new ServiceError('Review and approve shared test configuration separately',409);
    const latestRevision=await db.systemRequirementRevision.findFirst({where:{snapshotId,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
    if((latestRevision?.id||null)!==meta.requirementRevisionId)throw new ServiceError('Confirmed requirements changed after generation. Generate a new draft.',409);
    validateGeneratedTestCode(draft.content);
    if(meta.executionMode==='full')validateFullSystemTest(draft.content);
    const baseline = await captureSystemSuiteManifest({rootDir:projectEditableWorkspaceRoot(snapshot)});
    const state=await db.systemSuiteState.findUnique({where:{snapshotId}});
    const head=state?.headVersionId?await db.systemSuiteVersion.findUnique({where:{id:state.headVersionId}}):null;
    if(head && head.suiteHash!==baseline.suiteHash)throw new ServiceError('Record your current test changes before applying another draft.',409);
    if(baseline.sourceHash!==meta.sourceHash||baseline.suiteHash!==meta.suiteHash)throw new ServiceError('Source or tests changed after generation',409);
    let version;
    const result = await withPreparedProjectWorkspace({projectId:snapshot.projectId,snapshotId,userId,capability:'evidence.approve',expectedWorkspaceRevision:meta.workspaceRevision,type:'SYSTEM_TEST_GENERATION_APPLY',input:{draftId,expectedCandidateHash:input.expectedCandidateHash}},async context=>{
        const target = containedPath(context.rootDir,draft.filePath);
        await fs.mkdir(path.dirname(target),{recursive:true});
        try{await fs.writeFile(target,draft.content,{flag:'wx'});}catch(error){if(error.code==='EEXIST')throw new ServiceError('Generated test path already exists. Generate a new draft.',409);throw error;}
        for(const setup of meta.setupChanges){const file=containedPath(context.rootDir,setup.path);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,setup.content);}
        const capture = await captureSystemSuiteManifest({rootDir:context.rootDir});
        const repoRoot = resolveSystemRepositoryRoot(path.join(context.rootDir,context.analysisRelative));
        await stagePreparedPublication(async tx=>{
            const catalog=await syncSystemScenarioCatalog({client:tx,snapshotId,rootDir:repoRoot});
            for(const row of meta.scenarios||[]) {
                const scenario=catalog.scenarios.find(item=>item.title===row.title && item.filePath===path.relative(repoRoot,target).replaceAll('\\','/'));
                if(scenario)await updateScenarioDraft({client:tx,snapshotId,scenarioId:scenario.id,input:{title:scenario.title,flow:row.actions,inputs:[...row.preconditions,...row.inputs],expected:row.expected,criterionIds:row.criterionIds,expectedScenarioHash:scenario.scenarioHash}});
            }
            version = await commitSystemSuiteVersion({tx,snapshotId,capture,baseline,userId,requestId:`generation-${draftId}`,provenance:{draftId,promptVersion:meta.promptVersion,model:meta.model,verificationStatus:'NOT_VERIFIED',sharedSetupPaths:meta.setupChanges.map(file=>file.path)}});
            await tx.aiTest.update({where:{id:draftId},data:{status:'APPLIED',metaJson:JSON.stringify({...meta,applied:true,versionId:version.id})}});
        });
        return {};
    });
    return {...result,aiTestId:draftId,versionId:version.id,applied:true};
};
