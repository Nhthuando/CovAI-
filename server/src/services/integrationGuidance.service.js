import { getIntegrationAnalytics } from './integrationReport.service.js';

const withEvidenceData = (rules, analytics) => rules.map(rule => {
    const latest = analytics.latestExecution;
    const evidence = {
        RULE_NO_DATA: { scenarios: 0, testRuns: 0, coverageSummaries: 0 },
        RULE_NO_EXECUTION: { scenarios: analytics.overview?.totalScenarios || 0, testRuns: 0 },
        RULE_SOME_FAILED: { failed: latest?.failedTests || 0, total: latest?.totalTests || 0 },
        RULE_ALL_PASSED: { passed: latest?.passedTests || 0, failed: 0 },
        RULE_ENDPOINTS_UNCOVERED: { testedEndpoints: analytics.apiCoverage?.testedApis || 0, totalEndpoints: analytics.apiCoverage?.discoveredApis || 0, uncoveredEndpoints: analytics.apiCoverage?.uncoveredApis || 0 },
        RULE_SKIPPED_SCENARIOS: { skipped: latest?.skippedTests || 0 },
    }[rule.id];
    return evidence ? { ...rule, evidenceData: evidence } : rule;
});

export const getIntegrationGuidance = async (projectId) => {
    const raw = await getIntegrationAnalytics(projectId);
    const analytics = { ...raw, history: {
        executions: raw.history?.executions || [], coverage: raw.history?.coverage || [], generations: raw.history?.generations || [],
    } };
    const rules = [];

    // Precedence 1: RULE_NO_DATA
    if (!analytics.overview || (!analytics.overview.totalScenarios && analytics.history.executions.length === 0 && analytics.history.coverage.length === 0)) {
        rules.push({
            id: 'RULE_NO_DATA',
            severity: 'INFO',
            finding: 'No Integration Test Data',
            meaning: 'The Integration Testing pipeline has not been initialized for this project.',
            evidence: {
                source: 'Integration Database',
                snapshotId: analytics.snapshotId || null,
                details: '0 AiTest, 0 TestRun, and 0 CoverageSummary records found.'
            },
            calculation: 'Count of records == 0',
            scope: 'Integration Test Suite',
            impact: 'API health and test coverage cannot be tracked.',
            recommendedAction: 'Run Generate Tests to establish the initial test suite.',
            actionType: 'OPEN_GENERATE_MODAL',
            verification: 'After generation, check that scenarios exist in the summary.'
        });
        return { success: true, data: { rules: withEvidenceData(rules, analytics) } };
    }

    // Precedence 2: RULE_NO_EXECUTION
    if (analytics.overview && analytics.overview.totalScenarios > 0 && !analytics.latestExecution) {
        rules.push({
            id: 'RULE_NO_EXECUTION',
            severity: 'WARNING',
            finding: 'No Execution Data',
            meaning: 'Scenarios exist but have not been executed.',
            evidence: {
                source: 'Execution Runner',
                snapshotId: analytics.snapshotId || null,
                details: `${analytics.overview.totalScenarios} AiTest scenarios exist; 0 TestRun records found.`
            },
            calculation: 'Total Scenarios > 0 AND TestRuns == 0',
            scope: 'Test Runner',
            impact: 'Scenarios are not validated against the active codebase.',
            recommendedAction: 'Execute Tests in the Integration Workbench.',
            actionType: 'EXECUTE_TESTS',
            verification: 'After execution, an Execution Summary should appear.'
        });
        return { success: true, data: { rules: withEvidenceData(rules, analytics) } };
    }

    const latestRun = analytics.latestExecution;
    
    // Evaluate semanticState from Phase 6B
    let semanticState = "NOT_EXECUTED";
    if (latestRun) {
       if (latestRun.totalTests === 0) semanticState = "FAILED_BEFORE_TEST_EXECUTION";
       else if (latestRun.failedTests > 0) semanticState = "TESTS_FAILED";
       else if (latestRun.passedTests === 0 && latestRun.skippedTests > 0) semanticState = "SKIPPED";
       else semanticState = "SUCCESS";
    }

    // 3.1 RULE_INFRASTRUCTURE_FAILURE
    if (semanticState === "FAILED_BEFORE_TEST_EXECUTION") {
        rules.push({
            id: 'RULE_INFRASTRUCTURE_FAILURE',
            severity: 'ERROR',
            finding: 'Infrastructure Failure',
            meaning: 'The test runner crashed or failed to execute any tests.',
            evidence: {
                source: 'Pipeline Job',
                snapshotId: analytics.snapshotId || null,
                jobId: latestRun?.jobId || null,
                details: '0 tests were executed.'
            },
            calculation: 'Total Tests Executed == 0',
            scope: 'Docker / Test Runner',
            impact: 'Test execution is completely blocked.',
            recommendedAction: 'Inspect the Job logs and retry the execution.',
            actionType: 'VIEW_HISTORY',
            verification: 'After retry, check if tests successfully run.'
        });
    }

    // 3.2 RULE_SOME_FAILED
    if (semanticState === "TESTS_FAILED") {
        rules.push({
            id: 'RULE_SOME_FAILED',
            severity: 'ERROR',
            finding: 'Failed Scenarios',
            meaning: 'One or more integration scenarios did not pass validation.',
            evidence: {
                source: 'TestRun Report',
                snapshotId: analytics.snapshotId || null,
                testRunId: latestRun.id,
                details: `${latestRun.failedTests} failed tests out of ${latestRun.totalTests}.`
            },
            calculation: `${latestRun.failedTests} / ${latestRun.totalTests}`,
            scope: 'Integration Scenarios',
            impact: 'The tested APIs are failing their behavioral assertions.',
            recommendedAction: 'Open Scenario Review to inspect and fix failed tests.',
            actionType: 'REVIEW_SCENARIOS',
            verification: 'After fix and re-execution, Failed count should be 0.'
        });
    }

    // 3.3 RULE_ENDPOINTS_UNCOVERED
    if (analytics.apiCoverage && analytics.apiCoverage.uncoveredApis > 0) {
        const { uncoveredApis, discoveredApis, testedApis } = analytics.apiCoverage;
        rules.push({
            id: 'RULE_ENDPOINTS_UNCOVERED',
            severity: 'WARNING',
            finding: `${uncoveredApis} uncovered endpoints`,
            meaning: `${uncoveredApis} of ${discoveredApis} discovered endpoints currently have no mapped Integration scenario.`,
            evidence: {
                source: 'Endpoint Analysis',
                snapshotId: analytics.snapshotId || null,
                details: 'Static mapping state'
            },
            calculation: `${uncoveredApis} / ${discoveredApis}`,
            scope: 'API Endpoints',
            impact: 'These endpoints currently have no Integration scenario.',
            recommendedAction: 'Generate scenarios for uncovered endpoints.',
            actionType: 'OPEN_GENERATE_MODAL',
            verification: `After generation/re-analysis, check if uncovered endpoints decrease from ${uncoveredApis}.`
        });
    }

    // 3.4 RULE_COVERAGE_MISSING or VALID 0%
    if (semanticState === "SUCCESS" || semanticState === "TESTS_FAILED") {
        const coverageHistory = analytics.history?.coverage || [];
        const currentCoverage = coverageHistory[coverageHistory.length - 1];
        if (!currentCoverage) {
            rules.push({
                id: 'RULE_COVERAGE_MISSING',
                severity: 'WARNING',
                finding: 'Coverage Not Collected',
                meaning: 'The test execution completed, but Istanbul/V8 coverage parsing failed.',
                evidence: {
                    source: 'Coverage Parser',
                    snapshotId: analytics.snapshotId || null,
                    testRunId: latestRun?.id || null
                },
                calculation: 'CoverageSummary == null',
                scope: 'Project Code Coverage',
                impact: 'Code execution visibility is lost.',
                recommendedAction: 'Check parser logs in History.',
                actionType: 'VIEW_HISTORY',
                verification: 'After retry, code coverage metrics should be populated.'
            });
        } else if (currentCoverage.stmtsPct === 0) {
             rules.push({
                id: 'RULE_COVERAGE_ZERO',
                severity: 'WARNING',
                finding: 'Valid 0% Coverage',
                meaning: 'Coverage was successfully collected, but no project statements were executed by integration tests.',
                evidence: {
                    source: 'Coverage Parser',
                    snapshotId: analytics.snapshotId || null,
                    testRunId: latestRun?.id || null,
                    details: 'Statements: 0%'
                },
                calculation: 'Executed Statements == 0',
                scope: 'Project Code Coverage',
                impact: 'The tests may be mocking out the entire application or not hitting local logic.',
                recommendedAction: 'Review the generated scenarios to ensure they make real HTTP calls.',
                actionType: 'REVIEW_SCENARIOS',
                verification: 'After editing tests, execute them and expect >0% coverage.'
            });
        }
    }

    // 3.5 RULE_SKIPPED_SCENARIOS
    if (semanticState === "SKIPPED" || (latestRun && latestRun.skippedTests > 0)) {
        rules.push({
            id: 'RULE_SKIPPED_SCENARIOS',
            severity: 'WARNING',
            finding: 'Skipped Scenarios',
            meaning: 'Scenarios were disabled and bypassed during the test run.',
            evidence: {
                source: 'TestRun Report',
                snapshotId: analytics.snapshotId || null,
                testRunId: latestRun.id,
                details: `${latestRun.skippedTests} skipped tests.`
            },
            calculation: `Skipped Tests == ${latestRun.skippedTests}`,
            scope: 'Integration Scenarios',
            impact: 'Skipped scenarios provide no validation.',
            recommendedAction: 'Open Scenario Review filtered to skipped tests to re-enable them.',
            actionType: 'REVIEW_SCENARIOS',
            verification: 'After re-enabling and executing, skipped count should be 0.'
        });
    }

    if (semanticState === 'SUCCESS' && latestRun.totalTests > 0
        && latestRun.passedTests === latestRun.totalTests && !latestRun.skippedTests) {
        rules.push({ id: 'RULE_ALL_PASSED', severity: 'SUCCESS',
            finding: 'The latest completed Integration Test execution passed all executed scenarios.',
            meaning: 'This describes the executed scenarios only; it does not establish complete endpoint or code coverage.',
            evidence: { source: 'TestRun Report', snapshotId: analytics.snapshotId || null, testRunId: latestRun.id },
            actionType: 'VIEW_HISTORY', recommendedAction: 'Review uncovered endpoints and code coverage separately.' });
    }
    const validCoverage = analytics.history.coverage.filter(row => Number.isFinite(row.stmtsPct) && row.stmtsPct >= 0 && row.stmtsPct <= 100);
    if (validCoverage.length >= 2) {
        const previous = validCoverage.at(-2), current = validCoverage.at(-1);
        if (current.stmtsPct !== previous.stmtsPct) rules.push({
            id: current.stmtsPct > previous.stmtsPct ? 'RULE_COVERAGE_IMPROVED' : 'RULE_COVERAGE_DECREASED',
            severity: current.stmtsPct > previous.stmtsPct ? 'INFO' : 'WARNING',
            finding: current.stmtsPct > previous.stmtsPct ? 'Recorded statement coverage increased' : 'Recorded statement coverage decreased',
            meaning: 'The last two recorded snapshots differ. Source and test changes must be reviewed before attributing the difference to generation.',
            evidence: { source: 'Coverage history', snapshotId: current.snapshotId || null },
            evidenceData: { currentStmtsPct: current.stmtsPct, previousStmtsPct: previous.stmtsPct },
            actionType: 'VIEW_HISTORY', recommendedAction: 'Compare source scope and execution history.' });
    }
    const generatedSnapshots = new Set(analytics.history.generations.filter(row => ['FULL', 'SKELETON'].includes(row.mode)).map(row => row.snapshotId));
    const recentGenerated = [...new Map(validCoverage.filter(row => generatedSnapshots.has(row.snapshotId)).map(row => [row.snapshotId, row])).values()].slice(-3);
    if (recentGenerated.length === 3) {
        const values = recentGenerated.map(row => row.stmtsPct);
        const variance = Math.max(...values) - Math.min(...values);
        if (variance < 1) rules.push({ id: 'RULE_DIMINISHING_RETURNS', severity: 'INFO',
            finding: 'Recorded coverage changed by less than one point across three generated snapshots',
            meaning: 'This small observed range does not prove comparable source scope or that further improvement is impossible.',
            evidence: { source: 'Generation and coverage history', snapshotId: recentGenerated.at(-1).snapshotId },
            evidenceData: { variance }, actionType: 'VIEW_HISTORY', recommendedAction: 'Review source comparability and uncovered behavior before generating again.' });
    }

    // Sort by severity (ERROR -> WARNING -> SUCCESS -> INFO),
    // maintaining deterministic order for rules with the same severity using stable sort behavior
    const severityOrder = { ERROR: 1, WARNING: 2, SUCCESS: 3, INFO: 4 };
    
    // Add original index to preserve deterministic order on ties
    const mappedRules = rules.map((r, i) => ({ ...r, originalIndex: i }));
    mappedRules.sort((a, b) => {
        const sDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (sDiff !== 0) return sDiff;
        return a.originalIndex - b.originalIndex;
    });

    const finalRules = mappedRules.map(r => {
        const { originalIndex, ...rest } = r;
        return rest;
    });

    return { success: true, data: { rules: withEvidenceData(finalRules, analytics) } };
};
