const list = value => Array.isArray(value) ? value : [];
const key = row => `${row.filePath || row.testFile || ''}\0${row.title || ''}`;
const unknownCoverage = () => ({ status: 'NOT_MEASURED', counters: null, reasonCodes: ['NO_RUN_INSTRUMENTATION'] });
const observation = items => ({ status: items.length ? 'OBSERVED' : 'NOT_CAPTURED', items, observed: items.length, total: null, pct: null });

// Project saved facts only. Never consult today's catalog to explain an old run.
export const buildSystemReportProjection = ({ assessment = {}, report = assessment.reportJson || {}, artifacts = [], scenarioSnapshot = report.scenarioSnapshot } = {}) => {
    const runs = list(report.runs);
    const catalog = list(scenarioSnapshot);
    const identities = new Map();
    for (const row of catalog) identities.set(row.scenarioKey || key(row), row);
    if (!catalog.length) for (const run of runs) for (const row of list(run.testRun?.scenarios)) {
        if (!identities.has(key(row))) identities.set(key(row), { ...row, filePath: row.testFile });
    }
    const counts = { selected: identities.size, executed: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, blocked: 0, canceled: 0, notRun: 0, elapsedMs: null };
    const requiredRuns = report.input?.repeatRuns || 2;
    let consistent = 0, inconsistent = 0;
    const scenarios = [...identities.entries()].map(([identity, row]) => {
        const attempts = runs.map(run => {
            const matches = list(run.testRun?.scenarios).filter(result => key(result) === key(row));
            const result = matches.length === 1 ? matches[0] : null;
            return { runIndex: run.index, testRunId: run.testRunId || null, status: result?.status || 'notRun', durationMs: result?.durationMs ?? null, errors: list(result?.failureMessages), apiCalls: list(result?.apiCalls), executionDetails: result?.executionDetails || null };
        });
        const statuses = attempts.map(item => item.status);
        const complete = attempts.length === requiredRuns && statuses.every(status => !['notRun', 'interrupted'].includes(status));
        const differs = new Set(statuses).size > 1 || statuses.includes('flaky');
        if (complete) { if (differs) inconsistent++; else consistent++; }
        let status = 'notRun';
        if (statuses.some(value => ['canceled', 'interrupted'].includes(value))) status = 'canceled';
        else if (statuses.includes('flaky') || (statuses.includes('failed') && statuses.includes('passed'))) status = 'flaky';
        else if (statuses.includes('failed')) status = 'failed';
        else if (statuses.length && statuses.every(value => value === 'skipped')) status = 'skipped';
        else if (complete && statuses.every(value => value === 'passed')) status = 'passed';
        else if (statuses.length) status = 'blocked';
        counts[status]++;
        if (statuses.some(value => ['passed', 'failed', 'flaky'].includes(value))) counts.executed++;
        const verdict = list(report.scenarioVerdicts).find(item => row.scenarioKey ? item.scenarioKey === row.scenarioKey : key(item) === key(row));
        return { scenarioKey: row.scenarioKey || identity, id: row.id || null, filePath: row.filePath, title: row.title, reviewState: row.reviewState || 'UNKNOWN', flow: list(row.flowJson), inputs: list(row.inputJson), expected: list(row.expectedJson), executionStatus: status, qualityStatus: verdict?.qualityStatus || 'UNVERIFIED', attempts, artifacts: artifacts.filter(item => item.scenarioKey === row.scenarioKey && row.scenarioKey) };
    });
    const times = runs.flatMap(run => [Date.parse(run.testRun?.startedAt), Date.parse(run.testRun?.finishedAt)]).filter(Number.isFinite);
    if (times.length >= 2) counts.elapsedMs = Math.max(...times) - Math.min(...times);
    const calls = new Map();
    for (const scenario of scenarios) for (const attempt of scenario.attempts) for (const call of attempt.apiCalls) {
        if (call.method && call.path) calls.set(`${call.method} ${call.path}`, { method: call.method, path: call.path });
    }
    const requirements = report.requirements || { status: 'NOT_MEASURED', total: null, designed: null, verified: null, criteria: [] };
    return {
        schemaVersion: 2,
        identity: { assessmentId: assessment.id || null, snapshotId: assessment.snapshotId || null, suiteVersionId: assessment.suiteVersionId || report.suiteVersionId || null, sourceHash: report.sourceHash || assessment.sourceHash || null, testHash: report.testHash || assessment.testHash || null, requirementRevisionId: assessment.requirementRevisionId || report.requirementRevisionId || null, runner: report.runner || assessment.runner || null, executionMode: report.executionMode || assessment.executionMode || null, createdAt: assessment.createdAt || null },
        execution: counts,
        stability: { status: runs.length < requiredRuns ? 'NOT_MEASURED' : inconsistent ? 'INCONSISTENT' : consistent === scenarios.length && scenarios.length ? 'OBSERVED_CONSISTENT' : 'INCOMPLETE', requiredRuns, completedRuns: runs.length, consistent, inconsistent },
        requirements,
        coverage: { frontend: report.coverage?.tiers?.frontend || unknownCoverage(), backend: report.coverage?.tiers?.backend || unknownCoverage() },
        observations: { routes: observation([]), apiEndpoints: observation([...calls.values()]), inventoryStatus: 'PARTIAL' },
        qualityScore: report.qualityScore?.status === 'CALCULATED' ? report.qualityScore : { status: 'NOT_CALCULATED', value: null, reason: report.qualityScore?.reason || 'REVIEWED_REQUIREMENTS_AND_COMPLETE_EVIDENCE_REQUIRED' },
        comparison:report.comparison || null,
        scenarios:scenarios.sort((a,b)=>({failed:0,flaky:1,blocked:2,canceled:3,notRun:4,skipped:5,passed:6}[a.executionStatus]-{failed:0,flaky:1,blocked:2,canceled:3,notRun:4,skipped:5,passed:6}[b.executionStatus])), gaps: list(report.workflowGaps || report.gaps), limitations: [...list(report.limitations), ...(artifacts.some(item=>!item.runIndex) ? ['Some legacy artifacts have no independent run identity and do not count as complete repeat evidence.'] : []), ...(!catalog.length ? ['Legacy scenario review metadata is unavailable.'] : [])], generatedWith: report.generation || (report.aiUsage ? {usage:report.aiUsage} : null),
    };
};

export const projectSystemAssessment = (assessment,{artifacts=[]}={}) => {
    if(!assessment)return null;
    const presentation=assessment.reportJson?.presentation || buildSystemReportProjection({assessment,artifacts});
    const currentArtifacts=new Map(artifacts.map(item=>[item.id,item]));
    const scenarios=presentation.scenarios.map(row=>({...row,artifacts:row.artifacts.map(item=>currentArtifacts.has(item.id)?{...item,...currentArtifacts.get(item.id)}:item)}));
    return {...assessment,presentation:{...presentation,scenarios,identity:{...presentation.identity,assessmentId:assessment.id,snapshotId:assessment.snapshotId,createdAt:assessment.createdAt}}};
};
