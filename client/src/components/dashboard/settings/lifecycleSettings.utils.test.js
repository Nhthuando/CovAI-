import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldShowTopbarLifecycleBadge,
  resolveProjectHasActivity,
  resolveLifecycleEditorState,
  formatLifecycleMutationError,
} from "./lifecycleSettings.utils.js";

test("shouldShowTopbarLifecycleBadge shows static warning pill only for isolated states", () => {
  assert.equal(shouldShowTopbarLifecycleBadge("PAUSED"), true);
  assert.equal(shouldShowTopbarLifecycleBadge("COMPLETED"), true);
  assert.equal(shouldShowTopbarLifecycleBadge("CANCELLED"), true);
  assert.equal(shouldShowTopbarLifecycleBadge("DOING"), false);
  assert.equal(shouldShowTopbarLifecycleBadge("NOT_STARTED"), false);
  assert.equal(shouldShowTopbarLifecycleBadge(null), false);
});

test("resolveLifecycleEditorState enforces OWNER-only RBAC and blocks NOT_STARTED revert when activity exists", () => {
  // 1. OWNER without activity can pick any of the 5 lifecycle states
  const ownerFresh = resolveLifecycleEditorState({
    currentStatus: "DOING",
    currentUserRole: "OWNER",
    hasActivity: false,
  });
  assert.equal(ownerFresh.canEdit, true);
  assert.equal(ownerFresh.readOnlyReason, null);
  assert.equal(ownerFresh.options.every((o) => !o.disabled), true);

  // 2. OWNER with activity cannot revert to NOT_STARTED
  const ownerActive = resolveLifecycleEditorState({
    currentStatus: "DOING",
    currentUserRole: "OWNER",
    hasActivity: true,
  });
  assert.equal(ownerActive.canEdit, true);
  const notStartedOpt = ownerActive.options.find((o) => o.value === "NOT_STARTED");
  assert.equal(notStartedOpt.disabled, true);
  assert.equal(notStartedOpt.validationCode, "CANNOT_REVERT_TO_NOT_STARTED");
  assert.match(notStartedOpt.disabledReason, /Paused or Completed/i);
  assert.equal(ownerActive.options.find((o) => o.value === "PAUSED").disabled, false);
  assert.equal(ownerActive.options.find((o) => o.value === "COMPLETED").disabled, false);

  // 3. EDITOR & VIEWER get read-only options
  for (const role of ["EDITOR", "VIEWER"]) {
    const memberState = resolveLifecycleEditorState({
      currentStatus: "DOING",
      currentUserRole: role,
      hasActivity: false,
    });
    assert.equal(memberState.canEdit, false);
    assert.match(memberState.readOnlyReason, /owner/i);
    assert.equal(memberState.options.every((o) => o.disabled), true);
  }
});

test("resolveProjectHasActivity inspects hasLifecycleActivity, pillars, gateStatus, and summary", () => {
  assert.equal(resolveProjectHasActivity({ hasLifecycleActivity: true }), true);
  assert.equal(
    resolveProjectHasActivity({ pillars: { unit: { totalTests: 5 } } }),
    true,
  );
  assert.equal(
    resolveProjectHasActivity({ gateStatus: "PASSED" }),
    true,
  );
  assert.equal(
    resolveProjectHasActivity({ gateStatus: "UNTESTED" }, { totalTests: 2 }),
    true,
  );
  assert.equal(
    resolveProjectHasActivity({
      gateStatus: "UNTESTED",
      healthScore: null,
      pillars: { unit: { totalTests: 0 } },
    }),
    false,
  );
});

test("formatLifecycleMutationError formats 409 CANNOT_REVERT_TO_NOT_STARTED and 403 nicely", () => {
  const revertErr = formatLifecycleMutationError({
    status: 409,
    code: "CANNOT_REVERT_TO_NOT_STARTED",
  });
  assert.match(revertErr, /Not Started/i);
  assert.match(revertErr, /Paused or Completed/i);

  const forbiddenErr = formatLifecycleMutationError({ status: 403 });
  assert.match(forbiddenErr, /Owner/i);
});
