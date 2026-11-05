/**
 * simulationFrontendContracts.test.js
 * 
 * Verifies Milestone 3: Frontend Simulation Studio & Interactive Controls
 * - Component file existence and Babel AST syntax validation
 * - 4-Category Decision Table Matrix metadata contracts
 * - 7-Phase (+ Error Throw) Simulation Taxonomy alignment
 * - Component props contracts and Monaco editor configuration
 * - Storage Immutability Guard (Rule 8)
 */

import fs from "fs";
import path from "path";
import * as babelParser from "@babel/parser";

describe("Milestone 3: Frontend Simulation Studio Contracts", () => {
  const clientSrcDir = path.resolve(process.cwd(), "../client/src");
  const simulationDir = path.join(clientSrcDir, "components/dashboard/simulation");
  const hookPath = path.join(clientSrcDir, "hooks/useUnitTestSimulation.js");

  const filesToCheck = [
    { name: "useUnitTestSimulation.js", path: hookPath, isJsx: false },
    { name: "SimulationPlaybackBar.jsx", path: path.join(simulationDir, "SimulationPlaybackBar.jsx"), isJsx: true },
    { name: "SimulationInspectorTabs.jsx", path: path.join(simulationDir, "SimulationInspectorTabs.jsx"), isJsx: true },
    { name: "EducationalGuidanceCard.jsx", path: path.join(simulationDir, "EducationalGuidanceCard.jsx"), isJsx: true },
    { name: "UnitTestSimulationStudioModal.jsx", path: path.join(simulationDir, "UnitTestSimulationStudioModal.jsx"), isJsx: true },
    { name: "index.js", path: path.join(simulationDir, "index.js"), isJsx: false },
  ];

  test("TEST-M3-01: All Milestone 3 deliverable files exist on disk", () => {
    for (const f of filesToCheck) {
      expect(fs.existsSync(f.path)).toBe(true);
      const stat = fs.statSync(f.path);
      expect(stat.size).toBeGreaterThan(100);
    }
  });

  test("TEST-M3-02: All frontend simulation files parse with Babel (0 syntax errors)", () => {
    for (const f of filesToCheck) {
      const code = fs.readFileSync(f.path, "utf8");
      expect(() => {
        babelParser.parse(code, {
          sourceType: "module",
          plugins: f.isJsx ? ["jsx"] : [],
        });
      }).not.toThrow();
    }
  });

  test("TEST-M3-03: useUnitTestSimulation exports CATEGORY_METADATA and SIMULATION_PHASES", () => {
    const hookCode = fs.readFileSync(hookPath, "utf8");
    expect(hookCode).toContain("export const CATEGORY_METADATA");
    expect(hookCode).toContain("HAPPY_PATH");
    expect(hookCode).toContain("BOUNDARY_VALUES");
    expect(hookCode).toContain("BRANCH_TOGGLING");
    expect(hookCode).toContain("ERROR_HANDLING");

    expect(hookCode).toContain("export const SIMULATION_PHASES");
    expect(hookCode).toContain("SETUP_MOCKS");
    expect(hookCode).toContain("CALL_ENTRY");
    expect(hookCode).toContain("EVAL_PARAMS");
    expect(hookCode).toContain("BRANCH_DECISION");
    expect(hookCode).toContain("MOCK_INTERACTION");
    expect(hookCode).toContain("RETURN_VALUE");
    expect(hookCode).toContain("ERROR_THROW");
    expect(hookCode).toContain("ASSERTION");
  });

  test("TEST-M3-04: Hook provides complete playback state machine and actions contract", () => {
    const hookCode = fs.readFileSync(hookPath, "utf8");
    // State items
    expect(hookCode).toContain("selectedSourceFile");
    expect(hookCode).toContain("selectedTestFile");
    expect(hookCode).toContain("selectedTestCaseId");
    expect(hookCode).toContain("selectedFunctionName");
    expect(hookCode).toContain("selectedCategory");
    expect(hookCode).toContain("activeCodeView");
    expect(hookCode).toContain("currentStepIndex");
    expect(hookCode).toContain("isPlaying");
    expect(hookCode).toContain("playbackSpeed");
    expect(hookCode).toContain("simulationTrace");
    expect(hookCode).toContain("currentStep");

    // Action methods
    expect(hookCode).toContain("play");
    expect(hookCode).toContain("pause");
    expect(hookCode).toContain("togglePlay");
    expect(hookCode).toContain("stepForward");
    expect(hookCode).toContain("stepBackward");
    expect(hookCode).toContain("reset");
    expect(hookCode).toContain("jumpToEnd");
    expect(hookCode).toContain("jumpToStep");
    expect(hookCode).toContain("setPlaybackSpeed");
    expect(hookCode).toContain("setActiveCodeView");
  });

  test("TEST-M3-05: SimulationPlaybackBar contains scrubber and control buttons", () => {
    const barCode = fs.readFileSync(path.join(simulationDir, "SimulationPlaybackBar.jsx"), "utf8");
    expect(barCode).toContain("onPlay");
    expect(barCode).toContain("onPause");
    expect(barCode).toContain("onStepForward");
    expect(barCode).toContain("onStepBackward");
    expect(barCode).toContain("onReset");
    expect(barCode).toContain("onJumpToEnd");
    expect(barCode).toContain("onJumpToStep");
    expect(barCode).toContain("onSetSpeed");
    expect(barCode).toContain("progressPct");
    expect(barCode).toContain("getPhaseColor");
  });

  test("TEST-M3-06: SimulationInspectorTabs supports 4 inspection panels", () => {
    const tabsCode = fs.readFileSync(path.join(simulationDir, "SimulationInspectorTabs.jsx"), "utf8");
    expect(tabsCode).toContain('activeTab === "guidance"');
    expect(tabsCode).toContain('activeTab === "variables"');
    expect(tabsCode).toContain('activeTab === "mocks"');
    expect(tabsCode).toContain('activeTab === "assertions"');
    expect(tabsCode).toContain("Universal RAM Mock Isolation");
    expect(tabsCode).toContain("Call Stack");
  });

  test("TEST-M3-07: EducationalGuidanceCard aligns with 4-Category Decision Table Matrix", () => {
    const cardCode = fs.readFileSync(path.join(simulationDir, "EducationalGuidanceCard.jsx"), "utf8");
    expect(cardCode).toContain("Execution Flow");
    expect(cardCode).toContain("Decision Logic");
    expect(cardCode).toContain("Developer Learning Note");
  });

  test("TEST-M3-08: UnitTestSimulationStudioModal conforms to M3 <-> M4 props contract", () => {
    const modalCode = fs.readFileSync(path.join(simulationDir, "UnitTestSimulationStudioModal.jsx"), "utf8");
    expect(modalCode).toContain("isOpen");
    expect(modalCode).toContain("onClose");
    expect(modalCode).toContain("snapshotId");
    expect(modalCode).toContain("initialSourceFile");
    expect(modalCode).toContain("initialTestFile");
    expect(modalCode).toContain("initialTestCaseId");
    expect(modalCode).toContain("initialFunctionName");
    expect(modalCode).toContain("initialTestCode");
    expect(modalCode).toContain("isLight");

    // Monaco integration & decorations
    expect(modalCode).toContain("MonacoEditor");
    expect(modalCode).toContain("deltaDecorations");
    expect(modalCode).toContain("monaco-sim-active-line");
    expect(modalCode).toContain("monaco-sim-branch-true");
    expect(modalCode).toContain("monaco-sim-branch-false");
    expect(modalCode).toContain("revealLineInCenter");

    // Immutability Guard: readOnly: true
    expect(modalCode).toContain("readOnly: true");
  });

  test("TEST-M3-09: Storage Code Immutability Guard — zero writes to storage/ or uploads/", () => {
    // Audit that no component performs write operations to storage/ or uploads/
    for (const f of filesToCheck) {
      const content = fs.readFileSync(f.path, "utf8");
      expect(content).not.toContain("fs.writeFileSync");
      expect(content).not.toContain("fs.writeFile");
      expect(content).not.toContain("fs.unlinkSync");
      expect(content).not.toContain("rmdir");
    }
  });
});
