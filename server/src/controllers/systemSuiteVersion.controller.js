import { requireFullStackMode } from '../services/systemExecutionPolicy.service.js';
import { systemSuiteError } from '../services/systemSuiteAvailability.service.js';
import { systemSuiteHistory, readSystemSuiteVersion, compareSystemSuiteVersions, restoreSystemSuiteVersion, recordCurrentSystemSuite } from '../services/systemSuiteVersion.service.js';
import { suiteRestoreRequest, suiteCheckRequest } from '../validators/systemSuiteVersion.validator.js';
import prisma from '../config/prisma.js';
import { resolveSnapshotAccess } from '../services/projectAccess.service.js';
import { projectEditableWorkspaceRoot } from '../services/projectFileVersion.service.js';
import { captureSystemSuiteManifest } from '../services/systemSuiteManifest.service.js';
import { createSnapshotJob, markQueuedJobFailed } from '../services/job.service.js';
import { snapshotIdentity } from '../services/systemAssessmentWorkspace.service.js';
import { parseRequest } from '../validators/systemAssessment.validator.js';
import { ServiceError } from '../utils/serviceError.js';

const handler = fn => async (req,res) => {
    try {res.json({success:true,data:await fn(req)});}
    catch(error) {error=systemSuiteError(error);res.status(error.statusCode || 500).json({success:false,message:error.statusCode?error.message:'Test version operation failed',code:error.code});}
};
const args = req => ({snapshotId:req.params.snapshotId,userId:req.user.id,versionId:req.params.versionId});
export const systemSuiteControllers = {
    record:handler(req=>recordCurrentSystemSuite({...args(req),input:parseRequest(suiteRestoreRequest,req.body)})),
    history:handler(req=>{
        const limit=Number(req.query.limit||20);
        if(!Number.isInteger(limit)||limit<1||limit>50)throw new ServiceError('Version limit must be between 1 and 50',400);
        return systemSuiteHistory({...args(req),limit,cursor:req.query.cursor});
    }),
    get:handler(async req=>({version:(await readSystemSuiteVersion(args(req))).version})),
    compare:handler(req=>{
        if(typeof req.query.from!=='string'||typeof req.query.to!=='string')throw new ServiceError('Choose two versions to compare',400);
        return compareSystemSuiteVersions({...args(req),from:req.query.from,to:req.query.to});
    }),
    restore:handler(req=>restoreSystemSuiteVersion({...args(req),input:parseRequest(suiteRestoreRequest,req.body)})),
    check:async (req,res) => {
        let job;
        try {
            if(process.env.SYSTEM_ASSESSMENT_ENABLED!=='true' || process.env.SYSTEM_MEASURED_COVERAGE_ENABLED!=='true')throw new ServiceError('Enable measured System Test assessments before checking a version.',409);
            const input = parseRequest(suiteCheckRequest,{...req.body,executionMode:requireFullStackMode(req.body?.executionMode)});
            const {snapshot} = await resolveSnapshotAccess({...args(req),capability:'tests.run'});
            await readSystemSuiteVersion(args(req));
            if(input.runner!=='playwright')throw new ServiceError('Historical measured checks currently support Playwright only',422);
            const capture = await captureSystemSuiteManifest({rootDir:projectEditableWorkspaceRoot(snapshot)});
            if(capture.sourceHash!==input.expectedSourceHash)throw new ServiceError('Source changed. Refresh before checking a version.',409);
            const identity = snapshotIdentity(snapshot.rootDir);
            job = await createSnapshotJob({projectId:snapshot.projectId,snapshotId:snapshot.id,userId:req.user.id,type:'SYSTEM_TEST_ASSESSMENT',payloadJson:{...input,versionId:req.params.versionId,versionCheck:true}});
            const assessment = await prisma.systemTestAssessment.create({data:{snapshotId:snapshot.id,jobId:job.id,suiteVersionId:req.params.versionId,runner:input.runner,executionMode:input.executionMode,sourceHash:identity.sourceHash,testHash:identity.testHash,scopeHash:'pending',reportJson:{input:{...input,versionCheck:true}}}});
            await (await import('../services/queue.service.js')).addJobToQueue('SYSTEM_TEST_ASSESSMENT',job.id);
            res.status(202).json({success:true,data:{jobId:job.id,assessmentId:assessment.id}});
        } catch(error) {
            if(job){await markQueuedJobFailed(job.id,error);await prisma.systemTestAssessment.updateMany({where:{jobId:job.id},data:{status:'FAILED'}});}
            res.status(error.statusCode||500).json({success:false,message:error.statusCode?error.message:'Could not check this test version'});
        }
    },
};
