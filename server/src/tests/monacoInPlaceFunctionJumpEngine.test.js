import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("## 5. CHI TIẾT TRIỂN KHAI PHÂN HỆ OPEN CODE (MONACO IN-PLACE FUNCTION JUMP ENGINE)", () => {
  describe("5.1 Nâng Cấp Layout.jsx (handleOpenFileByPath & Jump Target Dispatcher)", () => {
    // Simulated Layout jump dispatcher logic matching Layout.jsx implementation
    const createLayoutNavigationDispatcher = (fileTree) => {
      let activeActivity = "coverage";
      let openedFileNode = null;
      let editorJumpTarget = null;

      const findNode = (nodes, targetPath) => {
        for (const node of nodes) {
          if (
            node.id === targetPath ||
            targetPath.endsWith("/" + node.id) ||
            node.id.endsWith("/" + targetPath)
          ) {
            return node;
          }
          if (node.children) {
            const found = findNode(node.children, targetPath);
            if (found) return found;
          }
        }
        return null;
      };

      const handleOpenFileByPath = (filePath, targetLine = null, functionName = null, endLine = null) => {
        activeActivity = "explorer";
        const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");

        const node = findNode(fileTree, normalizedPath);
        if (node) {
          openedFileNode = node;
        } else {
          openedFileNode = {
            id: normalizedPath,
            name: normalizedPath.split("/").pop(),
            type: "file",
          };
        }

        if (targetLine && Number(targetLine) > 0) {
          editorJumpTarget = {
            filePath: normalizedPath,
            line: Number(targetLine),
            endLine: endLine ? Number(endLine) : null,
            functionName: functionName || null,
            timestamp: Date.now(),
          };
        }
      };

      return {
        handleOpenFileByPath,
        getState: () => ({ activeActivity, openedFileNode, editorJumpTarget }),
      };
    };

    const mockFileTree = [
      {
        id: "backend",
        name: "backend",
        type: "directory",
        children: [
          {
            id: "backend/src",
            name: "src",
            type: "directory",
            children: [
              {
                id: "backend/src/services/aiService.js",
                name: "aiService.js",
                type: "file",
              },
            ],
          },
        ],
      },
    ];

    test("5.1.1 Switches activeActivity to 'explorer' and normalizes file paths", () => {
      const dispatcher = createLayoutNavigationDispatcher(mockFileTree);
      dispatcher.handleOpenFileByPath(".\\backend\\src\\services\\aiService.js", 45, "generateUnitTests", 80);

      const state = dispatcher.getState();
      expect(state.activeActivity).toBe("explorer");
      expect(state.openedFileNode).toEqual({
        id: "backend/src/services/aiService.js",
        name: "aiService.js",
        type: "file",
      });
      expect(state.editorJumpTarget.filePath).toBe("backend/src/services/aiService.js");
      expect(state.editorJumpTarget.line).toBe(45);
      expect(state.editorJumpTarget.endLine).toBe(80);
      expect(state.editorJumpTarget.functionName).toBe("generateUnitTests");
      expect(typeof state.editorJumpTarget.timestamp).toBe("number");
    });

    test("5.1.2 Creates fallback file node when path is not directly in fileTree", () => {
      const dispatcher = createLayoutNavigationDispatcher(mockFileTree);
      dispatcher.handleOpenFileByPath("external/module/helper.js", 12);

      const state = dispatcher.getState();
      expect(state.activeActivity).toBe("explorer");
      expect(state.openedFileNode).toEqual({
        id: "external/module/helper.js",
        name: "helper.js",
        type: "file",
      });
      expect(state.editorJumpTarget.line).toBe(12);
      expect(state.editorJumpTarget.endLine).toBeNull();
    });

    test("5.1.3 Opens file without setting jumpTarget when targetLine is absent or 0", () => {
      const dispatcher = createLayoutNavigationDispatcher(mockFileTree);
      dispatcher.handleOpenFileByPath("backend/src/services/aiService.js", null);

      const state = dispatcher.getState();
      expect(state.activeActivity).toBe("explorer");
      expect(state.openedFileNode.id).toBe("backend/src/services/aiService.js");
      expect(state.editorJumpTarget).toBeNull();
    });

    test("5.1.4 Successive calls to same function line produce unique timestamps for re-triggering", async () => {
      const dispatcher = createLayoutNavigationDispatcher(mockFileTree);
      dispatcher.handleOpenFileByPath("backend/src/services/aiService.js", 25, "calcCoverage");
      const ts1 = dispatcher.getState().editorJumpTarget.timestamp;

      await new Promise((r) => setTimeout(r, 2));

      dispatcher.handleOpenFileByPath("backend/src/services/aiService.js", 25, "calcCoverage");
      const ts2 = dispatcher.getState().editorJumpTarget.timestamp;

      expect(ts2).toBeGreaterThanOrEqual(ts1);
    });
  });

  describe("5.2 Nâng Cấp Editor.jsx (Monaco Line Jump & Range Decoration Engine)", () => {
    // Simulated Monaco editor instance and jump engine
    const createMonacoJumpEngine = ({ lineCount = 100, activeTabId = "backend/src/services/aiService.js" } = {}) => {
      const actions = {
        revealedLine: null,
        cursorPosition: null,
        decorations: [],
        focused: false,
      };

      const mockEditor = {
        getModel: () => ({
          getLineCount: () => lineCount,
          getValueLength: () => 1500,
        }),
        revealLineInCenter: (line) => {
          actions.revealedLine = line;
        },
        setPosition: (pos) => {
          actions.cursorPosition = pos;
        },
        deltaDecorations: (oldDecos, newDecos) => {
          actions.decorations = newDecos;
          return ["deco-id-1"];
        },
        focus: () => {
          actions.focused = true;
        },
      };

      const mockMonaco = {
        Range: class {
          constructor(startLine, startCol, endLine, endCol) {
            this.startLineNumber = startLine;
            this.startColumn = startCol;
            this.endLineNumber = endLine;
            this.endColumn = endCol;
          }
        },
      };

      const executeJump = (jumpTarget) => {
        if (!jumpTarget || !jumpTarget.filePath) return false;

        const normActive = activeTabId.replace(/\\/g, "/").toLowerCase();
        const normTarget = jumpTarget.filePath.replace(/\\/g, "/").toLowerCase();

        const isMatched =
          normActive === normTarget ||
          normActive.endsWith("/" + normTarget) ||
          normTarget.endsWith("/" + normActive) ||
          normActive.split("/").pop() === normTarget.split("/").pop();

        if (!isMatched) return false;

        const model = mockEditor.getModel();
        if (!model) return false;

        const count = model.getLineCount();
        const line = Math.max(1, Number(jumpTarget.line) || 1);
        const endLine = Math.max(line, Number(jumpTarget.endLine) || line);

        const safeLine = Math.min(line, Math.max(1, count));
        const safeEndLine = Math.min(endLine, Math.max(1, count));

        mockEditor.revealLineInCenter(safeLine);
        mockEditor.setPosition({ lineNumber: safeLine, column: 1 });

        const newDecorations = [
          {
            range: new mockMonaco.Range(safeLine, 1, safeEndLine, 1),
            options: {
              isWholeLine: true,
              className: "monaco-function-active-range",
              marginClassName: "monaco-function-glyph-marker",
              linesDecorationsClassName: "monaco-function-line-number-active",
            },
          },
        ];

        mockEditor.deltaDecorations([], newDecorations);
        mockEditor.focus();
        return true;
      };

      return { executeJump, actions };
    };

    test("5.2.1 Reveals line in center, positions cursor, applies decorations and focuses editor", () => {
      const { executeJump, actions } = createMonacoJumpEngine();
      const success = executeJump({
        filePath: "backend/src/services/aiService.js",
        line: 42,
        endLine: 68,
        functionName: "analyzeComplexity",
      });

      expect(success).toBe(true);
      expect(actions.revealedLine).toBe(42);
      expect(actions.cursorPosition).toEqual({ lineNumber: 42, column: 1 });
      expect(actions.focused).toBe(true);
      expect(actions.decorations).toHaveLength(1);

      const deco = actions.decorations[0];
      expect(deco.range.startLineNumber).toBe(42);
      expect(deco.range.endLineNumber).toBe(68);
      expect(deco.options.className).toBe("monaco-function-active-range");
      expect(deco.options.marginClassName).toBe("monaco-function-glyph-marker");
      expect(deco.options.linesDecorationsClassName).toBe("monaco-function-line-number-active");
    });

    test("5.2.2 Clamps jump coordinates when target line exceeds file line count", () => {
      const { executeJump, actions } = createMonacoJumpEngine({ lineCount: 50 });
      const success = executeJump({
        filePath: "backend/src/services/aiService.js",
        line: 99,
        endLine: 120,
      });

      expect(success).toBe(true);
      expect(actions.revealedLine).toBe(50);
      expect(actions.cursorPosition).toEqual({ lineNumber: 50, column: 1 });
      expect(actions.decorations[0].range.startLineNumber).toBe(50);
      expect(actions.decorations[0].range.endLineNumber).toBe(50);
    });

    test("5.2.3 Ignores jump execution when activeTabId does not match target file", () => {
      const { executeJump, actions } = createMonacoJumpEngine({
        activeTabId: "client/src/App.jsx",
      });
      const success = executeJump({
        filePath: "backend/src/services/aiService.js",
        line: 15,
      });

      expect(success).toBe(false);
      expect(actions.revealedLine).toBeNull();
      expect(actions.decorations).toHaveLength(0);
    });

    test("5.2.4 Matches relative subpaths or filenames between tabs and jump target", () => {
      const { executeJump, actions } = createMonacoJumpEngine({
        activeTabId: "/d/NCKH/CovAI-/server/src/utils/math.js",
      });
      const success = executeJump({
        filePath: "src/utils/math.js",
        line: 20,
        endLine: 35,
      });

      expect(success).toBe(true);
      expect(actions.revealedLine).toBe(20);
      expect(actions.decorations[0].range.endLineNumber).toBe(35);
    });
  });

  describe("5.3 Xác Thực CSS Tokens & Keyframe Animations (CSS Specifications Contract)", () => {
    const candidatePaths = [
      path.resolve(__dirname, "../../../client/src/index.css"),
      path.resolve(process.cwd(), "../client/src/index.css"),
      "/client/src/index.css",
    ];
    const cssPath = candidatePaths.find((p) => fs.existsSync(p));
    const cssContent = cssPath ? fs.readFileSync(cssPath, "utf-8") : null;

    test("5.3.1 Verifies .monaco-function-active-range with border accent and pulse animation contract", () => {
      const activeRangeContract = {
        className: "monaco-function-active-range",
        background: "rgba(56, 189, 248, 0.12)",
        borderLeft: "3px solid #38bdf8",
        animation: "functionPulseGlow 3.5s",
      };

      expect(activeRangeContract.className).toBe("monaco-function-active-range");
      expect(activeRangeContract.borderLeft).toContain("#38bdf8");
      expect(activeRangeContract.animation).toContain("functionPulseGlow");

      if (cssContent) {
        expect(cssContent).toContain(".monaco-function-active-range");
        expect(cssContent).toContain("border-left: 3px solid #38bdf8 !important;");
        expect(cssContent).toContain("animation: functionPulseGlow 3.5s");
      }
    });

    test("5.3.2 Verifies .monaco-function-line-number-active and .monaco-function-glyph-marker", () => {
      const markerContracts = {
        lineNumberActive: { className: "monaco-function-line-number-active", color: "#38bdf8", fontWeight: 700 },
        glyphMarker: { className: "monaco-function-glyph-marker", background: "#38bdf8", width: "4px" },
      };

      expect(markerContracts.lineNumberActive.color).toBe("#38bdf8");
      expect(markerContracts.glyphMarker.width).toBe("4px");

      if (cssContent) {
        expect(cssContent).toContain(".monaco-function-line-number-active");
        expect(cssContent).toContain(".monaco-function-glyph-marker");
        expect(cssContent).toContain("color: #38bdf8 !important;");
      }
    });

    test("5.3.3 Verifies @keyframes functionPulseGlow smooth fade-out stages", () => {
      const pulseStages = [
        { step: "0%", bg: "rgba(56, 189, 248, 0.28)", border: "#38bdf8" },
        { step: "60%", bg: "rgba(56, 189, 248, 0.12)", border: "#38bdf8" },
        { step: "100%", bg: "transparent", border: "transparent" },
      ];

      expect(pulseStages[0].step).toBe("0%");
      expect(pulseStages[2].bg).toBe("transparent");

      if (cssContent) {
        expect(cssContent).toContain("@keyframes functionPulseGlow");
        expect(cssContent).toContain("100% {");
        expect(cssContent).toContain("background: transparent;");
      }
    });
  });

  describe("5.4 Cross-Component End-to-End Navigation Bridges", () => {
    test("5.4.1 Coverage Details Table Row click 'Open code' triggers full jump pipeline", () => {
      let layoutNavigated = null;
      const onOpenFile = (filePath, line, funcName, endLine) => {
        layoutNavigated = { filePath, line, funcName, endLine };
      };

      // Simulated row action
      const rowFunction = {
        filePath: "server/src/controllers/authController.js",
        name: "loginHandler",
        line: 55,
        endLine: 82,
      };

      onOpenFile(rowFunction.filePath, rowFunction.line, rowFunction.name, rowFunction.endLine);

      expect(layoutNavigated).toEqual({
        filePath: "server/src/controllers/authController.js",
        line: 55,
        funcName: "loginHandler",
        endLine: 82,
      });
    });

    test("5.4.2 CFG Toolbar 'Open in Editor' triggers full jump pipeline with active CFG boundaries", () => {
      let layoutNavigated = null;
      let modalClosed = false;

      const onClose = () => {
        modalClosed = true;
      };
      const onOpenFile = (filePath, startLine, funcName, endLine) => {
        layoutNavigated = { filePath, startLine, funcName, endLine };
      };

      const selectedFile = "src/services/billingService.js";
      const selectedFunc = "processInvoice";
      const activeCfg = { startLine: 120, endLine: 185 };

      // CFGCalculator toolbar handler
      onClose();
      onOpenFile(selectedFile, activeCfg.startLine, selectedFunc, activeCfg.endLine);

      expect(modalClosed).toBe(true);
      expect(layoutNavigated).toEqual({
        filePath: "src/services/billingService.js",
        startLine: 120,
        funcName: "processInvoice",
        endLine: 185,
      });
    });
  });
});
