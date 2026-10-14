import fs from 'node:fs';
import path from 'node:path';
import prisma from '../config/prisma.js';
import { containedPath } from './fullSystemConfig.service.js';
import { createAssessmentWorkspace, snapshotIdentity } from './systemAssessmentWorkspace.service.js';
import { digest, preserveTestIntent } from './systemTestStaticAnalysis.service.js';
import { optimizeSystemTest } from './systemTestBooster.service.js';
import { assessSystemWorkspace } from './systemAssessmentJob.service.js';
import { compareSystemAssessments } from './systemAssessment.service.js';
import { getJobById, markJobRunning, markJobSuccess, markJobFailed } from './job.service.js';
import { ServiceError } from '../utils/serviceError.js';

export const processSystemImprovementJob = async (jobId, lease) => {
    await markJobRunning(jobId);
    const job = await getJobById(jobId), input = JSON.parse(job.payloadJson);
    let workspace;
    try {
        const assessment = await prisma.systemTestAssessment.findFirst({ where: { id: input.assessmentId, snapshotId: job.snapshotId, status: 'COMPLETED' } });
        if (!assessment) throw new ServiceError('Current completed assessment required', 409);
        const latestRevision=await prisma.systemRequirementRevision.findFirst({where:{snapshotId:job.snapshotId,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
        if((latestRevision?.id || null) !== assessment.requirementRevisionId) throw new ServiceError('Requirement revision changed; assess again',409);
        const identity = snapshotIdentity(job.snapshot.rootDir);
        if (identity.sourceHash !== assessment.sourceHash || identity.testHash !== assessment.testHash) throw new ServiceError('Assessment is stale', 409);
        const file = containedPath(job.snapshot.rootDir, input.filePath), before = fs.readFileSync(file, 'utf8');
        if (digest(before) !== input.expectedTestHash) throw new ServiceError('Test changed since review', 409);
        const gaps = assessment.reportJson.gaps.filter(g => input.gapIds.includes(g.id));
        if (gaps.length !== input.gapIds.length) throw new ServiceError('Selected gap is not in this assessment', 400);
        const proposal = await optimizeSystemTest({ rootDir: job.snapshot.rootDir, filePath: input.filePath, instruction: JSON.stringify({ gaps, instruction: input.instruction }) });
        const candidate = proposal.optimizedCode;
        preserveTestIntent(before, candidate, input.filePath);
        await prisma.systemTestProposal.update({ where: { jobId }, data: { state: 'VERIFYING', proposedContent: candidate, candidateTestHash: digest(candidate) } });
        const revision = assessment.requirementRevisionId ? await prisma.systemRequirementRevision.findFirst({ where: { id: assessment.requirementRevisionId, snapshotId: job.snapshotId }, include: { bindings: true } }) : null;
        const baseline = await assessSystemWorkspace({ rootDir: job.snapshot.rootDir, input: assessment.reportJson.input, jobId, signal:lease.signal, revision, bindings: revision?.bindings || [], onProgress: () => lease.assertHeld() });
        workspace = createAssessmentWorkspace({ rootDir: job.snapshot.rootDir });
        fs.writeFileSync(containedPath(workspace.rootDir, input.filePath), candidate, 'utf8');
        const bindings = (revision?.bindings || []).map(binding => binding.testFile === input.filePath ? { ...binding, testHash: digest(candidate) } : binding);
        const verified = await assessSystemWorkspace({ rootDir: workspace.rootDir, environmentRoot: job.snapshot.rootDir, input: assessment.reportJson.input, jobId, signal:lease.signal, revision, bindings, onProgress: () => lease.assertHeld() });
        const comparison = compareSystemAssessments({ baseline, candidate: verified });
        const passed = verified.stability.passedRuns === 2;
        const baselinePassingScenarios = baseline.runs[0].testRun.scenarios.filter(s => s.status === 'passed').map(s => `${s.testFile}:${s.title}`);
        const regression = verified.runs.some(run => baselinePassingScenarios.some(id => !run.testRun.scenarios.some(s => `${s.testFile}:${s.title}` === id && s.status === 'passed')));
        const improved = comparison.comparable && Object.values(comparison.coverageDelta).some(tier => Object.values(tier).some(delta => delta > 0));
        const state = !passed || regression || !comparison.comparable ? 'FAILED_VERIFICATION' : improved ? 'VERIFIED_IMPROVEMENT' : 'NO_MEASURED_IMPROVEMENT';
        await lease.assertHeld();
        const current = snapshotIdentity(job.snapshot.rootDir);
        if (current.sourceHash !== identity.sourceHash || current.testHash !== identity.testHash) throw new ServiceError('Snapshot changed during proposal verification', 409);
        await prisma.systemTestProposal.update({ where: { jobId }, data: { state, verificationJson: JSON.parse(JSON.stringify({ baseline, candidate: verified, comparison, regression, autoApply: Boolean(input.autoApply), claim: improved ? 'AUT lifecycle source execution increased; no additional requirement correctness is inferred.' : 'No measured coverage improvement was established.' })) } });
        if (input.autoApply && ['VERIFIED_IMPROVEMENT', 'NO_MEASURED_IMPROVEMENT'].includes(state)) {
            const saved = await prisma.systemTestProposal.findUnique({where:{jobId}});
            await applySystemProposal({rootDir:job.snapshot.rootDir,snapshotId:job.snapshotId,proposalId:saved.id,expectedCurrentTestHash:digest(before),expectedCandidateTestHash:digest(candidate),userId:job.userId,lease});
        }
        await markJobSuccess(jobId, { state });
    } catch (error) { await prisma.systemTestProposal.updateMany({ where: { jobId, state: {notIn:['APPLIED','RECOVERY_REQUIRED']} }, data: { state: error.statusCode === 503 ? 'PROVIDER_UNAVAILABLE' : error.statusCode === 409 ? 'STALE' : 'FAILED_VERIFICATION' } }); await markJobFailed(jobId, error); throw error; }
    finally { workspace?.release(); }
};

export const applySystemProposal = async ({ client = prisma, rootDir, snapshotId, proposalId, expectedCurrentTestHash, expectedCandidateTestHash, userId, lease }) => {
    const proposal = await client.systemTestProposal.findFirst({ where: { id: proposalId, snapshotId }, include: { assessment: true } });
    if (!proposal) throw new ServiceError('Proposal not found', 404);
    if (proposal.state === 'APPLIED') return proposal;
    if (!['VERIFIED_IMPROVEMENT', 'NO_MEASURED_IMPROVEMENT'].includes(proposal.state)) throw new ServiceError('Proposal has not passed execution verification', 409);
    const target = containedPath(rootDir, proposal.filePath), before = fs.readFileSync(target, 'utf8'), identity = snapshotIdentity(rootDir);
    if(client.systemRequirementRevision) {
        const latest=await client.systemRequirementRevision.findFirst({where:{snapshotId,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
        if((latest?.id || null) !== (proposal.assessment.requirementRevisionId || null)) throw new ServiceError('Requirement revision changed; verify again',409);
    }
    if (digest(before) !== expectedCurrentTestHash || expectedCurrentTestHash !== proposal.baseTestHash || digest(proposal.proposedContent) !== expectedCandidateTestHash || expectedCandidateTestHash !== proposal.candidateTestHash || identity.sourceHash !== proposal.assessment.sourceHash || identity.testHash !== proposal.assessment.testHash) throw new ServiceError('Proposal or snapshot changed; verify again', 409);
    await lease.assertHeld();
    const temp = target + '.covai-apply.tmp';
    const journal = containedPath(rootDir, `.covai-system-test/proposals/${proposal.id}.json`);
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.writeFileSync(journal, JSON.stringify({ state: 'PREPARED', filePath: proposal.filePath, before, candidateHash: proposal.candidateTestHash }), 'utf8');
    fs.writeFileSync(temp, proposal.proposedContent, 'utf8');
    fs.renameSync(temp, target);
    try {
        const result = await client.systemTestProposal.update({ where: { id: proposal.id }, data: { state: 'APPLIED', appliedAt: new Date(), appliedByUserId: userId } });
        fs.writeFileSync(journal, JSON.stringify({ state: 'APPLIED', filePath: proposal.filePath, candidateHash: proposal.candidateTestHash }), 'utf8');
        return result;
    } catch (error) {
        try { fs.writeFileSync(temp, before, 'utf8'); fs.renameSync(temp, target); fs.unlinkSync(journal); }
        catch { await client.systemTestProposal.update({ where: { id: proposal.id }, data: { state: 'RECOVERY_REQUIRED' } }); }
        throw error;
    }
};
