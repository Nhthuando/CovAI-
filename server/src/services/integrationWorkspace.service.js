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

const endpointCache = new Map();
const firebaseCache = new Map();
const aiTestParseCache = new Map(); // Structure: Map<snapshotId, Map<aiTestId, { updatedAt: number, requests: Array }>>

/**
 * Builds the data payload for the Integration Test workspace.
 * Re-extracts endpoints dynamically from source code and merges with Jest execution results.
 */
export const buildIntegrationWorkspace = async (snapshotId) => {
    const start = Date.now();

    const startDb = Date.now();
    // 1. Run all DB queries concurrently
    const [testRuns, coverageSummary, coverageFiles, aiTests, snapshot, jobs] = await Promise.all([
        prisma.testRun.findMany({ where: { snapshotId, type: "SUPERTEST" }, orderBy: { createdAt: "desc" }, take: 1 }),
        prisma.coverageSummary.findUnique({ where: { snapshotId } }),
        prisma.coverageFile.findMany({ where: { snapshotId } }),
        prisma.aiTest.findMany({ where: { snapshotId } }),
        prisma.projectSnapshot.findUnique({ where: { id: snapshotId }, select: { storagePath: true, rootDir: true } }),
        prisma.job.findMany({ where: { snapshotId }, orderBy: { createdAt: "desc" }, select: { id: true, type: true, status: true, createdAt: true, startedAt: true, finishedAt: true, errorMessage: true } })
    ]);
    const dbTime = Date.now() - startDb;
    const latestRun = (testRuns && testRuns[0]) || null;

    // 2. Load API Endpoints (Cached by snapshotId in memory and fs)
    const startAst = Date.now();
    let discoveredEndpointsCache = endpointCache.get(snapshotId);
    let discoveredEndpoints = [];
    let sourceFilesCount = 0;
    let sourceTime = 0;
    
    if (!discoveredEndpointsCache) {
        // Try file cache
        const fs = (await import('fs')).default;
        const path = (await import('path')).default;
        const cacheFile = snapshot?.rootDir ? path.join(snapshot.rootDir, '.covai-temp', `endpoints-${snapshotId}.json`) : null;
        
        try {
            if (cacheFile && fs.existsSync(cacheFile)) {
                const fileData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                discoveredEndpoints = fileData.discoveredEndpoints;
                sourceFilesCount = fileData.sourceFilesCount;
                endpointCache.set(snapshotId, { discoveredEndpoints, sourceFilesCount });
                discoveredEndpointsCache = endpointCache.get(snapshotId);
            }
        } catch (e) {
            console.error("Failed to read endpoint cache file", e);
        }
        
        // Fallback to computing
        if (!discoveredEndpointsCache) {
            const startSource = Date.now();
            const sourceCode = await loadSourceCode(snapshotId).catch(() => []);
            sourceTime = Date.now() - startSource;
            sourceFilesCount = sourceCode.length;
            discoveredEndpoints = extractValidEndpoints(sourceCode);
            endpointCache.set(snapshotId, { discoveredEndpoints, sourceFilesCount });
            
            if (cacheFile) {
                try {
                    if (!fs.existsSync(path.dirname(cacheFile))) {
                        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
                    }
                    fs.writeFileSync(cacheFile, JSON.stringify({ discoveredEndpoints, sourceFilesCount }), 'utf8');
                } catch (e) {
                    console.error("Failed to write endpoint cache file", e);
                }
            }
        }
    } else {
        sourceFilesCount = discoveredEndpointsCache.sourceFilesCount;
        discoveredEndpoints = discoveredEndpointsCache.discoveredEndpoints;
    }
    const astTime = Date.now() - startAst;

    // 3. Gather Scenarios (Cached by snapshotId + latestRun)
    const startFb = Date.now();
    let testScenarios = [];
    const firebaseCacheKey = `${snapshotId}_${latestRun?.id || 'none'}`;
    if (firebaseCache.has(firebaseCacheKey)) {
        testScenarios = firebaseCache.get(firebaseCacheKey);
    } else if (snapshot?.storagePath) {
        try {
            const file = getBucket().file(`${snapshot.storagePath}/integration-scenarios.json`);
            const [exists] = await file.exists();
            if (exists) {
                const [content] = await file.download();
                testScenarios = JSON.parse(content.toString("utf8"));
            }
            firebaseCache.set(firebaseCacheKey, testScenarios);
        } catch (e) {
            console.error("[IntegrationWorkspace] Failed to download scenarios from Firebase:", e);
        }
    }
    const fbTime = Date.now() - startFb;

    // We filter only SUPERTEST framework tests
    const integrationTests = aiTests.filter(t => {
        if (!t.metaJson) return false;
        try {
            const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
            return meta.framework === "SUPERTEST";
        } catch { return false; }
    });

    // 6. Map Endpoints
    // Parse all integration tests to extract Supertest calls (using AST cache)
    const startTestParse = Date.now();
    let snapshotParseCache = aiTestParseCache.get(snapshotId);
    if (!snapshotParseCache) {
        snapshotParseCache = new Map();
        aiTestParseCache.set(snapshotId, snapshotParseCache);
    }

    const allParsedRequests = [];
    integrationTests.forEach(t => {
        const currentUpdatedAt = t.updatedAt ? t.updatedAt.getTime() : 0;
        const cacheEntry = snapshotParseCache.get(t.id);
        
        if (cacheEntry && cacheEntry.updatedAt === currentUpdatedAt) {
            allParsedRequests.push(...cacheEntry.requests);
        } else {
            const requests = extractTestRequests(t.content, t.filePath);
            snapshotParseCache.set(t.id, { updatedAt: currentUpdatedAt, requests });
            allParsedRequests.push(...requests);
        }
    });

    // Cleanup deleted aiTests to prevent memory leak
    const currentTestIds = new Set(integrationTests.map(t => t.id));
    for (const cachedId of snapshotParseCache.keys()) {
        if (!currentTestIds.has(cachedId)) {
            snapshotParseCache.delete(cachedId);
        }
    }
    
    const testParseTime = Date.now() - startTestParse;

    const isMatch = (parsedReq, discoveredEp) => {
        if (parsedReq.method !== discoveredEp.method) return false;
        
        const cleanPath = parsedReq.path.split("?")[0].replace(/\/+$/, "") || "/";
        const cleanRoute = discoveredEp.fullPath.replace(/\/+$/, "") || "/";
        
        const regexStr = "^" + cleanRoute.replace(/:[^\/]+/g, "[^/]+") + "$";
        return new RegExp(regexStr).test(cleanPath);
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
            } else {
                status = "Partial";
            }
            if (passedCount > 0 || failedCount > 0) {
                testedApis++;
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
            provenance: ep.provenance,
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

    const analyzeJob = jobs.find(j => j.type === "ANALYSIS");
    const generateJob = jobs.find(j => j.type === "AI_TESTS");
    // Execution pipeline jobs
    const executeJob = jobs.find(j => j.type === "SUPERTEST_COVERAGE" || j.type === "RUN_TESTS" || j.type === "SYSTEM_TEST_ANALYSIS" || j.type === "PLAYWRIGHT_SYSTEM_TEST" || j.type === "CYPRESS_SYSTEM_TEST");

    // Phase 6B: Execution Semantics
    let semanticState = "NOT_EXECUTED";
    let executionJobId = null;
    let testRunId = null;
    
    if (executeJob) {
        executionJobId = executeJob.id;
        if (executeJob.status === "RUNNING" || executeJob.status === "QUEUED") {
            semanticState = "RUNNING";
        } else if (executeJob.status === "CANCELED") {
            semanticState = "CANCELED";
        } else if (executeJob.status === "FAILED") {
            if (latestRun && latestRun.createdAt >= executeJob.createdAt) {
                // TestRun exists and was created during this job
                if (latestRun.failedTests > 0) {
                    semanticState = "TESTS_FAILED";
                } else if (latestRun.totalTests === 0) {
                    semanticState = "FAILED_BEFORE_TEST_EXECUTION";
                } else {
                    semanticState = "TESTS_FAILED"; // fallback
                }
            } else {
                semanticState = "FAILED_BEFORE_TEST_EXECUTION";
            }
        } else if (executeJob.status === "SUCCESS") {
            if (latestRun && latestRun.createdAt >= executeJob.createdAt) {
                if (latestRun.totalTests === 0) {
                    semanticState = "NO_TESTS_EXECUTED";
                } else if (latestRun.failedTests > 0) {
                    semanticState = "TESTS_FAILED";
                } else if (latestRun.passedTests === 0 && latestRun.skippedTests > 0) {
                    semanticState = "SKIPPED";
                } else {
                    semanticState = "SUCCESS";
                }
            } else {
                // SUCCESS job but no TestRun? This implies no tests existed to run.
                semanticState = "NO_TESTS_EXECUTED";
            }
        }
    }

    if (latestRun && (!executeJob || latestRun.createdAt >= executeJob.createdAt)) {
        testRunId = latestRun.id;
    }
    const totalTime = Date.now() - start;
    console.log(`[PERF: Integration Workspace] snapshotId=${snapshotId} Total=${totalTime}ms | FS_Read=${sourceTime}ms | AST_Extract=${astTime}ms | DB=${dbTime}ms | Firebase=${fbTime}ms | Test_Parse=${testParseTime}ms`);

    return {
        snapshot: {
            id: snapshotId,
            rootDir: snapshot?.rootDir || "",
            framework: "Express", // Infer or placeholder
            sourceFilesAnalyzed: sourceFilesCount,
        },
        jobs: {
            analyze: analyzeJob ? { id: analyzeJob.id, status: analyzeJob.status } : null,
            generate: generateJob ? { id: generateJob.id, status: generateJob.status } : null,
            execute: executeJob ? { id: executeJob.id, status: executeJob.status, errorMessage: executeJob.errorMessage, createdAt: executeJob.createdAt } : null,
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
            semanticState,
            executionJobId,
            testRunId,
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
            })),
            provenance: {
                apiCoverage: {
                    source: "Endpoint Analysis + Test Scenario Mapping",
                    metric: "API Endpoint Coverage",
                    formula: "tested endpoints / discovered endpoints × 100",
                    scope: "Discovered Express Endpoints",
                    snapshotId,
                    jobId: generateJob?.id || null,
                    testRunId: null,
                    timestamp: generateJob?.createdAt || new Date(),
                    limitation: "Static mapping; does not guarantee runtime execution hit"
                },
                execution: {
                    source: "TestRunner Report",
                    metric: "Execution Results",
                    formula: "Pass / Fail / Skip from test runner output",
                    scope: "Integration Tests",
                    snapshotId,
                    jobId: executionJobId,
                    testRunId: testRunId,
                    timestamp: latestRun?.createdAt || executeJob?.createdAt || null,
                    limitation: null
                },
                codeCoverage: {
                    source: "Coverage Parser (Istanbul/V8)",
                    metric: "Project Code Coverage",
                    formula: "Executed instructions / Total instructions × 100",
                    scope: "All project source files",
                    snapshotId,
                    jobId: executionJobId,
                    testRunId: testRunId,
                    timestamp: coverageSummary?.createdAt || latestRun?.createdAt || null,
                    limitation: "May represent the latest coverage parser execution rather than Integration-only coverage"
                },
                scenarioCount: {
                    source: "AI Test Generation",
                    metric: "Scenario Count",
                    formula: "Parsed scenarios from generated test files",
                    scope: "Integration Test Scripts",
                    snapshotId,
                    jobId: generateJob?.id || null,
                    testRunId: null,
                    timestamp: generateJob?.createdAt || new Date(),
                    limitation: "Static count of 'it' or 'test' blocks; dynamically skipped tests may not execute"
                }
            }
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
            const cacheEntry = snapshotParseCache.get(t.id);
            const cachedRequests = cacheEntry ? cacheEntry.requests : extractTestRequests(t.content, t.filePath);
            return {
                id: t.id,
                filePath: t.filePath,
                status: meta.status || "DRAFT",
                isValid: meta.isValid !== false,
                requests: cachedRequests.map(r => {
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

