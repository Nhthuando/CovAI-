import test from "node:test";
import assert from "node:assert/strict";
import {
  GUIDANCE_TOURS,
  resolveTourKey,
} from "../components/dashboard/guidance/platformGuidanceData.js";
import {
  hasSeenTour,
  markTourSeen,
  resetGuidanceTours,
} from "../components/dashboard/guidance/guidanceStorage.js";

function createMemoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(i) {
      return Array.from(map.keys())[i] ?? null;
    },
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

test("GUIDANCE_TOURS defines valid selectors and detailed steps for all core tabs", () => {
  const requiredTours = [
    "portfolio",
    "explorer",
    "overview",
    "unit",
    "integration",
    "system",
    "trustworthiness",
    "architecture",
    "logic-analysis",
    "version-control",
    "jobs",
    "settings",
  ];

  for (const key of requiredTours) {
    const tour = GUIDANCE_TOURS[key];
    assert.ok(tour, `Missing tour: ${key}`);
    assert.ok(tour.label);
    assert.ok(Array.isArray(tour.steps) && tour.steps.length >= 1);
    for (const step of tour.steps) {
      assert.ok(step.id);
      assert.ok(step.selector);
      assert.ok(step.title);
      assert.ok(step.description);
    }
  }

  assert.ok(GUIDANCE_TOURS.unit.steps.length >= 5);
  assert.ok(GUIDANCE_TOURS.integration.steps.length >= 5);
  assert.ok(GUIDANCE_TOURS.system.steps.length >= 5);
  assert.ok(GUIDANCE_TOURS.trustworthiness.steps.length >= 4);
});

test("resolveTourKey resolves pages, coverage types, and activity tabs accurately", () => {
  assert.equal(resolveTourKey({ page: "portfolio" }), "portfolio");
  assert.equal(resolveTourKey({ activeActivity: "explorer" }), "explorer");
  assert.equal(resolveTourKey({ activeActivity: "overview" }), "overview");
  assert.equal(
    resolveTourKey({ activeActivity: "coverage", coverageType: "unit" }),
    "unit",
  );
  assert.equal(
    resolveTourKey({ activeActivity: "coverage", coverageType: "integration" }),
    "integration",
  );
  assert.equal(
    resolveTourKey({ activeActivity: "coverage", coverageType: "system" }),
    "system",
  );
  assert.equal(
    resolveTourKey({ activeActivity: "trustworthiness" }),
    "trustworthiness",
  );
  assert.equal(resolveTourKey({ showCFG: true }), "logic-analysis");
  assert.equal(
    resolveTourKey({ activeActivity: "version-control" }),
    "version-control",
  );
});

test("guidanceStorage tracks per-user per-tab tour completion and resets on login/logout", () => {
  const storage = createMemoryStorage();
  assert.equal(hasSeenTour("user_1", "unit", storage), false);

  markTourSeen("user_1", "unit", storage);
  assert.equal(hasSeenTour("user_1", "unit", storage), true);
  assert.equal(hasSeenTour("user_1", "integration", storage), false);
  assert.equal(hasSeenTour("user_2", "unit", storage), false);

  resetGuidanceTours(storage);
  assert.equal(hasSeenTour("user_1", "unit", storage), false);
});
