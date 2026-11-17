import prisma from '../config/prisma.js';
import { resolveSnapshotAccess } from './projectAccess.service.js';
import { projectEditableWorkspaceRoot } from './projectFileVersion.service.js';
import { withPreparedProjectWorkspace } from './projectWorkspacePreparation.service.js';
import { stagePreparedPublication } from './projectOperationWorkspace.service.js';
import { captureSystemSuiteManifest } from './systemSuiteManifest.service.js';
import { commitSystemSuiteVersion } from './systemSuiteVersion.service.js';
import { applySystemProposal } from './systemTestImprovementJob.service.js';
import { registerAppliedProposalReview } from './systemProposalReview.service.js';
import { publishAppliedAssessment } from './systemAssessmentPersistence.service.js';
import { ServiceError } from '../utils/serviceError.js';
import path from 'node:path';

// File publication, catalog/review metadata, version receipt and result commit together.
export const applyReviewedSystemProposal = async ({snapshotId,proposalId,userId,input,lease,db=prisma}) => {
    const {snapshot,project} = await resolveSnapshotAccess({snapshotId,userId,capability:'evidence.approve',db});
    const proposal = await db.systemTestProposal.findFirst({where:{id:proposalId,snapshotId}});
    if(!proposal)throw new ServiceError('Proposal not found',404);
    if(proposal.state==='APPLIED'){
        if(input.expectedCandidateTestHash!==proposal.candidateTestHash || input.expectedCurrentTestHash!==proposal.baseTestHash)throw new ServiceError('Applied proposal does not match the requested test hashes',409);
        return {...proposal,versionId:proposal.verificationJson?.versionId,publishedAssessmentId:proposal.verificationJson?.publishedAssessmentId,reused:true};
    }
    const baseline = await captureSystemSuiteManifest({rootDir:projectEditableWorkspaceRoot(snapshot)});
    const state = await db.systemSuiteState.findUnique({where:{snapshotId}});
    const head = state?.headVersionId ? await db.systemSuiteVersion.findUnique({where:{id:state.headVersionId}}) : null;
    if(head && head.suiteHash!==baseline.suiteHash) throw new ServiceError('Test files changed outside Apply. Review and reconcile those edits before applying another proposal.',409);
    return withPreparedProjectWorkspace({projectId:snapshot.projectId,snapshotId,userId,capability:'evidence.approve',expectedWorkspaceRevision:project.workspaceRevision,type:'SYSTEM_TEST_IMPROVEMENT',input:{proposalId,...input}},async context=>{
        const analysisRoot = path.join(context.rootDir,context.analysisRelative);
        const saved = await applySystemProposal({client:db,rootDir:analysisRoot,snapshotId,proposalId,expectedCurrentTestHash:input.expectedCurrentTestHash,expectedCandidateTestHash:input.expectedCandidateTestHash,userId,lease});
        const capture = await captureSystemSuiteManifest({rootDir:context.rootDir});
        const changed = [...new Set([...baseline.manifest.map(file=>file.path),...capture.manifest.map(file=>file.path)])];
        if(capture.sourceHash!==baseline.sourceHash || capture.configHash!==baseline.configHash || !changed.length) throw new ServiceError('Proposal changed application source or shared configuration',409);
        await stagePreparedPublication(async tx=>{
            const current = await tx.systemSuiteState.findUnique({where:{snapshotId}});
            if((current?.headVersionId||null)!==(state?.headVersionId||null))throw new ServiceError('Test version changed before Apply',409);
            await registerAppliedProposalReview({client:tx,snapshotId,rootDir:analysisRoot,proposal:saved});
            const version = await commitSystemSuiteVersion({tx,snapshotId,capture,baseline,userId,requestId:`proposal-${proposalId}`,provenance:{proposalId,baselineAssessmentId:saved.assessmentId,runtimeVerification:'PASSED_TWO_RUNS'}});
            const original = await tx.systemTestAssessment.findFirst({where:{id:saved.assessmentId,snapshotId}});
            const report = {...saved.verificationJson.candidate,suiteVersionId:version.id,comparison:{baselineAssessmentId:original.id,coverageChanges:saved.verificationJson.coverageChanges || {},newlyVerifiedCriterionIds:saved.verificationJson.newlyVerifiedCriterionIds || [],comparable:true}};
            const published = await publishAppliedAssessment({client:tx,job:{id:saved.jobId,snapshotId},report,input:original.reportJson.input,requirementRevisionId:original.requirementRevisionId});
            await tx.systemTestProposal.update({where:{id:saved.id},data:{verificationJson:{...saved.verificationJson,publishedAssessmentId:published.id,versionId:version.id}}});
            Object.assign(saved,{versionId:version.id,publishedAssessmentId:published.id});
        });
        return saved;
    });
};
