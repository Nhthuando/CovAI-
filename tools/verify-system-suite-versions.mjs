// Bounded, offline integration check. No existing PostgreSQL/Redis/AI/AUT is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PGlite } from '../server/node_modules/@electric-sql/pglite/dist/index.js';
import { PGLiteSocketServer } from '../server/node_modules/@electric-sql/pglite-socket/dist/index.js';
const repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary=await fs.mkdtemp(path.join(repository,'tmp-suite-check-'));
const memory=await PGlite.create();
const socket=new PGLiteSocketServer({db:memory,port:0,host:'127.0.0.1',maxConnections:1});
let prisma;
let failed=false;
try {
    // Generate a pre-change baseline from committed schema, then exercise the actual additive SQL.
    const oldSchema=execFileSync('git',['show','HEAD:server/prisma/schema.prisma'],{cwd:repository,encoding:'utf8',windowsHide:true});
    const schemaPath=path.join(temporary,'baseline.prisma');await fs.writeFile(schemaPath,oldSchema);
    const sql=execFileSync(process.execPath,[path.join(repository,'server/node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema',schemaPath,'--script'],{cwd:path.join(repository,'server'),encoding:'utf8',windowsHide:true,timeout:60000,stdio:['ignore','pipe','pipe']});
    await memory.exec(sql);
    await memory.exec(await fs.readFile(path.join(repository,'server/prisma/migrations/20261105120000_system_suite_versions/migration.sql'),'utf8'));
    await socket.start();
    process.env.DATABASE_URL=`postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
    process.env.PROJECT_EDITOR_COLLABORATION_ENABLED='false';
    ({default:prisma}=await import('../server/src/config/prisma.js'));
    const {captureSystemSuiteManifest}=await import('../server/src/services/systemSuiteManifest.service.js');
    const {commitSystemSuiteVersion,systemSuiteHistory,restoreSystemSuiteVersion,readSystemSuiteVersion}=await import('../server/src/services/systemSuiteVersion.service.js');
    const root=path.join(temporary,'workspace');await fs.mkdir(path.join(root,'tests/system'),{recursive:true});
    await fs.writeFile(path.join(root,'package.json'),'{"type":"module"}');
    await fs.writeFile(path.join(root,'app.js'),'export const application = "unchanged";');
    await fs.writeFile(path.join(root,'unit.test.js'),'// unit sentinel');
    await fs.writeFile(path.join(root,'tests/system/a.spec.js'),"import {test,expect} from '@playwright/test';test('A',async({page})=>{await expect(page.getByText('A')).toBeVisible();});");
    const user=await prisma.user.create({data:{email:'suite-integration@example.invalid'}});
    const project=await prisma.project.create({data:{name:'Suite isolation check',ownerId:user.id}});
    const snapshot=await prisma.projectSnapshot.create({data:{projectId:project.id,source:'ZIP',storagePath:root,rootDir:root}});
    const before=await captureSystemSuiteManifest({rootDir:root});
    const baseline=await prisma.$transaction(tx=>commitSystemSuiteVersion({tx,snapshotId:snapshot.id,capture:before,userId:user.id,requestId:'baseline',action:'BASELINE'}));
    await fs.writeFile(path.join(root,'tests/system/b.spec.js'),"import {test,expect} from '@playwright/test';test('B',async({page})=>{await expect(page.getByText('B')).toBeVisible();});");
    const after=await captureSystemSuiteManifest({rootDir:root});
    await prisma.$transaction(tx=>commitSystemSuiteVersion({tx,snapshotId:snapshot.id,capture:after,userId:user.id,requestId:'apply',action:'APPLY'}));
    let history=await systemSuiteHistory({snapshotId:snapshot.id,userId:user.id});
    assert.equal(history.items.length,2);assert.equal(history.workingChanges,false);
    const input={expectedHeadId:history.headId,expectedSuiteHash:history.suiteHash,expectedSourceHash:history.sourceHash,expectedWorkspaceRevision:history.workspaceRevision,requestId:'restore-one'};
    const restored=await restoreSystemSuiteVersion({snapshotId:snapshot.id,versionId:baseline.id,userId:user.id,input});
    assert.equal(restored.suiteHash,before.suiteHash);
    assert.equal(await fs.readFile(path.join(root,'app.js'),'utf8'),'export const application = "unchanged";');
    assert.equal(await fs.readFile(path.join(root,'unit.test.js'),'utf8'),'// unit sentinel');
    await assert.rejects(fs.access(path.join(root,'tests/system/b.spec.js')));
    const retry=await restoreSystemSuiteVersion({snapshotId:snapshot.id,versionId:baseline.id,userId:user.id,input});
    assert.equal(retry.versionId,restored.versionId);assert.equal(retry.reused,true);
    await assert.rejects(readSystemSuiteVersion({snapshotId:snapshot.id,versionId:baseline.id,userId:'foreign-user'}));
    history=await systemSuiteHistory({snapshotId:snapshot.id,userId:user.id});assert.equal(history.items.length,3);
    const appliedVersion=history.items.find(row=>row.action==='APPLY');
    const diagnosticRoot=path.join(temporary,'diagnostic-copy');await fs.cp(root,diagnosticRoot,{recursive:true});
    const {prepareHistoricalSuiteRun}=await import('../server/src/services/systemSuiteVersionRun.service.js');
    const diagnostic=await prepareHistoricalSuiteRun({rootDir:diagnosticRoot,snapshotId:snapshot.id,input:{versionId:appliedVersion.id,expectedSourceHash:history.sourceHash,runner:'playwright',executionMode:'frontend'}});
    assert.equal(diagnostic.input.testFiles.length,2);assert.equal(diagnostic.input.reviewMode,'legacy');
    assert.equal(await fs.readFile(path.join(diagnosticRoot,'app.js'),'utf8'),'export const application = "unchanged";');
    await assert.rejects(fs.access(path.join(root,'tests/system/b.spec.js')));

    await memory.exec(`CREATE FUNCTION reject_suite_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'RESTORE' THEN RAISE EXCEPTION 'injected version failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_suite_restore BEFORE INSERT ON "SystemSuiteVersion" FOR EACH ROW EXECUTE FUNCTION reject_suite_restore();`);
    await assert.rejects(restoreSystemSuiteVersion({snapshotId:snapshot.id,versionId:appliedVersion.id,userId:user.id,input:{expectedHeadId:history.headId,expectedSuiteHash:history.suiteHash,expectedSourceHash:history.sourceHash,expectedWorkspaceRevision:history.workspaceRevision,requestId:'rollback-test'}}),/injected version failure/);
    await assert.rejects(fs.access(path.join(root,'tests/system/b.spec.js')));
    assert.equal((await systemSuiteHistory({snapshotId:snapshot.id,userId:user.id})).items.length,3);
    await memory.exec('DROP TRIGGER fail_suite_restore ON "SystemSuiteVersion"; DROP FUNCTION reject_suite_restore();');
    await fs.appendFile(path.join(root,'tests/system/a.spec.js'),'\n// manual edit');
    await assert.rejects(restoreSystemSuiteVersion({snapshotId:snapshot.id,versionId:baseline.id,userId:user.id,input:{...input,expectedHeadId:history.headId,expectedSuiteHash:history.suiteHash,expectedWorkspaceRevision:history.workspaceRevision,requestId:'conflict'}}),/unrecorded edits/);
    // Exercise the real reviewed Apply boundary without executing an AUT or calling AI.
    const aPath=path.join(root,'tests/system/a.spec.js');
    const originalCode="import {test,expect} from '@playwright/test';test('A',async({page})=>{await expect(page.getByText('A')).toBeVisible();});";
    await fs.writeFile(aPath,originalCode);
    const candidateCode=originalCode+"test('B',async({page})=>{await expect(page.getByText('B')).toBeVisible();});";
    const {snapshotIdentity}=await import('../server/src/services/systemAssessmentWorkspace.service.js');
    const {digest,analyzeSystemTestFile}=await import('../server/src/services/systemTestStaticAnalysis.service.js');
    const {proposalReviewHash}=await import('../server/src/services/systemProposalReview.service.js');
    const {applyReviewedSystemProposal}=await import('../server/src/services/systemSuiteApply.service.js');
    const identity=snapshotIdentity(root);
    await fs.writeFile(aPath,candidateCode);const candidateIdentity=snapshotIdentity(root);await fs.writeFile(aPath,originalCode);
    const runReport=(covered,extra=false)=>({...identity,...(extra?candidateIdentity:{}),scopeHash:'scope',runtimeHash:'runtime',runner:'playwright',executionMode:'frontend',requirements:{criteria:[]},stability:{passedRuns:2,runs:2},runs:[1,2].map(index=>({index,testRun:{startedAt:new Date('2026-11-05T01:00:00Z'),finishedAt:new Date('2026-11-05T01:00:01Z'),status:'PASSED',durationMs:20,totalTests:extra?2:1,passedTests:extra?2:1,failedTests:0,skippedTests:0,flakyTests:0,scenarios:[{testFile:'tests/system/a.spec.js',title:'A',status:'passed'},...(extra?[{testFile:'tests/system/a.spec.js',title:'B',status:'passed'}]:[])]}})),coverage:{tiers:{frontend:{status:'MEASURED',counters:Object.fromEntries(['lines','branches','functions','statements'].map(metric=>[metric,{covered,total:10,pct:covered*10}]))}}},input:{testFiles:['tests/system/a.spec.js'],runner:'playwright',executionMode:'frontend',repeatRuns:2,coverageScope:{frontend:{root:'.',sourceDirectory:'.'}}}});
    const oldReport=runReport(4),newReport=runReport(5,true);
    const assessment=await prisma.systemTestAssessment.create({data:{snapshotId:snapshot.id,jobId:'baseline-check',runner:'playwright',executionMode:'frontend',status:'COMPLETED',sourceHash:identity.sourceHash,testHash:identity.testHash,scopeHash:'scope',reportJson:oldReport}});
    const site=analyzeSystemTestFile({content:candidateCode,filePath:'tests/system/a.spec.js'}).assertionSites.at(-1);
    const review={candidateHash:digest(candidateCode),requirementRevisionId:null,requirementHash:null,scenarios:[{title:'B',flow:['Open B'],inputs:['No input required'],expected:['B is visible'],criterionIds:[],assertionIds:[site.id]}],reviewedByUserId:user.id,reviewedAt:new Date().toISOString()};review.reviewHash=proposalReviewHash(review);
    const proposal=await prisma.systemTestProposal.create({data:{snapshotId:snapshot.id,assessmentId:assessment.id,jobId:'candidate-check',filePath:'tests/system/a.spec.js',baseTestHash:digest(originalCode),candidateTestHash:digest(candidateCode),state:'VERIFIED_IMPROVEMENT',proposedContent:candidateCode,verificationJson:{baseline:oldReport,candidate:newReport,accepted:true,review}}});
    const applied=await applyReviewedSystemProposal({snapshotId:snapshot.id,proposalId:proposal.id,userId:user.id,input:{expectedCurrentTestHash:digest(originalCode),expectedCandidateTestHash:digest(candidateCode)},lease:{assertHeld:async()=>{}}});
    assert(applied.versionId);assert.equal(await fs.readFile(aPath,'utf8'),candidateCode);
    assert.equal((await prisma.systemTestAssessment.findUnique({where:{id:applied.publishedAssessmentId}})).suiteVersionId,applied.versionId);
    const {createSystemGenerationDraft,applySystemGenerationDraft}=await import('../server/src/services/systemGenerationProposal.service.js');
    const draft=await createSystemGenerationDraft({snapshotId:snapshot.id,userId:user.id,framework:'playwright',targetRoutes:['/'],executionMode:'full',dependencies:{setup:async({rootDir})=>{await fs.mkdir(path.join(rootDir,'.covai'),{recursive:true});await fs.writeFile(path.join(rootDir,'.covai/system-test.json'),'{}');return {generated:true,config:{}};},generate:async()=>({code:"import {test,expect} from '@playwright/test';test('C',async({page})=>{await expect(page.getByText('C')).toBeVisible();});",configCreated:false,scenarioCount:1,generationMetadata:{scenarios:[]}})}});
    await assert.rejects(fs.access(path.join(root,draft.filePath)));
    const generated=await applySystemGenerationDraft({snapshotId:snapshot.id,draftId:draft.aiTestId,userId:user.id,input:{expectedCandidateHash:draft.candidateHash,reviewed:true,approveSharedSetup:true}});
    assert(generated.applied);assert.equal(await fs.readFile(path.join(root,draft.filePath),'utf8'),draft.code);
    assert.equal(await fs.readFile(path.join(root,'app.js'),'utf8'),'export const application = "unchanged";');
    let providerCalled=false;
    await memory.exec('ALTER TABLE "SystemSuiteState" RENAME TO "MissingSuiteState"');
    try {
        await assert.rejects(createSystemGenerationDraft({snapshotId:snapshot.id,userId:user.id,framework:'playwright',targetRoutes:['/'],executionMode:'full',dependencies:{generate:async()=>{providerCalled=true;throw new Error('Provider must not run');}}}),error=>error.code==='SYSTEM_VERSION_SCHEMA_REQUIRED');
        assert.equal(providerCalled,false);
    } finally {await memory.exec('ALTER TABLE "MissingSuiteState" RENAME TO "SystemSuiteState"');}

    // Verify setup publication and credential resolution through the actual isolated operation.
    await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module',scripts:{dev:'vite'},dependencies:{vite:'1'}}));
    await fs.writeFile(path.join(root,'.env.test'),'SETUP_CHECK_KEY=offline-test-value\n');
    await fs.writeFile(path.join(root,'.env'),'PRODUCTION_ONLY_KEY=must-not-be-read\n');
    const {withPreparedProjectWorkspace}=await import('../server/src/services/projectWorkspacePreparation.service.js');
    const {readAssessmentTestEnvironment,readApplicationEnvironment}=await import('../server/src/services/fullSystemRuntime.service.js');
    const currentProject=await prisma.project.findUnique({where:{id:project.id}});
    await withPreparedProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:user.id,expectedWorkspaceRevision:currentProject.workspaceRevision,type:'VERIFY_SETUP_ENV',publish:false},async context=>{
        await assert.rejects(fs.access(path.join(context.rootDir,'.env.test')));
        assert.equal(readAssessmentTestEnvironment(context.rootDir).SETUP_CHECK_KEY,'offline-test-value');
        assert.equal(readApplicationEnvironment(context.rootDir).SETUP_CHECK_KEY,'offline-test-value');
        assert.equal(readApplicationEnvironment(context.rootDir).PRODUCTION_ONLY_KEY,undefined);
    });
    const {systemSetupPreflight,applySystemSetup}=await import('../server/src/services/systemSetupPreflight.service.js');
    const setup=await systemSetupPreflight({snapshotId:snapshot.id,userId:user.id});
    assert(setup.candidateConfig);assert.equal(setup.configured,false);
    const setupInput={config:setup.candidateConfig,expectedWorkspaceRevision:setup.workspaceRevision,expectedSourceHash:setup.sourceHash,expectedSetupHash:setup.setupHash,reviewed:true};
    const saved=await applySystemSetup({snapshotId:snapshot.id,userId:user.id,input:setupInput});
    assert.equal(saved.configured,true);assert.deepEqual(saved.changedPaths,['.covai/system-test.json']);
    assert.equal((await systemSetupPreflight({snapshotId:snapshot.id,userId:user.id})).ready,true);
    await assert.rejects(applySystemSetup({snapshotId:snapshot.id,userId:user.id,input:setupInput}),/changed/);
    assert.equal(await fs.readFile(path.join(root,'.env.test'),'utf8'),'SETUP_CHECK_KEY=offline-test-value\n');

    console.log('PASS: additive migration; real Apply/version/report transaction; generation draft stays unpublished until Apply; historical check in a copy; multi-file restore; untouched app/unit files; idempotency, ownership, conflict and filesystem recovery after DB failure; setup-only publication and original test-env access without production env in operation copies. No AUT or AI calls.');
}catch(error){
    console.error(String(error.message).slice(0,2500));failed=true;
}finally{
    await prisma?.$disconnect();await socket.stop();await memory.close();
    const relative=path.relative(repository,temporary);assert(relative && !relative.startsWith('..')&&!path.isAbsolute(relative));
    await fs.rm(temporary,{recursive:true,force:true});
}
if(failed)process.exit(1);
