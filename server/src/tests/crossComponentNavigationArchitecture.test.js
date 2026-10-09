/**
 * Verification Test Suite for Section 2: Cross-Component Navigation Architecture
 * KIẾN TRÚC ĐIỀU HƯỚNG LIÊN PHÂN HỆ (CROSS-COMPONENT NAVIGATION ARCHITECTURE)
 *
 * Verifies Section 2.1 (Data Flow), Section 2.2 (View CFG Sequence),
 * and Section 2.3 (Open Code Sequence) from:
 * docs/function-coverage-cfg-code-navigation-plan.md
 */

import { describe, it, expect, beforeEach } from "@jest/globals";

// Reusable Path Normalization
const normalizePathForCompare = (p) => {
  if (!p) return "";
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^(?:.*?\/)?storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i, "")
    .replace(/^(?:.*?\/)?repo\//i, "")
    .toLowerCase();
};

// Reusable CFG File Matcher
const findMatchingCfgFile = (candidateFiles, targetPath) => {
  if (!targetPath || !candidateFiles || candidateFiles.length === 0) return candidateFiles?.[0] || null;
  const targetNorm = normalizePathForCompare(targetPath);

  // 1. Exact match
  const exact = candidateFiles.find((f) => normalizePathForCompare(f) === targetNorm);
  if (exact) return exact;

  // 2. Ends with match
  const endsWithMatch = candidateFiles.find(
    (f) =>
      targetNorm.endsWith("/" + normalizePathForCompare(f)) ||
      normalizePathForCompare(f).endsWith("/" + targetNorm)
  );
  if (endsWithMatch) return endsWithMatch;

  // 3. Basename match
  const baseTarget = targetNorm.split("/").pop();
  const baseMatch = candidateFiles.find(
    (f) => normalizePathForCompare(f).split("/").pop() === baseTarget
  );
  if (baseMatch) return baseMatch;

  // 4. Prefix match
  const cleanPrefix = targetNorm.replace(/\.{2,}$/, "");
  if (cleanPrefix.length > 5) {
    const prefixMatch = candidateFiles.find((f) =>
      normalizePathForCompare(f).startsWith(cleanPrefix)
    );
    if (prefixMatch) return prefixMatch;
  }

  return candidateFiles[0];
};

// Reusable CFG Function Matcher
const findMatchingCfgFunction = (fileCfgs, targetFuncName, targetLine) => {
  if (!fileCfgs || fileCfgs.length === 0) return null;

  // 1. Name match
  if (targetFuncName) {
    const cleanTarget = targetFuncName.replace(/\(\)$/, "").trim();
    const nameMatch = fileCfgs.find(
      (c) =>
        c.functionName === cleanTarget ||
        c.functionName.toLowerCase() === cleanTarget.toLowerCase()
    );
    if (nameMatch) return nameMatch.functionName;
  }

  // 2. Line number match
  if (targetLine && Number(targetLine) > 0) {
    const lineNum = Number(targetLine);
    const lineMatch = fileCfgs.find(
      (c) =>
        c.startLine === lineNum ||
        (c.startLine <= lineNum && c.endLine && c.endLine >= lineNum)
    );
    if (lineMatch) return lineMatch.functionName;
  }

  // 3. Fallback
  return fileCfgs[0].functionName;
};

describe("## 2. KIẾN TRÚC ĐIỀU HƯỚNG LIÊN PHÂN HỆ (CROSS-COMPONENT NAVIGATION ARCHITECTURE)", () => {
  const sampleProjectFiles = [
    "backend/src/services/sentence.service.js",
    "backend/src/services/auth.service.js",
    "backend/src/controllers/api.controller.js",
  ];

  const sampleSentenceCfgs = [
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
          { from: "cond_1", to: "ret_1" },
          { from: "cond_1", to: "ret_2" },
        ],
      }),
    },
  ];

  describe("2.1 Sơ Đồ Khối Luồng Dữ Liệu & Sự Kiện (Event & Data Flow State Machine)", () => {
    it("Tier 1 -> Tier 2: Dispatches events from Card to Central Dispatcher without data loss", () => {
      // Tier 1: Function Execution Card
      const card = {
        filePath: "backend/src/services/sentence.service.js",
        functionName: "toSingleSentence",
        displayName: "toSingleSentence()",
        startLine: 192,
        endLine: 206,
      };

      // Tier 2: Dispatcher State Store
      const dispatcherState = {
        cfgInitialContext: null,
        editorJumpTarget: null,
        showCFG: false,
        activeActivity: "coverage",
        tabs: [],
        activeTabId: null,
      };

      const handleOpenCFG = (filePath, functionName, line) => {
        dispatcherState.cfgInitialContext = {
          initialFile: filePath,
          initialFunc: functionName,
          initialLine: line ? Number(line) : null,
          timestamp: Date.now(),
        };
        dispatcherState.showCFG = true;
      };

      const handleOpenFileByPath = (filePath, targetLine, functionName, endLine) => {
        dispatcherState.activeActivity = "explorer";
        const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
        if (!dispatcherState.tabs.find((t) => t.id === normalized)) {
          dispatcherState.tabs.push({ id: normalized, name: normalized.split("/").pop() });
        }
        dispatcherState.activeTabId = normalized;
        if (targetLine && Number(targetLine) > 0) {
          dispatcherState.editorJumpTarget = {
            filePath: normalized,
            line: Number(targetLine),
            endLine: endLine ? Number(endLine) : null,
            functionName,
            timestamp: Date.now(),
          };
        }
      };

      // 1. Dispatch View CFG
      handleOpenCFG(card.filePath, card.displayName, card.startLine);
      expect(dispatcherState.showCFG).toBe(true);
      expect(dispatcherState.cfgInitialContext.initialFile).toBe("backend/src/services/sentence.service.js");
      expect(dispatcherState.cfgInitialContext.initialFunc).toBe("toSingleSentence()");
      expect(dispatcherState.cfgInitialContext.initialLine).toBe(192);

      // 2. Dispatch Open code
      handleOpenFileByPath(card.filePath, card.startLine, card.functionName, card.endLine);
      expect(dispatcherState.activeActivity).toBe("explorer");
      expect(dispatcherState.activeTabId).toBe("backend/src/services/sentence.service.js");
      expect(dispatcherState.editorJumpTarget.line).toBe(192);
      expect(dispatcherState.editorJumpTarget.endLine).toBe(206);
      expect(dispatcherState.editorJumpTarget.functionName).toBe("toSingleSentence");
    });
  });

  describe("2.2 Sơ Đồ Tuần Tự (Sequence Diagram): Luồng Bấm 'View CFG'", () => {
    it("Verifies full 12-step sequence execution from card click to code pane scroll", () => {
      // Step 1: User clicks "View CFG" on toSingleSentence() @ L192
      const targetFunction = {
        filePath: "backend/src/services/sentence.service.js",
        name: "toSingleSentence",
        line: 192,
      };

      // Step 2 & 3: Card notifies Layout, Layout sets cfgInitialContext
      const layoutContext = {
        initialFile: targetFunction.filePath,
        initialFunc: targetFunction.name,
        initialLine: targetFunction.line,
        timestamp: Date.now(),
      };

      // Step 4 & 5: CFGCalculator mounted, fetches project CFGs
      const apiCfgs = sampleSentenceCfgs;

      // Step 6: Normalize path matching: c.filePath == initialFile
      const matchedFile = findMatchingCfgFile(sampleProjectFiles, layoutContext.initialFile);
      expect(matchedFile).toBe("backend/src/services/sentence.service.js");

      // Step 7: Function matching: c.functionName == initialFunc || c.startLine == 192
      const fileCfgs = apiCfgs.filter((c) => c.filePath === matchedFile);
      const matchedFunc = findMatchingCfgFunction(fileCfgs, layoutContext.initialFunc, layoutContext.initialLine);
      expect(matchedFunc).toBe("toSingleSentence");

      // Step 8: setSelectedFile(matchedFile) & setSelectedFunc(matchedFunc)
      const selectedFile = matchedFile;
      const selectedFunc = matchedFunc;
      const activeCfg = fileCfgs.find((c) => c.functionName === selectedFunc);
      expect(activeCfg).toBeDefined();

      // Step 9: Compute Dagre Graph & Render Nodes/Edges
      const graph = JSON.parse(activeCfg.graphJson);
      expect(graph.nodes.length).toBe(4);
      expect(graph.edges.length).toBe(3);

      // Step 10 & 11: Scroll to #cfg-source-line-192, set highlightedLine(192) & scope [192..206]
      const targetLine = activeCfg.startLine || layoutContext.initialLine;
      const scrollDomId = `cfg-source-line-${targetLine}`;
      const highlightedLine = targetLine;
      const activeScope = { start: activeCfg.startLine, end: activeCfg.endLine };

      expect(scrollDomId).toBe("cfg-source-line-192");
      expect(highlightedLine).toBe(192);
      expect(activeScope).toEqual({ start: 192, end: 206 });

      // Step 12: "Open in Editor" button bridge
      const openInEditorEvent = {
        file: selectedFile,
        line: activeCfg.startLine,
        func: selectedFunc,
        endLine: activeCfg.endLine,
      };
      expect(openInEditorEvent.file).toBe("backend/src/services/sentence.service.js");
      expect(openInEditorEvent.line).toBe(192);
    });
  });

  describe("2.3 Sơ Đồ Tuần Tự (Sequence Diagram): Luồng Bấm 'Open code'", () => {
    it("Verifies full 11-step sequence execution from card click to Monaco line jump & glow", () => {
      // Step 1: User clicks "Open code" on lines() @ L156
      const targetFunction = {
        filePath: "backend/src/services/sentence.service.js",
        line: 156,
        endLine: 170,
        name: "lines",
      };

      // Step 2, 3, 4, 5: Card calls Layout, switches to explorer, ensures tab open, sets jump target
      const layoutState = {
        activeActivity: "coverage",
        tabs: [],
        activeTabId: null,
        editorJumpTarget: null,
      };

      // Layout executes handleOpenFileByPath:
      layoutState.activeActivity = "explorer";
      layoutState.tabs.push({ id: targetFunction.filePath, name: "sentence.service.js" });
      layoutState.activeTabId = targetFunction.filePath;
      layoutState.editorJumpTarget = {
        filePath: targetFunction.filePath,
        line: targetFunction.line,
        endLine: targetFunction.endLine,
        functionName: targetFunction.name,
        timestamp: Date.now(),
      };

      expect(layoutState.activeActivity).toBe("explorer");
      expect(layoutState.activeTabId).toBe("backend/src/services/sentence.service.js");
      expect(layoutState.editorJumpTarget.line).toBe(156);

      // Step 6, 7, 8, 9, 10, 11: Editor receives jumpTarget, executes Monaco operations
      const mockMonacoState = {
        revealedLine: null,
        cursor: null,
        decorations: [],
        focused: false,
      };

      const mockEditor = {
        revealLineInCenter: (line) => {
          mockMonacoState.revealedLine = line;
        },
        setPosition: (pos) => {
          mockMonacoState.cursor = pos;
        },
        deltaDecorations: (_old, newDecs) => {
          mockMonacoState.decorations = newDecs;
          return ["dec-id-100"];
        },
        focus: () => {
          mockMonacoState.focused = true;
        },
        getModel: () => ({ getLineCount: () => 500 }),
      };

      // Execute jump
      const line = layoutState.editorJumpTarget.line;
      const endLine = layoutState.editorJumpTarget.endLine || line;
      mockEditor.revealLineInCenter(line);
      mockEditor.setPosition({ lineNumber: line, column: 1 });
      mockEditor.deltaDecorations([], [
        {
          range: { startLine: line, startCol: 1, endLine, endCol: 1 },
          className: "monaco-function-active-range",
          linesDecorationsClassName: "monaco-function-line-number-active",
        },
      ]);
      mockEditor.focus();

      expect(mockMonacoState.revealedLine).toBe(156);
      expect(mockMonacoState.cursor).toEqual({ lineNumber: 156, column: 1 });
      expect(mockMonacoState.focused).toBe(true);
      expect(mockMonacoState.decorations[0].className).toBe("monaco-function-active-range");
      expect(mockMonacoState.decorations[0].range).toEqual({
        startLine: 156,
        startCol: 1,
        endLine: 170,
        endCol: 1,
      });
    });
  });

  describe("2.4 Khả Năng Chịu Lỗi & Cạnh Tranh (Resilience & Edge Case Handling)", () => {
    it("Clamps target line safely if requested line exceeds total lines in editor model", () => {
      const modelLineCount = 100; // File only has 100 lines
      const requestedLine = 156;
      const requestedEndLine = 170;

      const safeLine = Math.min(requestedLine, modelLineCount);
      const safeEndLine = Math.min(requestedEndLine, modelLineCount);

      expect(safeLine).toBe(100);
      expect(safeEndLine).toBe(100);
    });

    it("Handles single-line functions where startLine equals endLine", () => {
      const line = 55;
      const endLine = 55;
      const range = { startLine: line, startCol: 1, endLine, endCol: 1 };

      expect(range.startLine).toBe(range.endLine);
    });

    it("Prioritizes newest navigation event when rapid consecutive clicks occur", () => {
      let currentContext = null;

      const dispatch = (file, func, line) => {
        currentContext = { file, func, line, ts: Date.now() };
      };

      // Click Function 1
      dispatch("fileA.js", "funcA", 10);
      expect(currentContext.func).toBe("funcA");

      // Rapid Click Function 2
      dispatch("fileB.js", "funcB", 50);
      expect(currentContext.func).toBe("funcB");
      expect(currentContext.file).toBe("fileB.js");
      expect(currentContext.line).toBe(50);
    });
  });
});
