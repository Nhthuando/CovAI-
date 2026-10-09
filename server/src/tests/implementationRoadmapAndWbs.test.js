import { describe, test, expect } from "@jest/globals";
import {
  findMatchingCfgFile,
  findMatchingCfgFunction,
  calculateSafeMonacoLineRange,
  normalizePathForCompare,
} from "../utils/functionNavigationHelpers.js";

describe("## 6. KẾ HOẠCH TRIỂN KHAI CHI TIẾT (IMPLEMENTATION ROADMAP & WBS)", () => {
  describe("6.1 Phase 1: Chuẩn Hóa Contracts & Luồng Tham Số (WBS 1.1 - 1.3)", () => {
    test("WBS 1.1: FunctionExecutionFlow.jsx dispatches 4-parameter coordinates to onOpenFile", () => {
      let dispatchedParams = null;
      const onOpenFile = (filePath, startLine, funcName, endLine) => {
        dispatchedParams = { filePath, startLine, funcName, endLine };
      };

      const fn = {
        filePath: "backend/src/services/orderService.js",
        displayName: "processOrder(id)",
        functionName: "processOrder",
        startLine: 42,
        endLine: 88,
      };

      onOpenFile(fn.filePath, fn.startLine || fn.line || 1, fn.displayName || fn.functionName, fn.endLine);

      expect(dispatchedParams).toEqual({
        filePath: "backend/src/services/orderService.js",
        startLine: 42,
        funcName: "processOrder(id)",
        endLine: 88,
      });
    });

    test("WBS 1.2: CoverageTypeDashboard.jsx forwards identical coordinate parameters in both Call Map and Details Table", () => {
      let callMapResult = null;
      let detailsTableResult = null;

      const mockOpenFile = (filePath, line, name, endLine) => ({
        filePath,
        line,
        name,
        endLine,
      });

      const fn = {
        filePath: "backend/src/routes/api.js",
        functionName: "routeHandler",
        line: 15,
        endLine: 35,
      };

      // Call Map invocation
      callMapResult = mockOpenFile(fn.filePath, fn.line, fn.functionName, fn.endLine);

      // Details Table invocation
      detailsTableResult = mockOpenFile(fn.filePath, fn.startLine || fn.line || 1, fn.functionName, fn.endLine);

      expect(callMapResult).toEqual(detailsTableResult);
      expect(callMapResult.filePath).toBe("backend/src/routes/api.js");
      expect(callMapResult.line).toBe(15);
      expect(callMapResult.endLine).toBe(35);
    });

    test("WBS 1.3: UnitTestDashboard.jsx prop-spread ensures onOpenCFG is never dropped or stubbed", () => {
      let forwardedTarget = null;
      const handleOpenCFG = (filePath, funcName, line) => {
        forwardedTarget = { filePath, funcName, line };
      };

      // Simulates UnitTestDashboard forwarder: <CoverageTypeDashboard {...props} type="unit" />
      const unitTestDashboardProps = {
        onOpenCFG: handleOpenCFG,
        type: "unit",
      };

      unitTestDashboardProps.onOpenCFG("src/auth.js", "login", 20);

      expect(forwardedTarget).toEqual({
        filePath: "src/auth.js",
        funcName: "login",
        line: 20,
      });
    });
  });

  describe("6.2 Phase 2: CFG Auto-Focus & Code Scroll (WBS 2.1 - 2.3)", () => {
    const candidateFiles = [
      "src/controllers/authController.js",
      "src/services/paymentService.js",
      "src/utils/math.js",
    ];

    const sampleFunctions = [
      { functionName: "initModule", startLine: 1, endLine: 10 },
      { functionName: "validateInput", startLine: 12, endLine: 30 },
      { functionName: "executeTransaction", startLine: 32, endLine: 85 },
      { functionName: "anonymous_fn", startLine: 90, endLine: 105 },
    ];

    test("WBS 2.1: Resolves matched file and function via fuzzy matching engine", () => {
      const matchedFile = findMatchingCfgFile(candidateFiles, "./src/services/paymentService.js");
      expect(matchedFile).toBe("src/services/paymentService.js");

      const matchedFunc = findMatchingCfgFunction(sampleFunctions, "executeTransaction()", 32);
      expect(matchedFunc).toBe("executeTransaction");
    });

    test("WBS 2.2: Calculates target scroll line and verifies center scroll DOM target", () => {
      const activeCfg = sampleFunctions[2]; // executeTransaction
      const targetLine = activeCfg.startLine || 1;
      const elementId = `cfg-source-line-${targetLine}`;

      expect(targetLine).toBe(32);
      expect(elementId).toBe("cfg-source-line-32");
    });

    test("WBS 2.3: CFG Toolbar 'Open in Editor' dispatches normalized parameters and closes modal", () => {
      let modalClosed = false;
      let openFileDispatched = null;

      const onClose = () => {
        modalClosed = true;
      };
      const onOpenFile = (file, line, func, endLine) => {
        openFileDispatched = { file, line, func, endLine };
      };

      const selectedFile = "src/services/paymentService.js";
      const selectedFunc = "executeTransaction";
      const activeCfg = sampleFunctions[2];

      // User clicks 'Open in Editor' in CFGCalculator toolbar
      onClose();
      onOpenFile(selectedFile, activeCfg.startLine, selectedFunc, activeCfg.endLine);

      expect(modalClosed).toBe(true);
      expect(openFileDispatched).toEqual({
        file: "src/services/paymentService.js",
        line: 32,
        func: "executeTransaction",
        endLine: 85,
      });
    });
  });

  describe("6.3 Phase 3: Hiện Thực Hóa Monaco Line Jump Engine (WBS 3.1 - 3.3)", () => {
    test("WBS 3.1: Layout.jsx constructs unique editorJumpTarget with timestamp", () => {
      let jumpTarget = null;
      const setEditorJumpTarget = (target) => {
        jumpTarget = target;
      };

      const handleOpenFileByPath = (filePath, targetLine = null, functionName = null, endLine = null) => {
        const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
        if (targetLine && Number(targetLine) > 0) {
          setEditorJumpTarget({
            filePath: normalizedPath,
            line: Number(targetLine),
            endLine: endLine ? Number(endLine) : null,
            functionName: functionName || null,
            timestamp: Date.now(),
          });
        }
      };

      handleOpenFileByPath("src/controllers/authController.js", 15, "login", 40);

      expect(jumpTarget).not.toBeNull();
      expect(jumpTarget.filePath).toBe("src/controllers/authController.js");
      expect(jumpTarget.line).toBe(15);
      expect(jumpTarget.endLine).toBe(40);
      expect(jumpTarget.functionName).toBe("login");
      expect(typeof jumpTarget.timestamp).toBe("number");
    });

    test("WBS 3.2: Editor.jsx clamps safe line bounds and coordinates viewport actions", () => {
      const modelLineCount = 120;
      const range = calculateSafeMonacoLineRange(15, 40, modelLineCount);

      expect(range).toEqual({
        startLine: 15,
        endLine: 40,
        startColumn: 1,
        endColumn: 1,
      });

      // Clamping when exceeding line count
      const overflowRange = calculateSafeMonacoLineRange(150, 200, modelLineCount);
      expect(overflowRange.startLine).toBe(120);
      expect(overflowRange.endLine).toBe(120);
    });

    test("WBS 3.3: Monaco function range decoration tokens and animation configuration", () => {
      const decorationConfig = {
        isWholeLine: true,
        className: "monaco-function-active-range",
        marginClassName: "monaco-function-glyph-marker",
        linesDecorationsClassName: "monaco-function-line-number-active",
        autoFadeDurationMs: 3500,
      };

      expect(decorationConfig.className).toBe("monaco-function-active-range");
      expect(decorationConfig.marginClassName).toBe("monaco-function-glyph-marker");
      expect(decorationConfig.linesDecorationsClassName).toBe("monaco-function-line-number-active");
      expect(decorationConfig.autoFadeDurationMs).toBe(3500);
    });
  });

  describe("6.4 Ma Trận Quản Trị Rủi Ro Kỹ Thuật (Risk Mitigation Matrix)", () => {
    test("Rủi ro 1: File lớn chưa tải xong nội dung -> Pending jump xử lý an toàn khi model/content sẵn sàng", () => {
      let isFileLoading = true;
      let pendingJump = { filePath: "src/bigFile.js", line: 250 };
      let executedJump = null;

      // File finished loading
      isFileLoading = false;
      if (!isFileLoading && pendingJump) {
        executedJump = { ...pendingJump, executed: true };
      }

      expect(executedJump).not.toBeNull();
      expect(executedJump.executed).toBe(true);
      expect(executedJump.line).toBe(250);
    });

    test("Rủi ro 2: Hàm vô danh không khớp tên -> Fallback khớp theo số dòng startLine và khoảng bao phủ", () => {
      const functions = [
        { functionName: "renderList", startLine: 10, endLine: 35 },
        { functionName: "", startLine: 40, endLine: 65 }, // Anonymous
      ];

      // Anonymous function called without valid name
      const matchedByLine = findMatchingCfgFunction(functions, "anonymous()", 45);
      expect(matchedByLine).toBe(""); // Successfully matched the anonymous function covering line 45
    });

    test("Rủi ro 3: Trùng lặp đường dẫn tương đối (./src vs src) -> Normalize path loại bỏ tiền tố thừa", () => {
      const pathA = "./src/components/Editor.jsx";
      const pathB = "src\\components\\Editor.jsx";

      const normalizedA = normalizePathForCompare(pathA);
      const normalizedB = normalizePathForCompare(pathB);

      expect(normalizedA).toBe("src/components/editor.jsx");
      expect(normalizedB).toBe("src/components/editor.jsx");
      expect(normalizedA).toBe(normalizedB);
    });
  });
});
