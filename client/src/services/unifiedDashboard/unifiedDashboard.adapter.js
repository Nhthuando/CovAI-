import {
  computeHealth,
  computeQualityGate,
  computeExecutionTotals,
  computeCoverageIndex,
  computePyramid,
  buildActionItems,
  getPassRate,
} from "./unifiedDashboard.selectors.js";

function toFixedPct(val, fallback = 0) {
  if (val === null || val === undefined || val === "") return fallback;
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  return Number(num.toFixed(1));
}

/**
 * Adapt Raw Unit Test Data into PillarVM (100% Real Data)
 */
export function adaptUnit(raw, unifiedUnit = null) {
  if (unifiedUnit && typeof unifiedUnit === "object") {
    const passedTests = Number(unifiedUnit.passedTests ?? 0);
    const failedTests = Number(unifiedUnit.failedTests ?? 0);
    const skippedTests = Number(unifiedUnit.skippedTests ?? 0);
    const totalTests = Number(
      unifiedUnit.totalTests ?? passedTests + failedTests + skippedTests
    );
    const durationMs = Number(unifiedUnit.durationMs ?? 0);
    const passRate = getPassRate(passedTests, failedTests) ?? Number(unifiedUnit.passRate ?? 0);
    const avgDurationMs =
      Number(unifiedUnit.avgDurationMs) ||
      (totalTests > 0 ? Math.round(durationMs / totalTests) : 0);

    const cov = unifiedUnit.coverageMetrics || {};
    const coverageMetrics = {
      lines: toFixedPct(cov.lines),
      branches: toFixedPct(cov.branches),
      functions: toFixedPct(cov.functions),
      statements: toFixedPct(cov.statements),
    };

    const lowCoverageItems = Array.isArray(unifiedUnit.lowCoverageItems)
      ? unifiedUnit.lowCoverageItems.slice(0, 4).map((f) => ({
          filePath: f.filePath,
          name: f.name || (f.filePath || "").split(/[/\\]/).pop(),
          branchesPct: toFixedPct(f.branchesPct),
          linesPct: toFixedPct(f.linesPct),
          line: f.line || 1,
        }))
      : [];

    return {
      id: "unit",
      label: "Unit Test",
      framework: unifiedUnit.framework || "Jest",
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      flakyTests: Number(unifiedUnit.flakyTests ?? 0),
      passRate,
      durationMs,
      avgDurationMs,
      coverageMetrics,
      lowCoverageItems,
      failedScenarios: Array.isArray(unifiedUnit.failedScenarios) ? unifiedUnit.failedScenarios : [],
      failureDistribution: unifiedUnit.failureDistribution || {},
      errorMessage: unifiedUnit.errorMessage || null,
    };
  }

  if (!raw || (!raw.summary && (!raw.files || raw.files.length === 0) && !raw.executions)) {
    return {
      id: "unit",
      label: "Unit Test",
      framework: "Jest",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      coverageMetrics: { lines: 0, branches: 0, functions: 0, statements: 0 },
      lowCoverageItems: [],
      failedScenarios: [],
      failureDistribution: {},
      errorMessage: null,
    };
  }

  const { summary, files = [], executions = {}, frameworks = {} } = raw;

  // Detect Framework
  const fwName =
    frameworks?.supported?.unit?.[0] ||
    (executions?.vitest ? "Vitest" : executions?.jest ? "Jest" : "Jest");
  const framework = String(fwName).charAt(0).toUpperCase() + String(fwName).slice(1);

  // Test execution counts
  const runInfo = summary?.testExecution || executions?.jest || executions?.vitest || {};
  const passedTests = Number(runInfo.numPassedTests ?? runInfo.passedTests ?? 0);
  const failedTests = Number(runInfo.numFailedTests ?? runInfo.failedTests ?? 0);
  const skippedTests = Number(runInfo.numPendingTests ?? runInfo.skippedTests ?? 0);
  const totalTests = Number(
    runInfo.numTotalTests ?? runInfo.totalTests ?? passedTests + failedTests + skippedTests
  );
  const flakyTests = 0;
  const durationMs = Number(runInfo.durationMs ?? runInfo.duration ?? 0);
  const passRate = getPassRate(passedTests, failedTests) ?? 0;
  const avgDurationMs = totalTests > 0 ? Math.round(durationMs / totalTests) : 0;

  // Coverage percentages
  const cov = summary?.coverage || {};
  const coverageMetrics = {
    lines: toFixedPct(cov.lines ?? cov.line),
    branches: toFixedPct(cov.branches ?? cov.branch),
    functions: toFixedPct(cov.functions ?? cov.function),
    statements: toFixedPct(cov.statements ?? cov.statement),
  };

  // Top 4 lowest branch coverage files
  const validFiles = Array.isArray(files)
    ? files.filter(
        (f) =>
          f?.filePath &&
          !f.filePath.includes("node_modules") &&
          !f.filePath.includes(".test.") &&
          !f.filePath.includes(".spec.")
      )
    : [];

  const sortedFiles = [...validFiles].sort(
    (a, b) => (a.branchesPct ?? 0) - (b.branchesPct ?? 0) || (a.linesPct ?? 0) - (b.linesPct ?? 0)
  );
  const lowCoverageItems = sortedFiles.slice(0, 4).map((f) => ({
    filePath: f.filePath,
    name: (f.filePath || "").split(/[/\\]/).pop(),
    branchesPct: toFixedPct(f.branchesPct),
    linesPct: toFixedPct(f.linesPct),
    line: 1,
  }));

  return {
    id: "unit",
    label: "Unit Test",
    framework,
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    coverageMetrics,
    lowCoverageItems,
    failedScenarios: [],
    failureDistribution: {},
    errorMessage: null,
  };
}

/**
 * Adapt Raw Integration Test Data into PillarVM (100% Real Data)
 * Strictly separates executed tests from Uncovered APIs and never injects mock failures when failedTests === 0.
 */
export function adaptIntegration(workspaceData, coverageSummary = null, unifiedIntegration = null) {
  if (unifiedIntegration && typeof unifiedIntegration === "object") {
    const passedTests = Number(unifiedIntegration.passedTests ?? 0);
    const failedTests = Number(unifiedIntegration.failedTests ?? 0);
    const skippedTests = Number(unifiedIntegration.skippedTests ?? 0);
    const totalTests = Number(
      unifiedIntegration.totalTests ?? passedTests + failedTests + skippedTests
    );
    const durationMs = Number(unifiedIntegration.durationMs ?? 0);
    const avgDurationMs = Number(unifiedIntegration.avgDurationMs ?? 0);
    const passRate = getPassRate(passedTests, failedTests) ?? Number(unifiedIntegration.passRate ?? 0);

    const cov = unifiedIntegration.coverageMetrics || {};
    const coverageMetrics = {
      lines: toFixedPct(cov.lines),
      branches: toFixedPct(cov.branches),
      functions: toFixedPct(cov.functions),
      statements: toFixedPct(cov.statements),
      apiEndpoint: toFixedPct(cov.apiEndpoint),
      uncoveredApis: Number(cov.uncoveredApis ?? 0),
      totalApis: Number(cov.totalApis ?? 0),
    };

    const fd = unifiedIntegration.failureDistribution || {};
    const failureDistribution =
      failedTests <= 0
        ? { route: 0, middlewareAuth: 0, controller: 0, database: 0 }
        : {
            route: Number(fd.route ?? 0),
            middlewareAuth: Number(fd.middlewareAuth ?? 0),
            controller: Number(fd.controller ?? 0),
            database: Number(fd.database ?? 0),
          };

    return {
      id: "integration",
      label: "Integration Test",
      framework: unifiedIntegration.framework || "Supertest",
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      flakyTests: Number(unifiedIntegration.flakyTests ?? 0),
      passRate,
      durationMs,
      avgDurationMs,
      coverageMetrics,
      lowCoverageItems: Array.isArray(unifiedIntegration.lowCoverageItems)
        ? unifiedIntegration.lowCoverageItems
        : [],
      failedScenarios: Array.isArray(unifiedIntegration.failedScenarios)
        ? unifiedIntegration.failedScenarios
        : [],
      failureDistribution,
      errorMessage: unifiedIntegration.errorMessage || null,
    };
  }

  if (!workspaceData?.summary && !Array.isArray(workspaceData?.endpoints) && !coverageSummary?.coverage) {
    return {
      id: "integration",
      label: "Integration Test",
      framework: "Supertest",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      coverageMetrics: {
        lines: 0,
        branches: 0,
        functions: 0,
        statements: 0,
        apiEndpoint: 0,
        uncoveredApis: 0,
        totalApis: 0,
      },
      lowCoverageItems: [],
      failedScenarios: [],
      failureDistribution: {
        route: 0,
        middlewareAuth: 0,
        controller: 0,
        database: 0,
      },
      errorMessage: null,
    };
  }

  const wsSummary = workspaceData?.summary || {};
  const endpoints = Array.isArray(workspaceData?.endpoints) ? workspaceData.endpoints : [];

  const coveredCountFromEndpoints = endpoints.filter((e) => e.status === "Covered").length;
  const failedCountFromEndpoints = endpoints.filter(
    (e) => e.status === "Failed" || e.status === "Script Error"
  ).length;

  const passedTests = Number(wsSummary.passedTests ?? wsSummary.testedApis ?? coveredCountFromEndpoints ?? 0);
  const failedTests = Number(wsSummary.failedTests ?? failedCountFromEndpoints ?? 0);
  const skippedTests = Number(wsSummary.skippedTests ?? 0);

  // Executed test count: only actual executed tests (never counting Uncovered APIs as executed or failed)
  const executedTests = Number(
    wsSummary.totalTests ?? wsSummary.executedApis ?? passedTests + failedTests + skippedTests
  );
  const totalApis = Number(wsSummary.totalApis ?? wsSummary.totalEndpoints ?? (endpoints.length || executedTests));
  const uncoveredApis = Number(
    wsSummary.uncoveredApis ?? Math.max(0, totalApis - passedTests - failedTests)
  );

  const flakyTests = 0;
  const durationMs = Number(wsSummary.durationMs ?? 0);
  const avgDurationMs = Number(wsSummary.avgEndpointLatencyMs ?? wsSummary.avgRequestLatencyMs ?? 0);
  const passRate = getPassRate(passedTests, failedTests) ?? 0;

  // API Coverage metrics
  const epMetrics = wsSummary.endpointCoverageMetrics || {};
  const apiEndpointPct =
    epMetrics.endpointCoveragePct !== undefined
      ? toFixedPct(epMetrics.endpointCoveragePct)
      : totalApis > 0
      ? toFixedPct((passedTests / totalApis) * 100)
      : 0;

  const codeCov = wsSummary.codeCoverage || coverageSummary?.coverage || {};
  const coverageMetrics = {
    lines: toFixedPct(codeCov.line?.pct ?? codeCov.line ?? codeCov.lines),
    branches: toFixedPct(codeCov.branch?.pct ?? codeCov.branch ?? codeCov.branches),
    functions: toFixedPct(codeCov.function?.pct ?? codeCov.function ?? codeCov.functions),
    statements: toFixedPct(codeCov.statement?.pct ?? codeCov.statement ?? codeCov.statements),
    apiEndpoint: apiEndpointPct,
    uncoveredApis,
    totalApis,
  };

  // Real failure layer breakdown from endpoints.scenarios or qualityClassification
  let routeCount = 0;
  let middlewareCount = 0;
  let controllerCount = 0;
  let databaseCount = 0;

  if (failedTests > 0) {
    for (const ep of endpoints) {
      if (Array.isArray(ep.scenarios)) {
        for (const sc of ep.scenarios) {
          if (sc.status && sc.status.toLowerCase() !== "passed" && sc.status.toLowerCase() !== "skipped") {
            const fl = String(sc.failureLayer || "").toUpperCase();
            if (fl === "ROUTER_NOT_FOUND") routeCount++;
            else if (fl === "MIDDLEWARE_REJECTED") middlewareCount++;
            else if (fl === "DATABASE_FAILURE") databaseCount++;
            else controllerCount++;
          }
        }
      }
    }
    const qc = wsSummary.qualityClassification || {};
    if (routeCount + middlewareCount + controllerCount + databaseCount === 0) {
      routeCount = Number(qc.invalidTests ?? 0);
      middlewareCount = Number(qc.testScriptErrors ?? 0);
      databaseCount = Number(qc.infrastructureFailures ?? 0);
      controllerCount = Number(qc.assertionFailures ?? Math.max(0, failedTests - routeCount - middlewareCount - databaseCount));
    }
  }

  const failureDistribution = {
    route: routeCount,
    middlewareAuth: middlewareCount,
    controller: controllerCount,
    database: databaseCount,
  };

  const lowCoverageItems = endpoints
    .filter((e) => e.status !== "Covered" || (e.mappedCodeCoverage?.line ?? 100) < 60)
    .slice(0, 5)
    .map((e) => ({
      filePath: e.path,
      name: `${e.method || "GET"} ${e.path}`,
      branchesPct: toFixedPct(e.mappedCodeCoverage?.branch),
      linesPct: toFixedPct(e.mappedCodeCoverage?.line),
      line: 1,
    }));

  return {
    id: "integration",
    label: "Integration Test",
    framework: workspaceData?.snapshot?.framework || "Supertest",
    totalTests: executedTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    coverageMetrics,
    lowCoverageItems,
    failedScenarios: [],
    failureDistribution,
    errorMessage: null,
  };
}

/**
 * Adapt Raw System Test (E2E) Data into PillarVM (100% Real Data)
 */
export function adaptSystem(systemSummary, scenariosList = [], unifiedSystem = null) {
  if (unifiedSystem && typeof unifiedSystem === "object") {
    const passedTests = Number(unifiedSystem.passedTests ?? 0);
    const failedTests = Number(unifiedSystem.failedTests ?? 0);
    const flakyTests = Number(unifiedSystem.flakyTests ?? 0);
    const skippedTests = Number(unifiedSystem.skippedTests ?? 0);
    const totalTests = Number(
      unifiedSystem.totalTests ?? passedTests + failedTests + skippedTests
    );
    const durationMs = Number(unifiedSystem.durationMs ?? 0);
    const passRate = getPassRate(passedTests, failedTests) ?? Number(unifiedSystem.passRate ?? 0);
    const avgDurationMs =
      Number(unifiedSystem.avgDurationMs) ||
      (totalTests > 0 ? Math.round(durationMs / totalTests) : 0);

    const cov = unifiedSystem.coverageMetrics || {};
    const flowPct = toFixedPct(cov.flow ?? cov.lines);

    const fd = unifiedSystem.failureDistribution || {};
    const failureDistribution = {
      selectorNotFound: failedTests > 0 ? Number(fd.selectorNotFound ?? 0) : 0,
      networkTimeout: failedTests > 0 ? Number(fd.networkTimeout ?? 0) : 0,
      assertion: failedTests > 0 ? Number(fd.assertion ?? 0) : 0,
      flaky: Number(fd.flaky ?? flakyTests),
    };

    return {
      id: "system",
      label: "System Test (E2E)",
      framework: unifiedSystem.framework || "Playwright",
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      flakyTests,
      passRate,
      durationMs,
      avgDurationMs,
      coverageMetrics: {
        lines: toFixedPct(cov.lines ?? flowPct),
        flow: flowPct,
      },
      lowCoverageItems: [],
      failedScenarios: Array.isArray(unifiedSystem.failedScenarios)
        ? unifiedSystem.failedScenarios
        : [],
      failureDistribution,
      errorMessage: unifiedSystem.errorMessage || null,
    };
  }

  if (!systemSummary && (!scenariosList || scenariosList.length === 0)) {
    return {
      id: "system",
      label: "System Test (E2E)",
      framework: "Playwright",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      coverageMetrics: { lines: 0, flow: 0 },
      lowCoverageItems: [],
      failedScenarios: [],
      failureDistribution: {
        selectorNotFound: 0,
        networkTimeout: 0,
        assertion: 0,
        flaky: 0,
      },
      errorMessage: null,
    };
  }

  const s = systemSummary || {};
  const passedTests = Number(s.passedTests ?? s.passed ?? 0);
  const failedTests = Number(s.failedTests ?? s.failed ?? 0);
  const flakyTests = Number(s.flakyTests ?? s.flaky ?? 0);
  const skippedTests = Number(s.skippedTests ?? 0);
  const totalTests = Number(
    s.totalTests ?? s.e2eTests ?? (passedTests + failedTests + skippedTests || scenariosList.length || 0)
  );
  const durationMs = Number(s.durationMs ?? 0);
  const passRate = getPassRate(passedTests, failedTests) ?? Number(s.passRatePct ?? 0);
  const avgDurationMs = totalTests > 0 ? Math.round(durationMs / totalTests) : 0;

  // Flow coverage
  const frontendCounters = s.coverageSummary?.frontend?.counters || {};
  const flowCoveragePct =
    frontendCounters.lines?.pct !== undefined
      ? toFixedPct(frontendCounters.lines.pct)
      : totalTests > 0
      ? toFixedPct(passRate)
      : 0;

  // Failure categories: strictly 0 when failedTests === 0
  const failureDistribution = {
    selectorNotFound: 0,
    networkTimeout: 0,
    assertion: 0,
    flaky: flakyTests,
  };

  if (failedTests > 0 && Array.isArray(s.scenarios) && s.scenarios.length > 0) {
    let selector = 0,
      timeout = 0,
      assertion = 0;
    for (const sc of s.scenarios) {
      if (sc.status === "failed") {
        const cat = String(sc.failureCategory || "").toUpperCase();
        const msg = (sc.failureMessages || []).join(" ").toLowerCase();
        if (cat === "ELEMENT_NOT_FOUND" || msg.includes("selector") || msg.includes("locator") || msg.includes("waiting for element")) {
          selector++;
        } else if (
          ["TIMEOUT", "SERVER_ERROR", "NAVIGATION_ERROR"].includes(cat) ||
          msg.includes("timeout") ||
          msg.includes("timed out")
        ) {
          timeout++;
        } else {
          assertion++;
        }
      }
    }
    failureDistribution.selectorNotFound = selector;
    failureDistribution.networkTimeout = timeout;
    failureDistribution.assertion =
      selector + timeout + assertion > 0 ? assertion : failedTests;
  } else if (failedTests > 0) {
    failureDistribution.assertion = failedTests;
  }

  const runnerRaw = s.runner || "playwright";
  const framework = String(runnerRaw).charAt(0).toUpperCase() + String(runnerRaw).slice(1);

  return {
    id: "system",
    label: "System Test (E2E)",
    framework,
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    coverageMetrics: {
      lines: flowCoveragePct,
      flow: flowCoveragePct,
    },
    lowCoverageItems: [],
    failedScenarios: [],
    failureDistribution,
    errorMessage: null,
  };
}

/**
 * Derive Live Traceability Matrix rows from actual live endpoints & unit files
 * when backend matrix.rows is not yet provided.
 */
function buildLiveTraceMatrixRows(unitRaw, integrationRaw, pillars) {
  const endpoints = Array.isArray(integrationRaw?.endpoints) ? integrationRaw.endpoints : [];
  const files = Array.isArray(unitRaw?.files) ? unitRaw.files : [];

  if (endpoints.length === 0 && files.length === 0 && pillars.unit.totalTests === 0) {
    return [];
  }

  // Group endpoints by resource prefix (e.g. /api/auth/login -> Auth)
  const groups = new Map();

  for (const ep of endpoints) {
    const cleanPath = String(ep.path || "/api/resource").replace(/^\/+/, "");
    const parts = cleanPath.split("/");
    const resourceKey = parts[0] === "api" && parts[1] ? parts[1] : parts[0] || "general";
    const groupId = `live-mod-${resourceKey.toLowerCase()}`;

    if (!groups.has(groupId)) {
      const title =
        resourceKey.charAt(0).toUpperCase() +
        resourceKey.slice(1).replace(/[-_]/g, " ") +
        " API Module";
      groups.set(groupId, {
        id: groupId,
        resourceKey: resourceKey.toLowerCase(),
        moduleName: title,
        endpoints: [],
        unitFiles: [],
      });
    }
    groups.get(groupId).endpoints.push(ep);
  }

  // Match unit files to groups or create a Core Services group
  for (const f of files) {
    if (!f.filePath || f.filePath.includes("node_modules") || f.filePath.includes(".test.")) continue;
    const base = f.filePath.split(/[/\\]/).pop().toLowerCase();
    let matched = false;
    for (const grp of groups.values()) {
      if (base.includes(grp.resourceKey)) {
        grp.unitFiles.push(f);
        matched = true;
        break;
      }
    }
    if (!matched && groups.size < 6) {
      const key = base.split(".")[0] || "service";
      const groupId = `live-mod-${key}`;
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          id: groupId,
          resourceKey: key,
          moduleName: `${key.charAt(0).toUpperCase() + key.slice(1)} Module`,
          endpoints: [],
          unitFiles: [],
        });
      }
      groups.get(groupId).unitFiles.push(f);
    }
  }

  const rows = [];
  for (const grp of groups.values()) {
    const totalEp = grp.endpoints.length;
    const coveredEp = grp.endpoints.filter((e) => e.status === "Covered").length;
    const failedEp = grp.endpoints.filter((e) => e.status === "Failed" || e.status === "Script Error").length;
    const firstEp = grp.endpoints[0];
    const firstFile = grp.unitFiles[0];

    const unitHasTests = pillars.unit.totalTests > 0 && grp.unitFiles.length > 0;
    const unitStatus = !unitHasTests ? "untested" : pillars.unit.failedTests > 0 ? "fail" : "pass";
    const unitLabel = unitHasTests
      ? `${firstFile?.linesPct ?? pillars.unit.coverageMetrics.lines}% cov`
      : "0/0 (Not run)";

    const intStatus =
      failedEp > 0 ? "fail" : coveredEp > 0 && coveredEp === totalEp ? "pass" : totalEp > 0 ? "warn" : "untested";
    const intLabel = totalEp > 0 ? `${coveredEp}/${totalEp} covered` : "0/0 APIs";

    const sysStatus =
      pillars.system.failedTests > 0 ? "fail" : pillars.system.totalTests > 0 ? "pass" : "untested";
    const sysLabel =
      pillars.system.totalTests > 0
        ? `${pillars.system.passedTests}/${pillars.system.totalTests} journeys`
        : "0/0 Journeys";

    rows.push({
      id: grp.id,
      moduleName: grp.moduleName,
      description:
        totalEp > 0
          ? `${totalEp} discovered endpoint(s): ${grp.endpoints.map((e) => `${e.method || "GET"} ${e.path}`).slice(0, 2).join(", ")}`
          : `Source file: ${firstFile?.filePath || "N/A"}`,
      unit: {
        status: unitStatus,
        label: unitLabel,
        passed: unitHasTests ? 1 : 0,
        failed: 0,
        total: grp.unitFiles.length,
        path: firstFile?.filePath || null,
      },
      integration: {
        status: intStatus,
        label: intLabel,
        passed: coveredEp,
        failed: failedEp,
        total: totalEp,
        uncovered: Math.max(0, totalEp - coveredEp - failedEp),
        endpoint: firstEp ? `${firstEp.method || "GET"} ${firstEp.path}` : null,
      },
      system: {
        status: sysStatus,
        label: sysLabel,
        passed: pillars.system.passedTests || 0,
        failed: pillars.system.failedTests || 0,
        total: pillars.system.totalTests || 0,
        scenarioId: null,
      },
      rootCause: {
        diagnosis:
          coveredEp === 0 && totalEp > 0
            ? `${totalEp} API endpoint(s) discovered without automated integration coverage yet.`
            : "Real workspace module status.",
        suspectLayer: !unitHasTests ? "unit" : coveredEp < totalEp ? "integration" : "none",
        summary: coveredEp === 0 && totalEp > 0 ? "Uncovered API endpoints" : "Verified state",
      },
      layerDetails: {
        unit: {
          file: firstFile?.filePath || "N/A",
          branchCoveragePct: firstFile?.branchesPct ?? pillars.unit.coverageMetrics?.branches ?? 0,
          failingFunctions: [],
          summaryText: unitHasTests
            ? `Branch coverage: ${firstFile?.branchesPct ?? 0}%`
            : "No unit tests executed for this module yet",
        },
        integration: {
          method: firstEp?.method || "GET",
          endpoint: firstEp?.path || `/api/${grp.resourceKey}`,
          httpStatus: coveredEp > 0 ? 200 : null,
          failureLayer: failedEp > 0 ? "controller" : coveredEp < totalEp ? "uncovered" : "none",
          summaryText: `${coveredEp} of ${totalEp} endpoint(s) covered`,
        },
        system: {
          flowName: `${grp.moduleName} E2E Flow`,
          failedStep: pillars.system.totalTests > 0 ? "Executed" : "No E2E journey executed yet",
          failureKind: pillars.system.totalTests > 0 ? "none" : "untested",
          scenarioId: null,
        },
      },
      items: [
        ...(firstFile
          ? [{ type: "unit", name: firstFile.filePath.split(/[/\\]/).pop(), path: firstFile.filePath, status: unitStatus }]
          : []),
        ...grp.endpoints.slice(0, 4).map((e) => ({
          type: "integration",
          name: `${e.method || "GET"} ${e.path} (${e.status || "Uncovered"})`,
          endpoint: `${e.method || "GET"} ${e.path}`,
          status: e.status === "Covered" ? "pass" : e.status === "Failed" ? "fail" : "untested",
        })),
      ],
    });
  }

  return rows;
}

/**
 * Adapt All Layers into UnifiedDashboardVM (100% Real Data — Zero Mock Presets).
 */
export function adaptUnifiedDashboard({
  unifiedBackendRaw = null,
  unitRaw = null,
  integrationRaw = null,
  systemRaw = null,
  comparisonRaw = null,
  context = {},
}) {
  const effectiveSnapshots = Array.isArray(unifiedBackendRaw?.context?.snapshots) &&
    unifiedBackendRaw.context.snapshots.length > 0
    ? unifiedBackendRaw.context.snapshots
    : Array.isArray(context.snapshots)
    ? context.snapshots
    : [];

  const activeSnapshotId =
    context.snapshotId ||
    unifiedBackendRaw?.context?.snapshotId ||
    effectiveSnapshots[0]?.id ||
    "";

  const unitPillar = adaptUnit(unitRaw, unifiedBackendRaw?.pillars?.unit);
  const integrationPillar = adaptIntegration(
    integrationRaw,
    unitRaw?.summary,
    unifiedBackendRaw?.pillars?.integration
  );
  const systemPillar = adaptSystem(
    systemRaw,
    [],
    unifiedBackendRaw?.pillars?.system
  );

  const pillars = {
    unit: unitPillar,
    integration: integrationPillar,
    system: systemPillar,
  };

  const liveMatrixRows =
    Array.isArray(unifiedBackendRaw?.matrix?.rows) && unifiedBackendRaw.matrix.rows.length > 0
      ? unifiedBackendRaw.matrix.rows
      : buildLiveTraceMatrixRows(unitRaw, integrationRaw, pillars);

  const qualityGate = unifiedBackendRaw?.qualityGate || computeQualityGate(pillars, liveMatrixRows);
  const health =
    unifiedBackendRaw?.health?.score !== undefined && unifiedBackendRaw?.health?.score !== null
      ? {
          score: unifiedBackendRaw.health.score,
          grade: unifiedBackendRaw.health.grade,
          delta: unifiedBackendRaw.health.delta,
        }
      : computeHealth(pillars, null, qualityGate);
  const execution = computeExecutionTotals(pillars);
  const coverage = computeCoverageIndex(pillars);
  const pyramid = computePyramid(pillars);

  // Baseline Delta from unifiedBackendRaw or comparisonRaw if available
  let healthDelta = null;
  if (unifiedBackendRaw?.health?.delta != null) {
    healthDelta = Number(unifiedBackendRaw.health.delta);
  } else if (comparisonRaw?.testRunComparison?.coverageArtifactDiff?.deltaLinesPct != null) {
    healthDelta = Number(comparisonRaw.testRunComparison.coverageArtifactDiff.deltaLinesPct);
  } else if (comparisonRaw?.runtimeDiff?.summary?.fixesCount > 0) {
    healthDelta = comparisonRaw.runtimeDiff.summary.fixesCount * 2.5;
  }
  health.delta = healthDelta;

  const actionsItems =
    Array.isArray(unifiedBackendRaw?.actions?.items) && unifiedBackendRaw.actions.items.length > 0
      ? unifiedBackendRaw.actions.items
      : buildActionItems(pillars, liveMatrixRows);

  // Real Execution History from backend or derived from current run state
  const rawRuns = Array.isArray(unifiedBackendRaw?.history?.runs)
    ? unifiedBackendRaw.history.runs
    : [];
  const liveRuns = rawRuns.map((r) => ({
    ...r,
    shortId: r.shortId || `#${(r.id || "").slice(-6)}`,
  }));

  if (liveRuns.length === 0) {
    if (unitPillar.totalTests > 0) {
      liveRuns.push({
        id: `run-unit-${String(activeSnapshotId).slice(0, 6)}`,
        type: "unit",
        status: unitPillar.failedTests > 0 ? "fail" : "pass",
        passed: unitPillar.passedTests,
        failed: unitPillar.failedTests,
        total: unitPillar.totalTests,
        coveragePct: unitPillar.coverageMetrics.lines,
        durationMs: unitPillar.durationMs,
        startedAt: Date.now(),
        commitSha: String(activeSnapshotId).slice(0, 7),
        failureLayer: unitPillar.failedTests > 0 ? "Unit Assertion Failure" : "None — All Passed",
        stackTrace: `${unitPillar.framework} Execution:\n  Passed: ${unitPillar.passedTests}/${unitPillar.totalTests}\n  Line Coverage: ${unitPillar.coverageMetrics.lines}%`,
        testCases: [],
      });
    }
    if (integrationPillar.totalTests > 0) {
      liveRuns.push({
        id: `run-int-${String(activeSnapshotId).slice(0, 6)}`,
        type: "integration",
        status: integrationPillar.failedTests > 0 ? "fail" : "pass",
        passed: integrationPillar.passedTests,
        failed: integrationPillar.failedTests,
        total: integrationPillar.totalTests,
        coveragePct: integrationPillar.coverageMetrics.apiEndpoint,
        durationMs: integrationPillar.durationMs,
        startedAt: Date.now(),
        commitSha: String(activeSnapshotId).slice(0, 7),
        failureLayer: integrationPillar.failedTests > 0 ? "API Integration Failure" : "None — All Covered",
        stackTrace: `${integrationPillar.framework} Execution:\n  Covered: ${integrationPillar.passedTests}/${integrationPillar.coverageMetrics.totalApis} APIs`,
        testCases: [],
      });
    }
    if (systemPillar.totalTests > 0) {
      liveRuns.push({
        id: `run-sys-${String(activeSnapshotId).slice(0, 6)}`,
        type: "system",
        status: systemPillar.failedTests > 0 ? "fail" : "pass",
        passed: systemPillar.passedTests,
        failed: systemPillar.failedTests,
        total: systemPillar.totalTests,
        coveragePct: systemPillar.coverageMetrics.flow,
        durationMs: systemPillar.durationMs,
        startedAt: Date.now(),
        commitSha: String(activeSnapshotId).slice(0, 7),
        failureLayer: systemPillar.failedTests > 0 ? "System E2E Failure" : "None — All Journeys Passed",
        stackTrace: `${systemPillar.framework} Execution:\n  Passed: ${systemPillar.passedTests}/${systemPillar.totalTests} journeys`,
        testCases: [],
      });
    }
  }

  // Real Trend Series from backend or current snapshot state
  const liveTrendSeries =
    Array.isArray(unifiedBackendRaw?.trend?.series) && unifiedBackendRaw.trend.series.length > 0
      ? unifiedBackendRaw.trend.series
      : execution.total > 0 || (coverage.overall && coverage.overall > 0)
      ? [
          {
            runLabel: `#1 (${String(activeSnapshotId).slice(0, 7) || "Current"})`,
            timestamp: Date.now(),
            unitCoverage: coverage.codePct || 0,
            integrationCoverage: coverage.apiPct || 0,
            systemCoverage: coverage.flowPct || 0,
            overallCoverage: coverage.overall || 0,
            passRate: execution.passRate || 0,
            unitPassRate: unitPillar.passRate || 0,
            integrationPassRate: integrationPillar.passRate || 0,
            systemPassRate: systemPillar.passRate || 0,
          },
        ]
      : [];

  const beforeAfter = unifiedBackendRaw?.trend?.beforeAfter || {
    before: {
      unit: 0,
      integration: 0,
      system: 0,
      unitPassRate: 0,
      integrationPassRate: 0,
      systemPassRate: 0,
    },
    after: {
      unit: coverage.codePct || 0,
      integration: coverage.apiPct || 0,
      system: coverage.flowPct || 0,
      unitPassRate: unitPillar.passRate || 0,
      integrationPassRate: integrationPillar.passRate || 0,
      systemPassRate: systemPillar.passRate || 0,
    },
  };

  const liveGaps =
    unifiedBackendRaw?.ai?.gaps ??
    (integrationPillar.coverageMetrics?.uncoveredApis || 0) +
      (unitPillar.lowCoverageItems?.filter((f) => (f.branchesPct ?? 0) < 75).length || 0);

  return {
    context: {
      projectId: context.projectId || unifiedBackendRaw?.context?.projectId || "",
      projectName: context.projectName || unifiedBackendRaw?.context?.projectName || "CovAI Project",
      snapshotId: activeSnapshotId,
      snapshots: effectiveSnapshots,
      updatedAt: unifiedBackendRaw?.context?.updatedAt || Date.now(),
    },
    qualityGate,
    health,
    execution,
    coverage,
    ai: {
      aiGenerated: Number(unifiedBackendRaw?.ai?.aiGenerated ?? 0),
      aiRepaired: Number(unifiedBackendRaw?.ai?.aiRepaired ?? 0),
      gaps: Number(liveGaps),
    },
    pillars,
    pyramid,
    matrix: {
      rows: liveMatrixRows,
    },
    actions: {
      items: actionsItems,
    },
    trend: {
      series: liveTrendSeries,
      beforeAfter,
    },
    history: {
      runs: liveRuns,
    },
  };
}
