import { representativeScore } from "./aiEvaluation/scoring.service.js";

export const INTEGRATION_AI_TEST_MODES = Object.freeze(
  new Set([
    "INTEGRATION_GENERATION",
    "INTEGRATION_REGENERATE",
    "SUPERTEST",
    "SUPERTEST_REGENERATE",
  ]),
);

/**
 * Canonical 7 project features tracked for R2 Per-Feature Execution Duration.
 * Project Analysis maps specifically to ANALYSIS jobs (separate from quality/security sub-scans).
 */
export const CANONICAL_FEATURE_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "project_analysis",
    label: "Project Analysis",
    jobTypes: Object.freeze(["ANALYSIS"]),
  }),
  Object.freeze({
    key: "unit_test_coverage",
    label: "Unit Test Coverage",
    jobTypes: Object.freeze([
      "RUN_TESTS",
      "RUN_VITEST_TESTS",
      "COVERAGE",
      "VITEST_COVERAGE",
      "PARSE_COVERAGE",
    ]),
  }),
  Object.freeze({
    key: "integration_ai_tests",
    label: "Integration AI Tests",
    jobTypes: Object.freeze(["AI_TESTS"]),
    aiTestModes: INTEGRATION_AI_TEST_MODES,
  }),
  Object.freeze({
    key: "integration_coverage",
    label: "Integration Coverage",
    jobTypes: Object.freeze(["SUPERTEST_COVERAGE", "PLAYWRIGHT_API_COVERAGE"]),
  }),
  Object.freeze({
    key: "system_tests",
    label: "System Tests",
    jobTypes: Object.freeze([
      "SYSTEM_TEST_ASSESSMENT",
      "PLAYWRIGHT_SYSTEM_TEST",
      "PLAYWRIGHT_SYSTEM_COVERAGE",
      "CYPRESS_SYSTEM_TEST",
      "CYPRESS_SYSTEM_COVERAGE",
      "SYSTEM_TEST_IMPROVEMENT",
      "SYSTEM_TEST_ANALYSIS",
      "SYSTEM_TEST_MUTATION",
    ]),
  }),
  Object.freeze({
    key: "install_deps",
    label: "Install Dependencies",
    jobTypes: Object.freeze(["INSTALL_DEPS"]),
  }),
  Object.freeze({
    key: "ai_evaluation",
    label: "AI Evaluation",
    jobTypes: Object.freeze(["AI_EVALUATION"]),
  }),
]);

export const AI_EVALUATION_CRITERIA_META = Object.freeze([
  Object.freeze({ criterionKey: "faithfulness", label: "Sticks to your documents" }),
  Object.freeze({ criterionKey: "completeness", label: "Answers fully" }),
  Object.freeze({ criterionKey: "contextRetention", label: "Remembers the conversation" }),
  Object.freeze({ criterionKey: "appropriateRefusal", label: "Refuses when it should" }),
  Object.freeze({ criterionKey: "keyFacts", label: "Key facts (checked by rules)" }),
]);

const TERMINAL_JOB_STATUSES = new Set(["SUCCESS", "FAILED"]);

export function parseJobPayloadMode(payloadJson) {
  if (!payloadJson) return null;
  if (typeof payloadJson === "object") {
    const mode = payloadJson.mode;
    return typeof mode === "string" && mode.trim() ? mode.trim().toUpperCase() : null;
  }
  if (typeof payloadJson !== "string") return null;
  const trimmed = payloadJson.trim();
  if (!trimmed || trimmed === "{}") return null;
  try {
    const parsed = JSON.parse(trimmed);
    const mode = parsed?.mode;
    return typeof mode === "string" && mode.trim() ? mode.trim().toUpperCase() : null;
  } catch (err) {
    console.warn("[unifiedDashboardMetrics] Failed to parse Job.payloadJson:", err?.message || err);
    return null;
  }
}

export function resolveJobDurationMs(job) {
  if (!job || typeof job !== "object") return null;

  if (
    job.computeTimeMs !== null &&
    job.computeTimeMs !== undefined &&
    job.computeTimeMs !== ""
  ) {
    const num = Number(job.computeTimeMs);
    if (Number.isFinite(num) && num >= 0) {
      return Math.round(num);
    }
  }

  if (job.startedAt && job.finishedAt) {
    const startMs = new Date(job.startedAt).getTime();
    const endMs = new Date(job.finishedAt).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      return Math.round(endMs - startMs);
    }
  }

  return null;
}

export function classifyJobFeatureKey(job) {
  const type = String(job?.type || "").trim().toUpperCase();
  if (!type) return null;

  if (type === "AI_TESTS") {
    const mode = parseJobPayloadMode(job?.payloadJson);
    return mode && INTEGRATION_AI_TEST_MODES.has(mode) ? "integration_ai_tests" : null;
  }

  for (const def of CANONICAL_FEATURE_DEFINITIONS) {
    if (def.key === "integration_ai_tests") continue;
    if (def.jobTypes.includes(type)) {
      return def.key;
    }
  }

  return null;
}

function toTimestampMs(val) {
  if (!val) return 0;
  const ms = val instanceof Date ? val.getTime() : new Date(val).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function toIsoOrNull(val) {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function aggregateFeatureExecutionDurations(jobs = []) {
  const buckets = new Map();
  for (const def of CANONICAL_FEATURE_DEFINITIONS) {
    buckets.set(def.key, {
      def,
      entries: [],
    });
  }

  const terminalJobs = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => TERMINAL_JOB_STATUSES.has(String(job?.status || "").toUpperCase()))
    .sort((a, b) => {
      const timeDiff =
        toTimestampMs(b.finishedAt || b.createdAt) -
        toTimestampMs(a.finishedAt || a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      return toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt);
    });

  for (const job of terminalJobs) {
    const featureKey = classifyJobFeatureKey(job);
    if (!featureKey) continue;
    const durationMs = resolveJobDurationMs(job);
    if (durationMs === null) continue;
    const bucket = buckets.get(featureKey);
    if (!bucket) continue;
    bucket.entries.push({
      durationMs,
      status: String(job.status).toUpperCase(),
      runAt: toIsoOrNull(job.finishedAt || job.createdAt),
    });
  }

  return CANONICAL_FEATURE_DEFINITIONS.map((def) => {
    const bucket = buckets.get(def.key);
    const entries = bucket?.entries || [];
    if (entries.length === 0) {
      return {
        key: def.key,
        label: def.label,
        jobTypes: [...def.jobTypes],
        runCount: 0,
        latestDurationMs: null,
        totalDurationMs: null,
        avgDurationMs: null,
        lastRunAt: null,
        lastStatus: "NOT_RUN",
      };
    }

    const totalDurationMs = entries.reduce((sum, item) => sum + item.durationMs, 0);
    const runCount = entries.length;
    const latest = entries[0];
    return {
      key: def.key,
      label: def.label,
      jobTypes: [...def.jobTypes],
      runCount,
      latestDurationMs: latest.durationMs,
      totalDurationMs,
      avgDurationMs: Math.round(totalDurationMs / runCount),
      lastRunAt: latest.runAt,
      lastStatus: latest.status,
    };
  });
}

function roundPctOrNull(val, decimals = 1) {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(decimals));
}

function normalizeRateToPct(val) {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const pct = num <= 1 ? num * 100 : num;
  return Number(pct.toFixed(1));
}

function normalizeExecutionStatus(rawStatus) {
  const s = String(rawStatus || "").trim().toUpperCase();
  if (!s) return "NOT_RUN";
  if (s === "CANCELED") return "CANCELLED";
  return s;
}

export function buildAiEvaluationSummary({ runs = [], designAudit = null } = {}) {
  const mappedDesignAudit = designAudit
    ? {
        status: "READY",
        detected: Boolean(designAudit.detected),
        designScore: roundPctOrNull(designAudit.designScore, 1),
        findingsCount: Array.isArray(designAudit.findingsJson)
          ? designAudit.findingsJson.length
          : Number(designAudit.summaryJson?.findingsCount ?? designAudit.summaryJson?.totalFindings ?? 0),
      }
    : null;

  const sortedRuns = (Array.isArray(runs) ? runs : [])
    .filter(Boolean)
    .sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));

  if (sortedRuns.length === 0) {
    return {
      hasRun: false,
      status: "NOT_RUN",
      verdict: "NOT_RUN",
      score: null,
      rawScore: null,
      scoreHidden: false,
      passMark: null,
      criticalSafetyFailure: false,
      partial: false,
      completeness: null,
      scenarioPassRate: null,
      stability: null,
      latency: null,
      criteriaSummary: [],
      tasks: [],
      totalRuns: 0,
      latestRunId: null,
      lastRunAt: null,
      targetName: null,
      profileName: null,
      designAudit: mappedDesignAudit,
    };
  }

  const latestRun = sortedRuns[0];
  const latestStatus = normalizeExecutionStatus(latestRun.executionStatus);
  const inProgress = ["QUEUED", "RUNNING", "PROCESSING"].includes(latestStatus);
  const completedFallback = inProgress
    ? sortedRuns.find((r) => normalizeExecutionStatus(r.executionStatus) === "COMPLETED" && r.summary)
    : null;
  const metricRun = completedFallback || latestRun;
  const summary =
    metricRun.summary && typeof metricRun.summary === "object" ? metricRun.summary : null;

  const rep = summary ? representativeScore(summary) : null;
  const rawScore = roundPctOrNull(summary?.score, 1);
  const score = rep ? roundPctOrNull(rep.value, 1) : null;
  const scoreHidden = Boolean(rep?.hidden);

  const rawPassMark =
    summary?.passMark ??
    summary?.passThreshold ??
    metricRun?.profileVersion?.definition?.scoring?.threshold ??
    null;
  const passMark =
    rawPassMark !== null && rawPassMark !== undefined && Number.isFinite(Number(rawPassMark))
      ? Number(rawPassMark)
      : null;

  const rawVerdict = String(summary?.verdict || metricRun.verdict || "").toUpperCase();
  const verdict = ["PASSED", "FAILED", "INCOMPLETE"].includes(rawVerdict)
    ? rawVerdict
    : "INCOMPLETE";

  const completeness = summary?.completeness
    ? {
        scored: Number(summary.completeness.scored ?? 0),
        applicable: Number(summary.completeness.applicable ?? 0),
      }
    : rep
      ? {
          scored: Number(rep.scored ?? 0),
          applicable: Number(rep.applicable ?? 0),
        }
      : null;

  const rawSpr = summary?.scenarioPassRate;
  const scenarioPassRate = rawSpr
    ? {
        passed: Number(rawSpr.passed ?? 0),
        evaluated: Number(rawSpr.evaluated ?? 0),
        total: Number(rawSpr.total ?? 0),
        rate:
          rawSpr.wilson95?.rate != null
            ? normalizeRateToPct(rawSpr.wilson95.rate)
            : Number(rawSpr.evaluated) > 0
              ? roundPctOrNull((Number(rawSpr.passed ?? 0) / Number(rawSpr.evaluated)) * 100, 1)
              : null,
        wilson95:
          rawSpr.wilson95 && rawSpr.wilson95.rate !== null && rawSpr.wilson95.rate !== undefined
            ? {
                rate: Number(rawSpr.wilson95.rate),
                lower: Number(rawSpr.wilson95.lower ?? rawSpr.wilson95.low ?? 0),
                upper: Number(rawSpr.wilson95.upper ?? rawSpr.wilson95.high ?? 0),
              }
            : null,
      }
    : null;

  const rawStab = summary?.stability;
  const stability = rawStab
    ? {
        eligibleCases: Number(rawStab.eligibleCases ?? 0),
        stableCases: Number(rawStab.stableCases ?? 0),
        unstableCases: Number(rawStab.unstableCases ?? 0),
        stabilityRate: normalizeRateToPct(rawStab.stabilityRate),
      }
    : null;

  const rawLat = summary?.latency;
  const latency = rawLat
    ? {
        avgMs:
          rawLat.avgMs !== null && rawLat.avgMs !== undefined && Number.isFinite(Number(rawLat.avgMs))
            ? Math.round(Number(rawLat.avgMs))
            : null,
        p95Ms:
          rawLat.p95Ms !== null && rawLat.p95Ms !== undefined && Number.isFinite(Number(rawLat.p95Ms))
            ? Math.round(Number(rawLat.p95Ms))
            : null,
        slaMs:
          rawLat.slaMs !== null && rawLat.slaMs !== undefined && Number.isFinite(Number(rawLat.slaMs))
            ? Math.round(Number(rawLat.slaMs))
            : null,
        withinSlaRate: normalizeRateToPct(rawLat.withinSlaRate),
        status: rawLat.status ? String(rawLat.status) : null,
      }
    : null;

  const rawBreakdown = Array.isArray(summary?.criteriaBreakdown) ? summary.criteriaBreakdown : [];
  const breakdownByKey = new Map(
    rawBreakdown.filter((c) => c?.criterionKey).map((c) => [c.criterionKey, c]),
  );
  const criteriaSummary = AI_EVALUATION_CRITERIA_META.map((meta) => {
    const item = breakdownByKey.get(meta.criterionKey);
    return {
      criterionKey: meta.criterionKey,
      label: meta.label,
      score: item ? roundPctOrNull(item.score, 1) : null,
      scored: Number(item?.scored ?? 0),
      applicable: Number(item?.applicable ?? 0),
    };
  });
  for (const item of rawBreakdown) {
    if (!item?.criterionKey) continue;
    if (AI_EVALUATION_CRITERIA_META.some((m) => m.criterionKey === item.criterionKey)) continue;
    criteriaSummary.push({
      criterionKey: item.criterionKey,
      label: item.criterionKey,
      score: roundPctOrNull(item.score, 1),
      scored: Number(item.scored ?? 0),
      applicable: Number(item.applicable ?? 0),
    });
  }

  const tasks = Array.isArray(summary?.tasks)
    ? summary.tasks.map((t) => ({
        taskType: String(t.taskType || ""),
        score: roundPctOrNull(t.score, 1),
        scored: Number(t.scored ?? 0),
        applicable: Number(t.applicable ?? 0),
        partial: Boolean(t.partial),
      }))
    : [];

  return {
    hasRun: true,
    status: latestStatus,
    verdict,
    score,
    rawScore,
    scoreHidden,
    passMark,
    criticalSafetyFailure: Boolean(summary?.criticalSafetyFailure),
    partial: Boolean(summary?.partial),
    completeness,
    scenarioPassRate,
    stability,
    latency,
    criteriaSummary,
    tasks,
    totalRuns: sortedRuns.length,
    latestRunId: latestRun.id || null,
    lastRunAt: toIsoOrNull(latestRun.finishedAt || latestRun.createdAt),
    targetName: latestRun?.targetVersion?.target?.name || metricRun?.targetVersion?.target?.name || null,
    profileName:
      latestRun?.profileVersion?.profile?.name || metricRun?.profileVersion?.profile?.name || null,
    designAudit: mappedDesignAudit,
  };
}
