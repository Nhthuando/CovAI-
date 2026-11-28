import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { resolveProjectAccess } from "./projectAccess.service.js";
import { buildIntegrationWorkspace } from "./integrationWorkspace.service.js";
import { detectCoverageFrameworks } from "./coverageFramework.service.js";
import { coverageSummaryFor } from "./systemAssessmentContract.service.js";
import { cleanStoragePath, cleanStorageText } from "../utils/pathSanitizer.js";
import { isApiFilePath } from "../utils/apiFileDetector.js";
import {
  isBusinessLogicSourceFile,
  extractProjectCoverageExclusions,
} from "../utils/businessLogicFileDetector.js";
import {
  resolveCanonicalUnitCoverage,
  extractThresholdExceptions,
  resolveProjectRelativePath,
  getNormalizedMatchKey,
  resolveSnapshotRootDir,
} from "./unitCoverageSummary.service.js";
import {
  computeFixedWeightProjectHealth,
  safeParseMetaJson,
} from "../../../shared/portfolioGovernance.js";
import {
  aggregateFeatureExecutionDurations,
  buildAiEvaluationSummary,
} from "./unifiedDashboardMetrics.service.js";

function toFixedNum(val, fallback = 0) {
  if (val === null || val === undefined || val === "") return fallback;
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  return Number(num.toFixed(1));
}

function getPassRate(passed = 0, failed = 0) {
  const executed = (Number(passed) || 0) + (Number(failed) || 0);
  if (executed <= 0) return null;
  return Number((((Number(passed) || 0) / executed) * 100).toFixed(1));
}

// In-memory caches for sub-300ms warm performance
const frameworkCache = new Map();
const dashboardPayloadCache = new Map();
const inFlightUnifiedBuilds = new Map();
const DASHBOARD_FAST_TTL_MS = 15_000; // 15s zero-RTT fast path (explicitly invalidated on mutations)
const DASHBOARD_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function computeDashboardFingerprintFromData({
  latestRun,
  snapshotMeta,
  latestAiTest,
  coverageSum,
  latestProjectJob = null,
  latestAiEvalRun = null,
  latestDesignAudit = null,
}) {
  if (!snapshotMeta) return null;

  let filesMtime = 0;
  const resolvedDir = snapshotMeta.rootDir
    ? resolveSnapshotRootDir(snapshotMeta.rootDir) || snapshotMeta.rootDir
    : null;
  if (resolvedDir && fs.existsSync(resolvedDir)) {
    try {
      const candidateFiles = [
        path.join(resolvedDir, "coverage", "integration-scenarios.json"),
        path.join(resolvedDir, ".covai", "integration-scenarios.json"),
        path.join(resolvedDir, "coverage", "runtime-evidence.json"),
        path.join(resolvedDir, ".covai", "runtime-evidence.json"),
      ];
      for (const cf of candidateFiles) {
        if (fs.existsSync(cf)) {
          filesMtime += fs.statSync(cf).mtimeMs;
        }
      }
    } catch (_) {}
  }

  const p = snapshotMeta.project;
  const toMs = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : 0);
  const jobSig = latestProjectJob
    ? `${latestProjectJob.id || ""}_${latestProjectJob.status || ""}_${toMs(latestProjectJob.finishedAt || latestProjectJob.createdAt)}_${latestProjectJob.computeTimeMs ?? ""}`
    : "nojob";
  const evalSig = latestAiEvalRun
    ? `${latestAiEvalRun.id || ""}_${latestAiEvalRun.executionStatus || ""}_${latestAiEvalRun.verdict || ""}_${toMs(latestAiEvalRun.finishedAt || latestAiEvalRun.createdAt)}`
    : "noeval";
  const auditSig = latestDesignAudit
    ? `${latestDesignAudit.id || ""}_${latestDesignAudit.detected ? 1 : 0}_${latestDesignAudit.designScore ?? ""}_${toMs(latestDesignAudit.updatedAt)}`
    : "noaudit";
  return `${latestRun?.id || "none"}_${latestRun?.status || ""}_${toMs(latestRun?.createdAt)}_${toMs(snapshotMeta.createdAt)}_${toMs(p?.updatedAt)}_${p?.lifecycleStatus || ""}_${toMs(p?.lifecycleUpdatedAt)}_${p?.activeSnapshotId || ""}_${latestAiTest?.id || ""}_${latestAiTest?.status || ""}_${toMs(latestAiTest?.createdAt)}_${coverageSum?.stmtsPct ?? coverageSum?.linesPct ?? -1}_${Math.round(filesMtime)}_${jobSig}_${evalSig}_${auditSig}`;
}

export async function getDashboardFingerprint(snapshotId) {
  try {
    const [
      latestRun,
      snapshotMeta,
      latestAiTest,
      coverageSum,
      latestProjectJob,
      latestAiEvalRun,
      latestDesignAudit,
    ] = await Promise.all([
      prisma.testRun.findFirst({
        where: { snapshotId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, status: true, durationMs: true },
      }),
      prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: {
          id: true,
          createdAt: true,
          rootDir: true,
          project: {
            select: {
              id: true,
              ownerId: true,
              updatedAt: true,
              lifecycleStatus: true,
              lifecycleUpdatedAt: true,
              activeSnapshotId: true,
            },
          },
        },
      }),
      prisma.aiTest.findFirst({
        where: { snapshotId },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true },
      }),
      prisma.coverageSummary.findUnique({
        where: { snapshotId },
        select: {
          id: true,
          linesPct: true,
          branchesPct: true,
          funcsPct: true,
          stmtsPct: true,
          createdAt: true,
        },
      }),
      prisma.job.findFirst({
        where: {
          project: { snapshots: { some: { id: snapshotId } } },
          status: { in: ["SUCCESS", "FAILED"] },
        },
        orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: { id: true, status: true, finishedAt: true, computeTimeMs: true, createdAt: true },
      }),
      prisma.aiEvaluationRun.findFirst({
        where: { project: { snapshots: { some: { id: snapshotId } } } },
        orderBy: { createdAt: "desc" },
        select: { id: true, executionStatus: true, verdict: true, finishedAt: true, createdAt: true },
      }),
      prisma.aiEvaluationDesignAudit.findFirst({
        where: { snapshotId },
        select: { id: true, detected: true, designScore: true, updatedAt: true },
      }),
    ]);
    if (!snapshotMeta) return null;
    return computeDashboardFingerprintFromData({
      latestRun,
      snapshotMeta,
      latestAiTest,
      coverageSum,
      latestProjectJob,
      latestAiEvalRun,
      latestDesignAudit,
    });
  } catch (err) {
    console.warn("[getDashboardFingerprint] Error calculating fingerprint:", err?.message);
    return null;
  }
}

/**
 * Invalidate in-memory unified dashboard cache for a snapshot or all snapshots.
 */
export function clearUnifiedDashboardCache(snapshotId = null) {
  if (snapshotId) {
    for (const key of dashboardPayloadCache.keys()) {
      if (key === snapshotId || key.startsWith(`${snapshotId}_`)) {
        dashboardPayloadCache.delete(key);
      }
    }
    frameworkCache.delete(snapshotId);
  } else {
    dashboardPayloadCache.clear();
    frameworkCache.clear();
  }
}

/**
 * Invalidate in-memory unified dashboard cache entries belonging to a projectId
 * (used when project-scoped jobs like AI_EVALUATION complete with snapshotId: null).
 */
export function clearUnifiedDashboardCacheForProject(projectId) {
  if (!projectId) return;
  for (const [key, entry] of dashboardPayloadCache.entries()) {
    if (entry?.data?.context?.projectId === projectId) {
      dashboardPayloadCache.delete(key);
      frameworkCache.delete(key);
    }
  }
}

/**
 * Normalize and singularize a domain token, stripping common architectural suffixes.
 */
function normalizeDomainWord(word = "") {
  if (!word) return "";
  let s = word.toLowerCase().trim();
  const stopWords = new Set([
    "controller", "controllers",
    "service", "services",
    "route", "routes", "router", "routers",
    "model", "models", "schema", "schemas",
    "middleware", "middlewares",
    "handler", "handlers",
    "repository", "repositories", "dao",
    "util", "utils", "helper", "helpers",
    "test", "tests", "spec", "specs", "e2e", "cy",
    "vitest", "jest", "playwright", "cypress", "mocha", "chai", "supertest",
    "setup", "config", "workspace", "teardown",
    "mock", "mocks", "fixture", "fixtures",
    "api", "v1", "v2", "item", "items",
    "index", "app", "server", "main", "core"
  ]);
  if (stopWords.has(s)) return "";

  // Singularize trailing plural forms
  if (s.endsWith("ies") && s.length > 4) {
    s = s.slice(0, -3) + "y";
  } else if (s.endsWith("es") && s.length > 4 && !["bytes"].includes(s)) {
    s = s.slice(0, -2);
  } else if (s.endsWith("s") && s.length > 3 && !s.endsWith("ss")) {
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * Normalize a domain module key from a file path, route endpoint, or controller hint.
 */
function extractDomainKey(rawInput = "", secondaryHint = "") {
  const str = String(rawInput || "").trim();
  if (!str && !secondaryHint) return "core";

  const candidates = [str, secondaryHint].filter(Boolean);

  for (const item of candidates) {
    const withoutMethod = item.replace(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+/i, "").trim();

    // 1. API route path: e.g. /api/foodItems/save or /api/cart/add
    if (withoutMethod.startsWith("/")) {
      const segments = withoutMethod
        .split("/")
        .map((s) => s.trim())
        .filter((s) => s && s.toLowerCase() !== "api" && !/^v\d+$/i.test(s) && !s.startsWith(":") && !s.startsWith("{"));

      if (segments.length > 0) {
        const words = segments[0]
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .split(/[^a-zA-Z0-9]+/)
          .map(normalizeDomainWord)
          .filter(Boolean);

        if (words.length > 0) return words[0];
      }
    }

    // 2. File path or suite title
    const normalized = withoutMethod.replace(/\\/g, "/");
    const baseName = normalized.split("/").pop() || normalized;
    const stem = baseName
      .replace(/\.(js|jsx|ts|tsx|mjs|cjs|json)$/i, "")
      .replace(/[._-](test|spec|e2e|cy)\b/gi, "")
      .trim();

    const words = stem
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[^a-zA-Z0-9]+/)
      .map(normalizeDomainWord)
      .filter(Boolean);

    if (words.length > 0) {
      return words[0];
    }
  }

  return "core";
}

function formatDomainTitle(domainKey) {
  const key = String(domainKey || "core");
  const titled = key.charAt(0).toUpperCase() + key.slice(1);
  return `${titled} Module`;
}

/**
 * Deterministic Cross-Layer Root Cause Decision Tree
 */
export function diagnoseModuleRootCause(unitStatus, intStatus, sysStatus, details = {}) {
  const uFail = unitStatus === "fail";
  const iFail = intStatus === "fail";
  const sFail = sysStatus === "fail";

  const uPass = unitStatus === "pass";
  const iPass = intStatus === "pass";
  const sPass = sysStatus === "pass";
  const hasModuleApis = (details.totalEpCount ?? 0) > 0 || (details.uncoveredEpCount ?? 0) > 0;

  if (uFail && (iFail || sFail)) {
    return {
      suspectLayer: "unit",
      summary: "Core service logic defect propagating upward",
      diagnosis: `Unit assertion failure in ${details.unitFile || "unit tests"} cascades to API/UI layers.`,
    };
  }
  if (uFail) {
    const scCount = details.unitFailedScenariosCount || 1;
    return {
      suspectLayer: "unit",
      summary: "Unit test assertion failure",
      diagnosis: `${scCount} unit assertion failure(s) in ${details.unitFile || "module test suite"}.`,
    };
  }
  if (!uFail && iFail && sFail) {
    return {
      suspectLayer: "integration",
      summary: `API defect breaking E2E flow`,
      diagnosis: `Endpoint ${details.endpoint || ""} returned ${details.httpStatus ? `HTTP ${details.httpStatus}` : "error"}, failing downstream E2E user journey.`,
    };
  }
  if (!uFail && iFail) {
    return {
      suspectLayer: "integration",
      summary: `API route failure`,
      diagnosis: `Endpoint ${details.endpoint || "route"} failed (${details.failureLayer || "assertion error"}).`,
    };
  }
  if (!uFail && !iFail && sFail) {
    return {
      suspectLayer: "system",
      summary: `UI / E2E journey failure`,
      diagnosis: `Backend logic passes; E2E journey "${details.flowName || "User Flow"}" failed at step "${details.failedStep || "assertion"}".`,
    };
  }
  if (hasModuleApis && (intStatus === "untested" || intStatus === "warn")) {
    return {
      suspectLayer: "integration",
      summary: "API coverage gap",
      diagnosis:
        details.uncoveredEpCount > 0
          ? `${details.uncoveredEpCount} API endpoint(s) lack integration tests (e.g. ${details.endpoint || "route"}).`
          : "Discovered API endpoints have not been verified via automated integration tests.",
    };
  }
  if (unitStatus === "untested") {
    return {
      suspectLayer: "unit",
      summary: "Unit coverage gap",
      diagnosis: `Source file ${details.unitFile || "module"} has no executed unit tests.`,
    };
  }
  if (unitStatus === "warn") {
    return {
      suspectLayer: "unit",
      summary: "Low unit branch coverage",
      diagnosis: `Branch coverage in ${details.unitFile || "module"} is below 50%.`,
    };
  }
  if (uPass && iPass && sPass) {
    return {
      suspectLayer: "none",
      summary: "Verified across all 3 layers",
      diagnosis: "Unit, Integration API, and System E2E suites pass for this module.",
    };
  }
  if (uPass && !hasModuleApis) {
    return {
      suspectLayer: "none",
      summary:
        (details.totalProjectApis ?? 0) === 0
          ? "Unit verified (no APIs)"
          : "Partial verification",
      diagnosis:
        (details.totalProjectApis ?? 0) === 0
          ? "Unit suite passes; no API endpoints discovered in this snapshot."
          : "Unit suite passes; no API endpoints mapped to this module.",
    };
  }
  return {
    suspectLayer: "none",
    summary: "Partial verification",
    diagnosis: "Executed suites pass; remaining testing layers not yet run.",
  };
}

/**
 * Build Cross-Layer Traceability Matrix rows by clustering real Unit files, Integration endpoints, and System E2E scenarios.
 */
export function buildCrossLayerMatrix({ unitFiles = [], unitScenarios = [], endpoints = [], systemScenarios = [], unitPillar = {}, systemPillar = {} }) {
  const domainMap = new Map();

  const ensureDomain = (key) => {
    const normKey = key || "core";
    if (!domainMap.has(normKey)) {
      domainMap.set(normKey, {
        key: normKey,
        moduleName: formatDomainTitle(normKey),
        unitFiles: [],
        unitScenarios: [],
        endpoints: [],
        systemScenarios: [],
      });
    }
    return domainMap.get(normKey);
  };

  for (const ep of endpoints) {
    const controllerHint = ep.source?.controllerFile || ep.controllerFile || ep.sourceFile || "";
    const key = extractDomainKey(ep.path || ep.name || "", controllerHint);
    ensureDomain(key).endpoints.push(ep);
  }

  for (const f of unitFiles) {
    const key = extractDomainKey(f.filePath || "");
    ensureDomain(key).unitFiles.push(f);
  }

  for (const sc of unitScenarios) {
    const key = extractDomainKey(sc.testFile || sc.suiteName || sc.title || "");
    ensureDomain(key).unitScenarios.push(sc);
  }

  for (const sc of systemScenarios) {
    const key = extractDomainKey(sc.file || sc.suiteName || sc.title || "");
    ensureDomain(key).systemScenarios.push(sc);
  }

  const rows = [];
  for (const grp of domainMap.values()) {
    const totalEp = grp.endpoints.length;
    const coveredEp = grp.endpoints.filter((e) => e.status === "Covered").length;
    const partialEp = grp.endpoints.filter((e) => e.status === "Partial").length;
    const failedEp = grp.endpoints.filter((e) => e.status === "Failed" || e.status === "Script Error").length;
    const issueEp = failedEp + partialEp;
    const uncoveredEp = Math.max(0, totalEp - coveredEp - issueEp);
    const firstEp = grp.endpoints[0] || null;

    const uScenariosTotal = grp.unitScenarios.length;
    const uScenariosFailed = grp.unitScenarios.filter((s) => s.status === "failed").length;
    const uScenariosPassed = grp.unitScenarios.filter((s) => s.status === "passed").length;
    const firstUnitFile = grp.unitFiles[0] || null;

    const sTotal = grp.systemScenarios.length;

    const hasBranchTotals = grp.unitFiles.some((f) => f.branchesTotal != null);
    const totalGroupBranches = grp.unitFiles.reduce((s, f) => s + Number(f.branchesTotal ?? 0), 0);
    const totalGroupLines = grp.unitFiles.reduce((s, f) => s + Number(f.linesTotal ?? 0), 0);

    if (
      uScenariosTotal === 0 &&
      totalEp === 0 &&
      sTotal === 0 &&
      grp.unitFiles.length > 0 &&
      grp.unitFiles.every((f) => f.linesTotal === 0 && f.branchesTotal === 0)
    ) {
      continue;
    }

    const avgUnitBranch =
      grp.unitFiles.length > 0
        ? toFixedNum(
            grp.unitFiles.reduce((acc, f) => acc + Number(f.branchesPct ?? 0), 0) / grp.unitFiles.length
          )
        : null;
    const avgUnitLines =
      grp.unitFiles.length > 0
        ? toFixedNum(
            grp.unitFiles.reduce((acc, f) => acc + Number(f.linesPct ?? 0), 0) / grp.unitFiles.length
          )
        : null;

    const uPassRate = getPassRate(uScenariosPassed, uScenariosFailed);
    const isCoverageOnlyUnit =
      uScenariosTotal === 0 && grp.unitFiles.length > 0 && avgUnitLines !== null;

    let unitStatus = "untested";
    let unitLabel = "0/0 (Not run)";
    if (uScenariosTotal > 0) {
      unitStatus = uScenariosFailed > 0 ? "fail" : "pass";
      const rateInfo = uPassRate !== null ? ` (${uPassRate}%)` : "";
      const covInfo =
        avgUnitLines !== null
          ? ` · ${avgUnitLines}% lines`
          : uScenariosFailed > 0
          ? ` · ${uScenariosFailed} failed`
          : "";
      unitLabel = `${uScenariosPassed}/${uScenariosTotal} passed${rateInfo}${covInfo}`;
    } else if (isCoverageOnlyUnit) {
      if (avgUnitLines === 0 && (avgUnitBranch ?? 0) === 0 && (!hasBranchTotals || totalGroupLines > 0)) {
        unitStatus = "untested";
      } else if (avgUnitLines > 0 && hasBranchTotals && totalGroupBranches === 0) {
        unitStatus = "pass";
      } else {
        unitStatus = (avgUnitBranch ?? 100) < 50 ? "warn" : "pass";
      }
      unitLabel = `${avgUnitLines}% lines${avgUnitBranch !== null ? ` · ${avgUnitBranch}% branch` : ""}`;
    }

    let intStatus = totalEp === 0 ? "none" : "untested";
    let intLabel = "0/0 APIs";
    if (totalEp > 0) {
      if (failedEp > 0) intStatus = "fail";
      else if (coveredEp === totalEp) intStatus = "pass";
      else if (coveredEp > 0 || partialEp > 0) intStatus = "warn";
      else intStatus = "untested";
      intLabel = `${coveredEp}/${totalEp} covered`;
    }

    const sFailed = grp.systemScenarios.filter((s) => s.status === "failed").length;
    const sFlaky = grp.systemScenarios.filter((s) => s.status === "flaky").length;
    const sPassed = grp.systemScenarios.filter((s) => s.status === "passed").length;
    const firstSys = grp.systemScenarios.find((s) => s.status === "failed") || grp.systemScenarios[0] || null;

    let sysStatus = "untested";
    let sysLabel = "0/0 Journeys";
    if (sTotal > 0) {
      sysStatus = sFailed > 0 ? "fail" : sFlaky > 0 ? "warn" : "pass";
      sysLabel = `${sPassed}/${sTotal} journeys`;
    } else if (systemPillar.totalTests > 0 && domainMap.size === 1) {
      sysStatus = systemPillar.failedTests > 0 ? "fail" : "pass";
      sysLabel = `${systemPillar.passedTests}/${systemPillar.totalTests} journeys`;
    }

    const failedEpObj =
      grp.endpoints.find((e) => ["Failed", "Script Error", "Partial"].includes(e.status)) || firstEp;
    const failedEpScenario = failedEpObj?.scenarios?.find((sc) => sc.status && sc.status.toLowerCase() !== "passed") || null;

    const rootCause = diagnoseModuleRootCause(unitStatus, intStatus, sysStatus, {
      unitFile: firstUnitFile?.filePath,
      unitFailedScenariosCount: uScenariosFailed,
      endpoint: failedEpObj ? `${failedEpObj.method || "GET"} ${failedEpObj.path}` : null,
      failureLayer: failedEpScenario?.failureLayer || (failedEp > 0 ? "CONTROLLER_CRASH" : null),
      flowName: firstSys?.title,
      failureKind: firstSys?.failureCategory,
      uncoveredEpCount: uncoveredEp,
      totalEpCount: totalEp,
      totalProjectApis: endpoints.length,
    });

    const items = [
      ...grp.unitFiles.slice(0, 3).map((f) => ({
        type: "unit",
        name: `${f.filePath.split(/[/\\]/).pop()} (${toFixedNum(f.branchesPct)}% branch)`,
        path: f.filePath,
        status: unitStatus,
      })),
      ...grp.endpoints.slice(0, 4).map((e) => ({
        type: "integration",
        name: `${e.method || "GET"} ${e.path} (${e.status || "Uncovered"})`,
        endpoint: `${e.method || "GET"} ${e.path}`,
        status:
          e.status === "Covered"
            ? "pass"
            : e.status === "Failed" || e.status === "Script Error"
            ? "fail"
            : e.status === "Partial"
            ? "warn"
            : "untested",
      })),
      ...grp.systemScenarios.slice(0, 3).map((s) => ({
        type: "system",
        name: s.title,
        scenarioId: s.id,
        status: s.status === "passed" ? "pass" : s.status === "failed" ? "fail" : "warn",
      })),
    ];

    rows.push({
      id: `mod-${grp.key}`,
      moduleName: grp.moduleName,
      description:
        totalEp > 0
          ? `${totalEp} endpoint(s): ${grp.endpoints
              .slice(0, 2)
              .map((e) => `${e.method || "GET"} ${e.path}`)
              .join(", ")}`
          : firstUnitFile
          ? `Source file: ${firstUnitFile.filePath}`
          : `${sTotal} E2E scenario(s)`,
      unit: {
        status: unitStatus,
        label: unitLabel,
        passed: uScenariosPassed,
        failed: uScenariosFailed,
        total: uScenariosTotal,
        coverageOnly: isCoverageOnlyUnit,
        fileCount: grp.unitFiles.length,
        avgLinesPct: avgUnitLines,
        avgBranchesPct: avgUnitBranch,
        passRate: uPassRate,
        path: firstUnitFile?.filePath || null,
      },
      integration: {
        status: intStatus,
        label: intLabel,
        passed: coveredEp,
        failed: failedEp,
        partial: partialEp,
        total: totalEp,
        uncovered: uncoveredEp,
        endpoint: failedEpObj ? `${failedEpObj.method || "GET"} ${failedEpObj.path}` : null,
      },
      system: {
        status: sysStatus,
        label: sysLabel,
        passed: sPassed,
        failed: sFailed,
        total: sTotal,
        scenarioId: firstSys?.id || null,
      },
      rootCause,
      layerDetails: {
        unit: {
          file: firstUnitFile?.filePath || "N/A",
          branchCoveragePct: avgUnitBranch,
          failingFunctions: grp.unitScenarios
            .filter((s) => s.status === "failed")
            .map((s) => s.title)
            .slice(0, 3),
          summaryText:
            uScenariosTotal > 0
              ? `${uScenariosPassed}/${uScenariosTotal} unit tests passed (${avgUnitBranch}% branch)`
              : grp.unitFiles.length > 0
              ? `Branch coverage: ${avgUnitBranch}% across ${grp.unitFiles.length} file(s)`
              : "No unit files mapped",
        },
        integration: {
          method: failedEpObj?.method || "GET",
          endpoint: failedEpObj?.path || `/api/${grp.key}`,
          httpStatus: failedEpScenario?.statusCode || (coveredEp > 0 ? 200 : null),
          failureLayer:
            failedEpScenario?.failureLayer ||
            (failedEp > 0 ? "controller" : uncoveredEp > 0 ? "uncovered" : "none"),
          summaryText:
            totalEp > 0
              ? `${coveredEp}/${totalEp} endpoint(s) covered${failedEp > 0 ? `, ${failedEp} failed` : ""}${partialEp > 0 ? `, ${partialEp} partial` : ""}`
              : "No API endpoints in this module",
        },
        system: {
          flowName: firstSys?.title || `${grp.moduleName} User Flow`,
          failedStep: firstSys?.failureStep || (sTotal > 0 ? "Executed" : "No E2E journey executed"),
          failureKind: firstSys?.failureCategory || (sFailed > 0 ? "assertion" : sTotal > 0 ? "none" : "untested"),
          scenarioId: firstSys?.id || null,
        },
      },
      items,
    });
  }

  const rowPriority = (r) => {
    const statuses = [r.unit?.status, r.integration?.status, r.system?.status];
    const hasFail = statuses.includes("fail");
    const hasWarn = statuses.includes("warn");
    const layersPresent =
      (r.unit.total > 0 || (r.unit.fileCount || 0) > 0 ? 1 : 0) +
      (r.integration.total > 0 ? 1 : 0) +
      (r.system.total > 0 ? 1 : 0);
    const activity = (r.unit.total || 0) + (r.integration.total || 0) + (r.system.total || 0);
    return {
      riskTier: hasFail ? 2 : hasWarn ? 1 : 0,
      layersPresent,
      activity,
      fileCount: r.unit.fileCount || 0,
    };
  };

  rows.sort((a, b) => {
    const pa = rowPriority(a);
    const pb = rowPriority(b);
    if (pb.riskTier !== pa.riskTier) return pb.riskTier - pa.riskTier;
    if (pb.layersPresent !== pa.layersPresent) return pb.layersPresent - pa.layersPresent;
    if (pb.activity !== pa.activity) return pb.activity - pa.activity;
    if (pb.fileCount !== pa.fileCount) return pb.fileCount - pa.fileCount;
    return String(a.moduleName || "").localeCompare(String(b.moduleName || ""));
  });

  return rows.slice(0, 12);
}

/**
 * Compute Unified Quality Dashboard payload for a given snapshotId.
 */
export async function buildUnifiedQualityDashboard({ snapshotId, userId, bypassCache = false }) {
  if (!snapshotId) {
    const err = new Error("snapshotId is required.");
    err.statusCode = 400;
    throw err;
  }
  const flightKey = `${snapshotId}:${userId || "anon"}`;
  if (!bypassCache && inFlightUnifiedBuilds.has(flightKey)) {
    return inFlightUnifiedBuilds.get(flightKey);
  }

  const buildPromise = (async () => {
    try {
      return await executeBuildUnifiedQualityDashboard({ snapshotId, userId, bypassCache });
    } finally {
      inFlightUnifiedBuilds.delete(flightKey);
    }
  })();

  if (!bypassCache) {
    inFlightUnifiedBuilds.set(flightKey, buildPromise);
  }
  return buildPromise;
}

function isExcludedCoverageFilePath(filePath = "") {
  if (!filePath) return true;
  const p = String(filePath);
  return (
    p.includes("coverage/") ||
    p.includes("coverage\\") ||
    p.includes("node_modules/") ||
    p.includes("node_modules\\") ||
    p.includes(".git/") ||
    p.includes(".test.") ||
    p.includes(".spec.") ||
    p.includes("/e2e/") ||
    p.includes("/cypress/") ||
    p.includes("/playwright/")
  );
}

/**
 * Return true when a TestRun should be excluded from causal metrics/trend
 * (explicitly canceled runs or zero-execution/empty runs).
 */
export function isExcludedCausalRun(run) {
  if (!run) return true;
  const status = String(run.status || "").toUpperCase();
  if (status === "CANCELED" || status === "CANCELLED") return true;
  const rPassed = Number(run.passedTests ?? 0);
  const rFailed = Number(run.failedTests ?? 0);
  const rTotal = Number(run.totalTests ?? 0);
  if (rPassed === 0 && rFailed === 0 && rTotal === 0) return true;
  return false;
}

/**
 * Build a strictly causal chronological trend series (oldest -> newest) without
 * look-ahead leakage from future runs or current snapshot totals.
 */
export function buildCausalTrendSeries({
  combinedHistoricalRuns = [],
  snapshotId = "",
  snapshotCreatedAt = null,
  latestUnitRunId = null,
  latestIntRunId = null,
  latestSysRunId = null,
  unitLinesPct = 0,
  epCovPct = 0,
  sysFlowCoveragePct = 0,
  unitPassRate = 0,
  intPassRate = 0,
  sysPassRate = 0,
  unitPassed = 0,
  unitFailed = 0,
  intPassed = 0,
  intFailed = 0,
  sysPassed = 0,
  sysFailed = 0,
} = {}) {
  const activeSnapTs = snapshotCreatedAt ? new Date(snapshotCreatedAt).getTime() : Number.NaN;
  const chronologicalRuns = [...combinedHistoricalRuns]
    .reverse()
    .filter((run) => {
      if (isExcludedCausalRun(run)) return false;
      if (
        snapshotId &&
        run.snapshotId !== snapshotId &&
        Number.isFinite(activeSnapTs) &&
        run.snapshot?.createdAt
      ) {
        const runSnapTs = new Date(run.snapshot.createdAt).getTime();
        if (Number.isFinite(runSnapTs) && runSnapTs > activeSnapTs) {
          return false;
        }
      }
      return true;
    });
  const trendSeries = [];
  let rollingUnitCov = 0;
  let rollingIntCov = 0;
  let rollingSysCov = 0;
  let rollingUnitPass = 0;
  let rollingIntPass = 0;
  let rollingSysPass = 0;
  let rollingUnitPassed = 0;
  let rollingUnitFailed = 0;
  let rollingIntPassed = 0;
  let rollingIntFailed = 0;
  let rollingSysPassed = 0;
  let rollingSysFailed = 0;

  const applyRunToRolling = (run) => {
    const tType = String(run.type || "").toUpperCase();
    const rPassed = Number(run.passedTests ?? 0);
    const rFailed = Number(run.failedTests ?? 0);
    const rTotal = Number(run.totalTests ?? 0);
    const rPassRate = getPassRate(rPassed, rFailed) ?? 0;

    if (tType === "JEST" || tType === "VITEST") {
      if (run.coverageLinesPct != null) {
        rollingUnitCov = toFixedNum(run.coverageLinesPct);
      } else if (run.id === latestUnitRunId) {
        rollingUnitCov = toFixedNum(unitLinesPct);
      }
      rollingUnitPassed = rPassed;
      rollingUnitFailed = rFailed;
      rollingUnitPass = rPassRate;
    } else if (tType === "SUPERTEST" || tType === "PLAYWRIGHT_API") {
      // Integration trend tracks API endpoint coverage strictly: use epCovPct only on
      // latestIntRunId, or explicit run.endpointCoveragePct if persisted; never leak
      // epCovPct backward and never mix Istanbul code coverageLinesPct into endpoint %.
      if (run.id === latestIntRunId) {
        rollingIntCov = toFixedNum(epCovPct);
      } else if (run.endpointCoveragePct != null) {
        rollingIntCov = toFixedNum(run.endpointCoveragePct);
      }
      rollingIntPassed = rPassed;
      rollingIntFailed = rFailed;
      rollingIntPass = rPassRate;
    } else if (tType === "PLAYWRIGHT" || tType === "CYPRESS") {
      if (run.id === latestSysRunId) {
        rollingSysCov =
          sysFlowCoveragePct !== null && sysFlowCoveragePct !== undefined
            ? toFixedNum(sysFlowCoveragePct)
            : null;
      } else {
        let histSysCov = null;
        if (rTotal > 0 && run.systemMeasurement) {
          try {
            const sysCovSummary = coverageSummaryFor(run.systemMeasurement);
            const feLinesPct =
              sysCovSummary?.frontend?.counters?.lines?.pct ??
              sysCovSummary?.tiers?.frontend?.counters?.lines?.pct ??
              sysCovSummary?.linesPct;
            if (feLinesPct !== undefined && feLinesPct !== null) {
              histSysCov = toFixedNum(feLinesPct);
            }
          } catch (err) {
            console.warn(
              "[UnifiedQualityDashboard] Failed to parse historical systemMeasurement:",
              err?.message
            );
          }
        }
        if (histSysCov !== null) {
          rollingSysCov = histSysCov;
        }
      }
      rollingSysPassed = rPassed;
      rollingSysFailed = rFailed;
      rollingSysPass = rPassRate;
    }

    const combinedPassed = rollingUnitPassed + rollingIntPassed + rollingSysPassed;
    const combinedFailed = rollingUnitFailed + rollingIntFailed + rollingSysFailed;
    const combinedPassRate = getPassRate(combinedPassed, combinedFailed) ?? rPassRate;
    const overallCov = toFixedNum(
      rollingUnitCov * 0.5 + rollingIntCov * 0.3 + (rollingSysCov ?? 0) * 0.2
    );
    return { overallCov, combinedPassRate };
  };

  if (chronologicalRuns.length > 0) {
    const windowStart = Math.max(0, chronologicalRuns.length - 8);
    for (let i = 0; i < windowStart; i += 1) {
      applyRunToRolling(chronologicalRuns[i]);
    }

    const sampledRuns = chronologicalRuns.slice(windowStart);
    sampledRuns.forEach((run, idx) => {
      const { overallCov, combinedPassRate } = applyRunToRolling(run);
      const isLast = idx === sampledRuns.length - 1;
      const rawCommit = run.snapshot?.commitSha;
      const sanitizedCommit =
        rawCommit && !String(rawCommit).startsWith("appliedTx:") ? rawCommit : null;
      const shaShort = (sanitizedCommit || run.snapshotId || "").slice(0, 6);

      trendSeries.push({
        runLabel: isLast ? `#${idx + 1} (Current)` : `#${idx + 1} (${shaShort})`,
        timestamp: new Date(run.createdAt).getTime(),
        unitCoverage: rollingUnitCov,
        integrationCoverage: rollingIntCov,
        systemCoverage: rollingSysCov,
        overallCoverage: overallCov,
        passRate: combinedPassRate,
        unitPassRate: rollingUnitPass,
        integrationPassRate: rollingIntPass,
        systemPassRate: rollingSysPass,
      });
    });
  } else if (unitLinesPct > 0 || epCovPct > 0 || (sysFlowCoveragePct ?? 0) > 0) {
    const overallCov = toFixedNum(
      unitLinesPct * 0.5 + epCovPct * 0.3 + (sysFlowCoveragePct ?? 0) * 0.2
    );
    trendSeries.push({
      runLabel: "#1 (Current)",
      timestamp: Date.now(),
      unitCoverage: unitLinesPct,
      integrationCoverage: epCovPct,
      systemCoverage: sysFlowCoveragePct,
      overallCoverage: overallCov,
      passRate: getPassRate(unitPassed + intPassed + sysPassed, unitFailed + intFailed + sysFailed) ?? 0,
      unitPassRate: unitPassRate,
      integrationPassRate: intPassRate,
      systemPassRate: sysPassRate,
    });
  }

  return trendSeries;
}

/**
 * Aggregate Integration Pillar metrics from integrationWorkspace payload.
 * Never falls back coveredApis to passed test scenario count and includes
 * "Partial" and "Script Error" alongside "Failed" for endpoint issue tracking.
 */
export function aggregateIntegrationLayer({ integrationWs }) {
  const wsSummary = integrationWs?.summary || {};
  const endpoints = Array.isArray(integrationWs?.endpoints) ? integrationWs.endpoints : [];
  const coveredEpCount = endpoints.filter((e) => e.status === "Covered").length;
  const partialEpCount = endpoints.filter((e) => e.status === "Partial").length;
  const errorEpCount = endpoints.filter(
    (e) => e.status === "Failed" || e.status === "Script Error"
  ).length;
  const issueEpCount = errorEpCount + partialEpCount;

  const intPassed = Number(wsSummary.passedTests ?? wsSummary.testedApis ?? coveredEpCount ?? 0);
  const intFailed = Number(wsSummary.failedTests ?? errorEpCount ?? 0);
  const intSkipped = Number(wsSummary.skippedTests ?? 0);
  const intTotalExecuted = Number(
    wsSummary.totalTests ?? wsSummary.executedApis ?? intPassed + intFailed + intSkipped
  );
  const totalApis = Number(
    wsSummary.totalApis ?? wsSummary.discoveredApis ?? (endpoints.length || intTotalExecuted)
  );
  const coveredApis =
    intTotalExecuted > 0 && totalApis > 0
      ? Math.min(
          totalApis,
          Number(wsSummary.endpointCoverageMetrics?.coveredEndpoints ?? coveredEpCount)
        )
      : 0;
  const partialApis = Math.min(
    Math.max(0, totalApis - coveredApis),
    Number(wsSummary.endpointCoverageMetrics?.partialEndpoints ?? partialEpCount)
  );
  const failedApis = Math.min(Math.max(0, totalApis - coveredApis), issueEpCount);
  const uncoveredApis = Math.max(0, totalApis - coveredApis);
  const intDurationMs = Number(wsSummary.durationMs ?? 0);
  const intAvgLatencyMs = Number(
    wsSummary.avgEndpointLatencyMs ?? wsSummary.avgRequestLatencyMs ?? 0
  );
  const intPassRate = getPassRate(intPassed, intFailed) ?? 0;

  const intHasRuns = intTotalExecuted > 0;
  const epCovPct =
    !intHasRuns || totalApis <= 0
      ? 0
      : wsSummary.endpointCoverageMetrics?.endpointCoveragePct != null
      ? toFixedNum(wsSummary.endpointCoverageMetrics.endpointCoveragePct)
      : toFixedNum((coveredApis / totalApis) * 100);

  const intCodeCov = wsSummary.codeCoverage || {};
  const rawIntLineCov = intCodeCov.line?.pct ?? intCodeCov.line ?? intCodeCov.lines;
  const intCodeCoverageMeasured =
    intHasRuns &&
    rawIntLineCov !== null &&
    rawIntLineCov !== undefined &&
    rawIntLineCov !== "" &&
    Number.isFinite(Number(rawIntLineCov));
  const intCoverageMetrics = {
    lines: intHasRuns ? toFixedNum(intCodeCov.line?.pct ?? intCodeCov.line ?? 0) : 0,
    branches: intHasRuns ? toFixedNum(intCodeCov.branch?.pct ?? intCodeCov.branch ?? 0) : 0,
    functions: intHasRuns ? toFixedNum(intCodeCov.function?.pct ?? intCodeCov.function ?? 0) : 0,
    statements: intHasRuns ? toFixedNum(intCodeCov.statement?.pct ?? intCodeCov.statement ?? 0) : 0,
    apiEndpoint: epCovPct,
    coveragePct: epCovPct,
    coveredApis,
    partialApis,
    failedApis,
    uncoveredApis,
    totalApis,
  };

  let routeFails = 0;
  let middlewareFails = 0;
  let controllerFails = 0;
  let databaseFails = 0;
  const intFailedScenarios = [];

  if (intFailed > 0) {
    for (const ep of endpoints) {
      if (Array.isArray(ep.scenarios)) {
        for (const sc of ep.scenarios) {
          const st = String(sc.status || "").toLowerCase();
          if (st === "failed" || st === "error" || st === "script error") {
            const fl = String(sc.failureLayer || "").toUpperCase();
            if (fl === "ROUTER_NOT_FOUND") routeFails++;
            else if (fl === "MIDDLEWARE_REJECTED") middlewareFails++;
            else if (fl === "DATABASE_FAILURE") databaseFails++;
            else controllerFails++;

            if (intFailedScenarios.length < 5) {
              intFailedScenarios.push({
                id: sc.id || `${ep.method}-${ep.path}`,
                name: sc.title || `${ep.method || "GET"} ${ep.path}`,
                endpoint: `${ep.method || "GET"} ${ep.path}`,
                filePath: ep.file || "API Route",
                httpStatus: sc.statusCode || 500,
                failureLayer:
                  fl === "ROUTER_NOT_FOUND"
                    ? "route"
                    : fl === "MIDDLEWARE_REJECTED"
                    ? "middlewareAuth"
                    : fl === "DATABASE_FAILURE"
                    ? "database"
                    : "controller",
                durationMs: sc.durationMs || 0,
                errorMessage: cleanStorageText(sc.errorMessage || sc.failureReason || "API test failed"),
              });
            }
          }
        }
      }
    }
    if (routeFails + middlewareFails + controllerFails + databaseFails === 0) {
      const qc = wsSummary.qualityClassification || {};
      routeFails = Number(qc.invalidTests ?? 0);
      middlewareFails = Number(qc.testScriptErrors ?? 0);
      databaseFails = Number(qc.infrastructureFailures ?? 0);
      controllerFails = Number(
        qc.assertionFailures ?? Math.max(0, intFailed - routeFails - middlewareFails - databaseFails)
      );
    }
  }

  const intLowCoverageItems = endpoints
    .filter((e) => e.status !== "Covered")
    .slice(0, 5)
    .map((e) => ({
      filePath: e.path,
      name: `${e.method || "GET"} ${e.path}`,
      branchesPct: toFixedNum(e.mappedCodeCoverage?.branch),
      linesPct: toFixedNum(e.mappedCodeCoverage?.line),
      line: 1,
    }));

  const integrationPillar = {
    id: "integration",
    label: "Integration Test",
    framework: integrationWs?.snapshot?.framework || "Supertest",
    totalTests: intTotalExecuted,
    passedTests: intPassed,
    failedTests: intFailed,
    skippedTests: intSkipped,
    flakyTests: 0,
    passRate: intPassRate,
    durationMs: intDurationMs,
    avgDurationMs: intAvgLatencyMs,
    avgEndpointLatencyMs: intAvgLatencyMs,
    codeCoverageMeasured: intCodeCoverageMeasured,
    coverageMetrics: intCoverageMetrics,
    lowCoverageItems: intLowCoverageItems,
    failedScenarios: intFailedScenarios,
    failureDistribution: {
      route: routeFails,
      middlewareAuth: middlewareFails,
      controller: controllerFails,
      database: databaseFails,
    },
    errorMessage: null,
  };

  return {
    integrationPillar,
    endpoints,
    epCovPct,
    totalApis,
    uncoveredApis,
    intTotalExecuted,
    intHasRuns,
    intPassed,
    intFailed,
    intPassRate,
  };
}

/**
 * Aggregate System (E2E) Pillar metrics.
 * Returns flowCoveragePct: null and coverageAvailable: false when no real systemMeasurement exists.
 */
export function aggregateSystemLayer({ latestSystemRun, detectedFrameworks }) {
  const sysPassed = Number(latestSystemRun?.passedTests ?? 0);
  const sysFailed = Number(latestSystemRun?.failedTests ?? 0);
  const sysFlaky = Number(latestSystemRun?.flakyTests ?? 0);
  const sysSkipped = Number(latestSystemRun?.skippedTests ?? 0);
  const sysTotal = Number(
    latestSystemRun?.totalTests ?? sysPassed + sysFailed + sysFlaky + sysSkipped
  );
  const sysDurationMs = Number(latestSystemRun?.durationMs ?? 0);
  const sysPassRate = getPassRate(sysPassed, sysFailed) ?? 0;

  let sysFlowCoveragePct = null;
  let sysCoverageAvailable = false;
  if (sysTotal > 0 && latestSystemRun?.systemMeasurement) {
    try {
      const sysCovSummary = coverageSummaryFor(latestSystemRun.systemMeasurement);
      const feLinesPct =
        sysCovSummary?.frontend?.counters?.lines?.pct ??
        sysCovSummary?.tiers?.frontend?.counters?.lines?.pct ??
        sysCovSummary?.linesPct;
      if (feLinesPct !== undefined && feLinesPct !== null && Number.isFinite(Number(feLinesPct))) {
        sysFlowCoveragePct = toFixedNum(feLinesPct);
        sysCoverageAvailable = true;
      }
    } catch (err) {
      console.warn(
        "[UnifiedQualityDashboard] Failed to parse latest systemMeasurement:",
        err?.message
      );
    }
  }

  let selectorNotFoundCount = 0;
  let networkTimeoutCount = 0;
  let assertionFailCount = 0;
  const sysScenarios = [];
  const sysFailedScenarios = [];

  for (const sc of latestSystemRun?.scenarios || []) {
    const st = String(sc.status || "").toLowerCase();
    const cleanFile = sc.testFile ? cleanStoragePath(sc.testFile) : "";
    const cleanMsgs = (sc.failureMessages || []).map((m) => cleanStorageText(m));
    sysScenarios.push({
      id: sc.id,
      title: sc.title,
      suiteName: sc.suiteName,
      file: cleanFile,
      durationMs: sc.durationMs || 0,
      status: st,
      failureStep: sc.failureStep || null,
      failureCategory: sc.failureCategory || null,
      failureMessages: cleanMsgs,
    });

    if (st === "failed") {
      const cat = String(sc.failureCategory || "").toUpperCase();
      const msgLower = cleanMsgs.join(" ").toLowerCase();
      let mappedCat = "assertion";
      if (
        cat === "ELEMENT_NOT_FOUND" ||
        msgLower.includes("selector") ||
        msgLower.includes("locator") ||
        msgLower.includes("waiting for element")
      ) {
        selectorNotFoundCount++;
        mappedCat = "selectorNotFound";
      } else if (
        ["TIMEOUT", "SERVER_ERROR", "NAVIGATION_ERROR"].includes(cat) ||
        msgLower.includes("timeout") ||
        msgLower.includes("timed out")
      ) {
        networkTimeoutCount++;
        mappedCat = "networkTimeout";
      } else {
        assertionFailCount++;
        mappedCat = "assertion";
      }

      if (sysFailedScenarios.length < 5) {
        sysFailedScenarios.push({
          id: sc.id,
          name: sc.title,
          filePath: cleanFile || "E2E Spec",
          failedStep: sc.failureStep || "E2E Journey Step",
          failureCategory: mappedCat,
          durationMs: sc.durationMs || 0,
          errorMessage: cleanMsgs[0] || "E2E journey test failed",
        });
      }
    }
  }

  const sysRunnerName =
    latestSystemRun?.type === "CYPRESS"
      ? "Cypress"
      : detectedFrameworks?.supported?.system?.includes("cypress") &&
        !detectedFrameworks?.supported?.system?.includes("playwright")
      ? "Cypress"
      : "Playwright";

  const avgTestDur = sysTotal > 0 ? Math.round(sysDurationMs / sysTotal) : 0;

  const systemPillar = {
    id: "system",
    label: "System Test (E2E)",
    framework: sysRunnerName,
    totalTests: sysTotal,
    passedTests: sysPassed,
    failedTests: sysFailed,
    skippedTests: sysSkipped,
    flakyTests: sysFlaky,
    passRate: sysPassRate,
    durationMs: sysDurationMs,
    avgTestDurationMs: avgTestDur,
    avgDurationMs: avgTestDur,
    flowCoveragePct: sysFlowCoveragePct,
    coverageAvailable: sysCoverageAvailable,
    coverageMetrics: {
      lines: sysFlowCoveragePct,
      flow: sysFlowCoveragePct,
    },
    lowCoverageItems: [],
    failedScenarios: sysFailedScenarios,
    failureDistribution: {
      selectorNotFound: sysFailed > 0 ? selectorNotFoundCount : 0,
      networkTimeout: sysFailed > 0 ? networkTimeoutCount : 0,
      assertion:
        sysFailed > 0
          ? selectorNotFoundCount + networkTimeoutCount + assertionFailCount > 0
            ? assertionFailCount
            : sysFailed
          : 0,
      flaky: sysFlaky,
    },
    errorMessage: null,
  };

  return {
    systemPillar,
    sysFlowCoveragePct,
    sysCoverageAvailable,
    sysPassed,
    sysFailed,
    sysTotal,
    sysPassRate,
    sysScenarios,
  };
}

async function executeBuildUnifiedQualityDashboard({ snapshotId, userId, bypassCache = false }) {
  const start = Date.now();

  // Ultra-fast warm cache hit (< 2ms, 0 DB queries) within DASHBOARD_FAST_TTL_MS when not explicitly invalidated
  if (!bypassCache) {
    const fastCached = dashboardPayloadCache.get(snapshotId);
    if (
      fastCached &&
      fastCached.allowedUsers?.has(userId) &&
      Date.now() - fastCached.lastVerifiedAt < DASHBOARD_FAST_TTL_MS
    ) {
      const totalTime = Date.now() - start;
      console.log(
        `[PERF: Unified Dashboard] snapshotId=${snapshotId} Total=${totalTime}ms | cacheHit=fast`
      );
      return fastCached.data;
    }
  }

  let currentFingerprint = null;
  // Fingerprint-verified cache hit (< 300ms) with 10-minute TTL (1 single DB query)
  if (!bypassCache) {
    const cachedEntry = dashboardPayloadCache.get(snapshotId);
    if (cachedEntry && Date.now() - cachedEntry.cachedAt < DASHBOARD_CACHE_TTL_MS) {
      currentFingerprint = await getDashboardFingerprint(snapshotId);
      if (currentFingerprint && cachedEntry.fingerprint === currentFingerprint) {
        if (!userId || !cachedEntry.allowedUsers?.has(userId)) {
          await resolveProjectAccess({
            projectId: cachedEntry.data?.context?.projectId,
            userId,
            capability: "project.read",
          });
          cachedEntry.allowedUsers?.add(userId);
        }
        cachedEntry.lastVerifiedAt = Date.now();
        const totalTime = Date.now() - start;
        console.log(
          `[PERF: Unified Dashboard] snapshotId=${snapshotId} Total=${totalTime}ms | cacheHit=true`
        );
        return cachedEntry.data;
      }
    }
  } else {
    clearUnifiedDashboardCache(snapshotId);
  }

  // Single-Wave Parallel Fetch at t=0ms (flat top-level queries avoid Prisma's sequential 1-to-many relation waterfall)
  const startParallelFetch = Date.now();
  const [
    snapshot,
    rawCoverageFiles,
    snapshotJobs,
    projectSnapshots,
    aiTestsList,
    historicalTestRuns,
    snapshotSpecificRuns,
    projectTerminalJobs,
    aiEvaluationRuns,
    aiDesignAudit,
  ] = await Promise.all([
    prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        storagePath: true,
        rootDir: true,
        source: true,
        commitSha: true,
        createdAt: true,
        coverageSummaries: true,
        _count: {
          select: {
            systemScenarios: { where: { source: "AI" } },
            systemProposals: { where: { state: "APPLIED" } },
          },
        },
        project: {
          select: {
            id: true,
            ownerId: true,
            name: true,
            defaultBranch: true,
            lifecycleStatus: true,
            lifecycleUpdatedAt: true,
            updatedAt: true,
            activeSnapshotId: true,
            _count: {
              select: {
                aiSuggestions: true,
              },
            },
          },
        },
      },
    }),
    prisma.coverageFile.findMany({
      where: { snapshotId },
      orderBy: [{ branchesPct: "asc" }, { linesPct: "asc" }],
    }),
    prisma.job.findMany({
      where: { snapshotId },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        resultJson: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true,
      },
    }),
    prisma.projectSnapshot.findMany({
      where: { project: { snapshots: { some: { id: snapshotId } } } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        versionNumber: true,
        label: true,
        contentHash: true,
        commitSha: true,
        source: true,
        createdAt: true,
      },
    }),
    prisma.aiTest.findMany({
      where: { project: { snapshots: { some: { id: snapshotId } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.testRun.findMany({
      where: {
        snapshot: { project: { snapshots: { some: { id: snapshotId } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        snapshot: {
          select: { id: true, commitSha: true, createdAt: true },
        },
        scenarios: {
          omit: { executionDetails: true },
        },
      },
    }),
    prisma.testRun.findMany({
      where: { snapshotId },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        snapshot: {
          select: { id: true, commitSha: true, createdAt: true },
        },
        scenarios: {
          omit: { executionDetails: true },
        },
      },
    }),
    prisma.job.findMany({
      where: {
        project: { snapshots: { some: { id: snapshotId } } },
        status: { in: ["SUCCESS", "FAILED"] },
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        type: true,
        status: true,
        payloadJson: true,
        startedAt: true,
        finishedAt: true,
        computeTimeMs: true,
        createdAt: true,
      },
    }),
    prisma.aiEvaluationRun.findMany({
      where: { project: { snapshots: { some: { id: snapshotId } } } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        projectId: true,
        snapshotId: true,
        jobId: true,
        executionStatus: true,
        verdict: true,
        summary: true,
        errorCode: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        targetVersion: {
          select: {
            version: true,
            target: { select: { name: true } },
          },
        },
        profileVersion: {
          select: {
            version: true,
            definition: true,
            profile: { select: { name: true } },
          },
        },
      },
    }),
    prisma.aiEvaluationDesignAudit.findFirst({
      where: { snapshotId },
      select: {
        id: true,
        detected: true,
        designScore: true,
        summaryJson: true,
        findingsJson: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!snapshot) {
    const err = new Error("Snapshot not found.");
    err.statusCode = 404;
    throw err;
  }

  const startAccess = Date.now();
  // Owner already has full project.read capability; only query projectMember when non-owner
  if (!userId || snapshot.project?.ownerId !== userId) {
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });
  }
  const accessTime = Date.now() - startAccess;

  const resolvedRootDir = resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;

  // Detect Frameworks (Cached by snapshot.id)
  let detectedFrameworks = { supported: { unit: ["jest"], integration: ["supertest"], system: ["playwright"] } };
  if (frameworkCache.has(snapshot.id)) {
    detectedFrameworks = frameworkCache.get(snapshot.id);
  } else if (resolvedRootDir && fs.existsSync(resolvedRootDir)) {
    try {
      detectedFrameworks = detectCoverageFrameworks(resolvedRootDir);
      frameworkCache.set(snapshot.id, detectedFrameworks);
    } catch (_) {}
  }

  const unitSummaryRecord = snapshot.coverageSummaries || null;
  const activeSnapshotCreatedAtMs = snapshot.createdAt
    ? new Date(snapshot.createdAt).getTime()
    : Number.POSITIVE_INFINITY;
  const mergedRunsMap = new Map();
  for (const r of snapshotSpecificRuns || []) {
    mergedRunsMap.set(r.id, r);
  }
  for (const r of historicalTestRuns || []) {
    const runSnapCreatedAtMs = r.snapshot?.createdAt
      ? new Date(r.snapshot.createdAt).getTime()
      : Number.NaN;
    if (
      r.snapshotId !== snapshot.id &&
      Number.isFinite(activeSnapshotCreatedAtMs) &&
      Number.isFinite(runSnapCreatedAtMs) &&
      runSnapCreatedAtMs > activeSnapshotCreatedAtMs
    ) {
      continue;
    }
    if (!mergedRunsMap.has(r.id)) mergedRunsMap.set(r.id, r);
  }
  const combinedHistoricalRuns = Array.from(mergedRunsMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const snapshotRuns =
    snapshotSpecificRuns?.length > 0
      ? snapshotSpecificRuns
      : combinedHistoricalRuns.filter((r) => r.snapshotId === snapshot.id);
  const latestUnitRun =
    (snapshotRuns || []).find(
      (r) => ["JEST", "VITEST"].includes(r.type) && !isExcludedCausalRun(r)
    ) || null;
  const latestSystemRun =
    (snapshotRuns || []).find(
      (r) => ["PLAYWRIGHT", "CYPRESS"].includes(r.type) && !isExcludedCausalRun(r)
    ) || null;
  const snapshotIntegrationRuns = (snapshotRuns || []).filter(
    (r) => ["SUPERTEST", "PLAYWRIGHT_API"].includes(r.type) && !isExcludedCausalRun(r)
  );
  const snapshotAiTests = (aiTestsList || []).filter((t) => t.snapshotId === snapshot.id);
  const aiSuggestionsCount = snapshot.project?._count?.aiSuggestions ?? 0;
  const aiSystemScenariosCount = snapshot._count?.systemScenarios ?? 0;
  const aiSystemProposalsApplied = snapshot._count?.systemProposals ?? 0;
  const activeJob =
    (snapshotJobs || []).find(
      (j) =>
        ["RUN_TESTS", "INSTALL_DEPS", "SUPERTEST_COVERAGE", "SYSTEM_TEST_ANALYSIS"].includes(
          j.type
        ) && ["QUEUED", "RUNNING"].includes(j.status)
    ) || null;

  const integrationWs = await buildIntegrationWorkspace(snapshot.id, {
    skipAutoScan: true,
    preloadedData: {
      snapshot,
      coverageSummary: unitSummaryRecord,
      coverageFiles: rawCoverageFiles,
      aiTests: snapshotAiTests,
      testRuns: snapshotIntegrationRuns.slice(0, 1),
      jobs: snapshotJobs,
    },
  }).catch((intErr) => {
    console.warn("[UnifiedQualityDashboard] buildIntegrationWorkspace warning:", intErr?.message);
    return null;
  });
  const parallelFetchTime = Date.now() - startParallelFetch;

  // 1. Format snapshots for header
  const formattedSnapshots = projectSnapshots.map((s, idx) => {
    const vNum = s.versionNumber != null ? `#${s.versionNumber}` : `#${projectSnapshots.length - idx}`;
    let displayCommit = s.commitSha;
    if (displayCommit && displayCommit.startsWith("appliedTx:")) {
      displayCommit = null;
    }
    const shortRef = displayCommit ? displayCommit.slice(0, 7) : (s.contentHash ? s.contentHash.slice(0, 7) : s.id.slice(0, 7));
    const baseLabel = s.label || `${vNum} (${shortRef})`;
    const isActive = s.id === snapshot.id;
    return {
      id: s.id,
      versionNumber: s.versionNumber,
      contentHash: s.contentHash ? s.contentHash.slice(0, 12) : null,
      commitSha: displayCommit,
      branch: displayCommit ? `git:${displayCommit.slice(0, 7)}` : "local",
      createdAt: s.createdAt,
      label: isActive ? `${baseLabel} — Active` : baseLabel,
      rawLabel: baseLabel,
      isActive,
    };
  });
  const activeSnapshotEntry = formattedSnapshots.find((s) => s.id === snapshot.id) || null;
  const activeSnapshotLabel =
    activeSnapshotEntry?.rawLabel ||
    (snapshot.id ? snapshot.id.slice(0, 7) : "");

  // 3. Aggregate Unit Layer
  const startUnit = Date.now();
  const configExclusions = resolvedRootDir
    ? extractProjectCoverageExclusions(resolvedRootDir)
    : [];
  const thresholdExceptions = resolvedRootDir
    ? await extractThresholdExceptions(resolvedRootDir, snapshot.jestConfigPath || null)
    : new Set();

  const isAllowedUnitFile = (filePath) => {
    if (!filePath || isApiFilePath(filePath)) return false;
    const can = resolvedRootDir
      ? resolveProjectRelativePath(filePath, resolvedRootDir) || filePath
      : filePath;
    const norm = String(can).replace(/\\/g, "/").toLowerCase();
    if (
      thresholdExceptions.size > 0 &&
      Array.from(thresholdExceptions).some((exc) => norm === exc || norm.endsWith(exc))
    ) {
      return false;
    }
    return isBusinessLogicSourceFile(can, configExclusions);
  };

  const allCoverageFiles = (rawCoverageFiles || []).filter(
    (f) => !isExcludedCoverageFilePath(f.filePath)
  );
  let unitFiles = allCoverageFiles.filter((f) => isAllowedUnitFile(f.filePath));
  const unitFwRaw =
    detectedFrameworks?.supported?.unit?.[0] ||
    (latestUnitRun?.type === "VITEST" ? "Vitest" : "Jest");
  const unitFramework = String(unitFwRaw).charAt(0).toUpperCase() + String(unitFwRaw).slice(1);

  const unitPassed = Number(latestUnitRun?.passedTests ?? 0);
  const unitFailed = Number(latestUnitRun?.failedTests ?? 0);
  const unitSkipped = Number(latestUnitRun?.skippedTests ?? 0);
  const unitTotal = Number(latestUnitRun?.totalTests ?? unitPassed + unitFailed + unitSkipped);
  const unitDurationMs = Number(latestUnitRun?.durationMs ?? 0);
  const unitPassRate = getPassRate(unitPassed, unitFailed) ?? 0;

  const canonicalUnit = await resolveCanonicalUnitCoverage({
    snapshotId: snapshot.id,
    rootDir: resolvedRootDir,
    jestConfigPath: snapshot.jestConfigPath || null,
    unitSummaryRecord,
    latestUnitRun,
    unitFiles,
  });

  if (
    Array.isArray(canonicalUnit.files) &&
    canonicalUnit.files.length > 0 &&
    (canonicalUnit.coverageSource === "filtered-summary" ||
      canonicalUnit.coverageSource === "peak-report")
  ) {
    const dbByKey = new Map();
    for (const df of unitFiles) {
      dbByKey.set(getNormalizedMatchKey(df.filePath), df);
    }
    const mergedFiles = canonicalUnit.files
      .filter((f) => isAllowedUnitFile(f.filePath))
      .map((f) => {
        const dbMatch = dbByKey.get(getNormalizedMatchKey(f.filePath));
        return {
          ...f,
          linesTotal: f.linesTotal ?? dbMatch?.linesTotal ?? undefined,
          branchesTotal: f.branchesTotal ?? dbMatch?.branchesTotal ?? undefined,
        };
      });
    if (mergedFiles.length > 0) {
      unitFiles = mergedFiles;
    }
  }

  const unitCoverageMeasured =
    canonicalUnit.coverageSource !== "none" &&
    canonicalUnit.coverage?.lines !== null &&
    canonicalUnit.coverage?.lines !== undefined &&
    Number.isFinite(Number(canonicalUnit.coverage.lines));
  const hasUnitCoverage = unitTotal > 0 || canonicalUnit.coverageSource !== "none";
  const unitLinesPct = hasUnitCoverage && unitCoverageMeasured ? toFixedNum(canonicalUnit.coverage.lines) : 0;
  const unitBranchesPct =
    hasUnitCoverage && canonicalUnit.coverageSource !== "none"
      ? toFixedNum(canonicalUnit.coverage.branches)
      : 0;
  const unitFuncsPct =
    hasUnitCoverage && canonicalUnit.coverageSource !== "none"
      ? toFixedNum(canonicalUnit.coverage.functions)
      : 0;
  const unitStmtsPct =
    hasUnitCoverage && canonicalUnit.coverageSource !== "none"
      ? toFixedNum(canonicalUnit.coverage.statements)
      : 0;

  const lowBranchFiles = unitFiles.filter((f) => Number(f.branchesPct ?? 100) < 80);
  const filesToDisplay = lowBranchFiles.length > 0 ? lowBranchFiles : unitFiles;
  const unitLowCoverageItems = filesToDisplay.slice(0, 4).map((f) => ({
    filePath: cleanStoragePath(f.filePath) || f.filePath,
    name: (f.filePath || "").split(/[/\\]/).pop(),
    branchesPct: toFixedNum(f.branchesPct),
    linesPct: toFixedNum(f.linesPct),
    functionsPct: toFixedNum(f.funcsPct ?? f.functionsPct),
    isBottleneck: Number(f.branchesPct ?? 100) < 80,
    line: 1,
  }));

  const sortedUnitFilesForReport = [...unitFiles].sort(
    (a, b) =>
      Number(a.branchesPct ?? 0) - Number(b.branchesPct ?? 0) ||
      Number(a.linesPct ?? 0) - Number(b.linesPct ?? 0) ||
      Number(a.funcsPct ?? a.functionsPct ?? 0) - Number(b.funcsPct ?? b.functionsPct ?? 0)
  );
  const unitCoverageFiles = sortedUnitFilesForReport.map((f) => {
    const branchesPct = toFixedNum(f.branchesPct);
    const linesPct = toFixedNum(f.linesPct);
    const functionsPct = toFixedNum(f.funcsPct ?? f.functionsPct);
    const statementsPct = toFixedNum(f.stmtsPct ?? f.statementsPct);
    return {
      filePath: cleanStoragePath(f.filePath) || f.filePath,
      name: (f.filePath || "").split(/[/\\]/).pop(),
      branchesPct,
      linesPct,
      functionsPct,
      statementsPct,
      isBottleneck: branchesPct < 100 || linesPct < 100 || functionsPct < 100,
      line: 1,
    };
  });

  const unitScenarios = (latestUnitRun?.scenarios || []).map((s) => ({
    id: s.id,
    title: s.title,
    suiteName: s.suiteName,
    testFile: cleanStoragePath(s.testFile) || s.testFile || "",
    status: String(s.status || "").toLowerCase(),
    durationMs: s.durationMs || 0,
    failureMessages: (s.failureMessages || []).map((m) => cleanStorageText(m)),
    isFaultyExistingTest: Boolean(s.isFaultyExistingTest),
  }));

  const unitFailedScenarios = unitScenarios
    .filter((s) => s.status === "failed")
    .slice(0, 5)
    .map((s) => ({
      id: s.id,
      name: s.title,
      filePath: s.testFile,
      durationMs: s.durationMs,
      errorMessage: s.failureMessages[0] || "Unit assertion failed",
      isFaultyExistingTest: s.isFaultyExistingTest,
    }));

  const avgUnitTestDurationMs = unitTotal > 0 ? Math.round(unitDurationMs / unitTotal) : 0;

  const unitPillar = {
    id: "unit",
    label: "Unit Test",
    framework: unitFramework,
    totalTests: unitTotal,
    passedTests: unitPassed,
    failedTests: unitFailed,
    skippedTests: unitSkipped,
    flakyTests: 0,
    passRate: unitPassRate,
    durationMs: unitDurationMs,
    avgTestDurationMs: avgUnitTestDurationMs,
    avgDurationMs: avgUnitTestDurationMs,
    coverageSource: canonicalUnit.coverageSource,
    coverageMeasured: unitCoverageMeasured,
    coverageMetrics: {
      lines: unitLinesPct,
      branches: unitBranchesPct,
      functions: unitFuncsPct,
      statements: unitStmtsPct,
      linesCovered: canonicalUnit.rawTotals?.lines?.covered ?? null,
      linesTotal: canonicalUnit.rawTotals?.lines?.total ?? null,
      branchesCovered: canonicalUnit.rawTotals?.branches?.covered ?? null,
      branchesTotal: canonicalUnit.rawTotals?.branches?.total ?? null,
      functionsCovered: canonicalUnit.rawTotals?.functions?.covered ?? null,
      functionsTotal: canonicalUnit.rawTotals?.functions?.total ?? null,
      statementsCovered: canonicalUnit.rawTotals?.statements?.covered ?? null,
      statementsTotal: canonicalUnit.rawTotals?.statements?.total ?? null,
    },
    lowCoverageItems: unitLowCoverageItems,
    coverageFiles: unitCoverageFiles,
    failedScenarios: unitFailedScenarios,
    failureDistribution: {},
    errorMessage: null,
  };

  const unitTime = Date.now() - startUnit;

  // 4. Aggregate Integration Layer via buildIntegrationWorkspace
  const startIntegration = Date.now();
  const {
    integrationPillar,
    endpoints,
    epCovPct,
    totalApis,
    uncoveredApis,
    intTotalExecuted,
    intHasRuns,
    intPassed,
    intFailed,
    intPassRate,
  } = aggregateIntegrationLayer({ integrationWs });

  const integrationTime = Date.now() - startIntegration;

  // 5. Aggregate System (E2E) Layer
  const startSystem = Date.now();
  const {
    systemPillar,
    sysFlowCoveragePct,
    sysCoverageAvailable,
    sysPassed,
    sysFailed,
    sysTotal,
    sysPassRate,
    sysScenarios,
  } = aggregateSystemLayer({ latestSystemRun, detectedFrameworks });

  const systemTime = Date.now() - startSystem;

  // 6. Aggregate Real AI Telemetry
  const startAi = Date.now();
  let aiGeneratedCount = aiSystemScenariosCount;
  let aiRepairedCount = aiSystemProposalsApplied;

  for (const rec of aiTestsList) {
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

  const lowBranchUnitFilesCount = unitFiles.filter((f) => Number(f.branchesPct ?? 0) < 75).length;
  const totalCoverageGaps = uncoveredApis + lowBranchUnitFilesCount;

  // 7. Build Automated Cross-Layer Traceability Matrix
  const matrixRows = buildCrossLayerMatrix({
    unitFiles,
    unitScenarios,
    endpoints,
    systemScenarios: sysScenarios,
    unitPillar,
    systemPillar,
  });

  const aiTime = Date.now() - startAi;

  // 8. Build Historical Runs & Trends across Project TestRuns
  const startHistory = Date.now();
  const historyRuns = combinedHistoricalRuns.map((run) => {
    const tType = String(run.type || "").toUpperCase();
    const pillarType =
      tType === "PLAYWRIGHT" || tType === "CYPRESS"
        ? "system"
        : tType === "SUPERTEST" || tType === "PLAYWRIGHT_API"
        ? "integration"
        : "unit";

    const rTotal = Number(run.totalTests ?? 0);
    const rPassed = Number(run.passedTests ?? 0);
    const rFailed = Number(run.failedTests ?? 0);
    const rFlaky = Number(run.flakyTests ?? 0);
    const rawStatus = String(run.status || "").toUpperCase();
    const rStatus =
      rawStatus === "CANCELED" || rawStatus === "CANCELLED"
        ? "canceled"
        : rFailed > 0 || rawStatus === "FAILED"
        ? "fail"
        : rFlaky > 0
        ? "flaky"
        : "pass";

    let covPct = toFixedNum(run.coverageLinesPct ?? 0);
    if (pillarType === "unit") {
      if (covPct === 0 && run.id === latestUnitRun?.id) {
        covPct = toFixedNum(unitSummaryRecord?.linesPct ?? unitLinesPct ?? 0);
      }
    } else if (pillarType === "integration") {
      if (run.id === snapshotIntegrationRuns[0]?.id) {
        covPct =
          epCovPct > 0 || totalApis > 0
            ? epCovPct
            : toFixedNum(run.endpointCoveragePct ?? covPct);
      } else if (run.endpointCoveragePct != null) {
        covPct = toFixedNum(run.endpointCoveragePct);
      }
    } else if (pillarType === "system") {
      if (run.id === latestSystemRun?.id) {
        covPct =
          sysFlowCoveragePct !== null && sysFlowCoveragePct !== undefined
            ? toFixedNum(sysFlowCoveragePct)
            : null;
      } else if (covPct === 0) {
        let histSysCov = null;
        if (rTotal > 0 && run.systemMeasurement) {
          try {
            const sysCovSummary = coverageSummaryFor(run.systemMeasurement);
            const feLinesPct =
              sysCovSummary?.frontend?.counters?.lines?.pct ??
              sysCovSummary?.tiers?.frontend?.counters?.lines?.pct ??
              sysCovSummary?.linesPct;
            if (feLinesPct !== undefined && feLinesPct !== null) {
              histSysCov = toFixedNum(feLinesPct);
            }
          } catch (err) {
            console.warn(
              "[UnifiedQualityDashboard] Failed to parse history systemMeasurement:",
              err?.message
            );
          }
        }
        covPct = histSysCov !== null ? histSysCov : null;
      }
    }

    const firstFailedSc = (run.scenarios || []).find(
      (s) => String(s.status || "").toLowerCase() === "failed"
    );
    const failureLayerLabel =
      rStatus === "pass"
        ? "None — All Passed"
        : rStatus === "canceled"
        ? "Canceled"
        : firstFailedSc?.failureLayer ||
          firstFailedSc?.failureCategory ||
          (pillarType === "unit"
            ? "Unit Assertion Failure"
            : pillarType === "integration"
            ? "API Contract Failure"
            : "System E2E Failure");

    const stackMsg = firstFailedSc?.failureMessages?.[0]
      ? cleanStorageText(firstFailedSc.failureMessages[0])
      : `${tType} Run (${rPassed}/${rTotal} passed, Duration: ${run.durationMs || 0}ms)`;

    const rawRunCommit = run.snapshot?.commitSha;
    const cleanRunCommit =
      rawRunCommit && !String(rawRunCommit).startsWith("appliedTx:") ? rawRunCommit : null;

    return {
      id: run.id,
      runId: run.id,
      shortId: `#${run.id.slice(-6)}`,
      type: pillarType,
      runner: tType,
      status: rStatus,
      passed: rPassed,
      failed: rFailed,
      flaky: rFlaky,
      total: rTotal,
      coveragePct: covPct,
      durationMs: Number(run.durationMs ?? 0),
      startedAt: run.startedAt || run.createdAt,
      commitSha: cleanRunCommit || run.snapshotId.slice(0, 7),
      snapshotId: run.snapshotId,
      failureLayer: failureLayerLabel,
      stackTrace: stackMsg,
      testCases: (run.scenarios || []).map((s) => ({
        id: s.id,
        name: s.title,
        status:
          String(s.status || "").toLowerCase() === "passed"
            ? "pass"
            : String(s.status || "").toLowerCase() === "failed"
            ? "fail"
            : "flaky",
        durationMs: s.durationMs || 0,
        step: s.failureStep || s.failureLayer || s.failureCategory || s.suiteName || "Executed",
      })),
    };
  });

  // Build chronological trend series from historical runs (oldest -> newest)
  const trendSeries = buildCausalTrendSeries({
    combinedHistoricalRuns,
    snapshotId: snapshot.id,
    snapshotCreatedAt: snapshot.createdAt,
    latestUnitRunId: latestUnitRun?.id || null,
    latestIntRunId: snapshotIntegrationRuns[0]?.id || null,
    latestSysRunId: latestSystemRun?.id || null,
    unitLinesPct,
    epCovPct,
    sysFlowCoveragePct,
    unitPassRate,
    intPassRate,
    sysPassRate,
    unitPassed,
    unitFailed,
    intPassed,
    intFailed,
    sysPassed,
    sysFailed,
  });

  const firstPoint = trendSeries[0] || {
    unitCoverage: 0,
    integrationCoverage: 0,
    systemCoverage: 0,
    unitPassRate: 0,
    integrationPassRate: 0,
    systemPassRate: 0,
  };
  const lastPoint = trendSeries[trendSeries.length - 1] || {
    unitCoverage: unitLinesPct,
    integrationCoverage: epCovPct,
    systemCoverage: sysFlowCoveragePct,
    unitPassRate: unitPassRate,
    integrationPassRate: intPassRate,
    systemPassRate: sysPassRate,
  };

  const beforeAfter = {
    before: {
      unit: firstPoint.unitCoverage,
      integration: firstPoint.integrationCoverage,
      system: firstPoint.systemCoverage,
      unitPassRate: firstPoint.unitPassRate ?? 0,
      integrationPassRate: firstPoint.integrationPassRate ?? 0,
      systemPassRate: firstPoint.systemPassRate ?? 0,
    },
    after: {
      unit: lastPoint.unitCoverage,
      integration: lastPoint.integrationCoverage,
      system: lastPoint.systemCoverage,
      unitPassRate: lastPoint.unitPassRate ?? unitPassRate,
      integrationPassRate: lastPoint.integrationPassRate ?? intPassRate,
      systemPassRate: lastPoint.systemPassRate ?? sysPassRate,
    },
  };

  // Compute health delta between previous and latest trend points using the weighted 50/30/20 health formula
  let healthDelta = null;
  if (trendSeries.length >= 2) {
    const computeTrendPointHealth = (pt) => {
      const u = 0.5 * Number(pt?.unitPassRate || 0) + 0.5 * Number(pt?.unitCoverage || 0);
      const i =
        0.5 * Number(pt?.integrationPassRate || 0) + 0.5 * Number(pt?.integrationCoverage || 0);
      const s = 0.5 * Number(pt?.systemPassRate || 0) + 0.5 * Number(pt?.systemCoverage || 0);
      return u * 0.5 + i * 0.3 + s * 0.2;
    };
    const prevHealth = computeTrendPointHealth(trendSeries[trendSeries.length - 2]);
    const currHealth = computeTrendPointHealth(lastPoint);
    healthDelta = toFixedNum(currHealth - prevHealth);
  }

  const canonicalHealth = computeFixedWeightProjectHealth({
    unit: {
      totalTests: unitTotal,
      passedTests: unitPassed,
      failedTests: unitFailed,
      coveragePct: unitTotal > 0 && unitCoverageMeasured ? unitLinesPct : null,
    },
    integration: {
      totalTests: intTotalExecuted,
      passedTests: intPassed,
      failedTests: intFailed,
      coveragePct: intHasRuns && totalApis > 0 ? epCovPct : null,
    },
    system: {
      totalTests: sysTotal,
      passedTests: sysPassed,
      failedTests: sysFailed,
      coveragePct: sysCoverageAvailable ? sysFlowCoveragePct : null,
    },
  });

  const healthScore = canonicalHealth.healthScore;
  const healthGrade = canonicalHealth.grade;
  const effectiveLifecycleStatus = snapshot.project?.lifecycleStatus || "NOT_STARTED";
  const featureDurations = aggregateFeatureExecutionDurations(projectTerminalJobs);
  const aiEvaluation = buildAiEvaluationSummary({
    runs: aiEvaluationRuns,
    designAudit: aiDesignAudit,
  });

  const activeSuiteRun = activeJob
    ? {
        jobId: activeJob.id,
        type: activeJob.type,
        pillar:
          activeJob.type === "RUN_TESTS"
            ? "unit"
            : activeJob.type === "SUPERTEST_COVERAGE" || activeJob.type === "INSTALL_DEPS"
              ? "integration"
              : "system",
        status: activeJob.status,
        progress: activeJob.progress || 0,
        stage: activeJob.stage || "",
        startedAt: activeJob.startedAt || activeJob.createdAt,
      }
    : null;

  const resultPayload = {
    context: {
      projectId: snapshot.projectId,
      projectName: snapshot.project?.name || "CovAI Project",
      branch: snapshot.project?.defaultBranch || "main",
      lifecycleStatus: effectiveLifecycleStatus,
      snapshotId: snapshot.id,
      snapshotLabel: activeSnapshotLabel,
      commitSha: snapshot.commitSha || snapshot.id.slice(0, 7),
      snapshots: formattedSnapshots,
      activeSuiteRun,
      updatedAt: Date.now(),
    },
    activeSuiteRun,
    health: {
      score: healthScore,
      grade: healthGrade,
      delta: healthDelta,
    },
    ai: {
      aiGenerated: aiGeneratedCount,
      aiRepaired: aiRepairedCount,
      gaps: totalCoverageGaps,
    },
    pillars: {
      unit: unitPillar,
      integration: integrationPillar,
      system: systemPillar,
    },
    matrix: {
      rows: matrixRows,
    },
    trend: {
      series: trendSeries,
      beforeAfter,
    },
    history: {
      runs: historyRuns,
    },
    featureDurations,
    aiEvaluation,
  };

  const historyTime = Date.now() - startHistory;
  if (!currentFingerprint) {
    const latestSnapshotRun =
      snapshotRuns[0] ||
      latestUnitRun ||
      latestSystemRun ||
      null;
    const latestSnapshotAiTest =
      (aiTestsList || []).find((t) => t.snapshotId === snapshot.id) || null;
    currentFingerprint = computeDashboardFingerprintFromData({
      latestRun: latestSnapshotRun,
      snapshotMeta: snapshot,
      latestAiTest: latestSnapshotAiTest,
      coverageSum: unitSummaryRecord,
      latestProjectJob: projectTerminalJobs?.[0] || null,
      latestAiEvalRun: aiEvaluationRuns?.[0] || null,
      latestDesignAudit: aiDesignAudit || null,
    });
  }

  const nowCacheTs = Date.now();
  dashboardPayloadCache.set(snapshot.id, {
    data: resultPayload,
    cachedAt: nowCacheTs,
    lastVerifiedAt: nowCacheTs,
    fingerprint: currentFingerprint,
    allowedUsers: new Set([userId, snapshot.project?.ownerId].filter(Boolean)),
  });

  const totalTime = Date.now() - start;
  console.log(
    `[PERF: Unified Dashboard] snapshotId=${snapshotId} Total=${totalTime}ms | cacheHit=false | access=${accessTime}ms | parallelFetch=${parallelFetchTime}ms | unit=${unitTime}ms | integration=${integrationTime}ms | system=${systemTime}ms | ai=${aiTime}ms | history=${historyTime}ms`
  );

  return resultPayload;
}

/**
 * Fetch full details of a specific TestRun for the SlideOverInspectorDrawer.
 */
export async function getUnifiedTestRunInspection({ snapshotId, runId, userId }) {
  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, projectId: true },
  });

  if (!snapshot) {
    const err = new Error("Snapshot not found.");
    err.statusCode = 404;
    throw err;
  }

  await resolveProjectAccess({
    projectId: snapshot.projectId,
    userId,
    capability: "project.read",
  });

  const testRun = await prisma.testRun.findFirst({
    where: {
      id: runId,
      snapshot: { projectId: snapshot.projectId },
    },
    include: {
      snapshot: { select: { id: true, commitSha: true, createdAt: true } },
      scenarios: true,
      testFiles: true,
    },
  });

  if (!testRun) {
    const err = new Error("TestRun not found.");
    err.statusCode = 404;
    throw err;
  }

  const tType = String(testRun.type || "").toUpperCase();
  const pillarType =
    tType === "PLAYWRIGHT" || tType === "CYPRESS"
      ? "system"
      : tType === "SUPERTEST" || tType === "PLAYWRIGHT_API"
      ? "integration"
      : "unit";

  const scenarios = (testRun.scenarios || []).map((s) => {
    const st = String(s.status || "").toLowerCase();
    const cleanMsgs = (s.failureMessages || []).map((m) => cleanStorageText(m));
    return {
      id: s.id,
      name: s.title,
      suiteName: s.suiteName,
      filePath: cleanStoragePath(s.testFile) || s.testFile || "",
      status: st === "passed" ? "pass" : st === "failed" ? "fail" : "flaky",
      durationMs: s.durationMs || 0,
      failureLayer: s.failureLayer || s.failureCategory || null,
      failureStep: s.failureStep || null,
      failureCodeSnippet: s.failureCodeSnippet || null,
      errorMessage: cleanMsgs.join("\n\n") || null,
      executionDetails: s.executionDetails || null,
      isFaultyExistingTest: Boolean(s.isFaultyExistingTest),
      step: s.failureStep || s.failureLayer || s.failureCategory || s.suiteName || "Executed",
    };
  });

  const failedScenario = scenarios.find((s) => s.status === "fail") || scenarios[0] || null;

  return {
    id: testRun.id,
    runId: testRun.id,
    type: pillarType,
    runner: tType,
    status: (testRun.failedTests || 0) > 0 ? "fail" : "pass",
    passed: testRun.passedTests || 0,
    failed: testRun.failedTests || 0,
    flaky: testRun.flakyTests || 0,
    skipped: testRun.skippedTests || 0,
    total: testRun.totalTests || 0,
    durationMs: testRun.durationMs || 0,
    coverageLinesPct: toFixedNum(testRun.coverageLinesPct),
    coverageBranchesPct: toFixedNum(testRun.coverageBranchesPct),
    startedAt: testRun.startedAt || testRun.createdAt,
    commitSha: testRun.snapshot?.commitSha || testRun.snapshotId.slice(0, 7),
    filePath: failedScenario?.filePath || "Test Suite",
    failureLayer:
      failedScenario?.failureLayer ||
      ((testRun.failedTests || 0) > 0 ? `${tType} Failure` : "None — All Passed"),
    stackTrace:
      failedScenario?.errorMessage ||
      `${tType} Execution Summary:\n  Passed: ${testRun.passedTests || 0}/${testRun.totalTests || 0}\n  Failed: ${testRun.failedTests || 0}\n  Duration: ${testRun.durationMs || 0}ms`,
    testCases: scenarios,
  };
}

