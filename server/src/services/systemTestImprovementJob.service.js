import { operationAbortReason, operationTimeout, isStaleImprovementError } from './systemOperationError.service.js';
import { withProjectDependencyCache } from './projectDependencyCache.service.js';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../config/prisma.js';
import { readVersionedProjectFile,projectEditableWorkspaceRoot } from './projectFileVersion.service.js';
import { mutateProjectWorkspace } from './projectMutation.service.js';
import { snapshotWorkspaceRoot } from '../utils/snapshotWorkspace.js';
import { resolveSnapshotAccess } from './projectAccess.service.js';
import { currentProjectOperation,operationSnapshot,withOperationPublishGuard,stagePreparedPublication,assertProjectOperationActive } from './projectOperationWorkspace.service.js';
import { containedPath, resolveSystemRepositoryRoot } from './fullSystemConfig.service.js';
import { createAssessmentWorkspace, snapshotIdentity } from './systemAssessmentWorkspace.service.js';
import { digest, preserveTestIntent, validateAdditionalTestQuality } from './systemTestStaticAnalysis.service.js';
import { optimizeSystemTest } from './systemTestBooster.service.js';
import { assessSystemWorkspace } from './systemAssessmentJob.service.js';
import { evaluateSystemImprovement } from './systemImprovementPolicy.service.js';
import { getJobById, markJobRunning, markJobSuccess, markJobFailed, addJobLog, updateJobProgress } from './job.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { buildImprovementRepairFeedback, findPreviousImprovementVerification } from './systemImprovementFeedback.service.js';
import { createAiJobBudget, withAiJobBudget } from './aiJobBudget.service.js';
import { publishAppliedAssessment } from './systemAssessmentPersistence.service.js';

import { IMPROVEMENT_LIMITS as limits, coverageGoal } from '../../../shared/systemImprovement.js';
import { prioritizeImprovementGaps } from './systemImprovementTargets.service.js';
import { improvementFailure } from './systemImprovementFailure.service.js';
import { retainPassedAdditionalTests } from './systemImprovementCandidates.service.js';

export const processSystemImprovementJob = (jobId, lease) => withProjectDependencyCache(() => runSystemImprovementJob(jobId, lease));

const runSystemImprovementJob = async (jobId, lease) => {
    await markJobRunning(jobId);
    const job=await getJobById(jobId),input=JSON.parse(job.payloadJson);
    const deadline=Date.now()+limits.timeLimitMs;
    let workspace,baseline,best,verification,assessment,revision,before,identity;
    let progress=0,finishing=false,stopReason='ROUND_LIMIT',noGain=0;
    const attempts=[];
    const attemptedGaps=new Set();
    const assertActive=async()=>{
        if(finishing && lease.signal?.aborted && lease.signal.reason?.code==='SYSTEM_OPERATION_TIMEOUT') {
            if(!lease.assertOwnership)throw operationAbortReason(lease.signal);
            await lease.assertOwnership();
        } else await lease.assertHeld();
        const current=await getJobById(jobId);
        if(current.status && current.status!=='RUNNING')throw new ServiceError('System improvement canceled',409);
        if(!finishing && Date.now()>=deadline)throw operationTimeout();
    };
    const serial=value=>JSON.parse(JSON.stringify(value));
    const evidence=()=>({...verification,requestedGapIds:input.gapIds,attempts,aiUsage:budget.snapshot(),goal:{...coverageGoal(best?.report || baseline),maxRounds:limits.maxRounds,stopReason:finishing?stopReason:null,acceptedRounds:attempts.filter(item=>item.state==='VERIFIED_IMPROVEMENT').length}});
    const budget=createAiJobBudget({maxRequests:limits.maxRequests,signal:lease.signal,assertActive,onChange:async()=>{
        await withOperationPublishGuard(tx=>tx.systemTestProposal.update({where:{jobId},data:{verificationJson:serial(evidence())}}));
    }});
    const optimize=options=>withAiJobBudget(budget,()=>optimizeSystemTest(options));
    const measure=options=>withAiJobBudget(budget,()=>assessSystemWorkspace({...options,stopOnFailure:true}));
    const stage=async(message,value)=>{
        await assertActive();progress=Math.max(progress,Math.min(99,Math.floor(value)));
        await updateJobProgress(jobId,progress);await addJobLog(jobId,'INFO',`Improvement stage: ${message}`);
    };
    try {
        await stage('Checking current source and test evidence',5);
        job.snapshot.rootDir=resolveSystemRepositoryRoot(job.snapshot.rootDir);
        await addJobLog(jobId,'INFO',`Using Gemini model: ${input.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash'}`);
        assessment=await prisma.systemTestAssessment.findFirst({where:{id:input.assessmentId,snapshotId:job.snapshotId,status:'COMPLETED'}});
        if(!assessment)throw new ServiceError('Current completed assessment required',409);
        const latest=await prisma.systemRequirementRevision.findFirst({where:{snapshotId:job.snapshotId,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
        if((latest?.id || null)!==assessment.requirementRevisionId)throw new ServiceError('Requirement revision changed; assess again',409);
        identity=snapshotIdentity(job.snapshot.rootDir);
        if(identity.sourceHash!==assessment.sourceHash || identity.testHash!==assessment.testHash)throw new ServiceError('Assessment is stale',409);
        before=fs.readFileSync(containedPath(job.snapshot.rootDir,input.filePath),'utf8');
        if(digest(before)!==input.expectedTestHash)throw new ServiceError('Test changed since review',409);
        if(input.gapIds.some(id=>!assessment.reportJson.gaps.some(gap=>gap.id===id)))throw new ServiceError('Selected gap is not in this assessment',400);
        const previous=await findPreviousImprovementVerification({client:prisma,snapshotId:job.snapshotId,assessmentId:input.assessmentId,filePath:input.filePath,jobId});
        let feedback=buildImprovementRepairFeedback(previous?.verificationJson);
        revision=assessment.requirementRevisionId?await prisma.systemRequirementRevision.findFirst({where:{id:assessment.requirementRevisionId,snapshotId:job.snapshotId},include:{bindings:true}}):null;
        await withOperationPublishGuard(tx=>tx.systemTestProposal.update({where:{jobId},data:{state:'VERIFYING'}}));
        await stage('Measuring existing tests in two independent runs',10);
        baseline=await measure({rootDir:job.snapshot.rootDir,input:assessment.reportJson.input,jobId,signal:lease.signal,revision,bindings:revision?.bindings || [],onProgress:(message,value=0)=>stage(`Existing tests: ${message}`,10+value*0.15)});
        if(evaluateSystemImprovement({baseline,candidate:baseline}).reasonCode==='BASELINE_NOT_STABLE')throw new ServiceError('Existing tests must pass both independent runs without skipped or flaky tests before AI improvement',422);
        workspace=createAssessmentWorkspace({rootDir:job.snapshot.rootDir});
        const candidateFile=containedPath(workspace.rootDir,input.filePath);
        const scenarioId=scenario=>`${scenario.testFile}:${scenario.title}`;
        let workingContent=before,workingReport=baseline;
        for(let round=1;round<=limits.maxRounds;round++) {
            if(coverageGoal(workingReport).reached) {stopReason='TARGET_REACHED';break;}
            if(Date.now()>=deadline-limits.finishReserveMs) {stopReason='TIME_LIMIT';break;}
            if(budget.snapshot().requests>=limits.maxRequests) {stopReason='REQUEST_LIMIT';break;}
            const start=26+(round-1)*8;
            const gaps=prioritizeImprovementGaps(workingReport,{avoidIds:[...attemptedGaps]});
            for(const gap of gaps.slice(0,8))attemptedGaps.add(gap.id);
            const preservedScenarios=new Set(workingReport.runs.flatMap(run=>run.testRun.scenarios.map(scenarioId)));
            fs.writeFileSync(candidateFile,workingContent,'utf8');
            let candidate,runtimeFeedback;
            await stage(`Round ${round}/${limits.maxRounds}: targeting ${limits.target}% coverage`,start);
            try {
                const proposal=await optimize({model:input.model,rootDir:workspace.rootDir,filePath:input.filePath,instruction:JSON.stringify({gaps,instruction:input.instruction,executionMode:assessment.reportJson.input.executionMode,targetCoverage:limits.target,currentCoverage:coverageGoal(workingReport),round,maxRounds:limits.maxRounds,previousVerificationFailure:feedback})});
                if(proposal.promptBudget)await addJobLog(jobId,'INFO',`Round ${round} AI prompt: ${proposal.promptBudget.characters} characters; ${proposal.promptBudget.selectedGaps} focused gaps (not billed tokens).`);
                candidate=proposal.optimizedCode;
                preserveTestIntent(workingContent,candidate,input.filePath);
                let batch=validateAdditionalTestQuality(workingContent,candidate,input.filePath);
                if(batch.addedScenarios.length<1 || batch.addedScenarios.length>3)throw new ServiceError('Each candidate must add one to three scenarios with outcome assertions',422);
                fs.writeFileSync(candidateFile,candidate,'utf8');
                const verifyCandidate=(offset,span)=>measure({rootDir:workspace.rootDir,environmentRoot:job.snapshot.rootDir,input:assessment.reportJson.input,jobId,signal:lease.signal,revision,bindings:(revision?.bindings || []).map(binding=>binding.testFile===input.filePath?{...binding,testHash:digest(candidate)}:binding),onProgress:(message,value=0)=>stage(`Round ${round}/${limits.maxRounds}: ${message}`,start+offset+value*span/100)});
                let verified=await verifyCandidate(1,3);
                runtimeFeedback=buildImprovementRepairFeedback({candidate:verified});
                if(!best)verification={baseline,candidate:verified,...evaluateSystemImprovement({baseline,candidate:verified}),quality:batch,autoApply:Boolean(input.autoApply)};
                const originalFailed=verified.runs.some(run=>run.testRun.scenarios.some(s=>s.status!=='passed' && preservedScenarios.has(scenarioId(s))));
                const retained=!originalFailed && verified.stability.passedRuns!==2 ? retainPassedAdditionalTests(workingContent,candidate,input.filePath,verified) : null;
                if(retained){
                    await stage(`Round ${round}/${limits.maxRounds}: independently verifying passing additions`,start+4);
                    candidate=retained.content;batch=retained.quality;fs.writeFileSync(candidateFile,candidate,'utf8');
                    verified=await verifyCandidate(5,2);
                    runtimeFeedback=buildImprovementRepairFeedback({candidate:verified});
                }
                const failed=verified.runs.flatMap(run=>run.testRun.scenarios.filter(s=>['failed','timedOut','flaky'].includes(s.status)));
                if(verified.stability.passedRuns!==2 && failed.length && failed.every(s=>s.testFile===input.filePath && !preservedScenarios.has(scenarioId(s)))) {
                    await stage(`Round ${round}/${limits.maxRounds}: repairing failed new-test actions`,start+4);
                    const repair=await optimize({model:input.model,rootDir:workspace.rootDir,filePath:input.filePath,mode:'FIX_BREAKPOINT',scenarioData:buildImprovementRepairFeedback({candidate:verified}),instruction:JSON.stringify({gaps,executionMode:assessment.reportJson.input.executionMode,instruction:'Repair only failed additional test actions and missing source-supported data preconditions. Keep all original and already accepted scenarios and every candidate assertion/expected outcome unchanged. Use actual source-backed controls and APIs; no conditional fallbacks.'})});
                    preserveTestIntent(candidate,repair.optimizedCode,input.filePath,'FIX_BREAKPOINT');
                    preserveTestIntent(workingContent,repair.optimizedCode,input.filePath);
                    validateAdditionalTestQuality(workingContent,repair.optimizedCode,input.filePath);
                    candidate=repair.optimizedCode;fs.writeFileSync(candidateFile,candidate,'utf8');
                    verified=await verifyCandidate(5,2);
                }
                const evaluation=evaluateSystemImprovement({baseline:workingReport,candidate:verified});
                attempts.push({round,state:evaluation.state,reasonCode:evaluation.reasonCode,coverageDelta:evaluation.comparison.coverageDelta});
                await addJobLog(jobId,'INFO',`Round ${round}/${limits.maxRounds} result: ${evaluation.reasonCode || 'VERIFIED_COVERAGE_GAIN'}`);
                if(evaluation.accepted) {
                    best={content:candidate,report:verified};workingContent=candidate;workingReport=verified;noGain=0;
                    verification={baseline,candidate:verified,...evaluateSystemImprovement({baseline,candidate:verified}),quality:validateAdditionalTestQuality(before,candidate,input.filePath),autoApply:Boolean(input.autoApply)};
                } else {
                    noGain++;
                    if(!best)verification={baseline,candidate:verified,...evaluation,quality:batch,autoApply:Boolean(input.autoApply)};
                }
                feedback={...buildImprovementRepairFeedback({baseline,candidate:verified,...evaluation}),coverageDelta:evaluation.comparison.coverageDelta,remainingGaps:prioritizeImprovementGaps(workingReport)};
            } catch(error) {
                if(error.statusCode!==422)throw error;
                const message=String(error.message).slice(0,1200);noGain++;
                attempts.push({round,state:'FAILED_VERIFICATION',reasonCode:'CANDIDATE_INVALID',message});
                if(!best)verification={...verification,baseline,accepted:false,autoApply:Boolean(input.autoApply),state:'FAILED_VERIFICATION',reasonCode:'CANDIDATE_INVALID',error:{message}};
                feedback={...runtimeFeedback,reason:message,reasonCode:'CANDIDATE_INVALID',rejectedAdditionalTests:(error.rejectedAdditionalTests || candidate || '').slice(-6000)};
                await addJobLog(jobId,'WARN',`Round ${round}/${limits.maxRounds} rejected: ${message}`);
                if(error.code==='AI_JOB_BUDGET_EXCEEDED') {stopReason='REQUEST_LIMIT';break;}
            }
            await withOperationPublishGuard(tx=>tx.systemTestProposal.update({where:{jobId},data:{verificationJson:serial(evidence()),...(best?{proposedContent:best.content,candidateTestHash:digest(best.content)}:{})}}));
            if(noGain>=limits.maxNoGainRounds) {stopReason='NO_FURTHER_GAIN';break;}
        }
    } catch(caught) {
        const error=lease.signal?.aborted?operationAbortReason(lease.signal):caught;
        const current=await getJobById(jobId);
        if(current.status==='CANCELED') {
            finishing=true;stopReason='CANCELED';
            await prisma.systemTestProposal.updateMany({where:{jobId,state:{notIn:['APPLIED','RECOVERY_REQUIRED']}},data:{state:'CANCELED',verificationJson:serial({...evidence(),baseline})}});workspace?.release();return;
        }
        const failure=improvementFailure(error);
        const boundedStop=['TIME_LIMIT','PROVIDER_LIMIT','CONTEXT_LIMIT','SETUP_FAILED'].includes(failure.stopReason);
        if(best && boundedStop) {
            stopReason=failure.stopReason;
            verification.stopDetail={code:error.code,message:error.statusCode?error.message:'Verification stopped'};
        } else {
            finishing=true;stopReason=failure.stopReason;
            await prisma.systemTestProposal.updateMany({where:{jobId,state:{notIn:['APPLIED','RECOVERY_REQUIRED']}},data:{state:failure.state,verificationJson:serial({...evidence(),baseline,error:{code:error.code,message:error.statusCode?error.message:'Verification could not finish. Check the job log.',details:error.details,resetAt:error.resetAt,retryAt:error.retryAt,model:error.model}})}});
            await markJobFailed(jobId,error);workspace?.release();throw error;
        }
    }
    try {
        finishing=true;
        if(best && coverageGoal(best.report).reached)stopReason='TARGET_REACHED';
        await stage('Comparing best verified tests and coverage target',96);
        const current=snapshotIdentity(job.snapshot.rootDir);
        if(current.sourceHash!==identity.sourceHash || current.testHash!==identity.testHash)throw new ServiceError('Snapshot changed during proposal verification',409);
        if(!verification)verification={baseline,accepted:false,state:'NO_MEASURED_IMPROVEMENT',reasonCode:coverageGoal(baseline).reached?'TARGET_ALREADY_REACHED':'NO_COVERAGE_GAIN',autoApply:Boolean(input.autoApply)};
        if(best)await withOperationPublishGuard(tx=>tx.systemTestProposal.update({where:{jobId},data:{proposedContent:best.content,candidateTestHash:digest(best.content)}}));
        await withOperationPublishGuard(tx=>tx.systemTestProposal.update({where:{jobId},data:{state:verification.state,verificationJson:serial(evidence())}}));
        if(input.autoApply && best) {
            await stage('Saving the best execution-verified tests',97);
            const saved=await prisma.systemTestProposal.findUnique({where:{jobId}});
            const commitLease={assertHeld:assertActive};
            await applySystemProposal({rootDir:job.snapshot.rootDir,snapshotId:job.snapshotId,proposalId:saved.id,expectedCurrentTestHash:digest(before),expectedCandidateTestHash:digest(best.content),userId:job.userId,lease:commitLease});
            await stage('Publishing verified coverage measurements',99);
            const published=await publishAppliedAssessment({job,report:best.report,input:assessment.reportJson.input,requirementRevisionId:assessment.requirementRevisionId});
            await withOperationPublishGuard(tx=>tx.systemTestProposal.update({where:{jobId},data:{verificationJson:serial({...evidence(),publishedAssessmentId:published.id})}}));
        }
        await markJobSuccess(jobId,{state:verification.state,goal:coverageGoal(best?.report || baseline),stopReason});
    } catch(error) {
        const current=await getJobById(jobId);
        if(current.status==='CANCELED') {
            stopReason='CANCELED';
            await prisma.systemTestProposal.updateMany({where:{jobId,state:{notIn:['APPLIED','RECOVERY_REQUIRED']}},data:{state:'CANCELED',verificationJson:serial(evidence())}});
            return;
        }
        await prisma.systemTestProposal.updateMany({where:{jobId,state:{notIn:['APPLIED','RECOVERY_REQUIRED']}},data:{state:isStaleImprovementError(error)?'STALE':'FAILED_VERIFICATION',verificationJson:serial({...evidence(),error:{code:error.code,message:error.message}})}});
        await markJobFailed(jobId,error);throw error;
    } finally {workspace?.release();}
};

export const applySystemProposal = async ({ client = prisma, rootDir, snapshotId, proposalId, expectedCurrentTestHash, expectedCandidateTestHash, userId, lease }) => {
    const {snapshot} = await resolveSnapshotAccess({snapshotId,userId,capability:'evidence.approve',db:client});
    const proposal = await client.systemTestProposal.findFirst({ where: { id: proposalId, snapshotId }, include: { assessment: true } });
    if (!proposal) throw new ServiceError('Proposal not found', 404);
    if (proposal.state === 'APPLIED') return proposal;
    if (proposal.state !== 'VERIFIED_IMPROVEMENT') throw new ServiceError('Proposal has no verified coverage improvement', 409);
    const evidence = proposal.verificationJson;
    if (!evidence?.baseline || !evidence?.candidate || !evaluateSystemImprovement(evidence).accepted) throw new ServiceError('Proposal requires passing runs and a measured coverage gain without regression',409);
    rootDir = resolveSystemRepositoryRoot(operationSnapshot(snapshot).rootDir);
    const target = containedPath(rootDir,proposal.filePath);
    const operation = currentProjectOperation();
    const relativePath = path.relative(operation?.preparedPublications ? operation.rootDir : projectEditableWorkspaceRoot(snapshot),target).replaceAll('\\','/');
    const base = await readVersionedProjectFile({projectId:snapshot.projectId,snapshotId,userId,path:relativePath,db:client});
    const before = base.content, identity = snapshotIdentity(rootDir);
    if(client.systemRequirementRevision) {
        const latest=await client.systemRequirementRevision.findFirst({where:{snapshotId,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
        if((latest?.id || null) !== (proposal.assessment.requirementRevisionId || null)) throw new ServiceError('Requirement revision changed; verify again',409);
    }
    if (digest(before) !== expectedCurrentTestHash || expectedCurrentTestHash !== proposal.baseTestHash || digest(proposal.proposedContent) !== expectedCandidateTestHash || expectedCandidateTestHash !== proposal.candidateTestHash || identity.sourceHash !== proposal.assessment.sourceHash || identity.testHash !== proposal.assessment.testHash) throw new ServiceError('Proposal or snapshot changed; verify again', 409);
    preserveTestIntent(before,proposal.proposedContent,proposal.filePath);
    const quality = validateAdditionalTestQuality(before,proposal.proposedContent,proposal.filePath);
    if (!quality.addedScenarios.length) throw new ServiceError('Proposal must add tests with outcome assertions',409);
    await lease.assertHeld();
    if (base.version.sha256 !== expectedCurrentTestHash) throw new ServiceError('Test changed after verification; review again',409);
    if (operation?.preparedPublications) {
        await assertProjectOperationActive(operation);
        fs.writeFileSync(target,proposal.proposedContent,'utf8');
        await stagePreparedPublication(tx=>tx.systemTestProposal.update({where:{id:proposal.id},data:{state:'APPLIED',appliedAt:new Date(),appliedByUserId:userId}}));
        return {...proposal,state:'APPLIED'};
    }
    const saved = await mutateProjectWorkspace({projectId:snapshot.projectId,snapshotId,userId,path:relativePath,
        content:proposal.proposedContent,kind:'APPLY_TEST',capability:'evidence.approve',expectedVersion:base.version,
        expectedWorkspaceRevision:base.workspaceRevision,requestId:`system-proposal-${proposalId}`,db:client,
        afterMutation:async tx => {
            await lease.assertHeld();
            return tx.systemTestProposal.update({where:{id:proposal.id},data:{state:'APPLIED',appliedAt:new Date(),appliedByUserId:userId}});
        }});
    return saved.mutationResult;

};
