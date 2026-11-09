/**
 * @file portfolioTimeRoi.calculator.js
 * @description Industry-standard testing time estimation and ROI engine.
 * Computes actual machine execution duration vs. estimated manual testing effort,
 * AI test synthesis time savings, speedup multipliers, and radar efficiency metrics.
 */

export const MANUAL_BENCHMARK_MS = Object.freeze({
  unit: 120_000,        // 2 minutes per unit test case (logic check + assertions)
  integration: 300_000, // 5 minutes per API integration test (setup DB, token, Postman verification)
  system: 480_000,      // 8 minutes per E2E journey (browser walkthrough + DOM assertion)
});

export const AI_AUTHORING_SAVED_MINUTES_PER_TEST = 15; // 15 mins saved per test generated or repaired by AI

/**
 * Format milliseconds into human-readable duration string (e.g. "3.8s", "2m 14s", "450ms")
 */
export function formatDurationMs(ms = 0) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return `${Math.round(n)}ms`;
  const sec = n / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const mins = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  if (mins < 60) return `${mins}m ${remSec}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

/**
 * Format hours into human-readable string (e.g. "1.5 hrs" or "42 hrs")
 */
export function formatHours(hours = 0) {
  const h = Number(hours) || 0;
  if (h < 1) {
    const mins = Math.round(h * 60);
    return `${mins} mins`;
  }
  return `${h.toFixed(1)} hrs`;
}

/**
 * Compute time & ROI metrics for a single project based on actual test runs and counts.
 */
export function computeProjectTimeAndRoiMetrics({
  unitStats = {},
  unitRun = null,
  intStats = {},
  integrationRun = null,
  sysStats = {},
  systemRun = null,
  aiGeneratedCount = 0,
  aiRepairedCount = 0,
}) {
  const u = unitRun || unitStats || {};
  const i = integrationRun || intStats || {};
  const s = systemRun || sysStats || {};

  const unitTotal = Math.max(0, Number(u.totalTests) || 0);
  const intTotal = Math.max(0, Number(i.totalTests) || Number(i.totalApis) || 0);
  const sysTotal = Math.max(0, Number(s.totalTests) || Number(s.totalJourneys) || 0);

  const unitDurationMs = Math.max(0, Number(u.durationMs) || 0);
  const intDurationMs = Math.max(0, Number(i.durationMs) || 0);
  const sysDurationMs = Math.max(0, Number(s.durationMs) || 0);

  const actualAutoDurationMs = unitDurationMs + intDurationMs + sysDurationMs;

  const estimatedManualDurationMs =
    unitTotal * MANUAL_BENCHMARK_MS.unit +
    intTotal * MANUAL_BENCHMARK_MS.integration +
    sysTotal * MANUAL_BENCHMARK_MS.system;

  const executionTimeSavedMs = Math.max(0, estimatedManualDurationMs - actualAutoDurationMs);
  const executionHoursSaved = Number((executionTimeSavedMs / 3_600_000).toFixed(2));

  const totalAiSynthesized = Math.max(0, Number(aiGeneratedCount) || 0) + Math.max(0, Number(aiRepairedCount) || 0);
  const aiAuthoringSavedMinutes = totalAiSynthesized * AI_AUTHORING_SAVED_MINUTES_PER_TEST;
  const aiAuthoringHoursSaved = Number((aiAuthoringSavedMinutes / 60).toFixed(2));

  const totalHoursSaved = Number((executionHoursSaved + aiAuthoringHoursSaved).toFixed(2));

  let speedupMultiplier = 0;
  if (actualAutoDurationMs > 0 && estimatedManualDurationMs > 0) {
    speedupMultiplier = Number((estimatedManualDurationMs / actualAutoDurationMs).toFixed(1));
  } else if (estimatedManualDurationMs > 0 && actualAutoDurationMs === 0) {
    // Has test specifications defined but not executed yet
    speedupMultiplier = 1;
  }

  // Automation Efficiency Score (0-100) for comparison radar axis 5
  // Weighted by speedup (up to 200x) and execution coverage
  const speedupNorm = Math.min(100, (speedupMultiplier / 150) * 100);
  const totalTests = unitTotal + intTotal + sysTotal;
  const efficiencyScore = totalTests > 0
    ? Math.round(0.6 * speedupNorm + 0.4 * (actualAutoDurationMs < 60_000 ? 100 : 70))
    : 0;

  return {
    actualAutoDurationMs,
    actualAutoDurationStr: formatDurationMs(actualAutoDurationMs),
    estimatedManualDurationMs,
    estimatedManualDurationStr: formatDurationMs(estimatedManualDurationMs),
    estimatedManualHours: Number((estimatedManualDurationMs / 3_600_000).toFixed(2)),
    estimatedManualHoursStr: formatHours(estimatedManualDurationMs / 3_600_000),
    executionTimeSavedMs,
    executionHoursSaved,
    executionHoursSavedStr: formatHours(executionHoursSaved),
    aiAuthoringSavedMinutes,
    aiAuthoringHoursSaved,
    totalHoursSaved,
    totalHoursSavedStr: formatHours(totalHoursSaved),
    speedupMultiplier,
    speedupStr: speedupMultiplier > 0 ? `${speedupMultiplier}x` : "—",
    efficiencyScore: Math.min(100, Math.max(0, efficiencyScore)),
    tiers: {
      unit: {
        total: unitTotal,
        autoDurationMs: unitDurationMs,
        manualDurationMs: unitTotal * MANUAL_BENCHMARK_MS.unit,
      },
      integration: {
        total: intTotal,
        autoDurationMs: intDurationMs,
        manualDurationMs: intTotal * MANUAL_BENCHMARK_MS.integration,
      },
      system: {
        total: sysTotal,
        autoDurationMs: sysDurationMs,
        manualDurationMs: sysTotal * MANUAL_BENCHMARK_MS.system,
      },
    },
  };
}

/**
 * Aggregate Time & ROI metrics across all projects in the Active Scope (DOING & NOT_STARTED).
 */
export function aggregatePortfolioTimeAndRoi(activeProjects = []) {
  let totalAutoDurationMs = 0;
  let totalManualDurationMs = 0;
  let totalExecutionTimeSavedMs = 0;
  let totalAiAuthoringSavedMinutes = 0;
  let projectsWithExecutions = 0;

  for (const p of activeProjects) {
    const timeRoi = p.timeRoi || {};
    totalAutoDurationMs += Number(timeRoi.actualAutoDurationMs) || 0;
    totalManualDurationMs += Number(timeRoi.estimatedManualDurationMs) || 0;
    totalExecutionTimeSavedMs += Number(timeRoi.executionTimeSavedMs) || 0;
    totalAiAuthoringSavedMinutes += Number(timeRoi.aiAuthoringSavedMinutes) || 0;
    if (timeRoi.actualAutoDurationMs > 0) {
      projectsWithExecutions++;
    }
  }

  const executionHoursSaved = Number((totalExecutionTimeSavedMs / 3_600_000).toFixed(2));
  const aiAuthoringHoursSaved = Number((totalAiAuthoringSavedMinutes / 60).toFixed(2));
  const totalQaHoursSaved = Number((executionHoursSaved + aiAuthoringHoursSaved).toFixed(2));

  const speedupMultiplier =
    totalAutoDurationMs > 0 && totalManualDurationMs > 0
      ? Number((totalManualDurationMs / totalAutoDurationMs).toFixed(1))
      : 0;

  return {
    totalAutoDurationMs,
    totalAutoDurationStr: formatDurationMs(totalAutoDurationMs),
    totalAutoExecutionSeconds: Number((totalAutoDurationMs / 1000).toFixed(1)),
    totalManualDurationMs,
    totalManualDurationStr: formatDurationMs(totalManualDurationMs),
    totalManualHours: Number((totalManualDurationMs / 3_600_000).toFixed(1)),
    totalManualExecutionHours: Number((totalManualDurationMs / 3_600_000).toFixed(1)),
    totalManualHoursStr: formatHours(totalManualDurationMs / 3_600_000),
    executionHoursSaved,
    aiAuthoringHoursSaved,
    totalQaHoursSaved,
    totalQaHoursSavedStr: formatHours(totalQaHoursSaved),
    speedupMultiplier,
    averageSpeedupMultiplier: speedupMultiplier,
    speedupStr: speedupMultiplier > 0 ? `${speedupMultiplier}x Faster` : "—",
    projectsWithExecutions,
    activeProjectsCount: activeProjects.length,
    formulaBreakdown: {
      unitBenchmarkMinutes: MANUAL_BENCHMARK_MS.unit / 60_000,
      integrationBenchmarkMinutes: MANUAL_BENCHMARK_MS.integration / 60_000,
      systemBenchmarkMinutes: MANUAL_BENCHMARK_MS.system / 60_000,
      aiAuthoringMinutesPerTest: AI_AUTHORING_SAVED_MINUTES_PER_TEST,
    },
  };
}

