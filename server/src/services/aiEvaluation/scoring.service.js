export const CRITERION_STATUSES = Object.freeze([
    'PASSED', 'FAILED', 'NOT_EVALUATED', 'NOT_APPLICABLE', 'INSUFFICIENT_EVIDENCE', 'ERROR',
]);

const scored = result => result.status === 'PASSED' || result.status === 'FAILED';
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Aggregate finalized criterion instances; repetitions must already be reduced per case. */
export function aggregateTrustProfile(results, policy) {
    if (!policy?.confirmed || !Number.isFinite(policy.threshold) || policy.threshold < 0 || policy.threshold > 100) {
        throw new Error('An explicitly confirmed scoring threshold between 0 and 100 is required');
    }
    const groups = new Map();
    const identities = new Set();
    for (const result of results) {
        if (!result.caseKey || !result.criterionKey || !result.taskType || !CRITERION_STATUSES.includes(result.status)) {
            throw new Error('Invalid criterion identity or status');
        }
        const identity = JSON.stringify([result.caseKey, result.criterionKey]);
        if (identities.has(identity)) throw new Error('Duplicate criterion instance; reduce repetitions before aggregation');
        identities.add(identity);
        if (!positive(result.caseWeight) || !positive(result.criterionWeight) || !positive(policy.taskWeights?.[result.taskType])) {
            throw new Error('Explicit positive case, criterion and task weights are required');
        }
        if (scored(result) && (!Number.isFinite(result.score) || result.score < 0 || result.score > 100)) {
            throw new Error('Scored criteria require a finite score between 0 and 100');
        }
        if (!scored(result) && result.score != null) throw new Error('Unscored criteria cannot contain a score');
        const group = groups.get(result.taskType) || [];
        group.push(result);
        groups.set(result.taskType, group);
    }
    const tasks = [...groups].map(([taskType, instances]) => {
        const applicable = instances.filter(result => result.status !== 'NOT_APPLICABLE');
        const evaluated = applicable.filter(scored);
        const denominator = evaluated.reduce((sum, result) => sum + result.caseWeight * result.criterionWeight, 0);
        return {
            taskType,
            score: denominator ? evaluated.reduce((sum, result) => sum + result.score * result.caseWeight * result.criterionWeight, 0) / denominator : null,
            scored: evaluated.length,
            applicable: applicable.length,
            partial: evaluated.length < applicable.length,
        };
    });
    const scoredTasks = tasks.filter(task => task.score !== null);
    const denominator = scoredTasks.reduce((sum, task) => sum + policy.taskWeights[task.taskType], 0);
    const score = denominator ? scoredTasks.reduce((sum, task) => sum + task.score * policy.taskWeights[task.taskType], 0) / denominator : null;
    const missingRequired = results.filter(result => result.required && result.status !== 'NOT_APPLICABLE' && !scored(result));
    const blockingFailures = results.filter(result => result.status === 'FAILED' && (result.blocking || result.seriousViolation));
    const verdict = blockingFailures.length ? 'FAILED' : missingRequired.length || score === null ? 'INCOMPLETE' : score >= policy.threshold ? 'PASSED' : 'FAILED';
    return {
        score, verdict, tasks, partial: tasks.some(task => task.partial),
        completeness: { scored: tasks.reduce((sum, task) => sum + task.scored, 0), applicable: tasks.reduce((sum, task) => sum + task.applicable, 0) },
        missingRequired: missingRequired.map(({ caseKey, criterionKey, status }) => ({ caseKey, criterionKey, status })),
        blockingFailures: blockingFailures.map(({ caseKey, criterionKey }) => ({ caseKey, criterionKey })),
    };
}
