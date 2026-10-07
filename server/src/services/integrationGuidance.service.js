import { getIntegrationAnalytics } from './integrationReport.service.js';

export const getIntegrationGuidance = async (projectId) => {
    const analytics = await getIntegrationAnalytics(projectId);
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
        return { success: true, data: { rules } };
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
        return { success: true, data: { rules } };
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

    return { success: true, data: { rules: finalRules } };
};
