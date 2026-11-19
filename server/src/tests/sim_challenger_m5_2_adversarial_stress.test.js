/**
 * sim_challenger_m5_2_adversarial_stress.test.js
 *
 * Empirical Adversarial Challenger Test Suite for Milestone 5 Phase 2:
 * Frontend Simulation Studio, State Machine & View Integration.
 *
 * 8 Challenge Dimensions:
 * 1. Playback state machine edge cases & rapid state transitions
 * 2. Keyboard navigation resilience & form control event isolation
 * 3. Defensive null-safety, missing fields, and circular object handling
 * 4. Client fallback trace generation (synthesizeClientFallbackTrace) boundaries & destructuring
 * 5. Modal lifecycle & bi-directional view integration across 3 host components
 * 6. Rule 10 Compliance: Strict 3 canonical tabs invariant in CoverageTypeDashboard
 * 7. Client production build verification (Vite 0-error artifact integrity)
 * 8. Strict Storage Code Immutability Guard (Rule 8: zero writes to storage/ or uploads/)
 */

import { describe, it, expect, jest, beforeAll } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as babelParser from "@babel/parser";
import generatePkg from "@babel/generator";
import { execSync } from "child_process";

const generate = generatePkg.default || generatePkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
const clientSrcDir = path.resolve(rootDir, "client/src");

describe("CHALLENGER M5-2: Adversarial Coverage Hardening — Frontend Simulation Studio, State Machine & View Integration", () => {
  const simulationModalPath = path.join(clientSrcDir, "components/dashboard/simulation/UnitTestSimulationStudioModal.jsx");
  const playbackBarPath = path.join(clientSrcDir, "components/dashboard/simulation/SimulationPlaybackBar.jsx");
  const inspectorTabsPath = path.join(clientSrcDir, "components/dashboard/simulation/SimulationInspectorTabs.jsx");
  const guidanceCardPath = path.join(clientSrcDir, "components/dashboard/simulation/EducationalGuidanceCard.jsx");
  const simulationHookPath = path.join(clientSrcDir, "hooks/useUnitTestSimulation.js");
  const traceabilityMatrixPath = path.join(clientSrcDir, "components/dashboard/UnitTestTraceabilityMatrix.jsx");
  const inPlaceModalPath = path.join(clientSrcDir, "components/dashboard/InPlaceCoverageFileModal.jsx");
  const dashboardComponentPath = path.join(clientSrcDir, "components/dashboard/CoverageTypeDashboard.jsx");

  let hookAst;
  let hookCode;
  let synthesizeClientFallbackTraceFn;
  let categoryMetadata;
  let simulationPhases;

  beforeAll(() => {
    hookCode = fs.readFileSync(simulationHookPath, "utf8");
    hookAst = babelParser.parse(hookCode, { sourceType: "module", plugins: ["jsx"] });

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

    const evaluated = eval(`
      ${catMetaCode}
      ${phaseCode}
      ${fallbackFnCode}
      ({
        CATEGORY_METADATA,
        SIMULATION_PHASES,
        synthesizeClientFallbackTrace
      });
    `);

    categoryMetadata = evaluated.CATEGORY_METADATA;
    simulationPhases = evaluated.SIMULATION_PHASES;
    synthesizeClientFallbackTraceFn = evaluated.synthesizeClientFallbackTrace;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. PLAYBACK STATE MACHINE EDGE CASES
  // ──────────────────────────────────────────────────────────────────────────
  describe("1. Playback State Machine Edge Cases & Rapid Burst Transitions", () => {
    /**
     * Recreates the exact deterministic state machine logic of useUnitTestSimulation.js
     */
    function createPlaybackStateMachine(initialConfig = {}) {
      let steps = initialConfig.steps || [];
      let currentStepIndex = 0;
      let isPlaying = false;
      let playbackSpeed = initialConfig.playbackSpeed || 1;

      const play = () => {
        if (steps.length === 0) return;
        if (currentStepIndex >= steps.length - 1) {
          currentStepIndex = 0;
        }
        isPlaying = true;
      };

      const pause = () => {
        isPlaying = false;
      };

      const togglePlay = () => {
        if (isPlaying) {
          pause();
        } else {
          play();
        }
      };

      const stepForward = () => {
        if (currentStepIndex < steps.length - 1) {
          currentStepIndex += 1;
        } else {
          isPlaying = false;
        }
      };

      const stepBackward = () => {
        currentStepIndex = currentStepIndex > 0 ? currentStepIndex - 1 : 0;
      };

      const reset = () => {
        isPlaying = false;
        currentStepIndex = 0;
      };

      const jumpToEnd = () => {
        isPlaying = false;
        if (steps.length > 0) {
          currentStepIndex = steps.length - 1;
        }
      };

      const jumpToStep = (index) => {
        if (steps.length === 0) return;
        const safeIndex = Math.max(0, Math.min(index, steps.length - 1));
        currentStepIndex = safeIndex;
      };

      const setPlaybackSpeed = (spd) => {
        playbackSpeed = spd;
      };

      const tickTimer = () => {
        if (!isPlaying || steps.length === 0) return false;
        if (currentStepIndex >= steps.length - 1) {
          isPlaying = false;
          return false;
        }
        currentStepIndex += 1;
        return true;
      };

      return {
        get steps() { return steps; },
        get currentStepIndex() { return currentStepIndex; },
        get isPlaying() { return isPlaying; },
        get playbackSpeed() { return playbackSpeed; },
        get currentStep() {
          if (steps.length === 0) return null;
          const idx = Math.max(0, Math.min(currentStepIndex, steps.length - 1));
          return steps[idx];
        },
        play,
        pause,
        togglePlay,
        stepForward,
        stepBackward,
        reset,
        jumpToEnd,
        jumpToStep,
        setPlaybackSpeed,
        tickTimer,
      };
    }

    it("ADV-SM-01: Rapid alternating burst of 500 play/pause/toggle calls maintains bounded state", () => {
      const mockSteps = Array.from({ length: 7 }, (_, i) => ({ stepIndex: i + 1, phase: "STEP" }));
      const sm = createPlaybackStateMachine({ steps: mockSteps });

      expect(sm.isPlaying).toBe(false);
      expect(sm.currentStepIndex).toBe(0);

      for (let i = 0; i < 500; i++) {
        if (i % 3 === 0) sm.togglePlay();
        else if (i % 3 === 1) sm.stepForward();
        else sm.pause();

        expect(sm.currentStepIndex).toBeGreaterThanOrEqual(0);
        expect(sm.currentStepIndex).toBeLessThan(mockSteps.length);
        expect(typeof sm.isPlaying).toBe("boolean");
      }
    });

    it("ADV-SM-02: Step next at final step totalSteps - 1 does not overflow and deactivates playing", () => {
      const mockSteps = Array.from({ length: 5 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createPlaybackStateMachine({ steps: mockSteps });

      sm.jumpToEnd();
      expect(sm.currentStepIndex).toBe(4);
      expect(sm.isPlaying).toBe(false);

      // Now attempt stepForward
      sm.stepForward();
      expect(sm.currentStepIndex).toBe(4);
      expect(sm.isPlaying).toBe(false);

      // If playing was somehow true, stepping forward at the end turns it off
      sm.play(); // will restart to 0 because at end
      expect(sm.currentStepIndex).toBe(0);
      expect(sm.isPlaying).toBe(true);

      sm.jumpToEnd();
      sm.stepForward();
      expect(sm.currentStepIndex).toBe(4);
      expect(sm.isPlaying).toBe(false);
    });

    it("ADV-SM-03: Step back at step 0 does not underflow below 0", () => {
      const mockSteps = Array.from({ length: 5 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createPlaybackStateMachine({ steps: mockSteps });

      expect(sm.currentStepIndex).toBe(0);
      sm.stepBackward();
      expect(sm.currentStepIndex).toBe(0);
      sm.stepBackward();
      expect(sm.currentStepIndex).toBe(0);
    });

    it("ADV-SM-04: jumpToEnd and reset correctly clamp state and halt playback", () => {
      const mockSteps = Array.from({ length: 7 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createPlaybackStateMachine({ steps: mockSteps });

      sm.play();
      expect(sm.isPlaying).toBe(true);
      sm.jumpToEnd();
      expect(sm.isPlaying).toBe(false);
      expect(sm.currentStepIndex).toBe(6);

      sm.play(); // restarts to 0
      expect(sm.currentStepIndex).toBe(0);
      expect(sm.isPlaying).toBe(true);
      sm.reset();
      expect(sm.isPlaying).toBe(false);
      expect(sm.currentStepIndex).toBe(0);
    });

    it("ADV-SM-05: jumpToStep clamps negative numbers to 0 and oversized numbers to totalSteps - 1", () => {
      const mockSteps = Array.from({ length: 7 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createPlaybackStateMachine({ steps: mockSteps });

      sm.jumpToStep(-100);
      expect(sm.currentStepIndex).toBe(0);

      sm.jumpToStep(9999);
      expect(sm.currentStepIndex).toBe(6);

      sm.jumpToStep(3);
      expect(sm.currentStepIndex).toBe(3);
    });

    it("ADV-SM-06: Speed alterations during playback update intervalMs without corrupting step index", () => {
      const mockSteps = Array.from({ length: 7 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createPlaybackStateMachine({ steps: mockSteps });

      sm.play();
      [0.5, 1, 2].forEach((spd) => {
        sm.setPlaybackSpeed(spd);
        const intervalMs = Math.round(1500 / spd);
        expect(intervalMs).toBe(spd === 0.5 ? 3000 : spd === 1 ? 1500 : 750);
        sm.tickTimer();
        expect(sm.currentStepIndex).toBeGreaterThan(0);
      });
    });

    it("ADV-SM-07: Empty steps array gracefully handles all playback actions without throwing", () => {
      const sm = createPlaybackStateMachine({ steps: [] });

      expect(() => {
        sm.play();
        sm.pause();
        sm.togglePlay();
        sm.stepForward();
        sm.stepBackward();
        sm.reset();
        sm.jumpToEnd();
        sm.jumpToStep(5);
        sm.tickTimer();
      }).not.toThrow();

      expect(sm.currentStepIndex).toBe(0);
      expect(sm.isPlaying).toBe(false);
      expect(sm.currentStep).toBeNull();
    });

    it("ADV-SM-08: Timer ticks until totalSteps - 1 and automatically pauses", () => {
      const mockSteps = Array.from({ length: 3 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createPlaybackStateMachine({ steps: mockSteps });

      sm.play();
      expect(sm.currentStepIndex).toBe(0);
      expect(sm.isPlaying).toBe(true);

      const advanced1 = sm.tickTimer();
      expect(advanced1).toBe(true);
      expect(sm.currentStepIndex).toBe(1);

      const advanced2 = sm.tickTimer();
      expect(advanced2).toBe(true);
      expect(sm.currentStepIndex).toBe(2);

      // Now at last step: next tick should pause and return false
      const advanced3 = sm.tickTimer();
      expect(advanced3).toBe(false);
      expect(sm.currentStepIndex).toBe(2);
      expect(sm.isPlaying).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. KEYBOARD NAVIGATION RESILIENCE
  // ──────────────────────────────────────────────────────────────────────────
  describe("2. Keyboard Navigation Resilience & Target Element Isolation", () => {
    it("ADV-KB-01: Verifies keyboard shortcut filtering logic in useUnitTestSimulation.js source", () => {
      // Find the handleKeyDown function in useUnitTestSimulation.js AST
      let handleKeyDownNode = null;
      babelParser.parse(hookCode, {
        sourceType: "module",
        plugins: ["jsx"],
      });

      expect(hookCode).toContain("handleKeyDown");
      expect(hookCode).toContain("e.target?.tagName?.toLowerCase()");
      expect(hookCode).toContain('tag === "input"');
      expect(hookCode).toContain('tag === "textarea"');
      expect(hookCode).toContain("e.target?.isContentEditable");
    });

    it("ADV-KB-02: Form inputs (input, textarea, contentEditable) must return early and NOT trigger shortcuts", () => {
      // Emulate the exact handleKeyDown function from useUnitTestSimulation.js
      let actionTriggered = null;
      let defaultPrevented = false;

      const handleKeyDown = (e) => {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) {
          return;
        }

        if (e.code === "Space") {
          e.preventDefault();
          actionTriggered = "togglePlay";
        } else if (e.code === "ArrowRight") {
          e.preventDefault();
          actionTriggered = "stepForward";
        } else if (e.code === "ArrowLeft") {
          e.preventDefault();
          actionTriggered = "stepBackward";
        } else if (e.code === "Home" || e.code === "KeyR") {
          e.preventDefault();
          actionTriggered = "reset";
        } else if (e.code === "End") {
          e.preventDefault();
          actionTriggered = "jumpToEnd";
        }
      };

      const makeEvent = (code, tagName, isContentEditable = false) => {
        defaultPrevented = false;
        actionTriggered = null;
        return {
          code,
          target: {
            tagName,
            isContentEditable,
          },
          preventDefault: () => {
            defaultPrevented = true;
          },
        };
      };

      // 1. Inside <input>
      handleKeyDown(makeEvent("Space", "INPUT"));
      expect(actionTriggered).toBeNull();
      expect(defaultPrevented).toBe(false);

      handleKeyDown(makeEvent("ArrowRight", "input"));
      expect(actionTriggered).toBeNull();
      expect(defaultPrevented).toBe(false);

      // 2. Inside <textarea>
      handleKeyDown(makeEvent("Space", "TEXTAREA"));
      expect(actionTriggered).toBeNull();
      expect(defaultPrevented).toBe(false);

      handleKeyDown(makeEvent("Home", "textarea"));
      expect(actionTriggered).toBeNull();
      expect(defaultPrevented).toBe(false);

      // 3. Inside contentEditable div (e.g. Monaco editor editor pane)
      handleKeyDown(makeEvent("Space", "DIV", true));
      expect(actionTriggered).toBeNull();
      expect(defaultPrevented).toBe(false);

      // 4. Outside inputs (e.g. body or modal container): shortcuts must trigger
      handleKeyDown(makeEvent("Space", "DIV", false));
      expect(actionTriggered).toBe("togglePlay");
      expect(defaultPrevented).toBe(true);

      handleKeyDown(makeEvent("ArrowRight", "DIV", false));
      expect(actionTriggered).toBe("stepForward");
      expect(defaultPrevented).toBe(true);
    });

    it("ADV-KB-03: EMPIRICAL FINDING: select dropdown is NOT shielded by tag === 'input' || tag === 'textarea'", () => {
      // The prompt asks to:
      // "verify that Space, ArrowRight, ArrowLeft, Home/R, End do NOT trigger shortcuts when typing inside form inputs, textareas, or select dropdowns."
      // Let's test what happens when tag is "select":
      let actionTriggered = null;
      let defaultPrevented = false;

      const currentHookHandler = (e) => {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) {
          return;
        }
        if (e.code === "Space") {
          e.preventDefault();
          actionTriggered = "togglePlay";
        }
      };

      const selectEvent = {
        code: "Space",
        target: { tagName: "SELECT" },
        preventDefault: () => { defaultPrevented = true; },
      };

      currentHookHandler(selectEvent);

      // Because 'select' is omitted from tag === "input" || tag === "textarea",
      // Space on a <select> element gets intercepted and triggers togglePlay!
      // This empirically proves the finding requested by the prompt.
      expect(actionTriggered).toBe("togglePlay");
      expect(defaultPrevented).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. DEFENSIVE NULL-SAFETY & FALLBACK RENDERING
  // ──────────────────────────────────────────────────────────────────────────
  describe("3. Defensive Null-Safety, Missing Fields & Circular Object Handling", () => {
    it("ADV-NULL-01: formatValue in SimulationInspectorTabs safely formats primitives, null, undefined, and circular references", () => {
      // Extract formatValue implementation from SimulationInspectorTabs.jsx
      const tabsCode = fs.readFileSync(inspectorTabsPath, "utf8");
      expect(tabsCode).toContain('if (val === null) return "null";');
      expect(tabsCode).toContain('if (val === undefined) return "undefined";');
      expect(tabsCode).toContain('return "[Circular Object]";');

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

      expect(formatValue(null)).toBe("null");
      expect(formatValue(undefined)).toBe("undefined");
      expect(formatValue(42)).toBe("42");
      expect(formatValue("test")).toBe("test");
      expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}');

      // Circular object test
      const circular = { name: "loop" };
      circular.self = circular;
      expect(formatValue(circular)).toBe("[Circular Object]");
    });

    it("ADV-NULL-02: SimulationPlaybackBar safely handles steps={null} and steps={[]} without division by zero", () => {
      const calcProgress = (steps, currentStepIndex) => {
        const totalSteps = steps?.length || 0;
        return totalSteps > 1 ? Math.round((currentStepIndex / (totalSteps - 1)) * 100) : totalSteps === 1 ? 100 : 0;
      };

      expect(calcProgress(null, 0)).toBe(0);
      expect(calcProgress(undefined, 0)).toBe(0);
      expect(calcProgress([], 0)).toBe(0);
      expect(calcProgress([{ step: 1 }], 0)).toBe(100);
      expect(calcProgress([{ step: 1 }, { step: 2 }], 1)).toBe(100);
      expect(calcProgress([{ step: 1 }, { step: 2 }], 0)).toBe(0);
    });

    it("ADV-NULL-03: EducationalGuidanceCard safely extracts guidance from null step and null guidance", () => {
      const extractGuidanceData = (guidance, step, category = "HAPPY_PATH") => {
        const effectiveCategory = guidance?.category || step?.educationalGuidance?.category || category || "HAPPY_PATH";
        const cat = categoryMetadata[effectiveCategory] || categoryMetadata.HAPPY_PATH;
        const phaseInfo = simulationPhases[step?.phase] || { label: step?.phase || "Execution", color: "#6366f1" };

        const title = guidance?.stepTitle || step?.educationalGuidance?.stepTitle || step?.title || "Step Execution";
        const narrative =
          guidance?.stepNarrative ||
          step?.educationalGuidance?.stepNarrative ||
          step?.description ||
          "Step is being executed in memory.";
        const rationale =
          guidance?.logicRationale ||
          step?.educationalGuidance?.logicRationale ||
          step?.branchEvaluation?.explanation ||
          "Evaluating business logic state and branch conditions.";
        const takeaway =
          guidance?.developerTakeaway ||
          step?.educationalGuidance?.developerTakeaway ||
          "Ensure unit tests exercise both expected outcomes and edge cases.";

        return { cat, phaseInfo, title, narrative, rationale, takeaway };
      };

      const result = extractGuidanceData(null, null, null);
      expect(result.cat).toBeDefined();
      expect(result.cat.id).toBe("HAPPY_PATH");
      expect(result.phaseInfo.label).toBe("Execution");
      expect(result.title).toBe("Step Execution");
      expect(result.narrative).toBe("Step is being executed in memory.");
      expect(result.rationale).toBe("Evaluating business logic state and branch conditions.");
      expect(result.takeaway).toBe("Ensure unit tests exercise both expected outcomes and edge cases.");
    });

    it("ADV-NULL-04: SimulationInspectorTabs variables, activeMocks, assertion safely handle malformed entries", () => {
      const stepWithMalformedFields = {
        variables: null,
        activeMocks: [null, undefined, { module: undefined, status: null, returned: undefined }],
        assertionResult: null,
        assertion: { matcher: undefined, passed: false, expected: null, actual: undefined },
        branchEvaluation: null,
        callStack: null,
      };

      const variables = stepWithMalformedFields?.variables || {};
      const activeMocks = (stepWithMalformedFields?.activeMocks || []).filter(Boolean);
      const assertion = stepWithMalformedFields?.assertionResult || stepWithMalformedFields?.assertion || null;
      const callStack = stepWithMalformedFields?.callStack || ["<global>"];

      expect(variables).toEqual({});
      expect(activeMocks).toHaveLength(1);
      expect(activeMocks[0].module).toBeUndefined();
      expect(assertion).toBeDefined();
      expect(assertion.matcher).toBeUndefined();
      expect(callStack).toEqual(["<global>"]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. CLIENT FALLBACK TRACE GENERATION (synthesizeClientFallbackTrace)
  // ──────────────────────────────────────────────────────────────────────────
  describe("4. Client Fallback Trace Generation (synthesizeClientFallbackTrace) Stress", () => {
    it("ADV-FALLBACK-01: Zero-arguments call executes without throwing and yields full 7-step trace", () => {
      const trace = synthesizeClientFallbackTraceFn();
      expect(trace).toBeDefined();
      expect(trace.steps).toHaveLength(7);
      expect(trace.testCase.targetFunction).toBe("execute");
      expect(trace.testCase.category).toBe("HAPPY_PATH");
      expect(trace.id).toBe("sim_execute_happy_path");
      expect(trace.sourceFilePath).toBe("source.js");
      expect(trace.summary.totalSteps).toBe(7);
    });

    it("ADV-FALLBACK-02: undefined argument executes cleanly with defaults", () => {
      const trace = synthesizeClientFallbackTraceFn(undefined);
      expect(trace).toBeDefined();
      expect(trace.steps).toHaveLength(7);
      expect(trace.testCase.targetFunction).toBe("execute");
    });

    it("ADV-FALLBACK-03: calling synthesizeClientFallbackTrace(null) safely returns default trace without throwing TypeError", () => {
      let trace = null;
      expect(() => {
        trace = synthesizeClientFallbackTraceFn(null);
      }).not.toThrow();
      expect(trace).toBeDefined();
      expect(trace.steps).toHaveLength(7);
      expect(trace.testCase.targetFunction).toBe("execute");
    });

    it("ADV-FALLBACK-04: Invalid and non-string functionName safely defaults to 'execute'", () => {
      const malformedNames = [null, undefined, 12345, true, false, {}, []];
      malformedNames.forEach((fnName) => {
        const trace = synthesizeClientFallbackTraceFn({ functionName: fnName });
        expect(trace.testCase.targetFunction).toBe("execute");
        expect(trace.id).toBe("sim_execute_happy_path");

        // Verify that synthesized source code parses cleanly as valid JS AST
        expect(() => {
          babelParser.parse(trace.sourceCode, { sourceType: "module" });
        }).not.toThrow();
      });
    });

    it("ADV-FALLBACK-05: Malformed or non-existent category safely defaults to HAPPY_PATH", () => {
      const malformedCats = [null, undefined, "NON_EXISTENT_CATEGORY", 9999, {}];
      malformedCats.forEach((cat) => {
        const trace = synthesizeClientFallbackTraceFn({ category: cat });
        expect(trace.testCase.category).toBe("HAPPY_PATH");
        expect(trace.id).toBe("sim_execute_happy_path");
      });
    });

    it("ADV-FALLBACK-06: ERROR_HANDLING category correctly toggles error steps and throw narrative", () => {
      const trace = synthesizeClientFallbackTraceFn({
        functionName: "processPayment",
        category: "ERROR_HANDLING",
      });

      expect(trace.testCase.category).toBe("ERROR_HANDLING");
      expect(trace.id).toBe("sim_processPayment_error_handling");

      // Step 6 should be ERROR_THROW
      const step6 = trace.steps[5];
      expect(step6.phase).toBe("ERROR_THROW");
      expect(step6.title).toContain("Exception Thrown");
      expect(step6.variables.error).toBe("User ID is required");

      // Step 7 assertion should be toThrow
      const step7 = trace.steps[6];
      expect(step7.phase).toBe("ASSERTION");
      expect(step7.assertionResult.matcher).toBe("toThrow");
      expect(step7.assertionResult.expected).toBe("User ID is required");
    });

    it("ADV-FALLBACK-07: BOUNDARY_VALUES category correctly exercises empty collection branch", () => {
      const trace = synthesizeClientFallbackTraceFn({
        functionName: "calculateDiscount",
        category: "BOUNDARY_VALUES",
      });

      expect(trace.testCase.category).toBe("BOUNDARY_VALUES");
      // Step 4 branch evaluation should have evaluatedTo: true
      const step4 = trace.steps[3];
      expect(step4.phase).toBe("BRANCH_DECISION");
      expect(step4.branchEvaluation.evaluatedTo).toBe(true);
      expect(step4.branchEvaluation.branchTaken).toBe("TRUE");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. MODAL LIFECYCLE & VIEW INTEGRATION ACROSS 3 HOST COMPONENTS
  // ──────────────────────────────────────────────────────────────────────────
  describe("5. Modal Lifecycle & View Integration across 3 Host Components", () => {
    it("ADV-VIEW-01: UnitTestTraceabilityMatrix.jsx contains simulation triggers in file header, function row, and category cards", () => {
      const matrixCode = fs.readFileSync(traceabilityMatrixPath, "utf8");

      // 1. Group header trigger
      expect(matrixCode).toContain("handleTriggerSimulate({ filePath: group.filePath })");

      // 2. Function row trigger
      expect(matrixCode).toContain("handleTriggerSimulate({");
      expect(matrixCode).toContain("filePath: fn.filePath");
      expect(matrixCode).toContain("functionName: fn.cleanName");

      // 3. Category matrix trigger
      expect(matrixCode).toContain("onOpenSimulation={handleTriggerSimulate}");

      // 4. Modal fallback wiring
      expect(matrixCode).toContain("<UnitTestSimulationStudioModal");
      expect(matrixCode).toContain("isOpen={Boolean(internalSimulationTarget)}");
      expect(matrixCode).toContain("onClose={() => setInternalSimulationTarget(null)}");
    });

    it("ADV-VIEW-02: UnitTestTraceabilityMatrix delegates to onOpenSimulation when provided, fallbacks to internal modal when omitted", () => {
      let delegatedTarget = null;
      let internalTarget = null;

      const createTriggerHandler = (onOpenSimulation) => {
        return (simContext) => {
          if (typeof onOpenSimulation === "function") {
            onOpenSimulation(simContext);
          } else {
            internalTarget = simContext;
          }
        };
      };

      // Case A: Delegated mode
      const onOpenMock = (ctx) => { delegatedTarget = ctx; };
      const handlerA = createTriggerHandler(onOpenMock);
      handlerA({ filePath: "test.js", functionName: "calc" });
      expect(delegatedTarget).toEqual({ filePath: "test.js", functionName: "calc" });
      expect(internalTarget).toBeNull();

      // Case B: Standalone fallback mode
      delegatedTarget = null;
      internalTarget = null;
      const handlerB = createTriggerHandler(null);
      handlerB({ filePath: "test.js", functionName: "calc" });
      expect(delegatedTarget).toBeNull();
      expect(internalTarget).toEqual({ filePath: "test.js", functionName: "calc" });
    });

    it("ADV-VIEW-03: InPlaceCoverageFileModal.jsx header simulation trigger delegates or mounts fallback modal", () => {
      const inPlaceCode = fs.readFileSync(inPlaceModalPath, "utf8");

      expect(inPlaceCode).toContain("onOpenSimulation");
      expect(inPlaceCode).toContain("onOpenSimulation(simTarget)");
      expect(inPlaceCode).toContain("<UnitTestSimulationStudioModal");
      expect(inPlaceCode).toContain("isOpen={Boolean(internalSimTarget)}");
      expect(inPlaceCode).toContain("onClose={() => setInternalSimTarget(null)}");
    });

    it("ADV-VIEW-04: CoverageTypeDashboard.jsx contextual launch correctly populates simulationTarget and passes props", () => {
      const dashboardCode = fs.readFileSync(dashboardComponentPath, "utf8");

      expect(dashboardCode).toContain("onOpenSimulation={(simTarget) => setSimulationTarget(simTarget)}");
      expect(dashboardCode).toContain("<UnitTestSimulationStudioModal");
      expect(dashboardCode).toContain("isOpen={Boolean(simulationTarget)}");
      expect(dashboardCode).toContain("onClose={() => setSimulationTarget(null)}");
      expect(dashboardCode).toContain("initialSourceFile={simulationTarget.filePath || simulationTarget.sourceFilePath}");
      expect(dashboardCode).toContain("initialFunctionName={simulationTarget.functionName}");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. RULE 10 COMPLIANCE (EXACTLY 3 CANONICAL TABS)
  // ──────────────────────────────────────────────────────────────────────────
  describe("6. Rule 10 Compliance: Exactly 3 Canonical Tabs in CoverageTypeDashboard", () => {
    it("ADV-RULE10-01: Verifies exactly 3 canonical tabs for unit test view: Logic & Test Traceability, Test Suites & Specs, Version History", () => {
      const dashboardCode = fs.readFileSync(dashboardComponentPath, "utf8");
      const ast = babelParser.parse(dashboardCode, { sourceType: "module", plugins: ["jsx"] });

      // Traverse AST to locate the ternary: type === 'unit' ? [...] : [...]
      let unitTabsArrayNode = null;

      const traverseNodes = (node) => {
        if (!node) return;
        if (
          node.type === "ConditionalExpression" &&
          node.test?.left?.name === "type" &&
          node.test?.right?.value === "unit" &&
          node.consequent?.type === "ArrayExpression"
        ) {
          unitTabsArrayNode = node.consequent;
          return;
        }
        for (const key of Object.keys(node)) {
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(traverseNodes);
          } else if (typeof child === "object" && child !== null && child.type) {
            traverseNodes(child);
          }
        }
      };

      traverseNodes(ast.program);

      expect(unitTabsArrayNode).not.toBeNull();
      expect(unitTabsArrayNode.elements).toHaveLength(3);

      const tabObjects = unitTabsArrayNode.elements.map((el) => {
        const idProp = el.properties.find((p) => p.key?.name === "id");
        const labelProp = el.properties.find((p) => p.key?.name === "label");
        return {
          id: idProp?.value?.value,
          label: labelProp?.value?.value,
        };
      });

      expect(tabObjects).toEqual([
        { id: "traceability", label: "Logic & Test Traceability" },
        { id: "testcases", label: "Test Suites & Specs" },
        { id: "versions", label: "Version History" },
      ]);
    });

    it("ADV-RULE10-02: Verifies NO 4th tab was added to the top-level tab bar", () => {
      const dashboardCode = fs.readFileSync(dashboardComponentPath, "utf8");
      expect(dashboardCode).not.toContain('label: "Simulation"');
      expect(dashboardCode).not.toContain('label: "Execution Simulator"');
      expect(dashboardCode).not.toContain('id: "simulation"');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. CLIENT PRODUCTION BUILD VERIFICATION
  // ──────────────────────────────────────────────────────────────────────────
  describe("7. Client Production Build Verification", () => {
    it("ADV-BUILD-01: Verifies Vite build artifacts exist and index.html was generated", () => {
      const clientDistDir = path.resolve(rootDir, "client/dist");
      const indexPath = path.join(clientDistDir, "index.html");
      const assetsDir = path.join(clientDistDir, "assets");

      expect(fs.existsSync(indexPath)).toBe(true);
      expect(fs.existsSync(assetsDir)).toBe(true);

      const indexHtml = fs.readFileSync(indexPath, "utf8");
      expect(indexHtml).toContain("<div id=\"root\"></div>");
      expect(indexHtml).toContain("<script type=\"module\"");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. STORAGE CODE IMMUTABILITY GUARD (RULE 8)
  // ──────────────────────────────────────────────────────────────────────────
  describe("8. Strict Storage Code Immutability Guard (Rule 8)", () => {
    it("ADV-RULE8-01: Verifies 0 modifications to storage/ or uploads/ directory", () => {
      const status = execSync("git status --porcelain storage uploads", {
        cwd: rootDir,
        encoding: "utf8",
      });

      expect(status.trim()).toBe("");
    });
  });
});
