import prisma from '../config/prisma.js';
import { loadSourceCode } from './aiContextBuilder.service.js';
import { extractValidEndpoints } from './apiEndpointParser.service.js';
import { extractTestRequests } from './testSourceParser.service.js';
import { isMatchSuite, buildIntegrationWorkspace } from './integrationWorkspace.service.js';
import { getEndpointCaseCoverage } from '../../../shared/integrationCaseCoverage.js';

export const computeIntegrationCoverageRank = ({
    coveredEndpoints = 0,
    endpointCoveragePct = 0,
    linesPct = 0,
    stmtsPct = 0,
    passedTests = 0,
} = {}) => {
    return (
        Math.round(Number(coveredEndpoints || 0) * 100000) +
        Math.round(Number(endpointCoveragePct || 0) * 100) +
        Math.round(Number(linesPct || stmtsPct || 0) * 10) +
        Number(passedTests || 0)
    );
};

export const capturePeakIntegrationReportIfHigher = async (
    snapshotId,
    { projectId = null, testRunId = null, coverageTotal = null } = {},
) => {
    if (!snapshotId || typeof prisma?.projectStructureAnalysis?.upsert !== 'function') {
        return null;
    }

    const wsResult = await buildIntegrationWorkspace(snapshotId, { bypassCache: true });
    const ws = wsResult?.payload || wsResult;
    if (!ws || !Array.isArray(ws.endpoints)) return null;

    const endpoints = ws.endpoints;
    const summary = ws.summary || {};
    const exec = ws.execution || {};
    const liveCodeCov = summary.codeCoverage || (coverageTotal ? {
        statement: coverageTotal.statements?.pct ?? 0,
        branch: coverageTotal.branches?.pct ?? 0,
        function: coverageTotal.functions?.pct ?? 0,
        line: coverageTotal.lines?.pct ?? coverageTotal.statements?.pct ?? 0,
    } : null);

    const routeMatrix = endpoints.map((e) => {
        const scs = Array.isArray(e.scenarios) ? e.scenarios : [];
        const passScenarios = scs.filter((s) => s.status === 'passed' || s.executionVerdict === 'PASS').length;
        const failScenarios = scs.filter((s) => s.status === 'failed' || s.executionVerdict === 'FAIL').length;
        const isFailed = e.status === 'failed' || (e.failedCount || 0) > 0 || failScenarios > 0;
        const caseCov = e.caseCoverage || getEndpointCaseCoverage(e, scs);
        const isCovered = !isFailed && (e.status === 'Covered' || e.status === 'passed' || (e.passedCount || 0) > 0 || passScenarios > 0);
        return {
            method: (e.method || 'GET').toUpperCase(),
            path: e.fullPath || e.path || e.route || '/',
            handler: e.controllerMethod || e.controllerName || e.handler || 'anonymousHandler',
            sourceFile: e.sourceFile || e.source?.sourceFile || e.filePath || 'express-router',
            status: isFailed
                ? 'FAILED'
                : isCovered && caseCov.isFullyVerified
                    ? 'COVERED'
                    : isCovered
                        ? 'PARTIAL'
                        : 'UNCOVERED',
            scenarioCount: scs.length,
            passedCount: e.passedCount ?? passScenarios,
            failedCount: e.failedCount ?? failScenarios,
            avgDurationMs: e.avgDurationMs || 0,
            latencyStatus: e.latencyStatus || 'NORMAL',
            source: e.source || null,
            caseCoverage: caseCov,
            scenarios: scs,
        };
    });

    const totalDiscovered = endpoints.length;
    const coveredCount = routeMatrix.filter((r) => r.status === 'COVERED').length;
    const endpointCovPct = totalDiscovered > 0 ? Number(((coveredCount / totalDiscovered) * 100).toFixed(1)) : 0;

    const allScenarios = endpoints.flatMap((e) =>
        (e.scenarios || []).map((s) => ({ ...s, targetEndpoint: `${e.method} ${e.path || e.fullPath}` }))
    );
    const totalExecuted = exec.totalTests ?? allScenarios.filter((s) => s.status === 'passed' || s.status === 'failed').length;
    const passedTests = exec.passedTests ?? allScenarios.filter((s) => s.status === 'passed').length;
    const failedTests = exec.failedTests ?? allScenarios.filter((s) => s.status === 'failed').length;
    const passRate = totalExecuted > 0 ? Math.round((passedTests / totalExecuted) * 100) : 0;

    const failureLogs = allScenarios
        .filter((s) => s.status === 'failed' || s.executionVerdict === 'FAIL')
        .map((s) => ({
            id: s.id || s.scenarioId || s.title,
            targetEndpoint: s.targetEndpoint,
            title: s.title || s.name,
            failureLayer: s.failureLayer || 'ASSERTION_FAILED',
            responseStatus: s.actualStatus ?? null,
            expectedStatus: s.expectedStatus ?? null,
            errorMessage: s.executionReason || (s.failureMessages && s.failureMessages[0]) || 'Assertion or runtime failure during API test execution.',
        }));

    const qualityScore = totalDiscovered > 0
        ? Math.min(100, Math.max(0, Math.round(endpointCovPct * 0.45 + passRate * 0.45 + (failedTests === 0 ? 10 : 0))))
        : 0;
    const qualityGrade = qualityScore >= 95 ? 'A+' : qualityScore >= 85 ? 'A' : qualityScore >= 70 ? 'B' : qualityScore >= 50 ? 'C' : 'D';
    const statusVerdict = failedTests > 0 ? 'REGRESSION_DETECTED' : (endpointCovPct >= 80 && passRate === 100) ? 'PRODUCTION_READY' : 'PARTIAL_COVERAGE';

    const linesPct = liveCodeCov?.line ?? coverageTotal?.lines?.pct ?? 0;
    const stmtsPct = liveCodeCov?.statement ?? coverageTotal?.statements?.pct ?? linesPct;
    const score = computeIntegrationCoverageRank({
        coveredEndpoints: coveredCount,
        endpointCoveragePct: endpointCovPct,
        linesPct,
        stmtsPct,
        passedTests,
    });

    const existingRow = await prisma.projectStructureAnalysis.findUnique({
        where: { snapshotId },
        select: { schemaVersion: true, resultJson: true },
    }).catch(() => null);

    let baseObj = {};
    if (existingRow?.resultJson) {
        try {
            baseObj = typeof existingRow.resultJson === 'string'
                ? JSON.parse(existingRow.resultJson)
                : existingRow.resultJson || {};
        } catch (_) {
            baseObj = {};
        }
    }

    const existingScore = baseObj?.peakIntegrationReport?.peakMeta?.score ?? -1;
    if (baseObj?.peakIntegrationReport && score < existingScore) {
        return baseObj.peakIntegrationReport;
    }

    const methodCounts = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OTHER: 0 };
    const methodTested = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OTHER: 0 };
    routeMatrix.forEach((r) => {
        const m = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) ? r.method : 'OTHER';
        methodCounts[m]++;
        if (r.status === 'COVERED') methodTested[m]++;
    });
    const methodDistribution = Object.keys(methodCounts)
        .map((method) => ({
            method,
            total: methodCounts[method],
            tested: methodTested[method],
            uncovered: Math.max(0, methodCounts[method] - methodTested[method]),
            coverageRate: methodCounts[method] > 0 ? Math.round((methodTested[method] / methodCounts[method]) * 100) : 0,
        }))
        .filter((m) => m.total > 0);

    const capturedAt = new Date().toISOString();
    const peakReport = {
        isPeakCoverageReport: true,
        peakMeta: {
            score,
            coveredEndpoints: coveredCount,
            totalEndpoints: totalDiscovered,
            endpointCoveragePct: endpointCovPct,
            linesPct,
            stmtsPct,
            passedTests,
            totalExecuted,
            testRunId: testRunId || exec.id || null,
            capturedAt,
        },
        overview: {
            snapshotId,
            totalScenarios: allScenarios.length,
            hasScannedEndpoints: Boolean(ws.generation?.hasScannedEndpoints ?? totalDiscovered > 0),
            hasExecutedCoverage: totalExecuted > 0,
        },
        latestExecution: {
            testRunId: testRunId || exec.id || null,
            timestamp: exec.completedAt || exec.timestamp || capturedAt,
            status: exec.status || (failedTests > 0 ? 'FAILED' : 'PASSED'),
            totalTests: totalExecuted,
            passedTests,
            failedTests,
            skippedTests: exec.skippedTests || 0,
            durationMs: exec.durationMs || 0,
        },
        apiCoverage: {
            discoveredApis: totalDiscovered,
            testedApis: coveredCount,
            uncoveredApis: Math.max(0, totalDiscovered - coveredCount),
            coveragePercentage: endpointCovPct,
            hasScannedEndpoints: Boolean(ws.generation?.hasScannedEndpoints ?? totalDiscovered > 0),
            hasExecutedCoverage: totalExecuted > 0,
        },
        projectCodeCoverage: liveCodeCov ? {
            timestamp: capturedAt,
            stmtsPct,
            linesPct,
            branchesPct: liveCodeCov.branch ?? coverageTotal?.branches?.pct ?? 0,
            funcsPct: liveCodeCov.function ?? coverageTotal?.functions?.pct ?? 0,
        } : null,
        fileCoverages: summary.fileCoverages || [],
        routeMatrix,
        failureLogs,
        qualityHealth: {
            score: qualityScore,
            grade: qualityGrade,
            verdict: statusVerdict,
            passRate,
        },
        methodDistribution,
    };

    const nextJson = JSON.stringify({
        ...baseObj,
        peakIntegrationReport: peakReport,
    });

    await prisma.projectStructureAnalysis.upsert({
        where: { snapshotId },
        create: {
            snapshotId,
            schemaVersion: existingRow?.schemaVersion || 1,
            resultJson: nextJson,
        },
        update: {
            resultJson: nextJson,
        },
    });

    return peakReport;
};

const isMatch = (parsedReq, discoveredEp) => {
    if (parsedReq.method !== discoveredEp.method) return false;
    
    const cleanPath = parsedReq.path.split("?")[0].replace(/\/+$/, "") || "/";
    const cleanRoute = discoveredEp.fullPath.replace(/\/+$/, "") || "/";
    
    const regexStr = "^" + cleanRoute.replace(/:[^\/]+/g, "[^/]+") + "$";
    return new RegExp(regexStr).test(cleanPath);
};

export const getIntegrationAnalytics = async (projectId) => {
    const report = {
        overview: null,
        latestExecution: null,
        apiCoverage: null,
        projectCodeCoverage: null,
        history: {
            executions: [],
            coverage: [],
            generations: []
        }
    };

    // 1. History - Executions
    const allSnapshots = await prisma.projectSnapshot.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true }
    });

    if (allSnapshots.length === 0) {
        return report;
    }

    const snapshotIds = allSnapshots.map(s => s.id);

    const testRuns = await prisma.testRun.findMany({
        where: { snapshotId: { in: snapshotIds }, type: 'SUPERTEST' },
        orderBy: { createdAt: 'asc' }
    });

    report.history.executions = testRuns.map(tr => ({
        testRunId: tr.id,
        snapshotId: tr.snapshotId,
        timestamp: tr.createdAt.toISOString(),
        status: tr.status,
        totalTests: tr.totalTests,
        passedTests: tr.passedTests,
        failedTests: tr.failedTests,
        skippedTests: tr.skippedTests,
        durationMs: tr.durationMs
    }));

    // 2. History - Coverage
    const coverages = await prisma.coverageSummary.findMany({
        where: { snapshotId: { in: snapshotIds } }
    });
    
    report.history.coverage = coverages.map(c => {
        const snap = allSnapshots.find(s => s.id === c.snapshotId);
        return {
            snapshotId: c.snapshotId,
            timestamp: snap ? snap.createdAt.toISOString() : c.createdAt.toISOString(),
            stmtsPct: c.stmtsPct
        };
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 3. History - Generations
    const jobs = await prisma.job.findMany({
        where: { snapshotId: { in: snapshotIds }, type: 'AI_TESTS' },
        orderBy: { createdAt: 'asc' }
    });

    report.history.generations = jobs.map(j => {
        let mode = "UNKNOWN";
        if (j.payloadJson) {
            try {
                const payload = JSON.parse(j.payloadJson);
                mode = payload.mode || "UNKNOWN";
            } catch (e) {}
        }
        
        return {
            jobId: j.id,
            snapshotId: j.snapshotId,
            timestamp: j.createdAt.toISOString(),
            status: j.status,
            mode
        };
    }).filter(j => j.mode === 'FULL' || j.mode === 'SKELETON' || j.mode === 'SUPERTEST_REGENERATE');

    // 4. Latest Snapshot context
    const latestSnapshot = allSnapshots[allSnapshots.length - 1];
    const snapshotId = latestSnapshot.id;

    // Latest Execution
    const latestRun = testRuns.filter(tr => tr.snapshotId === snapshotId && (tr.status === 'PASSED' || tr.status === 'SUCCESS' || tr.status === 'FAILED')).pop();
    if (latestRun) {
        report.latestExecution = {
            testRunId: latestRun.id,
            timestamp: latestRun.createdAt.toISOString(),
            status: latestRun.status,
            totalTests: latestRun.totalTests,
            passedTests: latestRun.passedTests,
            failedTests: latestRun.failedTests,
            skippedTests: latestRun.skippedTests,
            durationMs: latestRun.durationMs
        };
    }

    // Latest Project Code Coverage
    const latestCoverage = coverages.find(c => c.snapshotId === snapshotId);
    if (latestCoverage) {
        report.projectCodeCoverage = {
            timestamp: latestSnapshot.createdAt.toISOString(),
            stmtsPct: latestCoverage.stmtsPct || 0,
            linesPct: latestCoverage.linesPct || latestCoverage.stmtsPct || 0,
            branchesPct: latestCoverage.branchesPct || 0,
            funcsPct: latestCoverage.funcsPct || 0,
            warning: "Reflects the latest coverage parser execution for this snapshot."
        };
    }

    // Latest AiTests
    const aiTests = await prisma.aiTest.findMany({
        where: { snapshotId }
    });
    
    const integrationTests = aiTests.filter(t => {
        if (!t.metaJson) return false;
        try {
            const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
            return meta.framework === "SUPERTEST" || meta.framework === "PLAYWRIGHT_API";
        } catch { return false; }
    });

    let totalScenarios = 0;
    let unmodifiedAiScenarios = 0;
    let modifiedScenarios = 0;

    const allParsedRequests = [];
    integrationTests.forEach(t => {
        if (t.metaJson) {
            try {
                const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
                const requests = Array.isArray(meta.requests) ? meta.requests : [];
                totalScenarios += requests.length;
                requests.forEach(r => {
                    if (r.userEdited === true) modifiedScenarios++;
                    else unmodifiedAiScenarios++;
                });
            } catch (e) {}
        }
        const reqs = extractTestRequests(t.content, t.filePath);
        allParsedRequests.push(...reqs);
    });

    // 5. Gather Scenarios from TestRun & AST Routes
    const latestRunScenarios = (latestRun && prisma.testScenario?.findMany) ? await prisma.testScenario.findMany({
        where: { testRunId: latestRun.id }
    }) : [];

    const effectiveTotalScenarios = Math.max(
        latestRun?.totalTests || 0,
        latestRunScenarios.length,
        totalScenarios,
        allParsedRequests.length
    );

    // Check if API endpoints have been explicitly scanned (or have prior test/generation history)
    let savedIntegrationScan = null;
    if (typeof prisma?.projectStructureAnalysis?.findUnique === "function") {
        try {
            const analysisRow = await prisma.projectStructureAnalysis.findUnique({
                where: { snapshotId },
                select: { resultJson: true },
            });
            if (analysisRow?.resultJson) {
                const parsed = typeof analysisRow.resultJson === "string"
                    ? JSON.parse(analysisRow.resultJson)
                    : analysisRow.resultJson;
                if (parsed?.integrationScan?.explicitlyScanned) {
                    savedIntegrationScan = parsed.integrationScan;
                }
            }
        } catch (_) {}
    }

    const hasPriorHistory = testRuns.length > 0 || integrationTests.length > 0;
    const hasScannedEndpoints = Boolean(savedIntegrationScan?.explicitlyScanned) || hasPriorHistory;
    const hasExecutedCoverage = Boolean(latestRun) && ((latestRun.totalTests || 0) > 0 || latestRunScenarios.length > 0);

    report.overview = {
        snapshotId,
        totalScenarios: effectiveTotalScenarios,
        unmodifiedAiScenarios,
        modifiedScenarios,
        hasScannedEndpoints,
        hasExecutedCoverage,
    };

    // API Endpoint Coverage (only scan/populate after explicit API scan or prior history)
    let discoveredEndpoints = [];
    if (hasScannedEndpoints) {
        if (Array.isArray(savedIntegrationScan?.discoveredEndpoints) && savedIntegrationScan.discoveredEndpoints.length > 0) {
            discoveredEndpoints = savedIntegrationScan.discoveredEndpoints;
        } else {
            let sourceCode = [];
            try {
                sourceCode = await loadSourceCode(snapshotId);
            } catch(e) {}
            discoveredEndpoints = extractValidEndpoints(sourceCode);
        }
    }
    let testedApis = 0;

    const failureLogs = latestRunScenarios.filter(s => s.status === 'failed' || s.executionVerdict === 'FAIL').map(s => ({
        id: s.id,
        targetEndpoint: s.targetEndpoint || s.testFile,
        title: s.title,
        failureLayer: s.failureLayer || 'ASSERTION_FAILED',
        responseStatus: s.responseStatus,
        expectedStatus: s.expectedStatus,
        errorMessage: (s.failureMessages && s.failureMessages[0]) || s.failureMessage || 'Assertion or runtime failure during API test execution.',
    }));

    const routeMatrix = (discoveredEndpoints || []).map(ep => {
        const isRequestMatched = allParsedRequests.some(req => isMatch(req, ep));
        const matchedScenarios = latestRunScenarios.filter(s => {
            if (s.targetEndpoint && (s.targetEndpoint.includes(ep.fullPath) || s.targetEndpoint.includes(ep.path))) {
                return true;
            }
            return isMatchSuite(s.suiteName, s.title, ep);
        });

        const hasFail = matchedScenarios.some(s => s.status === 'failed' || s.executionVerdict === 'FAIL');
        const isTested = isRequestMatched || matchedScenarios.length > 0;
        if (isTested) {
            testedApis++;
        }
        const status = isTested ? (hasFail ? 'FAILED' : 'COVERED') : 'UNCOVERED';

        const durations = matchedScenarios.map(s => s.durationMs || 0);
        const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
        const latencyStatus = avgDurationMs > 250 ? "SLOW" : avgDurationMs > 0 && avgDurationMs < 80 ? "FAST" : "NORMAL";

        return {
            method: ep.method,
            path: ep.fullPath || ep.path,
            handler: ep.controllerMethod || 'Inline Handler',
            sourceFile: ep.sourceFile || 'routes/api.js',
            status,
            scenarioCount: matchedScenarios.length,
            passedCount: matchedScenarios.filter(s => s.status === 'passed').length,
            failedCount: matchedScenarios.filter(s => s.status === 'failed').length,
            avgDurationMs,
            latencyStatus,
        };
    });

    const apiProvenance = {
        source: "Endpoint Analysis & Execution Tracing",
        metric: "API Endpoint Coverage",
        formula: "testedApis / discoveredApis",
        scope: "Express Routes",
        snapshotId,
        timestamp: new Date().toISOString(),
        limitation: "Reflects AST analysis combined with live Supertest test execution."
    };

    report.apiCoverage = {
        discoveredApis: discoveredEndpoints.length,
        testedApis,
        uncoveredApis: Math.max(0, discoveredEndpoints.length - testedApis),
        coveragePercentage: discoveredEndpoints.length > 0 ? (testedApis / discoveredEndpoints.length) * 100 : 0,
        hasScannedEndpoints,
        hasExecutedCoverage,
        provenance: apiProvenance
    };

    if (report.latestExecution) {
        report.latestExecution.provenance = {
            source: "TestRunner Report",
            metric: "Execution Results",
            formula: "Direct pass/fail counts from test runner",
            scope: "Integration Tests",
            snapshotId,
            testRunId: report.latestExecution.testRunId,
            timestamp: report.latestExecution.timestamp,
            limitation: "Represents an isolated test run that may not reflect overall pipeline status."
        };
    }

    if (report.projectCodeCoverage) {
        report.projectCodeCoverage.provenance = {
            source: "Coverage Parser",
            metric: "Project Statement Coverage",
            formula: "Executed Statements / Total Statements",
            scope: "V8/Istanbul Code Coverage",
            snapshotId,
            timestamp: report.projectCodeCoverage.timestamp,
            limitation: report.projectCodeCoverage.warning
        };
    }

    report.overview.provenance = {
        scenarioCount: {
            source: "AI Test Generator / AST Parser",
            metric: "Scenario Generation",
            formula: "Count of explicitly mapped test scenarios",
            scope: "Integration Scenarios",
            snapshotId,
            timestamp: new Date().toISOString(),
            limitation: "Modified scenarios indicate user edits, but may also include regeneration effects."
        }
    };

    report.routeMatrix = routeMatrix;
    report.failureLogs = failureLogs;

    // 6. Comprehensive Analytics & Parameter Expansion
    const totalScenariosCount = effectiveTotalScenarios;
    const passedTestsCount = report.latestExecution?.passedTests ?? latestRunScenarios.filter(s => s.status === 'passed').length;
    const failedTestsCount = report.latestExecution?.failedTests ?? latestRunScenarios.filter(s => s.status === 'failed').length;
    const totalExecutedTests = report.latestExecution?.totalTests ?? latestRunScenarios.length;
    const passRate = totalExecutedTests > 0
        ? Math.round((passedTestsCount / totalExecutedTests) * 100)
        : (totalScenariosCount > 0 && failureLogs.length === 0 ? 100 : 0);
    const coveragePercentage = report.apiCoverage?.coveragePercentage || 0;

    // Quality Score (0-100) and Health Grade
    let rawQuality = Math.round((coveragePercentage * 0.45) + (passRate * 0.45) + (failureLogs.length === 0 ? 10 : 0));
    if (discoveredEndpoints.length === 0) rawQuality = 0;
    const qualityScore = Math.min(100, Math.max(0, rawQuality));
    const qualityGrade = qualityScore >= 95 ? "A+" : qualityScore >= 85 ? "A" : qualityScore >= 70 ? "B" : qualityScore >= 50 ? "C" : "D";
    const statusVerdict = failureLogs.length > 0 ? "REGRESSION_DETECTED" : (coveragePercentage >= 80 && passRate === 100) ? "PRODUCTION_READY" : "PARTIAL_COVERAGE";

    // HTTP Method Distribution
    const methodCounts = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OTHER: 0 };
    const methodTested = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OTHER: 0 };
    routeMatrix.forEach(r => {
        const m = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) ? r.method : 'OTHER';
        methodCounts[m] = (methodCounts[m] || 0) + 1;
        if (r.status === 'COVERED' || r.status === 'PASS') {
            methodTested[m] = (methodTested[m] || 0) + 1;
        }
    });
    const methodDistribution = Object.keys(methodCounts).map(method => ({
        method,
        total: methodCounts[method],
        tested: methodTested[method],
        uncovered: Math.max(0, methodCounts[method] - methodTested[method]),
        coverageRate: methodCounts[method] > 0 ? Math.round((methodTested[method] / methodCounts[method]) * 100) : 0,
    })).filter(m => m.total > 0);

    // 5-Layer Architectural Health Breakdown
    const layerFailureMap = {
        ROUTER_NOT_FOUND: 0,
        MIDDLEWARE_REJECTED: 0,
        CONTROLLER_CRASH: 0,
        DATABASE_FAILURE: 0,
        ASSERTION_FAILED: 0,
    };
    failureLogs.forEach(f => {
        if (layerFailureMap[f.failureLayer] != null) {
            layerFailureMap[f.failureLayer]++;
        } else {
            layerFailureMap.ASSERTION_FAILED++;
        }
    });

    const layerHealth = [
        { layer: "Router", key: "ROUTER_NOT_FOUND", failures: layerFailureMap.ROUTER_NOT_FOUND, status: layerFailureMap.ROUTER_NOT_FOUND === 0 ? "HEALTHY" : "DEGRADED", description: "Route path resolution & mounting" },
        { layer: "Middleware", key: "MIDDLEWARE_REJECTED", failures: layerFailureMap.MIDDLEWARE_REJECTED, status: layerFailureMap.MIDDLEWARE_REJECTED === 0 ? "HEALTHY" : "DEGRADED", description: "Auth tokens, CORS, Body validation" },
        { layer: "Controller", key: "CONTROLLER_CRASH", failures: layerFailureMap.CONTROLLER_CRASH, status: layerFailureMap.CONTROLLER_CRASH === 0 ? "HEALTHY" : "DEGRADED", description: "Business logic runtime stability" },
        { layer: "Database", key: "DATABASE_FAILURE", failures: layerFailureMap.DATABASE_FAILURE, status: layerFailureMap.DATABASE_FAILURE === 0 ? "HEALTHY" : "DEGRADED", description: "Queries, ORM relations & constraints" },
        { layer: "Assertion", key: "ASSERTION_FAILED", failures: layerFailureMap.ASSERTION_FAILED, status: layerFailureMap.ASSERTION_FAILED === 0 ? "HEALTHY" : "DEGRADED", description: "Contract schemas & HTTP status codes" },
    ];

    // Scenario Classification Breakdown
    let happyPathCount = 0;
    let validationCount = 0;
    let authCount = 0;
    let notFoundCount = 0;
    let resiliencyCount = 0;

    const scenariosToClassify = latestRunScenarios.length > 0 ? latestRunScenarios : allParsedRequests;
    scenariosToClassify.forEach(r => {
        const code = parseInt(r.expectedStatus || r.responseStatus || 200, 10);
        const name = (r.title || r.testName || "").toLowerCase();
        if (code >= 200 && code < 300) happyPathCount++;
        else if (code === 400 || code === 422 || name.includes("validation") || name.includes("invalid") || name.includes("missing")) validationCount++;
        else if (code === 401 || code === 403 || name.includes("auth") || name.includes("unauthorized") || name.includes("forbidden") || name.includes("token")) authCount++;
        else if (code === 404 || code === 409 || name.includes("not found") || name.includes("conflict")) notFoundCount++;
        else if (code >= 500 || name.includes("resiliency") || name.includes("crash") || name.includes("error")) resiliencyCount++;
        else happyPathCount++;
    });

    const totalParsed = scenariosToClassify.length || 1;
    const scenarioClassification = {
        happyPath: { count: happyPathCount, percentage: Math.round((happyPathCount / totalParsed) * 100) },
        validation: { count: validationCount, percentage: Math.round((validationCount / totalParsed) * 100) },
        authSecurity: { count: authCount, percentage: Math.round((authCount / totalParsed) * 100) },
        resourceNotFound: { count: notFoundCount, percentage: Math.round((notFoundCount / totalParsed) * 100) },
        serverResiliency: { count: resiliencyCount, percentage: Math.round((resiliencyCount / totalParsed) * 100) },
    };

    // Functional Domain / Module Breakdown
    const moduleMap = {};
    routeMatrix.forEach(r => {
        const segments = (r.path || "").split("/").filter(Boolean);
        let modName = "ROOT";
        let idx = 0;
        while (idx < segments.length && /^(api|v\d+)$/i.test(segments[idx])) idx++;
        if (idx < segments.length) {
            modName = segments[idx].replace(/^:/, "").toUpperCase() || "ROOT";
        }
        if (!moduleMap[modName]) {
            moduleMap[modName] = { module: modName, totalEndpoints: 0, testedEndpoints: 0, scenariosCount: 0, failedCount: 0 };
        }
        moduleMap[modName].totalEndpoints++;
        if (r.status === 'COVERED' || r.status === 'PASS') moduleMap[modName].testedEndpoints++;
        if (r.status === 'FAILED') moduleMap[modName].failedCount++;
        moduleMap[modName].scenariosCount += (r.scenarioCount || 0);
    });

    const moduleBreakdown = Object.values(moduleMap).map(m => ({
        ...m,
        coveragePct: m.totalEndpoints > 0 ? Math.round((m.testedEndpoints / m.totalEndpoints) * 100) : 0,
        health: m.failedCount > 0 ? "FAILING" : m.testedEndpoints === m.totalEndpoints ? "FULL_COVERAGE" : "PARTIAL",
    })).sort((a, b) => b.totalEndpoints - a.totalEndpoints);

    // Performance Metrics
    const totalDurationMs = report.latestExecution?.durationMs || 0;
    const avgDurationMs = totalExecutedTests > 0 ? Math.round(totalDurationMs / totalExecutedTests) : 0;
    const throughput = totalDurationMs > 0 ? parseFloat((totalExecutedTests / (totalDurationMs / 1000)).toFixed(1)) : 0;

    const performanceMetrics = {
        totalDurationMs,
        avgDurationMs,
        throughputTestsPerSec: throughput,
        evaluatedTestsCount: totalExecutedTests,
    };

    // Audit Metadata
    const auditMetadata = {
        framework: "SUPERTEST",
        runner: "Node / Jest Supertest Runner",
        engineVersion: "CovAI Supertest Integration Engine v2.4",
        scannedSourceFiles: Array.from(new Set(routeMatrix.map(r => r.sourceFile).filter(Boolean))).length,
        timestamp: new Date().toISOString(),
        qualityScore,
        qualityGrade,
        statusVerdict,
    };

    report.qualityHealth = {
        score: qualityScore,
        grade: qualityGrade,
        verdict: statusVerdict,
        passRate,
    };
    report.methodDistribution = methodDistribution;
    report.layerHealth = layerHealth;
    report.scenarioClassification = scenarioClassification;
    report.moduleBreakdown = moduleBreakdown;
    report.performanceMetrics = performanceMetrics;
    report.auditMetadata = auditMetadata;

    const liveScore = computeIntegrationCoverageRank({
        coveredEndpoints: routeMatrix.filter((r) => r.status === 'COVERED' || r.status === 'PASS').length,
        endpointCoveragePct: report.apiCoverage?.coveragePercentage || 0,
        linesPct: report.projectCodeCoverage?.linesPct || 0,
        stmtsPct: report.projectCodeCoverage?.stmtsPct || 0,
        passedTests: passedTestsCount,
    });

    if (typeof prisma?.projectStructureAnalysis?.findUnique === 'function') {
        try {
            const analysisRow = await prisma.projectStructureAnalysis.findUnique({
                where: { snapshotId },
                select: { resultJson: true },
            });
            if (analysisRow?.resultJson) {
                const parsed = typeof analysisRow.resultJson === 'string'
                    ? JSON.parse(analysisRow.resultJson)
                    : analysisRow.resultJson;
                const savedPeak = parsed?.peakIntegrationReport;
                if (savedPeak && (savedPeak.peakMeta?.score ?? 0) >= liveScore) {
                    return {
                        ...report,
                        ...savedPeak,
                        history: report.history,
                        isPeakCoverageReport: true,
                    };
                }
            }
        } catch (err) {
            console.warn('[getIntegrationAnalytics] Peak report lookup warning:', err?.message);
        }
    }

    return report;
};
