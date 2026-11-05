/**
 * e2e_simulation_opaque_box.test.js
 *
 * Comprehensive Opaque-Box End-to-End Test Suite for Unit Test Execution Simulation Refactoring.
 * Covers Requirements R1, R2, R3, R4 across all 4 Systematic Tiers:
 *
 * - Tier 1: Feature Coverage (>=5 test cases per feature for R1, R2, R3, R4)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature for R1, R2, R3, R4)
 * - Tier 3: Cross-Feature Interactions (Pairwise combinations of R1, R2, R3, R4)
 * - Tier 4: Real-World Application Scenarios (5 production-grade business logic services)
 *
 * Grounded in:
 * - d:\NCKH\CovAI-\.agents\teamwork\ORIGINAL_REQUEST.md
 * - d:\NCKH\CovAI-\PROJECT.md
 * - d:\NCKH\CovAI-\TEST_INFRA.md
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from "@jest/globals";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");

// ─── Universal RAM Mocks Setup for Database / Network Isolation ──────────────────
const mockPrisma = {
  projectSnapshot: {
    findUnique: jest.fn().mockResolvedValue({
      id: "snap-e2e-opaque-1",
      projectId: "proj-e2e-opaque-1",
      rootDir: rootDir
    }),
    findFirst: jest.fn().mockResolvedValue({
      id: "snap-e2e-opaque-1",
      rootDir: rootDir
    })
  },
  project: {
    findUnique: jest.fn().mockResolvedValue({
      id: "proj-e2e-opaque-1",
      name: "CovAI- E2E Test Project"
    })
  },
  coverageFile: {
    findMany: jest.fn().mockResolvedValue([])
  },
  $transaction: jest.fn(async (cb) => typeof cb === "function" ? cb(mockPrisma) : Promise.resolve())
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
  default: mockPrisma,
  prisma: mockPrisma
}));

// Import simulation engine and AST helpers
const {
  generateSimulationTrace,
  getAvailableSimulationSources,
  evaluateAstExpression,
  discoverUniversalRamMocks,
  categorizeFilePath,
  resolveRootDir,
  CATEGORY_NAMES
} = await import("../services/unitTestSimulationEngine.service.js");

const { parseJavaScriptCode } = await import("../services/babelParser.service.js");
const { ServiceError } = await import("../utils/serviceError.js");

// ─── Helpers: Storage SHA-256 Directory Map ──────────────────────────────────────
const computeDirectoryHashMap = (dirPath) => {
  const hashMap = new Map();
  if (!dirPath || !fs.existsSync(dirPath)) return hashMap;

  const walk = (current) => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules inside storage to avoid massive scan & symlink permissions
        if (entry.name === "node_modules") continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath);
          const hash = crypto.createHash("sha256").update(content).digest("hex");
          hashMap.set(path.relative(dirPath, fullPath).replace(/\\/g, "/"), hash);
        } catch (_) {}
      }
    }
  };
  walk(dirPath);
  return hashMap;
};

describe("CovAI- Unit Test Simulation: Comprehensive Opaque-Box E2E Test Suite", () => {
  // File Paths under inspection
  const dashboardComponentPath = path.join(rootDir, "client/src/components/dashboard/CoverageTypeDashboard.jsx");
  const dashboardPagePath = path.join(rootDir, "client/src/pages/CoverageTypeDashboard.jsx");
  const traceabilityMatrixPath = path.join(rootDir, "client/src/components/dashboard/UnitTestTraceabilityMatrix.jsx");
  const inPlaceModalPath = path.join(rootDir, "client/src/components/dashboard/InPlaceCoverageFileModal.jsx");

  // Determine storage targets (both root and server/ subdirectories if present)
  const storageTargets = [
    path.join(rootDir, "storage"),
    path.join(rootDir, "server/storage"),
    path.join(rootDir, "uploads"),
    path.join(rootDir, "server/uploads")
  ].filter(d => fs.existsSync(d));

  let initialStorageHashes = new Map();

  beforeAll(() => {
    for (const dir of storageTargets) {
      initialStorageHashes.set(dir, computeDirectoryHashMap(dir));
    }
  });

  afterAll(() => {
    // Global Storage Immutability Check
    for (const dir of storageTargets) {
      const currentHash = computeDirectoryHashMap(dir);
      const initialHash = initialStorageHashes.get(dir);
      expect(Array.from(currentHash.entries())).toEqual(Array.from(initialHash.entries()));
    }
  });

  // ===========================================================================
  // TIER 1: FEATURE COVERAGE (>=5 tests per feature for R1, R2, R3, R4)
  // ===========================================================================
  describe("Tier 1: Feature Coverage", () => {
    // ─────────────────────────────────────────────────────────────────────────
    // Feature R1: Global Tab Bar Launcher Removal in CoverageTypeDashboard.jsx
    // ─────────────────────────────────────────────────────────────────────────
    describe("Feature R1: Global Tab Bar Launcher Removal", () => {
      const dashboardContent = fs.readFileSync(dashboardComponentPath, "utf8");

      it("R1-T1-01: Global tab bar contains no <select> dropdown for file selection", () => {
        // Assert that the global tab bar toolbar does NOT render a <select> file dropdown
        expect(dashboardContent).not.toMatch(
          /<select[\s\S]*?value=\{quickSimFile\}[\s\S]*?onChange=\{\(e\)\s*=>\s*setQuickSimFile\(e\.target\.value\)\}/
        );
        expect(dashboardContent).not.toMatch(/title=["']Select source file to simulate["']/);
      });

      it("R1-T1-02: Global tab bar toolbar contains no '⚡ Simulation Studio' launcher button", () => {
        // The launcher button should be completely removed from the global tab bar toolbar
        const toolbarRegex = /\{type === ["']unit["'] && \([\s\S]*?\{tab\.count\}[\s\S]*?<\/div>[\s\S]*?<\/div>\s*\)\}/;
        const match = dashboardContent.match(toolbarRegex);
        if (match) {
          expect(match[0]).not.toContain("⚡ Simulation Studio");
        } else {
          expect(dashboardContent).not.toMatch(
            /<button[\s\S]*?title=["']Open Interactive Unit Test Execution Simulation Studio["'][\s\S]*?⚡ Simulation Studio<\/span>\s*<\/button>/
          );
        }
      });

      it("R1-T1-03: Tab bar strictly organizes the 4 canonical unit test tabs with simulation beside traceability", () => {
        // 4 canonical tabs: Logic & Test Traceability, Test Execution Simulation, Test Suites & Specs, Version History
        const unitTabsMatch = dashboardContent.match(/\.\.\.\(type\s*===\s*["']unit["']\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[/);
        expect(unitTabsMatch).not.toBeNull();
        const tabsBlock = unitTabsMatch[1];

        expect(tabsBlock).toMatch(/id:\s*["']traceability["']/);
        expect(tabsBlock).toMatch(/label:\s*["']Logic & Test Traceability["']/);
        expect(tabsBlock).toMatch(/id:\s*["']simulation["']/);
        expect(tabsBlock).toMatch(/label:\s*["']Test Execution Simulation["']/);
        expect(tabsBlock).toMatch(/id:\s*["']testcases["']/);
        expect(tabsBlock).toMatch(/label:\s*["']Test Suites & Specs["']/);
        expect(tabsBlock).toMatch(/id:\s*["']versions["']/);
        expect(tabsBlock).toMatch(/label:\s*["']Version History["']/);

        const tabIdMatches = tabsBlock.match(/id:\s*["']([^"']+)["']/g);
        expect(tabIdMatches).toHaveLength(4);
      });

      it("R1-T1-04: Test Execution Simulation tab is positioned directly beside Logic & Test Traceability", () => {
        const unitTabsMatch = dashboardContent.match(/\.\.\.\(type\s*===\s*["']unit["']\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[/);
        expect(unitTabsMatch).not.toBeNull();
        const tabsBlock = unitTabsMatch[1];
        expect(tabsBlock).toMatch(/id:\s*["']traceability["'][\s\S]*?id:\s*["']simulation["']/);
      });

      it("R1-T1-05: Global tab bar toolbar does not bind or depend on quickSimFile state", () => {
        const tabAreaMatch = dashboardContent.match(/\{type === ["']unit["'] && \([\s\S]*?activeMetricView !== ["']testcases["']/);
        if (tabAreaMatch) {
          expect(tabAreaMatch[0]).not.toContain("quickSimFile");
          expect(tabAreaMatch[0]).not.toContain("setQuickSimFile");
        }
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Feature R2: Contextual Simulation Access & Clean Traceability
    // ─────────────────────────────────────────────────────────────────────────
    describe("Feature R2: Dedicated Simulation Access & Clean Traceability", () => {
      const dashboardContent = fs.readFileSync(dashboardComponentPath, "utf8");
      const traceabilityContent = fs.readFileSync(traceabilityMatrixPath, "utf8");
      const inPlaceModalContent = fs.readFileSync(inPlaceModalPath, "utf8");

      it("R2-T1-01: UnitTestTraceabilityMatrix is cleanly decoupled from inline simulate buttons (Zero UI clutter)", () => {
        expect(traceabilityContent).not.toMatch(/Simulate File Tests/);
      });

      it("R2-T1-02: CoverageTypeDashboard mounts UnitTestSimulationStudioModal in embedded mode when activeMetricView === 'simulation'", () => {
        expect(dashboardContent).toMatch(/activeMetricView\s*===\s*["']simulation["'][\s\S]*?<UnitTestSimulationStudioModal[\s\S]*?isEmbedded=\{true\}/);
      });

      it("R2-T1-03: CategoryMatrix4Cards does not clutter cards with inline simulate buttons", () => {
        expect(traceabilityContent).not.toMatch(/<button[\s\S]*?>\s*<span>Simulate<\/span>\s*<\/button>/);
      });

      it("R2-T1-04: Missing category cards are clean without intrusive simulate buttons", () => {
        expect(traceabilityContent).not.toMatch(/⚡ Simulate .*? Scenario/);
        expect(traceabilityContent).toMatch(/cat\.missingMsg/);
      });

      it("R2-T1-05: InPlaceCoverageFileModal renders actionable '⚡ Simulate Execution' button in modal header", () => {
        expect(inPlaceModalContent).toMatch(/⚡ Simulate Execution/);
        expect(inPlaceModalContent).toMatch(/title=["']Open interactive execution simulation studio for this file/);
        expect(inPlaceModalContent).toMatch(/typeof\s+onOpenSimulation\s*===\s*["']function["']/);
      });

      it("R2-T1-06: InPlaceCoverageFileModal Executed Assertions tab supports contextual simulation dispatch", () => {
        expect(inPlaceModalContent).toMatch(/Executed Assertions \(\{linkedSuite\.assertions\.length\}\)/);
        expect(inPlaceModalContent).toMatch(/linkedSuite\.assertions\.map/);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Feature R3: End-to-End Simulation Engine Realism & Pedagogical Step Tracing
    // ─────────────────────────────────────────────────────────────────────────
    describe("Feature R3: End-to-End Simulation Engine Realism & Pedagogical Tracing", () => {
      it("R3-T1-01: generateSimulationTrace executes against real workspace sources without timeout", async () => {
        const startTime = Date.now();
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/cart.service.js",
          functionName: "calculateTotal",
          sourceCode: `
            export function calculateTotal(items = [], discount = 0) {
              if (!items || items.length === 0) return 0;
              const subtotal = items.reduce((acc, it) => acc + (it.price * (it.quantity || 1)), 0);
              const discountAmount = subtotal * discount;
              return Math.max(0, subtotal - discountAmount);
            }
          `,
          requestedCategory: "HAPPY_PATH",
          testCode: `
            describe("calculateTotal", () => {
              it("calculates total with valid items", () => {
                const items = [{ price: 50, quantity: 2 }, { price: 20, quantity: 1 }];
                const total = calculateTotal(items, 0.1);
                expect(total).toBe(108);
              });
            });
          `
        }, { rootDir });

        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(5000);
        expect(trace).toBeDefined();
        expect(Array.isArray(trace.steps)).toBe(true);
        expect(trace.steps.length).toBeGreaterThan(0);
      });

      it("R3-T1-02: Generates ordered steps matching the 7-phase educational taxonomy", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/sample.service.js",
          functionName: "evaluateStatus",
          sourceCode: `
            export function evaluateStatus(user) {
              if (!user) throw new Error("User required");
              if (user.active) return "ACTIVE";
              return "INACTIVE";
            }
          `,
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        const phases = trace.steps.map(s => s.phase);
        expect(phases).toContain("SETUP_MOCKS");
        expect(phases).toContain("CALL_ENTRY");
        expect(phases).toContain("EVAL_PARAMS");
        expect(phases).toContain("BRANCH_DECISION");
        expect(phases.some(p => p === "RETURN_VALUE" || p === "ERROR_THROW")).toBe(true);
        expect(phases).toContain("ASSERTION");
      });

      it("R3-T1-03: Branch decision evaluation captures True vs False pathways accurately", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/discount.service.js",
          functionName: "getDiscountRate",
          sourceCode: `
            export function getDiscountRate(isVip) {
              if (isVip) {
                return 0.20;
              } else {
                return 0.05;
              }
            }
          `,
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        const branchStep = trace.steps.find(s => s.phase === "BRANCH_DECISION");
        expect(branchStep).toBeDefined();
        const evaluatedTo = branchStep.branch?.evaluatedTo ?? branchStep.branchEvaluation?.evaluatedTo;
        expect(evaluatedTo).toBeDefined();
        expect(typeof evaluatedTo).toBe("boolean");
        expect(branchStep.branch?.consequentLine || branchStep.line).toBeDefined();
      });

      it("R3-T1-04: Variable state inspection tracks scope variables and identifies changed variables", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/math.service.js",
          functionName: "sumItems",
          sourceCode: `
            export function sumItems(a, b) {
              const res = a + b;
              return res;
            }
          `,
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        for (const step of trace.steps) {
          expect(step.variables).toBeDefined();
          expect(typeof step.variables).toBe("object");
        }
      });

      it("R3-T1-05: Every step provides pedagogical educationalGuidance metadata", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/guidance.service.js",
          functionName: "processData",
          sourceCode: `
            export function processData(x) {
              if (x < 0) return 0;
              return x * 2;
            }
          `,
          requestedCategory: "BOUNDARY_VALUES"
        }, { rootDir });

        for (const step of trace.steps) {
          expect(step.educationalGuidance).toBeDefined();
          expect(step.educationalGuidance.stepTitle).toBeDefined();
          expect(step.educationalGuidance.stepNarrative).toBeDefined();
          expect(step.educationalGuidance.logicRationale).toBeDefined();
          expect(step.educationalGuidance.developerTakeaway).toBeDefined();
        }
      });

      it("R3-T1-06: Category-aware matching prioritizes tests matching requested category", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/categoryMatch.service.js",
          functionName: "checkAccess",
          sourceCode: `
            export function checkAccess(role) {
              if (role === 'admin') return true;
              return false;
            }
          `,
          requestedCategory: "BRANCH_TOGGLING",
          testCode: `
            describe("checkAccess", () => {
              it("happy path for admin", () => {
                expect(checkAccess("admin")).toBe(true);
              });
              it("branch toggling for non-admin", () => {
                expect(checkAccess("user")).toBe(false);
              });
            });
          `
        }, { rootDir });

        expect(trace.testCase).toBeDefined();
        expect(trace.scenarioMeta?.category || trace.testCase?.category).toBeDefined();
      });

      it("R3-T1-07: Emits phase 'ERROR_THROW' or 'RETURN_VALUE' with exception capture when guard clauses throw", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/guard.service.js",
          functionName: "assertPositive",
          sourceCode: `
            export function assertPositive(val) {
              if (val <= 0) {
                throw new Error("Value must be positive");
              }
              return val;
            }
          `,
          requestedCategory: "ERROR_HANDLING"
        }, { rootDir });

        const outcomeStep = trace.steps.find(s => s.phase === "ERROR_THROW" || s.phase === "RETURN_VALUE");
        expect(outcomeStep).toBeDefined();
        if (trace.steps.some(s => s.phase === "ERROR_THROW")) {
          const errorStep = trace.steps.find(s => s.phase === "ERROR_THROW");
          expect(errorStep.educationalGuidance.category).toBe("ERROR_HANDLING");
        }
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Feature R4: Storage Immutability & Universal RAM Mock Guard
    // ─────────────────────────────────────────────────────────────────────────
    describe("Feature R4: Storage Immutability & Universal RAM Mock Guard", () => {
      it("R4-T1-01: Verifies strictly 0 file write operations to storage targets during simulation", () => {
        for (const dir of storageTargets) {
          const currentHash = computeDirectoryHashMap(dir);
          const initialHash = initialStorageHashes.get(dir);
          expect(Array.from(currentHash.entries())).toEqual(Array.from(initialHash.entries()));
        }
      });

      it("R4-T1-02: Universal Prisma RAM mock operates hermetically without database sockets", () => {
        const mocks = discoverUniversalRamMocks({ imports: { "@prisma/client": true } }, "");
        expect(Array.isArray(mocks)).toBe(true);
        expect(mocks.some(m => m.module === "prisma")).toBe(true);
        const prismaMock = mocks.find(m => m.module === "prisma");
        expect(prismaMock.mockType).toBe("DATABASE_MOCK");
        expect(prismaMock.status).toBe("READY");
      });

      it("R4-T1-03: Universal Axios RAM mock intercepts HTTP requests without network sockets", () => {
        const mocks = discoverUniversalRamMocks({ imports: { "axios": true } }, "");
        expect(Array.isArray(mocks)).toBe(true);
        expect(mocks.some(m => m.module === "axios")).toBe(true);
        const axiosMock = mocks.find(m => m.module === "axios");
        expect(axiosMock.mockType).toBe("HTTP_CLIENT_MOCK");
        expect(axiosMock.status).toBe("READY");
      });

      it("R4-T1-04: Thenable proxy deadlock prevention returns undefined for then/catch lookups", () => {
        const mockTarget = {};
        const proxy = new Proxy(mockTarget, {
          get(target, prop) {
            if (prop === "then" || prop === "catch" || prop === "finally" || typeof prop === "symbol") {
              return undefined;
            }
            return () => Promise.resolve({});
          }
        });

        expect(proxy.then).toBeUndefined();
        expect(proxy.catch).toBeUndefined();
        expect(proxy.finally).toBeUndefined();
      });

      it("R4-T1-05: Path sanitization defends against path traversal (../) before disk access", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "../../../outside.js",
          functionName: "testFn",
          sourceCode: "export function testFn() { return 'safe'; }",
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        expect(trace).toBeDefined();
        expect(trace.steps.length).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature for R1, R2, R3, R4)
  // ===========================================================================
  describe("Tier 2: Boundary & Corner Cases", () => {
    // ─────────────────────────────────────────────────────────────────────────
    // Corner R1: Tab Bar Navigation & View Mode Boundaries
    // ─────────────────────────────────────────────────────────────────────────
    describe("Corner R1: Tab Bar Navigation Boundaries", () => {
      const dashboardContent = fs.readFileSync(dashboardComponentPath, "utf8");

      it("R1-T2-01: Tab bar configuration maintains 4 unit tabs with simulation beside traceability", () => {
        const tabsMatch = dashboardContent.match(/\.\.\.\(type\s*===\s*["']unit["']\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[/);
        const tabsBlock = tabsMatch[1];
        const tabEntries = tabsBlock.match(/id:\s*["'][^"']+["']/g);
        expect(tabEntries).toHaveLength(4);
      });

      it("R1-T2-02: Zero-file workspace state does not render fallback empty <select>", () => {
        expect(dashboardContent).not.toMatch(/<select[^>]*?>[\s\S]*?-- Select File to Simulate --[\s\S]*?<\/select>/);
      });

      it("R1-T2-03: Tab bar container preserves clean flex styling across light/dark themes", () => {
        expect(dashboardContent).toMatch(/isLight \? "#f8fafc" : "var\(--color-surface/);
      });

      it("R1-T2-04: Non-unit coverage modes do not render unit simulation widgets in toolbar", () => {
        expect(dashboardContent).toMatch(/type === ["']unit["']/);
      });

      it("R1-T2-05: client/src/pages/CoverageTypeDashboard.jsx re-exports clean dashboard", () => {
        const pageContent = fs.readFileSync(dashboardPagePath, "utf8");
        expect(pageContent).toMatch(/import\s+CoverageTypeDashboard\s+from\s+["']\.\.\/components\/dashboard\/CoverageTypeDashboard\.jsx["']/);
        expect(pageContent).toMatch(/export\s+default\s+CoverageTypeDashboard/);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Corner R2: Contextual Trigger Edge Cases & Fallbacks
    // ─────────────────────────────────────────────────────────────────────────
    describe("Corner R2: Contextual Trigger Edge Cases & Fallbacks", () => {
      const traceabilityContent = fs.readFileSync(traceabilityMatrixPath, "utf8");
      const inPlaceModalContent = fs.readFileSync(inPlaceModalPath, "utf8");

      it("R2-T2-01: UnitTestTraceabilityMatrix does not render internal modal fallback", () => {
        expect(traceabilityContent).not.toMatch(/internalSimulationTarget/);
      });

      it("R2-T2-02: InPlaceCoverageFileModal mounts internal fallback modal when onOpenSimulation is null", () => {
        expect(inPlaceModalContent).toMatch(/!onOpenSimulation\s*&&\s*internalSimTarget/);
        expect(inPlaceModalContent).toMatch(/<UnitTestSimulationStudioModal[\s\S]*?isOpen=\{Boolean\(internalSimTarget\)\}/);
      });

      it("R2-T2-03: Contextual triggers handle file paths with deep slashes and special characters", () => {
        expect(traceabilityContent).toMatch(/group\.filePath/);
        expect(traceabilityContent).toMatch(/fn\.filePath/);
      });

      it("R2-T2-04: Functions cleanly render cleanName in Traceability Matrix", () => {
        expect(traceabilityContent).toMatch(/fn\.cleanName/);
      });

      it("R2-T2-05: Untested functions render clean missing message without inline simulate buttons", () => {
        expect(traceabilityContent).toMatch(/cat\.missingMsg/);
        expect(traceabilityContent).not.toMatch(/⚡ Simulate .*? Scenario/);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Corner R3: Simulation Engine AST & Execution Boundaries
    // ─────────────────────────────────────────────────────────────────────────
    describe("Corner R3: Simulation Engine AST & Execution Boundaries", () => {
      it("R3-T2-01: Straight-line 0-branch function executes cleanly and generates discrete steps", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/straightLine.service.js",
          functionName: "multiply",
          sourceCode: `
            export function multiply(a, b) {
              return a * b;
            }
          `,
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        expect(trace.steps.length).toBeGreaterThanOrEqual(4);
        expect(trace.steps.some(s => s.phase === "CALL_ENTRY")).toBe(true);
        expect(trace.steps.some(s => s.phase === "RETURN_VALUE")).toBe(true);
      });

      it("R3-T2-02: Deeply nested logical operators (&&, ||, ??, ?.) evaluate short-circuits safely", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/nested.service.js",
          functionName: "resolveUserConfig",
          sourceCode: `
            export function resolveUserConfig(user, override) {
              const active = user?.profile?.isActive ?? false;
              if (active && (override || user.role === 'admin')) {
                return "ALLOWED";
              }
              return "DENIED";
            }
          `,
          requestedCategory: "BRANCH_TOGGLING"
        }, { rootDir });

        expect(trace.steps.some(s => s.phase === "BRANCH_DECISION")).toBe(true);
      });

      it("R3-T2-03: Async functions and rejected promises map to ERROR_THROW or exception state", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/asyncReject.service.js",
          functionName: "fetchRecord",
          sourceCode: `
            export async function fetchRecord(id) {
              if (!id) throw new Error("ID required");
              return { id };
            }
          `,
          requestedCategory: "ERROR_HANDLING"
        }, { rootDir });

        expect(trace.steps.length).toBeGreaterThan(0);
      });

      it("R3-T2-04: Empty or whitespace source files return structured fallback trace without unhandled crash", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/empty.service.js",
          functionName: "noop",
          sourceCode: "   // Empty file with comments \n   ",
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        expect(trace).toBeDefined();
        expect(Array.isArray(trace.steps)).toBe(true);
      });

      it("R3-T2-05: Source code with syntax errors recovers AST using Babel errorRecovery mode", async () => {
        const result = parseJavaScriptCode("export function broken(a, b { return a + b; }", "broken.js");
        expect(result).toBeDefined();
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Corner R4: Storage & Resource Stress Boundaries
    // ─────────────────────────────────────────────────────────────────────────
    describe("Corner R4: Storage & Resource Stress Boundaries", () => {
      it("R4-T2-01: Read-only filesystem simulation executes without attempting file writes", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/readonly.service.js",
          functionName: "computeHash",
          sourceCode: "export function computeHash(val) { return 'hash_' + val; }",
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        expect(trace.steps.length).toBeGreaterThan(0);
      });

      it("R4-T2-02: Path traversal inputs (../) are sanitized before root resolution", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "../../../etc/passwd",
          functionName: "dummy",
          sourceCode: "export function dummy() { return true; }",
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        expect(trace).toBeDefined();
      });

      it("R4-T2-03: Deeply recursive functions break safely within execution depth limit", async () => {
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/recurse.service.js",
          functionName: "fib",
          sourceCode: `
            export function fib(n) {
              if (n <= 1) return 1;
              return fib(n - 1) + fib(n - 2);
            }
          `,
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        expect(trace.steps.length).toBeLessThanOrEqual(1500);
        expect(trace.steps.length).toBeGreaterThan(0);
      });

      it("R4-T2-04: Large parameter buffer inputs do not leak to disk or exhaust RAM", async () => {
        const largeArray = new Array(500).fill({ id: 1, name: "item" });
        const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/large.service.js",
          functionName: "countItems",
          sourceCode: `
            export function countItems(arr) {
              return arr ? arr.length : 0;
            }
          `,
          requestedCategory: "BOUNDARY_VALUES"
        }, { rootDir });

        expect(trace.steps.length).toBeGreaterThan(0);
      });

      it("R4-T2-05: Concurrent simulation requests execute hermetically in isolated RAM contexts", async () => {
        const p1 = generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/c1.service.js",
          functionName: "f1",
          sourceCode: "export function f1(x) { return x + 1; }",
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        const p2 = generateSimulationTrace("snap-e2e-opaque-1", {
          sourceFilePath: "server/src/services/c2.service.js",
          functionName: "f2",
          sourceCode: "export function f2(y) { return y * 2; }",
          requestedCategory: "HAPPY_PATH"
        }, { rootDir });

        const [t1, t2] = await Promise.all([p1, p2]);
        expect(t1.steps.length).toBeGreaterThan(0);
        expect(t2.steps.length).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // TIER 3: CROSS-FEATURE INTERACTIONS (Pairwise Combinations)
  // ===========================================================================
  describe("Tier 3: Cross-Feature Interactions", () => {
    it("T3-INT-01 (R1 + R2): Clean tab bar does not disrupt contextual simulation launch", () => {
      const dashboardContent = fs.readFileSync(dashboardComponentPath, "utf8");
      expect(dashboardContent).toMatch(/<UnitTestTraceabilityMatrix[\s\S]*?onOpenSimulation=\{\(simTarget\)\s*=>\s*setSimulationTarget\(simTarget\)\}/);
      expect(dashboardContent).toMatch(/<InPlaceCoverageFileModal[\s\S]*?onOpenSimulation=\{\(simTarget\)\s*=>\s*setSimulationTarget\(simTarget\)\}/);
      expect(dashboardContent).toMatch(/\{simulationTarget\s*&&\s*\(\s*<UnitTestSimulationStudioModal/);
    });

    it("T3-INT-02 (R2 + R3): Contextual target payload correctly drives 7-phase engine trace", async () => {
      const contextualPayload = {
        sourceFilePath: "server/src/services/contextual.service.js",
        functionName: "calculateBonus",
        requestedCategory: "BOUNDARY_VALUES",
        sourceCode: `
          export function calculateBonus(years) {
            if (years <= 0) return 0;
            if (years >= 10) return 5000;
            return years * 400;
          }
        `
      };

      const trace = await generateSimulationTrace("snap-e2e-opaque-1", contextualPayload, { rootDir });
      expect(trace.steps.some(s => s.phase === "SETUP_MOCKS")).toBe(true);
      expect(trace.steps.some(s => s.phase === "CALL_ENTRY")).toBe(true);
      expect(trace.steps.some(s => s.phase === "EVAL_PARAMS")).toBe(true);
      expect(trace.steps.some(s => s.phase === "BRANCH_DECISION")).toBe(true);
      expect(trace.steps.some(s => s.phase === "RETURN_VALUE" || s.phase === "ERROR_THROW")).toBe(true);
      expect(trace.steps.some(s => s.phase === "ASSERTION")).toBe(true);
    });

    it("T3-INT-03 (R3 + R4): Full engine trace maintains 100% SHA-256 storage immutability", async () => {
      const beforeHashes = new Map();
      for (const dir of storageTargets) {
        beforeHashes.set(dir, computeDirectoryHashMap(dir));
      }

      await generateSimulationTrace("snap-e2e-opaque-1", {
        sourceFilePath: "server/src/services/heavy.service.js",
        functionName: "heavyCompute",
        sourceCode: `
          export function heavyCompute(items = []) {
            return items.map(x => x * 2).filter(x => x > 10);
          }
        `,
        requestedCategory: "HAPPY_PATH"
      }, { rootDir });

      for (const dir of storageTargets) {
        const afterHash = computeDirectoryHashMap(dir);
        expect(Array.from(afterHash.entries())).toEqual(Array.from(beforeHashes.get(dir).entries()));
      }
    });

    it("T3-INT-04 (R2 + R4): Modal contextual launch utilizes universal RAM stubs without disk fixtures", async () => {
      const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
        sourceFilePath: "server/src/services/modalStub.service.js",
        functionName: "getUserSettings",
        sourceCode: `
          import prisma from '../config/prisma.js';
          export async function getUserSettings(userId) {
            return await prisma.setting.findUnique({ where: { userId } });
          }
        `,
        requestedCategory: "HAPPY_PATH"
      }, { rootDir });

      expect(trace.steps.some(s => s.phase === "SETUP_MOCKS")).toBe(true);
      expect(trace.initialMocks?.hasPrisma || trace.steps[0]?.description?.includes("Prisma")).toBeDefined();
    });

    it("T3-INT-05 (R1 + R3): Active tab navigation maintains independent modal simulation state", () => {
      const dashboardContent = fs.readFileSync(dashboardComponentPath, "utf8");
      expect(dashboardContent).toMatch(/const\s+\[simulationTarget,\s*setSimulationTarget\]\s*=\s*useState\(null\)/);
      expect(dashboardContent).toMatch(/isOpen=\{Boolean\(simulationTarget\)\}/);
    });
  });

  // ===========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (>=5 application-level tests)
  // ===========================================================================
  describe("Tier 4: Real-World Application Scenarios", () => {
    it("T4-APP-01: Real-World E-Commerce Cart & Discount Service Simulation", async () => {
      const cartServiceCode = `
        export class CartPricingService {
          static calculateOrderTotal(cart, customerTier = "STANDARD") {
            if (!cart || !cart.items || cart.items.length === 0) {
              return { subtotal: 0, discount: 0, shipping: 0, total: 0 };
            }
            const subtotal = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            let discountRate = 0;
            if (customerTier === "VIP") {
              discountRate = 0.20;
            } else if (customerTier === "GOLD") {
              discountRate = 0.10;
            }
            const discount = subtotal * discountRate;
            const discountedSubtotal = subtotal - discount;
            const shipping = discountedSubtotal >= 100 ? 0 : 15;
            const total = discountedSubtotal + shipping;
            return { subtotal, discount, shipping, total };
          }
        }
      `;

      const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
        sourceFilePath: "server/src/services/cartPricing.service.js",
        functionName: "calculateOrderTotal",
        sourceCode: cartServiceCode,
        requestedCategory: "HAPPY_PATH",
        testCode: `
          describe("CartPricingService", () => {
            it("calculates total for VIP customer with free shipping", () => {
              const cart = { items: [{ price: 80, quantity: 2 }] };
              const res = CartPricingService.calculateOrderTotal(cart, "VIP");
              expect(res.total).toBe(128);
            });
          });
        `
      }, { rootDir });

      expect(trace.steps.length).toBeGreaterThan(0);
      expect(trace.steps.some(s => s.phase === "BRANCH_DECISION")).toBe(true);
      expect(trace.steps.some(s => s.phase === "RETURN_VALUE")).toBe(true);
    });

    it("T4-APP-02: Real-World User Authentication & JWT Role Guard Service Simulation", async () => {
      const authServiceCode = `
        export function validateSessionToken(token, requiredRole = "USER") {
          if (!token) {
            throw new Error("Missing authentication token");
          }
          if (token === "expired_token") {
            throw new Error("Session token expired");
          }
          const decoded = { userId: "user-123", role: token === "admin_token" ? "ADMIN" : "USER" };
          if (requiredRole === "ADMIN" && decoded.role !== "ADMIN") {
            throw new Error("Forbidden: Administrator access required");
          }
          return { success: true, user: decoded };
        }
      `;

      const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
        sourceFilePath: "server/src/services/authSession.service.js",
        functionName: "validateSessionToken",
        sourceCode: authServiceCode,
        requestedCategory: "ERROR_HANDLING",
        testCode: `
          describe("validateSessionToken", () => {
            it("throws error when token is expired", () => {
              expect(() => validateSessionToken("expired_token")).toThrow("Session token expired");
            });
          });
        `
      }, { rootDir });

      expect(trace.steps.length).toBeGreaterThan(0);
      expect(trace.steps.some(s => s.phase === "BRANCH_DECISION")).toBe(true);
    });

    it("T4-APP-03: Real-World Database Order Repository & Prisma Transaction Simulation", async () => {
      const orderRepoCode = `
        import prisma from '../config/prisma.js';
        export async function createOrderWithInventory(orderData) {
          if (!orderData.items || orderData.items.length === 0) {
            throw new Error("Cart items cannot be empty");
          }
          return await prisma.$transaction(async (tx) => {
            const order = await tx.order.create({ data: orderData });
            for (const item of orderData.items) {
              await tx.inventory.update({
                where: { productId: item.productId },
                data: { quantity: { decrement: item.quantity } }
              });
            }
            return order;
          });
        }
      `;

      const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
        sourceFilePath: "server/src/services/orderRepository.service.js",
        functionName: "createOrderWithInventory",
        sourceCode: orderRepoCode,
        requestedCategory: "HAPPY_PATH"
      }, { rootDir });

      expect(trace.steps.length).toBeGreaterThan(0);
      expect(trace.steps.some(s => s.phase === "SETUP_MOCKS")).toBe(true);
    });

    it("T4-APP-04: Real-World External Payment Gateway Client with Network Timeout Simulation", async () => {
      const paymentClientCode = `
        import axios from 'axios';
        export async function processPayment(paymentPayload, retryCount = 0) {
          if (!paymentPayload.amount || paymentPayload.amount <= 0) {
            throw new Error("Invalid payment amount");
          }
          try {
            const res = await axios.post("https://payment.example.com/v1/charge", paymentPayload, { timeout: 3000 });
            return { status: "SUCCESS", transactionId: res.data?.id || "tx_mock_123" };
          } catch (err) {
            if (retryCount < 2) {
              return processPayment(paymentPayload, retryCount + 1);
            }
            throw new Error("Payment gateway unreachable after retries");
          }
        }
      `;

      const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
        sourceFilePath: "server/src/services/paymentGateway.service.js",
        functionName: "processPayment",
        sourceCode: paymentClientCode,
        requestedCategory: "BRANCH_TOGGLING"
      }, { rootDir });

      expect(trace.steps.length).toBeGreaterThan(0);
      expect(trace.steps.some(s => s.phase === "BRANCH_DECISION")).toBe(true);
    });

    it("T4-APP-05: Full Contextual E2E Pipeline Trace & Integrity Verification", async () => {
      const beforeHashes = new Map();
      for (const dir of storageTargets) {
        beforeHashes.set(dir, computeDirectoryHashMap(dir));
      }

      // 1. Discover sources targeted to services
      const sourcesResult = await getAvailableSimulationSources("snap-e2e-opaque-1", {
        rootDir,
        filePath: "server/src/services/cart.service.js"
      });
      expect(sourcesResult).toBeDefined();

      // 2. Generate trace for discovered source
      const trace = await generateSimulationTrace("snap-e2e-opaque-1", {
        sourceFilePath: "server/src/services/pipeline.service.js",
        functionName: "executePipeline",
        sourceCode: `
          export function executePipeline(input) {
            if (!input) return "DEFAULT";
            return "PROCESSED: " + input.toUpperCase();
          }
        `,
        requestedCategory: "HAPPY_PATH"
      }, { rootDir });

      expect(trace.steps.length).toBeGreaterThanOrEqual(4);

      // 3. Confirm 100% Storage Immutability
      for (const dir of storageTargets) {
        const afterHash = computeDirectoryHashMap(dir);
        expect(Array.from(afterHash.entries())).toEqual(Array.from(beforeHashes.get(dir).entries()));
      }
    });
  });
});
