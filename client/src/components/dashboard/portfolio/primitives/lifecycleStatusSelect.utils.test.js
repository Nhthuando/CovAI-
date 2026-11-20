import test from "node:test";
import assert from "node:assert/strict";
import {
  LIFECYCLE_MENU_WIDTH,
  LIFECYCLE_MENU_ESTIMATED_HEIGHT,
  VIEWPORT_EDGE_MARGIN,
  MENU_OFFSET,
  isExcludedLifecycleStatus,
  computeLifecycleMenuPosition,
  formatLifecycleUpdateToast,
} from "./lifecycleStatusSelect.utils.js";

test("computeLifecycleMenuPosition places right-aligned menu below trigger in roomy viewport", () => {
  const pos = computeLifecycleMenuPosition(
    { top: 100, bottom: 124, left: 600, right: 700 },
    { width: 1280, height: 800 },
    { align: "right" },
  );

  assert.equal(pos.placement, "bottom");
  assert.equal(pos.top, 124 + MENU_OFFSET);
  assert.equal(pos.left, 700 - LIFECYCLE_MENU_WIDTH);
});

test("computeLifecycleMenuPosition clamps left-aligned menu near left edge", () => {
  const pos = computeLifecycleMenuPosition(
    { top: 50, bottom: 74, left: -12, right: 60 },
    { width: 1280, height: 800 },
    { align: "left" },
  );

  assert.equal(pos.placement, "bottom");
  assert.equal(pos.left, VIEWPORT_EDGE_MARGIN);
});

test("computeLifecycleMenuPosition clamps menu near right edge", () => {
  const pos = computeLifecycleMenuPosition(
    { top: 80, bottom: 104, left: 1200, right: 1275 },
    { width: 1280, height: 800 },
    { align: "left" },
  );

  assert.equal(pos.left, 1280 - LIFECYCLE_MENU_WIDTH - VIEWPORT_EDGE_MARGIN);
});

test("computeLifecycleMenuPosition flips above trigger when near bottom viewport edge", () => {
  const pos = computeLifecycleMenuPosition(
    { top: 720, bottom: 744, left: 400, right: 500 },
    { width: 1280, height: 800 },
    { align: "right" },
  );

  assert.equal(pos.placement, "top");
  assert.equal(pos.top, 720 - MENU_OFFSET - LIFECYCLE_MENU_ESTIMATED_HEIGHT);
});

test("isExcludedLifecycleStatus distinguishes active vs isolated lifecycle states", () => {
  assert.equal(isExcludedLifecycleStatus("COMPLETED"), true);
  assert.equal(isExcludedLifecycleStatus("PAUSED"), true);
  assert.equal(isExcludedLifecycleStatus("CANCELLED"), true);
  assert.equal(isExcludedLifecycleStatus("DOING"), false);
  assert.equal(isExcludedLifecycleStatus("NOT_STARTED"), false);
  assert.equal(isExcludedLifecycleStatus(null), false);
});

test("formatLifecycleUpdateToast reports Active KPI exclusion and inclusion clearly", () => {
  const completedToast = formatLifecycleUpdateToast("COMPLETED");
  assert.equal(completedToast.type, "info");
  assert.match(completedToast.title, /Completed/);
  assert.match(completedToast.message, /out of Active KPIs/);
  assert.match(completedToast.message, /Scope to Completed/);

  const doingToast = formatLifecycleUpdateToast("DOING");
  assert.equal(doingToast.type, "success");
  assert.match(doingToast.title, /Doing/);
  assert.match(doingToast.message, /included in Active Portfolio KPIs/);
});
