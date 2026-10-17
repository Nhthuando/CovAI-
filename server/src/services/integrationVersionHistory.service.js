import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Normalizes an API route path to ensure consistent identity comparison.
 * - Trims whitespace
 * - Ensures leading slash
 * - Removes trailing slash (unless the path is exactly "/")
 * - Standardizes URL parameter syntax (e.g. {id} -> :id)
 */
export function normalizeRoutePath(routePath) {
    if (!routePath || typeof routePath !== "string") return "/";
    let cleaned = routePath.trim().replace(/\\/g, "/");
    if (!cleaned.startsWith("/")) cleaned = "/" + cleaned;
    if (cleaned.length > 1 && cleaned.endsWith("/")) cleaned = cleaned.slice(0, -1);
    // Normalize {param} to :param
    cleaned = cleaned.replace(/\{([a-zA-Z0-9_]+)\}/g, ":$1");
    // Normalize double slashes
    cleaned = cleaned.replace(/\/+/g, "/");
    return cleaned;
}

/**
 * Generates a stable unique identity string for an endpoint.
 * Format: "METHOD /normalized/path"
 */
export function getEndpointIdentity(ep) {
    if (!ep) return "UNKNOWN /";
    const method = (ep.method || "GET").trim().toUpperCase();
    const rawPath = ep.path || ep.route || ep.fullPath || "/";
    return `${method} ${normalizeRoutePath(rawPath)}`;
}

/**
 * Generates a fingerprint hash for endpoint source evidence.
 * Ignores trivial formatting or whitespace differences.
 */
export function hashEndpointEvidence(ep) {
    const canonical = {
        method: (ep.method || "").toUpperCase(),
        path: normalizeRoutePath(ep.path || ep.route || ep.fullPath || "/"),
        sourceFile: ep.sourceFile || ep.source?.sourceFile || null,
        controllerFile: ep.controllerFile || ep.source?.controllerFile || null,
        controllerMethod: ep.controllerMethod || ep.source?.controllerMethod || null,
        middlewares: [...(ep.middlewares || ep.source?.middlewares || [])].map(m => typeof m === "string" ? m : m.name).sort(),
        queryParams: [...(ep.queryParams || ep.behaviorEvidence?.queryParams || ep.source?.queryParams || [])].sort(),
        pathParams: [...(ep.params || ep.behaviorEvidence?.pathParams || ep.source?.params || [])].sort(),
        responseStatusCodes: [...(ep.responseStatusCodes || ep.behaviorEvidence?.responseStatusCodes || ep.source?.responseStatusCodes || [])].sort()
    };
    return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

/**
 * Calculates operation counters (Total, Success, Failed, Canceled, Running)
 * strictly from database records to eliminate double-counting on refresh or polling.
 */
export function calculateOperationCounters(jobs = [], testRuns = []) {
    const counters = {
        totalOperations: (jobs?.length || 0) + (testRuns?.length || 0),
        analyze: { total: 0, success: 0, failed: 0, canceled: 0, running: 0 },
        generate: { total: 0, success: 0, failed: 0, canceled: 0, running: 0 },
        runTests: { total: 0, success: 0, failed: 0, canceled: 0, running: 0 }
    };

    const seenJobIds = new Set();
    for (const job of jobs || []) {
        if (!job || !job.id || seenJobIds.has(job.id)) continue;
        seenJobIds.add(job.id);

        let category = null;
        if (job.type === "ANALYSIS") category = "analyze";
        else if (job.type === "AI_TESTS") category = "generate";
        else if (["SUPERTEST_COVERAGE", "RUN_TESTS", "COVERAGE_PIPELINE", "SYSTEM_TEST_ANALYSIS"].includes(job.type)) {
            category = "runTests";
        }

        if (category) {
            counters[category].total++;
            const status = (job.status || "").toUpperCase();
            if (status === "SUCCESS") counters[category].success++;
            else if (status === "FAILED") counters[category].failed++;
            else if (status === "CANCELED") counters[category].canceled++;
            else if (status === "RUNNING" || status === "QUEUED") counters[category].running++;
        }
    }

    // Include testRuns in runTests counters if they were recorded independently
    const seenRunIds = new Set();
    for (const run of testRuns || []) {
        if (!run || !run.id || seenRunIds.has(run.id)) continue;
        seenRunIds.add(run.id);

        counters.runTests.total++;
        const status = (run.status || "").toUpperCase();
        if (status === "PASSED" || status === "SUCCESS") {
            counters.runTests.success++;
        } else if (status === "FAILED") {
            counters.runTests.failed++;
        } else if (status === "CANCELED" || status === "CANCELLED") {
            counters.runTests.canceled++;
        } else if (status === "RUNNING") {
            counters.runTests.running++;
        }
    }

    return counters;
}

/**
 * Compares two endpoint inventories to classify endpoints as NEW, CHANGED, UNCHANGED, or REMOVED.
 * Rule: REMOVED is only emitted if isCurrentSuccess === true (never on canceled/failed partial runs).
 */
export function compareEndpointInventories(previousEndpoints = [], currentEndpoints = [], options = {}) {
    const isCurrentSuccess = options.isCurrentSuccess !== false;
    const previousMap = new Map();
    for (const ep of previousEndpoints || []) {
        previousMap.set(getEndpointIdentity(ep), ep);
    }

    const currentMap = new Map();
    for (const ep of currentEndpoints || []) {
        currentMap.set(getEndpointIdentity(ep), ep);
    }

    const endpointsWithStatus = [];
    let newCount = 0;
    let changedCount = 0;
    let unchangedCount = 0;
    let removedCount = 0;

    // 1. Process all current endpoints
    for (const ep of currentEndpoints || []) {
        const key = getEndpointIdentity(ep);
        const prev = previousMap.get(key);

        if (!prev) {
            newCount++;
            endpointsWithStatus.push({
                ...ep,
                identity: key,
                diffStatus: "NEW",
                diffDetails: {
                    reason: "First discovered in current analysis session",
                    referenceSessionId: options.currentSessionId || null
                }
            });
        } else {
            // Check for meaningful differences
            const changedFields = [];
            const before = {};
            const after = {};

            const currSourceFile = ep.sourceFile || ep.source?.sourceFile;
            const prevSourceFile = prev.sourceFile || prev.source?.sourceFile;
            if (currSourceFile && prevSourceFile && currSourceFile !== prevSourceFile) {
                changedFields.push("sourceFile");
                before.sourceFile = prevSourceFile;
                after.sourceFile = currSourceFile;
            }

            const currCtrl = ep.controllerFile || ep.source?.controllerFile;
            const prevCtrl = prev.controllerFile || prev.source?.controllerFile;
            if (currCtrl && prevCtrl && currCtrl !== prevCtrl) {
                changedFields.push("controllerFile");
                before.controllerFile = prevCtrl;
                after.controllerFile = currCtrl;
            }

            const currMethod = ep.controllerMethod || ep.source?.controllerMethod;
            const prevMethod = prev.controllerMethod || prev.source?.controllerMethod;
            if (currMethod && prevMethod && currMethod !== prevMethod) {
                changedFields.push("controllerMethod");
                before.controllerMethod = prevMethod;
                after.controllerMethod = currMethod;
            }

            const currMiddlewares = [...(ep.middlewares || ep.source?.middlewares || [])].map(m => typeof m === "string" ? m : (m?.name || String(m))).sort();
            const prevMiddlewares = [...(prev.middlewares || prev.source?.middlewares || [])].map(m => typeof m === "string" ? m : (m?.name || String(m))).sort();
            if (JSON.stringify(currMiddlewares) !== JSON.stringify(prevMiddlewares)) {
                changedFields.push("middlewares");
                before.middlewares = prevMiddlewares;
                after.middlewares = currMiddlewares;
            }

            const currParams = [...(ep.params || ep.behaviorEvidence?.pathParams || [])].sort();
            const prevParams = [...(prev.params || prev.behaviorEvidence?.pathParams || [])].sort();
            if (JSON.stringify(currParams) !== JSON.stringify(prevParams)) {
                changedFields.push("pathParams");
                before.pathParams = prevParams;
                after.pathParams = currParams;
            }

            const currQueryParams = [...(ep.queryParams || ep.behaviorEvidence?.queryParams || [])].sort();
            const prevQueryParams = [...(prev.queryParams || prev.behaviorEvidence?.queryParams || [])].sort();
            if (JSON.stringify(currQueryParams) !== JSON.stringify(prevQueryParams)) {
                changedFields.push("queryParams");
                before.queryParams = prevQueryParams;
                after.queryParams = currQueryParams;
            }

            const currCodes = [...(ep.responseStatusCodes || ep.behaviorEvidence?.responseStatusCodes || [])].sort();
            const prevCodes = [...(prev.responseStatusCodes || prev.behaviorEvidence?.responseStatusCodes || [])].sort();
            if (JSON.stringify(currCodes) !== JSON.stringify(prevCodes)) {
                changedFields.push("responseStatusCodes");
                before.responseStatusCodes = prevCodes;
                after.responseStatusCodes = currCodes;
            }

            if (changedFields.length > 0) {
                changedCount++;
                const fieldDiffs = {};
                for (const f of changedFields) {
                    fieldDiffs[f] = { previous: before[f], current: after[f] };
                }
                endpointsWithStatus.push({
                    ...ep,
                    identity: key,
                    diffStatus: "CHANGED",
                    changedFields,
                    diffDetails: {
                        ...fieldDiffs,
                        changedFields,
                        before,
                        after,
                        referenceSessionId: options.previousSessionId || null
                    }
                });
            } else {
                unchangedCount++;
                endpointsWithStatus.push({
                    ...ep,
                    identity: key,
                    diffStatus: "UNCHANGED",
                    diffDetails: null
                });
            }
        }
    }

    // 2. Identify REMOVED endpoints (only if current run is a verified complete analysis)
    if (isCurrentSuccess) {
        for (const [key, prevEp] of previousMap.entries()) {
            if (!currentMap.has(key)) {
                removedCount++;
                endpointsWithStatus.push({
                    ...prevEp,
                    identity: key,
                    diffStatus: "REMOVED",
                    diffDetails: {
                        reason: "Present in previous session but no longer located in current source code",
                        referenceSessionId: options.previousSessionId || null
                    }
                });
            }
        }
    }

    return {
        endpoints: endpointsWithStatus,
        summary: {
            totalCurrent: currentEndpoints?.length || 0,
            totalPrevious: previousEndpoints?.length || 0,
            newCount,
            changedCount,
            unchangedCount,
            removedCount: isCurrentSuccess ? removedCount : 0,
            comparisonValid: isCurrentSuccess
        }
    };
}

/**
 * Generates a stable unique identity string for a scenario across test runs.
 */
export function getScenarioIdentity(sc) {
    if (!sc) return "UNKNOWN";
    const rawTitle = (sc.testName || sc.title || sc.name || "").trim();
    const rawSuite = (sc.suiteName || "").trim();
    const rawFile = (sc.testFile || sc.filePath || "").replace(/\\/g, "/").trim();

    // If rawTitle already contains "::" or full hierarchy:
    if (rawTitle.includes(" :: ")) {
        if (rawFile && !rawTitle.includes(rawFile)) {
            return `${rawFile} :: ${rawTitle}`;
        }
        return rawTitle;
    }

    if (rawSuite && rawTitle) {
        if (rawFile) return `${rawFile} :: ${rawSuite} :: ${rawTitle}`;
        return `${rawSuite} :: ${rawTitle}`;
    }

    if (rawFile && rawTitle) {
        return `${rawFile} :: ${rawTitle}`;
    }

    return rawTitle || rawSuite || rawFile || "UNKNOWN";
}

/**
 * Compares two test suites (AiTest records) at both file and test case granularity.
 */
export function compareTestSuites(previousTests = [], currentTests = []) {
    // 1. File Level
    const prevFileMap = new Map();
    for (const t of previousTests || []) {
        if (t.filePath) {
            const rawContent = t.content || t.code || "";
            const hash = crypto.createHash("sha256").update(rawContent).digest("hex");
            prevFileMap.set(t.filePath, { test: t, hash });
        }
    }

    const currFileMap = new Map();
    for (const t of currentTests || []) {
        if (t.filePath) {
            const rawContent = t.content || t.code || "";
            const hash = crypto.createHash("sha256").update(rawContent).digest("hex");
            currFileMap.set(t.filePath, { test: t, hash });
        }
    }

    const files = {
        newFiles: [],
        modifiedFiles: [],
        unchangedFiles: [],
        removedFiles: []
    };

    for (const [filePath, { test, hash }] of currFileMap.entries()) {
        const prev = prevFileMap.get(filePath);
        if (!prev) {
            files.newFiles.push({ filePath, id: test.id });
        } else if (prev.hash !== hash) {
            files.modifiedFiles.push({ filePath, id: test.id, prevId: prev.test.id });
        } else {
            files.unchangedFiles.push({ filePath, id: test.id });
        }
    }

    for (const [filePath, { test }] of prevFileMap.entries()) {
        if (!currFileMap.has(filePath)) {
            files.removedFiles.push({ filePath, id: test.id });
        }
    }

    // 2. Test Case Level
    const extractScenarios = (testList) => {
        const scenarios = new Map();
        for (const t of testList || []) {
            let requests = [];
            if (t.metaJson) {
                try {
                    const parsed = typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
                    if (Array.isArray(parsed.requests)) requests = parsed.requests;
                } catch (_) {}
            }
            if (requests.length > 0) {
                for (const r of requests) {
                    const key = `${r.method || "GET"} ${normalizeRoutePath(r.path || r.endpoint || "/")} :: ${r.testName}`;
                    scenarios.set(key, {
                        key,
                        testName: r.testName,
                        method: r.method,
                        path: r.path || r.endpoint,
                        expectedStatus: r.expectedStatus,
                        filePath: t.filePath,
                        hash: crypto.createHash("sha256").update(JSON.stringify(r)).digest("hex").slice(0, 12)
                    });
                }
            } else if (t.testName || t.title || t.name) {
                const title = t.testName || t.title || t.name;
                const key = t.filePath ? `${t.filePath} :: ${title}` : title;
                scenarios.set(key, {
                    key,
                    testName: title,
                    method: t.method || null,
                    path: t.path || t.endpoint || null,
                    expectedStatus: t.expectedStatus || null,
                    filePath: t.filePath,
                    hash: crypto.createHash("sha256").update(t.code || t.content || JSON.stringify(t)).digest("hex").slice(0, 12)
                });
            }
        }
        return scenarios;
    };

    const prevScenarios = extractScenarios(previousTests);
    const currScenarios = extractScenarios(currentTests);

    const testCases = {
        newTests: [],
        modifiedTests: [],
        unchangedTests: [],
        removedTests: []
    };

    for (const [key, currSc] of currScenarios.entries()) {
        const prevSc = prevScenarios.get(key);
        if (!prevSc) {
            testCases.newTests.push(currSc);
        } else if (prevSc.hash !== currSc.hash || prevSc.expectedStatus !== currSc.expectedStatus) {
            const changedFields = [];
            if (prevSc.expectedStatus !== currSc.expectedStatus) changedFields.push("expectedStatus");
            if (prevSc.hash !== currSc.hash) changedFields.push("testLogic");
            testCases.modifiedTests.push({
                ...currSc,
                prevExpectedStatus: prevSc.expectedStatus,
                changedFields,
                before: { expectedStatus: prevSc.expectedStatus, hash: prevSc.hash },
                after: { expectedStatus: currSc.expectedStatus, hash: currSc.hash }
            });
        } else {
            testCases.unchangedTests.push(currSc);
        }
    }

    for (const [key, prevSc] of prevScenarios.entries()) {
        if (!currScenarios.has(key)) {
            testCases.removedTests.push(prevSc);
        }
    }

    const flatTests = [
        ...testCases.newTests.map(t => ({ ...t, diffStatus: "NEW" })),
        ...testCases.modifiedTests.map(t => ({ ...t, diffStatus: "MODIFIED" })),
        ...testCases.unchangedTests.map(t => ({ ...t, diffStatus: "UNCHANGED" })),
        ...testCases.removedTests.map(t => ({ ...t, diffStatus: "REMOVED" }))
    ];

    return {
        files,
        testCases,
        tests: flatTests,
        summary: {
            files: {
                currentTotal: currFileMap.size,
                previousTotal: prevFileMap.size,
                newCount: files.newFiles.length,
                modifiedCount: files.modifiedFiles.length,
                removedCount: files.removedFiles.length,
                unchangedCount: files.unchangedFiles.length
            },
            tests: {
                currentTotal: currScenarios.size,
                previousTotal: prevScenarios.size,
                newCount: testCases.newTests.length,
                modifiedCount: testCases.modifiedTests.length,
                removedCount: testCases.removedTests.length,
                unchangedCount: testCases.unchangedTests.length
            },
            totalCurrentFiles: currFileMap.size,
            totalPreviousFiles: prevFileMap.size,
            newFilesCount: files.newFiles.length,
            modifiedFilesCount: files.modifiedFiles.length,
            removedFilesCount: files.removedFiles.length,
            unchangedFilesCount: files.unchangedFiles.length,
            totalCurrentTests: currScenarios.size,
            totalPreviousTests: prevScenarios.size,
            newTestsCount: testCases.newTests.length,
            modifiedTestsCount: testCases.modifiedTests.length,
            removedTestsCount: testCases.removedTests.length,
            unchangedTestsCount: testCases.unchangedTests.length
        }
    };
}

/**
 * Compares two TestRun records to track PASS/FAIL transitions, unexecuted scenarios, and runtime metrics.
 */
export function compareTestRuns(previousRun, currentRun, options = {}) {
    if (!previousRun || !currentRun) {
        return {
            comparisonAvailable: false,
            reason: "Both a previous and current TestRun are required for comparison.",
            message: "Both a previous and current TestRun are required for comparison.",
            nextAction: "Execute Run Tests to produce runtime execution records."
        };
    }

    if (previousRun.id && currentRun.id && previousRun.id === currentRun.id) {
        return {
            comparisonAvailable: false,
            isSameRun: true,
            reason: "Baseline and current test run are identical (same run ID). Cannot compare a test run with itself.",
            message: "Cannot compare a test run with itself. Select two distinct test runs.",
            nextAction: "Select two distinct test runs to compare execution transitions.",
            runA: previousRun,
            runB: currentRun,
            previousRunId: previousRun.id,
            currentRunId: currentRun.id
        };
    }

    const prevScenarios = new Map();
    for (const sc of previousRun.scenarios || []) {
        const key = getScenarioIdentity(sc);
        prevScenarios.set(key, sc);
    }

    const currScenarios = new Map();
    for (const sc of currentRun.scenarios || []) {
        const key = getScenarioIdentity(sc);
        currScenarios.set(key, sc);
    }

    const matrix = {
        passToPass: [],
        passToFail: [],
        failToPass: [],
        failToFail: [],
        newTests: [],
        removedTests: [],
        skippedTests: [],
        unexecutedTests: []
    };

    const transitionsList = [];
    const isCurrentRunAborted = ["CANCELED", "CANCELLED", "ABORTED"].includes((currentRun.status || "").toUpperCase());
    const isCurrentRunFailed = (currentRun.status || "").toUpperCase() === "FAILED";
    const isPartialExecution = currentRun.executionMode === "partial" ||
                               currentRun.executionMode === "remaining" ||
                               (currentRun.scenarios?.length || 0) < (previousRun.scenarios?.length || 0);

    for (const [key, currSc] of currScenarios.entries()) {
        const prevSc = prevScenarios.get(key);
        const currStatus = (currSc.status || "").toUpperCase();
        const prevStatus = prevSc ? (prevSc.status || "").toUpperCase() : null;

        const baseTransition = {
            testName: key,
            suiteName: currSc.suiteName || prevSc?.suiteName || null,
            testFile: currSc.testFile || prevSc?.testFile || null,
            statusA: prevStatus,
            statusB: currStatus,
            durationMsA: prevSc?.durationMs ?? null,
            durationMsB: currSc.durationMs ?? null,
            durationMs: currSc.durationMs,
            durationDeltaMs: currSc.durationMs != null && prevSc?.durationMs != null ? (currSc.durationMs - prevSc.durationMs) : null,
            failureMessages: Array.isArray(currSc.failureMessages) ? currSc.failureMessages : (currSc.error ? [currSc.error] : []),
            failureStep: currSc.failureStep || null,
            failureCategory: currSc.failureCategory || null
        };

        const isUnexecuted = ["PENDING", "SKIPPED", "UNEXECUTED", "CANCELLED", "CANCELED", "RUNNING", "NOT_RUN"].includes(currStatus);

        if (isUnexecuted) {
            const unexecutedItem = {
                ...currSc,
                testName: key,
                unexecutedReason: currStatus === "SKIPPED"
                    ? "Scenario skipped by test runner"
                    : ["CANCELLED", "CANCELED"].includes(currStatus)
                    ? "Scenario execution was cancelled"
                    : currStatus === "RUNNING"
                    ? "Scenario was left in running/pending state"
                    : "Scenario pending or unexecuted"
            };
            matrix.skippedTests.push(unexecutedItem);
            matrix.unexecutedTests.push(unexecutedItem);
            transitionsList.push({
                ...baseTransition,
                transitionType: "UNEXECUTED",
                unexecutedReason: unexecutedItem.unexecutedReason
            });
            continue;
        }

        if (!prevSc) {
            matrix.newTests.push({ ...currSc, testName: key });
            transitionsList.push({
                ...baseTransition,
                statusA: null,
                transitionType: "NEW_EXECUTION"
            });
        } else {
            let transitionType = "UNCHANGED";
            if (prevStatus === "PASSED" && currStatus === "PASSED") {
                matrix.passToPass.push({ ...currSc, testName: key });
                transitionType = "STABLE_PASS";
            } else if (prevStatus === "PASSED" && currStatus === "FAILED") {
                matrix.passToFail.push({ ...currSc, testName: key });
                transitionType = "REGRESSION";
            } else if (prevStatus === "FAILED" && currStatus === "PASSED") {
                matrix.failToPass.push({ ...currSc, testName: key });
                transitionType = "FIX";
            } else if (prevStatus === "FAILED" && currStatus === "FAILED") {
                matrix.failToFail.push({ ...currSc, testName: key });
                transitionType = "STABLE_FAIL";
            }

            transitionsList.push({
                ...baseTransition,
                transitionType
            });
        }
    }

    for (const [key, prevSc] of prevScenarios.entries()) {
        if (!currScenarios.has(key)) {
            const prevStatus = (prevSc.status || "").toUpperCase();
            // Never classify an unexecuted scenario as removed unless genuine deletion is verified
            const isGenuineRemoval = options.isGenuineRemoval === true ||
                (options.activeScenarios && !options.activeScenarios.has(key) && !isCurrentRunAborted && !isPartialExecution && !isCurrentRunFailed);

            if (!isGenuineRemoval || isCurrentRunAborted || isPartialExecution || isCurrentRunFailed) {
                let unexecutedReason = "Scenario omitted from current execution run";
                if (isCurrentRunAborted) {
                    unexecutedReason = "Test run was cancelled or aborted before executing this scenario";
                } else if (isPartialExecution) {
                    unexecutedReason = "Scenario was not targeted in this partial test run";
                } else if (isCurrentRunFailed) {
                    unexecutedReason = "Test run terminated early due to errors before executing this scenario";
                }

                const unexecutedItem = {
                    ...prevSc,
                    testName: key,
                    unexecutedReason
                };
                matrix.unexecutedTests.push(unexecutedItem);
                transitionsList.push({
                    testName: key,
                    suiteName: prevSc.suiteName || null,
                    testFile: prevSc.testFile || null,
                    statusA: prevStatus,
                    statusB: "UNEXECUTED",
                    durationMsA: prevSc.durationMs ?? null,
                    durationMsB: null,
                    durationMs: prevSc.durationMs,
                    transitionType: "UNEXECUTED",
                    unexecutedReason
                });
            } else {
                matrix.removedTests.push({ ...prevSc, testName: key });
                transitionsList.push({
                    testName: key,
                    suiteName: prevSc.suiteName || null,
                    testFile: prevSc.testFile || null,
                    statusA: prevStatus,
                    statusB: null,
                    durationMsA: prevSc.durationMs ?? null,
                    durationMsB: null,
                    durationMs: prevSc.durationMs,
                    transitionType: "REMOVED_EXECUTION"
                });
            }
        }
    }

    const hasPrevCov = previousRun.coverageLinesPct != null || previousRun.coveragePct != null;
    const hasCurrCov = currentRun.coverageLinesPct != null || currentRun.coveragePct != null;
    const coverageComparable = hasPrevCov && hasCurrCov;
    const prevCov = hasPrevCov ? (previousRun.coverageLinesPct ?? previousRun.coveragePct) : null;
    const currCov = hasCurrCov ? (currentRun.coverageLinesPct ?? currentRun.coveragePct) : null;
    const coverageDelta = coverageComparable ? parseFloat((currCov - prevCov).toFixed(2)) : null;

    const durationDiffMs = (currentRun.durationMs || 0) - (previousRun.durationMs || 0);
    const totalExecuted = matrix.passToPass.length + matrix.failToFail.length + matrix.passToFail.length + matrix.failToPass.length;

    return {
        comparisonAvailable: true,
        runA: previousRun,
        runB: currentRun,
        previousRunId: previousRun.id,
        currentRunId: currentRun.id,
        previousStatus: previousRun.status,
        currentStatus: currentRun.status,
        transitions: transitionsList,
        matrix,
        coverageDelta,
        coverageComparable,
        coverageArtifacts: {
            baseline: { linesPct: prevCov },
            current: { linesPct: currCov },
            comparable: coverageComparable,
            deltaPct: coverageDelta,
            reason: !coverageComparable ? "One or both test runs lack line coverage artifacts." : null
        },
        durationDiffMs,
        summary: {
            totalCompared: transitionsList.length,
            totalExecuted,
            fixesCount: matrix.failToPass.length,
            regressionsCount: matrix.passToFail.length,
            passToPassCount: matrix.passToPass.length,
            stablePassCount: matrix.passToPass.length,
            failToFailCount: matrix.failToFail.length,
            stableFailCount: matrix.failToFail.length,
            newTestsCount: matrix.newTests.length,
            removedTestsCount: matrix.removedTests.length,
            unexecutedTestsCount: matrix.unexecutedTests.length,
            coverageDelta,
            durationDeltaMs: durationDiffMs
        }
    };
}

/**
 * Persists an archived version artifact to local disk for permanent, deterministic retrieval.
 */
export function archiveVersionArtifact(rootDir, jobId, type, data) {
    if (!rootDir || !jobId) return false;
    try {
        const versionsDir = path.join(rootDir, ".covai-temp", "versions");
        fs.mkdirSync(versionsDir, { recursive: true });
        const filePath = path.join(versionsDir, `${jobId}.json`);
        fs.writeFileSync(filePath, JSON.stringify({ jobId, type, timestamp: new Date().toISOString(), data }), "utf8");
        return true;
    } catch (e) {
        console.warn(`[archiveVersionArtifact] Failed to archive version for job ${jobId}:`, e.message);
        return false;
    }
}

/**
 * Retrieves an archived version artifact from local disk.
 */
export function getArchivedVersionArtifact(rootDir, jobId) {
    if (!rootDir || !jobId) return null;
    try {
        const filePath = path.join(rootDir, ".covai-temp", "versions", `${jobId}.json`);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        }
    } catch (_) {}
    return null;
}

/**
 * Assembles the full Version History payload for a snapshot.
 */
export const getIntegrationVersionHistoryService = async (snapshotId, options = {}) => {
    if (!snapshotId) throw new ServiceError("snapshotId is required", 400);

    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { id: true, projectId: true, rootDir: true, commitSha: true, createdAt: true }
    });

    if (!snapshot) throw new ServiceError("Snapshot not found", 404);

    // 1. Fetch all pipeline jobs for this snapshot
    const jobs = await prisma.job.findMany({
        where: {
            snapshotId,
            type: { in: ["ANALYSIS", "AI_TESTS", "SUPERTEST_COVERAGE", "RUN_TESTS", "SYSTEM_TEST_ANALYSIS"] }
        },
        orderBy: { createdAt: "desc" }
    });

    // 2. Fetch all test runs for this snapshot
    const testRuns = await prisma.testRun.findMany({
        where: { snapshotId, type: "SUPERTEST" },
        include: { scenarios: true },
        orderBy: { createdAt: "desc" }
    });

    // 3. Compute accurate counters (without duplicates)
    const counters = calculateOperationCounters(jobs, testRuns);

    // 4. Identify latest successful pointers
    const successfulAnalyzeJobs = jobs.filter(j => j.type === "ANALYSIS" && j.status === "SUCCESS");
    const successfulGenerateJobs = jobs.filter(j => j.type === "AI_TESTS" && j.status === "SUCCESS");
    const successfulTestRuns = testRuns.filter(tr => tr.status === "PASSED" || tr.status === "FAILED");

    const currentVersions = {
        analyze: successfulAnalyzeJobs[0] ? {
            jobId: successfulAnalyzeJobs[0].id,
            completedAt: successfulAnalyzeJobs[0].finishedAt || successfulAnalyzeJobs[0].createdAt,
            status: successfulAnalyzeJobs[0].status
        } : null,
        generate: successfulGenerateJobs[0] ? {
            jobId: successfulGenerateJobs[0].id,
            completedAt: successfulGenerateJobs[0].finishedAt || successfulGenerateJobs[0].createdAt,
            status: successfulGenerateJobs[0].status
        } : null,
        testRun: successfulTestRuns[0] ? {
            testRunId: successfulTestRuns[0].id,
            completedAt: successfulTestRuns[0].finishedAt || successfulTestRuns[0].createdAt,
            status: successfulTestRuns[0].status
        } : null
    };

    // 5. Construct unified timeline
    const timeline = [];

    for (const job of jobs) {
        let opType = "ANALYZE";
        if (job.type === "AI_TESTS") opType = "GENERATE";
        else if (["SUPERTEST_COVERAGE", "RUN_TESTS", "COVERAGE_PIPELINE", "SYSTEM_TEST_ANALYSIS"].includes(job.type)) {
            opType = "RUN_TESTS";
        }

        let parsedResult = null;
        if (job.resultJson) {
            try { parsedResult = JSON.parse(job.resultJson); } catch (_) {}
        }

        const isCurrent = (
            (opType === "ANALYZE" && currentVersions.analyze?.jobId === job.id) ||
            (opType === "GENERATE" && currentVersions.generate?.jobId === job.id)
        );

        let durationMs = job.computeTimeMs ?? null;
        if (durationMs == null && job.finishedAt && (job.startedAt || job.createdAt)) {
            const start = new Date(job.startedAt || job.createdAt).getTime();
            const finish = new Date(job.finishedAt).getTime();
            if (finish >= start) durationMs = finish - start;
        }

        let artifactCount = null;
        if (parsedResult) {
            if (typeof parsedResult.count === "number") artifactCount = parsedResult.count;
            else if (Array.isArray(parsedResult.endpoints)) artifactCount = parsedResult.endpoints.length;
            else if (Array.isArray(parsedResult.tests)) artifactCount = parsedResult.tests.length;
            else if (parsedResult.summary?.totalFiles != null) artifactCount = parsedResult.summary.totalFiles;
            else if (parsedResult.summary?.totalEndpoints != null) artifactCount = parsedResult.summary.totalEndpoints;
            else if (parsedResult.summary?.totalTests != null) artifactCount = parsedResult.summary.totalTests;
        }

        timeline.push({
            id: job.id,
            entityType: "JOB",
            operationType: opType,
            opType,
            jobType: job.type,
            status: job.status,
            progress: job.progress,
            startedAt: job.startedAt || job.createdAt,
            finishedAt: job.finishedAt,
            createdAt: job.createdAt,
            computeTimeMs: job.computeTimeMs,
            durationMs,
            errorMessage: job.errorMessage,
            isCurrent,
            isLatest: jobs[0]?.id === job.id,
            isLatestSuccess: isCurrent,
            revision: snapshot.commitSha || snapshot.id,
            inputRevision: snapshot.commitSha || snapshot.id,
            artifactCount,
            resultSummary: parsedResult?.summary || null
        });
    }

    for (const tr of testRuns) {
        const isCurrent = currentVersions.testRun?.testRunId === tr.id;
        timeline.push({
            id: tr.id,
            entityType: "TEST_RUN",
            operationType: "RUN_TESTS",
            opType: "RUN_TESTS",
            jobType: "SUPERTEST_COVERAGE",
            status: tr.status,
            startedAt: tr.startedAt,
            finishedAt: tr.finishedAt,
            createdAt: tr.createdAt,
            durationMs: tr.durationMs,
            computeTimeMs: tr.durationMs,
            isCurrent,
            isLatest: testRuns[0]?.id === tr.id,
            isLatestSuccess: isCurrent,
            revision: snapshot.commitSha || snapshot.id,
            inputRevision: snapshot.commitSha || snapshot.id,
            artifactCount: tr.totalTests,
            resultSummary: {
                totalTests: tr.totalTests,
                passedTests: tr.passedTests,
                failedTests: tr.failedTests,
                skippedTests: tr.skippedTests
            }
        });
    }

    // Sort timeline descending by createdAt
    timeline.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 6. Old vs New Diffing for the latest two successful versions
    let analyzeDiff = null;
    if (successfulAnalyzeJobs.length >= 1) {
        const currJob = successfulAnalyzeJobs[0];
        const prevJob = successfulAnalyzeJobs.length >= 2 ? successfulAnalyzeJobs[1] : null;

        const currArtifact = getArchivedVersionArtifact(snapshot.rootDir, currJob.id);
        const prevArtifact = prevJob ? getArchivedVersionArtifact(snapshot.rootDir, prevJob.id) : null;

        if (currArtifact?.data?.endpoints) {
            analyzeDiff = compareEndpointInventories(
                prevArtifact?.data?.endpoints || [],
                currArtifact.data.endpoints,
                {
                    isCurrentSuccess: true,
                    currentSessionId: currJob.id,
                    previousSessionId: prevJob?.id || null
                }
            );
        }
    }

    let generateDiff = null;
    if (successfulGenerateJobs.length >= 1) {
        const currJob = successfulGenerateJobs[0];
        const prevJob = successfulGenerateJobs.length >= 2 ? successfulGenerateJobs[1] : null;

        const currArtifact = getArchivedVersionArtifact(snapshot.rootDir, currJob.id);
        const prevArtifact = prevJob ? getArchivedVersionArtifact(snapshot.rootDir, prevJob.id) : null;

        if (currArtifact?.data?.tests) {
            generateDiff = compareTestSuites(
                prevArtifact?.data?.tests || [],
                currArtifact.data.tests
            );
        }
    }

    let runDiff = null;
    if (testRuns.length >= 2) {
        runDiff = compareTestRuns(testRuns[1], testRuns[0]);
    }

    return {
        snapshotId,
        projectId: snapshot.projectId,
        commitSha: snapshot.commitSha || null,
        revision: snapshot.commitSha || snapshot.id,
        jobs,
        testRuns,
        counters,
        currentVersions,
        timeline,
        activeOperations: timeline.filter(t => t.status === "RUNNING" || t.status === "QUEUED"),
        diffs: {
            analyze: analyzeDiff,
            generate: generateDiff,
            runTests: runDiff
        },
        comparisons: {
            analyze: analyzeDiff,
            generate: generateDiff,
            runTests: runDiff
        }
    };
};

/**
 * Compares two specific versions of an operation (Analyze, Generate, or Run Tests).
 */
export const compareVersionsService = async (snapshotId, versionAId, versionBId, type = "ANALYZE") => {
    if (!snapshotId || !versionAId || !versionBId) {
        throw new ServiceError("snapshotId, versionAId, and versionBId are required", 400);
    }

    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { id: true, rootDir: true }
    });
    if (!snapshot) throw new ServiceError("Snapshot not found", 404);

    if (type.toUpperCase() === "RUN_TESTS" || type.toUpperCase() === "SUPERTEST_COVERAGE") {
        const [runA, runB] = await Promise.all([
            prisma.testRun.findUnique({ where: { id: versionAId }, include: { scenarios: true } }),
            prisma.testRun.findUnique({ where: { id: versionBId }, include: { scenarios: true } })
        ]);
        if (!runA || !runB) throw new ServiceError("One or both TestRun versions not found", 404);
        return compareTestRuns(runA, runB);
    }

    if (type.toUpperCase() === "GENERATE" || type.toUpperCase() === "AI_TESTS") {
        const artifactA = getArchivedVersionArtifact(snapshot.rootDir, versionAId);
        const artifactB = getArchivedVersionArtifact(snapshot.rootDir, versionBId);
        let testsA = artifactA?.data?.tests;
        let testsB = artifactB?.data?.tests;

        if (!testsA) {
            const jobA = await prisma.job.findUnique({ where: { id: versionAId } });
            if (jobA?.resultJson) {
                try { testsA = JSON.parse(jobA.resultJson).tests; } catch (_) {}
            }
        }
        if (!testsB) {
            const jobB = await prisma.job.findUnique({ where: { id: versionBId } });
            if (jobB?.resultJson) {
                try { testsB = JSON.parse(jobB.resultJson).tests; } catch (_) {}
            }
        }

        return compareTestSuites(testsA || [], testsB || []);
    }

    // Default: ANALYZE
    const artifactA = getArchivedVersionArtifact(snapshot.rootDir, versionAId);
    const artifactB = getArchivedVersionArtifact(snapshot.rootDir, versionBId);
    let endpointsA = artifactA?.data?.endpoints;
    let endpointsB = artifactB?.data?.endpoints;

    if (!endpointsA) {
        const jobA = await prisma.job.findUnique({ where: { id: versionAId } });
        if (jobA?.resultJson) {
            try { endpointsA = JSON.parse(jobA.resultJson).endpoints; } catch (_) {}
        }
    }
    if (!endpointsB) {
        const jobB = await prisma.job.findUnique({ where: { id: versionBId } });
        if (jobB?.resultJson) {
            try { endpointsB = JSON.parse(jobB.resultJson).endpoints; } catch (_) {}
        }
    }

    return compareEndpointInventories(
        endpointsA || [],
        endpointsB || [],
        { isCurrentSuccess: true, previousSessionId: versionAId, currentSessionId: versionBId }
    );
};

/**
 * Retrieves a historical version artifact or TestRun for in-memory inspection.
 * Guarantees read-only behavior without mutating the workspace or triggering any jobs.
 */
export const getHistoricalWorkspaceVersionService = async (snapshotId, targetId, type = "ANALYZE") => {
    if (!snapshotId || !targetId) {
        throw new ServiceError("snapshotId and targetId are required", 400);
    }

    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { id: true, rootDir: true, projectId: true }
    });
    if (!snapshot) throw new ServiceError("Snapshot not found", 404);

    const normType = (type || "").toUpperCase();

    // 1. If explicit RUN_TESTS or SUPERTEST_COVERAGE, or inspecting a TestRun
    if (normType === "RUN_TESTS" || normType === "SUPERTEST_COVERAGE") {
        const testRun = await prisma.testRun.findUnique({
            where: { id: targetId },
            include: { scenarios: true, testFiles: true }
        });
        if (testRun) {
            return {
                type: "RUN_TESTS",
                targetId,
                snapshotId,
                data: testRun,
                timestamp: testRun.finishedAt || testRun.createdAt,
                source: "TESTRUN_RECORD",
                isReadOnly: true
            };
        }
    }

    // 2. Check disk artifact first
    const artifact = getArchivedVersionArtifact(snapshot.rootDir, targetId);
    if (artifact && artifact.data) {
        return {
            type: artifact.type || type,
            targetId,
            snapshotId,
            data: artifact.data,
            timestamp: artifact.timestamp,
            source: "ARCHIVED_DISK_ARTIFACT",
            isReadOnly: true
        };
    }

    // 3. Fallback to database Job record
    const job = await prisma.job.findUnique({
        where: { id: targetId }
    });

    if (job) {
        let parsedData = null;
        if (job.resultJson) {
            try {
                parsedData = JSON.parse(job.resultJson);
            } catch (_) {}
        }

        let resolvedType = "ANALYZE";
        if (job.type === "AI_TESTS") resolvedType = "GENERATE";
        else if (["SUPERTEST_COVERAGE", "RUN_TESTS", "COVERAGE_PIPELINE", "SYSTEM_TEST_ANALYSIS"].includes(job.type)) {
            resolvedType = "RUN_TESTS";
        }

        // If job was AI_TESTS and resultJson didn't contain full test array, check AiTest table
        if (resolvedType === "GENERATE" && (!parsedData || !parsedData.tests || parsedData.tests.length === 0)) {
            const aiTests = await prisma.aiTest?.findMany?.({
                where: { snapshotId }
            }).catch(() => []);
            if (aiTests && aiTests.length > 0) {
                parsedData = {
                    ...(parsedData || {}),
                    tests: aiTests,
                    count: aiTests.length
                };
            }
        }

        // If job was ANALYSIS and resultJson didn't contain endpoints, check ProjectStructureAnalysis table
        if (resolvedType === "ANALYZE" && (!parsedData || !parsedData.endpoints || parsedData.endpoints.length === 0)) {
            const struct = await prisma.projectStructureAnalysis?.findUnique?.({
                where: { snapshotId }
            }).catch(() => null);
            if (struct?.resultJson) {
                try {
                    const parsedStruct = JSON.parse(struct.resultJson);
                    if (parsedStruct.endpoints || parsedStruct.routes) {
                        parsedData = {
                            ...(parsedData || {}),
                            endpoints: parsedStruct.endpoints || parsedStruct.routes || [],
                            summary: parsedStruct.summary || null
                        };
                    }
                } catch (_) {}
            }
        }

        return {
            type: resolvedType,
            targetId,
            snapshotId,
            data: parsedData || {},
            timestamp: job.finishedAt || job.createdAt,
            source: "DATABASE_JOB_RECORD",
            isReadOnly: true,
            jobMetadata: {
                id: job.id,
                type: job.type,
                status: job.status,
                progress: job.progress,
                durationMs: job.computeTimeMs,
                startedAt: job.startedAt || job.createdAt,
                finishedAt: job.finishedAt,
                errorMessage: job.errorMessage
            }
        };
    }

    // 4. Fallback check for TestRun (in case targetId was a testRunId without explicit type)
    const testRun = await prisma.testRun.findUnique({
        where: { id: targetId },
        include: { scenarios: true, testFiles: true }
    });
    if (testRun) {
        return {
            type: "RUN_TESTS",
            targetId,
            snapshotId,
            data: testRun,
            timestamp: testRun.finishedAt || testRun.createdAt,
            source: "TESTRUN_RECORD",
            isReadOnly: true
        };
    }

    throw new ServiceError("Historical version artifact or database record not found", 404);
};
