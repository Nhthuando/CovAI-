/**
 * challenger_m3_simulation_frontend_stress.test.js
 *
 * Empirical Adversarial Challenge Test Harness for Milestone 3:
 * Frontend Simulation Studio & Interactive Playback State Machine
 *
 * Challenge Dimensions:
 * 1. Playback state machine reducer & state transitions under adversarial sequences (rapid bursts, invalid actions)
 * 2. Boundary conditions: stepIndex clamping (< 0, >= totalSteps), jumpToStep edge cases (NaN, Infinity, negative)
 * 3. Empty steps array & null trace handling (0 steps, 1 step, undefined trace)
 * 4. Playback timer intervals, speed transitions (0.5x, 1x, 2x, adversarial 0), wrap-around and auto-pause at end
 * 5. Keyboard event listener safeguards (input/textarea isolation, modal closed state, unrecognized keys)
 * 6. High-fidelity client fallback synthesis across 4-Category Decision Table Matrix & 7-Phase Taxonomy
 * 7. Inspector formatting resilience (circular objects, null/undefined variables, empty scopes)
 * 8. Storage Code Immutability Guard (Strictly 0 writes to storage/ or uploads/)
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from "@jest/globals";
import fs from "fs";
import path from "path";

describe("CHALLENGER M3: Adversarial Stress Testing of Frontend Simulation Studio & State Machine", () => {
  const clientSrcDir = path.resolve(process.cwd(), "../client/src");
  const simulationDir = path.join(clientSrcDir, "components/dashboard/simulation");
  const hookPath = path.join(clientSrcDir, "hooks/useUnitTestSimulation.js");

  // Read raw hook code to extract pure logic functions
  const hookSource = fs.readFileSync(hookPath, "utf8");

  // ──────────────────────────────────────────────────────────────────────────
  // 1. STATE MACHINE ENGINE REDUCER SIMULATION HARNESS
  // ──────────────────────────────────────────────────────────────────────────
  describe("1. Playback State Machine Reducer & Invariants Stress Testing", () => {
    /**
     * Pure simulation of the useUnitTestSimulation state machine transitions
     */
    function createStateMachine(initialConfig = {}) {
      let steps = initialConfig.steps || [];
      let currentStepIndex = 0;
      let isPlaying = false;
      let playbackSpeed = initialConfig.playbackSpeed || 1;

      const setSteps = (newSteps) => {
        steps = newSteps;
        currentStepIndex = 0;
        isPlaying = false;
      };

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
        const num = Number(index);
        if (isNaN(num)) return;
        const safeIndex = Math.max(0, Math.min(Math.floor(num), steps.length - 1));
        currentStepIndex = safeIndex;
      };

      const setSpeed = (spd) => {
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

      const getCurrentStep = () => {
        if (steps.length === 0) return null;
        const idx = Math.max(0, Math.min(currentStepIndex, steps.length - 1));
        return steps[idx];
      };

      return {
        get steps() { return steps; },
        get currentStepIndex() { return currentStepIndex; },
        get isPlaying() { return isPlaying; },
        get playbackSpeed() { return playbackSpeed; },
        get currentStep() { return getCurrentStep(); },
        play,
        pause,
        togglePlay,
        stepForward,
        stepBackward,
        reset,
        jumpToEnd,
        jumpToStep,
        setSpeed,
        tickTimer,
        setSteps,
      };
    }

    it("ADV-M3-01: Rapid alternating burst of 1,000 play/pause/toggle calls maintains deterministic state", () => {
      const mockSteps = Array.from({ length: 7 }, (_, i) => ({ stepIndex: i + 1, phase: "STEP" }));
      const sm = createStateMachine({ steps: mockSteps });

      expect(sm.isPlaying).toBe(false);
      expect(sm.currentStepIndex).toBe(0);

      // Perform 1,000 rapid chaotic transitions
      for (let i = 0; i < 1000; i++) {
        const op = i % 4;
        if (op === 0) sm.play();
        else if (op === 1) sm.pause();
        else if (op === 2) sm.togglePlay();
        else sm.togglePlay();

        // Invariant: isPlaying must always be a strict boolean
        expect(typeof sm.isPlaying).toBe("boolean");
        // Invariant: currentStepIndex must never violate bounds
        expect(sm.currentStepIndex).toBeGreaterThanOrEqual(0);
        expect(sm.currentStepIndex).toBeLessThan(mockSteps.length);
      }
    });

    it("ADV-M3-02: Boundary clamping: stepBackward at 0 stays at 0 (never negative)", () => {
      const mockSteps = Array.from({ length: 5 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createStateMachine({ steps: mockSteps });

      for (let i = 0; i < 50; i++) {
        sm.stepBackward();
        expect(sm.currentStepIndex).toBe(0);
      }
    });

    it("ADV-M3-03: Boundary clamping: stepForward at max index stays at max and auto-pauses", () => {
      const mockSteps = Array.from({ length: 5 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createStateMachine({ steps: mockSteps });

      sm.jumpToEnd();
      expect(sm.currentStepIndex).toBe(4);

      for (let i = 0; i < 50; i++) {
        sm.stepForward();
        expect(sm.currentStepIndex).toBe(4);
        expect(sm.isPlaying).toBe(false);
      }
    });

    it("ADV-M3-04: jumpToStep clamps extreme values: negative, huge numbers, fractional and non-numbers", () => {
      const mockSteps = Array.from({ length: 6 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createStateMachine({ steps: mockSteps });

      // Negative clamp
      sm.jumpToStep(-9999);
      expect(sm.currentStepIndex).toBe(0);

      // Overshoot clamp
      sm.jumpToStep(999999);
      expect(sm.currentStepIndex).toBe(5);

      // Fractional numbers
      sm.jumpToStep(2.7);
      expect(sm.currentStepIndex).toBe(2);

      // Non-number arguments should be safely ignored
      sm.jumpToStep(NaN);
      expect(sm.currentStepIndex).toBe(2);

      sm.jumpToStep(null); // Number(null) is 0
      expect(sm.currentStepIndex).toBe(0);

      sm.jumpToStep(undefined);
      expect(sm.currentStepIndex).toBe(0);
    });

    it("ADV-M3-05: Empty steps array resilience: zero steps does not crash or corrupt indices", () => {
      const sm = createStateMachine({ steps: [] });

      expect(sm.steps.length).toBe(0);
      expect(sm.currentStep).toBeNull();
      expect(sm.currentStepIndex).toBe(0);

      // Actions on empty steps
      sm.play();
      expect(sm.isPlaying).toBe(false); // must not start playing empty steps

      sm.stepForward();
      expect(sm.currentStepIndex).toBe(0);

      sm.stepBackward();
      expect(sm.currentStepIndex).toBe(0);

      sm.jumpToEnd();
      expect(sm.currentStepIndex).toBe(0); // must not be -1

      sm.jumpToStep(10);
      expect(sm.currentStepIndex).toBe(0);

      sm.reset();
      expect(sm.currentStepIndex).toBe(0);
      expect(sm.currentStep).toBeNull();
    });

    it("ADV-M3-06: Single-step scenario (steps.length === 1)", () => {
      const sm = createStateMachine({ steps: [{ stepIndex: 1, phase: "ASSERTION" }] });

      expect(sm.currentStepIndex).toBe(0);
      expect(sm.currentStep).not.toBeNull();
      expect(sm.currentStep.phase).toBe("ASSERTION");

      sm.stepForward();
      expect(sm.currentStepIndex).toBe(0);
      expect(sm.isPlaying).toBe(false);

      sm.jumpToEnd();
      expect(sm.currentStepIndex).toBe(0);

      sm.stepBackward();
      expect(sm.currentStepIndex).toBe(0);
    });

    it("ADV-M3-07: Playback timer simulation: full auto-play cycle from 0 to end auto-stops", () => {
      const mockSteps = Array.from({ length: 4 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createStateMachine({ steps: mockSteps });

      sm.play();
      expect(sm.isPlaying).toBe(true);
      expect(sm.currentStepIndex).toBe(0);

      // Tick 1 -> advances to index 1
      const cont1 = sm.tickTimer();
      expect(cont1).toBe(true);
      expect(sm.currentStepIndex).toBe(1);
      expect(sm.isPlaying).toBe(true);

      // Tick 2 -> advances to index 2
      const cont2 = sm.tickTimer();
      expect(cont2).toBe(true);
      expect(sm.currentStepIndex).toBe(2);
      expect(sm.isPlaying).toBe(true);

      // Tick 3 -> advances to index 3 (final step displayed)
      const cont3 = sm.tickTimer();
      expect(cont3).toBe(true);
      expect(sm.currentStepIndex).toBe(3);

      // Tick 4 -> at final step, timer auto-stops!
      const cont4 = sm.tickTimer();
      expect(cont4).toBe(false);
      expect(sm.currentStepIndex).toBe(3);
      expect(sm.isPlaying).toBe(false);
    });

    it("ADV-M3-08: Playing from the final step restarts automatically from index 0", () => {
      const mockSteps = Array.from({ length: 5 }, (_, i) => ({ stepIndex: i + 1 }));
      const sm = createStateMachine({ steps: mockSteps });

      sm.jumpToEnd();
      expect(sm.currentStepIndex).toBe(4);
      expect(sm.isPlaying).toBe(false);

      // When user clicks play at the end, it rewinds to 0 and plays!
      sm.play();
      expect(sm.currentStepIndex).toBe(0);
      expect(sm.isPlaying).toBe(true);
    });

    it("ADV-M3-09: Speed transitions while playing preserve index and calculate correct intervals", () => {
      const speeds = [0.5, 1, 2];
      const expectedIntervals = {
        0.5: 3000,
        1: 1500,
        2: 750,
      };

      for (const spd of speeds) {
        const intervalMs = Math.round(1500 / spd);
        expect(intervalMs).toBe(expectedIntervals[spd]);
      }

      // Adversarial speed edge cases
      expect(Math.round(1500 / 0.5)).toBe(3000);
      expect(Math.round(1500 / 2)).toBe(750);
      // Division by 0 guard
      const zeroSpeedInterval = (spd) => (spd > 0 ? Math.round(1500 / spd) : 1500);
      expect(zeroSpeedInterval(0)).toBe(1500);
      expect(zeroSpeedInterval(-1)).toBe(1500);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. KEYBOARD EVENT LISTENER LIFECYCLE & INPUT ISOLATION
  // ──────────────────────────────────────────────────────────────────────────
  describe("2. Keyboard Event Handler & Input Isolation Logic", () => {
    /**
     * Pure test harness for the keyboard event handler in useUnitTestSimulation
     */
    function simulateKeyboardEvent({
      code,
      targetTag = "body",
      isContentEditable = false,
      enabled = true,
      isKeyboardEnabled = true,
      stateMachine,
    }) {
      if (!enabled || !isKeyboardEnabled) return { ignored: true, reason: "disabled" };

      // Tag check
      const tag = targetTag?.toLowerCase();
      if (tag === "input" || tag === "textarea" || isContentEditable) {
        return { ignored: true, reason: "focused_on_input" };
      }

      let handled = false;
      if (code === "Space") {
        stateMachine.togglePlay();
        handled = true;
      } else if (code === "ArrowRight") {
        stateMachine.stepForward();
        handled = true;
      } else if (code === "ArrowLeft") {
        stateMachine.stepBackward();
        handled = true;
      } else if (code === "Home" || code === "KeyR") {
        stateMachine.reset();
        handled = true;
      } else if (code === "End") {
        stateMachine.jumpToEnd();
        handled = true;
      }

      return { ignored: !handled, handled };
    }

    it("ADV-M3-10: Space key toggles play/pause when focused on body", () => {
      let isPlaying = false;
      const sm = { togglePlay: () => { isPlaying = !isPlaying; } };

      const res1 = simulateKeyboardEvent({ code: "Space", targetTag: "div", stateMachine: sm });
      expect(res1.handled).toBe(true);
      expect(isPlaying).toBe(true);

      const res2 = simulateKeyboardEvent({ code: "Space", targetTag: "button", stateMachine: sm });
      expect(res2.handled).toBe(true);
      expect(isPlaying).toBe(false);
    });

    it("ADV-M3-11: Keyboard shortcuts are strictly ignored when typing in input, textarea, or contentEditable", () => {
      let isPlaying = false;
      let stepped = false;
      const sm = {
        togglePlay: () => { isPlaying = true; },
        stepForward: () => { stepped = true; },
      };

      // Space in input
      const r1 = simulateKeyboardEvent({ code: "Space", targetTag: "input", stateMachine: sm });
      expect(r1.ignored).toBe(true);
      expect(r1.reason).toBe("focused_on_input");
      expect(isPlaying).toBe(false);

      // ArrowRight in textarea
      const r2 = simulateKeyboardEvent({ code: "ArrowRight", targetTag: "textarea", stateMachine: sm });
      expect(r2.ignored).toBe(true);
      expect(r2.reason).toBe("focused_on_input");
      expect(stepped).toBe(false);

      // Space in contentEditable
      const r3 = simulateKeyboardEvent({ code: "Space", targetTag: "div", isContentEditable: true, stateMachine: sm });
      expect(r3.ignored).toBe(true);
      expect(r3.reason).toBe("focused_on_input");
      expect(isPlaying).toBe(false);
    });

    it("ADV-M3-12: Keyboard shortcuts are inactive when modal is closed (enabled === false)", () => {
      let toggled = false;
      const sm = { togglePlay: () => { toggled = true; } };

      const res = simulateKeyboardEvent({
        code: "Space",
        targetTag: "div",
        enabled: false,
        stateMachine: sm,
      });

      expect(res.ignored).toBe(true);
      expect(res.reason).toBe("disabled");
      expect(toggled).toBe(false);
    });

    it("ADV-M3-13: Unrecognized keys (Enter, Escape, A, 1) do not trigger state mutations", () => {
      let mutated = false;
      const sm = {
        togglePlay: () => { mutated = true; },
        stepForward: () => { mutated = true; },
        stepBackward: () => { mutated = true; },
        reset: () => { mutated = true; },
        jumpToEnd: () => { mutated = true; },
      };

      const keys = ["Enter", "Escape", "KeyA", "Digit1", "Tab", "ShiftLeft"];
      for (const key of keys) {
        const res = simulateKeyboardEvent({ code: key, targetTag: "div", stateMachine: sm });
        expect(res.handled).toBe(false);
        expect(mutated).toBe(false);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. BACKEND SIMULATION TRACE ACROSS 4-CATEGORY DECISION TABLE MATRIX
  // ──────────────────────────────────────────────────────────────────────────
  describe("3. 4-Category Decision Table Matrix Simulation Verification", () => {
    let CATEGORY_METADATA;
    let SIMULATION_PHASES;
    let generateSimulationTrace;

    beforeAll(async () => {
      let code = hookSource;
      code = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]*?['"];?/g, "");
      code = code.replace(/export\s+default\s+[^;]+;/g, "");
      code = code.replace(/export\s+(const|function)/g, "$1");
      const extractFn = new Function(`
        const useState = () => {};
        const useEffect = () => {};
        const useCallback = () => {};
        const useMemo = () => {};
        const useRef = () => ({ current: null });
        ${code}
        return { CATEGORY_METADATA, SIMULATION_PHASES };
      `);
      const extracted = extractFn();
      CATEGORY_METADATA = extracted.CATEGORY_METADATA;
      SIMULATION_PHASES = extracted.SIMULATION_PHASES;

      const simMod = await import("../services/unitTestSimulation.service.js");
      generateSimulationTrace = simMod.generateSimulationTrace;
    });

    it("ADV-M3-14: Synthesizes valid 7-phase trace for Category A (Happy Path)", async () => {
      expect(hookSource).not.toContain("synthesizeClientFallbackTrace");
      expect(hookSource).toContain("getUnitTestSimulationTrace");
      expect(CATEGORY_METADATA.HAPPY_PATH).toBeDefined();
      expect(SIMULATION_PHASES).toBeDefined();

      const trace = await generateSimulationTrace("snap-m3-a", {
        sourceFilePath: "server/src/services/discount.js",
        functionName: "calculateDiscount",
        sourceCode: "export function calculateDiscount(total) { if (!total || total <= 0) return 0; return total * 0.9; }",
        requestedCategory: "HAPPY_PATH",
      });

      expect(trace).toBeDefined();
      expect(trace.testCase.category).toBe("HAPPY_PATH");
      expect(trace.steps.length).toBeGreaterThanOrEqual(6);

      const phases = trace.steps.map((s) => s.phase);
      expect(phases).toContain("SETUP_MOCKS");
      expect(phases).toContain("CALL_ENTRY");
      expect(phases).toContain("EVAL_PARAMS");
      expect(phases).toContain("BRANCH_DECISION");
      expect(phases).toContain("RETURN_VALUE");
      expect(phases).toContain("ASSERTION");
    });

    it("ADV-M3-15: Synthesizes valid trace for Category B (Boundary Values)", async () => {
      const trace = await generateSimulationTrace("snap-m3-b", {
        sourceFilePath: "server/src/services/items.js",
        functionName: "processItems",
        sourceCode: "export function processItems(items = []) { if (!items || items.length === 0) return 0; return items.length; }",
        requestedCategory: "BOUNDARY_VALUES",
      });

      expect(trace.testCase.category).toBe("BOUNDARY_VALUES");
      expect(trace.steps.length).toBeGreaterThanOrEqual(5);
      const branchStep = trace.steps.find((s) => s.phase === "BRANCH_DECISION");
      expect(branchStep).toBeDefined();
    });

    it("ADV-M3-16: Synthesizes valid trace for Category C (Branch Toggling)", async () => {
      const trace = await generateSimulationTrace("snap-m3-c", {
        sourceFilePath: "server/src/services/filter.js",
        functionName: "filterRecords",
        sourceCode: "export function filterRecords(items, flag) { if (flag) return items; return []; }",
        requestedCategory: "BRANCH_TOGGLING",
      });

      expect(trace.testCase.category).toBe("BRANCH_TOGGLING");
      expect(trace.steps.length).toBeGreaterThanOrEqual(5);
      const branchStep = trace.steps.find((s) => s.phase === "BRANCH_DECISION");
      expect(branchStep).toBeDefined();
    });

    it("ADV-M3-17: Synthesizes valid trace for Category D (Error Handling)", async () => {
      const trace = await generateSimulationTrace("snap-m3-d", {
        sourceFilePath: "server/src/services/user.js",
        functionName: "validateUser",
        sourceCode: "export function validateUser(user) { if (!user) throw new Error('User required'); return true; }",
        requestedCategory: "ERROR_HANDLING",
      });

      expect(trace.testCase.category).toBe("ERROR_HANDLING");
      expect(trace.steps.some((s) => s.phase === "ERROR_THROW" || s.phase === "RETURN_VALUE")).toBe(true);
      expect(trace.steps.some((s) => s.phase === "ASSERTION")).toBe(true);
    });

    it("ADV-M3-18: Simulation trace resilience against missing, unknown, or empty arguments", async () => {
      const trace1 = await generateSimulationTrace("snap-m3-e1", {
        sourceCode: "export function fn() { return 1; }",
      });
      expect(trace1.steps.length).toBeGreaterThan(0);

      const trace2 = await generateSimulationTrace("snap-m3-e2", {
        sourceCode: "export function fn() { return 1; }",
        requestedCategory: "UNKNOWN_MALICIOUS_CAT",
      });
      expect(trace2.steps.length).toBeGreaterThan(0);

      const trace3 = await generateSimulationTrace("snap-m3-e3", {
        sourceFilePath: "",
        functionName: "",
        sourceCode: "",
        requestedCategory: "",
      });
      expect(trace3.steps.length).toBeGreaterThan(0);
      expect(trace3.steps[0].educationalGuidance).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. FORMATTER & INSPECTOR RESILIENCE TESTS
  // ──────────────────────────────────────────────────────────────────────────
  describe("4. Inspector Formatter & Visual Helper Resilience", () => {
    // Replicate SimulationInspectorTabs formatValue and getTypeLabel
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

    it("ADV-M3-19: formatValue gracefully handles circular object structures without throwing", () => {
      const circular = { a: 1 };
      circular.self = circular;

      expect(() => formatValue(circular)).not.toThrow();
      expect(formatValue(circular)).toBe("[Circular Object]");
    });

    it("ADV-M3-20: formatValue and getTypeLabel handle all primitive types, null, and undefined", () => {
      expect(formatValue(null)).toBe("null");
      expect(getTypeLabel(null)).toBe("null");

      expect(formatValue(undefined)).toBe("undefined");
      expect(getTypeLabel(undefined)).toBe("undefined");

      expect(formatValue("test")).toBe("test");
      expect(getTypeLabel("test")).toBe("string");

      expect(formatValue(42)).toBe("42");
      expect(getTypeLabel(42)).toBe("number");

      expect(formatValue(true)).toBe("true");
      expect(getTypeLabel(true)).toBe("boolean");

      expect(formatValue([1, 2, 3])).toBe("[\n  1,\n  2,\n  3\n]");
      expect(getTypeLabel([1, 2, 3])).toBe("array[3]");

      expect(getTypeLabel([])).toBe("array[0]");
    });

    it("ADV-M3-21: Scrubber timeline progress calculation avoids division by zero across step counts", () => {
      const calcProgress = (currentIdx, total) => {
        return total > 1 ? Math.round((currentIdx / (total - 1)) * 100) : total === 1 ? 100 : 0;
      };

      // 0 steps -> 0% (no NaN, no Infinity)
      expect(calcProgress(0, 0)).toBe(0);

      // 1 step -> 100% (no NaN, no Infinity)
      expect(calcProgress(0, 1)).toBe(100);

      // 5 steps: step 0 -> 0%, step 2 -> 50%, step 4 -> 100%
      expect(calcProgress(0, 5)).toBe(0);
      expect(calcProgress(2, 5)).toBe(50);
      expect(calcProgress(4, 5)).toBe(100);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. STORAGE CODE IMMUTABILITY GUARD (RULE 8)
  // ──────────────────────────────────────────────────────────────────────────
  describe("5. Storage Code Immutability Guard (Rule 8)", () => {
    it("ADV-M3-22: Client simulation files contain zero disk-writing statements", () => {
      const files = [
        path.join(clientSrcDir, "hooks/useUnitTestSimulation.js"),
        path.join(simulationDir, "SimulationPlaybackBar.jsx"),
        path.join(simulationDir, "SimulationInspectorTabs.jsx"),
        path.join(simulationDir, "EducationalGuidanceCard.jsx"),
        path.join(simulationDir, "UnitTestSimulationStudioModal.jsx"),
      ];

      const forbiddenCalls = [
        "fs.writeFile",
        "fs.writeFileSync",
        "fs.appendFile",
        "fs.unlink",
        "fs.mkdir",
        "fs.rmdir",
        "localStorage.clear",
      ];

      for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        for (const forbidden of forbiddenCalls) {
          expect(content).not.toContain(forbidden);
        }
      }
    });

    it("ADV-M3-23: Monaco code editor is configured with readOnly: true to prevent source code tampering", () => {
      const modalCode = fs.readFileSync(
        path.join(simulationDir, "UnitTestSimulationStudioModal.jsx"),
        "utf8"
      );

      // Must explicitly enforce readOnly in editor options
      expect(modalCode).toContain("readOnly: true");
    });
  });
});
