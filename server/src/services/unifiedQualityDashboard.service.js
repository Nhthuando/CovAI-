import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { resolveProjectAccess } from "./projectAccess.service.js";
import { buildIntegrationWorkspace } from "./integrationWorkspace.service.js";
import { detectCoverageFrameworks } from "./coverageFramework.service.js";
import { coverageSummaryFor } from "./systemAssessmentContract.service.js";
import { cleanStoragePath, cleanStorageText } from "../utils/pathSanitizer.js";
import { isApiFilePath } from "../utils/apiFileDetector.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";

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

function resolveSnapshotRootDir(rootDir) {
  if (!rootDir) return null;
  let candidate = rootDir;
  if (!fs.existsSync(rootDir)) {
    if (rootDir.startsWith("/app/")) {
      const hostCandidate = path.resolve(process.cwd(), rootDir.replace(/^\/app\//, ""));
      if (fs.existsSync(hostCandidate)) candidate = hostCandidate;
    } else {
      const storageIdx = rootDir.indexOf("storage");
      if (storageIdx !== -1) {
        const subPath = rootDir.slice(storageIdx).replace(/\\/g, "/");
        const containerCandidate = path.join("/app", subPath);
        if (fs.existsSync(containerCandidate)) candidate = containerCandidate;
        else {
          const hostCandidate = path.resolve(process.cwd(), subPath);
          if (fs.existsSync(hostCandidate)) candidate = hostCandidate;
        }
      }
    }
  }
  const resolved = resolveProjectRoot(candidate);
  return resolved || candidate;
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
function diagnoseModuleRootCause(unitStatus, intStatus, sysStatus, details = {}) {
  const uFail = unitStatus === "fail";
  const iFail = intStatus === "fail";
  const sFail = sysStatus === "fail";

  const uPass = unitStatus === "pass";
  const iPass = intStatus === "pass";
  const sPass = sysStatus === "pass";

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
  if (intStatus === "untested" || intStatus === "warn") {
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
  if (uPass && iPass && sPass) {
    return {
      suspectLayer: "none",
      summary: "Verified across all 3 layers",
      diagnosis: "Unit, Integration API, and System E2E suites pass for this module.",
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
function buildCrossLayerMatrix({ unitFiles = [], unitScenarios = [], endpoints = [], systemScenarios = [], unitPillar, systemPillar }) {
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
    if (domainMap.has(key) || domainMap.size < 8) {
      ensureDomain(key).unitFiles.push(f);
    }
  }

  for (const sc of unitScenarios) {
    const key = extractDomainKey(sc.testFile || sc.suiteName || sc.title || "");
    if (domainMap.has(key) || domainMap.size < 8) {
      ensureDomain(key).unitScenarios.push(sc);
    }
  }

  for (const sc of systemScenarios) {
    const key = extractDomainKey(sc.file || sc.suiteName || sc.title || "");
    if (domainMap.has(key)) {
      ensureDomain(key).systemScenarios.push(sc);
    } else if (domainMap.size > 0) {
      ensureDomain(key).systemScenarios.push(sc);
    }
  }

  const rows = [];
  for (const grp of domainMap.values()) {
    const totalEp = grp.endpoints.length;
    const coveredEp = grp.endpoints.filter((e) => e.status === "Covered").length;
    const failedEp = grp.endpoints.filter((e) => e.status === "Failed" || e.status === "Script Error").length;
    const uncoveredEp = Math.max(0, totalEp - coveredEp - failedEp);
    const firstEp = grp.endpoints[0] || null;

    const uScenariosTotal = grp.unitScenarios.length;
    const uScenariosFailed = grp.unitScenarios.filter((s) => s.status === "failed").length;
    const uScenariosPassed = grp.unitScenarios.filter((s) => s.status === "passed").length;
    const firstUnitFile = grp.unitFiles[0] || null;

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

    let unitStatus = "untested";
    let unitLabel = "0/0 (Not run)";
    if (uScenariosTotal > 0) {
      unitStatus = uScenariosFailed > 0 ? "fail" : "pass";
      const covInfo = avgUnitLines !== null ? ` (${avgUnitLines}%)` : uScenariosFailed > 0 ? ` (${uScenariosFailed} failed)` : "";
      unitLabel = `${uScenariosPassed}/${uScenariosTotal} passed${covInfo}`;
    } else if (grp.unitFiles.length > 0 && avgUnitLines !== null) {
      unitStatus = (avgUnitBranch ?? 100) < 50 ? "warn" : "pass";
      unitLabel = `${avgUnitLines}% lines${avgUnitBranch !== null ? ` · ${avgUnitBranch}% branch` : ""}`;
    }

    let intStatus = "untested";
    let intLabel = "0/0 APIs";
    if (totalEp > 0) {
      if (failedEp > 0) intStatus = "fail";
      else if (coveredEp === totalEp) intStatus = "pass";
      else if (coveredEp > 0) intStatus = "warn";
      else intStatus = "untested";
      intLabel = `${coveredEp}/${totalEp} covered`;
    }

    const sTotal = grp.systemScenarios.length;
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

    const failedEpObj = grp.endpoints.find((e) => e.status === "Failed" || e.status === "Script Error") || firstEp;
    const failedEpScenario = failedEpObj?.scenarios?.find((sc) => sc.status && sc.status.toLowerCase() !== "passed") || null;

    const rootCause = diagnoseModuleRootCause(unitStatus, intStatus, sysStatus, {
      unitFile: firstUnitFile?.filePath,
      unitFailedScenariosCount: uScenariosFailed,
      endpoint: failedEpObj ? `${failedEpObj.method || "GET"} ${failedEpObj.path}` : null,
      failureLayer: failedEpScenario?.failureLayer || (failedEp > 0 ? "CONTROLLER_CRASH" : null),
      flowName: firstSys?.title,
      failureKind: firstSys?.failureCategory,
      uncoveredEpCount: uncoveredEp,
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
        status: e.status === "Covered" ? "pass" : e.status === "Failed" || e.status === "Script Error" ? "fail" : "untested",
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
        total: uScenariosTotal || grp.unitFiles.length,
        path: firstUnitFile?.filePath || null,
      },
      integration: {
        status: intStatus,
        label: intLabel,
        passed: coveredEp,
        failed: failedEp,
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
              ? `${coveredEp}/${totalEp} endpoint(s) covered${failedEp > 0 ? `, ${failedEp} failed` : ""}`
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

  return rows;
}

/**
 * Compute Unified Quality Dashboard payload for a given snapshotId.
 */
export async function buildUnifiedQualityDashboard({ snapshotId, userId }) {
  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    select: {
      id: true,
      projectId: true,
      rootDir: true,
      source: true,
      commitSha: true,
      createdAt: true,
      project: {
        select: { id: true, ownerId: true, name: true },
      },
    },
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

  const resolvedRootDir = resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;

  // Fast cache hit (< 50ms)
  const cachedEntry = dashboardPayloadCache.get(snapshotId);
  if (cachedEntry && Date.now() - cachedEntry.cachedAt < 5000) {
    return cachedEntry.data;
  }

  // 1. Fetch all snapshots for this project for the header Snapshot selector
  const projectSnapshots = await prisma.projectSnapshot.findMany({
    where: { projectId: snapshot.projectId },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      commitSha: true,
      source: true,
      createdAt: true,
    },
  });

  const formattedSnapshots = projectSnapshots.map((s, idx) => ({
    id: s.id,
    commitSha: s.commitSha || s.id.slice(0, 7),
    branch: "main",
    createdAt: s.createdAt,
    label: `#${projectSnapshots.length - idx} (${(s.commitSha || s.id).slice(0, 7)})${
      s.id === snapshot.id ? " — Active" : ""
    }`,
  }));

  // 2. Detect Frameworks (Cached)
  let detectedFrameworks = { supported: { unit: ["jest"], integration: ["supertest"], system: ["playwright"] } };
  if (resolvedRootDir && frameworkCache.has(resolvedRootDir)) {
    detectedFrameworks = frameworkCache.get(resolvedRootDir);
  } else if (resolvedRootDir && fs.existsSync(resolvedRootDir)) {
    try {
      detectedFrameworks = detectCoverageFrameworks(resolvedRootDir);
      frameworkCache.set(resolvedRootDir, detectedFrameworks);
    } catch (_) {}
  }

  // 3. Aggregate Unit Layer
  const [unitSummaryRecord, allCoverageFiles, latestUnitRun] = await Promise.all([
    prisma.coverageSummary.findUnique({ where: { snapshotId: snapshot.id } }),
    prisma.coverageFile.findMany({
      where: {
        snapshotId: snapshot.id,
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
      orderBy: [{ branchesPct: "asc" }, { linesPct: "asc" }],
    }),
    prisma.testRun.findFirst({
      where: {
        snapshotId: snapshot.id,
        type: { in: ["JEST", "VITEST"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        scenarios: { omit: { executionDetails: true } },
      },
    }),
  ]);

  const unitFiles = allCoverageFiles.filter((f) => !isApiFilePath(f.filePath));
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

  const avgUnitFuncs =
    unitFiles.length > 0
      ? toFixedNum(
          unitFiles.reduce((acc, f) => acc + Number(f.funcsPct ?? f.functionsPct ?? 0), 0) /
            unitFiles.length
        )
      : 0;
  const avgUnitStmts =
    unitFiles.length > 0
      ? toFixedNum(
          unitFiles.reduce((acc, f) => acc + Number(f.stmtsPct ?? f.statementsPct ?? 0), 0) /
            unitFiles.length
        )
      : 0;

  const unitLinesPct = toFixedNum(
    latestUnitRun?.coverageLinesPct ?? unitSummaryRecord?.linesPct ?? 0
  );
  const unitBranchesPct = toFixedNum(
    latestUnitRun?.coverageBranchesPct ?? unitSummaryRecord?.branchesPct ?? 0
  );
  const unitFuncsPct = toFixedNum(
    latestUnitRun?.coverageFunctionsPct ??
      unitSummaryRecord?.funcsPct ??
      unitSummaryRecord?.functionsPct ??
      avgUnitFuncs
  );
  const unitStmtsPct = toFixedNum(
    latestUnitRun?.coverageStatementsPct ??
      unitSummaryRecord?.stmtsPct ??
      unitSummaryRecord?.statementsPct ??
      avgUnitStmts
  );

  const lowBranchFiles = unitFiles.filter((f) => Number(f.branchesPct ?? 100) < 80);
  const filesToDisplay = lowBranchFiles.length > 0 ? lowBranchFiles : unitFiles;
  const unitLowCoverageItems = filesToDisplay.slice(0, 4).map((f) => ({
    filePath: cleanStoragePath(f.filePath) || f.filePath,
    name: (f.filePath || "").split(/[/\\]/).pop(),
    branchesPct: toFixedNum(f.branchesPct),
    linesPct: toFixedNum(f.linesPct),
    isBottleneck: Number(f.branchesPct ?? 100) < 80,
    line: 1,
  }));

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
    avgDurationMs: unitTotal > 0 ? Math.round(unitDurationMs / unitTotal) : 0,
    coverageMetrics: {
      lines: unitLinesPct,
      branches: unitBranchesPct,
      functions: unitFuncsPct,
      statements: unitStmtsPct,
    },
    lowCoverageItems: unitLowCoverageItems,
    failedScenarios: unitFailedScenarios,
    failureDistribution: {},
    errorMessage: null,
  };

  // 4. Aggregate Integration Layer via buildIntegrationWorkspace
  let integrationWs = null;
  try {
    integrationWs = await buildIntegrationWorkspace(snapshot.id);
  } catch (intErr) {
    console.warn("[UnifiedQualityDashboard] buildIntegrationWorkspace warning:", intErr.message);
  }

  const wsSummary = integrationWs?.summary || {};
  const endpoints = Array.isArray(integrationWs?.endpoints) ? integrationWs.endpoints : [];
  const coveredEpCount = endpoints.filter((e) => e.status === "Covered").length;
  const failedEpCount = endpoints.filter((e) => e.status === "Failed" || e.status === "Script Error").length;

  const intPassed = Number(wsSummary.passedTests ?? wsSummary.testedApis ?? coveredEpCount ?? 0);
  const intFailed = Number(wsSummary.failedTests ?? failedEpCount ?? 0);
  const intSkipped = Number(wsSummary.skippedTests ?? 0);
  const intTotalExecuted = Number(
    wsSummary.totalTests ?? wsSummary.executedApis ?? intPassed + intFailed + intSkipped
  );
  const totalApis = Number(
    wsSummary.totalApis ?? wsSummary.discoveredApis ?? (endpoints.length || intTotalExecuted)
  );
  const uncoveredApis = Number(
    wsSummary.uncoveredApis ?? Math.max(0, totalApis - coveredEpCount - failedEpCount)
  );
  const intDurationMs = Number(wsSummary.durationMs ?? 0);
  const intAvgLatencyMs = Number(
    wsSummary.avgEndpointLatencyMs ?? wsSummary.avgRequestLatencyMs ?? 0
  );
  const intPassRate = getPassRate(intPassed, intFailed) ?? 0;

  const epCovPct =
    wsSummary.endpointCoverageMetrics?.endpointCoveragePct !== undefined
      ? toFixedNum(wsSummary.endpointCoverageMetrics.endpointCoveragePct)
      : totalApis > 0
      ? toFixedNum((coveredEpCount / totalApis) * 100)
      : 0;

  const intHasRuns = intTotalExecuted > 0;
  const intCodeCov = wsSummary.codeCoverage || {};
  const intCoverageMetrics = {
    lines: intHasRuns ? toFixedNum(intCodeCov.line?.pct ?? intCodeCov.line ?? 0) : 0,
    branches: intHasRuns ? toFixedNum(intCodeCov.branch?.pct ?? intCodeCov.branch ?? 0) : 0,
    functions: intHasRuns ? toFixedNum(intCodeCov.function?.pct ?? intCodeCov.function ?? 0) : 0,
    statements: intHasRuns ? toFixedNum(intCodeCov.statement?.pct ?? intCodeCov.statement ?? 0) : 0,
    apiEndpoint: epCovPct,
    uncoveredApis,
    totalApis,
  };

  // Real Integration Failure Layer Breakdown
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

  // 5. Aggregate System (E2E) Layer
  const latestSystemRun = await prisma.testRun.findFirst({
    where: {
      snapshotId: snapshot.id,
      type: { in: ["PLAYWRIGHT", "CYPRESS"] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      scenarios: { omit: { executionDetails: true } },
      testFiles: true,
    },
  });

  const sysPassed = Number(latestSystemRun?.passedTests ?? 0);
  const sysFailed = Number(latestSystemRun?.failedTests ?? 0);
  const sysFlaky = Number(latestSystemRun?.flakyTests ?? 0);
  const sysSkipped = Number(latestSystemRun?.skippedTests ?? 0);
  const sysTotal = Number(
    latestSystemRun?.totalTests ?? sysPassed + sysFailed + sysFlaky + sysSkipped
  );
  const sysDurationMs = Number(latestSystemRun?.durationMs ?? 0);
  const sysPassRate = getPassRate(sysPassed, sysFailed) ?? 0;

  let sysFlowCoveragePct = 0;
  if (latestSystemRun?.systemMeasurement) {
    try {
      const sysCovSummary = coverageSummaryFor(latestSystemRun.systemMeasurement);
      const feLinesPct = sysCovSummary?.frontend?.counters?.lines?.pct;
      if (feLinesPct !== undefined && feLinesPct !== null) {
        sysFlowCoveragePct = toFixedNum(feLinesPct);
      }
    } catch (_) {}
  }
  if (sysFlowCoveragePct === 0 && sysTotal > 0) {
    sysFlowCoveragePct = toFixedNum(sysPassRate);
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
    avgDurationMs: sysTotal > 0 ? Math.round(sysDurationMs / sysTotal) : 0,
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

  // 6. Aggregate Real AI Telemetry
  const [aiTestsList, aiSuggestionsCount, aiSystemScenariosCount, aiSystemProposalsApplied] =
    await Promise.all([
      prisma.aiTest.findMany({
        where: { projectId: snapshot.projectId },
        select: { id: true, mode: true, status: true, metaJson: true },
      }),
      prisma.aiSuggestion.count({
        where: { projectId: snapshot.projectId },
      }),
      prisma.systemScenario
        ? prisma.systemScenario.count({
            where: { snapshotId: snapshot.id, source: "AI" },
          })
        : Promise.resolve(0),
      prisma.systemTestProposal
        ? prisma.systemTestProposal.count({
            where: { snapshotId: snapshot.id, state: "APPLIED" },
          })
        : Promise.resolve(0),
    ]);

  let aiGeneratedCount = aiSystemScenariosCount + aiSuggestionsCount;
  let aiRepairedCount = aiSystemProposalsApplied;

  for (const rec of aiTestsList) {
    const requests = Array.isArray(rec.metaJson?.requests) ? rec.metaJson.requests : [];
    if (requests.length > 0) {
      aiGeneratedCount += requests.filter((r) => r.origin === "AI_GENERATED" || !r.origin).length;
      aiRepairedCount += requests.filter((r) => r.repaired || r.healed || r.regenerated).length;
    } else {
      aiGeneratedCount += 1;
    }
    if (rec.status === "APPROVED") {
      aiRepairedCount += 1;
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

  // 8. Build Historical Runs & Trends across Project TestRuns
  const historicalTestRuns = await prisma.testRun.findMany({
    where: {
      snapshot: { projectId: snapshot.projectId },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: {
      snapshot: {
        select: { id: true, commitSha: true, createdAt: true },
      },
      scenarios: {
        take: 15,
        omit: { executionDetails: true },
      },
    },
  });

  const historyRuns = historicalTestRuns.map((run) => {
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
    const rStatus =
      rFailed > 0 || String(run.status).toUpperCase() === "FAILED"
        ? "fail"
        : rFlaky > 0
        ? "flaky"
        : "pass";

    let covPct = toFixedNum(run.coverageLinesPct ?? 0);
    if (pillarType === "unit" && covPct === 0) {
      if (run.id === latestUnitRun?.id || run.snapshotId === snapshot.id) {
        covPct = toFixedNum(unitSummaryRecord?.linesPct ?? unitLinesPct ?? 0);
      }
    } else if (pillarType === "integration" && covPct === 0) {
      covPct = epCovPct;
    } else if (pillarType === "system" && covPct === 0) {
      covPct = rTotal > 0 ? toFixedNum((rPassed / rTotal) * 100) : 0;
    }

    const firstFailedSc = (run.scenarios || []).find(
      (s) => String(s.status || "").toLowerCase() === "failed"
    );
    const failureLayerLabel =
      rStatus === "pass"
        ? "None — All Passed"
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
      commitSha: run.snapshot?.commitSha || run.snapshotId.slice(0, 7),
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
  const chronologicalRuns = [...historicalTestRuns].reverse();
  const trendSeries = [];
  let rollingUnitCov = unitLinesPct;
  let rollingIntCov = epCovPct;
  let rollingSysCov = sysFlowCoveragePct;
  let rollingUnitPass = unitPassRate;
  let rollingIntPass = intPassRate;
  let rollingSysPass = sysPassRate;

  if (chronologicalRuns.length > 0) {
    // Initialize rolling values from earliest known runs per type
    const earliestUnit = chronologicalRuns.find((r) => ["JEST", "VITEST"].includes(r.type));
    const earliestInt = chronologicalRuns.find((r) => ["SUPERTEST", "PLAYWRIGHT_API"].includes(r.type));
    const earliestSys = chronologicalRuns.find((r) => ["PLAYWRIGHT", "CYPRESS"].includes(r.type));

    rollingUnitCov = toFixedNum(earliestUnit?.coverageLinesPct ?? unitLinesPct);
    rollingIntCov = epCovPct;
    rollingSysCov =
      earliestSys && earliestSys.totalTests > 0
        ? toFixedNum(((earliestSys.passedTests || 0) / earliestSys.totalTests) * 100)
        : sysFlowCoveragePct;

    rollingUnitPass =
      earliestUnit ? getPassRate(earliestUnit.passedTests, earliestUnit.failedTests) ?? 0 : unitPassRate;
    rollingIntPass =
      earliestInt ? getPassRate(earliestInt.passedTests, earliestInt.failedTests) ?? 0 : intPassRate;
    rollingSysPass =
      earliestSys ? getPassRate(earliestSys.passedTests, earliestSys.failedTests) ?? 0 : sysPassRate;

    const sampledRuns = chronologicalRuns.slice(-8);
    sampledRuns.forEach((run, idx) => {
      const tType = String(run.type || "").toUpperCase();
      const rPassRate = getPassRate(run.passedTests, run.failedTests) ?? 0;

      if (tType === "JEST" || tType === "VITEST") {
        if (run.coverageLinesPct != null) rollingUnitCov = toFixedNum(run.coverageLinesPct);
        rollingUnitPass = rPassRate;
      } else if (tType === "SUPERTEST" || tType === "PLAYWRIGHT_API") {
        if (run.coverageLinesPct != null && run.coverageLinesPct > 0) {
          rollingIntCov = toFixedNum(run.coverageLinesPct);
        } else {
          rollingIntCov = epCovPct;
        }
        rollingIntPass = rPassRate;
      } else if (tType === "PLAYWRIGHT" || tType === "CYPRESS") {
        rollingSysCov =
          run.totalTests > 0
            ? toFixedNum(((run.passedTests || 0) / run.totalTests) * 100)
            : sysFlowCoveragePct;
        rollingSysPass = rPassRate;
      }

      const overallCov = toFixedNum((rollingUnitCov + rollingIntCov + rollingSysCov) / 3);
      const isLast = idx === sampledRuns.length - 1;
      const shaShort = (run.snapshot?.commitSha || run.snapshotId || "").slice(0, 6);

      trendSeries.push({
        runLabel: isLast ? `#${idx + 1} (Current)` : `#${idx + 1} (${shaShort})`,
        timestamp: new Date(run.createdAt).getTime(),
        unitCoverage: rollingUnitCov,
        integrationCoverage: rollingIntCov,
        systemCoverage: rollingSysCov,
        overallCoverage: overallCov,
        passRate: rPassRate,
        unitPassRate: rollingUnitPass,
        integrationPassRate: rollingIntPass,
        systemPassRate: rollingSysPass,
      });
    });
  } else if (unitLinesPct > 0 || epCovPct > 0 || sysFlowCoveragePct > 0) {
    const overallCov = toFixedNum((unitLinesPct + epCovPct + sysFlowCoveragePct) / 3);
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

  // Compute health delta between firstPoint and lastPoint if multiple runs exist
  let healthDelta = null;
  if (trendSeries.length >= 2) {
    const prevOverall = Number(trendSeries[trendSeries.length - 2].overallCoverage || 0);
    const currOverall = Number(lastPoint.overallCoverage || 0);
    healthDelta = toFixedNum(currOverall - prevOverall);
  }

  // Multi-tier Quality Health Score (Weights: Unit 50%, Integration 30%, System 20%)
  const unitScore = unitTotal > 0 ? 0.5 * unitPassRate + 0.5 * unitLinesPct : 0;
  const intScore = intTotalExecuted > 0 ? 0.5 * intPassRate + 0.5 * epCovPct : 0;
  const sysScore = sysTotal > 0 ? 0.5 * sysPassRate + 0.5 * sysFlowCoveragePct : 0;

  // Unexecuted or uncovered targets still count in the denominator to avoid artificial inflation
  const weightedSum = unitScore * 0.5 + intScore * 0.3 + sysScore * 0.2;
  let healthScore = Math.round(weightedSum);

  // Failure penalty: reduce score when tests fail
  const totalFailures = unitFailed + intFailed + sysFailed;
  if (totalFailures > 0) {
    healthScore = Math.max(0, healthScore - Math.min(15, totalFailures * 2));
  }

  let healthGrade = "D";
  if (healthScore >= 80) healthGrade = "A";
  else if (healthScore >= 65) healthGrade = "B";
  else if (healthScore >= 50) healthGrade = "C";

  const resultPayload = {
    context: {
      projectId: snapshot.projectId,
      projectName: snapshot.project?.name || "CovAI Project",
      snapshotId: snapshot.id,
      commitSha: snapshot.commitSha || snapshot.id.slice(0, 7),
      snapshots: formattedSnapshots,
      updatedAt: Date.now(),
    },
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
  };

  dashboardPayloadCache.set(snapshot.id, {
    data: resultPayload,
    cachedAt: Date.now(),
  });

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

