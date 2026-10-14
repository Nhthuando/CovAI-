import { requirementCoverage } from './systemRequirement.service.js';
import { digest } from './systemTestStaticAnalysis.service.js';
import { canCompareAssessments } from './systemAssessmentContract.service.js';

export const buildSystemAssessment = ({ identity, coverage, revision, bindings, staticAnalysis, runs, mutations = null }) => {
    const activeBindings = bindings.filter(binding => staticAnalysis.some(file => file.filePath === binding.testFile && file.testHash === binding.testHash && file.assertionSites.some(site => site.id === binding.assertionId && site.supported)));
    const requirements = requirementCoverage({ revision, bindings: activeBindings, runs });
    const gaps = [];
    for (const [tier, measurement] of Object.entries(coverage.tiers || {})) if (measurement.status === 'MEASURED') for (const file of measurement.files || []) for (const line of file.uncoveredLines) gaps.push({ id: digest(`${tier}:${file.filePath}:${line}`), kind: 'MEASURED_UNCOVERED_LINE', tier, filePath: file.filePath, line, description: 'Source line has no execution hits in the measured AUT lifecycle scope.' });
    for (const criterion of requirements.criteria) if (!criterion.verified) gaps.push({ id: `requirement:${criterion.id}`, kind: 'CONFIRMED_REQUIREMENT', criterionId: criterion.id, description: criterion.description, expectedOutcome: criterion.expectedOutcome });
    for (const file of staticAnalysis) for (const finding of file.findings) gaps.push({ ...finding, kind: 'STATIC_FINDING', description: finding.message });
    return { schemaVersion: 1, ...identity, coverage, requirements, staticAnalysis, runs, mutations, gaps, stability: { status: runs.length > 1 ? 'OBSERVED_REPEATS' : 'NOT_MEASURED', runs: runs.length, passedRuns: runs.filter(run => run.testRun.status === 'PASSED' && !run.testRun.skippedTests && !run.testRun.flakyTests).length }, limitations: ['Source coverage records execution, not assertion correctness.', 'Requirement verification refers to owner-confirmed expected outcomes and reviewed bindings.', 'Coverage includes AUT startup. No per-scenario contribution is inferred.'] };
};
export const compareSystemAssessments = ({ baseline, candidate }) => {
    const comparison = canCompareAssessments(baseline, candidate);
    const coverageDelta = {};
    if (comparison.comparable) for (const tier of ['frontend', 'backend']) {
        const before = baseline.coverage.tiers[tier], after = candidate.coverage.tiers[tier];
        if (before?.status !== 'MEASURED' || after?.status !== 'MEASURED') continue;
        coverageDelta[tier] = {};
        for (const key of ['lines', 'branches', 'functions', 'statements']) {
            const b = before.counters[key], a = after.counters[key];
            if (a.total !== b.total) { comparison.comparable = false; comparison.reasonCodes.push('DIFFERENT_COUNTER_DENOMINATOR'); continue; }
            coverageDelta[tier][key] = a.covered - b.covered;
        }
    }
    return { ...comparison, coverageDelta: comparison.comparable ? coverageDelta : {}, newlyVerifiedCriterionIds: comparison.comparable ? candidate.requirements.criteria.filter(c => c.verified && !baseline.requirements.criteria.some(b => b.id === c.id && b.verified)).map(c => c.id) : [] };
};
