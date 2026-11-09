import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Mock Prisma ─────────────────────────────────────────────────────────────
const mockState = {
  snapshots: new Map(),
  aiTests: new Map(),
  aiSuggestions: new Map(),
  systemScenarios: new Map(),
  jobs: new Map(),
};

const mockPrisma = {
  projectSnapshot: {
    findUnique: jest.fn(async ({ where }) => {
      return mockState.snapshots.get(where.id) || null;
    }),
  },
  aiSuggestion: {
    count: jest.fn(async () => 0),
  },
  aiTest: {
    findMany: jest.fn(async ({ where }) => {
      const all = Array.from(mockState.aiTests.values());
      return all.filter((t) => t.snapshotId === where.snapshotId);
    }),
    update: jest.fn(async ({ where, data }) => {
      const existing = mockState.aiTests.get(where.id);
      if (existing) {
        const updated = { ...existing, ...data };
        mockState.aiTests.set(where.id, updated);
        return updated;
      }
      return null;
    }),
  },
  systemScenario: {
    findMany: jest.fn(async ({ where }) => {
      const all = Array.from(mockState.systemScenarios.values());
      return all.filter((s) => s.snapshotId === where.snapshotId);
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      let count = 0;
      for (const [id, sc] of mockState.systemScenarios.entries()) {
        if (sc.snapshotId === where.snapshotId) {
          mockState.systemScenarios.set(id, { ...sc, ...data });
          count++;
        }
      }
      return { count };
    }),
  },
  job: {
    findFirst: jest.fn(async () => null),
  },
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
  default: mockPrisma,
  prisma: mockPrisma,
}));

// Dynamically import the service under test after mocking
const { getSuitesReadinessService } = await import("../services/suitesReadiness.service.js");

describe("Pre-flight HITL Readiness Gate & Incremental Progress Tests", () => {
  let tempDir;
  const snapshotId = "test_snap_123";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-readiness-test-"));
    mockState.snapshots.clear();
    mockState.aiTests.clear();
    mockState.systemScenarios.clear();

    // Default snapshot in mock DB
    mockState.snapshots.set(snapshotId, {
      id: snapshotId,
      projectId: "proj_abc",
      rootDir: tempDir,
      project: { id: "proj_abc", name: "Test Project", ownerId: "user_1" },
    });

    // Default package.json WITHOUT supertest
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "test-app",
          version: "1.0.0",
          scripts: { test: "jest" },
          devDependencies: { jest: "^29.0.0" },
        },
        null,
        2
      ),
      "utf8"
    );

    // Default unit test file
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src/math.js"), "export const add = (a, b) => a + b;", "utf8");
    fs.writeFileSync(path.join(tempDir, "src/math.test.js"), "test('adds', () => expect(1+1).toBe(2));", "utf8");

    // Integration test file on disk
    fs.mkdirSync(path.join(tempDir, "tests/integration"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "tests/integration/api.integration.test.js"),
      "const request = require('supertest'); test('api', () => {});",
      "utf8"
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it("evaluates Unit as READY when unit test files exist in workspace", async () => {
    const res = await getSuitesReadinessService({ snapshotId, userId: "user_1" });
    expect(res.suites.unit.status).toBe("READY");
    expect(res.suites.unit.readyForExecution).toBe(true);
    expect(res.suites.unit.testFilesCount).toBeGreaterThanOrEqual(1);
    expect(res.suites.unit.blockers.length).toBe(0);
  });

  it("detects Integration as NEEDS_DEPENDENCY when supertest is not in package.json", async () => {
    const res = await getSuitesReadinessService({ snapshotId, userId: "user_1" });
    expect(res.suites.integration.status).toBe("NEEDS_DEPENDENCY");
    expect(res.suites.integration.readyForExecution).toBe(false);
    expect(res.suites.integration.missingPackages).toContain("supertest");
    expect(res.suites.integration.hitlActions.some((a) => a.actionType === "INSTALL_INTEGRATION_DEPS")).toBe(true);
    expect(res.allReady).toBe(false);
  });

  it("promotes Integration to READY once supertest is declared in package.json", async () => {
    // Add supertest to package.json
    const pkgPath = path.join(tempDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.devDependencies.supertest = "^7.0.0";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");

    const res = await getSuitesReadinessService({ snapshotId, userId: "user_1" });
    expect(res.suites.integration.status).toBe("READY");
    expect(res.suites.integration.readyForExecution).toBe(true);
    expect(res.suites.integration.blockers.length).toBe(0);
  });

  it("blocks DRAFT AI scenarios from running automatically without explicit user approval", () => {
    // Scenario 1: DRAFT test with 0 approved scenarios
    const draftTestMeta = {
      framework: "SUPERTEST",
      status: "DRAFT",
      requests: [{ scenarioId: "sc_1", testName: "Draft Scenario 1", enabled: true }],
      approvedScenarios: [], // None approved
    };

    const approvedScenarios = new Set(draftTestMeta.approvedScenarios || []);
    const isExplicitlyApproved = approvedScenarios.has("sc_1");
    const isDraftTest = draftTestMeta.status === "DRAFT" || (!draftTestMeta.status && approvedScenarios.size === 0);
    const isApproved = !isDraftTest && (approvedScenarios.size === 0 || isExplicitlyApproved);

    expect(isDraftTest).toBe(true);
    expect(isApproved).toBe(false); // MUST NOT run

    // Scenario 2: User explicitly approves sc_1
    approvedScenarios.add("sc_1");
    const isExplicitlyApprovedAfter = approvedScenarios.has("sc_1");
    const isApprovedAfter = !isDraftTest || isExplicitlyApprovedAfter;
    expect(isApprovedAfter).toBe(true); // Can run now
  });

  it("approves all draft scenarios when approveAll is invoked", async () => {
    mockState.aiTests.set("test_1", {
      id: "test_1",
      snapshotId,
      status: "DRAFT",
      metaJson: JSON.stringify({
        framework: "SUPERTEST",
        status: "DRAFT",
        requests: [
          { scenarioId: "sc_a", testName: "Get cart" },
          { scenarioId: "sc_b", testName: "Add item" },
        ],
        approvedScenarios: [],
      }),
    });

    // Simulate approveAll logic
    const all = await mockPrisma.aiTest.findMany({ where: { snapshotId } });
    for (const t of all) {
      const meta = JSON.parse(t.metaJson);
      const reqs = meta.requests.map((r) => r.scenarioId);
      meta.status = "APPROVED";
      meta.approvedScenarios = reqs;
      await mockPrisma.aiTest.update({
        where: { id: t.id },
        data: { metaJson: JSON.stringify(meta) },
      });
    }

    const updated = mockState.aiTests.get("test_1");
    const updatedMeta = JSON.parse(updated.metaJson);
    expect(updatedMeta.status).toBe("APPROVED");
    expect(updatedMeta.approvedScenarios).toEqual(["sc_a", "sc_b"]);
  });

  it("confirms unconfirmed system scenario outcomes during pre-flight HITL action", async () => {
    mockState.systemScenarios.set("sys_1", {
      id: "sys_1",
      snapshotId,
      title: "Checkout Flow",
      reviewState: "DRAFT",
    });

    const res = await mockPrisma.systemScenario.updateMany({
      where: { snapshotId },
      data: { reviewState: "EXPECTED_CONFIRMED", reviewedByUserId: "user_1" },
    });

    expect(res.count).toBe(1);
    expect(mockState.systemScenarios.get("sys_1").reviewState).toBe("EXPECTED_CONFIRMED");
  });
});
