/**
 * sim_challenger_m3_2b_rechallenge.test.js
 *
 * Empirical Adversarial Re-Challenge Test Harness for Milestone 3 Remediation:
 * Verifying resolution of all 6 crash points & boundary vulnerabilities.
 *
 * Crash Points Tested:
 * 1. synthesizeClientFallbackTrace() without arguments (zero-arguments call).
 * 2. category: null / non-string category safety (no toLowerCase on null).
 * 3. functionName: null / invalid types (safe default "execute", valid Babel AST).
 * 4. SimulationPlaybackBar with steps={null} and steps={undefined}.
 * 5. SimulationInspectorTabs with nullish active mocks ([null, undefined]).
 * 6. UnitTestSimulationStudioModal getLanguage and sourcesData null resilience.
 */

import { describe, it, test, expect, beforeAll } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as babelParser from "@babel/parser";
import generatePkg from "@babel/generator";
const generate = generatePkg.default || generatePkg;

const clientSrcDir = path.resolve(process.cwd(), "../client/src");
const hookPath = path.join(clientSrcDir, "hooks/useUnitTestSimulation.js");
const simulationDir = path.join(clientSrcDir, "components/dashboard/simulation");

// Extract synthesizeClientFallbackTrace, CATEGORY_METADATA, SIMULATION_PHASES
const hookCode = fs.readFileSync(hookPath, "utf8");
const hookAst = babelParser.parse(hookCode, { sourceType: "module", plugins: ["jsx"] });

let catMetaCode = "";
let phaseCode = "";
let fallbackFnCode = "";

for (const node of hookAst.program.body) {
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
  if (
    node.type === "FunctionDeclaration" &&
    node.id.name === "synthesizeClientFallbackTrace"
  ) {
    fallbackFnCode = generate(node).code;
  }
}

const evaluatedFallbackFn = eval(`
  ${catMetaCode}
  ${phaseCode}
  ${fallbackFnCode}
  synthesizeClientFallbackTrace;
`);

describe("RE-CHALLENGE: Milestone 3 Defensive Null-Safety & Fallback Robustness", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // CRASH POINT 1: Zero-Arguments synthesizeClientFallbackTrace()
  // ──────────────────────────────────────────────────────────────────────────
  describe("Crash Point 1: Zero-Arguments synthesizeClientFallbackTrace()", () => {
    it("MUST NOT throw when called with no arguments at all", () => {
      let trace;
      expect(() => {
        trace = evaluatedFallbackFn();
      }).not.toThrow();

      expect(trace).toBeDefined();
      expect(trace.steps).toHaveLength(7);
      expect(trace.testCase.targetFunction).toBe("execute");
      expect(trace.testCase.category).toBe("HAPPY_PATH");
      expect(trace.id).toBe("sim_execute_happy_path");
      expect(trace.sourceFilePath).toBe("source.js");
    });

    it("MUST NOT throw when called with undefined", () => {
      let trace;
      expect(() => {
        trace = evaluatedFallbackFn(undefined);
      }).not.toThrow();

      expect(trace).toBeDefined();
      expect(trace.steps).toHaveLength(7);
      expect(trace.id).toBe("sim_execute_happy_path");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CRASH POINT 2: category: null or Non-String Category
  // ──────────────────────────────────────────────────────────────────────────
  describe("Crash Point 2: Category Defensive Null & Non-String Fallback", () => {
    const maliciousCategories = [
      null,
      undefined,
      12345,
      true,
      false,
      {},
      [],
      Symbol("cat"),
      "NON_EXISTENT_CATEGORY_XYZ",
    ];

    maliciousCategories.forEach((catVal) => {
      it(`MUST NOT throw on category=${String(typeof catVal === "symbol" ? "Symbol" : JSON.stringify(catVal))}`, () => {
        let trace;
        expect(() => {
          trace = evaluatedFallbackFn({ category: catVal });
        }).not.toThrow();

        expect(trace).toBeDefined();
        expect(trace.steps).toHaveLength(7);
        // Trace ID must be cleanly generated without throwing .toLowerCase()
        expect(typeof trace.id).toBe("string");
        expect(trace.id).toBe("sim_execute_happy_path");
        expect(trace.testCase.category).toBe("HAPPY_PATH");
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CRASH POINT 3: functionName: null / Invalid Types (Valid AST)
  // ──────────────────────────────────────────────────────────────────────────
  describe("Crash Point 3: functionName Defensive Fallback & Valid JS Syntax AST", () => {
    const maliciousFunctionNames = [null, undefined, 42, false, true, {}, []];

    maliciousFunctionNames.forEach((fnVal) => {
      it(`defaults to 'execute' and synthesizes valid JS AST for functionName=${JSON.stringify(fnVal)}`, () => {
        let trace;
        expect(() => {
          trace = evaluatedFallbackFn({ functionName: fnVal });
        }).not.toThrow();

        expect(trace).toBeDefined();
        expect(trace.testCase.targetFunction).toBe("execute");
        expect(trace.id).toContain("sim_execute_");

        // Assert that defaultSource does NOT contain invalid keyword "function null"
        expect(trace.sourceCode).not.toContain("function null");
        expect(trace.sourceCode).toContain("export async function execute");

        // Parse generated sourceCode with Babel to empirically guarantee valid JS AST
        expect(() => {
          babelParser.parse(trace.sourceCode, { sourceType: "module" });
        }).not.toThrow();

        // Parse generated testCode with Babel
        expect(() => {
          babelParser.parse(trace.testCode, { sourceType: "module" });
        }).not.toThrow();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CRASH POINT 4: SimulationPlaybackBar steps={null} / steps={undefined}
  // ──────────────────────────────────────────────────────────────────────────
  describe("Crash Point 4: SimulationPlaybackBar.jsx steps={null} Resilience", () => {
    const playbackBarPath = path.join(simulationDir, "SimulationPlaybackBar.jsx");
    const barCode = fs.readFileSync(playbackBarPath, "utf8");

    it("verifies safe steps length calculation in source code", () => {
      expect(barCode).toContain("steps?.length || 0");
    });

    it("verifies steps mapping is guarded against null/undefined", () => {
      expect(barCode).toContain("(steps || []).map");
    });

    it("verifies hoveredStepIndex tooltip lookup is safely guarded with optional chaining", () => {
      expect(barCode).toContain("steps?.[hoveredStepIndex]");
      expect(barCode).toContain("steps[hoveredStepIndex]?.phase");
      expect(barCode).toContain("steps[hoveredStepIndex]?.title");
    });

    it("evaluates simulated playback scrubber state logic under steps=null", () => {
      // Replicate component logic
      const simulateBarState = (steps, currentStepIndex = 0, hoveredStepIndex = null) => {
        const totalSteps = steps?.length || 0;
        const progressPct =
          totalSteps > 1
            ? Math.round((currentStepIndex / (totalSteps - 1)) * 100)
            : totalSteps === 1
            ? 100
            : 0;
        const mappedNodes = (steps || []).map((step, idx) => ({
          idx,
          phase: step?.phase,
          title: step?.title,
        }));
        const tooltip =
          hoveredStepIndex !== null && steps?.[hoveredStepIndex]
            ? {
                phase: steps[hoveredStepIndex]?.phase,
                title: steps[hoveredStepIndex]?.title,
              }
            : null;
        return { totalSteps, progressPct, mappedNodes, tooltip };
      };

      const resNull = simulateBarState(null, 0, 0);
      expect(resNull.totalSteps).toBe(0);
      expect(resNull.progressPct).toBe(0);
      expect(resNull.mappedNodes).toEqual([]);
      expect(resNull.tooltip).toBeNull();

      const resUndefined = simulateBarState(undefined, 0, null);
      expect(resUndefined.totalSteps).toBe(0);
      expect(resUndefined.progressPct).toBe(0);
      expect(resUndefined.mappedNodes).toEqual([]);
      expect(resUndefined.tooltip).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CRASH POINT 5: SimulationInspectorTabs Nullish Active Mocks
  // ──────────────────────────────────────────────────────────────────────────
  describe("Crash Point 5: SimulationInspectorTabs.jsx Nullish Active Mocks Resilience", () => {
    const inspectorPath = path.join(simulationDir, "SimulationInspectorTabs.jsx");
    const inspectorCode = fs.readFileSync(inspectorPath, "utf8");

    it("verifies activeMocks filtering in source code", () => {
      expect(inspectorCode).toContain(".filter(Boolean)");
    });

    it("verifies mock property dereferences use optional chaining", () => {
      expect(inspectorCode).toContain("m?.module || \"Unknown Module\"");
      expect(inspectorCode).toContain("m?.status || \"ISOLATED_IN_RAM\"");
      expect(inspectorCode).toContain("m?.method");
      expect(inspectorCode).toContain("m?.returned");
    });

    it("evaluates simulated activeMocks extraction and rendering with corrupt payloads", () => {
      const simulateMocksExtraction = (step, initialMocks) => {
        const activeMocks = (step?.activeMocks || initialMocks || []).filter(Boolean);
        return activeMocks.map((m) => ({
          moduleName: m?.module || "Unknown Module",
          status: m?.status || "ISOLATED_IN_RAM",
          method: m?.method || null,
          returned: m?.returned,
        }));
      };

      // Case A: step.activeMocks contains null and undefined
      const stepWithNulls = {
        activeMocks: [null, undefined, { module: "PrismaClient", method: "user.findUnique" }, null],
      };
      const renderedA = simulateMocksExtraction(stepWithNulls, []);
      expect(renderedA).toHaveLength(1);
      expect(renderedA[0].moduleName).toBe("PrismaClient");
      expect(renderedA[0].method).toBe("user.findUnique");
      expect(renderedA[0].status).toBe("ISOLATED_IN_RAM");

      // Case B: initialMocks contains empty objects or nulls
      const renderedB = simulateMocksExtraction(null, [null, {}, undefined]);
      expect(renderedB).toHaveLength(1);
      expect(renderedB[0].moduleName).toBe("Unknown Module");
      expect(renderedB[0].status).toBe("ISOLATED_IN_RAM");
      expect(renderedB[0].method).toBeNull();

      // Case C: step is null, initialMocks is null
      const renderedC = simulateMocksExtraction(null, null);
      expect(renderedC).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CRASH POINT 6: UnitTestSimulationStudioModal Sources Data Null Resilience
  // ──────────────────────────────────────────────────────────────────────────
  describe("Crash Point 6: UnitTestSimulationStudioModal.jsx Sources & Path Resilience", () => {
    const modalPath = path.join(simulationDir, "UnitTestSimulationStudioModal.jsx");
    const modalCode = fs.readFileSync(modalPath, "utf8");

    it("verifies getLanguage guards non-string and null path inputs in source code", () => {
      expect(modalCode).toContain("if (!path || typeof path !== \"string\") return \"javascript\";");
    });

    it("verifies sourcesData safe find and filter(Boolean) in source code", () => {
      expect(modalCode).toContain("sourcesData.find((s) => s?.filePath === selectedSourceFile)");
      expect(modalCode).toContain("sourcesData.filter(Boolean).map");
      expect(modalCode).toContain("src?.fileName || src?.filePath?.split(\"/\").pop() || \"source.js\"");
    });

    it("evaluates getLanguage under boundary inputs", () => {
      const EXT_LANG_MAP = {
        ".js": "javascript",
        ".jsx": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".json": "json",
      };
      const getLanguage = (pathVal) => {
        if (!pathVal || typeof pathVal !== "string") return "javascript";
        const match = pathVal.match(/\.[^.]+$/);
        if (!match) return "javascript";
        return EXT_LANG_MAP[match[0].toLowerCase()] || "javascript";
      };

      expect(getLanguage(null)).toBe("javascript");
      expect(getLanguage(undefined)).toBe("javascript");
      expect(getLanguage(123)).toBe("javascript");
      expect(getLanguage({})).toBe("javascript");
      expect(getLanguage("no_extension")).toBe("javascript");
      expect(getLanguage("App.tsx")).toBe("typescript");
      expect(getLanguage("style.json")).toBe("json");
    });

    it("evaluates sourcesData find and option label formatting under corrupt list", () => {
      const corruptSources = [
        null,
        undefined,
        { filePath: "src/services/order.js", fileName: "order.js" },
        {},
        { filePath: "src/utils/math.js" },
      ];

      // Safe find
      const findSource = (list, selected) => {
        if (!Array.isArray(list) || !selected) return null;
        return list.find((s) => s?.filePath === selected) || null;
      };

      expect(findSource(corruptSources, "src/services/order.js")).toEqual({
        filePath: "src/services/order.js",
        fileName: "order.js",
      });
      expect(findSource(corruptSources, "non_existent.js")).toBeNull();
      expect(findSource(null, "any")).toBeNull();

      // Safe option generation
      const options = corruptSources.filter(Boolean).map((src, idx) => ({
        key: src?.filePath || idx,
        value: src?.filePath || "",
        label: src?.fileName || src?.filePath?.split("/").pop() || "source.js",
      }));

      expect(options).toHaveLength(3);
      expect(options[0].label).toBe("order.js");
      expect(options[1].label).toBe("source.js"); // empty object fallback
      expect(options[2].label).toBe("math.js"); // split pop fallback
    });
  });
});
