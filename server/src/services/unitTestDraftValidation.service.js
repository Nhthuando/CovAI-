import { withPreparedProjectWorkspace } from './projectWorkspacePreparation.service.js';

/** Run drafts in an operation copy. Validation never publishes files, coverage DB
 * rows or active versions. Missing env is returned as a blocker, not guessed. */
export async function validateUnitTestDraft({ projectId, snapshotId, userId, workspaceRevision, suggestions }) {
    const { applyUnitTestSuggestion } = await import('./applyTestSuggestion.service.js');
    try {
        const result = await withPreparedProjectWorkspace({ projectId, snapshotId, userId, capability: 'ai.use',
            expectedWorkspaceRevision: workspaceRevision, type: 'VALIDATE_UNIT_DRAFT', publish: false },
        () => applyUnitTestSuggestion({ projectId, snapshotId, userId, suggestions, validationOnly: true }));
        return { status: result.success ? 'VERIFIED_DRAFT' : result.status, draftCoverage: result.success ? result.newCoverage : null,
            measuredGain: result.success && result.newCoverage ? Object.fromEntries(Object.entries(result.newCoverage).map(([key,value]) => [key,value - (result.previousCoverage?.[key] || 0)])) : null,
            coverageGoalStatus: result.coverageGoalStatus || 'UNAVAILABLE', runId: result.runId,
            validationState: result.success ? 'BATCH_VERIFIED' : result.status,
            stopReason: result.refinement?.stopReason, message: result.message, environment: result.environment,
            expectationRepairs: (result.appliedSuggestions || []).flatMap(item => item.expectationRepairs || []),
            inputContractRepairs: (result.appliedSuggestions || []).flatMap(item => item.inputContractRepairs || []),
            baseline:result.baseline,
            files: result.validatedFiles || [] };
    } catch (error) {
        return { status: 'UNVERIFIED', measuredGain: null, coverageGoalStatus: 'UNAVAILABLE', message: error.message,
            ...(error.code === 'SOURCE_INTEGRITY_FAILED' ? { code: error.code, sourceIntegrity: error.details } : {}) };
    }
}
