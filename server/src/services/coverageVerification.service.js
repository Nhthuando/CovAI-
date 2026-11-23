import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const WORKFLOW_STATES = Object.freeze({
    GENERATED: "GENERATED",
    GENERATED_TEST_PASSED: "GENERATED_TEST_PASSED",
    BASELINE_ALREADY_FULLY_COVERED: "BASELINE_ALREADY_FULLY_COVERED",
    REVIEWED: "REVIEWED",
    APPLIED: "APPLIED",
    POST_APPLY_EXECUTION_PASSED: "POST_APPLY_EXECUTION_PASSED",
    COVERAGE_GAIN_VERIFIED: "COVERAGE_GAIN_VERIFIED",
    NO_COVERAGE_GAIN: "NO_COVERAGE_GAIN",
    COVERAGE_VERIFICATION_BLOCKED: "COVERAGE_VERIFICATION_BLOCKED",
    APPLY_FAILED: "APPLY_FAILED",
    EXECUTION_FAILED: "EXECUTION_FAILED",
});

export function normalizeCovPath(filePath = "") {
    return String(filePath || "")
        .replaceAll("\\", "/")
        .replace(/^\/workspace\/?/i, "")
        .replace(/^\.?\//, "");
}

export function sha256Text(text = "") {
    return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

/**
 * Resolves a source file entry in an Istanbul coverage-final.json map,
 * handling container mounts (/workspace/), subproject prefixes, and OS separators.
 */
export function findIstanbulCoverageEntry(coverageMap = {}, targetSourceFile = "") {
    if (!coverageMap || typeof coverageMap !== "object" || !targetSourceFile) return null;
    const targetNorm = normalizeCovPath(targetSourceFile);
    const entries = Object.entries(coverageMap);

    // 1. Exact or suffix match
    const exactOrSuffix = entries.filter(([key]) => {
        const kNorm = normalizeCovPath(key);
        return kNorm === targetNorm || kNorm.endsWith("/" + targetNorm) || targetNorm.endsWith("/" + kNorm);
    });
    if (exactOrSuffix.length === 1) return exactOrSuffix[0][1];

    // 2. If multiple matches, prefer exact normalized equality
    const exact = exactOrSuffix.find(([key]) => normalizeCovPath(key) === targetNorm);
    if (exact) return exact[1];

    return null;
}

/**
 * Builds an immutable manifest identifying a test execution's suite & artifacts.
 */
export function buildTestSuiteManifest({
    executionId = crypto.randomUUID(),
    projectId = null,
    projectVersion = null,
    sourceRevisionHash = null,
    rootDir = "",
    testFiles = [],
    framework = "jest",
    generatedSuggestionIds = [],
    appliedSuggestionIds = [],
    coverageArtifactPath = null,
} = {}) {
    const uniqueFiles = [...new Set((testFiles || []).map(normalizeCovPath))].sort();
    const fileEntries = uniqueFiles.map((relPath) => {
        let contentHash = null;
        let exists = false;
        if (rootDir) {
            const fullPath = path.resolve(rootDir, relPath);
            try {
                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                    exists = true;
                    contentHash = sha256Text(fs.readFileSync(fullPath, "utf8"));
                }
            } catch {
                exists = false;
            }
        }
        return { path: relPath, contentHash, exists };
    });

    const manifestHash = sha256Text(
        fileEntries.map((f) => `${f.path}:${f.contentHash || "MISSING"}`).join("\n")
    );

    return {
        executionId,
        projectId,
        projectVersion,
        sourceRevisionHash,
        framework,
        testFiles: fileEntries,
        manifestHash,
        generatedSuggestionIds: [...generatedSuggestionIds],
        appliedSuggestionIds: [...appliedSuggestionIds],
        coverageArtifactPath,
        createdAt: new Date().toISOString(),
    };
}

/**
 * Diffs two test suite manifests by normalized path and content hash.
 */
export function diffTestManifests(baselineManifest = null, postApplyManifest = null) {
    const baseMap = new Map(
        (baselineManifest?.testFiles || []).filter((f) => f.exists).map((f) => [f.path, f.contentHash])
    );
    const postMap = new Map(
        (postApplyManifest?.testFiles || []).filter((f) => f.exists).map((f) => [f.path, f.contentHash])
    );

    const addedFiles = [];
    const modifiedFiles = [];
    const removedFiles = [];
    const unchangedFiles = [];

    for (const [filePath, postHash] of postMap.entries()) {
        if (!baseMap.has(filePath)) {
            addedFiles.push(filePath);
        } else if (baseMap.get(filePath) !== postHash) {
            modifiedFiles.push(filePath);
        } else {
            unchangedFiles.push(filePath);
        }
    }
    for (const filePath of baseMap.keys()) {
        if (!postMap.has(filePath)) {
            removedFiles.push(filePath);
        }
    }

    return { addedFiles, modifiedFiles, removedFiles, unchangedFiles };
}

/**
 * Validates baseline vs post-apply suite identity & coverage artifact independence.
 */
export function validateExecutionScopeAndArtifacts({
    baselineManifest = null,
    postApplyManifest = null,
    expectedAppliedTestFiles = [],
    reusedExistingTests = false,
    stagedFilesByPath = null,
    discoveredTestFiles = null,
    appliedSuggestions = [],
} = {}) {
    const normalizedExpected = [...new Set((expectedAppliedTestFiles || []).map(normalizeCovPath))];
    const postFiles = (postApplyManifest?.testFiles || []).filter((f) => f.exists);
    const postApplyMap = new Map(postFiles.map((f) => [f.path, f.contentHash]));
    const postApplySet = new Set(postFiles.map((f) => f.path));
    const missingAppliedTestFiles = normalizedExpected.filter((f) => !postApplySet.has(f));
    const manifestDiff = diffTestManifests(baselineManifest, postApplyManifest);

    if (!postApplyManifest) {
        return { valid: false, reason: "POST_APPLY_MANIFEST_MISSING", missingAppliedTestFiles, manifestDiff, filesystemVerified: false, testDiscoveryStatus: "UNKNOWN" };
    }

    // 1. Verify actual filesystem writes against staged content hashes
    let filesystemVerified = true;
    if (stagedFilesByPath && typeof stagedFilesByPath === "object") {
        const entries = stagedFilesByPath instanceof Map ? [...stagedFilesByPath.entries()] : Object.entries(stagedFilesByPath);
        for (const [rawPath, expectedHash] of entries) {
            const norm = normalizeCovPath(rawPath);
            if (!postApplySet.has(norm) || (expectedHash && postApplyMap.get(norm) !== expectedHash)) {
                filesystemVerified = false;
                return {
                    valid: false,
                    reason: "FILE_WRITE_NOT_CONFIRMED",
                    missingAppliedTestFiles: postApplySet.has(norm) ? missingAppliedTestFiles : [...new Set([...missingAppliedTestFiles, norm])],
                    manifestDiff,
                    filesystemVerified: false,
                    testDiscoveryStatus: "NOT_VERIFIED",
                };
            }
        }
    }

    // 2. Verify Jest/Vitest test discovery includes applied files
    let testDiscoveryStatus = "VERIFIED";
    if (Array.isArray(discoveredTestFiles)) {
        const discoveredSet = new Set(discoveredTestFiles.map(normalizeCovPath));
        const undiscovered = normalizedExpected.filter((f) => postApplySet.has(f) && !discoveredSet.has(f));
        if (undiscovered.length > 0) {
            testDiscoveryStatus = "MISCONFIGURED_OR_IGNORED";
            return {
                valid: false,
                reason: "TEST_DISCOVERY_MISCONFIGURED",
                missingAppliedTestFiles: undiscovered,
                manifestDiff,
                filesystemVerified,
                testDiscoveryStatus,
            };
        }
    }

    if (baselineManifest && baselineManifest.executionId === postApplyManifest.executionId) {
        return { valid: false, reason: "SAME_EXECUTION_ID_REUSED", missingAppliedTestFiles, manifestDiff, filesystemVerified, testDiscoveryStatus };
    }
    if (
        baselineManifest?.projectId &&
        postApplyManifest.projectId &&
        baselineManifest.projectId !== postApplyManifest.projectId
    ) {
        return { valid: false, reason: "PROJECT_ID_MISMATCH", missingAppliedTestFiles, manifestDiff, filesystemVerified, testDiscoveryStatus };
    }
    if (
        baselineManifest?.sourceRevisionHash &&
        postApplyManifest.sourceRevisionHash &&
        baselineManifest.sourceRevisionHash !== postApplyManifest.sourceRevisionHash
    ) {
        return { valid: false, reason: "SOURCE_REVISION_MISMATCH", missingAppliedTestFiles, manifestDiff, filesystemVerified, testDiscoveryStatus };
    }
    if (
        baselineManifest?.coverageArtifactPath &&
        postApplyManifest.coverageArtifactPath &&
        normalizeCovPath(baselineManifest.coverageArtifactPath) === normalizeCovPath(postApplyManifest.coverageArtifactPath)
    ) {
        return { valid: false, reason: "COVERAGE_ARTIFACT_OVERWRITTEN", missingAppliedTestFiles, manifestDiff, filesystemVerified, testDiscoveryStatus };
    }
    if (missingAppliedTestFiles.length > 0) {
        return { valid: false, reason: "APPLIED_TEST_FILES_MISSING_FROM_SUITE", missingAppliedTestFiles, manifestDiff, filesystemVerified, testDiscoveryStatus };
    }

    const manifestUnchanged = Boolean(
        baselineManifest &&
        baselineManifest.manifestHash === postApplyManifest.manifestHash &&
        manifestDiff.addedFiles.length === 0 &&
        manifestDiff.modifiedFiles.length === 0 &&
        manifestDiff.removedFiles.length === 0 &&
        !reusedExistingTests
    );
    if (manifestUnchanged) {
        const noneChanged = Array.isArray(appliedSuggestions) && appliedSuggestions.length > 0 && appliedSuggestions.every((s) => s.changed === false);
        const reason = noneChanged
            ? "APPLY_NOT_PERFORMED"
            : (manifestDiff.unchangedFiles.length > 0 ? "CONTENT_UNCHANGED" : "TEST_MANIFEST_UNCHANGED");
        return { valid: false, reason, missingAppliedTestFiles, manifestDiff, filesystemVerified, testDiscoveryStatus };
    }

    return { valid: true, reason: null, missingAppliedTestFiles: [], manifestDiff, filesystemVerified, testDiscoveryStatus };
}

function summarizeFileCounters(entry) {
    const sIds = Object.keys(entry?.statementMap || {});
    const sCovered = sIds.filter((id) => (entry?.s?.[id] || 0) > 0);

    const bEntries = [];
    for (const [id, meta] of Object.entries(entry?.branchMap || {})) {
        const counts = entry?.b?.[id] || [];
        const locs = meta?.locations || [];
        for (let i = 0; i < Math.max(counts.length, locs.length); i++) {
            bEntries.push({ id: `${id}:${i}`, hits: counts[i] || 0 });
        }
    }
    const bCovered = bEntries.filter((b) => b.hits > 0).map((b) => b.id);

    const fIds = Object.keys(entry?.fnMap || {});
    const fCovered = fIds.filter((id) => (entry?.f?.[id] || 0) > 0);

    const lineHits = new Map();
    for (const [id, meta] of Object.entries(entry?.statementMap || {})) {
        const line = meta?.start?.line;
        if (line == null) continue;
        const prev = lineHits.get(line) || 0;
        lineHits.set(line, Math.max(prev, entry?.s?.[id] || 0));
    }
    const lIds = [...lineHits.keys()].map(String);
    const lCovered = [...lineHits.entries()].filter(([, h]) => h > 0).map(([l]) => String(l));

    const pct = (cov, tot) => (tot === 0 ? 100 : Number(((cov / tot) * 100).toFixed(2)));
    return {
        statements: { coveredIds: new Set(sCovered), covered: sCovered.length, total: sIds.length, pct: pct(sCovered.length, sIds.length) },
        branches: { coveredIds: new Set(bCovered), covered: bCovered.length, total: bEntries.length, pct: pct(bCovered.length, bEntries.length) },
        functions: { coveredIds: new Set(fCovered), covered: fCovered.length, total: fIds.length, pct: pct(fCovered.length, fIds.length) },
        lines: { coveredIds: new Set(lCovered), covered: lCovered.length, total: lIds.length, pct: pct(lCovered.length, lIds.length) },
    };
}

/**
 * Compares baseline vs post-apply Istanbul coverage for targeted source files.
 */
export function compareTargetedCoverage({
    baselineCoverage = {},
    postApplyCoverage = {},
    targetSourceFiles = [],
    coverageThreshold = 100,
} = {}) {
    const perSource = [];
    const allNewlyCovered = { statementIds: [], branchIds: [], functionIds: [], lineIds: [] };

    for (const sf of targetSourceFiles) {
        const baseEntry = findIstanbulCoverageEntry(baselineCoverage, sf);
        const postEntry = findIstanbulCoverageEntry(postApplyCoverage, sf);

        const baseSum = summarizeFileCounters(baseEntry);
        const postSum = summarizeFileCounters(postEntry);

        const diffIds = (postSet, baseSet) => [...postSet].filter((id) => !baseSet.has(id));
        const newStmts = diffIds(postSum.statements.coveredIds, baseSum.statements.coveredIds);
        const newBranches = diffIds(postSum.branches.coveredIds, baseSum.branches.coveredIds);
        const newFuncs = diffIds(postSum.functions.coveredIds, baseSum.functions.coveredIds);
        const newLines = diffIds(postSum.lines.coveredIds, baseSum.lines.coveredIds);

        allNewlyCovered.statementIds.push(...newStmts.map((id) => `${sf}:${id}`));
        allNewlyCovered.branchIds.push(...newBranches.map((id) => `${sf}:${id}`));
        allNewlyCovered.functionIds.push(...newFuncs.map((id) => `${sf}:${id}`));
        allNewlyCovered.lineIds.push(...newLines.map((id) => `${sf}:${id}`));

        const hasTargetGain =
            newStmts.length > 0 || newBranches.length > 0 || newFuncs.length > 0 || newLines.length > 0;
        const meets100 =
            postEntry !== null &&
            postSum.statements.pct >= coverageThreshold &&
            postSum.branches.pct >= coverageThreshold &&
            postSum.functions.pct >= coverageThreshold &&
            postSum.lines.pct >= coverageThreshold;
        const baselineFullyCovered = baseSum.statements.total > 0 &&
            Object.values(baseSum).every(metric => metric.covered === metric.total);

        perSource.push({
            sourceFile: sf,
            foundInPostApply: Boolean(postEntry),
            baselineFullyCovered,
            baseline: {
                statements: { covered: baseSum.statements.covered, total: baseSum.statements.total, pct: baseSum.statements.pct },
                branches: { covered: baseSum.branches.covered, total: baseSum.branches.total, pct: baseSum.branches.pct },
                functions: { covered: baseSum.functions.covered, total: baseSum.functions.total, pct: baseSum.functions.pct },
                lines: { covered: baseSum.lines.covered, total: baseSum.lines.total, pct: baseSum.lines.pct },
            },
            postApply: {
                statements: { covered: postSum.statements.covered, total: postSum.statements.total, pct: postSum.statements.pct },
                branches: { covered: postSum.branches.covered, total: postSum.branches.total, pct: postSum.branches.pct },
                functions: { covered: postSum.functions.covered, total: postSum.functions.total, pct: postSum.functions.pct },
                lines: { covered: postSum.lines.covered, total: postSum.lines.total, pct: postSum.lines.pct },
            },
            gainPct: {
                statements: Number((postSum.statements.pct - baseSum.statements.pct).toFixed(2)),
                branches: Number((postSum.branches.pct - baseSum.branches.pct).toFixed(2)),
                functions: Number((postSum.functions.pct - baseSum.functions.pct).toFixed(2)),
                lines: Number((postSum.lines.pct - baseSum.lines.pct).toFixed(2)),
            },
            newlyCovered: {
                statementIds: newStmts,
                branchIds: newBranches,
                functionIds: newFuncs,
                lineIds: newLines,
            },
            hasTargetGain,
            allFourMetricsAtThreshold: meets100,
        });
    }

    return {
        perSource,
        newlyCovered: allNewlyCovered,
        hasAnyTargetGain: perSource.some((s) => s.hasTargetGain),
        allTargetsAtThreshold: perSource.length > 0 && perSource.every((s) => s.allFourMetricsAtThreshold),
    };
}

/**
 * Builds structured diagnostics for coverage verification outcomes.
 */
export function buildCoverageVerificationDiagnostics({
    workflowState = WORKFLOW_STATES.COVERAGE_VERIFICATION_BLOCKED,
    baselineManifest = null,
    postApplyManifest = null,
    scopeValidation = null,
    coverageComparison = null,
    targetSourceFiles = [],
    targetFunctions = [],
    projectRoot = null,
    configPath = null,
    failureReason = null,
} = {}) {
    return {
        workflowState,
        baselineExecutionId: baselineManifest?.executionId || null,
        postApplyExecutionId: postApplyManifest?.executionId || null,
        baselineManifestHash: baselineManifest?.manifestHash || null,
        postApplyManifestHash: postApplyManifest?.manifestHash || null,
        baselineTestFileCount: (baselineManifest?.testFiles || []).filter((f) => f.exists).length,
        postApplyTestFileCount: (postApplyManifest?.testFiles || []).filter((f) => f.exists).length,
        addedFiles: scopeValidation?.manifestDiff?.addedFiles || [],
        modifiedFiles: scopeValidation?.manifestDiff?.modifiedFiles || [],
        removedFiles: scopeValidation?.manifestDiff?.removedFiles || [],
        appliedSuggestionIds: postApplyManifest?.appliedSuggestionIds || [],
        filesystemVerified: scopeValidation?.filesystemVerified ?? null,
        testDiscoveryStatus: scopeValidation?.testDiscoveryStatus || "UNKNOWN",
        projectRoot,
        configPath,
        missingGeneratedTestFiles: scopeValidation?.missingAppliedTestFiles || [],
        baselineCoverageArtifact: baselineManifest?.coverageArtifactPath || null,
        postApplyCoverageArtifact: postApplyManifest?.coverageArtifactPath || null,
        targetSourceFiles,
        targetFunctions,
        baselineMetrics: coverageComparison?.perSource?.map((s) => ({ sourceFile: s.sourceFile, ...s.baseline })) || [],
        postApplyMetrics: coverageComparison?.perSource?.map((s) => ({ sourceFile: s.sourceFile, ...s.postApply })) || [],
        newlyCovered: coverageComparison?.newlyCovered || { statementIds: [], branchIds: [], functionIds: [], lineIds: [] },
        failureReason: failureReason || scopeValidation?.reason || null,
    };
}
