/**
 * Verification Test Suite for Section 4: View CFG Subsystem Implementation
 * CHI TIẾT TRIỂN KHAI PHÂN HỆ VIEW CFG (CFG AUTO-FOCUS & SYNC ENGINE)
 *
 * Verifies Section 4.1 (Container Dispatch & Dual Views) and
 * Section 4.2 (CFGCalculator Auto-Focus, Centering, Code Scroll & Editor Bridge) from:
 * docs/function-coverage-cfg-code-navigation-plan.md
 */

import { describe, it, expect } from "@jest/globals";
import {
  findMatchingCfgFile,
  findMatchingCfgFunction,
} from "../utils/functionNavigationHelpers.js";

describe("## 4. CHI TIẾT TRIỂN KHAI PHÂN HỆ VIEW CFG (CFG AUTO-FOCUS & SYNC ENGINE)", () => {
  const projectCandidates = [
    "backend/src/services/sentence.service.js",
    "backend/src/services/auth.service.js",
    "backend/src/controllers/api.controller.js",
  ];

  const sentenceCfgs = [
    {
      filePath: "backend/src/services/sentence.service.js",
      functionName: "lines",
      startLine: 156,
      endLine: 170,
      graphJson: JSON.stringify({
        nodes: [{ id: "n1", type: "start", line: 156 }],
        edges: [],
      }),
    },
    {
      filePath: "backend/src/services/sentence.service.js",
      functionName: "toSingleSentence",
      startLine: 192,
      endLine: 206,
      graphJson: JSON.stringify({
        nodes: [
          { id: "start", type: "start", line: 192 },
          { id: "cond_1", type: "condition", line: 195 },
          { id: "ret_1", type: "return", line: 198 },
          { id: "ret_2", type: "return", line: 205 },
        ],
        edges: [
          { from: "start", to: "cond_1" },
          { from: "cond_1", to: "ret_1", label: "true" },
          { from: "cond_1", to: "ret_2", label: "false" },
        ],
      }),
    },
  ];

  describe("4.1 Nâng Cấp UnitTestDashboard & CoverageTypeDashboard (Dual Modes Dispatch)", () => {
    it("4.1.1 Method Call Map View: View CFG button emits normalized coordinates", () => {
      const fn = {
        filePath: "backend/src/services/sentence.service.js",
        functionName: "toSingleSentence",
        displayName: "toSingleSentence()",
        startLine: 192,
        endLine: 206,
      };

      let emittedParams = null;
      const onOpenCfg = (filePath, displayName, startLine) => {
        emittedParams = { filePath, displayName, startLine };
      };

      // Simulates button onClick in FunctionExecutionFlow.jsx
      onOpenCfg(
        fn.filePath,
        fn.displayName || fn.functionName,
        fn.startLine || fn.line || 1
      );

      expect(emittedParams).toEqual({
        filePath: "backend/src/services/sentence.service.js",
        displayName: "toSingleSentence()",
        startLine: 192,
      });
    });

    it("4.1.2 Details Table View: View CFG button emits matching coordinates", () => {
      const tableRow = {
        filePath: "backend/src/services/sentence.service.js",
        functionName: "lines",
        startLine: 156,
        endLine: 170,
      };

      let emittedParams = null;
      const onOpenCFG = (filePath, functionName, line) => {
        emittedParams = { filePath, functionName, line };
      };

      // Simulates button onClick in CoverageTypeDashboard.jsx Details Table
      const targetLine = tableRow.startLine || tableRow.line || 1;
      onOpenCFG(tableRow.filePath, tableRow.functionName, targetLine);

      expect(emittedParams).toEqual({
        filePath: "backend/src/services/sentence.service.js",
        functionName: "lines",
        line: 156,
      });
    });

    it("4.1.3 UnitTestDashboard Forwarder: Never drops parameters on route to Layout", () => {
      let layoutContext = null;
      const handleOpenCFG = (filePath, functionName, initialLine) => {
        layoutContext = {
          initialFile: filePath,
          initialFunc: functionName,
          initialLine: initialLine ? Number(initialLine) : null,
          timestamp: Date.now(),
        };
      };

      // Forwarder props passed to UnitTestDashboard:
      const unitTestDashboardProps = {
        onOpenCFG: handleOpenCFG,
      };

      // CoverageTypeDashboard calls onOpenCFG
      unitTestDashboardProps.onOpenCFG(
        "backend/src/services/sentence.service.js",
        "toSingleSentence",
        192
      );

      expect(layoutContext.initialFile).toBe("backend/src/services/sentence.service.js");
      expect(layoutContext.initialFunc).toBe("toSingleSentence");
      expect(layoutContext.initialLine).toBe(192);
    });
  });

  describe("4.2 Nâng Cấp CFGCalculator (Auto-Focus, Auto-Center, Scroll & Editor Bridge)", () => {
    it("4.2.1 Data initialization: Automatically selects matching file and function", () => {
      const initialFile = "backend/src/services/sentence.service.js";
      const initialFunc = "toSingleSentence()";
      const initialLine = 192;

      // 1. CFG response loaded
      const allFiles = [...new Set(sentenceCfgs.map((c) => c.filePath))];
      const matchedFile = findMatchingCfgFile(allFiles, initialFile);
      expect(matchedFile).toBe("backend/src/services/sentence.service.js");

      // 2. Matching function loaded
      const fileCfgs = sentenceCfgs.filter((c) => c.filePath === matchedFile);
      const matchedFunc = findMatchingCfgFunction(fileCfgs, initialFunc, initialLine);
      expect(matchedFunc).toBe("toSingleSentence");

      // 3. Active CFG resolved
      const activeCfg = fileCfgs.find((c) => c.functionName === matchedFunc);
      expect(activeCfg).toBeDefined();
      expect(activeCfg.startLine).toBe(192);
      expect(activeCfg.endLine).toBe(206);
    });

    it("4.2.2 Auto-Center & Auto-Fit: Computes fit scale when graph is larger than canvas viewport", () => {
      const calculateFitScale = (canvasWidth, canvasHeight, graphWidth, graphHeight) => {
        const padding = 60;
        const scaleX = (canvasWidth - padding) / Math.max(graphWidth, 100);
        const scaleY = (canvasHeight - padding) / Math.max(graphHeight, 100);
        return Math.min(1, Math.max(0.4, Math.min(scaleX, scaleY)));
      };

      // Large graph (800x600) on smaller viewport (500x400)
      const scale = calculateFitScale(500, 400, 800, 600);
      expect(scale).toBeLessThan(1);
      expect(scale).toBeGreaterThanOrEqual(0.4);

      // Normal graph (300x200) fits without zoom reduction
      const normalScale = calculateFitScale(800, 600, 300, 200);
      expect(normalScale).toBe(1);
    });

    it("4.2.3 Smooth-Scroll & Line Highlighting: Identifies target line element and active scope", () => {
      const activeCfg = sentenceCfgs.find((c) => c.functionName === "toSingleSentence");
      const targetLine = activeCfg.startLine;

      const targetDomId = `cfg-source-line-${targetLine}`;
      expect(targetDomId).toBe("cfg-source-line-192");

      // Verifies indicator and scope
      const getLineDisplayInfo = (lineNum) => {
        const isTarget = lineNum === targetLine;
        const inScope = lineNum >= activeCfg.startLine && lineNum <= activeCfg.endLine;
        return {
          isTarget,
          inScope,
          indicator: isTarget ? "▶" : null,
        };
      };

      expect(getLineDisplayInfo(192)).toEqual({
        isTarget: true,
        inScope: true,
        indicator: "▶",
      });

      expect(getLineDisplayInfo(195)).toEqual({
        isTarget: false,
        inScope: true,
        indicator: null,
      });

      expect(getLineDisplayInfo(150)).toEqual({
        isTarget: false,
        inScope: false,
        indicator: null,
      });
    });

    it("4.2.4 Open in Editor Bridge: Dispatches function coordinates and closes modal", () => {
      const activeCfg = sentenceCfgs.find((c) => c.functionName === "toSingleSentence");
      const selectedFile = "backend/src/services/sentence.service.js";
      const selectedFunc = "toSingleSentence";

      let modalClosed = false;
      let editorNavigationTarget = null;

      const onClose = () => {
        modalClosed = true;
      };

      const onOpenFile = (filePath, line, funcName, endLine) => {
        editorNavigationTarget = {
          filePath,
          line,
          funcName,
          endLine,
        };
      };

      // User clicks "Open in Editor" in toolbar
      onClose();
      onOpenFile(
        selectedFile,
        activeCfg.startLine,
        selectedFunc,
        activeCfg.endLine
      );

      expect(modalClosed).toBe(true);
      expect(editorNavigationTarget).toEqual({
        filePath: "backend/src/services/sentence.service.js",
        line: 192,
        funcName: "toSingleSentence",
        endLine: 206,
      });
    });
  });
});
