import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import prisma from '../config/prisma.js';
import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';
const actualGemini = await import('../services/gemini.service.js');
const generate = jest.fn();
await jest.unstable_mockModule('../services/gemini.service.js',()=>({...actualGemini,generateText:generate}));
await jest.unstable_mockModule('../services/queue.service.js',()=>({jobQueue:{},addJobToQueue:jest.fn(),addSupertestCoveragePipeline:jest.fn()}));
const {getScenarioService,updateScenarioService,toggleScenarioService,regenerateScenarioService,scenarioArtifactVersion} = await import('../services/scenarioManager.service.js');
const {removeProjectMember} = await import('../services/projectMember.service.js');
const {createAiTestsJob} = await import('../services/job.service.js');
const {processAiTestsJob} = await import('../services/aiTestsJob.service.js');
const outsideOperation = AsyncLocalStorage.snapshot();
const suite = process.env.COLLABORATION_INTEGRATION === 'true' ? describe : describe.skip;
suite('shared scenario artifact CAS against PostgreSQL',()=>{
 let safe=false,root,owner,editor,viewer,project,snapshot,artifact;
 beforeAll(()=>{assertCollaborationTestDatabase(process.env.DATABASE_URL);safe=true;});
 beforeEach(async()=>{
  if(!safe)throw new Error('Disposable database required');
  root=await fs.mkdtemp(path.join(os.tmpdir(),'covai-scenario-cas-'));
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'scenario-fixture',type:'module'}));
  await fs.writeFile(path.join(root,'app.js'),'export const app = {};');
  const suffix=randomUUID();
  [owner,editor,viewer]=await Promise.all(['owner','editor','viewer'].map(name=>prisma.user.create({data:{name,email:`${name}-${suffix}@scenario.test`}})));
  project=await prisma.project.create({data:{name:'Scenario CAS',ownerId:owner.id}});
  snapshot=await prisma.projectSnapshot.create({data:{projectId:project.id,source:'ZIP',rootDir:root,storagePath:root}});
  await prisma.projectMember.createMany({data:[{projectId:project.id,userId:editor.id,role:'EDITOR'},{projectId:project.id,userId:viewer.id,role:'VIEWER'}]});
  artifact=await prisma.aiTest.create({data:{projectId:project.id,snapshotId:snapshot.id,filePath:'api.test.js',mode:'FULL',content:"describe('api',()=>{it('works',()=>{expect(1).toBe(1);});});",metaJson:JSON.stringify({framework:'SUPERTEST',requests:[{scenarioId:'one',testName:'works',enabled:true}]})}});
  await fs.writeFile(path.join(root,'api.test.js'),artifact.content);
  generate.mockReset().mockResolvedValue("it('works',()=>{expect(2).toBe(2);});");
 });
 afterEach(async()=>{
  if(!safe)return;
  const operations=project?.id?await prisma.projectOperation.findMany({where:{projectId:project.id},select:{id:true}}):[];
  if(project?.id)await prisma.project.deleteMany({where:{id:project.id}});
  const ids=[owner?.id,editor?.id,viewer?.id].filter(Boolean);
  if(ids.length)await prisma.user.deleteMany({where:{id:{in:ids}}});
  if(root&&path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('covai-scenario-cas-'))await fs.rm(root,{recursive:true,force:true});
  const parent=fileURLToPath(new URL('../../.covai-temp/collaboration-operations/',import.meta.url));
  for(const {id} of operations){if(!/^[\w-]+$/.test(id))throw new Error('Invalid operation ID');const dir=path.resolve(parent,id);if(path.dirname(dir)!==path.resolve(parent))throw new Error('Invalid operation directory');await fs.rm(dir,{recursive:true,force:true});}
  root=owner=editor=viewer=project=snapshot=artifact=null;
 });
 afterAll(async()=>{if(safe)await prisma.$disconnect();});
 const opts=actor=>({userId:actor.id,snapshotId:snapshot.id,expectedVersion:scenarioArtifactVersion(artifact)});
 test('two members saving the same artifact version have exactly one winner',async()=>{
  const results=await Promise.allSettled([updateScenarioService(artifact.id,'one',"it('works',()=>{expect(3).toBe(3);});",opts(owner)),toggleScenarioService(artifact.id,'one',false,opts(editor))]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.find(r=>r.status==='rejected').reason).toMatchObject({statusCode:409,code:'ARTIFACT_VERSION_CONFLICT'});
  expect((await prisma.project.findUnique({where:{id:project.id}})).workspaceRevision).toBe(1);
  expect(await fs.readFile(path.join(root,'api.test.js'),'utf8')).toBe((await prisma.aiTest.findUnique({where:{id:artifact.id}})).content);
  const read=await getScenarioService(artifact.id,'one',opts(viewer));
  expect(read.version).not.toBe(scenarioArtifactVersion(artifact));
 });
 test('Viewer cannot edit; a missing version cannot write',async()=>{
  await expect(toggleScenarioService(artifact.id,'one',false,opts(viewer))).rejects.toMatchObject({statusCode:403});
  await expect(updateScenarioService(artifact.id,'one',"it('works',()=>{});",{userId:editor.id,snapshotId:snapshot.id})).rejects.toMatchObject({statusCode:428});
  expect((await prisma.aiTest.findUnique({where:{id:artifact.id}})).content).toBe(artifact.content);
 });
 test('removal while the provider runs prevents regeneration publication',async()=>{
  generate.mockImplementation(async()=>{
   const member=await prisma.projectMember.findUnique({where:{projectId_userId:{projectId:project.id,userId:editor.id}}});
   await removeProjectMember({projectId:project.id,userId:owner.id,memberId:member.id,expectedRevision:member.revision});
   return "it('works',()=>{expect(9).toBe(9);});";
  });
  await expect(regenerateScenarioService(artifact.id,'one',{},opts(editor))).rejects.toMatchObject({statusCode:404});
  expect((await prisma.aiTest.findUnique({where:{id:artifact.id}})).content).toBe(artifact.content);
 });
 test('admitted regeneration publishes source, artifact and job completion together',async()=>{
  const job=await createAiTestsJob({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,mode:'SUPERTEST_REGENERATE',aiTestId:artifact.id,scenarioId:'one',expectedVersion:scenarioArtifactVersion(artifact)});
  await processAiTestsJob(job.id);
  const saved=await prisma.aiTest.findUnique({where:{id:artifact.id}});
  expect(saved.content).toContain('expect(2).toBe(2)');
  expect(await fs.readFile(path.join(root,'api.test.js'),'utf8')).toBe(saved.content);
  expect(await prisma.job.findUnique({where:{id:job.id}})).toMatchObject({userId:editor.id,status:'SUCCESS'});
  expect((await prisma.project.findUnique({where:{id:project.id}})).workspaceRevision).toBe(1);
  const repeated=await createAiTestsJob({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,mode:'SUPERTEST_REGENERATE',aiTestId:artifact.id,scenarioId:'one',expectedVersion:scenarioArtifactVersion(saved)});
  await processAiTestsJob(repeated.id);
  expect((await prisma.aiTest.findUnique({where:{id:artifact.id}})).content).toBe(saved.content);
  expect((await prisma.project.findUnique({where:{id:project.id}})).workspaceRevision).toBe(2);
  const repeatedOperation=await prisma.projectOperation.findUnique({where:{primaryJobId:repeated.id}});
  expect(repeatedOperation).toMatchObject({status:'SUCCESS',resultJson:{workspaceRevision:2,changedPaths:[]}});
 });
 test('scenario edit during regeneration makes the prepared worker stale',async()=>{
  generate.mockImplementation(async()=>{await outsideOperation(()=>toggleScenarioService(artifact.id,'one',false,opts(owner)));return "it('works',()=>{expect(9).toBe(9);});";});
  const job=await createAiTestsJob({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,mode:'SUPERTEST_REGENERATE',aiTestId:artifact.id,scenarioId:'one',expectedVersion:scenarioArtifactVersion(artifact)});
  await expect(processAiTestsJob(job.id)).rejects.toBeDefined();
  expect((await prisma.aiTest.findUnique({where:{id:artifact.id}})).content).toContain('it.skip');
  expect(await fs.readFile(path.join(root,'api.test.js'),'utf8')).toBe((await prisma.aiTest.findUnique({where:{id:artifact.id}})).content);
 });
 test('new Integration API accepts Editor, rejects Viewer and enforces the displayed artifact version',async()=>{
  const {updateIntegrationScenarioService,queueIntegrationTestGenerationService,detectIntegrationFrameworksService}=await import('../services/integrationApiService.service.js');
  await expect(updateIntegrationScenarioService({snapshotId:snapshot.id,scenarioId:'one',userId:viewer.id,updates:{expectedVersion:scenarioArtifactVersion(artifact),code:"it('works',()=>{expect(3).toBe(3);});"}})).rejects.toMatchObject({statusCode:403});
  await expect(queueIntegrationTestGenerationService({snapshotId:snapshot.id,userId:viewer.id})).rejects.toMatchObject({statusCode:403});
  const updated=await updateIntegrationScenarioService({snapshotId:snapshot.id,scenarioId:'one',userId:editor.id,updates:{expectedVersion:scenarioArtifactVersion(artifact),code:"it('works',()=>{expect(3).toBe(3);});"}});
  expect(updated.success).toBe(true);
  expect(await fs.readFile(path.join(root,'api.test.js'),'utf8')).toBe(updated.aiTest.content);
  await expect(updateIntegrationScenarioService({snapshotId:snapshot.id,scenarioId:'one',userId:owner.id,updates:{expectedVersion:scenarioArtifactVersion(artifact),code:"it('works',()=>{});"}})).rejects.toMatchObject({statusCode:409});
  const generation=await queueIntegrationTestGenerationService({snapshotId:snapshot.id,userId:editor.id,force:true});
  expect(await prisma.projectOperation.findUnique({where:{primaryJobId:generation.job.id}})).toMatchObject({actorId:editor.id,capability:'ai.use',status:'QUEUED'});
  expect(await detectIntegrationFrameworksService({snapshotId:snapshot.id,userId:viewer.id})).toBeDefined();
 });

});
