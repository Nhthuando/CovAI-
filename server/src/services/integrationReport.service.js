import prisma from '../config/prisma.js';
import { loadSourceCode } from './aiContextBuilder.service.js';
import { extractValidEndpoints } from './apiEndpointParser.service.js';
import { extractTestRequests } from './testSourceParser.service.js';

const isMatch = (parsedReq, discoveredEp) => {
    if (parsedReq.method !== discoveredEp.method) return false;
    
    const pSegs = parsedReq.path.split('/');
    const dSegs = discoveredEp.fullPath.split('/');
    if (pSegs.length !== dSegs.length) return false;
    
    for (let i = 0; i < pSegs.length; i++) {
        const p = pSegs[i];
        const d = dSegs[i];
        if (p === d) continue;
        if (p === ":param" && d.startsWith(":")) continue;
        if (d.startsWith(":") && !p.startsWith(":")) continue;
        return false;
    }
    return true;
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
    const latestRun = testRuns.filter(tr => tr.snapshotId === snapshotId && (tr.status === 'SUCCESS' || tr.status === 'FAILED')).pop();
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
            stmtsPct: latestCoverage.stmtsPct,
            warning: "Reflects the latest coverage parser execution for this snapshot and is not guaranteed to be Integration-Test-only coverage."
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
            return meta.framework === "SUPERTEST";
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

    report.overview = {
        snapshotId,
        totalScenarios,
        unmodifiedAiScenarios,
        modifiedScenarios
    };

    // API Endpoint Coverage
    let sourceCode = [];
    try {
        sourceCode = await loadSourceCode(snapshotId);
    } catch(e) {}
    
    const discoveredEndpoints = extractValidEndpoints(sourceCode);
    let testedApis = 0;
    
    discoveredEndpoints.forEach(ep => {
        const isTested = allParsedRequests.some(req => isMatch(req, ep));
        if (isTested) testedApis++;
    });

    report.apiCoverage = {
        discoveredApis: discoveredEndpoints.length,
        testedApis,
        uncoveredApis: discoveredEndpoints.length - testedApis,
        coveragePercentage: discoveredEndpoints.length > 0 ? (testedApis / discoveredEndpoints.length) * 100 : 0
    };

    return report;
};
