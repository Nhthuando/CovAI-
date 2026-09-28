import prisma from "../config/prisma.js";
import { loadSourceCode } from "./aiContextBuilder.service.js";
import { extractValidEndpoints } from "./apiEndpointParser.service.js";
import { getBucket } from "../config/firebase.js";
import { extractTestRequests } from "./testSourceParser.service.js";
import crypto from 'crypto';
function categorizeScenario(name) {
    const lower = (name || "").toLowerCase();
    if (lower.includes("error") || lower.includes("fail") || lower.includes("invalid") || lower.includes("missing") || lower.includes("not found")) return "Negative";
    if (lower.includes("auth") || lower.includes("token") || lower.includes("unauthorized") || lower.includes("forbidden")) return "Security";
    if (lower.includes("edge") || lower.includes("boundary") || lower.includes("limit")) return "Edge Case";
    return "Positive";
}

/**
 * Builds the data payload for the Integration Test workspace.
 * Re-extracts endpoints dynamically from source code and merges with Jest execution results.
 */
export const buildIntegrationWorkspace = async (snapshotId) => {
    // 1. Gather API Endpoints
    const sourceCode = await loadSourceCode(snapshotId).catch(() => []);
    const discoveredEndpoints = extractValidEndpoints(sourceCode);

    // 2. Gather Test Executions
    const testRuns = await prisma.testRun.findMany({
        where: { snapshotId, type: "SUPERTEST" },
        orderBy: { createdAt: "desc" },
        take: 1
    });
    const latestRun = testRuns[0] || null;

    // 3. Gather Code Coverage
    const coverageSummary = await prisma.coverageSummary.findUnique({
        where: { snapshotId }
    });

    const coverageFiles = await prisma.coverageFile.findMany({
        where: { snapshotId }
    });

    // 4. Gather Generated AI Tests (to check if generation exists)
    const aiTests = await prisma.aiTest.findMany({
        where: { snapshotId }
    });
    
    // We filter only SUPERTEST framework tests
    const integrationTests = aiTests.filter(t => {
        if (!t.metaJson) return false;
        try {
            const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
            return meta.framework === "SUPERTEST";
        } catch { return false; }
    });

    // 5. Gather detailed scenarios (From Firebase storage)
    let testScenarios = [];
    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { storagePath: true, rootDir: true }
    });
    
    if (snapshot?.storagePath) {
        try {
            const file = getBucket().file(`${snapshot.storagePath}/integration-scenarios.json`);
            const [exists] = await file.exists();
            if (exists) {
                const [content] = await file.download();
                testScenarios = JSON.parse(content.toString("utf8"));
            }
        } catch (e) {
            console.error("[IntegrationWorkspace] Failed to download scenarios from Firebase:", e);
        }
    }

    // 6. Map Endpoints
    // Parse all integration tests to extract Supertest calls
    const allParsedRequests = [];
    integrationTests.forEach(t => {
        const requests = extractTestRequests(t.content, t.filePath);
        allParsedRequests.push(...requests);
    });

    const isMatch = (parsedReq, discoveredEp) => {
        if (parsedReq.method !== discoveredEp.method) return false;
        
        const pSegs = parsedReq.path.split('/');
        const dSegs = discoveredEp.fullPath.split('/');
        if (pSegs.length !== dSegs.length) return false;
        
        for (let i = 0; i < pSegs.length; i++) {
            const p = pSegs[i];
            const d = dSegs[i];
            if (p === d) continue;
            // if template literal param
            if (p === ":param" && d.startsWith(":")) continue;
            // if dynamic segment like 123 mapped to :id
            if (d.startsWith(":") && !p.startsWith(":")) continue;
            return false;
        }
        return true;
    };

    const enrichedScenarios = testScenarios.map(s => {
        const matchingRequests = allParsedRequests.filter(pr => 
            pr.testName === s.title && 
            (s.suiteName.includes(pr.suiteName) || pr.suiteName.includes(s.suiteName) || s.suiteName === pr.suiteName)
        );
        return {
            ...s,
            requests: matchingRequests
        };
    });

    let testedApis = 0;
    let uncoveredApis = 0;
    let notExecutedApis = 0;

    const endpoints = discoveredEndpoints.map(ep => {
        const controllerCoverage = coverageFiles.find(cf => cf.filePath === ep.sourceFile);
        
        // Exact mapping: Scenario contains a request that matches this endpoint's method/path
        const mappedScenarios = enrichedScenarios.filter(s => {
            return s.requests.some(req => isMatch(req, ep));
        });

        const executedCount = mappedScenarios.length; // From the executed scenarios file in Firebase
        const passedCount = mappedScenarios.filter(s => s.status === 'passed').length;
        const failedCount = mappedScenarios.filter(s => s.status === 'failed').length;
        
        let status = "Uncovered";
        const hasRelevantTestFile = integrationTests.some(t => {
            const reqs = extractTestRequests(t.content, t.filePath);
            return reqs.some(r => isMatch(r, ep));
        });

        if (executedCount > 0) {
            if (failedCount > 0) {
                status = "Partial";
            } else if (passedCount === executedCount) {
                status = "Covered";
                testedApis++;
            } else {
                status = "Partial";
            }
        } else {
            if (hasRelevantTestFile) {
                status = "Not Executed";
                notExecutedApis++;
            } else {
                status = "Uncovered";
                uncoveredApis++;
            }
        }
        
        const generatedCount = integrationTests.reduce((acc, t) => {
            const reqs = extractTestRequests(t.content, t.filePath);
            return acc + reqs.filter(r => isMatch(r, ep)).length;
        }, 0);

        const approvedCount = integrationTests.reduce((acc, t) => {
            const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
            if (meta?.status !== 'APPROVED') return acc;
            const reqs = extractTestRequests(t.content, t.filePath);
            const approvedReqs = meta.approvedScenarios 
                ? reqs.filter(r => meta.approvedScenarios.includes(r.testName))
                : reqs; // Fallback for old data
            return acc + approvedReqs.filter(r => isMatch(r, ep)).length;
        }, 0);

        // Clean up requests payload for frontend and add category
        const categorizeScenario = (title) => {
            const lower = title.toLowerCase();
            if (lower.includes("404") || lower.includes("not found")) return "NOT FOUND";
            if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("403") || lower.includes("forbidden")) return "AUTHORIZATION";
            if (lower.includes("400") || lower.includes("validation") || lower.includes("missing") || lower.includes("invalid")) return "VALIDATION";
            if (lower.includes("500") || lower.includes("error") || lower.includes("fail")) return "ERROR";
            if (lower.includes("200") || lower.includes("201") || lower.includes("204") || lower.includes("success")) return "SUCCESS";
            return "Scenario";
        };

        const cleanScenarios = mappedScenarios.map(({ requests, ...rest }) => ({
            ...rest,
            category: categorizeScenario(rest.title)
        }));

        return {
            method: ep.method,
            path: ep.fullPath,
            status,
            testCount: executedCount, // Legacy for UI if needed
            executedCount,
            passedCount,
            failedCount,
            skippedCount: mappedScenarios.filter(s => s.status === 'pending').length,
            passRate: executedCount > 0 ? (passedCount / executedCount) * 100 : 0,
            mappedCodeCoverage: controllerCoverage ? {
                statement: controllerCoverage.stmtsPct,
                branch: controllerCoverage.branchesPct,
                function: controllerCoverage.funcsPct,
                line: controllerCoverage.linesPct
            } : null,
            source: {
                sourceFile: ep.sourceFile,
                controllerMethod: ep.controllerMethod,
                middleware: ep.middleware,
                params: ep.params,
                requestBodySchema: ep.requestBodySchema,
                databaseModels: ep.databaseModels,
            },
            generatedCount,
            approvedCount,
            scenarios: cleanScenarios
        };
    });

    const targetedApis = endpoints.filter(ep => ep.generatedCount > 0).length;
    const isValid = integrationTests.length > 0 && integrationTests.every(t => {
        try {
            const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
            return meta.isValid !== false;
        } catch { return false; }
    });

    const isApproved = integrationTests.length > 0 && integrationTests.every(t => {
        try {
            const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
            return meta.status === 'APPROVED';
        } catch { return false; }
    });

    const jobs = await prisma.job.findMany({
        where: { snapshotId },
        orderBy: { createdAt: "desc" },
        select: { id: true, type: true, status: true, createdAt: true }
    });

    const analyzeJob = jobs.find(j => j.type === "ANALYSIS");
    const generateJob = jobs.find(j => j.type === "AI_TESTS");
    // Execution pipeline could be COVERAGE_PIPELINE or SUPERTEST_COVERAGE_PIPELINE
    const executeJob = jobs.find(j => j.type === "COVERAGE_PIPELINE" || j.type === "SUPERTEST_COVERAGE_PIPELINE");

    return {
        snapshot: {
            id: snapshotId,
            rootDir: snapshot?.rootDir || "",
            framework: "Express", // Infer or placeholder
            sourceFilesAnalyzed: sourceCode.length,
        },
        jobs: {
            analyze: analyzeJob ? { id: analyzeJob.id, status: analyzeJob.status } : null,
            generate: generateJob ? { id: generateJob.id, status: generateJob.status } : null,
            execute: executeJob ? { id: executeJob.id, status: executeJob.status } : null,
        },
        summary: {
            discoveredApis: discoveredEndpoints.length,
            testedApis,
            uncoveredApis,
            notExecutedApis,
            totalTests: latestRun?.totalTests || 0,
            passedTests: latestRun?.passedTests || 0,
            failedTests: latestRun?.failedTests || 0,
            skippedTests: latestRun?.skippedTests || 0,
            durationMs: latestRun?.durationMs || 0,
            codeCoverage: coverageSummary ? {
                statement: coverageSummary.stmtsPct,
                branch: coverageSummary.branchesPct,
                function: coverageSummary.funcsPct,
                line: coverageSummary.linesPct
            } : null,
            fileCoverages: coverageFiles.map(cf => ({
                filePath: cf.filePath,
                statement: cf.stmtsPct,
                branch: cf.branchesPct,
                function: cf.funcsPct,
                line: cf.linesPct
            }))
        },
        generation: {
            hasAnalysis: analyzeJob?.status === "SUCCESS",
            hasGeneratedTests: integrationTests.length > 0,
            targetedApis,
            generatedFiles: integrationTests.length,
            generatedScenarios: allParsedRequests.length,
            isApproved,
            isValid
        },
        endpoints,
        aiTests: integrationTests.map(t => {
            const meta = (typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson) || {};
            return {
                id: t.id,
                filePath: t.filePath,
                status: meta.status || "DRAFT",
                isValid: meta.isValid !== false,
                requests: extractTestRequests(t.content, t.filePath).map(r => {
                    const metaReq = meta.requests ? meta.requests.find(mr => mr.testName === r.testName) : null;
                    const fallbackId = crypto.createHash('md5').update(r.testName).digest('hex').substring(0, 8);
                    return { 
                        ...r, 
                        scenarioId: metaReq?.scenarioId || fallbackId,
                        category: categorizeScenario(r.testName),
                        enabled: metaReq ? metaReq.enabled : true,
                        userEdited: metaReq ? metaReq.userEdited : false
                    };
                })
            };
        }),
        execution: latestRun ? {
            status: latestRun.status,
            startedAt: latestRun.startedAt,
            completedAt: latestRun.finishedAt || null,
        } : null
    };
};

/**
 * GET History of Integration Tests for a snapshot
 */
export const getIntegrationHistoryService = async (snapshotId) => {
    const jobs = await prisma.job.findMany({
        where: { 
            snapshotId,
            type: { in: ['ANALYSIS', 'AI_TESTS', 'SUPERTEST_COVERAGE'] }
        },
        orderBy: { createdAt: 'desc' }
    });
    
    const testRuns = await prisma.testRun.findMany({
        where: { snapshotId, type: 'SUPERTEST' },
        orderBy: { createdAt: 'desc' }
    });
    
    return {
        jobs,
        testRuns
    };
};

