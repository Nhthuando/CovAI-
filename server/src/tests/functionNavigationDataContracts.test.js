/**
 * Verification Test Suite for Section 3: Data Model Specifications & API Contracts
 * THIẾT KẾ DỮ LIỆU & API CONTRACTS (DATA MODEL SPECIFICATION)
 *
 * Verifies Section 3.1 (Navigation Target Interface) and
 * Section 3.2 (Fuzzy Matching Engine) from:
 * docs/function-coverage-cfg-code-navigation-plan.md
 */

import { describe, it, expect } from "@jest/globals";
import {
  normalizePathForCompare,
  findMatchingCfgFile,
  findMatchingCfgFunction,
  createFunctionNavigationTarget,
  createCfgInitialContext,
  createEditorJumpTarget,
  calculateClampedLineRange,
} from "../utils/functionNavigationHelpers.js";

describe("## 3. THIẾT KẾ DỮ LIỆU & API CONTRACTS (DATA MODEL SPECIFICATION)", () => {
  const sampleCandidateFiles = [
    "backend/src/services/sentence.service.js",
    "backend/src/services/auth.service.js",
    "backend/src/controllers/api.controller.js",
    "client/src/utils/formatter.js",
  ];

  const sampleFileCfgs = [
    {
      functionName: "lines",
      startLine: 156,
      endLine: 170,
      filePath: "backend/src/services/sentence.service.js",
    },
    {
      functionName: "test",
      startLine: 158,
      endLine: 185,
      filePath: "backend/src/services/sentence.service.js",
    },
    {
      functionName: "toSingleSentence",
      startLine: 192,
      endLine: 206,
      filePath: "backend/src/services/sentence.service.js",
    },
    {
      functionName: "func_L210",
      startLine: 210,
      endLine: 225,
      filePath: "backend/src/services/sentence.service.js",
    },
  ];

  describe("3.1 Hợp Đồng Dữ Liệu Điều Hướng (Navigation Target Interface Specifications)", () => {
    it("3.1.1 FunctionNavigationTarget: Validates structural schema, line indices, and defaults", () => {
      const target = createFunctionNavigationTarget({
        filePath: "backend\\src\\services\\sentence.service.js",
        functionName: "toSingleSentence",
        startLine: 192,
        endLine: 206,
        hit: 42,
      });

      expect(target.filePath).toBe("backend/src/services/sentence.service.js");
      expect(target.functionName).toBe("toSingleSentence");
      expect(target.displayName).toBe("toSingleSentence()");
      expect(target.startLine).toBe(192);
      expect(target.endLine).toBe(206);
      expect(target.hit).toBe(42);

      // Enforces 1-indexed line numbers
      const clampedTarget = createFunctionNavigationTarget({
        filePath: "test.js",
        functionName: "testFn",
        startLine: -5,
        endLine: -1,
      });
      expect(clampedTarget.startLine).toBe(1);
      expect(clampedTarget.endLine).toBe(1);

      // Throws on missing required fields
      expect(() => createFunctionNavigationTarget({ filePath: "" })).toThrow();
      expect(() => createFunctionNavigationTarget({ filePath: "a.js", functionName: "" })).toThrow();
    });

    it("3.1.2 CfgInitialContext: Validates modal context payload and timestamp validity", () => {
      const nowBefore = Date.now();
      const ctx = createCfgInitialContext("backend/src/services/sentence.service.js", "toSingleSentence", 192);
      const nowAfter = Date.now();

      expect(ctx).toBeDefined();
      expect(ctx.initialFile).toBe("backend/src/services/sentence.service.js");
      expect(ctx.initialFunc).toBe("toSingleSentence");
      expect(ctx.initialLine).toBe(192);
      expect(ctx.timestamp).toBeGreaterThanOrEqual(nowBefore);
      expect(ctx.timestamp).toBeLessThanOrEqual(nowAfter);

      // Returns null when filePath is empty or null
      expect(createCfgInitialContext(null)).toBeNull();
      expect(createCfgInitialContext("")).toBeNull();
    });

    it("3.1.3 EditorJumpTarget: Validates Monaco jump target payload and coordinate types", () => {
      const jump = createEditorJumpTarget("backend\\src\\services\\sentence.service.js", 192, 206, "toSingleSentence");

      expect(jump).toBeDefined();
      expect(jump.filePath).toBe("backend/src/services/sentence.service.js");
      expect(jump.line).toBe(192);
      expect(jump.endLine).toBe(206);
      expect(jump.functionName).toBe("toSingleSentence");
      expect(typeof jump.timestamp).toBe("number");

      // Auto-defaults endLine to line if endLine is null
      const singleLineJump = createEditorJumpTarget("index.js", 50);
      expect(singleLineJump.line).toBe(50);
      expect(singleLineJump.endLine).toBe(50);

      // Returns null for empty filePath
      expect(createEditorJumpTarget(null, 10)).toBeNull();
    });
  });

  describe("3.2 Thuật Toán Khớp Đường Dẫn Thông Minh (Fuzzy Matching Engine - Path Resolution)", () => {
    it("3.2.1 normalizePathForCompare: Strips OS backslashes, leading ./, repo roots, and lowercases", () => {
      expect(normalizePathForCompare("backend\\src\\services\\A.js")).toBe("backend/src/services/a.js");
      expect(normalizePathForCompare("./src/services/a.js")).toBe("src/services/a.js");
      expect(
        normalizePathForCompare(
          "storage/projects/p123/github/179123/repo/backend/src/services/sentence.service.js"
        )
      ).toBe("backend/src/services/sentence.service.js");
      expect(normalizePathForCompare("repo/backend/src/services/sentence.service.js")).toBe(
        "backend/src/services/sentence.service.js"
      );
      expect(normalizePathForCompare(null)).toBe("");
      expect(normalizePathForCompare("")).toBe("");
    });

    it("3.2.2 findMatchingCfgFile: Matches exact paths across casing and separators", () => {
      const target = "BACKEND\\SRC\\SERVICES\\sentence.service.js";
      const matched = findMatchingCfgFile(sampleCandidateFiles, target);
      expect(matched).toBe("backend/src/services/sentence.service.js");
    });

    it("3.2.3 findMatchingCfgFile: Matches by suffix (endsWith) when target uses relative subpath", () => {
      const target = "services/auth.service.js";
      const matched = findMatchingCfgFile(sampleCandidateFiles, target);
      expect(matched).toBe("backend/src/services/auth.service.js");
    });

    it("3.2.4 findMatchingCfgFile: Matches by basename when directories differ", () => {
      const target = "components/formatter.js";
      const matched = findMatchingCfgFile(sampleCandidateFiles, target);
      expect(matched).toBe("client/src/utils/formatter.js");
    });

    it("3.2.5 findMatchingCfgFile: Matches truncated path with ellipsis from UI display e.g. 'backend/src/services/a...'", () => {
      const truncated = "backend/src/services/a...";
      const matched = findMatchingCfgFile(sampleCandidateFiles, truncated);
      expect(matched).toBe("backend/src/services/auth.service.js");
    });

    it("3.2.6 findMatchingCfgFile: Safely falls back to first candidate when target is unmatched or null", () => {
      expect(findMatchingCfgFile(sampleCandidateFiles, null)).toBe(sampleCandidateFiles[0]);
      expect(findMatchingCfgFile(sampleCandidateFiles, "completely_random.txt")).toBe(
        sampleCandidateFiles[0]
      );
      expect(findMatchingCfgFile([], "a.js")).toBeNull();
    });
  });

  describe("3.3 Thuật Toán Khớp Hàm Thông Minh (Fuzzy Matching Engine - Function Resolution)", () => {
    it("3.3.1 Matches function by exact name", () => {
      const matched = findMatchingCfgFunction(sampleFileCfgs, "toSingleSentence", 192);
      expect(matched).toBe("toSingleSentence");
    });

    it("3.3.2 Strips parentheses suffix e.g. 'toSingleSentence()' -> 'toSingleSentence'", () => {
      const matched = findMatchingCfgFunction(sampleFileCfgs, "toSingleSentence()", null);
      expect(matched).toBe("toSingleSentence");
    });

    it("3.3.3 Matches function name case-insensitively", () => {
      const matched = findMatchingCfgFunction(sampleFileCfgs, "TOSINGLESENTENCE", null);
      expect(matched).toBe("toSingleSentence");
    });

    it("3.3.4 Matches anonymous functions by exact startLine", () => {
      const matched = findMatchingCfgFunction(sampleFileCfgs, "anonymous_3", 210);
      expect(matched).toBe("func_L210");
    });

    it("3.3.5 Matches function by line containment inside span [startLine, endLine]", () => {
      // Line 195 is between 192 and 206
      const matched = findMatchingCfgFunction(sampleFileCfgs, null, 195);
      expect(matched).toBe("toSingleSentence");
    });

    it("3.3.6 Falls back to first function when neither name nor line matches", () => {
      const matched = findMatchingCfgFunction(sampleFileCfgs, "unknownFunc", 9999);
      expect(matched).toBe("lines");
      expect(findMatchingCfgFunction([], "test", 1)).toBeNull();
    });
  });

  describe("3.4 Giới Hạn Dòng An Toàn Monaco Model Bounds (Clamped Line Range Calculation)", () => {
    it("Calculates 1-indexed range clamped within Monaco model line count", () => {
      const maxLines = 150;

      // In-bound request
      const normal = calculateClampedLineRange(50, 80, maxLines);
      expect(normal).toEqual({
        startLine: 50,
        startColumn: 1,
        endLine: 80,
        endColumn: 1,
      });

      // Out-of-bound request: clamped to maxLines
      const outOfBounds = calculateClampedLineRange(140, 200, maxLines);
      expect(outOfBounds).toEqual({
        startLine: 140,
        startColumn: 1,
        endLine: 150,
        endColumn: 1,
      });

      // Negative line request: clamped to 1
      const negativeLine = calculateClampedLineRange(-10, -5, maxLines);
      expect(negativeLine).toEqual({
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
      });
    });
  });
});
