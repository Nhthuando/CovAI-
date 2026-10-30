import React, { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Edit3,
  Bot,
  Zap,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  X,
  ArrowRight,
  ArrowLeft,
  Play,
  RotateCcw,
  Check,
  FileCode2,
  Code,
  Layers,
  ChevronDown,
  Info,
  BookOpen,
  Terminal,
  Loader2,
  ShieldCheck,
  BrainCircuit,
  PenTool,
  FlaskConical,
  Boxes,
  PlayCircle,
  Scale,
} from "lucide-react";
import Editor from "@monaco-editor/react";

/**
 * 4-Category Decision Table Matrix definitions with educational explanations (English)
 */
const TEST_CATEGORIES = [
  {
    id: "HAPPY_PATH",
    category: "Category A",
    title: "Happy Path (Standard Execution)",
    badgeColor: "#10b981",
    bgColorLight: "#f0fdf4",
    borderColorLight: "#86efac",
    textColorLight: "#166534",
    bgColorDark: "rgba(16, 185, 129, 0.12)",
    borderColorDark: "rgba(16, 185, 129, 0.35)",
    description: "Test the function with valid input parameters, expected normal state transitions, and verify correct return values.",
    exampleHint: "Example: Valid credentials -> returns { success: true, token: 'xyz' }.",
  },
  {
    id: "BOUNDARY_VALUE",
    category: "Category B",
    title: "Boundary Value (Edge Limits)",
    badgeColor: "#f59e0b",
    bgColorLight: "#fffbeb",
    borderColorLight: "#fde68a",
    textColorLight: "#92400e",
    bgColorDark: "rgba(245, 158, 11, 0.12)",
    borderColorDark: "rgba(245, 158, 11, 0.35)",
    description: "Test extreme and boundary values: 0, negative -1, empty string '', empty array [], or empty object {}.",
    exampleHint: "Example: Empty cart [] -> safely calculates total as 0 without crashing.",
  },
  {
    id: "BRANCH_TOGGLING",
    category: "Category C",
    title: "Branch Toggling (Conditional Logic)",
    badgeColor: "#3b82f6",
    bgColorLight: "#eff6ff",
    borderColorLight: "#bfdbfe",
    textColorLight: "#1e40af",
    bgColorDark: "rgba(59, 130, 246, 0.12)",
    borderColorDark: "rgba(59, 130, 246, 0.35)",
    description: "Test alternative logical branches in if/else statements, ternary operators (?), or fallback values (||, ??).",
    exampleHint: "Example: If user.role === 'admin' execute privileged path, otherwise execute restricted path.",
  },
  {
    id: "ERROR_HANDLING",
    category: "Category D",
    title: "Error Handling (Exceptions & Rejections)",
    badgeColor: "#ef4444",
    bgColorLight: "#fef2f2",
    borderColorLight: "#fecaca",
    textColorLight: "#991b1b",
    bgColorDark: "rgba(239, 68, 68, 0.12)",
    borderColorDark: "rgba(239, 68, 68, 0.35)",
    description: "Verify that the function throws errors, catches exceptions, or rejects promises when encountering invalid inputs or dependency failures.",
    exampleHint: "Example: Non-existent ID -> throws NotFoundError('Resource not found').",
  },
];

/**
 * 3A Pattern Educational Guide using Lucide SVG Icons (English)
 */
const TRIPLE_A_GUIDE = [
  {
    step: "1. Arrange (Setup)",
    Icon: Boxes,
    color: "#6366f1",
    description: "Declare input arguments, set up test fixtures, or configure mock dependencies.",
  },
  {
    step: "2. Act (Execute)",
    Icon: PlayCircle,
    color: "#ec4899",
    description: "Invoke the target function using the prepared parameters from step 1.",
  },
  {
    step: "3. Assert (Verify)",
    Icon: Scale,
    color: "#10b981",
    description: "Compare the actual function return value against expected results using expect(result).toBe(...).",
  },
];

/**
 * Helper to normalize and strip storage/container prefixes
 */
function cleanPath(p = "") {
  if (!p) return "";
  return p
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/(?:^|\/)(?:repo|storage\/projects\/[^/]+(?:\/[^/]+)*?\/(?:repo\/)?)/i, "")
    .replace(/(?:^|\/)uploads\/snapshots\/[^/]+\/[^/]+\//i, "")
    .trim();
}

/**
 * Computes a sensible relative import path from tests/ to the source file
 */
function computeRelativeImport(filePath = "") {
  if (!filePath) return "../src/services/sample";
  const clean = cleanPath(filePath).replace(/\.[cm]?[jt]sx?$/, "");
  if (clean.startsWith("src/")) {
    return `../${clean}`;
  }
  return `../../${clean}`;
}

/**
 * Generates annotated boilerplate unit test code from real business logic function & file
 */
function generateAnnotatedTestTemplate({
  framework = "vitest",
  functionName = "",
  filePath = "",
  category = "HAPPY_PATH",
}) {
  const isVitest = framework === "vitest";
  const cleanModName = filePath ? cleanPath(filePath).split("/").pop().replace(/\.[^.]+$/, "") : "sample";
  const fallbackFn = cleanModName && cleanModName !== "sample"
    ? `run${cleanModName.charAt(0).toUpperCase() + cleanModName.slice(1)}`
    : "processAction";
  const cleanFn = (functionName || fallbackFn).replace(/[^a-zA-Z0-9_$]/g, "") || "processAction";
  const relativeImport = computeRelativeImport(filePath);

  if (isVitest) {
    let scenarioSnippet = "";
    if (category === "HAPPY_PATH") {
      scenarioSnippet = `  // [Category A Scenario: Happy Path]
  it('TC-HAPPY-01: should return expected result when input parameters are valid', async () => {
    // -------------------------------------------------------------
    // [STEP 1 - ARRANGE]: Prepare test input fixtures
    // -------------------------------------------------------------
    const mockInput = { id: 1, name: 'CovAI Sample' };
    const mockOptions = { active: true };

    // -------------------------------------------------------------
    // [STEP 2 - ACT]: Call target function under test
    // -------------------------------------------------------------
    const result = await ${cleanFn}(mockInput, mockOptions);

    // -------------------------------------------------------------
    // [STEP 3 - ASSERT]: Compare actual output with expected outcome
    // -------------------------------------------------------------
    // toBe: compares primitive values (number, boolean, string)
    // toEqual: deeply compares objects and arrays
    expect(result).toBeDefined();
    // expect(result.success).toBe(true);
  });`;
    } else if (category === "BOUNDARY_VALUE") {
      scenarioSnippet = `  // [Category B Scenario: Boundary Value]
  it('TC-BOUND-01: should safely handle boundary inputs (zero, empty, null)', async () => {
    // [STEP 1 - ARRANGE]: Extreme boundary values
    const emptyCollection = [];
    const zeroLimit = 0;

    // [STEP 2 - ACT]: Execute target function
    const result = await ${cleanFn}(emptyCollection, zeroLimit);

    // [STEP 3 - ASSERT]: Ensure function returns safe default without crashing
    expect(result).toBeDefined();
    expect(result).toEqual([]);
  });`;
    } else if (category === "BRANCH_TOGGLING") {
      scenarioSnippet = `  // [Category C Scenario: Branch Toggling]
  it('TC-BRANCH-01: should exercise alternative conditional branch when flag is false', async () => {
    // [STEP 1 - ARRANGE]: Pass payload to trigger fallback / else branch
    const payloadWithFalseFlag = { enabled: false, fallbackMode: true };

    // [STEP 2 - ACT]: Call target function
    const result = await ${cleanFn}(payloadWithFalseFlag);

    // [STEP 3 - ASSERT]: Verify result reflects fallback branch execution
    expect(result).toBeDefined();
  });`;
    } else {
      scenarioSnippet = `  // [Category D Scenario: Error Handling]
  it('TC-ERR-01: should throw an error or reject promise when input is invalid', async () => {
    // [STEP 1 - ARRANGE]: Invalid arguments (null / missing required fields)
    const invalidInput = null;

    // [STEPS 2 & 3 - ACT & ASSERT]: Assert exception with rejects.toThrow()
    await expect(${cleanFn}(invalidInput)).rejects.toThrow();
  });`;
    }

    return `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Import target function from source code (${cleanPath(filePath) || 'business logic'})
import { ${cleanFn} } from '${relativeImport}';

describe('${cleanFn} - Unit Test Suite', () => {
  beforeEach(() => {
    // Clear mock state before each test to guarantee test isolation
    vi.clearAllMocks();
  });

${scenarioSnippet}
});
`;
  }

  // CommonJS Jest Template
  let jestScenarioSnippet = "";
  if (category === "HAPPY_PATH") {
    jestScenarioSnippet = `  // [Category A Scenario: Happy Path]
  test('TC-HAPPY-01: should return expected result with valid arguments', async () => {
    // -------------------------------------------------------------
    // [STEP 1 - ARRANGE]: Prepare test input fixtures
    // -------------------------------------------------------------
    const mockInput = { id: 1, name: 'CovAI Sample' };
    const mockOptions = { active: true };

    // -------------------------------------------------------------
    // [STEP 2 - ACT]: Call target function under test
    // -------------------------------------------------------------
    const result = await ${cleanFn}(mockInput, mockOptions);

    // -------------------------------------------------------------
    // [STEP 3 - ASSERT]: Compare actual output with expected outcome
    // -------------------------------------------------------------
    expect(result).toBeDefined();
    // expect(result.success).toBe(true);
  });`;
  } else if (category === "BOUNDARY_VALUE") {
    jestScenarioSnippet = `  // [Category B Scenario: Boundary Value]
  test('TC-BOUND-01: should safely handle boundary inputs (zero, empty, null)', async () => {
    // [STEP 1 - ARRANGE]: Extreme boundary values
    const emptyCollection = [];
    const zeroLimit = 0;

    // [STEP 2 - ACT]: Execute target function
    const result = await ${cleanFn}(emptyCollection, zeroLimit);

    // [STEP 3 - ASSERT]: Ensure function returns safe default without crashing
    expect(result).toBeDefined();
    expect(result).toEqual([]);
  });`;
  } else if (category === "BRANCH_TOGGLING") {
    jestScenarioSnippet = `  // [Category C Scenario: Branch Toggling]
  test('TC-BRANCH-01: should exercise alternative conditional branch when flag is false', async () => {
    // [STEP 1 - ARRANGE]: Pass payload to trigger fallback / else branch
    const payloadWithFalseFlag = { enabled: false, fallbackMode: true };

    // [STEP 2 - ACT]: Call target function
    const result = await ${cleanFn}(payloadWithFalseFlag);

    // [STEP 3 - ASSERT]: Verify result reflects fallback branch execution
    expect(result).toBeDefined();
  });`;
  } else {
    jestScenarioSnippet = `  // [Category D Scenario: Error Handling]
  test('TC-ERR-01: should throw an error or reject promise when input is invalid', async () => {
    // [STEP 1 - ARRANGE]: Invalid arguments (null / missing required fields)
    const invalidInput = null;

    // [STEPS 2 & 3 - ACT & ASSERT]: Assert exception with rejects.toThrow()
    await expect(${cleanFn}(invalidInput)).rejects.toThrow();
  });`;
  }

  return `// 1. Import target function from source code (${cleanPath(filePath) || 'business logic'})
const { ${cleanFn} } = require('${relativeImport}');

describe('${cleanFn} - Unit Test Suite', () => {
  beforeEach(() => {
    // Clear mock state before each test to guarantee test isolation
    jest.clearAllMocks();
  });

${jestScenarioSnippet}
});
`;
}

/**
 * Lightweight JavaScript bracket balance & syntax sanity checker
 */
function checkSyntaxSanity(code) {
  if (!code || typeof code !== "string") return { valid: true, error: null };
  const stack = [];
  const lines = code.split("\n");

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === "{" || char === "(" || char === "[") {
        stack.push({ char, line: l + 1, col: c + 1 });
      } else if (char === "}" || char === ")" || char === "]") {
        if (stack.length === 0) {
          return {
            valid: false,
            error: `Unexpected closing '${char}' at line ${l + 1}, column ${c + 1}.`,
          };
        }
        const top = stack.pop();
        const expected = top.char === "{" ? "}" : top.char === "(" ? ")" : "]";
        if (char !== expected) {
          return {
            valid: false,
            error: `Mismatched bracket: Opened '${top.char}' at line ${top.line} but found '${char}' at line ${l + 1}.`,
          };
        }
      }
    }
  }

  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return {
      valid: false,
      error: `Unclosed bracket '${top.char}' opened at line ${top.line}, column ${top.col}. Please add corresponding closing bracket.`,
    };
  }

  return { valid: true, error: null };
}

export default function SuggestTestcaseModal({
  isOpen,
  onClose,
  targetFilePath = "",
  targetFunction = "",
  targetFunctionsList = [],
  allBusinessFiles = [],
  allFunctions = [],
  defaultFramework = "vitest",
  onConfirmAi,
  onApplyManualTest,
  isApplying = false,
  isLight = false,
}) {
  // Navigation: "SELECTION" (Step 1) vs "MANUAL_STUDIO" (Step 2 - Guided Mode)
  const [step, setStep] = useState("SELECTION");

  // Selection choices
  const [chosenMode, setChosenMode] = useState("AI"); // "AI" | "MANUAL"
  const [chosenFramework, setChosenFramework] = useState(defaultFramework || "vitest");

  // Deduplicated & sanitized business logic files list
  const cleanBusinessFiles = useMemo(() => {
    if (!allBusinessFiles || allBusinessFiles.length === 0) return [];
    const seen = new Set();
    const list = [];
    for (const f of allBusinessFiles) {
      const rawPath = f.filePath || f.path || (typeof f === "string" ? f : "");
      if (!rawPath) continue;
      const cp = cleanPath(rawPath);
      if (cp && !seen.has(cp)) {
        seen.add(cp);
        const fileName = cp.split("/").pop();
        const dir = cp.split("/").slice(0, -1).join("/");
        list.push({
          rawPath,
          cleanPath: cp,
          fileName,
          dir: dir || ".",
          linesPct: f.linesPct ?? null,
        });
      }
    }
    return list;
  }, [allBusinessFiles]);

  // Selected file state
  const [selectedFile, setSelectedFile] = useState(
    targetFilePath || cleanBusinessFiles[0]?.rawPath || ""
  );

  // Dynamic function list for the currently selected file
  const availableFunctionsForFile = useMemo(() => {
    if (!selectedFile) return targetFunctionsList || [];
    const cleanTarget = cleanPath(selectedFile);
    if (allFunctions && allFunctions.length > 0) {
      const matches = allFunctions.filter((fn) => {
        const fPath = fn.filePath || "";
        return fPath === selectedFile || cleanPath(fPath) === cleanTarget;
      });
      if (matches.length > 0) return matches;
    }
    return targetFunctionsList && targetFunctionsList.length > 0 ? targetFunctionsList : [];
  }, [selectedFile, allFunctions, targetFunctionsList]);

  // Manual Studio state: active function & category
  const [activeCategory, setActiveCategory] = useState("HAPPY_PATH");
  const [selectedFunc, setSelectedFunc] = useState(
    targetFunction ||
      availableFunctionsForFile[0]?.functionName ||
      availableFunctionsForFile[0]?.name ||
      ""
  );

  // Code editor content & syntax sanity
  const [codeContent, setCodeContent] = useState("");
  const [syntaxStatus, setSyntaxStatus] = useState({ valid: true, error: null });

  // Sync state on modal open
  useEffect(() => {
    if (isOpen) {
      setStep("SELECTION");
      setChosenFramework(defaultFramework || "vitest");
      const initialFile = targetFilePath || cleanBusinessFiles[0]?.rawPath || "";
      setSelectedFile(initialFile);

      const fns = (allFunctions || []).filter((fn) => {
        const fPath = fn.filePath || "";
        return fPath === initialFile || cleanPath(fPath) === cleanPath(initialFile);
      });
      const resolvedFns = fns.length > 0 ? fns : targetFunctionsList || [];
      const initialFn = targetFunction || resolvedFns[0]?.functionName || resolvedFns[0]?.name || "";
      setSelectedFunc(initialFn);
    }
  }, [isOpen, defaultFramework, targetFilePath, targetFunction, cleanBusinessFiles, allFunctions, targetFunctionsList]);

  // When selectedFile changes, sync selectedFunc to first available function if not present
  useEffect(() => {
    if (availableFunctionsForFile.length > 0) {
      const exists = availableFunctionsForFile.some(
        (fn) => (fn.functionName || fn.displayName || fn.name) === selectedFunc
      );
      if (!exists) {
        setSelectedFunc(
          availableFunctionsForFile[0]?.functionName ||
            availableFunctionsForFile[0]?.displayName ||
            availableFunctionsForFile[0]?.name ||
            ""
        );
      }
    }
  }, [availableFunctionsForFile, selectedFunc]);

  // Regenerate template when entering studio or toggling function / category / framework / file
  useEffect(() => {
    if (step === "MANUAL_STUDIO") {
      const template = generateAnnotatedTestTemplate({
        framework: chosenFramework,
        functionName: selectedFunc,
        filePath: selectedFile,
        category: activeCategory,
      });
      setCodeContent(template);
      setSyntaxStatus(checkSyntaxSanity(template));
    }
  }, [step, chosenFramework, selectedFunc, selectedFile, activeCategory]);

  // Live syntax check on editor changes
  const handleEditorChange = (value) => {
    const newCode = value || "";
    setCodeContent(newCode);
    setSyntaxStatus(checkSyntaxSanity(newCode));
  };

  // Quick preset loader
  const handleApplyPreset = (catId) => {
    setActiveCategory(catId);
    const template = generateAnnotatedTestTemplate({
      framework: chosenFramework,
      functionName: selectedFunc,
      filePath: selectedFile,
      category: catId,
    });
    setCodeContent(template);
    setSyntaxStatus(checkSyntaxSanity(template));
  };

  // Handle switching file from dropdown
  const handleFileChange = (newFile) => {
    setSelectedFile(newFile);
    const cleanTarget = cleanPath(newFile);
    const matchingFns = (allFunctions || []).filter((fn) => {
      const fPath = fn.filePath || "";
      return fPath === newFile || cleanPath(fPath) === cleanTarget;
    });
    const nextFn = matchingFns[0]?.functionName || matchingFns[0]?.displayName || matchingFns[0]?.name || "";
    setSelectedFunc(nextFn);
  };

  // Submit action for AI generation
  const handleConfirm = async () => {
    if (chosenMode === "AI") {
      onConfirmAi?.({
        framework: chosenFramework,
        filePath: selectedFile || targetFilePath,
      });
      onClose();
    } else {
      setStep("MANUAL_STUDIO");
    }
  };

  // Submit action for manual test apply
  const handleApplyManual = async () => {
    if (!syntaxStatus.valid) {
      alert("Please resolve syntax errors before saving and executing tests.");
      return;
    }
    await onApplyManualTest?.({
      framework: chosenFramework,
      filePath: selectedFile || targetFilePath,
      functionName: selectedFunc,
      generatedCode: codeContent,
    });
    onClose();
  };

  if (!isOpen) return null;

  const displayFileName = selectedFile
    ? cleanPath(selectedFile).split("/").pop()
    : targetFilePath
      ? cleanPath(targetFilePath).split("/").pop()
      : "Entire Project";

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
        style={{
          background: "rgba(0, 0, 0, 0.78)",
          backdropFilter: "blur(10px)",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !isApplying) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className={`w-full ${
            step === "SELECTION"
              ? "max-w-4xl xl:max-w-5xl h-auto max-h-[92vh]"
              : "max-w-6xl xl:max-w-7xl h-[88vh] max-h-[92vh]"
          } flex flex-col rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 relative`}
          style={{
            background: isLight ? "#ffffff" : "#0f172a",
            border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(139, 92, 246, 0.3)",
            boxShadow: isLight
              ? "0 25px 60px -15px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)"
              : "0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 32px rgba(99, 102, 241, 0.2)",
            color: isLight ? "#0f172a" : "#f8fafc",
          }}
        >
          {/* ── Top Header (Centered) ── */}
          <div
            className="relative px-6 py-5 flex-shrink-0 flex flex-col items-center justify-center text-center"
            style={{
              background: isLight ? "#f8fafc" : "#131b2e",
              borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Close Button top-right */}
            <button
              onClick={onClose}
              disabled={isApplying}
              className={`absolute right-5 top-5 p-2 rounded-xl transition-colors ${
                isLight
                  ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200/70"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
              title="Close modal"
            >
              <X size={19} />
            </button>

            {/* Centered Icon */}
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-md mb-2.5"
              style={{
                background:
                  step === "MANUAL_STUDIO"
                    ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                    : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                boxShadow:
                  step === "MANUAL_STUDIO"
                    ? "0 4px 14px rgba(16, 185, 129, 0.35)"
                    : "0 4px 14px rgba(99, 102, 241, 0.35)",
              }}
            >
              {step === "MANUAL_STUDIO" ? (
                <PenTool size={22} className="text-white" />
              ) : (
                <BrainCircuit size={22} className="text-white" />
              )}
            </div>

            {/* Centered Title & Badge */}
            <div className="flex items-center justify-center gap-2.5 flex-wrap">
              <h2
                className={`text-lg font-bold ${
                  isLight ? "text-slate-900" : "text-slate-100"
                }`}
              >
                {step === "MANUAL_STUDIO"
                  ? "Guided Unit Test Authoring Studio"
                  : "Unit Test Suggestion & Design"}
              </h2>
              <span
                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                style={{
                  background: isLight ? "#e0e7ff" : "rgba(99, 102, 241, 0.2)",
                  color: isLight ? "#3730a3" : "#a5b4fc",
                  border: isLight ? "1px solid #c7d2fe" : "1px solid rgba(99, 102, 241, 0.35)",
                }}
              >
                {displayFileName}
              </span>
            </div>

            {/* Centered Subtitle */}
            <p
              className={`text-xs mt-1 max-w-xl mx-auto leading-relaxed ${
                isLight ? "text-slate-600 font-medium" : "text-slate-400"
              }`}
            >
              {step === "MANUAL_STUDIO"
                ? "Step-by-step guidance for beginners following the 3A pattern & 4-category decision table"
                : "Select your preferred test creation method and target testing framework"}
            </p>
          </div>

          {/* ── Modal Body Content (Vertically Centered in Selection Mode) ── */}
          <div
            className={`flex-1 overflow-y-auto p-6 sm:p-8 flex flex-col gap-6 ${
              step === "SELECTION" ? "justify-center" : ""
            }`}
          >
            {step === "SELECTION" ? (
              /* ══════════════════════════════════════════════════════════════
                 SCREEN 1: MODE & FRAMEWORK SELECTION
                 ══════════════════════════════════════════════════════════════ */
              <div className="flex flex-col gap-6 max-w-4xl mx-auto my-auto w-full">
                {/* 1. Choose Generation Mode */}
                <div>
                  <label
                    className={`text-xs font-bold uppercase tracking-wider mb-3.5 flex items-center gap-1.5 ${
                      isLight ? "text-slate-700" : "text-slate-300"
                    }`}
                  >
                    <span>1. Choose Test Creation Method</span>
                    <span className="text-indigo-500 font-bold">*</span>
                  </label>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Card A: Manual Guided Mode */}
                    <div
                      onClick={() => setChosenMode("MANUAL")}
                      role="button"
                      tabIndex={0}
                      className="rounded-2xl p-5 cursor-pointer transition-all flex flex-col justify-between relative overflow-hidden"
                      style={{
                        background:
                          chosenMode === "MANUAL"
                            ? isLight
                              ? "#f0fdf4"
                              : "rgba(16, 185, 129, 0.08)"
                            : isLight
                              ? "#ffffff"
                              : "rgba(255, 255, 255, 0.02)",
                        border:
                          chosenMode === "MANUAL"
                            ? isLight
                              ? "2px solid #059669"
                              : "2px solid #10b981"
                            : isLight
                              ? "1px solid #cbd5e1"
                              : "1px solid rgba(255, 255, 255, 0.08)",
                        boxShadow:
                          chosenMode === "MANUAL"
                            ? isLight
                              ? "0 4px 20px rgba(16, 185, 129, 0.16)"
                              : "0 0 20px rgba(16, 185, 129, 0.25)"
                            : "none",
                      }}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                                isLight
                                  ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                                  : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                              }`}
                            >
                              <PenTool size={20} />
                            </div>
                            <div>
                              <h3
                                className={`font-bold text-base ${
                                  isLight ? "text-emerald-800" : "text-emerald-400"
                                }`}
                              >
                                Manual Guided Test Authoring
                              </h3>
                              <span
                                className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full mt-0.5 ${
                                  isLight
                                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                }`}
                              >
                                Beginner Friendly (A-Z)
                              </span>
                            </div>
                          </div>

                          {/* Selected Radio Indicator */}
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                              chosenMode === "MANUAL"
                                ? isLight
                                  ? "bg-emerald-600 text-white shadow-sm"
                                  : "bg-emerald-500 text-slate-950 font-bold"
                                : isLight
                                  ? "border-2 border-slate-300"
                                  : "border-2 border-slate-600"
                            }`}
                          >
                            {chosenMode === "MANUAL" && <Check size={14} strokeWidth={3} />}
                          </div>
                        </div>

                        <p
                          className={`text-xs leading-relaxed mb-4 ${
                            isLight ? "text-slate-700" : "text-slate-300"
                          }`}
                        >
                          CovAI guides you through the standard{" "}
                          <strong className={isLight ? "text-slate-900" : "text-white"}>
                            3A pattern (Arrange - Act - Assert)
                          </strong>
                          , explains code mechanics, and provides ready-to-use templates for 4 scenario categories.
                        </p>

                        <div
                          className={`flex flex-col gap-2 text-xs ${
                            isLight ? "text-slate-700 font-medium" : "text-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Check
                              size={15}
                              className={isLight ? "text-emerald-600 font-bold" : "text-emerald-400"}
                            />
                            <span>Standard 4-category templates (Happy Path, Boundary, Branching, Error)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Check
                              size={15}
                              className={isLight ? "text-emerald-600 font-bold" : "text-emerald-400"}
                            />
                            <span>Comprehensive code annotations explaining each step</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Check
                              size={15}
                              className={isLight ? "text-emerald-600 font-bold" : "text-emerald-400"}
                            />
                            <span>Real-time syntax validation preventing missing bracket errors</span>
                          </div>
                        </div>
                      </div>

                      <div
                        className={`mt-5 pt-3.5 flex items-center justify-between text-xs font-semibold ${
                          isLight
                            ? "text-emerald-700 border-t border-emerald-200"
                            : "text-emerald-400 border-t border-slate-800"
                        }`}
                      >
                        <span>Click to open Guided Studio</span>
                        <ArrowRight size={15} />
                      </div>
                    </div>

                    {/* Card B: AI-Generated Mode */}
                    <div
                      onClick={() => setChosenMode("AI")}
                      role="button"
                      tabIndex={0}
                      className="rounded-2xl p-5 cursor-pointer transition-all flex flex-col justify-between relative overflow-hidden"
                      style={{
                        background:
                          chosenMode === "AI"
                            ? isLight
                              ? "#eef2ff"
                              : "rgba(99, 102, 241, 0.1)"
                            : isLight
                              ? "#ffffff"
                              : "rgba(255, 255, 255, 0.02)",
                        border:
                          chosenMode === "AI"
                            ? isLight
                              ? "2px solid #4f46e5"
                              : "2px solid #818cf8"
                            : isLight
                              ? "1px solid #cbd5e1"
                              : "1px solid rgba(255, 255, 255, 0.08)",
                        boxShadow:
                          chosenMode === "AI"
                            ? isLight
                              ? "0 4px 20px rgba(99, 102, 241, 0.18)"
                              : "0 0 20px rgba(99, 102, 241, 0.25)"
                            : "none",
                      }}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                                isLight
                                  ? "bg-indigo-100 text-indigo-700 border border-indigo-300"
                                  : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/40"
                              }`}
                            >
                              <BrainCircuit size={20} />
                            </div>
                            <div>
                              <h3
                                className={`font-bold text-base ${
                                  isLight ? "text-indigo-800" : "text-indigo-400"
                                }`}
                              >
                                AI Automated Test Generation
                              </h3>
                              <span
                                className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full mt-0.5 ${
                                  isLight
                                    ? "bg-indigo-100 text-indigo-800 border border-indigo-300"
                                    : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                                }`}
                              >
                                100% Automated
                              </span>
                            </div>
                          </div>

                          {/* Selected Radio Indicator */}
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                              chosenMode === "AI"
                                ? isLight
                                  ? "bg-indigo-600 text-white shadow-sm"
                                  : "bg-indigo-500 text-slate-950 font-bold"
                                : isLight
                                  ? "border-2 border-slate-300"
                                  : "border-2 border-slate-600"
                            }`}
                          >
                            {chosenMode === "AI" && <Check size={14} strokeWidth={3} />}
                          </div>
                        </div>

                        <p
                          className={`text-xs leading-relaxed mb-4 ${
                            isLight ? "text-slate-700" : "text-slate-300"
                          }`}
                        >
                          CovAI parses the AST to detect uncovered lines and branch gaps, generating hermetic unit tests that execute independently in RAM.
                        </p>

                        <div
                          className={`flex flex-col gap-2 text-xs ${
                            isLight ? "text-slate-700 font-medium" : "text-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Check
                              size={15}
                              className={isLight ? "text-indigo-600 font-bold" : "text-indigo-400"}
                            />
                            <span>Precision scanning for uncovered logic and branch gaps</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Check
                              size={15}
                              className={isLight ? "text-indigo-600 font-bold" : "text-indigo-400"}
                            />
                            <span>Automatic mock isolation for Prisma, Axios, BullMQ, Redis</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Check
                              size={15}
                              className={isLight ? "text-indigo-600 font-bold" : "text-indigo-400"}
                            />
                            <span>Side-by-side diff review & 1-click merge into project</span>
                          </div>
                        </div>
                      </div>

                      <div
                        className={`mt-5 pt-3.5 flex items-center justify-between text-xs font-semibold ${
                          isLight
                            ? "text-indigo-700 border-t border-indigo-200"
                            : "text-indigo-400 border-t border-slate-800"
                        }`}
                      >
                        <span>Powered by CovAI Test Engine</span>
                        <Zap size={15} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Choose Test Framework (Vitest vs Jest) */}
                <div>
                  <label
                    className={`text-xs font-bold uppercase tracking-wider mb-3.5 flex items-center gap-1.5 ${
                      isLight ? "text-slate-700" : "text-slate-300"
                    }`}
                  >
                    <span>2. Choose Testing Framework (Test Runner)</span>
                    <span className="text-indigo-500 font-bold">*</span>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Vitest Option */}
                    <div
                      onClick={() => setChosenFramework("vitest")}
                      role="button"
                      tabIndex={0}
                      className="rounded-2xl p-4 cursor-pointer transition-all flex items-center justify-between relative overflow-hidden"
                      style={{
                        background:
                          chosenFramework === "vitest"
                            ? isLight
                              ? "#fffbeb"
                              : "rgba(234, 179, 8, 0.08)"
                            : isLight
                              ? "#ffffff"
                              : "rgba(255, 255, 255, 0.02)",
                        border:
                          chosenFramework === "vitest"
                            ? isLight
                              ? "2px solid #d97706"
                              : "2px solid #eab308"
                            : isLight
                              ? "1px solid #cbd5e1"
                              : "1px solid rgba(255, 255, 255, 0.08)",
                        boxShadow:
                          chosenFramework === "vitest"
                            ? isLight
                              ? "0 4px 16px rgba(217, 119, 6, 0.16)"
                              : "0 0 16px rgba(234, 179, 8, 0.2)"
                            : "none",
                      }}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                            isLight
                              ? "bg-amber-100 text-amber-700 border border-amber-300"
                              : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40"
                          }`}
                        >
                          <Zap size={22} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-bold text-sm ${
                                isLight ? "text-amber-900" : "text-yellow-400"
                              }`}
                            >
                              Vitest
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                isLight
                                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                                  : "bg-yellow-500/20 text-yellow-300"
                              }`}
                            >
                              Vite / ESM Native
                            </span>
                          </div>
                          <p
                            className={`text-xs mt-1 leading-snug ${
                              isLight ? "text-slate-700" : "text-slate-400"
                            }`}
                          >
                            Ultra-fast execution, native ESM support,{" "}
                            <code className="font-semibold text-amber-700 dark:text-amber-400">
                              vi.fn()
                            </code>
                            ,{" "}
                            <code className="font-semibold text-amber-700 dark:text-amber-400">
                              vi.mock()
                            </code>
                            .
                          </p>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ml-3 transition-all ${
                          chosenFramework === "vitest"
                            ? isLight
                              ? "bg-amber-600 text-white shadow-sm"
                              : "bg-yellow-500 text-slate-950 font-bold"
                            : isLight
                              ? "border-2 border-slate-300"
                              : "border-2 border-slate-600"
                        }`}
                      >
                        {chosenFramework === "vitest" && <Check size={12} strokeWidth={3} />}
                      </div>
                    </div>

                    {/* Jest Option */}
                    <div
                      onClick={() => setChosenFramework("jest")}
                      role="button"
                      tabIndex={0}
                      className="rounded-2xl p-4 cursor-pointer transition-all flex items-center justify-between relative overflow-hidden"
                      style={{
                        background:
                          chosenFramework === "jest"
                            ? isLight
                              ? "#fff1f2"
                              : "rgba(239, 68, 68, 0.08)"
                            : isLight
                              ? "#ffffff"
                              : "rgba(255, 255, 255, 0.02)",
                        border:
                          chosenFramework === "jest"
                            ? isLight
                              ? "2px solid #e11d48"
                              : "2px solid #ef4444"
                            : isLight
                              ? "1px solid #cbd5e1"
                              : "1px solid rgba(255, 255, 255, 0.08)",
                        boxShadow:
                          chosenFramework === "jest"
                            ? isLight
                              ? "0 4px 16px rgba(225, 29, 72, 0.16)"
                              : "0 0 16px rgba(239, 68, 68, 0.2)"
                            : "none",
                      }}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                            isLight
                              ? "bg-rose-100 text-rose-700 border border-rose-300"
                              : "bg-red-500/20 text-red-400 border border-red-500/40"
                          }`}
                        >
                          <FlaskConical size={22} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-bold text-sm ${
                                isLight ? "text-rose-900" : "text-red-400"
                              }`}
                            >
                              Jest
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                isLight
                                  ? "bg-rose-100 text-rose-800 border border-rose-300"
                                  : "bg-red-500/20 text-red-300"
                              }`}
                            >
                              CommonJS / Node.js
                            </span>
                          </div>
                          <p
                            className={`text-xs mt-1 leading-snug ${
                              isLight ? "text-slate-700" : "text-slate-400"
                            }`}
                          >
                            Industry standard for Node.js, Babel transform,{" "}
                            <code className="font-semibold text-rose-700 dark:text-rose-400">
                              jest.fn()
                            </code>
                            ,{" "}
                            <code className="font-semibold text-rose-700 dark:text-rose-400">
                              jest.mock()
                            </code>
                            .
                          </p>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ml-3 transition-all ${
                          chosenFramework === "jest"
                            ? isLight
                              ? "bg-rose-600 text-white shadow-sm"
                              : "bg-red-500 text-slate-950 font-bold"
                            : isLight
                              ? "border-2 border-slate-300"
                              : "border-2 border-slate-600"
                        }`}
                      >
                        {chosenFramework === "jest" && <Check size={12} strokeWidth={3} />}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* ══════════════════════════════════════════════════════════════
                 SCREEN 2: GUIDED MANUAL TEST STUDIO FOR BEGINNERS
                 ══════════════════════════════════════════════════════════════ */
              <div className="flex flex-col gap-4">
                {/* 1. Educational Infographic: Triple A (Arrange - Act - Assert) */}
                <div
                  className="rounded-2xl p-4 transition-colors"
                  style={{
                    background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.03)",
                    border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <BookOpen
                        size={17}
                        className={isLight ? "text-emerald-700" : "text-emerald-400"}
                      />
                      <span
                        className={`text-xs font-bold uppercase tracking-wider ${
                          isLight ? "text-slate-800" : "text-slate-300"
                        }`}
                      >
                        3A Golden Rule for Beginners (Arrange - Act - Assert)
                      </span>
                    </div>
                    <span
                      className={`text-[11px] font-medium ${
                        isLight ? "text-slate-600" : "text-slate-400"
                      }`}
                    >
                      Active Runner:{" "}
                      <b className={isLight ? "text-indigo-700 font-bold" : "text-yellow-400 font-bold"}>
                        {chosenFramework.toUpperCase()}
                      </b>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {TRIPLE_A_GUIDE.map((g) => {
                      const StepIcon = g.Icon;
                      return (
                        <div
                          key={g.step}
                          className="rounded-xl p-3 flex items-start gap-3 transition-colors"
                          style={{
                            background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.03)",
                            border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)",
                          }}
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{
                              background: isLight ? `${g.color}18` : `${g.color}25`,
                              color: g.color,
                            }}
                          >
                            <StepIcon size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold" style={{ color: g.color }}>
                              {g.step}
                            </div>
                            <p
                              className={`text-[11.5px] leading-snug mt-1 ${
                                isLight ? "text-slate-700" : "text-slate-400"
                              }`}
                            >
                              {g.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Visual Scenario & Function Builder */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
                  {/* Left Column: Business File, Function & Category selector */}
                  <div className="md:col-span-5 flex flex-col gap-4">
                    {/* File & Function Picker Card */}
                    <div
                      className="p-4 rounded-2xl transition-colors flex flex-col gap-3.5"
                      style={{
                        background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                        border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      {/* 1. Target Business File Selector */}
                      <div>
                        <label
                          className={`text-xs font-bold mb-1.5 flex items-center justify-between ${
                            isLight ? "text-slate-800" : "text-slate-300"
                          }`}
                        >
                          <span>Target Source File (Business Logic):</span>
                          {cleanBusinessFiles.length > 0 && (
                            <span className="text-[10px] font-semibold text-indigo-500">
                              {cleanBusinessFiles.length} files
                            </span>
                          )}
                        </label>
                        {cleanBusinessFiles.length > 0 ? (
                          <div className="relative">
                            <select
                              value={selectedFile}
                              onChange={(e) => handleFileChange(e.target.value)}
                              className={`w-full text-xs rounded-xl px-3.5 py-2.5 font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                isLight
                                  ? "bg-white border border-slate-300 text-slate-900 shadow-sm"
                                  : "bg-slate-900 border border-slate-700 text-slate-100"
                              }`}
                            >
                              {cleanBusinessFiles.map((bf) => (
                                <option key={bf.rawPath} value={bf.rawPath}>
                                  📄 {bf.fileName} ({bf.dir})
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div
                            className={`w-full text-xs rounded-xl px-3.5 py-2 font-medium truncate ${
                              isLight
                                ? "bg-slate-100 border border-slate-300 text-slate-700"
                                : "bg-slate-900 border border-slate-700 text-slate-300"
                            }`}
                          >
                            📄 {displayFileName}
                          </div>
                        )}
                      </div>

                      {/* 2. Target Business Function Selector */}
                      <div>
                        <label
                          className={`text-xs font-bold mb-1.5 flex items-center justify-between ${
                            isLight ? "text-slate-800" : "text-slate-300"
                          }`}
                        >
                          <span>Target Function to Test:</span>
                          <span
                            className={`text-[10px] font-semibold ${
                              availableFunctionsForFile.length > 0 ? "text-emerald-500" : "text-amber-500"
                            }`}
                          >
                            {availableFunctionsForFile.length} functions detected
                          </span>
                        </label>
                        {availableFunctionsForFile && availableFunctionsForFile.length > 0 ? (
                          <div className="relative">
                            <select
                              value={selectedFunc}
                              onChange={(e) => setSelectedFunc(e.target.value)}
                              className={`w-full text-xs rounded-xl px-3.5 py-2.5 font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                isLight
                                  ? "bg-white border border-slate-300 text-slate-900 shadow-sm"
                                  : "bg-slate-900 border border-slate-700 text-slate-100"
                              }`}
                            >
                              {availableFunctionsForFile.map((fn, idx) => {
                                const fName =
                                  fn.functionName || fn.displayName || fn.name || `function_${idx + 1}`;
                                const isUncovered = fn.hit === 0 || !fn.isCovered;
                                return (
                                  <option key={`${fn.filePath || ""}_${fName}_${idx}`} value={fName}>
                                    ƒ {fName} (lines {fn.startLine || 1}-{fn.endLine || "?"})
                                    {isUncovered ? " ⚠️ [Uncovered]" : ""}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={selectedFunc}
                            onChange={(e) => setSelectedFunc(e.target.value)}
                            placeholder="Enter function name from source file"
                            className={`w-full text-xs rounded-xl px-3.5 py-2.5 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                              isLight
                                ? "bg-white border border-slate-300 text-slate-900 shadow-sm"
                                : "bg-slate-900 border border-slate-700 text-slate-100"
                            }`}
                          />
                        )}
                      </div>
                    </div>

                    {/* 4 Category Matrix Buttons */}
                    <div
                      className="p-4 rounded-2xl flex-1 flex flex-col justify-between transition-colors"
                      style={{
                        background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                        border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      <label
                        className={`text-xs font-bold mb-2.5 block ${
                          isLight ? "text-slate-800" : "text-slate-300"
                        }`}
                      >
                        Select Test Scenario (4-Category Matrix):
                      </label>
                      <div className="flex flex-col gap-2">
                        {TEST_CATEGORIES.map((cat) => {
                          const isCatActive = activeCategory === cat.id;
                          return (
                            <div
                              key={cat.id}
                              onClick={() => handleApplyPreset(cat.id)}
                              role="button"
                              tabIndex={0}
                              className="rounded-xl p-3 cursor-pointer transition-all border text-left"
                              style={{
                                background: isCatActive
                                  ? isLight
                                    ? cat.bgColorLight
                                    : cat.bgColorDark
                                  : isLight
                                    ? "#ffffff"
                                    : "rgba(255, 255, 255, 0.02)",
                                borderColor: isCatActive
                                  ? isLight
                                    ? cat.borderColorLight
                                    : cat.borderColorDark
                                  : isLight
                                    ? "#e2e8f0"
                                    : "rgba(255, 255, 255, 0.06)",
                                boxShadow: isCatActive
                                  ? isLight
                                    ? `0 2px 8px ${cat.badgeColor}20`
                                    : `0 0 12px ${cat.badgeColor}25`
                                  : "none",
                              }}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span
                                  className="text-xs font-bold"
                                  style={{
                                    color: isLight ? cat.textColorLight : cat.badgeColor,
                                  }}
                                >
                                  {cat.category}: {cat.title}
                                </span>
                                {isCatActive && (
                                  <Check
                                    size={14}
                                    style={{
                                      color: isLight ? cat.textColorLight : cat.badgeColor,
                                    }}
                                  />
                                )}
                              </div>
                              <p
                                className={`text-[11px] leading-snug ${
                                  isLight ? "text-slate-700" : "text-slate-400"
                                }`}
                              >
                                {cat.description}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Code Editor with Live Syntax Checker */}
                  <div className="md:col-span-7 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Code
                          size={15}
                          className={isLight ? "text-indigo-600" : "text-slate-400"}
                        />
                        <span
                          className={`text-xs font-bold ${
                            isLight ? "text-slate-800" : "text-slate-200"
                          }`}
                        >
                          Unit Test Code (Educational Annotations)
                        </span>
                      </div>

                      {/* Live Syntax Badge */}
                      {syntaxStatus.valid ? (
                        <span
                          className={`text-[11px] font-semibold flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
                            isLight
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          <CheckCircle2 size={13} /> Valid Syntax
                        </span>
                      ) : (
                        <span
                          className={`text-[11px] font-semibold flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
                            isLight
                              ? "bg-rose-100 text-rose-800 border border-rose-300"
                              : "bg-red-500/10 text-red-400 border border-red-500/30"
                          }`}
                        >
                          <AlertCircle size={13} /> Syntax Error
                        </span>
                      )}
                    </div>

                    {/* Monaco Editor Container */}
                    <div
                      className={`rounded-2xl overflow-hidden shadow-inner ${
                        isLight ? "border border-slate-300" : "border border-slate-700/80"
                      }`}
                      style={{
                        height: "480px",
                        background: isLight ? "#ffffff" : "#1e1e1e",
                      }}
                    >
                      <Editor
                        height="100%"
                        language="javascript"
                        theme={isLight ? "vs" : "vs-dark"}
                        value={codeContent}
                        onChange={handleEditorChange}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 12.5,
                          lineNumbers: "on",
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                          wordWrap: "on",
                          tabSize: 2,
                        }}
                      />
                    </div>

                    {/* Syntax Error Message Hint if invalid */}
                    {!syntaxStatus.valid && (
                      <div
                        className={`p-3 rounded-xl text-xs flex items-start gap-2.5 ${
                          isLight
                            ? "bg-rose-50 border border-rose-300 text-rose-800"
                            : "bg-red-500/15 border border-red-500/40 text-red-300"
                        }`}
                      >
                        <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                        <span>{syntaxStatus.error}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Modal Footer Controls ── */}
          <div
            className="flex items-center justify-between px-6 py-4 flex-shrink-0"
            style={{
              background: isLight ? "#f8fafc" : "#131b2e",
              borderTop: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {step === "MANUAL_STUDIO" ? (
              <button
                onClick={() => setStep("SELECTION")}
                disabled={isApplying}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors ${
                  isLight
                    ? "bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-900 shadow-sm"
                    : "border border-slate-700 hover:bg-slate-800 text-slate-300"
                }`}
              >
                <ArrowLeft size={15} />
                <span>Back to Mode Selection</span>
              </button>
            ) : (
              <button
                onClick={onClose}
                disabled={isApplying}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                  isLight
                    ? "bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-900 shadow-sm"
                    : "border border-slate-700 hover:bg-slate-800 text-slate-300"
                }`}
              >
                Cancel
              </button>
            )}

            <div className="flex items-center gap-3">
              {step === "MANUAL_STUDIO" ? (
                <button
                  onClick={handleApplyManual}
                  disabled={isApplying || !syntaxStatus.valid}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg transition-all"
                  style={{
                    background: isApplying || !syntaxStatus.valid ? "#94a3b8" : "#10b981",
                    color: "#ffffff",
                    cursor: isApplying || !syntaxStatus.valid ? "not-allowed" : "pointer",
                    boxShadow:
                      isApplying || !syntaxStatus.valid
                        ? "none"
                        : "0 4px 14px rgba(16, 185, 129, 0.35)",
                  }}
                >
                  {isApplying ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>Saving and executing tests...</span>
                    </>
                  ) : (
                    <>
                      <Play size={15} fill="currentColor" />
                      <span>Save & Apply Tests (Run Now)</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleConfirm}
                  disabled={isApplying}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 shadow-lg transition-all"
                  style={{
                    background:
                      chosenMode === "AI"
                        ? "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
                        : "#10b981",
                    color: "#ffffff",
                    cursor: "pointer",
                    boxShadow:
                      chosenMode === "AI"
                        ? "0 4px 16px rgba(99, 102, 241, 0.4)"
                        : "0 4px 16px rgba(16, 185, 129, 0.35)",
                  }}
                >
                  {chosenMode === "AI" ? (
                    <>
                      <BrainCircuit size={15} />
                      <span>Generate Unit Tests with AI ({chosenFramework.toUpperCase()})</span>
                    </>
                  ) : (
                    <>
                      <PenTool size={15} />
                      <span>Continue to Guided Studio</span>
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
