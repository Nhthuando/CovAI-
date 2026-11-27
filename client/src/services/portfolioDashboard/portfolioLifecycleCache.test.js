import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLifecycleStatusToPortfolioCache,
  applyLifecycleStatusToProjectsList,
  applyProjectPatchToPortfolioCache,
  applyProjectPatchToProjectsList,
} from "./portfolioLifecycleCache.js";

test("applyLifecycleStatusToPortfolioCache updates DOING -> COMPLETED immutably and clears stale server KPI aggregates", () => {
  const original = {
    activeProjectsCount: 2,
    activeKpis: { totalProjects: 2 },
    analytics: { benchmarkItems: [1, 2] },
    timeRoiAnalytics: { totalQaHoursSaved: 4 },
    lifecycleCounts: { DOING: 2 },
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
  assert.equal(next.activeKpis, null);
  assert.equal(next.analytics, null);
  assert.equal(next.timeRoiAnalytics, null);
  assert.equal(next.lifecycleCounts, null);
  assert.equal(next.activeProjectsCount, undefined);
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

test("applyProjectPatchToPortfolioCache updates isPinned without discarding lifecycleStatus or server KPIs when only pin changes", () => {
  const original = {
    activeKpis: { totalProjects: 1 },
    projects: [
      { id: "p1", lifecycleStatus: "DOING", isPinned: false, isExcludedFromActiveKpis: false },
    ],
  };

  const pinned = applyProjectPatchToPortfolioCache(original, "p1", { isPinned: true });
  assert.equal(pinned.projects[0].isPinned, true);
  assert.equal(pinned.projects[0].lifecycleStatus, "DOING");
  assert.deepEqual(pinned.activeKpis, { totalProjects: 1 });

  const both = applyProjectPatchToPortfolioCache(original, "p1", {
    lifecycleStatus: "PAUSED",
    isPinned: true,
  });
  assert.equal(both.projects[0].lifecycleStatus, "PAUSED");
  assert.equal(both.projects[0].isExcludedFromActiveKpis, true);
  assert.equal(both.projects[0].isPinned, true);
  assert.equal(both.activeKpis, null);
});

test("applyLifecycleStatusToPortfolioCache updates nested { data: { projects } } cache shape", () => {
  const original = {
    success: true,
    data: {
      activeKpis: { totalProjects: 0 },
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
  assert.equal(next.data.activeKpis, null);
});

test("applyLifecycleStatusToPortfolioCache returns original reference on unmatched id or null cache", () => {
  const original = { projects: [{ id: "p1", lifecycleStatus: "DOING" }] };
  assert.equal(applyLifecycleStatusToPortfolioCache(original, "missing", "COMPLETED"), original);
  assert.equal(applyLifecycleStatusToPortfolioCache(null, "p1", "COMPLETED"), null);
  assert.equal(applyLifecycleStatusToPortfolioCache(undefined, "p1", "COMPLETED"), undefined);
});

test("applyLifecycleStatusToProjectsList & applyProjectPatchToProjectsList handle array and wrapped shapes", () => {
  const list = [
    { id: "p1", lifecycleStatus: "DOING", isExcludedFromActiveKpis: false, isPinned: false },
    { id: "p2", lifecycleStatus: "NOT_STARTED", isExcludedFromActiveKpis: true, isPinned: false },
  ];

  const updated = applyLifecycleStatusToProjectsList(list, "p2", "CANCELLED");
  assert.notEqual(updated, list);
  assert.equal(list[1].lifecycleStatus, "NOT_STARTED");
  assert.equal(updated[1].lifecycleStatus, "CANCELLED");
  assert.equal(updated[1].isExcludedFromActiveKpis, true);

  const wrappedUpdated = applyProjectPatchToProjectsList({ projects: list }, "p1", {
    isPinned: true,
  });
  assert.equal(wrappedUpdated.projects[0].isPinned, true);
  assert.equal(wrappedUpdated.projects[0].lifecycleStatus, "DOING");

  assert.equal(applyLifecycleStatusToProjectsList(list, "none", "DOING"), list);
  assert.equal(applyLifecycleStatusToProjectsList(null, "p1", "DOING"), null);
});
