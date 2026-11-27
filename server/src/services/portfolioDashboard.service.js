/**
 * @file portfolioDashboard.service.js
 * @description High-performance, O(1)-round batch aggregator for the Multi-Project
 * Quality Portfolio Dashboard. Enforces Strict KPI Scope (DOING-only), OWNER-only
 * lifecycle RBAC metadata, real Snapshot/VCS branch resolution, shared governance
 * formulas (50/30/20 re-normalized), zero N+1 queries, and zero synthetic data.
 */

import prisma from "../config/prisma.js";
import { membershipWhere } from "./projectAccess.service.js";
import { getCachedIntegrationSummary } from "./integrationWorkspace.service.js";
import { coverageSummaryFor } from "./systemAssessmentContract.service.js";
import { getQueueRuntimeTelemetry } from "./queue.service.js";
import { isApiFilePath } from "../utils/apiFileDetector.js";
import {
  computeProjectTimeAndRoiMetrics,
  aggregatePortfolioTimeAndRoi,
} from "./portfolioTimeRoi.calculator.js";
import {
  PORTFOLIO_QUALITY_GATE,
  PORTFOLIO_RISK_QUADRANT_CUTOFFS,
  canManageProjectLifecycle,
  classifyRiskQuadrant,
  computeNormalizedWeightedAverage,
  computePassRatePct,
  computeProjectHealthAndCoverage,
  isKpiIncludedLifecycleStatus,
  roundMetric,
  safeParseMetaJson,
} from "../../../shared/portfolioGovernance.js";

const UNIT_RUN_TYPES = new Set(["JEST", "VITEST"]);
const INTEGRATION_RUN_TYPES = new Set(["SUPERTEST", "PLAYWRIGHT_API"]);
const SYSTEM_RUN_TYPES = new Set(["PLAYWRIGHT", "CYPRESS"]);

function getPillarForRunType(runType) {
  const t = String(runType || "").toUpperCase();
  if (UNIT_RUN_TYPES.has(t)) return "unit";
  if (INTEGRATION_RUN_TYPES.has(t)) return "integration";
  if (SYSTEM_RUN_TYPES.has(t)) return "system";
  return "unit";
}

function toTimestampMs(value) {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime() || 0;
}

// Cache for warm repeat responses (default prisma instance)
const portfolioCache = new Map();
const inFlightPortfolioBuilds = new Map();
const PORTFOLIO_CACHE_TTL_MS = 5 * 60 * 1000;

export function computePortfolioFingerprintFromData({
  projects = [],
  latestRun = null,
  latestJob = null,
  activeJobCount = 0,
  aiTestsCount = 0,
}) {
  if (!Array.isArray(projects) || projects.length === 0) return "empty";

  const projStr = projects
    .map(
      (p) =>
        `${p.id}:${toTimestampMs(p.updatedAt)}:${p.lifecycleStatus || ""}:${toTimestampMs(p.lifecycleUpdatedAt)}:${p.activeSnapshotId || ""}:${p.activeVcsBranchId || ""}:${p.isPinned ? 1 : 0}`,
    )
    .join("|");

  return `${projStr}__R:${latestRun?.id || ""}_${latestRun?.status || ""}_${toTimestampMs(latestRun?.createdAt)}__J:${latestJob?.id || ""}_${latestJob?.status || ""}_${activeJobCount}__AI:${aiTestsCount}`;
}

export async function getPortfolioFingerprint(userId, db = prisma) {
  try {
    const accessibleProjects = await db.project.findMany({
      where: membershipWhere(userId),
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        updatedAt: true,
        lifecycleStatus: true,
        lifecycleUpdatedAt: true,
        activeSnapshotId: true,
        activeVcsBranchId: true,
        isPinned: true,
      },
    });
    if (!accessibleProjects || accessibleProjects.length === 0) return "empty";

    const projectIds = accessibleProjects.map((p) => p.id);
    const [latestRun, latestJob, activeJobCount, aiTestsCount] = await Promise.all([
      db.testRun.findFirst({
        where: { snapshot: { projectId: { in: projectIds } } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true },
      }),
      db.job.findFirst({
        where: { projectId: { in: projectIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true },
      }),
      db.job.count({
        where: {
          projectId: { in: projectIds },
          status: { in: ["QUEUED", "RUNNING"] },
        },
      }),
      db.aiTest.count({
        where: { projectId: { in: projectIds } },
      }),
    ]);

    return computePortfolioFingerprintFromData({
      projects: accessibleProjects,
      latestRun,
      latestJob,
      activeJobCount,
      aiTestsCount,
    });
  } catch (err) {
    console.warn("[getPortfolioFingerprint] Error calculating fingerprint:", err?.message || err);
    return null;
  }
}

export function invalidatePortfolioCache(userId = null) {
  if (userId) {
    portfolioCache.delete(userId);
  } else {
    portfolioCache.clear();
  }
}

export const clearPortfolioCache = invalidatePortfolioCache;

async function loadDiscoveredApisBatch(snapshotIds = [], db = prisma) {
  const discoveredBySnapshot = new Map();
  if (!snapshotIds.length) return discoveredBySnapshot;

  if (typeof db.$queryRaw === "function") {
    try {
      const rows = await db.$queryRaw`
        SELECT "snapshotId",
               COALESCE(jsonb_array_length((("resultJson"::jsonb)->'integrationScan'->'discoveredEndpoints')), 0)::int AS "discoveredCount"
        FROM "ProjectStructureAnalysis"
        WHERE "snapshotId" = ANY(${snapshotIds}::text[])
      `;
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r?.snapshotId) {
            discoveredBySnapshot.set(r.snapshotId, Math.max(0, Number(r.discoveredCount) || 0));
          }
        }
        return discoveredBySnapshot;
      }
    } catch (err) {
      console.warn(
        "[PortfolioDashboard] Lean $queryRaw for discoveredEndpoints fell back to findMany:",
        err?.message || err,
      );
    }
  }

  if (typeof db.projectStructureAnalysis?.findMany === "function") {
    try {
      const rows = await db.projectStructureAnalysis.findMany({
        where: { snapshotId: { in: snapshotIds } },
        select: { snapshotId: true, resultJson: true },
      });
      for (const row of rows || []) {
        if (!row?.snapshotId || !row?.resultJson) continue;
        const parsed = safeParseMetaJson(row.resultJson);
        const eps = parsed?.integrationScan?.discoveredEndpoints;
        if (Array.isArray(eps)) {
          discoveredBySnapshot.set(row.snapshotId, eps.length);
        }
      }
    } catch (err) {
      console.warn(
        "[PortfolioDashboard] Failed to batch-load ProjectStructureAnalysis:",
        err?.message || err,
      );
    }
  }

  return discoveredBySnapshot;
}

function resolveProjectBranch({
  project,
  activeSnapshot,
  vcsBranchById,
  defaultBranchByProject,
}) {
  if (project.repoUrl) {
    const gitBranch = project.defaultBranch ? String(project.defaultBranch).trim() : "";
    return {
      branch: gitBranch || null,
      branchSource: "git",
    };
  }

  const vcsBranchName =
    (project.activeVcsBranchId && vcsBranchById.get(project.activeVcsBranchId)?.name) ||
    activeSnapshot?.vcsBranch?.name ||
    defaultBranchByProject.get(project.id)?.name ||
    null;

  return {
    branch: vcsBranchName,
    branchSource: vcsBranchName ? "snapshot_vcs" : "local",
  };
}

function buildRunnerInfraPayload({ runningJobsCount = 0, queuedJobsCount = 0 } = {}) {
  const telemetry = getQueueRuntimeTelemetry();
  return {
    runnerStatus: telemetry.runnerStatus,
    isRedisConnected: telemetry.isRedisConnected,
    workerEnabled: telemetry.workerEnabled,
    activeWorkers: telemetry.activeWorkers,
    runningJobsCount,
    queuedJobsCount,
    supportedFrameworks: [
      "Jest / Vitest (Unit)",
      "Supertest (HTTP API)",
      "Playwright / Cypress (E2E & API)",
    ],
    lastSync: new Date().toISOString(),
  };
}

/**
 * Main Batch Aggregator for Portfolio Dashboard (with Singleflight & O(1) DB rounds)
 */
export async function buildPortfolioOverview({
  userId,
  bypassCache = false,
  db = prisma,
}) {
  if (!userId) throw new Error("userId is required");

  const useCache = db === prisma && !bypassCache;
  let verifiedFp = null;

  if (useCache) {
    const cached = portfolioCache.get(userId);
    if (cached && Date.now() - cached.timestamp < PORTFOLIO_CACHE_TTL_MS) {
      verifiedFp = await getPortfolioFingerprint(userId, db);
      if (verifiedFp && cached.fingerprint === verifiedFp) {
        return cached.data;
      }
    }
  }

  const flightKey = db === prisma ? userId : `${userId}:custom`;
  let buildPromise = db === prisma ? inFlightPortfolioBuilds.get(flightKey) : null;
  if (!buildPromise) {
    buildPromise = executeBuildPortfolioOverview({
      userId,
      db,
      knownFingerprint: verifiedFp,
    }).finally(() => {
      if (db === prisma) {
        inFlightPortfolioBuilds.delete(flightKey);
      }
    });
    if (db === prisma) {
      inFlightPortfolioBuilds.set(flightKey, buildPromise);
    }
  }
  return buildPromise;
}

async function executeBuildPortfolioOverview({
  userId,
  db = prisma,
  knownFingerprint = null,
}) {
  // ── Wave 1: Fetch all accessible Projects (1 query, lean select) ─────────
  const rawProjects = await db.project.findMany({
    where: membershipWhere(userId),
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      ownerId: true,
      name: true,
      description: true,
      repoUrl: true,
      defaultBranch: true,
      activeSnapshotId: true,
      activeVcsBranchId: true,
      lifecycleStatus: true,
      lifecycleUpdatedAt: true,
      isPinned: true,
      hasJest: true,
      hasVitest: true,
      hasPlaywright: true,
      hasCypress: true,
      createdAt: true,
      updatedAt: true,
      members: {
        where: { userId },
        select: { role: true },
        take: 1,
      },
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
      _count: {
        select: { snapshots: true },
      },
    },
  });

  if (rawProjects.length === 0) {
    const emptyTimeRoi = aggregatePortfolioTimeAndRoi([]);
    const emptyKpis = getEmptyKpis(emptyTimeRoi);
    return {
      projects: [],
      activeProjectsCount: 0,
      activeKpis: emptyKpis,
      timeRoiAnalytics: emptyTimeRoi,
      lifecycleCounts: {
        total: 0,
        active: 0,
        open: 0,
        doing: 0,
        notStarted: 0,
        paused: 0,
        completed: 0,
        cancelled: 0,
        DOING: 0,
        NOT_STARTED: 0,
        PAUSED: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      },
      analytics: {
        benchmarkItems: [],
        quadrantNodes: [],
        timeRoiAnalytics: emptyTimeRoi,
        coverageCutoff: PORTFOLIO_RISK_QUADRANT_CUTOFFS.coverageCutoff,
        passRateCutoff: PORTFOLIO_RISK_QUADRANT_CUTOFFS.passRateCutoff,
      },
      attentionQueue: [],
      activityFeed: [],
      runnerInfrastructure: buildRunnerInfraPayload(),
      provenance: {
        queriedAt: new Date().toISOString(),
        totalProjectsInDb: 0,
        activeScopeProjectsCount: 0,
        dataSource: "POSTGRESQL_LIVE",
      },
    };
  }

  const projectIds = rawProjects.map((p) => p.id);
  const snapshotMap = new Map();
  const snapshotIds = [];
  const activeVcsBranchIds = [];

  for (const p of rawProjects) {
    const effectiveSnapshotId = p.activeSnapshotId || p.snapshots?.[0]?.id || null;
    if (effectiveSnapshotId) {
      snapshotMap.set(p.id, effectiveSnapshotId);
      snapshotIds.push(effectiveSnapshotId);
    }
    if (p.activeVcsBranchId) {
      activeVcsBranchIds.push(p.activeVcsBranchId);
    }
  }

  // Check warm integration summaries in memory before hitting DB
  const warmIntegrationBySnapshot = new Map();
  const coldIntegrationSnapshotIds = [];
  for (const sid of snapshotIds) {
    const warm = getCachedIntegrationSummary(sid);
    if (warm) {
      warmIntegrationBySnapshot.set(sid, warm);
    } else {
      coldIntegrationSnapshotIds.push(sid);
    }
  }

  // ── Wave 2: Single-Pass O(1) Parallel Batch Queries ──────────────────────
  const [
    activeSnapshotsList,
    vcsBranchesList,
    coverageSummaries,
    allCoverageFiles,
    latestDistinctRuns,
    recentRunsFeed,
    aiTestsList,
    systemScenariosList,
    systemProposalsGroup,
    activeJobs,
    discoveredApisBySnapshot,
  ] = await Promise.all([
    snapshotIds.length > 0
      ? db.projectSnapshot.findMany({
          where: { id: { in: snapshotIds } },
          select: {
            id: true,
            projectId: true,
            versionNumber: true,
            label: true,
            contentHash: true,
            commitSha: true,
            vcsBranchId: true,
            createdAt: true,
            vcsBranch: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),

    typeof db.snapshotVcsBranch?.findMany === "function"
      ? db.snapshotVcsBranch.findMany({
          where: {
            projectId: { in: projectIds },
            OR: [
              ...(activeVcsBranchIds.length > 0
                ? [{ id: { in: activeVcsBranchIds } }]
                : []),
              { isDefault: true },
            ],
          },
          select: { id: true, projectId: true, name: true, isDefault: true },
        })
      : Promise.resolve([]),

    snapshotIds.length > 0
      ? db.coverageSummary.findMany({
          where: { snapshotId: { in: snapshotIds } },
          select: {
            snapshotId: true,
            linesPct: true,
            branchesPct: true,
            funcsPct: true,
            stmtsPct: true,
          },
        })
      : Promise.resolve([]),

    snapshotIds.length > 0
      ? db.coverageFile.findMany({
          where: {
            snapshotId: { in: snapshotIds },
            AND: [
              { NOT: { filePath: { contains: "coverage/" } } },
              { NOT: { filePath: { contains: "coverage\\" } } },
              { NOT: { filePath: { contains: "node_modules/" } } },
              { NOT: { filePath: { contains: "node_modules\\" } } },
              { NOT: { filePath: { contains: ".git/" } } },
              { NOT: { filePath: { contains: ".test." } } },
              { NOT: { filePath: { contains: ".spec." } } },
              { NOT: { filePath: { contains: "/e2e/" } } },
              { NOT: { filePath: { contains: "/cypress/" } } },
              { NOT: { filePath: { contains: "/playwright/" } } },
            ],
          },
          select: {
            snapshotId: true,
            filePath: true,
            branchesPct: true,
          },
        })
      : Promise.resolve([]),

    // Latest run per (snapshotId, type) — zero global take truncation
    snapshotIds.length > 0
      ? db.testRun.findMany({
          where: { snapshotId: { in: snapshotIds } },
          distinct: ["snapshotId", "type"],
          orderBy: [
            { snapshotId: "asc" },
            { type: "asc" },
            { createdAt: "desc" },
          ],
          select: {
            id: true,
            snapshotId: true,
            type: true,
            totalTests: true,
            passedTests: true,
            failedTests: true,
            flakyTests: true,
            skippedTests: true,
            durationMs: true,
            status: true,
            coverageLinesPct: true,
            coverageBranchesPct: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),

    // Recent runs for activity feed & chronological per-snapshot sparkline/delta
    snapshotIds.length > 0
      ? db.testRun.findMany({
          where: { snapshotId: { in: snapshotIds } },
          orderBy: { createdAt: "desc" },
          take: Math.min(100, Math.max(25, snapshotIds.length * 6)),
          select: {
            id: true,
            snapshotId: true,
            type: true,
            totalTests: true,
            passedTests: true,
            failedTests: true,
            durationMs: true,
            status: true,
            coverageLinesPct: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),

    // AI tests scoped to activeSnapshotIds (no content column)
    snapshotIds.length > 0
      ? db.aiTest.findMany({
          where: { snapshotId: { in: snapshotIds } },
          select: {
            id: true,
            projectId: true,
            snapshotId: true,
            mode: true,
            status: true,
            metaJson: true,
          },
        })
      : Promise.resolve([]),

    snapshotIds.length > 0 && db.systemScenario
      ? db.systemScenario.findMany({
          where: { snapshotId: { in: snapshotIds } },
          select: { id: true, snapshotId: true, source: true },
        })
      : Promise.resolve([]),

    snapshotIds.length > 0 && db.systemTestProposal
      ? db.systemTestProposal.groupBy({
          by: ["snapshotId"],
          where: { snapshotId: { in: snapshotIds }, state: "APPLIED" },
          _count: { _all: true },
        })
      : Promise.resolve([]),

    db.job.findMany({
      where: {
        projectId: { in: projectIds },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      select: {
        id: true,
        projectId: true,
        snapshotId: true,
        type: true,
        status: true,
        progress: true,
        startedAt: true,
        createdAt: true,
      },
    }),

    loadDiscoveredApisBatch(coldIntegrationSnapshotIds, db),
  ]);

  // Identify latest integration & system run IDs for conditional Wave 3
  const latestBySnapshotAndPillar = new Map();
  for (const run of latestDistinctRuns || []) {
    const pillar = getPillarForRunType(run.type);
    const key = `${run.snapshotId}:${pillar}`;
    const prev = latestBySnapshotAndPillar.get(key);
    if (!prev || toTimestampMs(run.createdAt) > toTimestampMs(prev.createdAt)) {
      latestBySnapshotAndPillar.set(key, run);
    }
  }

  const coldLatestIntRunIds = [];
  const latestSysRunIds = [];
  for (const sid of snapshotIds) {
    if (!warmIntegrationBySnapshot.has(sid)) {
      const intRun = latestBySnapshotAndPillar.get(`${sid}:integration`);
      if (intRun?.id) coldLatestIntRunIds.push(intRun.id);
    }
    const sysRun = latestBySnapshotAndPillar.get(`${sid}:system`);
    if (sysRun?.id) latestSysRunIds.push(sysRun.id);
  }

  // ── Wave 3: Conditional Lean Batch Queries (<= 2 queries) ────────────────
  const [coldIntScenarios, systemRunMeasurements] = await Promise.all([
    coldLatestIntRunIds.length > 0 && typeof db.testScenario?.findMany === "function"
      ? db.testScenario.findMany({
          where: { testRunId: { in: coldLatestIntRunIds } },
          select: { testRunId: true, status: true, targetEndpoint: true },
        })
      : Promise.resolve([]),

    latestSysRunIds.length > 0
      ? db.testRun.findMany({
          where: { id: { in: latestSysRunIds } },
          select: { id: true, snapshotId: true, systemMeasurement: true },
        })
      : Promise.resolve([]),
  ]);

  // Index batch data
  const snapshotById = new Map((activeSnapshotsList || []).map((s) => [s.id, s]));

  const vcsBranchById = new Map();
  const defaultVcsBranchByProject = new Map();
  for (const b of vcsBranchesList || []) {
    vcsBranchById.set(b.id, b);
    if (b.isDefault && !defaultVcsBranchByProject.has(b.projectId)) {
      defaultVcsBranchByProject.set(b.projectId, b);
    }
  }

  const covSummaryBySnapshot = new Map((coverageSummaries || []).map((c) => [c.snapshotId, c]));

  const unitFilesBySnapshot = new Map();
  for (const cf of allCoverageFiles || []) {
    if (!isApiFilePath(cf.filePath)) {
      if (!unitFilesBySnapshot.has(cf.snapshotId)) {
        unitFilesBySnapshot.set(cf.snapshotId, []);
      }
      unitFilesBySnapshot.get(cf.snapshotId).push(cf);
    }
  }

  const sysMeasurementBySnapshot = new Map();
  for (const sm of systemRunMeasurements || []) {
    if (sm?.systemMeasurement) {
      sysMeasurementBySnapshot.set(sm.snapshotId, sm.systemMeasurement);
    }
  }

  const intScenariosByRunId = new Map();
  for (const sc of coldIntScenarios || []) {
    if (!intScenariosByRunId.has(sc.testRunId)) {
      intScenariosByRunId.set(sc.testRunId, []);
    }
    intScenariosByRunId.get(sc.testRunId).push(sc);
  }

  const recentRunsBySnapshot = new Map();
  for (const tr of recentRunsFeed || []) {
    if (!recentRunsBySnapshot.has(tr.snapshotId)) {
      recentRunsBySnapshot.set(tr.snapshotId, []);
    }
    recentRunsBySnapshot.get(tr.snapshotId).push(tr);
  }

  const sysScenariosBySnapshot = new Map();
  for (const sc of systemScenariosList || []) {
    if (!sysScenariosBySnapshot.has(sc.snapshotId)) {
      sysScenariosBySnapshot.set(sc.snapshotId, []);
    }
    sysScenariosBySnapshot.get(sc.snapshotId).push(sc);
  }

  const sysProposalsBySnapshot = new Map(
    (systemProposalsGroup || []).map((g) => [g.snapshotId, g._count?._all || 0]),
  );

  const aiTestsBySnapshot = new Map();
  for (const rec of aiTestsList || []) {
    if (!aiTestsBySnapshot.has(rec.snapshotId)) {
      aiTestsBySnapshot.set(rec.snapshotId, []);
    }
    aiTestsBySnapshot.get(rec.snapshotId).push(rec);
  }

  const activeJobByProject = new Map();
  for (const j of activeJobs || []) {
    if (!activeJobByProject.has(j.projectId) || j.status === "RUNNING") {
      activeJobByProject.set(j.projectId, j);
    }
  }

  // ── Transform Each Project into Normalized ViewModel ─────────────────────
  const normalizedProjects = rawProjects.map((p) => {
    const snapshotId = snapshotMap.get(p.id) || null;
    const activeSnapshot = snapshotId ? snapshotById.get(snapshotId) || null : null;
    const cov = snapshotId ? covSummaryBySnapshot.get(snapshotId) || null : null;
    const unitFiles = snapshotId ? unitFilesBySnapshot.get(snapshotId) || [] : [];
    const warmInt = snapshotId ? warmIntegrationBySnapshot.get(snapshotId) || null : null;
    const sysScenarios = snapshotId ? sysScenariosBySnapshot.get(snapshotId) || [] : [];
    const snapshotRuns = snapshotId ? recentRunsBySnapshot.get(snapshotId) || [] : [];
    const currentActiveJob = activeJobByProject.get(p.id) || null;

    const currentUserRole =
      p.ownerId === userId ? "OWNER" : p.members?.[0]?.role || "VIEWER";
    const canManageLifecycle = canManageProjectLifecycle(currentUserRole);

    const { branch, branchSource } = resolveProjectBranch({
      project: p,
      activeSnapshot,
      vcsBranchById,
      defaultBranchByProject: defaultVcsBranchByProject,
    });

    const unitRun = snapshotId ? latestBySnapshotAndPillar.get(`${snapshotId}:unit`) || null : null;
    const intRun = snapshotId ? latestBySnapshotAndPillar.get(`${snapshotId}:integration`) || null : null;
    const sysRun = snapshotId ? latestBySnapshotAndPillar.get(`${snapshotId}:system`) || null : null;

    // 3a. Unit Pillar
    const unitPassed = Number(unitRun?.passedTests ?? 0);
    const unitFailed = Number(unitRun?.failedTests ?? 0);
    const unitSkipped = Number(unitRun?.skippedTests ?? 0);
    const unitTotal = Number(unitRun?.totalTests ?? unitPassed + unitFailed + unitSkipped);
    const unitDurationMs = Number(unitRun?.durationMs ?? 0);
    const unitCov =
      unitTotal > 0
        ? roundMetric(cov?.linesPct ?? unitRun?.coverageLinesPct ?? null, 1)
        : null;
    const unitBranchCov =
      unitTotal > 0
        ? roundMetric(cov?.branchesPct ?? unitRun?.coverageBranchesPct ?? null, 1)
        : null;

    // 3b. Integration Pillar (warm cache OR lean batch queries)
    let intPassed = 0;
    let intFailed = 0;
    let intSkipped = 0;
    let intTotal = 0;
    let totalApis = 0;
    let coveredApis = 0;
    let uncoveredApis = 0;
    let intDurationMs = 0;
    let intCov = null;
    let intFramework = "Supertest";

    if (warmInt) {
      const wsSummary = warmInt.summary || {};
      const endpoints = warmInt.endpoints || [];
      const coveredEpCount = endpoints.filter((e) => e.status === "Covered").length;
      const failedEpCount = endpoints.filter(
        (e) => e.status === "Failed" || e.status === "Script Error",
      ).length;
      intFramework = warmInt.framework || "Supertest";

      intPassed = Number(wsSummary.passedTests ?? wsSummary.testedApis ?? coveredEpCount ?? 0);
      intFailed = Number(wsSummary.failedTests ?? failedEpCount ?? 0);
      intSkipped = Number(wsSummary.skippedTests ?? intRun?.skippedTests ?? 0);
      intTotal = Number(
        wsSummary.totalTests ??
          wsSummary.executedApis ??
          intRun?.totalTests ??
          intPassed + intFailed + intSkipped,
      );
      totalApis = Number(
        wsSummary.totalApis ?? wsSummary.discoveredApis ?? (endpoints.length || intTotal),
      );
      coveredApis =
        intTotal > 0 && totalApis > 0
          ? Math.min(
              totalApis,
              Number(
                wsSummary.endpointCoverageMetrics?.coveredEndpoints ??
                  (coveredEpCount > 0 ? coveredEpCount : intPassed),
              ),
            )
          : 0;
      uncoveredApis = Math.max(0, totalApis - coveredApis);
      intDurationMs = Number(wsSummary.durationMs ?? intRun?.durationMs ?? 0);
      if (intTotal > 0 && totalApis > 0) {
        intCov =
          wsSummary.endpointCoverageMetrics?.endpointCoveragePct !== undefined
            ? roundMetric(wsSummary.endpointCoverageMetrics.endpointCoveragePct, 1)
            : roundMetric((coveredApis / totalApis) * 100, 1);
      }
    } else {
      intFramework = intRun?.type === "PLAYWRIGHT_API" ? "Playwright API" : "Supertest";
      intPassed = Number(intRun?.passedTests ?? 0);
      intFailed = Number(intRun?.failedTests ?? 0);
      intSkipped = Number(intRun?.skippedTests ?? 0);
      intTotal = Number(intRun?.totalTests ?? intPassed + intFailed + intSkipped);
      intDurationMs = Number(intRun?.durationMs ?? 0);

      const scenariosForRun = intRun?.id ? intScenariosByRunId.get(intRun.id) || [] : [];
      const discoveredCount = snapshotId ? discoveredApisBySnapshot.get(snapshotId) || 0 : 0;

      const distinctTargetEndpoints = new Set();
      const passedDistinctEndpoints = new Set();
      for (const sc of scenariosForRun) {
        const ep = sc?.targetEndpoint ? String(sc.targetEndpoint).trim() : "";
        if (!ep) continue;
        distinctTargetEndpoints.add(ep);
        if (String(sc.status || "").toLowerCase() === "passed") {
          passedDistinctEndpoints.add(ep);
        }
      }

      totalApis = Math.max(discoveredCount, distinctTargetEndpoints.size);
      if (intTotal > 0 && totalApis > 0) {
        const rawCovered =
          passedDistinctEndpoints.size > 0
            ? passedDistinctEndpoints.size
            : Math.min(totalApis, intPassed);
        coveredApis = Math.min(totalApis, rawCovered);
        intCov = roundMetric((coveredApis / totalApis) * 100, 1);
      } else {
        coveredApis = 0;
      }
      uncoveredApis = Math.max(0, totalApis - coveredApis);
    }

    // 3c. System E2E Pillar (NO fake fallback to sysPassRate)
    const sysPassed = Number(sysRun?.passedTests ?? 0);
    const sysFailed = Number(sysRun?.failedTests ?? 0);
    const sysFlaky = Number(sysRun?.flakyTests ?? 0);
    const sysSkipped = Number(sysRun?.skippedTests ?? 0);
    const sysTotal = Number(
      sysRun?.totalTests ?? sysPassed + sysFailed + sysFlaky + sysSkipped,
    );
    const sysDurationMs = Number(sysRun?.durationMs ?? 0);
    const sysMeasurement = snapshotId ? sysMeasurementBySnapshot.get(snapshotId) || null : null;

    let sysCov = null;
    if (sysTotal > 0 && sysMeasurement) {
      try {
        const sysCovSummary = coverageSummaryFor(sysMeasurement);
        const feLinesPct = sysCovSummary?.frontend?.counters?.lines?.pct;
        if (feLinesPct !== undefined && feLinesPct !== null) {
          sysCov = roundMetric(feLinesPct, 1);
        }
      } catch (err) {
        console.warn(
          `[PortfolioDashboard] Failed to parse systemMeasurement for snapshot ${snapshotId}:`,
          err?.message || err,
        );
      }
    }

    const totalJourneys = Math.max(sysTotal, sysScenarios.length);
    const coveredJourneys = sysTotal > 0 ? sysPassed : 0;

    // 3d. Shared Governance Health, Unified Coverage, Pass Rate & Gate
    const totalExecuted = unitTotal + intTotal + sysTotal;
    const totalFailed = unitFailed + intFailed + sysFailed;

    const governanceMetrics = computeProjectHealthAndCoverage({
      unit: {
        totalTests: unitTotal,
        passedTests: unitPassed,
        failedTests: unitFailed,
        coveragePct: unitCov,
      },
      integration: {
        totalTests: intTotal,
        passedTests: intPassed,
        failedTests: intFailed,
        coveragePct: intCov,
      },
      system: {
        totalTests: sysTotal,
        passedTests: sysPassed,
        failedTests: sysFailed,
        coveragePct: sysCov,
      },
    });

    const {
      unifiedCoveragePct: unifiedCov,
      healthScore,
      passRatePct: passRate,
      grade,
      gateStatus,
      gateLabel,
    } = governanceMetrics;

    // 3e. AI Synthesis & Coverage Gaps (Scoped to activeSnapshotId, D5 clean)
    const projAiTests = snapshotId ? aiTestsBySnapshot.get(snapshotId) || [] : [];
    const projAiSysScenarios = sysScenarios.filter((s) => s.source === "AI").length;
    const projAiSysProposals = snapshotId ? sysProposalsBySnapshot.get(snapshotId) || 0 : 0;

    let aiGeneratedCount = projAiSysScenarios;
    let aiRepairedCount = projAiSysProposals;

    for (const rec of projAiTests) {
      const parsedMeta = safeParseMetaJson(rec.metaJson);
      const requests = Array.isArray(parsedMeta?.requests) ? parsedMeta.requests : [];
      if (requests.length > 0) {
        const repairedReqs = requests.filter(
          (r) => r.repaired || r.healed || r.regenerated,
        ).length;
        const generatedReqs = requests.filter(
          (r) =>
            !(r.repaired || r.healed || r.regenerated) &&
            (r.origin === "AI_GENERATED" || !r.origin),
        ).length;
        aiGeneratedCount += generatedReqs;
        aiRepairedCount += repairedReqs;
      } else {
        aiGeneratedCount += 1;
      }
    }

    const lowBranchUnitFilesCount = unitFiles.filter(
      (f) => Number(f.branchesPct ?? 0) < PORTFOLIO_QUALITY_GATE.lowBranchThresholdPct,
    ).length;
    const totalCoverageGaps = uncoveredApis + lowBranchUnitFilesCount;

    // 3f. Sparkline (real runs only, never fabricated) & Same-Pillar Delta
    const orderedSnapshotRuns = [...snapshotRuns].sort(
      (a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt),
    );

    const sparkline = orderedSnapshotRuns
      .slice(0, 5)
      .reverse()
      .map((r) => {
        const pRate = computePassRatePct(r.passedTests, r.failedTests) ?? 0;
        const cRate =
          r.coverageLinesPct !== null && r.coverageLinesPct !== undefined
            ? Number(r.coverageLinesPct)
            : null;
        return cRate !== null ? Math.round(0.5 * pRate + 0.5 * cRate) : Math.round(pRate);
      });

    let delta = 0;
    let hasDelta = false;
    if (orderedSnapshotRuns.length >= 2) {
      const latestPillar = getPillarForRunType(orderedSnapshotRuns[0].type);
      const samePillarRuns = orderedSnapshotRuns.filter(
        (r) => getPillarForRunType(r.type) === latestPillar,
      );
      if (samePillarRuns.length >= 2) {
        const currRate = computePassRatePct(
          samePillarRuns[0].passedTests,
          samePillarRuns[0].failedTests,
        );
        const prevRate = computePassRatePct(
          samePillarRuns[1].passedTests,
          samePillarRuns[1].failedTests,
        );
        if (currRate !== null && prevRate !== null) {
          delta = roundMetric(currRate - prevRate, 1) ?? 0;
          hasDelta = true;
        }
      }
    }

    // Framework tags
    const frameworks = [];
    if (p.repoUrl) frameworks.push("GitHub");
    if (p.hasVitest || unitRun?.type === "VITEST") frameworks.push("Vitest");
    else if (p.hasJest || unitRun?.type === "JEST") frameworks.push("Jest");
    if (totalApis > 0 || intTotal > 0 || intRun) frameworks.push(intFramework);
    if (p.hasPlaywright || sysRun?.type === "PLAYWRIGHT") frameworks.push("Playwright");
    if (p.hasCypress || sysRun?.type === "CYPRESS") frameworks.push("Cypress");
    if (frameworks.length === 0) frameworks.push("Node.js");

    // 3g. Time & ROI
    const rawTimeRoi = computeProjectTimeAndRoiMetrics({
      unitStats: {
        totalTests: unitTotal,
        passedTests: unitPassed,
        failedTests: unitFailed,
        durationMs: unitDurationMs,
      },
      intStats: {
        totalTests: intTotal,
        passedTests: intPassed,
        failedTests: intFailed,
        durationMs: intDurationMs,
      },
      sysStats: {
        totalTests: sysTotal,
        passedTests: sysPassed,
        failedTests: sysFailed,
        durationMs: sysDurationMs,
      },
      aiGeneratedCount,
      aiRepairedCount,
    });

    const timeRoi = {
      ...rawTimeRoi,
      actualAutoDurationFormatted: rawTimeRoi.actualAutoDurationStr,
      estimatedManualDurationFormatted: rawTimeRoi.estimatedManualDurationStr,
    };

    let compactStatus = "All Suites Passing";
    let compactSeverity = "SUCCESS";
    if (currentActiveJob) {
      compactStatus = `Running ${currentActiveJob.type.replace(/_/g, " ")} (${currentActiveJob.progress}%)`;
      compactSeverity = "RUNNING";
    } else if (totalExecuted === 0) {
      compactStatus = totalApis > 0 ? `${totalApis} Uncovered APIs` : "Ready for First Run";
      compactSeverity = totalApis > 0 ? "WARNING" : "NEUTRAL";
    } else if (totalFailed > 0) {
      compactStatus = `${totalFailed} Test Failure${totalFailed !== 1 ? "s" : ""}`;
      compactSeverity = "DANGER";
    } else if (uncoveredApis > 0) {
      compactStatus = `${uncoveredApis} Uncovered APIs`;
      compactSeverity = "WARNING";
    } else if (unifiedCov !== null && unifiedCov < 50) {
      compactStatus = `Low Coverage (${unifiedCov}%)`;
      compactSeverity = "WARNING";
    }

    const lifecycleStatus = p.lifecycleStatus || "NOT_STARTED";
    const isExcludedFromActiveKpis = !isKpiIncludedLifecycleStatus(lifecycleStatus);

    const hasLifecycleActivity = Boolean(
      totalExecuted > 0 ||
        aiGeneratedCount > 0 ||
        aiRepairedCount > 0 ||
        orderedSnapshotRuns.length > 0 ||
        cov ||
        (p._count?.snapshots || 0) > 1,
    );

    const currentJobPillar = currentActiveJob
      ? currentActiveJob.type.includes("SUPERTEST") ||
        currentActiveJob.type.includes("PLAYWRIGHT_API")
        ? "Integration"
        : currentActiveJob.type.includes("SYSTEM") ||
            currentActiveJob.type.includes("PLAYWRIGHT") ||
            currentActiveJob.type.includes("CYPRESS")
          ? "System E2E"
          : "Unit"
      : null;

    const vNum =
      activeSnapshot?.versionNumber != null
        ? `#${activeSnapshot.versionNumber}`
        : snapshotId
          ? "#1"
          : null;
    const shortRef =
      activeSnapshot?.commitSha && !activeSnapshot.commitSha.startsWith("appliedTx:")
        ? activeSnapshot.commitSha.slice(0, 7)
        : activeSnapshot?.contentHash
          ? activeSnapshot.contentHash.slice(0, 7)
          : snapshotId
            ? snapshotId.slice(0, 7)
            : "";
    const snapshotLabel = activeSnapshot?.label || (vNum ? `${vNum} (${shortRef})` : shortRef);

    const lastExecutedMs = Math.max(
      toTimestampMs(unitRun?.createdAt),
      toTimestampMs(intRun?.createdAt),
      toTimestampMs(sysRun?.createdAt),
      toTimestampMs(orderedSnapshotRuns[0]?.createdAt),
    );
    const lastExecutedAt = lastExecutedMs > 0 ? new Date(lastExecutedMs).toISOString() : null;

    return {
      id: p.id,
      name: p.name,
      description: p.description || "Project Workspace",
      repoUrl: p.repoUrl || null,
      branch,
      branchSource,
      snapshotId,
      snapshotLabel,
      snapshotVersion: activeSnapshot?.versionNumber ?? null,
      lifecycleStatus,
      lifecycleUpdatedAt: p.lifecycleUpdatedAt || p.updatedAt,
      isPinned: Boolean(p.isPinned),
      isExcludedFromActiveKpis,
      currentUserRole,
      canManageLifecycle,
      hasLifecycleActivity,
      updatedAt: p.updatedAt || p.createdAt,
      createdAt: p.createdAt,
      frameworks,
      healthScore,
      grade,
      delta,
      hasDelta,
      gateStatus,
      gateLabel,
      unifiedCoveragePct: unifiedCov,
      passRatePct: passRate,
      sparkline,
      compactStatus,
      compactSeverity,
      activeJob: currentActiveJob
        ? {
            id: currentActiveJob.id,
            type: currentActiveJob.type,
            pillar: currentJobPillar,
            status: currentActiveJob.status,
            progress: currentActiveJob.progress,
            startedAt: currentActiveJob.startedAt || currentActiveJob.createdAt,
          }
        : null,
      pillars: {
        unit: {
          framework: p.hasVitest || unitRun?.type === "VITEST" ? "Vitest" : "Jest",
          coveragePct: unitCov,
          coverageMeasured: unitCov !== null,
          branchCoveragePct: unitBranchCov,
          totalTests: unitTotal,
          passedTests: unitPassed,
          failedTests: unitFailed,
          skippedTests: unitSkipped,
          durationMs: unitDurationMs,
        },
        integration: {
          framework: intFramework,
          coveragePct: intCov,
          coverageMeasured: intCov !== null,
          totalApis,
          coveredApis,
          uncoveredApis,
          totalTests: intTotal,
          passedTests: intPassed,
          failedTests: intFailed,
          skippedTests: intSkipped,
          durationMs: intDurationMs,
        },
        system: {
          framework: p.hasCypress || sysRun?.type === "CYPRESS" ? "Cypress" : "Playwright",
          coveragePct: sysCov,
          coverageMeasured: sysCov !== null,
          totalJourneys,
          coveredJourneys,
          totalTests: sysTotal,
          passedTests: sysPassed,
          failedTests: sysFailed,
          flakyTests: sysFlaky,
          skippedTests: sysSkipped,
          durationMs: sysDurationMs,
        },
      },
      timeRoi,
      aiMetrics: {
        aiGeneratedTests: aiGeneratedCount,
        aiRepairedTests: aiRepairedCount,
        uncoveredGaps: totalCoverageGaps,
        uncoveredApis,
        lowBranchUnitFilesCount,
      },
      provenance: {
        snapshotId,
        unitRunId: unitRun?.id || null,
        integrationRunId: intRun?.id || null,
        systemRunId: sysRun?.id || null,
        lastExecutedAt,
        dataSource: "POSTGRESQL_LIVE",
      },
    };
  });

  // ── Strict KPI Scope: ONLY DOING projects ───────────────────────────────
  const activeScopeProjects = normalizedProjects.filter((p) =>
    isKpiIncludedLifecycleStatus(p.lifecycleStatus),
  );

  const rawTimeRoiAnalytics = aggregatePortfolioTimeAndRoi(activeScopeProjects);
  const timeRoiAnalytics = {
    ...rawTimeRoiAnalytics,
    totalAutoExecutionDurationFormatted: rawTimeRoiAnalytics.totalAutoDurationStr,
    totalManualExecutionDurationFormatted: rawTimeRoiAnalytics.totalManualHoursStr,
  };

  const activeKpis = computeExecutiveKpis(activeScopeProjects, timeRoiAnalytics);
  const benchmarkAnalytics = computeBenchmarkAndQuadrant(activeScopeProjects);
  const attentionQueue = synthesizeAttentionQueue(activeScopeProjects);

  const doingCount = normalizedProjects.filter((p) => p.lifecycleStatus === "DOING").length;
  const notStartedCount = normalizedProjects.filter(
    (p) => p.lifecycleStatus === "NOT_STARTED",
  ).length;
  const pausedCount = normalizedProjects.filter((p) => p.lifecycleStatus === "PAUSED").length;
  const completedCount = normalizedProjects.filter(
    (p) => p.lifecycleStatus === "COMPLETED",
  ).length;
  const cancelledCount = normalizedProjects.filter(
    (p) => p.lifecycleStatus === "CANCELLED",
  ).length;

  const lifecycleCounts = {
    total: normalizedProjects.length,
    active: doingCount,
    open: doingCount + notStartedCount,
    doing: doingCount,
    notStarted: notStartedCount,
    paused: pausedCount,
    completed: completedCount,
    cancelled: cancelledCount,
    DOING: doingCount,
    NOT_STARTED: notStartedCount,
    PAUSED: pausedCount,
    COMPLETED: completedCount,
    CANCELLED: cancelledCount,
  };

  // ── Unified Execution Feed (25 most recent runs) ─────────────────────────
  const projectNameMap = new Map(rawProjects.map((p) => [snapshotMap.get(p.id), p.name]));
  const projectIdMap = new Map(rawProjects.map((p) => [snapshotMap.get(p.id), p.id]));

  const activityFeed = (recentRunsFeed || []).slice(0, 25).map((r) => {
    const projName = projectNameMap.get(r.snapshotId) || "Workspace";
    const projId = projectIdMap.get(r.snapshotId) || null;
    const pillar = getPillarForRunType(r.type);
    const rTotal = Number(r.totalTests || 0);
    const rPassed = Number(r.passedTests || 0);
    const rFailed = Number(r.failedTests || 0);
    const covVal =
      r.coverageLinesPct !== null && r.coverageLinesPct !== undefined
        ? Number(r.coverageLinesPct)
        : null;

    return {
      id: r.id,
      runId: r.id,
      projectId: projId,
      snapshotId: r.snapshotId,
      projectName: projName,
      type: "TEST_EXECUTION",
      pillar,
      outcome: rFailed === 0 && r.status !== "FAILED" ? "SUCCESS" : "FAILED",
      coverageDelta: covVal !== null ? `${covVal.toFixed(1)}%` : "—",
      duration:
        (r.durationMs || 0) >= 1000
          ? `${((r.durationMs || 0) / 1000).toFixed(1)}s`
          : `${Math.round(r.durationMs || 0)}ms`,
      durationMs: r.durationMs || 0,
      timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      summary: `${rPassed}/${rTotal} passed (${rFailed} failed)`,
    };
  });

  const runningJobsCount = (activeJobs || []).filter((j) => j.status === "RUNNING").length;
  const queuedJobsCount = (activeJobs || []).filter((j) => j.status === "QUEUED").length;
  const runnerInfrastructure = buildRunnerInfraPayload({
    runningJobsCount,
    queuedJobsCount,
  });

  const payload = {
    projects: normalizedProjects,
    activeProjectsCount: activeScopeProjects.length,
    activeKpis,
    timeRoiAnalytics,
    lifecycleCounts,
    analytics: {
      ...benchmarkAnalytics,
      timeRoiAnalytics,
      coverageCutoff: PORTFOLIO_RISK_QUADRANT_CUTOFFS.coverageCutoff,
      passRateCutoff: PORTFOLIO_RISK_QUADRANT_CUTOFFS.passRateCutoff,
    },
    attentionQueue,
    activityFeed,
    runnerInfrastructure,
    provenance: {
      queriedAt: new Date().toISOString(),
      totalProjectsInDb: rawProjects.length,
      activeScopeProjectsCount: activeScopeProjects.length,
      dataSource: "POSTGRESQL_LIVE",
    },
  };

  if (db === prisma) {
    const fingerprint =
      knownFingerprint ||
      computePortfolioFingerprintFromData({
        projects: rawProjects,
        latestRun: recentRunsFeed?.[0] || null,
        latestJob: activeJobs?.[0] || null,
        activeJobCount: activeJobs?.length || 0,
        aiTestsCount: aiTestsList?.length || 0,
      });
    portfolioCache.set(userId, { data: payload, timestamp: Date.now(), fingerprint });
  }

  return payload;
}

/**
 * Compute Executive KPIs over DOING projects only
 */
function computeExecutiveKpis(projects = [], timeRoiAnalytics = {}) {
  const total = projects.length;
  if (total === 0) return getEmptyKpis(timeRoiAnalytics);

  let passed = 0;
  let atRisk = 0;
  let blocked = 0;
  let untested = 0;
  let sumHealth = 0;
  let testedCount = 0;

  let sumUnitCov = 0;
  let unitCovCount = 0;
  let sumIntCov = 0;
  let intCovCount = 0;
  let sumSysCov = 0;
  let sysCovCount = 0;

  let totalUnitTests = 0;
  let passedUnitTests = 0;
  let failedUnitTests = 0;
  let totalIntTests = 0;
  let passedIntTests = 0;
  let failedIntTests = 0;
  let totalDiscoveredApis = 0;
  let totalCoveredApis = 0;
  let totalSysTests = 0;
  let passedSysTests = 0;
  let failedSysTests = 0;
  let cumulativeDurationMs = 0;

  let totalAiGenerated = 0;
  let totalAiRepaired = 0;
  let totalUncoveredGaps = 0;
  let totalUncoveredApis = 0;
  let totalLowBranchUnitFiles = 0;

  for (const p of projects) {
    if (p.gateStatus === "PASSED") passed++;
    else if (p.gateStatus === "AT_RISK") atRisk++;
    else if (p.gateStatus === "BLOCKED") blocked++;
    else untested++;

    if (p.gateStatus !== "UNTESTED" && p.healthScore !== null) {
      sumHealth += p.healthScore;
      testedCount++;
    }

    if (p.pillars.unit.coveragePct !== null && p.pillars.unit.coveragePct !== undefined) {
      sumUnitCov += p.pillars.unit.coveragePct;
      unitCovCount++;
    }
    if (
      p.pillars.integration.coveragePct !== null &&
      p.pillars.integration.coveragePct !== undefined
    ) {
      sumIntCov += p.pillars.integration.coveragePct;
      intCovCount++;
    }
    if (p.pillars.system.coveragePct !== null && p.pillars.system.coveragePct !== undefined) {
      sumSysCov += p.pillars.system.coveragePct;
      sysCovCount++;
    }

    totalUnitTests += p.pillars.unit.totalTests || 0;
    passedUnitTests += p.pillars.unit.passedTests || 0;
    failedUnitTests += p.pillars.unit.failedTests || 0;

    totalIntTests += p.pillars.integration.totalTests || 0;
    passedIntTests += p.pillars.integration.passedTests || 0;
    failedIntTests += p.pillars.integration.failedTests || 0;

    totalDiscoveredApis += p.pillars.integration.totalApis || 0;
    totalCoveredApis += p.pillars.integration.coveredApis || 0;

    totalSysTests += p.pillars.system.totalTests || 0;
    passedSysTests += p.pillars.system.passedTests || 0;
    failedSysTests += p.pillars.system.failedTests || 0;

    cumulativeDurationMs += p.timeRoi?.actualAutoDurationMs || 0;
    totalAiGenerated += p.aiMetrics?.aiGeneratedTests || 0;
    totalAiRepaired += p.aiMetrics?.aiRepairedTests || 0;
    totalUncoveredGaps += p.aiMetrics?.uncoveredGaps || 0;
    totalUncoveredApis += p.aiMetrics?.uncoveredApis || 0;
    totalLowBranchUnitFiles += p.aiMetrics?.lowBranchUnitFilesCount || 0;
  }

  const avgHealthScore = testedCount > 0 ? Math.round(sumHealth / testedCount) : null;
  let grade = "—";
  if (avgHealthScore !== null) {
    if (avgHealthScore >= 80) grade = "A";
    else if (avgHealthScore >= 65) grade = "B";
    else if (avgHealthScore >= 50) grade = "C";
    else grade = "D";
  }

  // Per-layer averages strictly over KPI-scope projects that measured that layer
  const avgUnitCov = unitCovCount > 0 ? roundMetric(sumUnitCov / unitCovCount, 1) : null;
  const avgIntCov = intCovCount > 0 ? roundMetric(sumIntCov / intCovCount, 1) : null;
  const avgSysCov = sysCovCount > 0 ? roundMetric(sumSysCov / sysCovCount, 1) : null;

  const unifiedAgg = computeNormalizedWeightedAverage({
    unit: avgUnitCov,
    integration: avgIntCov,
    system: avgSysCov,
  });

  const totalExecutedTests = totalUnitTests + totalIntTests + totalSysTests;
  const totalPassedTests = passedUnitTests + passedIntTests + passedSysTests;
  const totalFailedTests = failedUnitTests + failedIntTests + failedSysTests;
  const overallPassRatePct = computePassRatePct(totalPassedTests, totalFailedTests);

  return {
    totalProjects: total,
    timeRoi: timeRoiAnalytics,
    gateBreakdown: {
      passed,
      atRisk,
      blocked,
      untested,
      passedPct: total > 0 ? roundMetric((passed / total) * 100, 1) : 0,
    },
    card1Health: {
      avgHealthScore,
      grade,
      totalProjects: total,
      testedProjects: testedCount,
      passedProjects: passed,
      atRiskProjects: atRisk,
      blockedProjects: blocked,
      untestedProjects: untested,
    },
    card2Coverage: {
      unifiedCoveragePct: unifiedAgg.value,
      avgUnitCoveragePct: avgUnitCov,
      avgIntegrationCoveragePct: avgIntCov,
      avgSystemCoveragePct: avgSysCov,
      layerCoverageMeta: {
        unit: { avgPct: avgUnitCov, measuredCount: unitCovCount, totalKpiProjects: total },
        integration: { avgPct: avgIntCov, measuredCount: intCovCount, totalKpiProjects: total },
        system: { avgPct: avgSysCov, measuredCount: sysCovCount, totalKpiProjects: total },
      },
    },
    card3Scale: {
      totalExecutedTests,
      totalPassedTests,
      totalFailedTests,
      overallPassRatePct,
      unitPassedStr: `${passedUnitTests}/${totalUnitTests}`,
      apiCoveredStr:
        totalDiscoveredApis > 0
          ? `${totalCoveredApis}/${totalDiscoveredApis}`
          : `${passedIntTests}/${totalIntTests}`,
      systemVerifiedStr: `${passedSysTests}/${totalSysTests}`,
      cumulativeDurationStr:
        cumulativeDurationMs >= 1000
          ? `${(cumulativeDurationMs / 1000).toFixed(1)}s`
          : `${Math.round(cumulativeDurationMs)}ms`,
    },
    card4AiImpact: {
      totalAiTests: totalAiGenerated + totalAiRepaired,
      aiGeneratedCount: totalAiGenerated,
      aiRepairedCount: totalAiRepaired,
      uncoveredGapsCount: totalUncoveredGaps,
      uncoveredApisCount: totalUncoveredApis,
      lowBranchUnitFilesCount: totalLowBranchUnitFiles,
    },
  };
}

/**
 * Compute Benchmark bars & Risk Quadrant data for active (DOING) projects
 */
function computeBenchmarkAndQuadrant(projects = []) {
  const benchmarkItems = projects.map((p) => {
    const unitPct = p.pillars.unit.coveragePct;
    const intPct = p.pillars.integration.coveragePct;
    const sysPct = p.pillars.system.coveragePct;

    const unitNum = unitPct ?? 0;
    const intNum = intPct ?? 0;
    const sysNum = sysPct ?? 0;

    const allValues = [unitNum, intNum, sysNum];
    const maxVal = Math.max(...allValues);
    const minVal = Math.min(...allValues);
    const hasImbalance =
      (maxVal - minVal >= 40 && minVal === 0) || (unitNum > 0 && intNum === 0);

    return {
      projectId: p.id,
      name: p.name,
      gateStatus: p.gateStatus,
      healthScore: p.healthScore,
      unitPct,
      intPct,
      sysPct,
      hasImbalance,
      imbalanceReason: hasImbalance
        ? `Layer deficit: ${unitPct ?? "N/A"}% Unit vs ${intPct ?? "N/A"}% API · ${sysPct ?? "N/A"}% E2E`
        : null,
    };
  });

  const quadrantColorById = {
    "healthy-stars": "var(--ud-pass)",
    "false-security": "var(--ud-warn)",
    "active-regressions": "#fb8500",
    "critical-risk": "var(--ud-fail)",
    untested: "var(--ps-neutral)",
  };

  const quadrantNodes = projects.map((p) => {
    const classification = classifyRiskQuadrant({
      unifiedCoveragePct: p.unifiedCoveragePct,
      passRatePct: p.passRatePct,
      gateStatus: p.gateStatus,
    });

    return {
      projectId: p.id,
      name: p.name,
      x: p.unifiedCoveragePct,
      y: p.passRatePct,
      gateStatus: p.gateStatus,
      gateLabel: p.gateLabel,
      healthScore: p.healthScore,
      grade: p.grade,
      quadrantId: classification.quadrantId,
      quadrantLabel: classification.quadrantLabel,
      color: quadrantColorById[classification.quadrantId] || "var(--ps-neutral)",
      isUntested: classification.isUntested,
    };
  });

  return {
    benchmarkItems,
    quadrantNodes,
  };
}

/**
 * Synthesize cross-project attention items from active (DOING) projects
 */
function synthesizeAttentionQueue(projects = []) {
  const queue = [];

  for (const p of projects) {
    if (p.gateStatus === "BLOCKED") {
      const failedPillar =
        p.pillars.integration.failedTests > 0
          ? "integration"
          : p.pillars.unit.failedTests > 0
            ? "unit"
            : "system";

      const failCount =
        p.pillars.unit.failedTests +
        p.pillars.integration.failedTests +
        p.pillars.system.failedTests;

      queue.push({
        id: `attn-${p.id}-blocked`,
        projectId: p.id,
        projectName: p.name,
        severity: "CRITICAL",
        category: "failures",
        pillar: failedPillar,
        title: `Active failures blocking release gate in ${p.name}`,
        description: `${failCount} test assertion failure(s) detected. Gate is BLOCKED.`,
        ctaLabel: "Diagnose ↗",
        targetPillar: failedPillar,
        targetFocus: {},
      });
    } else if (p.gateStatus === "UNTESTED") {
      queue.push({
        id: `attn-${p.id}-untested`,
        projectId: p.id,
        projectName: p.name,
        severity: "MEDIUM",
        category: "zero-test",
        pillar: "unit",
        title: `Zero test suites executed for ${p.name}`,
        description:
          p.pillars.integration.totalApis > 0
            ? `${p.pillars.integration.totalApis} API endpoints discovered with 0 executed test suites.`
            : "Project repository is imported with 0 executed test suites.",
        ctaLabel: "Run Suites ↗",
        targetPillar: "unit",
        targetFocus: {},
      });
    } else if (p.pillars.integration.uncoveredApis > 0) {
      queue.push({
        id: `attn-${p.id}-uncovered-apis`,
        projectId: p.id,
        projectName: p.name,
        severity: "HIGH",
        category: "missing-deps",
        pillar: "integration",
        title: `${p.pillars.integration.uncoveredApis} uncovered API endpoints in ${p.name}`,
        description: `${p.pillars.integration.coveredApis}/${p.pillars.integration.totalApis} APIs covered (${p.pillars.integration.coveragePct ?? 0}%). Synthesize integration tests to close gaps.`,
        ctaLabel: "Synthesize API Tests ↗",
        targetPillar: "integration",
        targetFocus: {},
      });
    }
  }

  return queue;
}

function getEmptyKpis(timeRoi = {}) {
  return {
    totalProjects: 0,
    timeRoi,
    gateBreakdown: { passed: 0, atRisk: 0, blocked: 0, untested: 0, passedPct: 0 },
    card1Health: {
      avgHealthScore: null,
      grade: "—",
      totalProjects: 0,
      testedProjects: 0,
      passedProjects: 0,
      atRiskProjects: 0,
      blockedProjects: 0,
      untestedProjects: 0,
    },
    card2Coverage: {
      unifiedCoveragePct: null,
      avgUnitCoveragePct: null,
      avgIntegrationCoveragePct: null,
      avgSystemCoveragePct: null,
      layerCoverageMeta: {
        unit: { avgPct: null, measuredCount: 0, totalKpiProjects: 0 },
        integration: { avgPct: null, measuredCount: 0, totalKpiProjects: 0 },
        system: { avgPct: null, measuredCount: 0, totalKpiProjects: 0 },
      },
    },
    card3Scale: {
      totalExecutedTests: 0,
      totalPassedTests: 0,
      totalFailedTests: 0,
      overallPassRatePct: null,
      unitPassedStr: "0/0",
      apiCoveredStr: "0/0",
      systemVerifiedStr: "0/0",
      cumulativeDurationStr: "0ms",
    },
    card4AiImpact: {
      totalAiTests: 0,
      aiGeneratedCount: 0,
      aiRepairedCount: 0,
      uncoveredGapsCount: 0,
      uncoveredApisCount: 0,
      lowBranchUnitFilesCount: 0,
    },
  };
}
