import prisma from '../config/prisma.js';
import { randomUUID } from 'node:crypto';
import { currentProjectOperation,stagePreparedPublication } from './projectOperationWorkspace.service.js';

// Used by normal assessments and by the already measured, applied AI candidate.
export const persistAssessmentRuns = async input => {
    if (currentProjectOperation()?.preparedPublications) {
        const ids = input.report.runs.map(run=>{const id = randomUUID();run.testRunId = id;return id;});
        await stagePreparedPublication(tx=>persistAssessmentRunsNow({...input,client:tx,ids}));
        return ids.at(-1);
    }
    return persistAssessmentRunsNow(input);
};

const persistAssessmentRunsNow = async ({ report, snapshotId, executionMode, client = prisma,ids = [] }) => {
    let testRunId;
    for (const [index,run] of report.runs.entries()) {
        const value = run.testRun;
        const stored = await client.testRun.create({ data: {
            ...(ids[index] ? {id:ids[index]} : {}),
            snapshotId, type: 'PLAYWRIGHT', executionMode,
            totalTests:value.totalTests, passedTests:value.passedTests, failedTests:value.failedTests,
            flakyTests:value.flakyTests, skippedTests:value.skippedTests, durationMs:value.durationMs,
            status:value.status, startedAt:value.startedAt, finishedAt:value.finishedAt,
            systemMeasurement:run.measurement,
            scenarios:{create:(value.scenarios || []).map(s=>({
                title:s.title, suiteName:s.suiteName || null, status:s.status, durationMs:s.durationMs ?? null,
                failureMessages:s.failureMessages || [], testFile:s.testFile || null,
                screenshotPath:s.screenshotPath || null, failureStep:s.failureStep || null,
                failureCategory:s.failureCategory || null, failureCodeSnippet:s.failureCodeSnippet || null,
                domSnapshot:s.domSnapshot || null,
                ...(s.executionDetails ? {executionDetails:JSON.parse(JSON.stringify(s.executionDetails))} : {}),
            }))},
        } });
        run.testRunId = stored.id;
        testRunId = stored.id;
    }
    return testRunId;
};

export const publishAppliedAssessment = async input => {
    if (currentProjectOperation()?.preparedPublications) {
        const assessmentId = randomUUID();
        await stagePreparedPublication(tx=>publishAppliedAssessmentNow({...input,client:tx,assessmentId}));
        return {id:assessmentId};
    }
    return publishAppliedAssessmentNow(input);
};

const publishAppliedAssessmentNow = async ({ job, report, input, requirementRevisionId, client = prisma,assessmentId }) => {
    // A unique jobId makes publication idempotent. All records commit together.
    const publish = async tx => {
        const existing = await tx.systemTestAssessment.findUnique({where:{jobId:job.id}});
        if (existing) return existing;
        const testRunId = await persistAssessmentRunsNow({report, snapshotId:job.snapshotId, executionMode:input.executionMode, client:tx});
        return tx.systemTestAssessment.create({data:{
            ...(assessmentId ? {id:assessmentId} : {}),
            jobId:job.id, snapshotId:job.snapshotId, requirementRevisionId,
            runner:input.runner, executionMode:input.executionMode, status:'COMPLETED',
            sourceHash:report.sourceHash, testHash:report.testHash, scopeHash:report.scopeHash,
            testRunId, reportJson:JSON.parse(JSON.stringify({...report,input})),
        }});
    };
    return typeof client.$transaction === 'function' ? client.$transaction(publish) : publish(client);
};
