import fs from 'node:fs';
import prisma from '../config/prisma.js';
import { withOperationPublishGuard,stagePreparedPublication } from './projectOperationWorkspace.service.js';
import { containedPath } from './fullSystemConfig.service.js';
import { createAssessmentWorkspace, snapshotIdentity } from './systemAssessmentWorkspace.service.js';
import { assessSystemWorkspace } from './systemAssessmentJob.service.js';
import { enumerateMutations, classifyMutation } from './systemMutation.service.js';
import { getJobById, markJobRunning, markJobSuccess, markJobFailed } from './job.service.js';
import { ServiceError } from '../utils/serviceError.js';

export const processSystemMutationJob = async (jobId, lease) => {
    await markJobRunning(jobId);
    const job = await getJobById(jobId), input = JSON.parse(job.payloadJson);
    try {
        await withOperationPublishGuard(tx=>tx.systemMutationRun.update({where:{jobId},data:{state:'RUNNING'}}));
        if (process.env.SYSTEM_MUTATION_TRUSTED_LOCAL !== 'true') throw new ServiceError('Mutation requires an explicitly configured trusted local execution environment', 409);
        const assessment = await prisma.systemTestAssessment.findFirst({ where: { id: input.assessmentId, snapshotId: job.snapshotId, status: 'COMPLETED' } });
        if (!assessment) throw new ServiceError('Assessment not found', 404);
        const latestRevision=await prisma.systemRequirementRevision.findFirst({where:{snapshotId:job.snapshotId,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
        if((latestRevision?.id || null) !== assessment.requirementRevisionId) throw new ServiceError('Requirement revision changed; assess again',409);
        const current = snapshotIdentity(job.snapshot.rootDir);
        if(current.sourceHash !== assessment.sourceHash || current.testHash !== assessment.testHash) throw new ServiceError('Assessment source or test has changed',409);
        const revision = assessment.requirementRevisionId ? await prisma.systemRequirementRevision.findFirst({ where: { id: assessment.requirementRevisionId, snapshotId: job.snapshotId }, include: { bindings: true } }) : null;
        const options = assessment.reportJson.input;
        const baseline = await assessSystemWorkspace({ rootDir: job.snapshot.rootDir, input: { ...options, repeatRuns: 3 }, jobId, signal:lease.signal, revision, bindings: revision?.bindings || [] });
        if (baseline.stability.passedRuns !== 3) throw new ServiceError('Mutation baseline must pass three independent runs without skips or retries', 409);
        const targets = baseline.mutationTargets || [];
        const selected = targets.filter(target => input.targetIds.includes(target.id));
        if (selected.length !== input.targetIds.length || !selected.length || selected.length > 10) throw new ServiceError('Invalid mutation target selection', 400);
        const results = [];
        for (const target of selected) {
            await lease.assertHeld();
            const workspace = createAssessmentWorkspace({ rootDir: job.snapshot.rootDir });
            try {
                const file = containedPath(workspace.rootDir, target.filePath), source = fs.readFileSync(file, 'utf8');
                const current = enumerateMutations({ content: source, filePath: target.filePath }).find(m => m.id === target.id);
                if (!current) throw new ServiceError('Mutation target source changed', 409);
                const marked = `((globalThis.__covaiMutations ||= new Set()).add(${JSON.stringify(target.id)}),(${current.replacement}))`;
                fs.writeFileSync(file, source.slice(0, current.start) + marked + source.slice(current.end), 'utf8');
                const report = await assessSystemWorkspace({ rootDir: workspace.rootDir, input: { ...options, repeatRuns: 1 }, jobId, signal:lease.signal, revision, bindings: revision?.bindings || [] });
                const measured = report.coverage.tiers.backend;
                const covered = measured?.files?.find(f => f.filePath === target.filePath);
                const targetExecuted = measured?.status === 'MEASURED' && covered ? report.runs[0].mutationActivations.includes(target.id) : undefined;
                const failures = report.runs.flatMap(run => run.criterionEvidence.filter(e => e.events.some(event => event.outcome === 'failed')).map(e => ({ bindingId: e.bindingId })));
                // Relevant bindings must be explicitly selected/reviewed for the fault target; no inference from titles.
                const bindingIds = input.targetBindings[target.id];
                const cleanPass = report.stability.passedRuns === 1;
                const classification = !cleanPass && !failures.length ? { status: 'AMBIGUOUS', reasonCodes: ['NON_ASSERTION_TEST_FAILURE'] } : classifyMutation({ startupHealthy: true, activated: Boolean(covered), targetExecuted, assertionFailures: failures, approvedTargetBindingIds: bindingIds });
                results.push({ ...target, ...classification, report });
            } catch (error) { results.push({ ...target, status: 'INFRA_ERROR', reasonCodes: [error.message.slice(0, 300)] }); }
            finally { workspace.release(); }
        }
        await lease.assertHeld();
        const evaluated = results.filter(r => ['KILLED_ASSERTION', 'SURVIVED', 'NOT_EXERCISED'].includes(r.status));
        const killed = results.filter(r => r.status === 'KILLED_ASSERTION').length;
        const resultJson = { requested: selected.length, evaluated: evaluated.length, killed, detectedPct: evaluated.length ? 100 * killed / evaluated.length : null, results, limitations: ['Ratio applies only to the evaluated, selected faults; unresolved results are excluded and listed.'] };
        await stagePreparedPublication(tx=>tx.systemMutationRun.update({ where: { jobId }, data: { state: 'COMPLETED', resultJson: JSON.parse(JSON.stringify(resultJson)) } }));
        await markJobSuccess(jobId, resultJson);
    } catch (error) { await prisma.systemMutationRun.updateMany({ where: { jobId }, data: { state: 'FAILED' } }); await markJobFailed(jobId, error); throw error; }
};
