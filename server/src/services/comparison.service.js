import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { snapshotWorkspaceRoot, resolveSnapshotFile } from "../utils/snapshotWorkspace.js";
import {
    normalizeRoutePath,
    getEndpointIdentity,
    compareEndpointInventories,
    compareTestSuites,
    compareTestRuns,
    getArchivedVersionArtifact
} from "./integrationVersionHistory.service.js";

// Standard default directory and file exclusion patterns for source code diffing
export const DEFAULT_SOURCE_EXCLUSIONS = [
    ".git",
    "node_modules",
    ".covai-temp",
    ".coverage",
    "coverage",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".output",
    ".cache",
    "logs",
    "npm-debug.log",
    "yarn-debug.log",
    "yarn-error.log",
    ".DS_Store",
    "Thumbs.db"
];

/**
 * Computes a standard line-by-line diff between two text strings using dynamic programming (LCS).
 */
export function computeLineDiff(textA = "", textB = "") {
    const linesA = typeof textA === "string" ? textA.split(/\r?\n/) : [];
    const linesB = typeof textB === "string" ? textB.split(/\r?\n/) : [];

    // Empty strings edge cases
    if (linesA.length === 1 && linesA[0] === "" && linesB.length === 1 && linesB[0] === "") {
        return { additions: 0, deletions: 0, chunks: [] };
    }

    const n = linesA.length;
    const m = linesB.length;

    // LCS Table
    // To handle large files safely without memory overflow, cap lines to 2000
    if (n > 2000 || m > 2000) {
        return {
            additions: m,
            deletions: n,
            truncated: true,
            chunks: [
                ...linesA.map((l, i) => ({ type: "del", lineA: i + 1, content: l })),
                ...linesB.map((l, i) => ({ type: "add", lineB: i + 1, content: l }))
            ]
        };
    }

    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
            if (linesA[i] === linesB[j]) {
                dp[i + 1][j + 1] = dp[i][j] + 1;
            } else {
                dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    let i = n;
    let j = m;
    const rawChunks = [];
    let additions = 0;
    let deletions = 0;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
            rawChunks.push({ type: "same", lineA: i, lineB: j, content: linesA[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            rawChunks.push({ type: "add", lineB: j, content: linesB[j - 1] });
            additions++;
            j--;
        } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
            rawChunks.push({ type: "del", lineA: i, content: linesA[i - 1] });
            deletions++;
            i--;
        }
    }

    rawChunks.reverse();

    return {
        additions,
        deletions,
        totalLinesA: n,
        totalLinesB: m,
        chunks: rawChunks
    };
}

/**
 * Checks whether a relative path matches any exclusion pattern.
 */
export function isPathExcluded(relPath, exclusions = DEFAULT_SOURCE_EXCLUSIONS) {
    if (!relPath) return false;
    const normalized = relPath.replace(/\\/g, "/");
    const segments = normalized.split("/");

    for (const pattern of exclusions) {
        // Direct segment match (e.g. "node_modules", ".git", ".covai-temp")
        if (segments.includes(pattern)) return true;
        // Exact prefix or full match
        if (normalized === pattern || normalized.startsWith(pattern + "/")) return true;
        // Simple wildcard match (e.g. "*.log")
        if (pattern.startsWith("*.") && normalized.endsWith(pattern.slice(1))) return true;
    }
    return false;
}

/**
 * Recursively scans a workspace directory for source files, ignoring excluded files/folders.
 * Computes individual file hashes and a composite deterministic tree fingerprint.
 */
export function scanSourceDirectory(rootDir, customExclusions = DEFAULT_SOURCE_EXCLUSIONS) {
    const filesMap = new Map();
    const excludedFiles = [];

    if (!rootDir || !fs.existsSync(rootDir)) {
        return { filesMap, excludedFiles, compositeHash: null };
    }

    function walk(currentDir) {
        let entries = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (_) {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

            if (isPathExcluded(relPath, customExclusions)) {
                excludedFiles.push(relPath);
                continue;
            }

            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                try {
                    const buffer = fs.readFileSync(fullPath);
                    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
                    const contentStr = buffer.toString("utf8");
                    const lines = contentStr.split(/\r?\n/).length;

                    filesMap.set(relPath, {
                        relPath,
                        fullPath,
                        hash,
                        size: buffer.length,
                        lines
                    });
                } catch (_) {}
            }
        }
    }

    walk(rootDir);

    // Compute composite fingerprint: sorted relative paths + hashes
    const sortedEntries = [...filesMap.keys()].sort().map(k => `${k}:${filesMap.get(k).hash}`);
    const compositeHash = crypto.createHash("sha256").update(sortedEntries.join("\n")).digest("hex");

    return {
        filesMap,
        excludedFiles,
        compositeHash,
        totalFiles: filesMap.size
    };
}

/**
 * Compares source code between two snapshots or revisions.
 */
export async function compareSourceCodeService({
    projectId,
    baselineSnapshotId,
    currentSnapshotId,
    customExclusions = DEFAULT_SOURCE_EXCLUSIONS,
    userId
}) {
    if (!projectId || !baselineSnapshotId || !currentSnapshotId) {
        throw new ServiceError("projectId, baselineSnapshotId, and currentSnapshotId are required", 400);
    }

    // Verify project ownership
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, ownerId: true }
    });
    if (!project) throw new ServiceError("Project not found", 404);
    if (userId && project.ownerId !== userId) throw new ServiceError("Forbidden", 403);

    // Fetch both snapshots
    const [snapA, snapB] = await Promise.all([
        prisma.projectSnapshot.findUnique({
            where: { id: baselineSnapshotId },
            select: { id: true, projectId: true, rootDir: true, storagePath: true, commitSha: true, source: true }
        }),
        prisma.projectSnapshot.findUnique({
            where: { id: currentSnapshotId },
            select: { id: true, projectId: true, rootDir: true, storagePath: true, commitSha: true, source: true }
        })
    ]);

    if (!snapA || !snapB) {
        throw new ServiceError("One or both snapshots not found", 404);
    }

    if (snapA.projectId !== projectId || snapB.projectId !== projectId) {
        throw new ServiceError("Snapshots do not belong to the specified project", 400);
    }

    const rootA = snapshotWorkspaceRoot(snapA);
    const rootB = snapshotWorkspaceRoot(snapB);

    if (!rootA || !fs.existsSync(rootA) || !rootB || !fs.existsSync(rootB)) {
        return {
            comparisonAvailable: false,
            reason: "Source directories for one or both snapshots are unavailable on disk",
            baseline: { snapshotId: snapA.id, commitSha: snapA.commitSha },
            current: { snapshotId: snapB.id, commitSha: snapB.commitSha },
            status: "INSUFFICIENT_EVIDENCE"
        };
    }

    const scanA = scanSourceDirectory(rootA, customExclusions);
    const scanB = scanSourceDirectory(rootB, customExclusions);

    const isSameSnapshot = snapA.id === snapB.id;

    // Check if source code is completely identical
    if (scanA.compositeHash && scanA.compositeHash === scanB.compositeHash) {
        return {
            comparisonAvailable: true,
            status: "NO_SOURCE_CODE_CHANGES",
            sourceChanged: false,
            isSameSnapshot,
            reason: isSameSnapshot
                ? "Baseline and current are the same snapshot revision. Source files are identical."
                : "Source trees have identical SHA-256 fingerprints.",
            baseline: {
                snapshotId: snapA.id,
                commitSha: snapA.commitSha,
                compositeHash: scanA.compositeHash,
                totalFiles: scanA.totalFiles
            },
            current: {
                snapshotId: snapB.id,
                commitSha: snapB.commitSha,
                compositeHash: scanB.compositeHash,
                totalFiles: scanB.totalFiles
            },
            summary: {
                totalFilesA: scanA.totalFiles,
                totalFilesB: scanB.totalFiles,
                newFilesCount: 0,
                modifiedFilesCount: 0,
                deletedFilesCount: 0,
                unchangedFilesCount: scanA.totalFiles,
                totalAdditions: 0,
                totalDeletions: 0,
                testFiles: { newCount: 0, modifiedCount: 0, deletedCount: 0, totalChanged: 0 },
                sourceFiles: { newCount: 0, modifiedCount: 0, deletedCount: 0, totalChanged: 0 }
            },
            files: [],
            excludedFiles: [...new Set([...scanA.excludedFiles, ...scanB.excludedFiles])]
        };
    }

    const TEST_FILE_REGEX = /(^|[\\/])(test|tests|__tests__|spec)[\\/]|(\.test|\.spec)\.[jt]sx?$/i;

    // Differences detected: build file-by-file delta
    const files = [];
    let totalAdditions = 0;
    let totalDeletions = 0;
    let newFilesCount = 0;
    let modifiedFilesCount = 0;
    let deletedFilesCount = 0;
    let unchangedFilesCount = 0;

    // 1. Files in B
    for (const [relPath, fileB] of scanB.filesMap.entries()) {
        const fileA = scanA.filesMap.get(relPath);
        const isTest = TEST_FILE_REGEX.test(relPath);

        if (!fileA) {
            newFilesCount++;
            totalAdditions += fileB.lines;
            files.push({
                filePath: relPath,
                status: "NEW",
                isTestFile: isTest,
                additions: fileB.lines,
                deletions: 0,
                sizeB: fileB.size,
                hashB: fileB.hash
            });
        } else if (fileA.hash !== fileB.hash) {
            modifiedFilesCount++;
            let diffSummary = { additions: 0, deletions: 0 };
            try {
                const textA = fs.readFileSync(fileA.fullPath, "utf8");
                const textB = fs.readFileSync(fileB.fullPath, "utf8");
                diffSummary = computeLineDiff(textA, textB);
            } catch (_) {}

            totalAdditions += diffSummary.additions;
            totalDeletions += diffSummary.deletions;

            files.push({
                filePath: relPath,
                status: "MODIFIED",
                isTestFile: isTest,
                additions: diffSummary.additions,
                deletions: diffSummary.deletions,
                sizeA: fileA.size,
                sizeB: fileB.size,
                hashA: fileA.hash,
                hashB: fileB.hash
            });
        } else {
            unchangedFilesCount++;
        }
    }

    // 2. Deleted files (in A but not B)
    for (const [relPath, fileA] of scanA.filesMap.entries()) {
        if (!scanB.filesMap.has(relPath)) {
            const isTest = TEST_FILE_REGEX.test(relPath);
            deletedFilesCount++;
            totalDeletions += fileA.lines;
            files.push({
                filePath: relPath,
                status: "DELETED",
                isTestFile: isTest,
                additions: 0,
                deletions: fileA.lines,
                sizeA: fileA.size,
                hashA: fileA.hash
            });
        }
    }

    const newTestFiles = files.filter(f => f.isTestFile && f.status === "NEW");
    const modifiedTestFiles = files.filter(f => f.isTestFile && f.status === "MODIFIED");
    const deletedTestFiles = files.filter(f => f.isTestFile && f.status === "DELETED");

    const newSourceFiles = files.filter(f => !f.isTestFile && f.status === "NEW");
    const modifiedSourceFiles = files.filter(f => !f.isTestFile && f.status === "MODIFIED");
    const deletedSourceFiles = files.filter(f => !f.isTestFile && f.status === "DELETED");

    return {
        comparisonAvailable: true,
        status: "SOURCE_CHANGED",
        sourceChanged: true,
        isSameSnapshot,
        baseline: {
            snapshotId: snapA.id,
            commitSha: snapA.commitSha,
            compositeHash: scanA.compositeHash,
            totalFiles: scanA.totalFiles
        },
        current: {
            snapshotId: snapB.id,
            commitSha: snapB.commitSha,
            compositeHash: scanB.compositeHash,
            totalFiles: scanB.totalFiles
        },
        summary: {
            totalFilesA: scanA.totalFiles,
            totalFilesB: scanB.totalFiles,
            newFilesCount,
            modifiedFilesCount,
            deletedFilesCount,
            unchangedFilesCount,
            totalAdditions,
            totalDeletions,
            testFiles: {
                newCount: newTestFiles.length,
                modifiedCount: modifiedTestFiles.length,
                deletedCount: deletedTestFiles.length,
                totalChanged: newTestFiles.length + modifiedTestFiles.length + deletedTestFiles.length
            },
            sourceFiles: {
                newCount: newSourceFiles.length,
                modifiedCount: modifiedSourceFiles.length,
                deletedCount: deletedSourceFiles.length,
                totalChanged: newSourceFiles.length + modifiedSourceFiles.length + deletedSourceFiles.length
            }
        },
        files,
        excludedFiles: [...new Set([...scanA.excludedFiles, ...scanB.excludedFiles])]
    };
}

/**
 * Retrieves the full before/after content and line-by-line diff of a single source file.
 */
export async function getSourceFileDiffService({
    projectId,
    baselineSnapshotId,
    currentSnapshotId,
    filePath,
    userId
}) {
    if (!projectId || !baselineSnapshotId || !currentSnapshotId || !filePath) {
        throw new ServiceError("projectId, baselineSnapshotId, currentSnapshotId, and filePath are required", 400);
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, ownerId: true }
    });
    if (!project) throw new ServiceError("Project not found", 404);
    if (userId && project.ownerId !== userId) throw new ServiceError("Forbidden", 403);

    const [snapA, snapB] = await Promise.all([
        prisma.projectSnapshot.findUnique({ where: { id: baselineSnapshotId } }),
        prisma.projectSnapshot.findUnique({ where: { id: currentSnapshotId } })
    ]);

    if (!snapA || !snapB) throw new ServiceError("Snapshots not found", 404);

    let oldContent = "";
    let newContent = "";
    let existsA = false;
    let existsB = false;

    try {
        const resolvedA = resolveSnapshotFile(snapA, filePath);
        if (fs.existsSync(resolvedA)) {
            oldContent = fs.readFileSync(resolvedA, "utf8");
            existsA = true;
        }
    } catch (_) {}

    try {
        const resolvedB = resolveSnapshotFile(snapB, filePath);
        if (fs.existsSync(resolvedB)) {
            newContent = fs.readFileSync(resolvedB, "utf8");
            existsB = true;
        }
    } catch (_) {}

    if (!existsA && !existsB) {
        throw new ServiceError(`File '${filePath}' not found in either snapshot`, 404);
    }

    const lineDiff = computeLineDiff(oldContent, newContent);

    return {
        filePath,
        existsInBaseline: existsA,
        existsInCurrent: existsB,
        baselineCommit: snapA.commitSha,
        currentCommit: snapB.commitSha,
        oldContent,
        newContent,
        diff: lineDiff
    };
}

/**
 * Categorizes a test scenario based on HTTP status codes and scenario naming heuristics.
 */
export function categorizeScenario(scenario = {}) {
    const status = Number(scenario.expectedStatus || scenario.responseStatus || 0);
    const name = (scenario.testName || scenario.title || scenario.name || "").toLowerCase();

    if ((status >= 200 && status < 300) || name.includes("success") || name.includes("create") || name.includes("get all") || name.includes("happy")) {
        return "HAPPY_PATH";
    }
    if (status === 400 || status === 422 || name.includes("invalid") || name.includes("validation") || name.includes("missing") || name.includes("required")) {
        return "VALIDATION";
    }
    if (status === 401 || status === 403 || name.includes("auth") || name.includes("unauthorized") || name.includes("forbidden") || name.includes("token")) {
        return "AUTHORIZATION";
    }
    if (status === 404 || status === 409 || status >= 500 || name.includes("not found") || name.includes("conflict") || name.includes("error") || name.includes("fail")) {
        return "NEGATIVE_PATH";
    }
    return "OTHER";
}

/**
 * Detects test anomalies such as duplicate tests, weak assertions, and unmapped tests.
 */
export function detectTestAnomalies(tests = [], endpoints = []) {
    const knownEndpoints = new Set(endpoints.map(e => getEndpointIdentity(e)));
    const seenIdentities = new Map();

    const duplicateTests = [];
    const weakAssertions = [];
    const unmappedTests = [];

    for (const test of tests || []) {
        const key = test.name || test.title || test.testName || "";
        const code = test.code || test.content || "";

        // 1. Duplicate check
        if (seenIdentities.has(key)) {
            duplicateTests.push({ testName: key, originalId: seenIdentities.get(key) });
        } else {
            seenIdentities.set(key, test.id);
        }

        // 2. Weak assertions check (empty code or only checking status code)
        if (!code || (code.includes("expect(res.status)") && !code.includes("expect(res.body)") && code.length < 100)) {
            weakAssertions.push({ testName: key, reason: "Assertion only checks HTTP status without validating body schema" });
        }

        // 3. Unmapped check
        if (test.method && test.path) {
            const epIdentity = `${test.method.toUpperCase()} ${normalizeRoutePath(test.path)}`;
            if (!knownEndpoints.has(epIdentity)) {
                unmappedTests.push({ testName: key, identity: epIdentity, reason: "Endpoint not found in static endpoint inventory" });
            }
        }
    }

    return {
        duplicateTests,
        weakAssertions,
        unmappedTests
    };
}

/**
 * Normalizes test cases and unpacks requests from metaJson if present.
 */
export function normalizeTestsForCoverage(tests = []) {
    const flat = [];
    for (const t of tests || []) {
        if (!t) continue;
        let requests = [];
        if (t.metaJson) {
            try {
                const parsed = typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
                if (Array.isArray(parsed.requests)) requests = parsed.requests;
            } catch (_) {}
        }
        if (requests.length > 0) {
            for (const r of requests) {
                flat.push({
                    id: r.scenarioId || `${t.id || ""}-${r.testName || ""}`,
                    testName: r.testName || t.name || t.filePath,
                    name: r.testName,
                    method: r.method || t.method,
                    path: r.path || r.endpoint || t.path,
                    expectedStatus: r.expectedStatus,
                    filePath: t.filePath,
                    code: r.code || t.code || t.content
                });
            }
        } else {
            flat.push(t);
        }
    }
    return flat;
}

/**
 * Compares endpoint coverage between two versions with explicit metric distinctions.
 */
export function compareEndpointCoverageDetailed(endpointsA = [], endpointsB = [], testsA = [], testsB = []) {
    const mapA = new Map();
    for (const ep of endpointsA || []) {
        mapA.set(getEndpointIdentity(ep), ep);
    }

    const mapB = new Map();
    for (const ep of endpointsB || []) {
        mapB.set(getEndpointIdentity(ep), ep);
    }

    const totalA = mapA.size;
    const totalB = mapB.size;
    const hasBaselineInventory = totalA > 0;
    const hasCurrentInventory = totalB > 0;
    const comparisonAvailable = hasBaselineInventory && hasCurrentInventory;

    let reason = null;
    let nextAction = null;
    if (!hasBaselineInventory && !hasCurrentInventory) {
        reason = "Neither baseline nor current snapshot has discovered API endpoints.";
        nextAction = "Run Project Structure Analysis on snapshots to discover endpoints.";
    } else if (!hasBaselineInventory) {
        reason = "Baseline snapshot has no discovered API endpoints.";
        nextAction = "Run Project Structure Analysis on the baseline snapshot.";
    } else if (!hasCurrentInventory) {
        reason = "Current snapshot has no discovered API endpoints.";
        nextAction = "Run Project Structure Analysis on the current snapshot.";
    }

    // Map test cases to endpoints, unpacking any requests from metaJson
    const flatTestsA = normalizeTestsForCoverage(testsA);
    const flatTestsB = normalizeTestsForCoverage(testsB);

    const testsPerEpA = new Map();
    for (const t of flatTestsA) {
        const rawPath = t.path || t.endpoint;
        const epKey = t.method && rawPath ? `${t.method.toUpperCase()} ${normalizeRoutePath(rawPath)}` : null;
        if (epKey) {
            if (!testsPerEpA.has(epKey)) testsPerEpA.set(epKey, []);
            testsPerEpA.get(epKey).push(t);
        }
    }

    const testsPerEpB = new Map();
    for (const t of flatTestsB) {
        const rawPath = t.path || t.endpoint;
        const epKey = t.method && rawPath ? `${t.method.toUpperCase()} ${normalizeRoutePath(rawPath)}` : null;
        if (epKey) {
            if (!testsPerEpB.has(epKey)) testsPerEpB.set(epKey, []);
            testsPerEpB.get(epKey).push(t);
        }
    }

    const allEpKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    const endpointComparisons = [];

    let coveredCountA = 0;
    let coveredCountB = 0;

    for (const key of allEpKeys) {
        const inA = mapA.has(key);
        const inB = mapB.has(key);
        const tA = testsPerEpA.get(key) || [];
        const tB = testsPerEpB.get(key) || [];

        const hasTestsA = tA.length > 0;
        const hasTestsB = tB.length > 0;

        if (inA && hasTestsA) coveredCountA++;
        if (inB && hasTestsB) coveredCountB++;

        let status = "UNCOVERED";
        if (hasTestsA && hasTestsB) status = "COVERED_IN_BOTH";
        else if (!hasTestsA && hasTestsB) status = "NEWLY_COVERED";
        else if (hasTestsA && !hasTestsB) status = "LOST_COVERAGE";

        // Scenarios breakdown
        const scenariosA = tA.map(categorizeScenario);
        const scenariosB = tB.map(categorizeScenario);

        endpointComparisons.push({
            identity: key,
            presentInA: inA,
            presentInB: inB,
            testCountA: tA.length,
            testCountB: tB.length,
            coverageStatus: status,
            scenariosA,
            scenariosB
        });
    }

    const coveragePctA = totalA > 0 ? (coveredCountA / totalA) * 100 : 0;
    const coveragePctB = totalB > 0 ? (coveredCountB / totalB) * 100 : 0;
    const deltaPct = comparisonAvailable ? (coveragePctB - coveragePctA) : null;

    return {
        comparisonAvailable,
        reason,
        nextAction,
        endpointComparisons,
        metrics: {
            endpointCoverage: {
                baseline: { covered: coveredCountA, total: totalA, pct: coveragePctA },
                current: { covered: coveredCountB, total: totalB, pct: coveragePctB },
                deltaPct,
                comparable: comparisonAvailable,
                reason,
                nextAction
            },
            testCount: {
                baseline: flatTestsA.length,
                current: flatTestsB.length,
                delta: flatTestsB.length - flatTestsA.length
            }
        }
    };
}

/**
 * Derives rigorous, evidence-backed conclusions without fake scores or ungrounded claims.
 */
export function generateComparisonConclusions({
    sourceDiff,
    testDiff,
    runtimeDiff,
    coverageDiff
}) {
    const reasons = {};
    const nextActions = {};

    // 1. Source Status
    let sourceStatus = "INSUFFICIENT_EVIDENCE";
    if (sourceDiff) {
        if (!sourceDiff.comparisonAvailable) {
            sourceStatus = "INSUFFICIENT_EVIDENCE";
            reasons.source = sourceDiff.reason || "Source directory unavailable for one or both snapshots.";
            nextActions.source = "Ensure snapshot source files exist on disk.";
        } else if (sourceDiff.status === "NO_SOURCE_CODE_CHANGES") {
            sourceStatus = "NO_SOURCE_CODE_CHANGES";
            reasons.source = sourceDiff.reason || "Identical files and SHA-256 tree fingerprint between compared revisions.";
        } else {
            sourceStatus = "SOURCE_CHANGED";
            reasons.source = `${sourceDiff.summary?.newFilesCount || 0} file(s) added, ${sourceDiff.summary?.modifiedFilesCount || 0} modified, ${sourceDiff.summary?.deletedFilesCount || 0} deleted.`;
        }
    }

    // 2. Test Coverage Status (strictly based on valid endpoint coverage evidence!)
    let testCoverageStatus = "INSUFFICIENT_EVIDENCE";
    if (!coverageDiff || !coverageDiff.comparisonAvailable) {
        testCoverageStatus = "INSUFFICIENT_EVIDENCE";
        reasons.testCoverage = coverageDiff?.reason || "Endpoint coverage evidence missing for baseline or current snapshot.";
        nextActions.testCoverage = coverageDiff?.nextAction || "Run Project Structure Analysis to discover API endpoints.";
    } else {
        const delta = coverageDiff.metrics?.endpointCoverage?.deltaPct;
        if (delta == null) {
            testCoverageStatus = "INSUFFICIENT_EVIDENCE";
            reasons.testCoverage = coverageDiff.metrics?.endpointCoverage?.reason || "Unable to compute coverage delta.";
            nextActions.testCoverage = coverageDiff.metrics?.endpointCoverage?.nextAction || "Run endpoint analysis.";
        } else if (delta > 0.001) {
            testCoverageStatus = "TEST_COVERAGE_INCREASED";
            reasons.testCoverage = `Endpoint coverage increased by +${delta.toFixed(1)}% (${coverageDiff.metrics.endpointCoverage.baseline.covered}/${coverageDiff.metrics.endpointCoverage.baseline.total} → ${coverageDiff.metrics.endpointCoverage.current.covered}/${coverageDiff.metrics.endpointCoverage.current.total} endpoints tested).`;
        } else if (delta < -0.001) {
            testCoverageStatus = "TEST_COVERAGE_DECREASED";
            reasons.testCoverage = `Endpoint coverage decreased by ${delta.toFixed(1)}% (${coverageDiff.metrics.endpointCoverage.baseline.covered}/${coverageDiff.metrics.endpointCoverage.baseline.total} → ${coverageDiff.metrics.endpointCoverage.current.covered}/${coverageDiff.metrics.endpointCoverage.current.total} endpoints tested).`;
        } else {
            testCoverageStatus = "TEST_COVERAGE_UNCHANGED";
            reasons.testCoverage = `Endpoint coverage remained unchanged at ${coverageDiff.metrics.endpointCoverage.current.pct.toFixed(1)}% (${coverageDiff.metrics.endpointCoverage.current.covered}/${coverageDiff.metrics.endpointCoverage.current.total} endpoints tested).`;
        }
    }

    // 3. Runtime Status
    let runtimeStatus = "INSUFFICIENT_EVIDENCE";
    if (!runtimeDiff || !runtimeDiff.comparisonAvailable) {
        runtimeStatus = "INSUFFICIENT_EVIDENCE";
        reasons.runtime = runtimeDiff?.reason || "No comparable test runs available.";
        nextActions.runtime = runtimeDiff?.nextAction || "Execute Run Tests to produce runtime execution records.";
    } else if (runtimeDiff.summary) {
        if (runtimeDiff.summary.regressionsCount > 0) {
            runtimeStatus = "RUNTIME_REGRESSION_DETECTED";
            reasons.runtime = `${runtimeDiff.summary.regressionsCount} scenario regression(s) detected (previously passed, now failed).`;
            nextActions.runtime = "Inspect failing scenario stack traces and fix code regressions.";
        } else if (runtimeDiff.summary.fixesCount > 0) {
            runtimeStatus = "RUNTIME_IMPROVEMENT_OBSERVED";
            reasons.runtime = `${runtimeDiff.summary.fixesCount} scenario fix(es) observed (previously failed, now passed).`;
        } else {
            const totalExecuted = runtimeDiff.summary.totalExecuted != null
                ? runtimeDiff.summary.totalExecuted
                : ((runtimeDiff.summary.passToPassCount || 0) + (runtimeDiff.summary.failToFailCount || 0));

            if (totalExecuted > 0) {
                runtimeStatus = "RUNTIME_STABLE";
                reasons.runtime = `All ${totalExecuted} executed scenarios maintained their previous status (${runtimeDiff.summary.passToPassCount || 0} passed, ${runtimeDiff.summary.failToFailCount || 0} failed).`;
            } else {
                runtimeStatus = "INSUFFICIENT_EVIDENCE";
                reasons.runtime = "No scenarios were successfully executed across both test runs (all were skipped, unexecuted, or missing).";
                nextActions.runtime = "Run test suite completely to gather valid execution evidence.";
            }
        }
    }

    // 4. Comparability warnings
    const warnings = [];
    if (runtimeDiff?.runA && runtimeDiff?.runB) {
        if (runtimeDiff.runA.snapshotId && runtimeDiff.runB.snapshotId && runtimeDiff.runA.snapshotId !== runtimeDiff.runB.snapshotId) {
            warnings.push("Compared TestRuns were executed on different snapshot source revisions.");
        }
        if (runtimeDiff.runA.testSuiteVersion && runtimeDiff.runB.testSuiteVersion && runtimeDiff.runA.testSuiteVersion !== runtimeDiff.runB.testSuiteVersion) {
            warnings.push("Compared TestRuns used different test suite versions.");
        }
    }

    return {
        sourceStatus,
        testCoverageStatus,
        runtimeStatus,
        reasons,
        nextActions,
        warnings,
        hasRegressions: (runtimeDiff?.summary?.regressionsCount || 0) > 0,
        hasImprovements: (runtimeDiff?.summary?.fixesCount || 0) > 0
    };
}

/**
 * Generates structured, prioritized actionable findings explaining what changed and why it matters.
 */
export function generateActionableFindings({
    sourceDiff,
    testDiff,
    runtimeDiff,
    coverageDiff,
    coverageArtifactDiff,
    isSameSnapshot
}) {
    const findings = [];

    // 1. Regressions (Critical finding)
    if (runtimeDiff?.summary?.regressionsCount > 0) {
        findings.push({
            id: "runtime-regressions",
            dimension: "EXECUTION_OUTCOMES",
            type: "REGRESSION",
            severity: "CRITICAL",
            title: `${runtimeDiff.summary.regressionsCount} Scenario Regression(s) Detected`,
            whatChanged: `${runtimeDiff.summary.regressionsCount} scenario(s) that previously passed on the baseline are now FAILING.`,
            whyItMatters: "Exposes broken application behavior or regression in integration flow. Must be resolved before merging or deploying.",
            evidenceCount: runtimeDiff.summary.regressionsCount,
            evidenceItems: (runtimeDiff.matrix?.passToFail || []).map(sc => ({
                id: sc.id || sc.testName,
                name: sc.testName || sc.title,
                suiteName: sc.suiteName,
                testFile: sc.testFile,
                statusTransition: "PASSED → FAILED",
                durationDeltaMs: sc.durationDeltaMs,
                errorSnippet: sc.failureMessages?.[0] || sc.error || null,
                failureStep: sc.failureStep || null,
                targetTab: "OUTCOMES",
                filter: "REGRESSIONS"
            })),
            recommendedAction: "Inspect scenario failure stack traces in Execution Outcomes and verify recent source edits."
        });
    }

    // 2. Fixes (Positive finding)
    if (runtimeDiff?.summary?.fixesCount > 0) {
        findings.push({
            id: "runtime-fixes",
            dimension: "EXECUTION_OUTCOMES",
            type: "FIX",
            severity: "POSITIVE",
            title: `${runtimeDiff.summary.fixesCount} Scenario Fix(es) Verified`,
            whatChanged: `${runtimeDiff.summary.fixesCount} scenario(s) that previously failed are now PASSING.`,
            whyItMatters: "Proves that previously exposed bugs or invalid responses have been successfully repaired.",
            evidenceCount: runtimeDiff.summary.fixesCount,
            evidenceItems: (runtimeDiff.matrix?.failToPass || []).map(sc => ({
                id: sc.id || sc.testName,
                name: sc.testName || sc.title,
                suiteName: sc.suiteName,
                testFile: sc.testFile,
                statusTransition: "FAILED → PASSED",
                targetTab: "OUTCOMES",
                filter: "FIXES"
            })),
            recommendedAction: "Ensure fixed scenarios remain covered by automated regression suites."
        });
    }

    // 3. Unexecuted / Skipped scenarios (Medium finding)
    if (runtimeDiff?.summary?.unexecutedTestsCount > 0) {
        findings.push({
            id: "unexecuted-scenarios",
            dimension: "EXECUTION_OUTCOMES",
            type: "UNEXECUTED",
            severity: "MEDIUM",
            title: `${runtimeDiff.summary.unexecutedTestsCount} Unexecuted / Skipped Scenario(s)`,
            whatChanged: `${runtimeDiff.summary.unexecutedTestsCount} scenario(s) were not executed in the current test run (omitted or skipped).`,
            whyItMatters: "Partial execution leaves blind spots. Passing status on other tests does not prove correctness of unexecuted paths.",
            evidenceCount: runtimeDiff.summary.unexecutedTestsCount,
            evidenceItems: (runtimeDiff.matrix?.unexecutedTests || []).map(sc => ({
                id: sc.id || sc.testName,
                name: sc.testName || sc.title,
                suiteName: sc.suiteName,
                testFile: sc.testFile,
                unexecutedReason: sc.unexecutedReason || "Omitted from test execution",
                targetTab: "OUTCOMES",
                filter: "UNEXECUTED"
            })),
            recommendedAction: "Execute Run Remaining Tests to complete scenario coverage verification."
        });
    }

    // 4. Test Suite Additions / Modifications
    const newTestsCount = testDiff?.summary?.newTestsCount || testDiff?.summary?.tests?.newCount || 0;
    const modifiedTestsCount = testDiff?.summary?.modifiedTestsCount || testDiff?.summary?.tests?.modifiedCount || 0;
    const removedTestsCount = testDiff?.summary?.removedTestsCount || testDiff?.summary?.tests?.removedCount || 0;

    if (newTestsCount > 0 || modifiedTestsCount > 0 || removedTestsCount > 0) {
        const parts = [];
        if (newTestsCount > 0) parts.push(`+${newTestsCount} new`);
        if (modifiedTestsCount > 0) parts.push(`${modifiedTestsCount} modified`);
        if (removedTestsCount > 0) parts.push(`-${removedTestsCount} removed`);

        findings.push({
            id: "test-suite-evolution",
            dimension: "TEST_SUITE",
            type: newTestsCount > 0 ? "EXPANSION" : "MODIFICATION",
            severity: newTestsCount > 0 ? "POSITIVE" : "NEUTRAL",
            title: `Test Suite Evolved (${parts.join(", ")})`,
            whatChanged: `Test suite contains ${newTestsCount} new, ${modifiedTestsCount} modified, and ${removedTestsCount} removed scenario(s).`,
            whyItMatters: newTestsCount > 0
                ? "Expands validation boundaries to newly discovered edge cases and endpoints."
                : "Updates scenario assertions or payloads to align with project requirements.",
            evidenceCount: newTestsCount + modifiedTestsCount,
            targetTab: "TESTS",
            filter: newTestsCount > 0 ? "NEW" : "MODIFIED"
        });
    }

    // 5. Endpoint Coverage Delta
    if (coverageDiff?.comparisonAvailable && coverageDiff.metrics?.endpointCoverage) {
        const deltaPct = coverageDiff.metrics.endpointCoverage.deltaPct;
        const currCovered = coverageDiff.metrics.endpointCoverage.current.covered;
        const currTotal = coverageDiff.metrics.endpointCoverage.current.total;
        const baseCovered = coverageDiff.metrics.endpointCoverage.baseline.covered;
        const baseTotal = coverageDiff.metrics.endpointCoverage.baseline.total;

        if (deltaPct != null && Math.abs(deltaPct) > 0.001) {
            const isIncrease = deltaPct > 0;
            findings.push({
                id: "endpoint-coverage-delta",
                dimension: "TEST_SUITE",
                type: isIncrease ? "COVERAGE_EXPANSION" : "COVERAGE_DROP",
                severity: isIncrease ? "POSITIVE" : "HIGH",
                title: isIncrease
                    ? `Endpoint Coverage Expanded (+${deltaPct.toFixed(1)}%)`
                    : `Endpoint Coverage Dropped (${deltaPct.toFixed(1)}%)`,
                whatChanged: `Tested API routes shifted from ${baseCovered}/${baseTotal} (${coverageDiff.metrics.endpointCoverage.baseline.pct.toFixed(0)}%) to ${currCovered}/${currTotal} (${coverageDiff.metrics.endpointCoverage.current.pct.toFixed(0)}%).`,
                whyItMatters: isIncrease
                    ? "Broader API surface is now guarded by automated integration contracts."
                    : "Regressive gap in endpoint testing; some endpoints lost test coverage.",
                evidenceCount: currCovered,
                targetTab: "TESTS",
                filter: isIncrease ? "NEWLY_COVERED" : "LOST_COVERAGE"
            });
        }
    } else if (coverageDiff && !coverageDiff.comparisonAvailable) {
        findings.push({
            id: "endpoint-coverage-unavailable",
            dimension: "TEST_SUITE",
            type: "INFO",
            severity: "MEDIUM",
            title: "Endpoint Coverage Evidence Unavailable",
            whatChanged: coverageDiff.reason || "Discovered API endpoints are missing for comparison.",
            whyItMatters: "Cannot compute endpoint coverage percentage without static endpoint inventory.",
            recommendedAction: coverageDiff.nextAction || "Run Project Structure Analysis to discover API endpoints."
        });
    }

    // 6. Project Code Revision
    if (sourceDiff?.status === "NO_SOURCE_CODE_CHANGES") {
        findings.push({
            id: "project-code-unchanged",
            dimension: "PROJECT_CODE",
            type: "UNCHANGED",
            severity: "NEUTRAL",
            title: "Project Application Code Unchanged",
            whatChanged: isSameSnapshot
                ? "Both runs executed on the same snapshot revision. Running tests does not alter application source code."
                : "Source trees have identical SHA-256 fingerprints across snapshots.",
            whyItMatters: "Isolates test behavior changes to test runner execution or test suite adjustments rather than source code modifications.",
            targetTab: "CODE"
        });
    } else if (sourceDiff?.status === "SOURCE_CHANGED") {
        const changedCount = (sourceDiff.files || []).filter(f => !f.isTestFile).length;
        findings.push({
            id: "project-code-modified",
            dimension: "PROJECT_CODE",
            type: "SOURCE_DIFF",
            severity: "HIGH",
            title: `Source Code Modified (${sourceDiff.summary?.newFilesCount || 0} New, ${sourceDiff.summary?.modifiedFilesCount || 0} Mod, ${sourceDiff.summary?.deletedFilesCount || 0} Del)`,
            whatChanged: `Application source files changed between snapshot versions (+${sourceDiff.summary?.totalAdditions || 0} / -${sourceDiff.summary?.totalDeletions || 0} lines).`,
            whyItMatters: "Source changes directly impact runtime logic and may explain any test regressions or fixes.",
            evidenceCount: changedCount,
            targetTab: "CODE",
            recommendedAction: "Review line-level code diffs in Project Code tab to correlate with test outcomes."
        });
    }

    // 7. Line Coverage Artifacts status
    if (coverageArtifactDiff && !coverageArtifactDiff.comparable) {
        findings.push({
            id: "coverage-artifacts-missing",
            dimension: "EXECUTION_OUTCOMES",
            type: "INFO",
            severity: "NEUTRAL",
            title: "Line Coverage Artifacts Unavailable",
            whatChanged: coverageArtifactDiff.reason,
            whyItMatters: "Line/branch coverage percentage delta cannot be calculated without recorded lcov/summary data.",
            recommendedAction: coverageArtifactDiff.nextAction
        });
    } else if (coverageArtifactDiff?.comparable && coverageArtifactDiff.deltaLinesPct != null) {
        const delta = coverageArtifactDiff.deltaLinesPct;
        if (Math.abs(delta) > 0.001) {
            findings.push({
                id: "line-coverage-delta",
                dimension: "EXECUTION_OUTCOMES",
                type: delta > 0 ? "COVERAGE_EXPANSION" : "COVERAGE_DROP",
                severity: delta > 0 ? "POSITIVE" : "MEDIUM",
                title: delta > 0 ? `Line Coverage Increased (+${delta.toFixed(1)}%)` : `Line Coverage Decreased (${delta.toFixed(1)}%)`,
                whatChanged: `Line coverage shifted from ${coverageArtifactDiff.baseline.linesPct.toFixed(1)}% to ${coverageArtifactDiff.current.linesPct.toFixed(1)}%.`,
                whyItMatters: delta > 0 ? "Greater percentage of application lines executed during test runs." : "Less code executed during tests.",
                targetTab: "OUTCOMES"
            });
        }
    }

    return findings;
}

/**
 * Assembles the full Before / After comparison payload across Source, Test Suite, Runtime, and Coverage.
 */
export async function getBeforeAfterComparisonService({
    projectId,
    baselineSnapshotId,
    currentSnapshotId,
    baselineRunId,
    currentRunId,
    baselineJobId,
    currentJobId,
    userId
}) {
    if (!projectId) throw new ServiceError("projectId is required", 400);

    // Verify ownership
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, ownerId: true }
    });
    if (!project) throw new ServiceError("Project not found", 404);
    if (userId && project.ownerId !== userId) throw new ServiceError("Forbidden", 403);

    // Disambiguate snapshot selection
    let snapAId = baselineSnapshotId;
    let snapBId = currentSnapshotId;
    let isAmbiguousBaseline = false;
    let ambiguityNotice = null;

    if (!snapBId && !snapAId) {
        const snapshots = await prisma.projectSnapshot.findMany({
            where: { projectId },
            orderBy: { createdAt: "desc" },
            take: 2
        });
        if (snapshots.length >= 2) {
            snapBId = snapshots[0].id;
            snapAId = snapshots[1].id;
        } else if (snapshots.length === 1) {
            snapBId = snapshots[0].id;
            snapAId = snapshots[0].id;
            isAmbiguousBaseline = true;
            ambiguityNotice = "Only 1 snapshot exists in this project. Comparing snapshot with itself across execution runs.";
        }
    } else if (snapBId && !snapAId) {
        // Current snapshot provided, but baseline is omitted: find preceding snapshot
        const currentSnap = await prisma.projectSnapshot.findUnique({
            where: { id: snapBId },
            select: { createdAt: true }
        });
        if (currentSnap) {
            const preceding = await prisma.projectSnapshot.findFirst({
                where: {
                    projectId,
                    createdAt: { lt: currentSnap.createdAt }
                },
                orderBy: { createdAt: "desc" }
            });
            if (preceding) {
                snapAId = preceding.id;
            } else {
                snapAId = snapBId;
                isAmbiguousBaseline = true;
                ambiguityNotice = "This is the initial snapshot in the project timeline. Baseline is set to the same snapshot.";
            }
        } else {
            snapAId = snapBId;
        }
    } else if (!snapBId && snapAId) {
        // Baseline provided, current omitted: pick latest snapshot
        const latest = await prisma.projectSnapshot.findFirst({
            where: { projectId },
            orderBy: { createdAt: "desc" }
        });
        snapBId = latest?.id || snapAId;
    }

    if (!snapAId || !snapBId) {
        throw new ServiceError("At least one snapshot is required to run Before/After comparison", 400);
    }

    const isSameSnapshot = snapAId === snapBId;

    // 1. Source Code Diff
    const sourceDiff = await compareSourceCodeService({
        projectId,
        baselineSnapshotId: snapAId,
        currentSnapshotId: snapBId,
        userId
    });

    // 2. Fetch Snapshots for artifact loading
    const [snapA, snapB] = await Promise.all([
        prisma.projectSnapshot.findUnique({ where: { id: snapAId }, select: { id: true, rootDir: true, commitSha: true } }),
        prisma.projectSnapshot.findUnique({ where: { id: snapBId }, select: { id: true, rootDir: true, commitSha: true } })
    ]);

    // 3. Test Suite Diff & Anomalies (Auto-discover latest jobs or fallback to DB)
    let jobAId = baselineJobId;
    let jobBId = currentJobId;

    if (!jobAId && snapA) {
        const lastJobA = await prisma.job.findFirst({
            where: { snapshotId: snapA.id, type: "AI_TESTS", status: "SUCCESS" },
            orderBy: { createdAt: "desc" }
        });
        if (lastJobA) jobAId = lastJobA.id;
    }
    if (!jobBId && snapB) {
        const lastJobB = await prisma.job.findFirst({
            where: { snapshotId: snapB.id, type: "AI_TESTS", status: "SUCCESS" },
            orderBy: { createdAt: "desc" }
        });
        if (lastJobB) jobBId = lastJobB.id;
    }

    const artifactA = (snapA && jobAId) ? getArchivedVersionArtifact(snapA.rootDir, jobAId) : null;
    const artifactB = (snapB && jobBId) ? getArchivedVersionArtifact(snapB.rootDir, jobBId) : null;

    let testsA = artifactA?.data?.tests || [];
    let testsB = artifactB?.data?.tests || [];
    let endpointsA = artifactA?.data?.endpoints || [];
    let endpointsB = artifactB?.data?.endpoints || [];

    // Fallback to database AiTest if artifact not found
    if (testsA.length === 0 && snapA) {
        const dbTestsA = await prisma.aiTest.findMany({ where: { snapshotId: snapA.id } });
        if (dbTestsA.length > 0) {
            testsA = dbTestsA.map(t => {
                let parsedMeta = {};
                try { parsedMeta = JSON.parse(t.metaJson || "{}"); } catch (_) {}
                return {
                    id: t.id,
                    name: parsedMeta.name || t.filePath || t.id,
                    filePath: t.filePath,
                    method: parsedMeta.method,
                    path: parsedMeta.path,
                    metaJson: t.metaJson,
                    content: t.content,
                    code: t.content
                };
            });
        }
    }
    if (testsB.length === 0 && snapB) {
        const dbTestsB = await prisma.aiTest.findMany({ where: { snapshotId: snapB.id } });
        if (dbTestsB.length > 0) {
            testsB = dbTestsB.map(t => {
                let parsedMeta = {};
                try { parsedMeta = JSON.parse(t.metaJson || "{}"); } catch (_) {}
                return {
                    id: t.id,
                    name: parsedMeta.name || t.filePath || t.id,
                    filePath: t.filePath,
                    method: parsedMeta.method,
                    path: parsedMeta.path,
                    metaJson: t.metaJson,
                    content: t.content,
                    code: t.content
                };
            });
        }
    }

    // Fallback to database ProjectStructureAnalysis if endpoints not found
    if (endpointsA.length === 0 && snapA) {
        const psaA = await prisma.projectStructureAnalysis.findUnique({ where: { snapshotId: snapA.id } });
        if (psaA?.resultJson) {
            try {
                const parsed = JSON.parse(psaA.resultJson);
                endpointsA = parsed.endpoints || parsed.routes || [];
            } catch (_) {}
        }
    }
    if (endpointsB.length === 0 && snapB) {
        const psaB = await prisma.projectStructureAnalysis.findUnique({ where: { snapshotId: snapB.id } });
        if (psaB?.resultJson) {
            try {
                const parsed = JSON.parse(psaB.resultJson);
                endpointsB = parsed.endpoints || parsed.routes || [];
            } catch (_) {}
        }
    }

    const testDiff = compareTestSuites(testsA, testsB);
    const anomalies = detectTestAnomalies(testsB, endpointsB);

    // Endpoint Inventory Diff
    const mapA = new Map();
    for (const ep of endpointsA || []) mapA.set(getEndpointIdentity(ep), ep);
    const mapB = new Map();
    for (const ep of endpointsB || []) mapB.set(getEndpointIdentity(ep), ep);

    const addedEndpoints = [];
    const removedEndpoints = [];
    const unchangedEndpoints = [];
    for (const [key, ep] of mapB.entries()) {
        if (!mapA.has(key)) addedEndpoints.push(ep);
        else unchangedEndpoints.push(ep);
    }
    for (const [key, ep] of mapA.entries()) {
        if (!mapB.has(key)) removedEndpoints.push(ep);
    }

    const endpointInventoryDiff = {
        comparisonAvailable: endpointsA.length > 0 || endpointsB.length > 0,
        baselineCount: mapA.size,
        currentCount: mapB.size,
        addedEndpoints,
        removedEndpoints,
        unchangedEndpoints
    };

    // 4. Runtime TestRuns Comparison
    let runtimeDiff = null;

    if (baselineRunId && currentRunId) {
        if (baselineRunId === currentRunId) {
            const run = await prisma.testRun.findUnique({ where: { id: baselineRunId }, include: { scenarios: true } });
            runtimeDiff = {
                comparisonAvailable: false,
                isSameRun: true,
                reason: "Baseline and current test run are identical (same run ID). Cannot compare a test run with itself.",
                message: "Cannot compare a test run with itself. Select two distinct test runs.",
                nextAction: "Select two distinct test runs to compare execution transitions.",
                runA: run,
                runB: run,
                previousRunId: baselineRunId,
                currentRunId: currentRunId
            };
        } else {
            const [runA, runB] = await Promise.all([
                prisma.testRun.findUnique({ where: { id: baselineRunId }, include: { scenarios: true } }),
                prisma.testRun.findUnique({ where: { id: currentRunId }, include: { scenarios: true } })
            ]);
            if (runA && runB) {
                runtimeDiff = compareTestRuns(runA, runB);
            } else {
                runtimeDiff = {
                    comparisonAvailable: false,
                    reason: !runA && !runB
                        ? "Both selected test runs could not be found."
                        : !runA
                        ? "Selected baseline test run could not be found."
                        : "Selected current test run could not be found.",
                    nextAction: "Select valid test runs from the timeline.",
                    runA: runA || null,
                    runB: runB || null,
                    previousRunId: baselineRunId,
                    currentRunId: currentRunId
                };
            }
        }
    } else if (isSameSnapshot) {
        // Same snapshot: look for distinct test runs on this snapshot
        const testRuns = await prisma.testRun.findMany({
            where: { snapshotId: snapAId, totalTests: { gt: 0 } },
            include: { scenarios: true },
            orderBy: { createdAt: "desc" },
            take: 2
        });
        if (testRuns.length >= 2) {
            // testRuns[1] is older (baseline), testRuns[0] is newer (current)
            runtimeDiff = compareTestRuns(testRuns[1], testRuns[0]);
        } else if (testRuns.length === 1) {
            runtimeDiff = {
                comparisonAvailable: false,
                isSameRun: false,
                reason: "Only 1 test run exists on this snapshot. At least two test runs are required to compare execution results.",
                nextAction: "Run tests again on this snapshot to record a second execution run for comparison.",
                runA: null,
                runB: testRuns[0],
                currentRunId: testRuns[0].id,
                previousRunId: null
            };
        } else {
            runtimeDiff = {
                comparisonAvailable: false,
                reason: "No test runs found for this snapshot.",
                nextAction: "Run tests to generate execution results.",
                runA: null,
                runB: null
            };
        }
    } else {
        // Different snapshots: auto-select latest test run for each
        const [runA, runB] = await Promise.all([
            prisma.testRun.findFirst({
                where: { snapshotId: snapAId, totalTests: { gt: 0 } },
                include: { scenarios: true },
                orderBy: { createdAt: "desc" }
            }),
            prisma.testRun.findFirst({
                where: { snapshotId: snapBId, totalTests: { gt: 0 } },
                include: { scenarios: true },
                orderBy: { createdAt: "desc" }
            })
        ]);
        if (runA && runB) {
            runtimeDiff = compareTestRuns(runA, runB);
        } else {
            runtimeDiff = {
                comparisonAvailable: false,
                reason: !runA && !runB
                    ? "Neither snapshot has test run records."
                    : !runA
                    ? "Baseline snapshot has no test run records."
                    : "Current snapshot has no test run records.",
                nextAction: "Run tests on snapshots to produce execution evidence.",
                runA: runA || null,
                runB: runB || null,
                previousRunId: runA?.id || null,
                currentRunId: runB?.id || null
            };
        }
    }

    // 5. Endpoint Coverage Detailed Breakdown
    const coverageDiff = compareEndpointCoverageDetailed(endpointsA, endpointsB, testsA, testsB);

    // 6. Evidence-Based Conclusions
    const conclusions = generateComparisonConclusions({
        sourceDiff,
        testDiff,
        runtimeDiff,
        coverageDiff
    });

    // 7. Segregated 3 Distinct Dimensions: Project Code, Test Suite, Execution Outcomes
    const allChangedFiles = sourceDiff.files || [];
    const changedTestFiles = allChangedFiles.filter(f => f.isTestFile);
    const changedSourceFiles = allChangedFiles.filter(f => !f.isTestFile);

    // Dimension 1: Project Code (Source code files only, no test files or temp artifacts)
    const projectCodeComparison = {
        mode: isSameSnapshot ? "SAME_SNAPSHOT" : "DISTINCT_SNAPSHOTS",
        comparisonAvailable: sourceDiff.comparisonAvailable,
        status: sourceDiff.status,
        reason: isSameSnapshot ? "Identical snapshot revision. Source files are identical." : sourceDiff.reason,
        files: changedSourceFiles,
        newCount: changedSourceFiles.filter(f => f.status === "NEW").length,
        modifiedCount: changedSourceFiles.filter(f => f.status === "MODIFIED").length,
        deletedCount: changedSourceFiles.filter(f => f.status === "DELETED").length,
        lineDiffSummary: {
            additions: changedSourceFiles.reduce((acc, f) => acc + (f.diff?.additions || f.additions || 0), 0),
            deletions: changedSourceFiles.reduce((acc, f) => acc + (f.diff?.deletions || f.deletions || 0), 0)
        }
    };

    // Coverage Artifact Diff (from test runs or snapshot coverage summaries)
    const fetchCovSummary = async (snapshotId) => {
        if (!snapshotId || typeof prisma.coverageSummary?.findUnique !== "function") return null;
        try {
            const res = await prisma.coverageSummary.findUnique({ where: { snapshotId } });
            return res || null;
        } catch (_) {
            return null;
        }
    };

    const [covSummA, covSummB] = await Promise.all([
        fetchCovSummary(snapAId),
        fetchCovSummary(snapBId)
    ]);

    const runACov = runtimeDiff?.runA?.coverageLinesPct ?? null;
    const runBCov = runtimeDiff?.runB?.coverageLinesPct ?? null;
    const baseLinesPct = runACov ?? covSummA?.linesPct ?? null;
    const currLinesPct = runBCov ?? covSummB?.linesPct ?? null;

    let coverageArtifactDiff;
    if (baseLinesPct != null && currLinesPct != null) {
        coverageArtifactDiff = {
            comparable: true,
            baseline: {
                linesPct: baseLinesPct,
                branchesPct: runtimeDiff?.runA?.coverageBranchesPct ?? covSummA?.branchesPct ?? null,
                stmtsPct: runtimeDiff?.runA?.coverageStatementsPct ?? covSummA?.stmtsPct ?? null,
                funcsPct: runtimeDiff?.runA?.coverageFunctionsPct ?? covSummA?.funcsPct ?? null,
                source: runACov != null ? "testRun" : "coverageSummary"
            },
            current: {
                linesPct: currLinesPct,
                branchesPct: runtimeDiff?.runB?.coverageBranchesPct ?? covSummB?.branchesPct ?? null,
                stmtsPct: runtimeDiff?.runB?.coverageStatementsPct ?? covSummB?.stmtsPct ?? null,
                funcsPct: runtimeDiff?.runB?.coverageFunctionsPct ?? covSummB?.funcsPct ?? null,
                source: runBCov != null ? "testRun" : "coverageSummary"
            },
            deltaLinesPct: parseFloat((currLinesPct - baseLinesPct).toFixed(2))
        };
    } else {
        coverageArtifactDiff = {
            comparable: false,
            reason: baseLinesPct == null && currLinesPct == null
                ? "Neither baseline nor current execution has coverage artifacts recorded."
                : baseLinesPct == null
                ? "Baseline execution has no line coverage artifacts recorded."
                : "Current execution has no line coverage artifacts recorded.",
            nextAction: "Execute Run Tests with coverage enabled to record coverage artifacts.",
            baseline: baseLinesPct != null ? { linesPct: baseLinesPct } : null,
            current: currLinesPct != null ? { linesPct: currLinesPct } : null,
            deltaLinesPct: null
        };
    }

    // Dimension 2: Test Suite (Test files diff + Scenario inventory diff + Endpoint inventory)
    const testSuiteComparison = {
        comparisonAvailable: testDiff.comparisonAvailable !== false,
        status: testDiff.status || "UNCHANGED",
        testFiles: {
            files: changedTestFiles,
            newCount: changedTestFiles.filter(f => f.status === "NEW").length,
            modifiedCount: changedTestFiles.filter(f => f.status === "MODIFIED").length,
            deletedCount: changedTestFiles.filter(f => f.status === "DELETED").length,
            lineDiffSummary: {
                additions: changedTestFiles.reduce((acc, f) => acc + (f.diff?.additions || f.additions || 0), 0),
                deletions: changedTestFiles.reduce((acc, f) => acc + (f.diff?.deletions || f.deletions || 0), 0)
            }
        },
        scenariosDiff: {
            ...testDiff,
            anomalies
        },
        endpointInventoryDiff
    };

    // Dimension 3: Execution Outcomes (Comparable test runs, scenario transitions, coverage diff)
    const executionOutcomesComparison = {
        comparisonAvailable: runtimeDiff?.comparisonAvailable || false,
        isSameRun: runtimeDiff?.isSameRun || false,
        reason: runtimeDiff?.reason || null,
        nextAction: runtimeDiff?.nextAction || null,
        status: conclusions.runtimeStatus,
        baselineRun: runtimeDiff?.runA ? {
            id: runtimeDiff.runA.id,
            status: runtimeDiff.runA.status,
            totalTests: runtimeDiff.runA.totalTests,
            passedTests: runtimeDiff.runA.passedTests,
            failedTests: runtimeDiff.runA.failedTests,
            durationMs: runtimeDiff.runA.durationMs,
            coverageLinesPct: runtimeDiff.runA.coverageLinesPct,
            createdAt: runtimeDiff.runA.createdAt
        } : null,
        currentRun: runtimeDiff?.runB ? {
            id: runtimeDiff.runB.id,
            status: runtimeDiff.runB.status,
            totalTests: runtimeDiff.runB.totalTests,
            passedTests: runtimeDiff.runB.passedTests,
            failedTests: runtimeDiff.runB.failedTests,
            durationMs: runtimeDiff.runB.durationMs,
            coverageLinesPct: runtimeDiff.runB.coverageLinesPct,
            createdAt: runtimeDiff.runB.createdAt
        } : null,
        scenarioTransitions: runtimeDiff?.matrix ? {
            regressions: runtimeDiff.matrix.passToFail || [],
            fixes: runtimeDiff.matrix.failToPass || [],
            stablePass: runtimeDiff.matrix.passToPass || [],
            stableFail: runtimeDiff.matrix.failToFail || [],
            newScenarios: runtimeDiff.matrix.newTests || [],
            removedScenarios: runtimeDiff.matrix.removedTests || [],
            skipped: runtimeDiff.matrix.skippedTests || [],
            unexecuted: runtimeDiff.matrix.unexecutedTests || []
        } : null,
        transitionsList: runtimeDiff?.transitions || [],
        coverageArtifactDiff,
        endpointCoverageScope: coverageDiff,
        durationDiffMs: runtimeDiff?.durationDiffMs ?? null
    };

    // Actionable Findings Engine
    const actionableFindings = generateActionableFindings({
        sourceDiff,
        testDiff,
        runtimeDiff,
        coverageDiff,
        coverageArtifactDiff,
        isSameSnapshot
    });

    // Selection diagnostics
    const selectionDiagnostics = {
        isSameSnapshot,
        isAmbiguousBaseline,
        ambiguityNotice,
        isSameRun: runtimeDiff?.isSameRun || false,
        baselineRunId: runtimeDiff?.previousRunId || baselineRunId || null,
        currentRunId: runtimeDiff?.currentRunId || currentRunId || null
    };

    // Backward compatibility aliases
    const projectVersionComparison = {
        mode: projectCodeComparison.mode,
        comparisonAvailable: projectCodeComparison.comparisonAvailable,
        status: projectCodeComparison.status,
        reason: projectCodeComparison.reason,
        sourceFilesDiff: {
            files: changedSourceFiles,
            newCount: projectCodeComparison.newCount,
            modifiedCount: projectCodeComparison.modifiedCount,
            deletedCount: projectCodeComparison.deletedCount
        },
        testFilesDiff: testSuiteComparison.testFiles,
        endpointInventoryDiff,
        testSuiteDiff: testSuiteComparison.scenariosDiff
    };
    const testRunComparison = executionOutcomesComparison;

    return {
        projectId,
        baselineSnapshotId: snapAId,
        currentSnapshotId: snapBId,
        baselineCommit: snapA?.commitSha,
        currentCommit: snapB?.commitSha,
        isSameSnapshot,
        comparisonMode: isSameSnapshot ? "SAME_SNAPSHOT_RUN_DIFF" : "PROJECT_VERSION_DIFF",
        actionableFindings,
        selectionDiagnostics,
        projectCodeComparison,
        testSuiteComparison,
        executionOutcomesComparison,
        projectVersionComparison,
        testRunComparison,
        conclusions,
        sourceDiff,
        testDiff: {
            ...testDiff,
            anomalies
        },
        runtimeDiff,
        coverageDiff
    };
}
