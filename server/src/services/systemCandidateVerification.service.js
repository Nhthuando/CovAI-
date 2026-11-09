import { preserveCandidateArtifacts } from './systemRunArtifact.service.js';
import fs from 'node:fs';
import prisma from '../config/prisma.js';
import { getJobById, markJobRunning, markJobSuccess, markJobFailed } from './job.service.js';
import { withOperationPublishGuard } from './projectOperationWorkspace.service.js';
import { containedPath } from './fullSystemConfig.service.js';
import { candidateReviewedBindings, prepareReviewedCandidate } from './systemCandidateReview.service.js';
import { assessSystemWorkspace } from './systemAssessmentJob.service.js';
import { evaluateSystemImprovement } from './systemImprovementPolicy.service.js';
import { digest } from './systemTestStaticAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';

export const processReviewedCandidateVerification = async (jobId,lease) => {
    await markJobRunning(jobId);
    const job=await getJobById(jobId), input=JSON.parse(job.payloadJson);
    try {
        const proposal=await prisma.systemTestProposal.findFirst({where:{id:input.proposalId,snapshotId:job.snapshotId,jobId},include:{assessment:true}});
        if(!proposal)throw new ServiceError('Reviewed candidate not found',404);
        const latest=await prisma.systemRequirementRevision.findFirst({where:{snapshotId:job.snapshotId,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'},include:{bindings:true}});
        if(latest?.id!==proposal.assessment.requirementRevisionId)throw new ServiceError('Requirements changed. Run the baseline again.',409);
        const bindings=candidateReviewedBindings({proposal,revision:latest});
        prepareReviewedCandidate({rootDir:job.snapshot.rootDir,proposal,baselineContent:fs.readFileSync(containedPath(job.snapshot.rootDir,proposal.filePath),'utf8')});
        const candidate=await assessSystemWorkspace({rootDir:job.snapshot.rootDir,input:proposal.assessment.reportJson.input,jobId,signal:lease.signal,revision:latest,bindings:[...latest.bindings.map(binding=>binding.testFile===proposal.filePath?{...binding,testHash:digest(proposal.proposedContent)}:binding),...bindings]});
        preserveCandidateArtifacts({rootDir:job.snapshot.rootDir,report:candidate});
        const verification={...proposal.verificationJson,candidate,...evaluateSystemImprovement({baseline:proposal.verificationJson.baseline,candidate})};
        await lease.assertHeld();
        await withOperationPublishGuard(tx=>tx.systemTestProposal.update({where:{id:proposal.id},data:{state:verification.state,verificationJson:JSON.parse(JSON.stringify(verification))}}));
        await markJobSuccess(jobId,{proposalId:proposal.id});
    }catch(error){
        await prisma.systemTestProposal.updateMany({where:{jobId},data:{state:'FAILED_VERIFICATION'}});
        await markJobFailed(jobId,error);throw error;
    }
};
