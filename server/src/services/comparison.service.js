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

    // Check if source code is completely identical
    if (scanA.compositeHash && scanA.compositeHash === scanB.compositeHash) {
        return {
            comparisonAvailable: true,
            status: "NO_SOURCE_CODE_CHANGES",
            sourceChanged: false,
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
                totalDeletions: 0
            },
            files: [],
            excludedFiles: [...new Set([...scanA.excludedFiles, ...scanB.excludedFiles])]
        };
    }

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

        if (!fileA) {
            newFilesCount++;
            totalAdditions += fileB.lines;
            files.push({
                filePath: relPath,
                status: "NEW",
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
            deletedFilesCount++;
            totalDeletions += fileA.lines;
            files.push({
                filePath: relPath,
                status: "DELETED",
                additions: 0,
                deletions: fileA.lines,
                sizeA: fileA.size,
                hashA: fileA.hash
            });
        }
    }

    return {
        comparisonAvailable: true,
        status: "SOURCE_CHANGED",
        sourceChanged: true,
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
            totalDeletions
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

    // Map test cases to endpoints
    const testsPerEpA = new Map();
    for (const t of testsA || []) {
        const epKey = t.method && t.path ? `${t.method.toUpperCase()} ${normalizeRoutePath(t.path)}` : null;
        if (epKey) {
            if (!testsPerEpA.has(epKey)) testsPerEpA.set(epKey, []);
            testsPerEpA.get(epKey).push(t);
        }
    }

    const testsPerEpB = new Map();
    for (const t of testsB || []) {
        const epKey = t.method && t.path ? `${t.method.toUpperCase()} ${normalizeRoutePath(t.path)}` : null;
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

    const totalA = mapA.size;
    const totalB = mapB.size;

    const coveragePctA = totalA > 0 ? (coveredCountA / totalA) * 100 : 0;
    const coveragePctB = totalB > 0 ? (coveredCountB / totalB) * 100 : 0;

    return {
        endpointComparisons,
        metrics: {
            endpointCoverage: {
                baseline: { covered: coveredCountA, total: totalA, pct: coveragePctA },
                current: { covered: coveredCountB, total: totalB, pct: coveragePctB },
                deltaPct: coveragePctB - coveragePctA
            },
            testCount: {
                baseline: testsA.length,
                current: testsB.length,
                delta: testsB.length - testsA.length
            }
        }
    };
}

/**
 * Derives rigorous, evidence-backed conclusions without fake scores.
 */
export function generateComparisonConclusions({
    sourceDiff,
    testDiff,
    runtimeDiff,
    coverageDiff
}) {
    // 1. Source Status
    let sourceStatus = "INSUFFICIENT_EVIDENCE";
    if (sourceDiff) {
        sourceStatus = sourceDiff.status === "NO_SOURCE_CODE_CHANGES"
            ? "NO_SOURCE_CODE_CHANGES"
            : "SOURCE_CHANGED";
    }

    // 2. Test Coverage Status (strictly based on endpoint coverage, not just total tests!)
    let testCoverageStatus = "INSUFFICIENT_EVIDENCE";
    if (coverageDiff?.metrics?.endpointCoverage) {
        const delta = coverageDiff.metrics.endpointCoverage.deltaPct;
        if (delta > 0.001) testCoverageStatus = "TEST_COVERAGE_INCREASED";
        else if (delta < -0.001) testCoverageStatus = "TEST_COVERAGE_DECREASED";
        else testCoverageStatus = "TEST_COVERAGE_UNCHANGED";
    }

    // 3. Runtime Status
    let runtimeStatus = "INSUFFICIENT_EVIDENCE";
    if (runtimeDiff?.summary) {
        if (runtimeDiff.summary.regressionsCount > 0) {
            runtimeStatus = "RUNTIME_REGRESSION_DETECTED";
        } else if (runtimeDiff.summary.fixesCount > 0) {
            runtimeStatus = "RUNTIME_IMPROVEMENT_OBSERVED";
        } else if (runtimeDiff.summary.totalCompared > 0) {
            runtimeStatus = "RUNTIME_STABLE";
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
        warnings,
        hasRegressions: (runtimeDiff?.summary?.regressionsCount || 0) > 0,
        hasImprovements: (runtimeDiff?.summary?.fixesCount || 0) > 0
    };
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

    // If snapshot IDs not provided, pick latest two snapshots
    let snapAId = baselineSnapshotId;
    let snapBId = currentSnapshotId;

    if (!snapAId || !snapBId) {
        const snapshots = await prisma.projectSnapshot.findMany({
            where: { projectId },
            orderBy: { createdAt: "desc" },
            take: 2
        });
        if (snapshots.length >= 2) {
            snapBId = snapBId || snapshots[0].id;
            snapAId = snapAId || snapshots[1].id;
        } else if (snapshots.length === 1) {
            snapBId = snapBId || snapshots[0].id;
            snapAId = snapAId || snapshots[0].id;
        }
    }

    if (!snapAId || !snapBId) {
        throw new ServiceError("At least one snapshot is required to run Before/After comparison", 400);
    }

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

    // 4. Runtime TestRuns Comparison
    let runtimeDiff = null;
    if (baselineRunId && currentRunId) {
        const [runA, runB] = await Promise.all([
            prisma.testRun.findUnique({ where: { id: baselineRunId }, include: { scenarios: true } }),
            prisma.testRun.findUnique({ where: { id: currentRunId }, include: { scenarios: true } })
        ]);
        if (runA && runB) {
            runtimeDiff = compareTestRuns(runA, runB);
        }
    } else {
        // Auto-select latest test runs for the respective snapshots
        if (snapAId !== snapBId) {
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
            }
        } else {
            const testRuns = await prisma.testRun.findMany({
                where: { snapshotId: snapAId, totalTests: { gt: 0 } },
                include: { scenarios: true },
                orderBy: { createdAt: "desc" },
                take: 2
            });
            if (testRuns.length >= 2) {
                runtimeDiff = compareTestRuns(testRuns[1], testRuns[0]);
            } else if (testRuns.length === 1) {
                runtimeDiff = compareTestRuns(testRuns[0], testRuns[0]);
            }
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

    return {
        projectId,
        baselineSnapshotId: snapAId,
        currentSnapshotId: snapBId,
        baselineCommit: snapA?.commitSha,
        currentCommit: snapB?.commitSha,
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
