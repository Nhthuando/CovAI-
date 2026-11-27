import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_LIFECYCLE_STATES,
  LIFECYCLE_MANAGE_CAPABILITY,
  isKpiIncludedLifecycleStatus,
  isOpenWorkspaceLifecycleStatus,
  isIsolatedLifecycleStatus,
  canManageProjectLifecycle,
  validateLifecycleTransition,
  computeProjectHealthAndCoverage,
  classifyRiskQuadrant,
  PORTFOLIO_ROI_BASELINE,
} from "../../../../shared/portfolioGovernance.js";
import { roleAllows } from "../../../../shared/projectAccess.js";

test("client resolves shared portfolioGovernance and OWNER-only RBAC contract", () => {
  assert.deepEqual(PROJECT_LIFECYCLE_STATES, [
    "NOT_STARTED",
    "DOING",
    "PAUSED",
    "COMPLETED",
    "CANCELLED",
  ]);
  assert.equal(isKpiIncludedLifecycleStatus("DOING"), true);
  assert.equal(isKpiIncludedLifecycleStatus("NOT_STARTED"), false);
  assert.equal(isOpenWorkspaceLifecycleStatus("NOT_STARTED"), true);
  assert.equal(isIsolatedLifecycleStatus("PAUSED"), true);

  assert.equal(canManageProjectLifecycle("OWNER"), true);
  assert.equal(canManageProjectLifecycle("EDITOR"), false);
  assert.equal(roleAllows("OWNER", LIFECYCLE_MANAGE_CAPABILITY), true);
  assert.equal(roleAllows("EDITOR", LIFECYCLE_MANAGE_CAPABILITY), false);
  assert.equal(roleAllows("VIEWER", LIFECYCLE_MANAGE_CAPABILITY), false);
});

test("client validates D3 lifecycle transition & D4 re-normalized scoring/quadrant", () => {
  const blocked = validateLifecycleTransition({
    currentStatus: "DOING",
    nextStatus: "NOT_STARTED",
    hasActivity: true,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, "CANNOT_REVERT_TO_NOT_STARTED");

  const unitOnly = computeProjectHealthAndCoverage({
    unit: { totalTests: 10, passedTests: 10, failedTests: 0, coveragePct: 84 },
  });
  assert.equal(unitOnly.unifiedCoveragePct, 84);
  assert.equal(unitOnly.healthScore, 92);
  assert.equal(unitOnly.gateStatus, "PASSED");

  const untestedQuad = classifyRiskQuadrant({
    unifiedCoveragePct: null,
    passRatePct: null,
    gateStatus: "UNTESTED",
  });
  assert.equal(untestedQuad.quadrantId, "untested");
  assert.equal(untestedQuad.isUntested, true);

  assert.equal(PORTFOLIO_ROI_BASELINE.isHeuristicEstimate, true);
  assert.equal(/IEEE\s*829/i.test(PORTFOLIO_ROI_BASELINE.methodologyNote), false);
});
