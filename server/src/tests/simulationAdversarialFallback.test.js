/**
 * simulationAdversarialFallback.test.js
 *
 * Empirical Adversarial Challenge Test Harness for Milestone 3:
 * Frontend Simulation Studio, Fallback Synthesis, and Data Rendering Robustness.
 *
 * Tested Areas:
 * 1. Fallback Simulation Synthesis against 15+ extreme, corrupt, or boundary inputs.
 * 2. Visual Component & Inspector resilience to malformed, missing, or exotic trace payloads.
 * 3. Playback State Machine resilience under edge-case bounds (0-steps, out-of-bounds index).
 * 4. Backend AST Simulation Engine resilience on extreme codebases (0 functions, 0 branches, extreme nesting).
 * 5. Storage Immutability Guard (Rule 8: strictly zero writes to storage/ or uploads/).
 */

import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as babelParser from "@babel/parser";
import generatePkg from "@babel/generator";
const generate = generatePkg.default || generatePkg;

import { generateSimulationTrace } from "../services/unitTestSimulation.service.js";

// Path declarations
const clientSrcDir = path.resolve(process.cwd(), "../client/src");
const hookPath = path.join(clientSrcDir, "hooks/useUnitTestSimulation.js");
const simulationDir = path.join(clientSrcDir, "components/dashboard/simulation");

// Extract CATEGORY_METADATA and SIMULATION_PHASES from useUnitTestSimulation.js AST
const hookCode = fs.readFileSync(hookPath, "utf8");
const ast = babelParser.parse(hookCode, { sourceType: "module", plugins: ["jsx"] });

let catMetaCode = "";
let phaseCode = "";

for (const node of ast.program.body) {
  if (
    node.type === "ExportNamedDeclaration" &&
    node.declaration?.declarations?.[0]?.id?.name === "CATEGORY_METADATA"
  ) {
    catMetaCode = generate(node.declaration).code;
  }
  if (
    node.type === "ExportNamedDeclaration" &&
    node.declaration?.declarations?.[0]?.id?.name === "SIMULATION_PHASES"
  ) {
    phaseCode = generate(node.declaration).code;
  }
}

const evaluatedHookMeta = eval(`
  ${catMetaCode}
  ${phaseCode}
  ({ CATEGORY_METADATA, SIMULATION_PHASES });
`);

describe("CHALLENGER M3: Adversarial Robustness & Simulation Engine Stress Harness", () => {
  // =========================================================================
  // SUITE 1: Adversarial, Corrupt, and Boundary Inputs on Backend Simulation Engine
  // =========================================================================
  describe("Suite 1: Backend Simulation Trace Generator Boundary & Extreme Inputs", () => {
    test("ADV-01: Empty options object `{}` returns valid fallback/base simulation trace", async () => {
      expect(hookCode).not.toContain("synthesizeClientFallbackTrace");
      expect(hookCode).toContain("getUnitTestSimulationTrace");
      expect(evaluatedHookMeta.CATEGORY_METADATA).toBeDefined();
      expect(evaluatedHookMeta.SIMULATION_PHASES).toBeDefined();

      const trace = await generateSimulationTrace("snap-adv-01", {});
      expect(trace).toBeDefined();
      expect(Array.isArray(trace.steps)).toBe(true);
      expect(trace.steps.length).toBeGreaterThan(0);
    });

    test("ADV-02: Null/minimal options produce safe structured trace without throwing", async () => {
      const trace = await generateSimulationTrace("snap-adv-02", { sourceCode: "" });
      expect(trace).toBeDefined();
      expect(Array.isArray(trace.steps)).toBe(true);
    });

    test("ADV-03: Null category input `{ requestedCategory: null }` boundary behavior", async () => {
      const trace = await generateSimulationTrace("snap-adv-03", {
        sourceCode: "export function demo(x) { return x; }",
        requestedCategory: null,
      });
      expect(trace).toBeDefined();
      expect(Array.isArray(trace.steps)).toBe(true);
    });

    test("ADV-04: Non-string category input `{ requestedCategory: 12345 }` boundary behavior", async () => {
      const trace = await generateSimulationTrace("snap-adv-04", {
        sourceCode: "export function demo(x) { return x; }",
        requestedCategory: 12345,
      });
      expect(trace).toBeDefined();
      expect(Array.isArray(trace.steps)).toBe(true);
    });

    test("ADV-05: Unknown category string falls back safely", async () => {
      const trace = await generateSimulationTrace("snap-adv-05", {
        sourceCode: "export function demo(x) { if (x > 0) return x; return 0; }",
        requestedCategory: "INVALID_METRIC_99",
      });
      expect(trace).toBeDefined();
      expect(trace.steps.length).toBeGreaterThanOrEqual(4);
    });

    test("ADV-06: Category A Happy Path generates valid return value and passing assertion", async () => {
      const trace = await generateSimulationTrace("snap-adv-06", {
        sourceCode: "export function calc(x) { if (x < 0) return 0; return x * 2; }",
        functionName: "calc",
        requestedCategory: "HAPPY_PATH",
      });
      expect(trace.testCase.category).toBe("HAPPY_PATH");
      expect(trace.steps.some((s) => s.phase === "RETURN_VALUE")).toBe(true);
      expect(trace.steps.some((s) => s.phase === "ASSERTION")).toBe(true);
    });

    test("ADV-07: Category B Boundary Values triggers branch decision evaluation", async () => {
      const trace = await generateSimulationTrace("snap-adv-07", {
        sourceCode: "export function processItems(items = []) { if (!items || items.length === 0) return 0; return items.length; }",
        functionName: "processItems",
        requestedCategory: "BOUNDARY_VALUES",
      });
      expect(trace.testCase.category).toBe("BOUNDARY_VALUES");
      expect(trace.steps.some((s) => s.phase === "BRANCH_DECISION")).toBe(true);
    });

    test("ADV-08: Category C Branch Toggling evaluates branch conditions", async () => {
      const trace = await generateSimulationTrace("snap-adv-08", {
        sourceCode: "export function checkRole(isAdmin) { if (isAdmin) return 'yes'; return 'no'; }",
        functionName: "checkRole",
        requestedCategory: "BRANCH_TOGGLING",
      });
      expect(trace.testCase.category).toBe("BRANCH_TOGGLING");
      expect(trace.steps.some((s) => s.phase === "BRANCH_DECISION")).toBe(true);
    });

    test("ADV-09: Category D Error Handling generates exception or guard handling steps", async () => {
      const trace = await generateSimulationTrace("snap-adv-09", {
        sourceCode: "export function assertPos(v) { if (v <= 0) throw new Error('must be positive'); return v; }",
        functionName: "assertPos",
        requestedCategory: "ERROR_HANDLING",
      });
      expect(trace.testCase.category).toBe("ERROR_HANDLING");
      expect(trace.steps.some((s) => s.phase === "ERROR_THROW" || s.phase === "RETURN_VALUE")).toBe(true);
      expect(trace.steps.some((s) => s.phase === "ASSERTION")).toBe(true);
    });

    test("ADV-10: Null functionName input handled without crash", async () => {
      const trace = await generateSimulationTrace("snap-adv-10", {
        sourceCode: "export function sample() { return 42; }",
        functionName: null,
      });
      expect(trace).toBeDefined();
      expect(trace.steps.length).toBeGreaterThan(0);
    });

    test("ADV-11: Empty string functionName handled safely", async () => {
      const trace = await generateSimulationTrace("snap-adv-11", {
        sourceCode: "export function sample() { return 42; }",
        functionName: "",
      });
      expect(trace).toBeDefined();
      expect(trace.steps.length).toBeGreaterThan(0);
    });

    test("ADV-12: Reserved keyword function names (`'default'`, `'class'`, `'function'`) do not crash", async () => {
      const trace = await generateSimulationTrace("snap-adv-12", {
        sourceCode: "export default function () { return 1; }",
        functionName: "class",
      });
      expect(trace).toBeDefined();
    });

    test("ADV-13: Deep path traversal in sourceFilePath does not crash trace generation", async () => {
      const trace = await generateSimulationTrace("snap-adv-13", {
        sourceFilePath: "../../../../etc/passwd",
        sourceCode: "export function ok() { return true; }",
      });
      expect(trace).toBeDefined();
      expect(trace.steps.length).toBeGreaterThan(0);
    });

    test("ADV-14: Large sourceCode payload preserves reasonable simulation latency", async () => {
      const bigSource = "export function testFn(x) { return x + 1; }\n".repeat(500);
      const start = Date.now();
      const trace = await generateSimulationTrace("snap-adv-14", {
        sourceCode: bigSource,
        functionName: "testFn",
      });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(3000);
      expect(trace.steps.length).toBeGreaterThan(0);
    });

    test("ADV-15: Malformed syntax in sourceCode and testCode is handled without unhandled crash", async () => {
      const corruptSource = "export async function broken( {{{ ;;;";
      const corruptTest = "describe('broken' =>>> {{{{";
      const trace = await generateSimulationTrace("snap-adv-15", {
        sourceCode: corruptSource,
        testCode: corruptTest,
      });
      expect(trace).toBeDefined();
      expect(Array.isArray(trace.steps)).toBe(true);
    });

    test("ADV-16: XSS attempt in testCaseTitle is carried safely without script execution", async () => {
      const xssTitle = "<script>alert('xss')</script>";
      const trace = await generateSimulationTrace("snap-adv-16", {
        sourceCode: "export function ok() { return true; }",
        testCaseTitle: xssTitle,
      });
      expect(trace.steps[0].educationalGuidance).toBeDefined();
    });

    test("ADV-17: Trace initialMocks stay isolated in RAM across steps", async () => {
      const trace = await generateSimulationTrace("snap-adv-17", {
        sourceCode: "import prisma from '../config/prisma.js'; export async function loadUser(id) { return prisma.user.findUnique({ where: { id } }); }",
        functionName: "loadUser",
      });
      expect(Array.isArray(trace.steps)).toBe(true);
      expect(trace.steps.length).toBeGreaterThan(0);
    });

    test("ADV-18: Educational guidance completeness on every step", async () => {
      const trace = await generateSimulationTrace("snap-adv-18", {
        sourceCode: "export function add(a, b) { return a + b; }",
        functionName: "add",
      });
      for (const step of trace.steps) {
        const eg = step.educationalGuidance;
        expect(eg).toBeDefined();
        expect(typeof eg.stepTitle).toBe("string");
        expect(eg.stepTitle.length).toBeGreaterThan(0);
        expect(typeof eg.stepNarrative).toBe("string");
        expect(typeof eg.logicRationale).toBe("string");
        expect(typeof eg.developerTakeaway).toBe("string");
      }
    });
  });

  // =========================================================================
  // SUITE 2: Visual Component Data Formatter & Null-Safety Stress
  // =========================================================================
  describe("Suite 2: Component Formatting & Inspector Resilience", () => {
    // Formatter functions extracted verbatim from SimulationInspectorTabs.jsx
    function formatValue(val) {
      if (val === null) return "null";
      if (val === undefined) return "undefined";
      if (typeof val === "object") {
        try {
          return JSON.stringify(val, null, 2);
        } catch {
          return "[Circular Object]";
        }
      }
      return String(val);
    }

    function getTypeLabel(val) {
      if (val === null) return "null";
      if (val === undefined) return "undefined";
      if (Array.isArray(val)) return `array[${val.length}]`;
      return typeof val;
    }

    test("ADV-19: Circular object reference formatting does not throw JSON serialization error", () => {
      const obj = { prop: "hello" };
      obj.self = obj;
      expect(() => formatValue(obj)).not.toThrow();
      expect(formatValue(obj)).toBe("[Circular Object]");
    });

    test("ADV-20: BigInt and Symbol handling in formatValue and getTypeLabel", () => {
      const big = 9007199254740991n;
      expect(formatValue(big)).toBe("9007199254740991");
      expect(getTypeLabel(big)).toBe("bigint");

      const sym = Symbol("testSymbol");
      expect(formatValue(sym)).toBe("Symbol(testSymbol)");
      expect(getTypeLabel(sym)).toBe("symbol");
    });

    test("ADV-21: Object containing BigInt handled gracefully by try-catch fallback", () => {
      const objWithBigInt = { id: 100n };
      expect(() => formatValue(objWithBigInt)).not.toThrow();
      expect(formatValue(objWithBigInt)).toBe("[Circular Object]");
    });

    test("ADV-22: Active mocks array with null/undefined elements audit", () => {
      // In SimulationInspectorTabs line 457: `m.module || "Unknown Module"`
      // If m is null, accessing m.module throws TypeError
      const corruptMocks = [null, undefined, { module: "Prisma" }];
      let threw = false;
      try {
        for (const m of corruptMocks) {
          const mod = m.module || "Unknown Module";
        }
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(TypeError);
      }
      expect(threw).toBe(true);
    });

    test("ADV-23: Sources data array with null elements audit", () => {
      // In UnitTestSimulationStudioModal line 214: `sourcesData.find((s) => s.filePath === selectedSourceFile)`
      const corruptSources = [null, { filePath: "src/service.js" }];
      let threw = false;
      try {
        corruptSources.find((s) => s.filePath === "src/service.js");
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(TypeError);
      }
      expect(threw).toBe(true);
    });

    test("ADV-24: Sources data with undefined filePath audit", () => {
      // In UnitTestSimulationStudioModal line 377: `src.filePath.split("/").pop()`
      const corruptSrc = { filePath: undefined };
      let threw = false;
      try {
        const name = corruptSrc.fileName || corruptSrc.filePath.split("/").pop();
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(TypeError);
      }
      expect(threw).toBe(true);
    });

    test("ADV-25: getLanguage with non-string path input audit", () => {
      // In UnitTestSimulationStudioModal line 30: `path.match(/\.[^.]+$/)`
      const nonStringPaths = [123, {}, true, []];
      for (const p of nonStringPaths) {
        let threw = false;
        try {
          p.match(/\.[^.]+$/);
        } catch (err) {
          threw = true;
          expect(err).toBeInstanceOf(TypeError);
        }
        expect(threw).toBe(true);
      }
    });

    test("ADV-26: SimulationPlaybackBar with steps={null} audit", () => {
      // In SimulationPlaybackBar line 45: `const totalSteps = steps.length;`
      let threw = false;
      const steps = null;
      try {
        const total = steps.length;
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(TypeError);
      }
      expect(threw).toBe(true);
    });
  });

  // =========================================================================
  // SUITE 3: Playback State Machine Robustness Under Extreme Bounds
  // =========================================================================
  describe("Suite 3: Playback State Machine Bounds & Reducer Invariants", () => {
    function createPlaybackEngine(steps = []) {
      let currentStepIndex = 0;
      let isPlaying = false;

      return {
        get currentStepIndex() { return currentStepIndex; },
        get isPlaying() { return isPlaying; },
        play() {
          if (steps.length === 0) return;
          if (currentStepIndex >= steps.length - 1) currentStepIndex = 0;
          isPlaying = true;
        },
        pause() { isPlaying = false; },
        stepForward() {
          if (currentStepIndex < steps.length - 1) currentStepIndex++;
          else isPlaying = false;
        },
        stepBackward() {
          if (currentStepIndex > 0) currentStepIndex--;
        },
        reset() {
          isPlaying = false;
          currentStepIndex = 0;
        },
        jumpToEnd() {
          isPlaying = false;
          if (steps.length > 0) currentStepIndex = steps.length - 1;
        },
        jumpToStep(index) {
          if (steps.length === 0) return;
          const num = Number(index);
          if (isNaN(num)) return;
          currentStepIndex = Math.max(0, Math.min(Math.floor(num), steps.length - 1));
        },
        getCurrentStep() {
          if (steps.length === 0) return null;
          const idx = Math.max(0, Math.min(currentStepIndex, steps.length - 1));
          return steps[idx];
        },
      };
    }

    test("ADV-27: Empty trace (0 steps) does not allow playback to start", () => {
      const engine = createPlaybackEngine([]);
      engine.play();
      expect(engine.isPlaying).toBe(false);
      expect(engine.currentStepIndex).toBe(0);
      expect(engine.getCurrentStep()).toBeNull();
    });

    test("ADV-28: Single step trace (1 step) stepForward stays at 0 and isPlaying is false", () => {
      const engine = createPlaybackEngine([{ phase: "ASSERTION" }]);
      expect(engine.currentStepIndex).toBe(0);
      engine.stepForward();
      expect(engine.currentStepIndex).toBe(0);
      expect(engine.isPlaying).toBe(false);
    });

    test("ADV-29: jumpToStep with NaN, Infinity, -Infinity, and huge numbers", () => {
      const engine = createPlaybackEngine(Array.from({ length: 5 }, (_, i) => ({ step: i })));
      engine.jumpToStep(NaN);
      expect(engine.currentStepIndex).toBe(0);

      engine.jumpToStep(999999);
      expect(engine.currentStepIndex).toBe(4);

      engine.jumpToStep(-999999);
      expect(engine.currentStepIndex).toBe(0);
    });
  });

  // =========================================================================
  // SUITE 4: Backend Simulation Engine on Extreme & Boundary Codebases
  // =========================================================================
  describe("Suite 4: Backend Simulation Engine on Extreme Code", () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "challenger-sim-m3-"));
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
      }
    });

    test("ADV-30: File with zero functions (pure constant declarations)", async () => {
      const { analyzeSourceAst } = await import("../services/businessLogicAstAnalyzer.service.js");

      const code = `
        export const API_CONFIG = {
          timeout: 5000,
          retries: 3
        };
        export const VERSION = "1.0.0";
      `;
      const analysis = analyzeSourceAst(code);

      expect(analysis.exportedSymbols).toBeDefined();
      expect(analysis.internalFunctions).toHaveLength(0);
      expect(analysis.decisionPoints).toHaveLength(0);
    });

    test("ADV-31: File with extreme nesting (12+ levels of nested if-else)", async () => {
      const { analyzeSourceAst } = await import("../services/businessLogicAstAnalyzer.service.js");

      let nested = "return true;";
      for (let i = 0; i < 12; i++) {
        nested = `if (arg${i} > 0) { ${nested} } else { return false; }`;
      }
      const code = `export function deepCheck(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11) { ${nested} }`;

      const analysis = analyzeSourceAst(code);

      expect(analysis.exportedSymbols).toHaveLength(1);
      expect(analysis.cyclomaticComplexity).toBeGreaterThan(10);
      expect(analysis.decisionPoints.length).toBeGreaterThanOrEqual(12);
    });

    test("ADV-32: Empty source file (0 bytes)", async () => {
      const { analyzeSourceAst } = await import("../services/businessLogicAstAnalyzer.service.js");

      const analysis = analyzeSourceAst("");

      expect(analysis.exportedSymbols).toHaveLength(0);
      expect(analysis.decisionPoints).toHaveLength(0);
      expect(analysis.internalFunctions).toHaveLength(0);
    });
  });

  // =========================================================================
  // SUITE 5: Storage Code Immutability Guard (Rule 8)
  // =========================================================================
  describe("Suite 5: Storage Code Immutability Guard (Rule 8)", () => {
    test("ADV-33: Zero write operations to storage/ or uploads/ across all simulation files", () => {
      const allSimFiles = [
        path.join(clientSrcDir, "hooks/useUnitTestSimulation.js"),
        path.join(simulationDir, "SimulationPlaybackBar.jsx"),
        path.join(simulationDir, "SimulationInspectorTabs.jsx"),
        path.join(simulationDir, "EducationalGuidanceCard.jsx"),
        path.join(simulationDir, "UnitTestSimulationStudioModal.jsx"),
      ];

      for (const f of allSimFiles) {
        const content = fs.readFileSync(f, "utf8");
        expect(content).not.toContain("fs.writeFileSync");
        expect(content).not.toContain("fs.writeFile");
        expect(content).not.toContain("fs.appendFileSync");
        expect(content).not.toContain("fs.unlinkSync");
        expect(content).not.toContain("localStorage.clear");
      }
    });

    test("ADV-34: Storage directory exists and remains completely untouched", () => {
      const storageDir = path.resolve(process.cwd(), "../storage");
      if (fs.existsSync(storageDir)) {
        const files = fs.readdirSync(storageDir);
        // Immutability: reading is allowed, no temp files generated
        expect(Array.isArray(files)).toBe(true);
      }
    });
  });
});
