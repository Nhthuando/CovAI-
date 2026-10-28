import {jest} from '@jest/globals';
import {fileURLToPath} from 'node:url';
const service = name => fileURLToPath(new URL(`../../services/${name}.service.js`,import.meta.url));
let operation;
const db = async()=> (await import('../../config/prisma.js')).default;
const stage = async run => run(await db());
// These suites exercise API orchestration/AST on temporary files. PostgreSQL
// authorization, private workspaces and publication are tested by the separate
// collaboration integration suites, rather than connecting unit spies to a DB.
await jest.unstable_mockModule(service('projectAccess'),()=>({
 resolveProjectAccess:async({projectId,userId})=>({project:{id:projectId,ownerId:userId,workspaceRevision:0}}),
 resolveSnapshotAccess:jest.fn(),membershipWhere:userId=>({ownerId:userId}),
 withProjectGuard:async(options,run)=>run(await db(),{project:{id:options.projectId,workspaceRevision:0}}),
}));
await jest.unstable_mockModule(service('projectOperationWorkspace'),()=>({
 currentProjectOperation:()=>operation,operationSnapshot:snapshot=>snapshot,
 stagePreparedValue:run=>stage(run),stagePreparedPublication:stage,stagePreparedFailure:stage,
 deferPreparedCommit:()=>{},withOperationPublishGuard:stage,
 beginPreparedPublications:()=>{},flushPreparedPublications:async()=>{},deliverPreparedCommits:async()=>{},
 assertProjectOperationActive:async()=>{},runJobInOperationWorkspace:async(_id,run)=>run(),withOperationWorkspace:async(_id,run)=>run(),
}));
await jest.unstable_mockModule(service('projectWorkspacePreparation'),()=>({
 withPreparedProjectWorkspace:async(options,run)=>{
  const snapshot=await (await db()).projectSnapshot.findUnique({where:{id:options.snapshotId}});
  operation={projectId:options.projectId,snapshotId:options.snapshotId,userId:options.userId,rootDir:snapshot.rootDir,originalRootDir:snapshot.rootDir,analysisRelative:''};
  try{return await run(operation);}finally{operation=undefined;}
 },
}));
