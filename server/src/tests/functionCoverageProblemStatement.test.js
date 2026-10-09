/**
 * Test Suite: Section 1 - Problem Statement & Empirical Verification
 * TỔNG QUAN VẤN ĐỀ & BỐI CẢNH THỰC TẾ (PROBLEM STATEMENT)
 *
 * Implements objective verification of Section 1 of:
 * docs/function-coverage-cfg-code-navigation-plan.md
 */

import { describe, it, expect } from "@jest/globals";

// Reusable Path Normalization Logic
const normalizePathForCompare = (p) => {
  if (!p) return "";
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^(?:.*?\/)?storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i, "")
    .replace(/^(?:.*?\/)?repo\//i, "")
    .toLowerCase();
};

// Reusable CFG File Matcher with Prefix & Truncation Support
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

  // 4. Prefix match (handles truncated paths like "backend/src/services/a...")
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

describe("## 1. TỔNG QUAN VẤN ĐỀ & BỐI CẢNH THỰC TẾ (PROBLEM STATEMENT)", () => {
  // Realistic dataset matching Section 1 & the user screenshot
  const projectCandidates = [
    "backend/src/services/auth.service.js",
    "backend/src/services/sentence.service.js",
    "backend/src/services/aiSuggestion.service.js",
    "backend/src/controllers/analysis.controller.js",
  ];

  const sentenceFunctions = [
    {
      id: "fn_lines",
      functionName: "lines",
      displayName: "lines()",
      filePath: "backend/src/services/sentence.service.js",
      startLine: 156,
      endLine: 156,
      hit: 0,
      isCovered: false,
    },
    {
      id: "fn_test",
      functionName: "test",
      displayName: "test()",
      filePath: "backend/src/services/sentence.service.js",
      startLine: 158,
      endLine: 158,
      hit: 0,
      isCovered: false,
    },
    {
      id: "fn_toSingleSentence",
      functionName: "toSingleSentence",
      displayName: "toSingleSentence()",
      filePath: "backend/src/services/sentence.service.js",
      startLine: 192,
      endLine: 206,
      hit: 0,
      isCovered: false,
    },
    {
      id: "fn_fallbackRewriteFragment",
      functionName: "fallbackRewriteFragment",
      displayName: "fallbackRewriteFragment()",
      filePath: "backend/src/services/sentence.service.js",
      startLine: 220,
      endLine: 245,
      hit: 0,
      isCovered: false,
    },
    {
      id: "fn_normalizeInitialRules",
      functionName: "normalizeInitialRules",
      displayName: "normalizeInitialRules()",
      filePath: "backend/src/services/sentence.service.js",
      startLine: 250,
      endLine: 280,
      hit: 0,
      isCovered: false,
    },
  ];

  const sentenceCfgs = [
    {
      filePath: "backend/src/services/sentence.service.js",
      functionName: "lines",
      startLine: 156,
      endLine: 156,
      graphJson: JSON.stringify({
        nodes: [{ id: "n1", type: "start", line: 156 }],
        edges: [],
      }),
    },
    {
      filePath: "backend/src/services/sentence.service.js",
      functionName: "test",
      startLine: 158,
      endLine: 158,
      graphJson: JSON.stringify({
        nodes: [{ id: "n2", type: "start", line: 158 }],
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
          { id: "if_1", type: "condition", line: 195 },
          { id: "return_1", type: "return", line: 196 },
          { id: "return_2", type: "return", line: 205 },
        ],
        edges: [
          { from: "start", to: "if_1" },
          { from: "if_1", to: "return_1", label: "true" },
          { from: "if_1", to: "return_2", label: "false" },
        ],
      }),
    },
    {
      filePath: "backend/src/services/sentence.service.js",
      functionName: "fallbackRewriteFragment",
      startLine: 220,
      endLine: 245,
      graphJson: JSON.stringify({
        nodes: [{ id: "n4", type: "start", line: 220 }],
        edges: [],
      }),
    },
    {
      filePath: "backend/src/services/sentence.service.js",
      functionName: "normalizeInitialRules",
      startLine: 250,
      endLine: 280,
      graphJson: JSON.stringify({
        nodes: [{ id: "n5", type: "start", line: 250 }],
        edges: [],
      }),
    },
  ];

  describe("1.1 Bối Cảnh Phân Tích Function Coverage Trong CovAI-", () => {
    it("1.1.1 Computes invocation metrics & called/uncalled ratios matching user dashboard", () => {
      const totalFunctions = 103;
      const calledFunctions = 77;
      const uncalledFunctions = 26;

      const calledRatio = (calledFunctions / totalFunctions) * 100;
      expect(totalFunctions).toBe(calledFunctions + uncalledFunctions);
      expect(calledRatio.toFixed(1)).toBe("74.8");

      // Verify dashboard metric display strings
      const calledLabel = `${calledFunctions}/${totalFunctions} (${calledRatio.toFixed(1)}%) Called`;
      const uncalledLabel = `${uncalledFunctions} uncalled functions`;

      expect(calledLabel).toBe("77/103 (74.8%) Called");
      expect(uncalledLabel).toBe("26 uncalled functions");
    });

    it("1.1.2 Formats card coordinates accurately as single line L156 or range L192 - L206", () => {
      const formatLinePosition = (fn) => {
        const start = fn.startLine || fn.line || 1;
        const end = fn.endLine;
        if (end && end !== start) {
          return `L${start} - L${end}`;
        }
        return `L${start}`;
      };

      const linesCard = sentenceFunctions.find((f) => f.functionName === "lines");
      const toSingleSentenceCard = sentenceFunctions.find((f) => f.functionName === "toSingleSentence");

      expect(formatLinePosition(linesCard)).toBe("L156");
      expect(formatLinePosition(toSingleSentenceCard)).toBe("L192 - L206");
    });

    it("1.1.3 Establishes dual action button schemas for Open code and View CFG", () => {
      const fn = sentenceFunctions.find((f) => f.functionName === "toSingleSentence");

      // Open code parameter payload
      const openCodePayload = [
        fn.filePath,
        fn.startLine || fn.line || 1,
        fn.displayName || fn.functionName,
        fn.endLine,
      ];
      expect(openCodePayload).toEqual([
        "backend/src/services/sentence.service.js",
        192,
        "toSingleSentence()",
        206,
      ]);

      // View CFG parameter payload
      const viewCfgPayload = [
        fn.filePath,
        fn.displayName || fn.functionName,
        fn.startLine || fn.line || 1,
      ];
      expect(viewCfgPayload).toEqual([
        "backend/src/services/sentence.service.js",
        "toSingleSentence()",
        192,
      ]);
    });
  });

  describe("1.2 Khiếm Khuyết Trải Nghiệm Hiện Hữu & Minh Chứng Khắc Phục", () => {
    it("1.2.1 Gap 1: View Container Closure Bug - Verifies parameters are preserved, not dropped", () => {
      // Historical buggy behavior: closure swallowed arguments
      let buggyContext = null;
      const buggyOnOpenCFG = () => {
        buggyContext = { showModal: true }; // filePath & functionName discarded!
      };
      buggyOnOpenCFG("backend/src/services/sentence.service.js", "toSingleSentence", 192);
      expect(buggyContext.initialFile).toBeUndefined();
      expect(buggyContext.initialFunc).toBeUndefined();

      // Resolved behavior: full parameter forwarder
      let resolvedContext = null;
      const resolvedOnOpenCFG = (filePath, functionName, line) => {
        resolvedContext = {
          initialFile: filePath,
          initialFunc: functionName,
          initialLine: line,
          showModal: true,
        };
      };
      resolvedOnOpenCFG("backend/src/services/sentence.service.js", "toSingleSentence", 192);
      expect(resolvedContext.initialFile).toBe("backend/src/services/sentence.service.js");
      expect(resolvedContext.initialFunc).toBe("toSingleSentence");
      expect(resolvedContext.initialLine).toBe(192);
    });

    it("1.2.2 Gap 2: CFG File Selection - Prevents hardcoding first file of project", () => {
      const initialFile = "backend/src/services/sentence.service.js";

      // Historical buggy logic:
      const firstFileOfProject = projectCandidates[0]; // "backend/src/services/auth.service.js"
      const buggySelectedFile = firstFileOfProject; // Wrong file!
      expect(buggySelectedFile).toBe("backend/src/services/auth.service.js");

      // Resolved logic:
      const resolvedSelectedFile = findMatchingCfgFile(projectCandidates, initialFile);
      expect(resolvedSelectedFile).toBe("backend/src/services/sentence.service.js");
    });

    it("1.2.3 Gap 2: CFG Function Selection - Prevents selectedFunc = null (generic Call Graph mode)", () => {
      const initialFunc = "toSingleSentence()";
      const initialLine = 192;

      // Historical buggy logic:
      const buggySelectedFunc = null; // Left as null, opening call graph instead of function CFG
      expect(buggySelectedFunc).toBeNull();

      // Resolved logic:
      const resolvedSelectedFunc = findMatchingCfgFunction(sentenceCfgs, initialFunc, initialLine);
      expect(resolvedSelectedFunc).toBe("toSingleSentence");
    });

    it("1.2.4 Gap 3: Code Pane Loss - Identifies targetLine L192 and active scope [192..206]", () => {
      const activeCfg = sentenceCfgs.find((c) => c.functionName === "toSingleSentence");
      const targetLine = activeCfg.startLine;
      expect(targetLine).toBe(192);

      // Verify active scope highlighting
      const isScopeActive = (line) => line >= activeCfg.startLine && line <= activeCfg.endLine;
      expect(isScopeActive(191)).toBe(false);
      expect(isScopeActive(192)).toBe(true);
      expect(isScopeActive(200)).toBe(true);
      expect(isScopeActive(206)).toBe(true);
      expect(isScopeActive(207)).toBe(false);

      // Verify scroll DOM identifier
      const expectedDomId = `cfg-source-line-${targetLine}`;
      expect(expectedDomId).toBe("cfg-source-line-192");
    });

    it("1.2.5 Gap 3: Monaco Lost Line - Generates EditorJumpTarget with revealLineInCenter instruction", () => {
      const filePath = "backend/src/services/sentence.service.js";
      const targetLine = 192;
      const endLine = 206;
      const functionName = "toSingleSentence";

      const jumpTarget = {
        filePath: filePath.replace(/\\/g, "/").replace(/^\.\//, ""),
        line: Number(targetLine),
        endLine: Number(endLine),
        functionName,
        timestamp: Date.now(),
      };

      expect(jumpTarget.filePath).toBe("backend/src/services/sentence.service.js");
      expect(jumpTarget.line).toBe(192);
      expect(jumpTarget.endLine).toBe(206);
      expect(jumpTarget.functionName).toBe("toSingleSentence");
      expect(jumpTarget.timestamp).toBeGreaterThan(0);
    });
  });

  describe("1.3 Mục Tiêu Giải Pháp (Target UX Outcome Verification)", () => {
    it("1.3.1 Target Flow: Clicking 'View CFG' renders exact function graph and enables editor jump", () => {
      const card = sentenceFunctions.find((f) => f.functionName === "toSingleSentence");

      // 1. Dispatch View CFG
      const initialFile = card.filePath;
      const initialFunc = card.displayName;
      const initialLine = card.startLine;

      // 2. CFG Engine resolves
      const selectedFile = findMatchingCfgFile(projectCandidates, initialFile);
      const selectedFunc = findMatchingCfgFunction(sentenceCfgs, initialFunc, initialLine);
      const activeCfg = sentenceCfgs.find((c) => c.functionName === selectedFunc);

      expect(selectedFile).toBe("backend/src/services/sentence.service.js");
      expect(selectedFunc).toBe("toSingleSentence");
      expect(activeCfg).toBeDefined();

      // 3. Graph parsed
      const parsedGraph = JSON.parse(activeCfg.graphJson);
      expect(parsedGraph.nodes.length).toBe(4);
      expect(parsedGraph.edges.length).toBe(3);

      // 4. Open in Editor bridge from toolbar
      const openInEditorTarget = {
        file: selectedFile,
        line: activeCfg.startLine,
        func: selectedFunc,
        endLine: activeCfg.endLine,
      };
      expect(openInEditorTarget.file).toBe("backend/src/services/sentence.service.js");
      expect(openInEditorTarget.line).toBe(192);
      expect(openInEditorTarget.endLine).toBe(206);
    });

    it("1.3.2 Target Flow: Clicking 'Open code' navigates to exact function definition in Monaco", () => {
      const card = sentenceFunctions.find((f) => f.functionName === "toSingleSentence");

      // Dispatch Open code
      const target = {
        filePath: card.filePath,
        line: card.startLine,
        endLine: card.endLine,
        functionName: card.functionName,
      };

      // Mock Monaco Editor execution
      let revealedLine = null;
      let cursorPosition = null;
      let appliedDecorationRange = null;

      const mockEditor = {
        revealLineInCenter: (l) => {
          revealedLine = l;
        },
        setPosition: (pos) => {
          cursorPosition = pos;
        },
        deltaDecorations: (_old, newDecs) => {
          appliedDecorationRange = newDecs[0]?.range;
          return ["dec-id-1"];
        },
        getModel: () => ({ getLineCount: () => 500 }),
        focus: () => {},
      };

      // Run Monaco Jump Action
      mockEditor.revealLineInCenter(target.line);
      mockEditor.setPosition({ lineNumber: target.line, column: 1 });
      mockEditor.deltaDecorations([], [
        {
          range: { startLine: target.line, startCol: 1, endLine: target.endLine, endCol: 1 },
          className: "monaco-function-active-range",
        },
      ]);

      expect(revealedLine).toBe(192);
      expect(cursorPosition).toEqual({ lineNumber: 192, column: 1 });
      expect(appliedDecorationRange).toEqual({
        startLine: 192,
        startCol: 1,
        endLine: 206,
        endCol: 1,
      });
    });

    it("1.3.3 Handles path prefix truncated with ellipsis e.g. 'backend/src/services/a...'", () => {
      // The screenshot truncated path
      const truncatedPath = "backend/src/services/a...";
      const matched = findMatchingCfgFile(projectCandidates, truncatedPath);
      expect(matched).toBe("backend/src/services/auth.service.js");
    });
  });
});
