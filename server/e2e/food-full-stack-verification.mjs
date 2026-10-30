// Explicit acceptance check for the owned Food Ordering import. It preserves
// existing tests, publishes the separate acceptance suite only after two real
// passing runs, and saves measurements through the same persistence service.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Redis from 'ioredis';
import prisma from '../src/config/prisma.js';
import {acquireSnapshotLease,createAssessmentWorkspace,snapshotIdentity} from '../src/services/systemAssessmentWorkspace.service.js';
import {ensureFullSystemSetup,inspectSystemSetupSource} from '../src/services/fullSystemSetup.service.js';
import {readAssessmentTestEnvironment} from '../src/services/fullSystemRuntime.service.js';
import {validateStartupEnvironment} from '../src/services/fullSystemEnvironment.service.js';
import {assessSystemWorkspace} from '../src/services/systemAssessmentJob.service.js';
import {persistAssessmentRuns} from '../src/services/systemAssessmentPersistence.service.js';
import {createSnapshotJob,markJobRunning,markJobSuccess,markJobFailed} from '../src/services/job.service.js';

const redis=new Redis(process.env.REDIS_URL || 'redis://localhost:6379',{maxRetriesPerRequest:1});
let lease,workspace,job;
const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),20*60*1000);deadline.unref();
try {
  const source=await prisma.job.findUnique({where:{id:process.env.COVAI_E2E_SOURCE_JOB || 'cmvacc4p00000gk7krfjw2lf9'},include:{snapshot:true}});
  if(!source)throw new Error('Source job not found');
  if(await prisma.job.count({where:{snapshotId:source.snapshotId,type:{in:['SYSTEM_TEST_ASSESSMENT','SYSTEM_TEST_IMPROVEMENT','SYSTEM_TEST_MUTATION']},status:{in:['QUEUED','RUNNING']}}}))throw new Error('Another system operation is active');
  lease=await acquireSnapshotLease({redis,snapshotId:source.snapshotId});lease.signal=controller.signal;
  const root=source.snapshot.rootDir;
  const {config}=await ensureFullSystemSetup({rootDir:root});
  const backend=path.join(root,config.backend.directory),inspection=inspectSystemSetupSource(backend);
  validateStartupEnvironment({files:inspection.files,scripts:inspection.packages.find(pkg=>pkg.directory==='.')?.scripts,env:readAssessmentTestEnvironment(backend),directory:config.backend.directory});
  const before=snapshotIdentity(root);
  const relative=path.posix.join(config.frontend.directory,'e2e/covai-full-stack.spec.ts');
  const target=path.join(root,relative),content=fs.readFileSync(fileURLToPath(new URL('./fixtures/food-full-stack.spec.ts',import.meta.url)));
  if(fs.existsSync(target) && !fs.readFileSync(target).equals(content))throw new Error('Acceptance file already exists with different content; refusing overwrite');
  workspace=createAssessmentWorkspace({rootDir:root});
  fs.mkdirSync(path.dirname(path.join(workspace.rootDir,relative)),{recursive:true});fs.writeFileSync(path.join(workspace.rootDir,relative),content);
  const input={runner:'playwright',executionMode:'full',repeatRuns:2,testFiles:[relative],excludedTests:[],coverageScope:{frontend:{root:config.frontend.directory,sourceDirectory:'src'},backend:{root:config.backend.directory,sourceDirectory:'.'}}};
  const report=await assessSystemWorkspace({rootDir:workspace.rootDir,environmentRoot:root,input,signal:controller.signal,onProgress:async(message,progress)=>{await lease.assertHeld();console.log('FULL_STACK_VERIFICATION_STAGE',progress,message);}});
  if(report.runs.length!==2 || report.runs.some(run=>run.testRun.status!=='PASSED' || run.testRun.totalTests!==3 || run.testRun.passedTests!==3))throw new Error('Acceptance suite did not pass all 3 scenarios in both independent runs; original tests remain unchanged');
  await lease.assertHeld();
  const current=snapshotIdentity(root);
  if(current.sourceHash!==before.sourceHash || current.testHash!==before.testHash)throw new Error('Snapshot changed during verification; refusing publication');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(!fs.existsSync(target))fs.writeFileSync(target,content,{flag:'wx'});
  const published=snapshotIdentity(root);
  if(published.sourceHash!==report.sourceHash || published.testHash!==report.testHash)throw new Error('Published file hashes do not match verified measurements');
  job=await createSnapshotJob({projectId:source.projectId,snapshotId:source.snapshotId,userId:source.userId,type:'SYSTEM_TEST_ASSESSMENT',payloadJson:input});
  await markJobRunning(job.id);
  report.input=input;
  const testRunId=await persistAssessmentRuns({report,snapshotId:source.snapshotId,executionMode:'full'});
  const assessment=await prisma.systemTestAssessment.create({data:{snapshotId:source.snapshotId,jobId:job.id,status:'COMPLETED',sourceHash:report.sourceHash,testHash:report.testHash,scopeHash:report.scopeHash,testRunId,runner:'playwright',executionMode:'full',reportJson:JSON.parse(JSON.stringify(report))}});
  await markJobSuccess(job.id,{assessmentId:assessment.id});
  console.log('FULL_STACK_VERIFICATION_RESULT',JSON.stringify({jobId:job.id,assessmentId:assessment.id,tests:report.runs.map(run=>({total:run.testRun.totalTests,passed:run.testRun.passedTests})),coverage:Object.fromEntries(Object.entries(report.coverage.tiers).map(([tier,value])=>[tier,{status:value.status,counters:value.counters}]))}));
} catch(error) {
  if(job)await markJobFailed(job.id,error);
  console.error('FULL_STACK_VERIFICATION_FAILED',error.message);process.exitCode=1;
} finally {
  clearTimeout(deadline);workspace?.release();await lease?.release();await redis.quit();await prisma.$disconnect();
}
