import {compareSystemAssessments} from './systemAssessment.service.js';

const metrics = ['lines', 'branches', 'functions', 'statements'];
const scenarioId = scenario => `${scenario.testFile}:${scenario.title}`;
const passedTwice = report => report?.stability?.passedRuns === 2 && report.runs?.length === 2 && report.runs.every(run =>
    run.testRun?.status === 'PASSED' && !run.testRun.skippedTests && !run.testRun.flakyTests &&
    run.testRun.scenarios?.length > 0 && run.testRun.scenarios.every(scenario => scenario.status === 'passed'));

export const evaluateSystemImprovement = ({baseline, candidate}) => {
    const comparison = compareSystemAssessments({baseline, candidate});
    const original = new Set((baseline.runs || []).flatMap(run => (run.testRun?.scenarios || []).filter(s => s.status === 'passed').map(scenarioId)));
    const regression = (candidate.runs || []).some(run => [...original].some(id => !(run.testRun?.scenarios || []).some(s => scenarioId(s) === id && s.status === 'passed')));
    const coverageChanges = {};
    let lostMeasurement = false;
    for (const tier of ['frontend', 'backend']) {
        const before = baseline.coverage?.tiers?.[tier], after = candidate.coverage?.tiers?.[tier];
        if (before?.status !== 'MEASURED') continue;
        if (after?.status !== 'MEASURED') { lostMeasurement = true; continue; }
        coverageChanges[tier] = {};
        for (const metric of metrics) {
            const b = before.counters?.[metric], a = after.counters?.[metric];
            if (!b || !a || b.total !== a.total) { lostMeasurement = true; continue; }
            coverageChanges[tier][metric] = {
                before: b.pct, after: a.pct,
                percentagePoints: Number.isFinite(b.pct) && Number.isFinite(a.pct) ? Number((a.pct - b.pct).toFixed(2)) : null,
                coveredDelta: a.covered - b.covered, total: b.total,
            };
        }
    }
    const deltas = Object.values(comparison.coverageDelta || {}).flatMap(tier => Object.values(tier));
    const coverageRegression = deltas.some(delta => delta < 0);
    let reasonCode = null;
    if (!passedTwice(baseline)) reasonCode = 'BASELINE_NOT_STABLE';
    else if (!passedTwice(candidate)) reasonCode = 'CANDIDATE_NOT_STABLE';
    else if (regression) reasonCode = 'SCENARIO_REGRESSION';
    else if (!comparison.comparable || lostMeasurement) reasonCode = 'INCOMPARABLE_MEASUREMENTS';
    else if (coverageRegression) reasonCode = 'COVERAGE_REGRESSION';
    else if (!deltas.some(delta => delta > 0)) reasonCode = 'NO_COVERAGE_GAIN';
    const accepted = reasonCode === null;
    return {
        accepted, reasonCode, regression, coverageRegression, comparison,
        coverageChanges: comparison.comparable && !lostMeasurement ? coverageChanges : {},
        state: accepted ? 'VERIFIED_IMPROVEMENT' : reasonCode === 'NO_COVERAGE_GAIN' ? 'NO_MEASURED_IMPROVEMENT' : 'FAILED_VERIFICATION',
    };
};
