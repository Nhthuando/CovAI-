import {
  DEMO_PORTFOLIO_PROJECTS,
  DEMO_CROSS_PROJECT_ATTENTION_QUEUE,
  DEMO_PORTFOLIO_ACTIVITY_FEED,
} from "./portfolioDashboard.mock.js";
import {
  computePortfolioExecutiveKpis,
  computeBenchmarkAndQuadrantData,
} from "./portfolioDashboard.selectors.js";
import { PORTFOLIO_CONFIG } from "./portfolioDashboard.config.js";

/**
 * Normalizes raw API projects or Demo Showcase dataset into PortfolioVM
 */
export function adaptPortfolioDashboard({
  rawProjects = [],
  perProjectSummaries = {},
  favorites = [],
  dataMode = "live",
} = {}) {
  // ── 1. Demo Mode Showcase ────────────────────────────────────────────────
  if (dataMode === "demo") {
    const projects = DEMO_PORTFOLIO_PROJECTS.map((p) => ({
      ...p,
      isPinned: favorites.includes(p.id) || p.isPinned,
    }));

    const kpis = computePortfolioExecutiveKpis(projects);
    const analytics = computeBenchmarkAndQuadrantData(projects);
    const totalSnapshotsCount = projects.reduce(
      (acc, p) => acc + (p.snapshotId ? 1 : 0),
      14 // Account baseline snapshots
    );

    return {
      dataMode: "demo",
      projects,
      kpis,
      analytics,
      attentionQueue: DEMO_CROSS_PROJECT_ATTENTION_QUEUE,
      activityFeed: DEMO_PORTFOLIO_ACTIVITY_FEED,
      metadata: {
        activeProjectsCount: projects.length,
        totalSnapshotsCount,
        lastSyncedAt: new Date().toISOString(),
      },
    };
  }

  // ── 2. Live State Mode ───────────────────────────────────────────────────
  const projects = (rawProjects || []).map((rp) => {
    const summary = perProjectSummaries[rp.id] || {};
    const unitSummary = summary.unit || {};
    const intSummary = summary.integration || {};
    const sysSummary = summary.system || {};

    const unitTotal = Number(unitSummary.totalTests || 0);
    const unitPassed = Number(unitSummary.passedTests || 0);
    const unitFailed = Number(unitSummary.failedTests || 0);
    const unitCov = Number(unitSummary.coverageMetrics?.lines ?? 0);

    const intTotal = Number(intSummary.totalTests || 0);
    const intPassed = Number(intSummary.passedTests || 0);
    const intFailed = Number(intSummary.failedTests || 0);
    const intCov = Number(intSummary.coverageMetrics?.apiEndpoint ?? 0);
    const intTotalApis = Number(intSummary.coverageMetrics?.totalApis || intSummary.totalApis || 0);
    const intCoveredApis = Number(intSummary.coverageMetrics?.coveredApis || intPassed || 0);
    const intUncoveredApis = Number(intSummary.coverageMetrics?.uncoveredApis || Math.max(0, intTotalApis - intCoveredApis));

    const sysTotal = Number(sysSummary.totalTests || 0);
    const sysPassed = Number(sysSummary.passedTests || 0);
    const sysFailed = Number(sysSummary.failedTests || 0);
    const sysCov = Number(sysSummary.coverageMetrics?.flow ?? 0);

    const totalExecuted = unitTotal + intTotal + sysTotal;
    const totalPassed = unitPassed + intPassed + sysPassed;
    const totalFailed = unitFailed + intFailed + sysFailed;

    const passRate =
      totalExecuted > 0
        ? Number(((totalPassed / totalExecuted) * 100).toFixed(1))
        : null;

    // Detect frameworks
    const detectedFrameworks = [];
    if (rp.repoUrl) detectedFrameworks.push("GitHub");
    if (unitTotal > 0 || unitSummary.framework) {
      detectedFrameworks.push(unitSummary.framework || "Jest");
    }
    if (intTotal > 0 || intTotalApis > 0) {
      detectedFrameworks.push("Supertest");
    }
    if (sysTotal > 0) {
      detectedFrameworks.push("Playwright");
    }
    if (detectedFrameworks.length === 0) {
      detectedFrameworks.push("Node.js");
    }

    // Health Score calculation
    let healthScore = 0;
    let gateStatus = "UNTESTED";
    let gateLabel = "UNTESTED";
    let grade = "—";

    if (totalExecuted > 0) {
      const w = PORTFOLIO_CONFIG.weights;
      const weightedCov = unitCov * w.unit + intCov * w.integration + sysCov * w.system;
      const rawScore = 0.5 * (passRate ?? 0) + 0.5 * weightedCov;
      healthScore = Math.min(100, Math.max(0, Math.round(rawScore)));

      if (healthScore >= PORTFOLIO_CONFIG.grades.A) grade = "A";
      else if (healthScore >= PORTFOLIO_CONFIG.grades.B) grade = "B";
      else if (healthScore >= PORTFOLIO_CONFIG.grades.C) grade = "C";
      else grade = "D";

      if (totalFailed === 0 && passRate >= 95 && healthScore >= 80) {
        gateStatus = "PASSED";
        gateLabel = "READY TO RELEASE";
      } else if (totalFailed > 0 || passRate < 80) {
        gateStatus = "BLOCKED";
        gateLabel = "BLOCKED";
      } else {
        gateStatus = "AT_RISK";
        gateLabel = "AT RISK";
      }
    }

    const unifiedCov =
      totalExecuted > 0
        ? Number(
            (
              unitCov * PORTFOLIO_CONFIG.weights.unit +
              intCov * PORTFOLIO_CONFIG.weights.integration +
              sysCov * PORTFOLIO_CONFIG.weights.system
            ).toFixed(1)
          )
        : 0;

    let bottleneckCallout = "✓ All testing layers verified";
    if (totalExecuted === 0) {
      bottleneckCallout = intTotalApis > 0
        ? `⚠️ ${intTotalApis} APIs discovered • 0 test suites executed`
        : "⚠️ No test suites executed yet. Run tests to generate metrics.";
    } else if (totalFailed > 0) {
      bottleneckCallout = `🛑 ${totalFailed} test failure(s) detected across active suites`;
    } else if (intUncoveredApis > 0) {
      bottleneckCallout = `⚠️ ${intUncoveredApis} uncovered API endpoints require test suites`;
    }

    const isPinned = favorites.includes(rp.id);
    const sparkline = healthScore > 0
      ? [
          Math.max(0, healthScore - 6),
          Math.max(0, healthScore - 4),
          Math.max(0, healthScore - 5),
          Math.max(0, healthScore - 2),
          healthScore,
        ]
      : [0, 0, 0, 0, 0];

    return {
      id: rp.id,
      name: rp.name,
      description: rp.description || "Project Workspace",
      repoUrl: rp.repoUrl || null,
      branch: rp.branch || "main",
      snapshotId: rp.latestSnapshotId || rp.snapshots?.[0]?.id || null,
      updatedAt: rp.updatedAt || rp.createdAt || new Date().toISOString(),
      createdAt: rp.createdAt || new Date().toISOString(),
      frameworks: detectedFrameworks,
      healthScore,
      grade,
      delta: 0,
      gateStatus,
      gateLabel,
      isPinned,
      unifiedCoveragePct: unifiedCov,
      passRatePct: passRate,
      sparkline,
      bottleneckCallout,
      pillars: {
        unit: {
          framework: unitSummary.framework || "Jest",
          coveragePct: unitCov,
          branchCoveragePct: Number(unitSummary.coverageMetrics?.branches ?? 0),
          totalTests: unitTotal,
          passedTests: unitPassed,
          failedTests: unitFailed,
          durationMs: Number(unitSummary.durationMs ?? 0),
        },
        integration: {
          framework: "Supertest",
          coveragePct: intCov,
          totalApis: intTotalApis,
          coveredApis: intCoveredApis,
          uncoveredApis: intUncoveredApis,
          totalTests: intTotal,
          passedTests: intPassed,
          failedTests: intFailed,
          durationMs: Number(intSummary.durationMs ?? 0),
          failureLayers: intSummary.failureDistribution || { route: 0, middleware: 0, controller: 0, database: 0 },
        },
        system: {
          framework: "Playwright",
          coveragePct: sysCov,
          totalJourneys: sysTotal,
          coveredJourneys: sysPassed,
          totalTests: sysTotal,
          passedTests: sysPassed,
          failedTests: sysFailed,
          durationMs: Number(sysSummary.durationMs ?? 0),
          failureTypes: { selector: 0, timeout: 0, assertion: sysFailed },
        },
      },
      aiMetrics: {
        aiGeneratedTests: Number(rp.aiGeneratedCount ?? 0),
        aiRepairedTests: Number(rp.aiRepairedCount ?? 0),
        uncoveredGaps: intUncoveredApis,
      },
    };
  });

  const kpis = computePortfolioExecutiveKpis(projects);
  const analytics = computeBenchmarkAndQuadrantData(projects);

  // Synthesize live attention queue from projects
  const liveAttentionQueue = [];
  for (const p of projects) {
    if (p.gateStatus === "BLOCKED") {
      liveAttentionQueue.push({
        id: `attn-${p.id}-blocked`,
        projectId: p.id,
        projectName: p.name,
        severity: "CRITICAL",
        category: "failures",
        pillar: p.pillars.integration.failedTests > 0 ? "integration" : "unit",
        title: `Active test failures detected in ${p.name}`,
        description: `Project has failing suites blocking release gate verification.`,
        ctaLabel: "Diagnose ↗",
        targetPillar: p.pillars.integration.failedTests > 0 ? "integration" : "unit",
        targetFocus: {},
      });
    } else if (p.gateStatus === "UNTESTED") {
      liveAttentionQueue.push({
        id: `attn-${p.id}-untested`,
        projectId: p.id,
        projectName: p.name,
        severity: "MEDIUM",
        category: "zero-test",
        pillar: "unit",
        title: `No test suites executed for ${p.name}`,
        description: `Project repository is imported but lacks baseline automated test suites.`,
        ctaLabel: "Generate Suites ↗",
        targetPillar: "unit",
        targetFocus: {},
      });
    }
  }

  const totalSnapshotsCount = projects.reduce(
    (acc, p) => acc + (p.snapshotId ? 1 : 0),
    0
  );

  return {
    dataMode: "live",
    projects,
    kpis,
    analytics,
    attentionQueue: liveAttentionQueue,
    activityFeed: [],
    metadata: {
      activeProjectsCount: projects.length,
      totalSnapshotsCount: Math.max(projects.length, totalSnapshotsCount),
      lastSyncedAt: new Date().toISOString(),
    },
  };
}

