import { getIntegrationAnalytics } from './integrationReport.service.js';

export const getIntegrationGuidance = async (projectId) => {
    const analytics = await getIntegrationAnalytics(projectId);
    const rules = [];

    // Precedence 1: RULE_NO_DATA
    if (!analytics.overview || (!analytics.overview.totalScenarios && analytics.history.executions.length === 0 && analytics.history.coverage.length === 0)) {
        rules.push({
            id: 'RULE_NO_DATA',
            severity: 'INFO',
            result: 'No integration test data is available for this project snapshot.',
            finding: 'The Integration Testing pipeline has not been initialized.',
            evidence: '0 AiTest, 0 TestRun, and 0 CoverageSummary records found.',
            evidenceData: {
                scenarios: 0,
                testRuns: 0,
                coverageSummaries: 0
            },
            recommendedAction: "Run 'Generate Integration Tests' to establish the initial test suite.",
            actionType: 'OPEN_GENERATE_MODAL',
            expectedImpact: 'Populate the workbench and begin tracking API health.'
        });
        return { success: true, data: { rules } };
    }

    // Precedence 2: RULE_NO_EXECUTION
    if (analytics.overview && analytics.overview.totalScenarios > 0 && !analytics.latestExecution) {
        rules.push({
            id: 'RULE_NO_EXECUTION',
            severity: 'WARNING',
            result: 'Generated integration scenarios have not been executed.',
            finding: 'Scenarios exist but have not been validated against the active codebase.',
            evidence: `${analytics.overview.totalScenarios} AiTest scenarios exist; 0 TestRun records found.`,
            evidenceData: {
                scenarios: analytics.overview.totalScenarios,
                testRuns: 0
            },
            recommendedAction: "Click 'Execute Tests' in the Integration Workbench.",
            actionType: 'EXECUTE_TESTS',
            expectedImpact: 'Establish a baseline integration execution result.'
        });
        return { success: true, data: { rules } };
    }

    // Precedence 3: Evaluate remaining rules deterministically
    const latestRun = analytics.latestExecution;
    
    // 3.1 RULE_SOME_FAILED
    if (latestRun && latestRun.failedTests > 0) {
        rules.push({
            id: 'RULE_SOME_FAILED',
            severity: 'ERROR',
            result: 'Integration tests failed during the latest execution.',
            finding: 'One or more scenarios did not pass validation.',
            evidence: `TestRun reports ${latestRun.failedTests} failed tests out of ${latestRun.totalTests} total.`,
            evidenceData: { failed: latestRun.failedTests, total: latestRun.totalTests },
            recommendedAction: "Inspect the failure logs in the History pane and edit the failed scenarios.",
            actionType: 'VIEW_HISTORY',
            expectedImpact: 'Restore test suite stability.'
        });
    }

    // 3.2 RULE_ALL_PASSED
    if (latestRun && latestRun.status === 'SUCCESS' && latestRun.totalTests > 0 && latestRun.failedTests === 0) {
        rules.push({
            id: 'RULE_ALL_PASSED',
            severity: 'SUCCESS',
            result: 'All executed integration tests passed successfully.',
            finding: 'The latest completed Integration Test execution passed all executed scenarios.',
            evidence: `TestRun reports ${latestRun.passedTests} passed tests and 0 failed tests.`,
            evidenceData: { passed: latestRun.passedTests, failed: 0 },
            recommendedAction: "Review API Endpoint Coverage to identify missing routes.",
            actionType: 'VIEW_REPORT',
            expectedImpact: 'Expand validation to remaining API endpoints.'
        });
    }

    // 3.3 RULE_ENDPOINTS_UNCOVERED
    if (analytics.apiCoverage && analytics.apiCoverage.uncoveredApis > 0) {
        const { uncoveredApis, discoveredApis, testedApis } = analytics.apiCoverage;
        rules.push({
            id: 'RULE_ENDPOINTS_UNCOVERED',
            severity: 'WARNING',
            result: 'Integration tests map to a partial subset of discovered API endpoints.',
            finding: `${uncoveredApis} out of ${discoveredApis} endpoints remain completely untested by integration scenarios.`,
            evidence: `Static mapping identified ${discoveredApis} total endpoints; ${testedApis} have mapped integration scenarios.`,
            evidenceData: { totalEndpoints: discoveredApis, uncoveredEndpoints: uncoveredApis, testedEndpoints: testedApis },
            recommendedAction: `Use 'Generate Tests' targeting the ${uncoveredApis} uncovered endpoints.`,
            actionType: 'OPEN_GENERATE_MODAL',
            expectedImpact: 'Increase API Endpoint mapping.'
        });
    }

    // 3.4 RULE_COVERAGE_DECREASED & RULE_COVERAGE_IMPROVED
    if (analytics.history && analytics.history.coverage && analytics.history.coverage.length >= 2) {
        const coverageHistory = analytics.history.coverage;
        const currentCoverage = coverageHistory[coverageHistory.length - 1];
        const previousCoverage = coverageHistory[coverageHistory.length - 2];

        if (currentCoverage.stmtsPct < previousCoverage.stmtsPct) {
            rules.push({
                id: 'RULE_COVERAGE_DECREASED',
                severity: 'WARNING',
                result: 'Project statement coverage has decreased.',
                finding: 'Comparing the current snapshot against the previous snapshot shows a reduction in coverage.',
                evidence: `Current coverage is ${currentCoverage.stmtsPct}%; previous snapshot was ${previousCoverage.stmtsPct}%.`,
                evidenceData: { currentStmtsPct: currentCoverage.stmtsPct, previousStmtsPct: previousCoverage.stmtsPct },
                recommendedAction: "Review recently modified files and consider adding coverage.",
                actionType: 'VIEW_REPORT',
                expectedImpact: 'Restore or exceed previous coverage levels.'
            });
        }

        if (currentCoverage.stmtsPct > previousCoverage.stmtsPct) {
            rules.push({
                id: 'RULE_COVERAGE_IMPROVED',
                severity: 'INFO',
                result: 'Project statement coverage has increased.',
                finding: 'Comparing the current snapshot against the previous snapshot shows an increase in coverage.',
                evidence: `Current coverage is ${currentCoverage.stmtsPct}%; previous snapshot was ${previousCoverage.stmtsPct}%.`,
                evidenceData: { currentStmtsPct: currentCoverage.stmtsPct, previousStmtsPct: previousCoverage.stmtsPct },
                recommendedAction: "Commit the current integration tests to lock in the baseline.",
                actionType: 'VIEW_REPORT',
                expectedImpact: 'Maintain the established quality standard.'
            });
        }
    }

    // 3.5 RULE_SKIPPED_SCENARIOS
    if (latestRun && latestRun.skippedTests > 0) {
        rules.push({
            id: 'RULE_SKIPPED_SCENARIOS',
            severity: 'WARNING',
            result: 'Scenarios were skipped during execution.',
            finding: 'Skipped scenarios were not validated in the latest execution.',
            evidence: `TestRun reports ${latestRun.skippedTests} skipped tests.`,
            evidenceData: { skipped: latestRun.skippedTests },
            recommendedAction: "Re-enable skipped scenarios and investigate runtime errors.",
            actionType: 'REVIEW_SCENARIOS',
            expectedImpact: 'Validate scenarios that are currently bypassed.'
        });
    }

    // 3.6 RULE_DIMINISHING_RETURNS
    if (analytics.history && analytics.history.coverage && analytics.history.generations) {
        const generationJobs = analytics.history.generations; 
        
        // Find snapshots with generation jobs
        const snapshotsWithGenerations = [...new Set(generationJobs.map(g => g.snapshotId))];
        
        // Match them to coverage values in order
        const eligibleCoverages = [];
        for (const snapId of snapshotsWithGenerations) {
            const cov = analytics.history.coverage.find(c => c.snapshotId === snapId);
            if (cov) {
                eligibleCoverages.push(cov.stmtsPct);
            }
        }

        if (eligibleCoverages.length >= 3) {
            // Get last 3
            const last3 = eligibleCoverages.slice(-3);
            const max = Math.max(...last3);
            const min = Math.min(...last3);
            const variance = max - min;

            if (variance < 1) {
                rules.push({
                    id: 'RULE_DIMINISHING_RETURNS',
                    severity: 'WARNING',
                    result: 'Repeated AI test generations yielded minimal coverage change.',
                    finding: 'Recent generation cycles have not substantially altered project statement coverage.',
                    evidence: `Coverage changed by <1% across the last 3 snapshots with generation jobs.`,
                    evidenceData: { variance, last3Coverages: last3 },
                    recommendedAction: "Manually edit generated scenarios to inject required mocked state or authentication.",
                    actionType: 'REVIEW_SCENARIOS',
                    expectedImpact: 'Exercise code branches that generation alone cannot reach.'
                });
            }
        }
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
