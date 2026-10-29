import { digest } from './systemTestStaticAnalysis.service.js';

export const deriveScenarioVerdict = ({ scenario, runs, requirements }) => {
    const attempts = runs.map(run => ({ runIndex: run.index, result: run.testRun.scenarios.find(item => item.testFile === scenario.filePath && item.title === scenario.title) })).filter(item => item.result);
    const statuses = attempts.map(item => item.result.status);
    const executionStatus = !attempts.length ? 'BLOCKED' : statuses.includes('failed') && !statuses.includes('passed') ? 'FAIL' : statuses.includes('flaky') || statuses.includes('failed') || statuses.includes('skipped') || attempts.length !== runs.length ? 'WEAK' : statuses.every(status => status === 'passed') ? 'PASS' : 'BLOCKED';
    const criteriaVerified = scenario.criterionIds?.length && scenario.criterionIds.every(id => requirements.criteria?.find(item => item.id === id)?.verified);
    const qualityStatus = executionStatus === 'WEAK' ? 'FLAKY' : scenario.reviewState !== 'REVIEWED' ? 'UNREVIEWED' : criteriaVerified ? 'STRONG' : 'UNVERIFIED';
    const reasons = [];
    if (attempts.length !== runs.length) reasons.push('MISSING_REPEAT_RESULT');
    if (statuses.includes('flaky') || new Set(statuses).size > 1) reasons.push('INCONSISTENT_REPEAT');
    if (scenario.reviewState !== 'REVIEWED') reasons.push('SCENARIO_REVIEW_REQUIRED');
    if (!criteriaVerified) reasons.push('EXPECTED_OUTCOME_NOT_VERIFIED');
    return { scenarioKey: scenario.scenarioKey, filePath: scenario.filePath, title: scenario.title, executionStatus, qualityStatus, attempts: attempts.map(({ runIndex, result }) => ({ runIndex, status: result.status, durationMs: result.durationMs })), reasons };
};

export const buildSystemGaps = ({ report, verdicts }) => {
    const gaps = [];
    for (const verdict of verdicts) {
        if (verdict.executionStatus === 'FAIL') gaps.push({ id: digest(`fail:${verdict.scenarioKey}`), kind: 'FAILED_BEHAVIOR', priority: 1, scenarioKey: verdict.scenarioKey, description: 'Actual behavior did not match the reviewed expected outcome', nextAction: 'Inspect the failed attempt and preserve its test as bug evidence' });
        else if (verdict.qualityStatus !== 'STRONG') gaps.push({ id: digest(`weak:${verdict.scenarioKey}`), kind: 'WEAK_ASSERTION', priority: 2, scenarioKey: verdict.scenarioKey, description: verdict.reasons.join(', '), nextAction: 'Review Input, Expected and an application outcome assertion' });
    }
    for (const criterion of report.requirements?.criteria || []) if (!criterion.verified) gaps.push({ id: `criterion:${criterion.id}`, kind: 'MISSING_CRITERION', priority: 1, criterionId: criterion.id, description: criterion.expectedOutcome, nextAction: 'Add or approve a scenario that checks this expected outcome' });
    for (const gap of report.gaps || []) if (gap.kind?.startsWith('MEASURED_UNCOVERED_')) gaps.push({ id: gap.id, kind: 'UNEXECUTED_SOURCE', priority: 3, tier: gap.tier, filePath: gap.filePath, line: gap.line, description: gap.description, nextAction: 'Add an interaction that executes this measured branch or line' });
    return gaps.sort((a, b) => a.priority - b.priority);
};

export const scoreSystemSuite = ({ report, catalog, verdicts, artifacts }) => {
    const criteria = report.requirements?.criteria || [];
    const reviewed = catalog.filter(item => item.reviewState === 'REVIEWED' && item.filePath);
    const independentRuns = report.runs || [];
    if (report.staticAnalysis?.some(file => file.unsupportedFeatures?.length)) return { status: 'NOT_CALCULATED', reason: 'UNSUPPORTED_ASSERTION_ANALYSIS' };
    if (!criteria.length || !reviewed.length || !independentRuns.length || !Array.isArray(artifacts)) return { status: 'NOT_CALCULATED', reason: 'CONFIRMED_CRITERIA_REVIEWED_SCENARIOS_RUNS_AND_ARTIFACT_MANIFEST_REQUIRED' };
    const executed = verdicts.filter(item => item.executionStatus !== 'BLOCKED');
    if (!executed.length) return { status: 'NOT_CALCULATED', reason: 'NO_EXECUTED_SCENARIOS' };
    const verifiedCriteria = criteria.filter(item => item.verified).length;
    const reviewedStrong = verdicts.filter(item => reviewed.some(scenario => scenario.scenarioKey === item.scenarioKey) && item.qualityStatus === 'STRONG').length;
    const cleanRuns = independentRuns.filter(run => run.testRun.status === 'PASSED' && !run.testRun.skippedTests && !run.testRun.flakyTests).length;
    const required = executed.flatMap(item => {
        const baseline = [{ scenarioKey: item.scenarioKey, kind: 'SCREENSHOT' }];
        if (item.executionStatus === 'FAIL') baseline.push({ scenarioKey: item.scenarioKey, kind: 'TRACE' }, { scenarioKey: item.scenarioKey, kind: 'SCREENSHOT' });
        return baseline;
    });
    let captured = 0;
    for (const requirement of required) {
        const scenario = catalog.find(item => item.scenarioKey === requirement.scenarioKey);
        const index = artifacts.findIndex(item => item.filePath === scenario?.filePath && item.title === scenario?.title && item.kind === requirement.kind);
        if (index >= 0) { captured++; artifacts = [...artifacts.slice(0, index), ...artifacts.slice(index + 1)]; }
    }
    const components = {
        requirements: 40 * verifiedCriteria / criteria.length,
        assertions: 25 * reviewedStrong / reviewed.length,
        stability: 20 * cleanRuns / independentRuns.length,
        evidence: 15 * captured / required.length,
    };
    return { status: 'CALCULATED', value: Math.round(Object.values(components).reduce((sum, value) => sum + value, 0)), components, counts: { verifiedCriteria, totalCriteria: criteria.length, reviewedStrong, reviewedScenarios: reviewed.length, cleanRuns, independentRuns: independentRuns.length, capturedArtifacts: captured, requiredArtifacts: required.length } };
};
