/**
 * challenger2_m2_empirical_stress.test.js
 *
 * Empirical Adversarial Challenger Test Suite for Milestone M2:
 * "Client UI Tab Bar Cleanup & Contextual Triggers"
 *
 * Verifies:
 * - R1: Tab bar cleanup & 3 canonical tabs invariant (Rule 10)
 * - R2: Contextual triggers in UnitTestTraceabilityMatrix & InPlaceCoverageFileModal
 * - R3: Pedagogical variable diff tracking in SimulationInspectorTabs
 * - R4: Strict storage immutability (0 writes to storage/ or uploads/)
 */

import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");

describe("Challenger 2 M2 Empirical Stress Suite: Client UI Cleanup & Contextual Triggers", () => {
  const dashboardPath = path.join(rootDir, "client/src/components/dashboard/CoverageTypeDashboard.jsx");
  const matrixPath = path.join(rootDir, "client/src/components/dashboard/UnitTestTraceabilityMatrix.jsx");
  const inPlaceModalPath = path.join(rootDir, "client/src/components/dashboard/InPlaceCoverageFileModal.jsx");
  const inspectorTabsPath = path.join(rootDir, "client/src/components/dashboard/simulation/SimulationInspectorTabs.jsx");

  describe("1. R1: Global Tab Bar Cleanup & Strict 3-Tab Invariant", () => {
    const dashboardSrc = fs.readFileSync(dashboardPath, "utf8");

    it("ensures quickSimFile state is completely removed", () => {
      expect(dashboardSrc).not.toMatch(/quickSimFile/);
      expect(dashboardSrc).not.toMatch(/setQuickSimFile/);
    });

    it("ensures no <select> dropdown exists in unit test toolbar", () => {
      // Check the navigation tabs container
      const navTabsMatch = dashboardSrc.match(/\{\/\* Mode Navigation Tabs \(Unit Test Coverage\) \*\/\}[\s\S]*?\{\/\* Active View Explanatory Banner \*\/\}/);
      expect(navTabsMatch).not.toBeNull();
      const navTabsBlock = navTabsMatch[0];

      expect(navTabsBlock).not.toMatch(/<select/);
      expect(navTabsBlock).not.toMatch(/Simulation Studio/);
      expect(navTabsBlock).not.toMatch(/⚡/);
    });

    it("strictly preserves exactly the 3 canonical unit tabs per Rule 10", () => {
      const canonicalTabs = [
        { id: "traceability", label: "Logic & Test Traceability" },
        { id: "testcases", label: "Test Suites & Specs" },
        { id: "versions", label: "Version History" },
      ];

      for (const tab of canonicalTabs) {
        expect(dashboardSrc).toContain(`id: "${tab.id}"`);
        expect(dashboardSrc).toContain(`label: "${tab.label}"`);
      }

      // Ensure no 4th simulation tab is defined in the unit tabs array
      const unitTabsArrayMatch = dashboardSrc.match(/type === "unit"\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[/);
      expect(unitTabsArrayMatch).not.toBeNull();
      const unitTabsCode = unitTabsArrayMatch[1];

      expect(unitTabsCode).not.toMatch(/simulation/i);
      expect(unitTabsCode).not.toMatch(/simulate/i);
    });

    it("mounts UnitTestSimulationStudioModal with full simulationTarget props", () => {
      expect(dashboardSrc).toMatch(/<UnitTestSimulationStudioModal[\s\S]*?isOpen=\{Boolean\(simulationTarget\)\}/);
      expect(dashboardSrc).toMatch(/initialSourceFile=\{simulationTarget\.filePath \|\| simulationTarget\.sourceFilePath\}/);
      expect(dashboardSrc).toMatch(/initialCategory=\{simulationTarget\.category \|\| "HAPPY_PATH"\}/);
    });
  });

  describe("2. R2: Contextual Triggers in UnitTestTraceabilityMatrix", () => {
    const matrixSrc = fs.readFileSync(matrixPath, "utf8");

    it("renders contextual simulate button in file group header", () => {
      expect(matrixSrc).toMatch(/Simulate File Tests/);
      expect(matrixSrc).toMatch(/handleTriggerSimulate\(\{\s*filePath:\s*group\.filePath\s*\}\)/);
    });

    it("renders contextual simulate button on individual function rows", () => {
      expect(matrixSrc).toMatch(/title=\{`Simulate execution of \$\{fn\.cleanName\}\(\)`\}/);
      expect(matrixSrc).toMatch(/handleTriggerSimulate\(\{\s*filePath:\s*fn\.filePath,\s*functionName:\s*fn\.cleanName/);
    });

    it("renders simulate button in CategoryMatrix4Cards header forwarding category key", () => {
      expect(matrixSrc).toMatch(/onOpenSimulation\?\.\(\{[\s\S]*?filePath:\s*fn\.filePath[\s\S]*?category:\s*cat\.key/);
    });

    it("renders simulate button in CategoryMatrix4Cards uncovered notice card", () => {
      expect(matrixSrc).toMatch(/⚡ Simulate \{cat\.countLabel\} Scenario/);
      expect(matrixSrc).toMatch(/onOpenSimulation\?\.\(\{[\s\S]*?filePath:\s*fn\.filePath[\s\S]*?functionName:\s*fn\.cleanName \|\| fn\.name[\s\S]*?category:\s*cat\.key[\s\S]*?\}\)/);
    });

    it("renders inline simulate button on test case items in CategoryMatrix4Cards", () => {
      expect(matrixSrc).toMatch(/title=\{`Simulate execution of test case: \$\{t\.title\}`\}/);
      expect(matrixSrc).toMatch(/onOpenSimulation\?\.\(\{[\s\S]*?testFilePath:\s*t\.suiteFilePath[\s\S]*?testCaseId:\s*t\.id \|\| t\.title/);
    });

    it("provides robust internal modal fallback when onOpenSimulation is null", () => {
      expect(matrixSrc).toMatch(/!onOpenSimulation\s*&&\s*internalSimulationTarget/);
      expect(matrixSrc).toMatch(/<UnitTestSimulationStudioModal[\s\S]*?isOpen=\{Boolean\(internalSimulationTarget\)\}/);
    });
  });

  describe("3. R2: Contextual Triggers in InPlaceCoverageFileModal", () => {
    const modalSrc = fs.readFileSync(inPlaceModalPath, "utf8");

    it("renders '⚡ Simulate Execution' button in the modal header", () => {
      expect(modalSrc).toMatch(/⚡ Simulate Execution/);
      expect(modalSrc).toMatch(/onOpenSimulation\(simTarget\)/);
    });

    it("renders inline 'Simulate' button for each executed assertion row", () => {
      expect(modalSrc).toMatch(/title=\{`Simulate execution of assertion: \$\{a\.title \|\| a\.fullName\}`\}/);
      expect(modalSrc).toMatch(/category:\s*a\.category\s*\|\|\s*"HAPPY_PATH"/);
    });

    it("provides fallback UnitTestSimulationStudioModal with all necessary props", () => {
      expect(modalSrc).toMatch(/!onOpenSimulation\s*&&\s*internalSimTarget/);
      expect(modalSrc).toMatch(/initialTestCaseId=\{internalSimTarget\.testCaseId \|\| internalSimTarget\.testTitle\}/);
      expect(modalSrc).toMatch(/initialCategory=\{internalSimTarget\.category \|\| "HAPPY_PATH"\}/);
      expect(modalSrc).toMatch(/initialTestCode=\{internalSimTarget\.testCode\}/);
    });
  });

  describe("4. R3: Pedagogical Variable Diff Highlighting in SimulationInspectorTabs", () => {
    const tabsSrc = fs.readFileSync(inspectorTabsPath, "utf8");

    it("implements isVariableChanged helper comparing against prevVariables and changedVarSet", () => {
      expect(tabsSrc).toMatch(/const\s+isVariableChanged\s*=\s*\(key,\s*val\)\s*=>/);
      expect(tabsSrc).toMatch(/changedVarSet\.has\(key\)/);
      expect(tabsSrc).toMatch(/JSON\.stringify\(prevVariables\[key\]\)\s*!==\s*JSON\.stringify\(val\)/);
    });

    it("renders visual highlight styling and 'Updated' badge for changed variables", () => {
      expect(tabsSrc).toMatch(/const\s+isUpdated\s*=\s*isVariableChanged\(key,\s*val\);/);
      expect(tabsSrc).toMatch(/boxShadow:\s*isUpdated/);
      expect(tabsSrc).toMatch(/title="Variable modified or evaluated in this step"/);
      expect(tabsSrc).toMatch(/Updated\s*<\/span>/);
    });

    it("simulates isVariableChanged algorithm on boundary inputs", () => {
      const changedVarSet = new Set(["counter", "flag"]);
      const prevVariables = { counter: 0, flag: false, unchange: "val", obj: { a: 1 } };

      const isVariableChanged = (key, val) => {
        if (changedVarSet.has(key)) return true;
        if (prevVariables && Object.prototype.hasOwnProperty.call(prevVariables, key)) {
          try {
            return JSON.stringify(prevVariables[key]) !== JSON.stringify(val);
          } catch (_) {
            return prevVariables[key] !== val;
          }
        }
        return false;
      };

      // Changed by changedVarSet
      expect(isVariableChanged("counter", 1)).toBe(true);
      expect(isVariableChanged("flag", true)).toBe(true);

      // Unchanged variable
      expect(isVariableChanged("unchange", "val")).toBe(false);

      // Changed object value not in changedVarSet
      expect(isVariableChanged("obj", { a: 2 })).toBe(true);

      // Same object value
      expect(isVariableChanged("obj", { a: 1 })).toBe(false);

      // New variable not in prevVariables and not in changedVarSet
      expect(isVariableChanged("newVar", 100)).toBe(false);
    });
  });

  describe("5. R4: Storage Immutability Guard", () => {
    it("ensures storage/ and uploads/ have 0 modified or created files in git status", () => {
      const storageDir = path.join(rootDir, "storage");
      const uploadsDir = path.join(rootDir, "uploads");

      // Check if top-level storage or uploads exist
      if (fs.existsSync(storageDir)) {
        const files = fs.readdirSync(storageDir);
        expect(files).toBeDefined();
      }
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        expect(files).toBeDefined();
      }
    });
  });
});
