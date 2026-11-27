import { jest } from "@jest/globals";
import {
  PROJECT_LIFECYCLE_STATES,
  LIFECYCLE_META,
  LIFECYCLE_MANAGE_CAPABILITY,
  isKpiIncludedLifecycleStatus,
  isOpenWorkspaceLifecycleStatus,
  isIsolatedLifecycleStatus,
  canManageProjectLifecycle,
  validateLifecycleTransition,
  computePassRatePct,
  computeNormalizedWeightedAverage,
  computeProjectHealthAndCoverage,
  classifyRiskQuadrant,
  PORTFOLIO_ROI_BASELINE,
  safeParseMetaJson,
  AUTO_TRANSITION_DOING_JOB_TYPES,
  PORTFOLIO_EXPORT_FORMATS,
  PORTFOLIO_EXPORT_SCOPES,
} from "../../../shared/portfolioGovernance.js";
import { roleAllows } from "../../../shared/projectAccess.js";

describe("Phase 0: Shared Portfolio Governance SSOT Contract", () => {
  test("lifecycle states and scope predicates enforce D1 & D2 rules", () => {
    expect(PROJECT_LIFECYCLE_STATES).toEqual([
      "NOT_STARTED",
      "DOING",
      "PAUSED",
      "COMPLETED",
      "CANCELLED",
    ]);

    expect(isKpiIncludedLifecycleStatus("DOING")).toBe(true);
    expect(isKpiIncludedLifecycleStatus("NOT_STARTED")).toBe(false);
    expect(isKpiIncludedLifecycleStatus("PAUSED")).toBe(false);
    expect(isKpiIncludedLifecycleStatus("COMPLETED")).toBe(false);
    expect(isKpiIncludedLifecycleStatus("CANCELLED")).toBe(false);

    expect(isOpenWorkspaceLifecycleStatus("DOING")).toBe(true);
    expect(isOpenWorkspaceLifecycleStatus("NOT_STARTED")).toBe(true);
    expect(isOpenWorkspaceLifecycleStatus("PAUSED")).toBe(false);

    expect(isIsolatedLifecycleStatus("PAUSED")).toBe(true);
    expect(isIsolatedLifecycleStatus("COMPLETED")).toBe(true);
    expect(isIsolatedLifecycleStatus("CANCELLED")).toBe(true);
    expect(isIsolatedLifecycleStatus("DOING")).toBe(false);
    expect(isIsolatedLifecycleStatus("NOT_STARTED")).toBe(false);

    expect(LIFECYCLE_META.DOING.showTopbarIsolatedBadge).toBe(false);
    expect(LIFECYCLE_META.NOT_STARTED.showTopbarIsolatedBadge).toBe(false);
    expect(LIFECYCLE_META.PAUSED.showTopbarIsolatedBadge).toBe(true);
    expect(LIFECYCLE_META.COMPLETED.showTopbarIsolatedBadge).toBe(true);
    expect(LIFECYCLE_META.CANCELLED.showTopbarIsolatedBadge).toBe(true);
  });

  test("RBAC enforces OWNER-only lifecycle management (D3)", () => {
    expect(LIFECYCLE_MANAGE_CAPABILITY).toBe("project.lifecycle.manage");
    expect(canManageProjectLifecycle("OWNER")).toBe(true);
    expect(canManageProjectLifecycle("EDITOR")).toBe(false);
    expect(canManageProjectLifecycle("VIEWER")).toBe(false);
    expect(canManageProjectLifecycle("UNKNOWN")).toBe(false);

    expect(roleAllows("OWNER", LIFECYCLE_MANAGE_CAPABILITY)).toBe(true);
    expect(roleAllows("EDITOR", LIFECYCLE_MANAGE_CAPABILITY)).toBe(false);
    expect(roleAllows("VIEWER", LIFECYCLE_MANAGE_CAPABILITY)).toBe(false);
  });

  test("validateLifecycleTransition blocks reverting to NOT_STARTED once project has activity (D3)", () => {
    expect(
      validateLifecycleTransition({
        currentStatus: "NOT_STARTED",
        nextStatus: "DOING",
        hasActivity: false,
      }),
    ).toEqual({ allowed: true, code: null, reason: null });

    expect(
      validateLifecycleTransition({
        currentStatus: "DOING",
        nextStatus: "PAUSED",
        hasActivity: true,
      }),
    ).toEqual({ allowed: true, code: null, reason: null });

    expect(
      validateLifecycleTransition({
        currentStatus: "PAUSED",
        nextStatus: "DOING",
        hasActivity: true,
      }),
    ).toEqual({ allowed: true, code: null, reason: null });

    expect(
      validateLifecycleTransition({
        currentStatus: "NOT_STARTED",
        nextStatus: "NOT_STARTED",
        hasActivity: false,
      }),
    ).toEqual({ allowed: true, code: null, reason: null });

    const blocked = validateLifecycleTransition({
      currentStatus: "DOING",
      nextStatus: "NOT_STARTED",
      hasActivity: true,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe("CANNOT_REVERT_TO_NOT_STARTED");

    const invalid = validateLifecycleTransition({
      currentStatus: "DOING",
      nextStatus: "ARCHIVED",
      hasActivity: false,
    });
    expect(invalid.allowed).toBe(false);
    expect(invalid.code).toBe("INVALID_LIFECYCLE_STATUS");
  });

  test("computeNormalizedWeightedAverage & computeProjectHealthAndCoverage apply D4 parity and re-normalization", () => {
    // 1. Unit-only project: 100% pass, 80% line cov, API/E2E unmeasured
    const unitOnly = computeProjectHealthAndCoverage({
      unit: { totalTests: 20, passedTests: 20, failedTests: 0, coveragePct: 80 },
      integration: { totalTests: 0, passedTests: 0, failedTests: 0, coveragePct: null },
      system: { totalTests: 0, passedTests: 0, failedTests: 0, coveragePct: null },
    });
    expect(unitOnly.unifiedCoveragePct).toBe(80);
    expect(unitOnly.measuredCoverageLayers).toEqual(["unit"]);
    expect(unitOnly.healthScore).toBe(90);
    expect(unitOnly.grade).toBe("A");
    expect(unitOnly.gateStatus).toBe("PASSED");

    // 2. Unit (80%) + API (60%), E2E unmeasured -> (80*0.5 + 60*0.3) / 0.8 = 72.5
    const twoLayers = computeNormalizedWeightedAverage({
      unit: 80,
      integration: 60,
      system: null,
    });
    expect(twoLayers.value).toBe(72.5);
    expect(twoLayers.measuredLayers).toEqual(["unit", "integration"]);
    expect(twoLayers.unmeasuredLayers).toEqual(["system"]);

    // 3. System E2E executed without coverage instrumentation (coveragePct: null)
    // Never fabricates sysCov = sysPassRate
    const e2eNoCov = computeProjectHealthAndCoverage({
      unit: { totalTests: 10, passedTests: 10, failedTests: 0, coveragePct: 80 },
      integration: { totalTests: 0, passedTests: 0, failedTests: 0, coveragePct: null },
      system: { totalTests: 5, passedTests: 4, failedTests: 1, coveragePct: null },
    });
    expect(e2eNoCov.unifiedCoveragePct).toBe(80);
    expect(e2eNoCov.measuredCoverageLayers).toEqual(["unit"]);
    // Pass rate ignores skipped tests: 14 / 15 = 93.3%
    expect(e2eNoCov.passRatePct).toBe(93.3);
    expect(e2eNoCov.gateStatus).toBe("BLOCKED");

    // 4. Untested project -> null metrics, UNTESTED gate
    const untested = computeProjectHealthAndCoverage();
    expect(untested.healthScore).toBeNull();
    expect(untested.unifiedCoveragePct).toBeNull();
    expect(untested.passRatePct).toBeNull();
    expect(untested.grade).toBe("—");
    expect(untested.gateStatus).toBe("UNTESTED");

    // 5. Pass rate excludes skipped tests: 8 / (8 + 2) = 80.0%
    expect(computePassRatePct(8, 2)).toBe(80);
    expect(computePassRatePct(0, 0)).toBeNull();
  });

  test("classifyRiskQuadrant isolates UNTESTED from Critical Risk (D4)", () => {
    expect(
      classifyRiskQuadrant({
        unifiedCoveragePct: null,
        passRatePct: null,
        gateStatus: "UNTESTED",
      }),
    ).toEqual({
      quadrantId: "untested",
      quadrantLabel: "Not Yet Tested",
      isUntested: true,
    });

    expect(
      classifyRiskQuadrant({
        unifiedCoveragePct: 85,
        passRatePct: 95,
        gateStatus: "PASSED",
      }).quadrantId,
    ).toBe("healthy-stars");

    expect(
      classifyRiskQuadrant({
        unifiedCoveragePct: 50,
        passRatePct: 92,
        gateStatus: "AT_RISK",
      }).quadrantId,
    ).toBe("false-security");

    expect(
      classifyRiskQuadrant({
        unifiedCoveragePct: 78,
        passRatePct: 75,
        gateStatus: "BLOCKED",
      }).quadrantId,
    ).toBe("active-regressions");

    expect(
      classifyRiskQuadrant({
        unifiedCoveragePct: 40,
        passRatePct: 60,
        gateStatus: "BLOCKED",
      }).quadrantId,
    ).toBe("critical-risk");
  });

  test("safeParseMetaJson parses strings, passes objects, and warns on malformed JSON (D5)", () => {
    expect(safeParseMetaJson('{"requests":[{"origin":"AI_GENERATED"}]}')).toEqual({
      requests: [{ origin: "AI_GENERATED" }],
    });
    const obj = { dryRun: "PASSED" };
    expect(safeParseMetaJson(obj)).toBe(obj);
    expect(safeParseMetaJson(null)).toBeNull();

    const warnMock = jest.fn();
    expect(safeParseMetaJson("{broken-json", { onWarn: warnMock })).toBeNull();
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  test("ROI baseline, auto-transition triggers, and export contracts match D5, D6, D7", () => {
    expect(PORTFOLIO_ROI_BASELINE.isHeuristicEstimate).toBe(true);
    expect(PORTFOLIO_ROI_BASELINE.label).toContain("Est.");
    expect(PORTFOLIO_ROI_BASELINE.methodologyNote).not.toMatch(/IEEE\s*829/i);

    expect(AUTO_TRANSITION_DOING_JOB_TYPES).toContain("RUN_TESTS");
    expect(AUTO_TRANSITION_DOING_JOB_TYPES).toContain("SUPERTEST_COVERAGE");
    expect(AUTO_TRANSITION_DOING_JOB_TYPES).toContain("SYSTEM_TEST_ANALYSIS");
    expect(AUTO_TRANSITION_DOING_JOB_TYPES).toContain("PLAYWRIGHT_API_COVERAGE");
    expect(AUTO_TRANSITION_DOING_JOB_TYPES).toContain("AI_EVALUATION");
    expect(AUTO_TRANSITION_DOING_JOB_TYPES).not.toContain("INGEST");
    expect(AUTO_TRANSITION_DOING_JOB_TYPES).not.toContain("ANALYSIS");

    expect(PORTFOLIO_EXPORT_FORMATS).toEqual(["pdf", "csv", "json"]);
    expect(PORTFOLIO_EXPORT_SCOPES).toEqual(["active", "all", "current_view"]);
  });
});
