/**
 * @file snapshotReuse.service.js
 * @description Snapshot history reuse — finds an existing fully-processed snapshot
 *   that matches the current upload (by checksum or commitSha) and returns its
 *   cached artefacts so the pipeline can be skipped entirely.
 *
 * Public API
 * ----------
 *   reuseSnapshotHistory({ projectId, checksum, commitSha, excludeSnapshotId? })
 *     → CachedResult | null
 *
 *   findReusableSnapshot({ projectId, checksum, commitSha, excludeSnapshotId? })
 *     → { id: string } | null
 *
 *   getCachedResult(snapshotId)
 *     → CachedResult
 */

import prisma from "../config/prisma.js";

// ---------------------------------------------------------------------------
// Types (JSDoc — no runtime cost)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ field: "checksum" | "commitSha", value: string }} SnapshotKey
 *
 * @typedef {{
 *   reused:          true,
 *   sourceSnapshotId: string,
 *   coverageSummary: import("@prisma/client").CoverageSummary | null,
 *   coverageFiles:   import("@prisma/client").CoverageFile[],
 *   coverageFunctions: import("@prisma/client").CoverageFunction[],
 *   cfgs:            import("@prisma/client").Cfg[],
 *   cyclomatic:      import("@prisma/client").Cyclomatic[],
 *   aiSuggestions:   import("@prisma/client").AiSuggestion[],
 *   aiTests:         import("@prisma/client").AiTest[],
 * }} CachedResult
 */

// ---------------------------------------------------------------------------
// 1. HASH RESOLUTION
// ---------------------------------------------------------------------------

/**
 * Resolves which field/value pair to use when looking up a matching snapshot.
 * Checksum takes precedence over commitSha.
 *
 * @param {{ checksum?: string | null, commitSha?: string | null }} params
 * @returns {SnapshotKey | null}
 */
function resolveSnapshotKey({ checksum, commitSha }) {
    const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

    if (trimmed(checksum)) return { field: "checksum", value: trimmed(checksum) };
    if (trimmed(commitSha)) return { field: "commitSha", value: trimmed(commitSha) };

    return null;
}

// ---------------------------------------------------------------------------
// 2. FIND REUSABLE SNAPSHOT
// ---------------------------------------------------------------------------

/**
 * Looks for the most recent snapshot in the same project that shares the same
 * checksum or commitSha.  Optionally excludes one snapshot ID (e.g. the one
 * just created) to avoid self-matching.
 *
 * @param {{
 *   projectId:          string,
 *   checksum?:          string | null,
 *   commitSha?:         string | null,
 *   excludeSnapshotId?: string | null,
 * }} params
 * @returns {Promise<{ id: string } | null>}
 */
export async function findReusableSnapshot({
    projectId,
    checksum,
    commitSha,
    excludeSnapshotId = null,
}) {
    const key = resolveSnapshotKey({ checksum, commitSha });
    if (!key) return null;

    return prisma.projectSnapshot.findFirst({
        where: {
            projectId,
            [key.field]: key.value,
            ...(excludeSnapshotId ? { id: { not: excludeSnapshotId } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
    });
}

// ---------------------------------------------------------------------------
// 3. VALIDATE SNAPSHOT COMPLETENESS
// ---------------------------------------------------------------------------

/**
 * Determines whether a snapshot has enough processed artefacts to be reused.
 *
 * Required:
 *   • CoverageSummary
 *   • CoverageFile
 *   • CoverageFunction
 *   • Cfg
 *   • Cyclomatic
 *   • AiSuggestion
 *   • AiTest
 *
 * @param {string} snapshotId
 * @returns {Promise<boolean>}
 */
async function isSnapshotReusable(snapshotId) {
    console.log(`[SnapshotReuse] Validating artifacts for snapshot: ${snapshotId}`);

    const [
        coverageSummary,
        coverageFileCount,
        coverageFunctionCount,
        cfgCount,
        cyclomaticCount,
        aiSuggestionCount,
        aiTestCount,
    ] = await Promise.all([
        prisma.coverageSummary.findUnique({
            where: { snapshotId },
            select: { id: true },
        }),
        prisma.coverageFile.count({ where: { snapshotId } }),
        prisma.coverageFunction.count({ where: { snapshotId } }),
        prisma.cfg.count({ where: { snapshotId } }),
        prisma.cyclomatic.count({ where: { snapshotId } }),
        prisma.aiSuggestion.count({ where: { snapshotId } }),
        prisma.aiTest.count({ where: { snapshotId } }),
    ]);

    const missing = [];
    if (!coverageSummary) missing.push('CoverageSummary');
    if (coverageFileCount === 0) missing.push('CoverageFile');
    if (coverageFunctionCount === 0) missing.push('CoverageFunction');
    if (cfgCount === 0) missing.push('Cfg');
    if (cyclomaticCount === 0) missing.push('Cyclomatic');
    if (aiSuggestionCount === 0) missing.push('AiSuggestion');
    if (aiTestCount === 0) missing.push('AiTest');

    if (missing.length > 0) {
        console.log(`[SnapshotReuse] Missing artifacts: ${missing.join(', ')}`);
        return false;
    }

    console.log(`[SnapshotReuse] Snapshot reusable`);
    return true;
}

// ---------------------------------------------------------------------------
// 4. LOAD CACHED ARTEFACTS
// ---------------------------------------------------------------------------

/**
 * Fetches all processed artefacts for a snapshot in parallel.
 *
 * @param {string} snapshotId
 * @returns {Promise<CachedResult>}
 */
export async function getCachedResult(snapshotId) {
    const [
        coverageSummary,
        coverageFiles,
        coverageFunctions,
        cfgs,
        cyclomatic,
        aiSuggestions,
        aiTests,
    ] = await Promise.all([
        prisma.coverageSummary.findUnique({ where: { snapshotId } }),
        prisma.coverageFile.findMany({ where: { snapshotId } }),
        prisma.coverageFunction.findMany({ where: { snapshotId } }),
        prisma.cfg.findMany({ where: { snapshotId } }),
        prisma.cyclomatic.findMany({ where: { snapshotId } }),
        prisma.aiSuggestion.findMany({ where: { snapshotId } }),
        prisma.aiTest.findMany({ where: { snapshotId } }),
    ]);

    return {
        reused: true,
        sourceSnapshotId: snapshotId,
        coverageSummary,
        coverageFiles,
        coverageFunctions,
        cfgs,
        cyclomatic,
        aiSuggestions,
        aiTests,
    };
}

// ---------------------------------------------------------------------------
// 5. MAIN ENTRY POINT
// ---------------------------------------------------------------------------

/**
 * Attempts to reuse a previously processed snapshot.
 *
 * Steps:
 *   1. Resolve the lookup key (checksum → commitSha, in that order).
 *   2. Find the most recent matching snapshot in the same project.
 *   3. Verify it has sufficient processed artefacts.
 *   4. Return all cached artefacts — or null if no reusable snapshot exists.
 *
 * @param {{
 *   projectId:          string,
 *   checksum?:          string | null,
 *   commitSha?:         string | null,
 *   excludeSnapshotId?: string | null,
 * }} params
 * @returns {Promise<CachedResult | null>}
 */
export async function reuseSnapshotHistory({
    projectId,
    checksum,
    commitSha,
    excludeSnapshotId = null,
}) {
    const snapshot = await findReusableSnapshot({
        projectId,
        checksum,
        commitSha,
        excludeSnapshotId,
    });

    if (!snapshot) return null;

    const ready = await isSnapshotReusable(snapshot.id);
    if (!ready) return null;

    return getCachedResult(snapshot.id);
}