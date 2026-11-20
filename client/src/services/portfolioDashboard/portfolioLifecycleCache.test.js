import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLifecycleStatusToPortfolioCache,
  applyLifecycleStatusToProjectsList,
} from "./portfolioLifecycleCache.js";

test("applyLifecycleStatusToPortfolioCache updates flat cache DOING -> COMPLETED immutably", () => {
  const original = {
    projects: [
      { id: "p1", name: "Alpha", lifecycleStatus: "DOING", isExcludedFromActiveKpis: false },
      { id: "p2", name: "Beta", lifecycleStatus: "DOING", isExcludedFromActiveKpis: false },
    ],
  };

  const next = applyLifecycleStatusToPortfolioCache(original, "p1", "COMPLETED");

  assert.notEqual(next, original);
  assert.equal(original.projects[0].lifecycleStatus, "DOING");
  assert.equal(original.projects[0].isExcludedFromActiveKpis, false);
  assert.equal(next.projects[0].lifecycleStatus, "COMPLETED");
  assert.equal(next.projects[0].isExcludedFromActiveKpis, true);
  assert.equal(typeof next.projects[0].lifecycleUpdatedAt, "string");
  assert.equal(next.projects[1], original.projects[1]);
});

test("applyLifecycleStatusToPortfolioCache updates flat cache COMPLETED -> DOING", () => {
  const original = {
    projects: [
      { id: "p1", lifecycleStatus: "COMPLETED", isExcludedFromActiveKpis: true },
    ],
  };

  const next = applyLifecycleStatusToPortfolioCache(original, "p1", "DOING");
  assert.equal(next.projects[0].lifecycleStatus, "DOING");
  assert.equal(next.projects[0].isExcludedFromActiveKpis, false);
});

test("applyLifecycleStatusToPortfolioCache updates nested { data: { projects } } cache shape", () => {
  const original = {
    success: true,
    data: {
      projects: [
        { id: "p1", lifecycleStatus: "NOT_STARTED", isExcludedFromActiveKpis: true },
      ],
    },
  };

  const next = applyLifecycleStatusToPortfolioCache(original, "p1", "PAUSED");
  assert.notEqual(next, original);
  assert.equal(original.data.projects[0].lifecycleStatus, "NOT_STARTED");
  assert.equal(next.data.projects[0].lifecycleStatus, "PAUSED");
  assert.equal(next.data.projects[0].isExcludedFromActiveKpis, true);
});

test("applyLifecycleStatusToPortfolioCache returns original reference on unmatched id or null cache", () => {
  const original = { projects: [{ id: "p1", lifecycleStatus: "DOING" }] };
  assert.equal(applyLifecycleStatusToPortfolioCache(original, "missing", "COMPLETED"), original);
  assert.equal(applyLifecycleStatusToPortfolioCache(null, "p1", "COMPLETED"), null);
  assert.equal(applyLifecycleStatusToPortfolioCache(undefined, "p1", "COMPLETED"), undefined);
});

test("applyLifecycleStatusToProjectsList updates matching array item and ignores non-array input", () => {
  const list = [
    { id: "p1", lifecycleStatus: "DOING", isExcludedFromActiveKpis: false },
    { id: "p2", lifecycleStatus: "NOT_STARTED", isExcludedFromActiveKpis: true },
  ];

  const updated = applyLifecycleStatusToProjectsList(list, "p2", "CANCELLED");
  assert.notEqual(updated, list);
  assert.equal(list[1].lifecycleStatus, "NOT_STARTED");
  assert.equal(updated[1].lifecycleStatus, "CANCELLED");
  assert.equal(updated[1].isExcludedFromActiveKpis, true);

  assert.equal(applyLifecycleStatusToProjectsList(list, "none", "DOING"), list);
  assert.equal(applyLifecycleStatusToProjectsList(null, "p1", "DOING"), null);
});
