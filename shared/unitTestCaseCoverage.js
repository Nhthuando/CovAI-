import { summarizeIntegrationFailure } from "./integrationCaseCoverage.js";

export const UNIT_CASE_DEFINITIONS = {
  HAPPY: {
    key: "HAPPY",
    category: "HAPPY_PATH",
    code: "A",
    label: "Happy Path",
    description: "Valid standard inputs produce expected return value or state.",
  },
  BOUNDARY: {
    key: "BOUNDARY",
    category: "BOUNDARY_EDGE",
    code: "B",
    label: "Boundary / Edge",
    description: "Empty, null, undefined, zero, min/max limits or degenerate inputs.",
  },
  BRANCH: {
    key: "BRANCH",
    category: "BRANCH_COVERAGE",
    code: "C",
    label: "Branch Paths",
    description: "Alternate conditional paths (if/else, switch, ternary, guard clauses).",
  },
  ERROR: {
    key: "ERROR",
    category: "ERROR_HANDLING",
    code: "D",
    label: "Error Handling",
    description: "Thrown errors, rejected promises, and invalid/failing dependency states.",
  },
};

export const UNIT_CATEGORY_TO_KEY = {
  HAPPY_PATH: "HAPPY",
  HAPPY: "HAPPY",
  BOUNDARY_EDGE: "BOUNDARY",
  BOUNDARY: "BOUNDARY",
  EDGE: "BOUNDARY",
  BRANCH_COVERAGE: "BRANCH",
  BRANCH: "BRANCH",
  CONDITION: "BRANCH",
  ERROR_HANDLING: "ERROR",
  ERROR: "ERROR",
};

const TRIVIAL_CALLBACK_NAMES = new Set([
  "anonymous",
  "(anonymous)",
  "function",
  "arrow",
  "then",
  "catch",
  "finally",
  "map",
  "filter",
  "find",
  "findindex",
  "foreach",
  "reduce",
  "reduceright",
  "some",
  "every",
  "sort",
  "flatmap",
  "settimeout",
  "setinterval",
  "setimmediate",
  "requestanimationframe",
  "promise",
  "next",
  "cb",
  "callback",
  "done",
  "resolve",
  "reject",
]);

export function isTrivialCallbackFunctionName(rawName = "") {
  const clean = String(rawName || "")
    .trim()
    .replace(/\(\)$/, "")
    .trim()
    .toLowerCase();
  if (!clean) return true;
  if (TRIVIAL_CALLBACK_NAMES.has(clean)) return true;
  if (/^anonymous_\d+$/i.test(clean) || /^fn_\d+$/i.test(clean)) return true;
  return false;
}

export function isUnitTestPassed(tc) {
  const status = String(tc?.status || "").toUpperCase();
  return status === "PASS" || status === "PASSED";
}

export function isUnitTestFailed(tc) {
  const status = String(tc?.status || "").toUpperCase();
  return status === "FAIL" || status === "FAILED";
}

/**
 * Extracts and normalizes testable business logic functions for a unit source file.
 * Prioritizes named business functions while retaining full Istanbul function telemetry.
 */
export function getTestableUnitFunctions(file = {}, fileFunctions = []) {
  const rawList = Array.isArray(fileFunctions) ? fileFunctions : [];
  const normalized = [];
  const seenKeys = new Set();

  for (let i = 0; i < rawList.length; i++) {
    const fn = rawList[i];
    if (!fn || typeof fn !== "object") continue;
    const rawName = String(fn.functionName || fn.realName || fn.name || "")
      .trim()
      .replace(/\(\)$/, "")
      .trim();
    if (!rawName) continue;
    const startLine = Number(fn.startLine ?? fn.line ?? 0) || i + 1;
    const hit = Number(fn.hit ?? fn.hits ?? (fn.covered ? 1 : 0)) || 0;
    const cyclomatic = Number(fn.cyclomatic ?? fn.complexity ?? 1) || 1;
    const isCallback = isTrivialCallbackFunctionName(rawName);
    const dedupKey = `${rawName.toLowerCase()}::${startLine}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    normalized.push({
      key: `FN:${rawName}:${startLine}`,
      name: rawName,
      startLine,
      hit,
      cyclomatic,
      isCallback,
      coveredByExecution: hit > 0 || Number(file?.funcsPct ?? 0) >= 100,
    });
  }

  const namedBusinessFns = normalized.filter((f) => !f.isCallback);
  return namedBusinessFns.length > 0 ? namedBusinessFns : normalized;
}

/**
 * Matches a unit test case to a specific business logic function in the file if referenced
 * in `[functionName]` title tags, title words, or test code body.
 */
export function matchUnitTestToFunction(tc = {}, testableFunctions = []) {
  if (!tc || !Array.isArray(testableFunctions) || testableFunctions.length === 0) {
    return null;
  }

  if (tc.targetFunction) {
    const explicit = testableFunctions.find(
      (f) => f.name.toLowerCase() === String(tc.targetFunction).trim().toLowerCase(),
    );
    if (explicit) return explicit;
  }

  const rawTitle = String(tc.title || tc.testName || tc.name || "").trim();
  const rawCode = String(tc.code || "");

  // 1. Check leading bracketed function tag `[fnName]` or leading `fnName`
  const bracketMatches = [...rawTitle.matchAll(/\[\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\]/g)];
  for (const m of bracketMatches) {
    const token = String(m[1] || "").split(".").pop().toLowerCase();
    const found = testableFunctions.find((f) => f.name.toLowerCase() === token);
    if (found) return found;
  }

  // Sort functions by descending name length so `getArticleStats` matches before `getArticle`
  const sortedFns = [...testableFunctions].sort((a, b) => b.name.length - a.name.length);

  // 2. Check whole-word match in title
  for (const fn of sortedFns) {
    if (fn.name.length < 2) continue;
    const escaped = fn.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(rawTitle)) {
      return fn;
    }
  }

  // 3. Check function invocation in test code body
  if (rawCode) {
    for (const fn of sortedFns) {
      if (fn.name.length < 2) continue;
      const escaped = fn.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\s*\\(`, "i").test(rawCode)) {
        return fn;
      }
    }
  }

  return null;
}

/**
 * Classifies a unit test case into one of the 4 standard CovAI unit test categories.
 * Strips any leading `[functionName]` tag first so function names never skew classification.
 */
export function classifyUnitTestCase(tc = {}) {
  const explicitKey =
    UNIT_CATEGORY_TO_KEY[String(tc.caseKey || tc.category || "").toUpperCase()];
  if (explicitKey && UNIT_CASE_DEFINITIONS[explicitKey]) {
    return UNIT_CASE_DEFINITIONS[explicitKey];
  }

  const rawTitle = String(tc.title || tc.testName || tc.name || "").trim();
  const titleWithoutFnPrefix = rawTitle.replace(
    /^\[\s*(?!(?:happy|boundary|edge|branch|error|category\s+[a-d]|tc[-_]))[A-Za-z_$][A-Za-z0-9_$.]*\s*\]\s*/i,
    "",
  );

  // 1. Check explicit bracketed tag, category label, or leading TC-* prefix in title
  for (const candidateTitle of [titleWithoutFnPrefix, rawTitle]) {
    if (
      /^(?:\[\s*happy(?:\s*path)?\s*\]|happy\s*path\s*[:\-]|category\s*a\b|tc[-_\s]*happy\b)/i.test(
        candidateTitle,
      ) ||
      /\[\s*(?:category\s*a\s*:\s*)?happy(?:\s*path)?\s*\]/i.test(candidateTitle)
    ) {
      return UNIT_CASE_DEFINITIONS.HAPPY;
    }
    if (
      /^(?:\[\s*boundary(?:\s*\/\s*edge|\s*values?)?\s*\]|boundary(?:\s*\/\s*edge|\s*values?)?\s*[:\-]|category\s*b\b|tc[-_\s]*(?:bound(?:ary)?|edge)\b)/i.test(
        candidateTitle,
      ) ||
      /\[\s*(?:category\s*b\s*:\s*)?boundary/i.test(candidateTitle)
    ) {
      return UNIT_CASE_DEFINITIONS.BOUNDARY;
    }
    if (
      /^(?:\[\s*branch(?:\s*paths?|\s*toggling|\s*coverage)?\s*\]|branch(?:\s*paths?|\s*toggling)?\s*[:\-]|category\s*c\b|tc[-_\s]*branch\b)/i.test(
        candidateTitle,
      ) ||
      /\[\s*(?:category\s*c\s*:\s*)?branch/i.test(candidateTitle)
    ) {
      return UNIT_CASE_DEFINITIONS.BRANCH;
    }
    if (
      /^(?:\[\s*error(?:\s*handling|\s*&\s*exception)?\s*\]|error(?:\s*handling)?\s*[:\-]|category\s*d\b|tc[-_\s]*err(?:or)?\b)/i.test(
        candidateTitle,
      ) ||
      /\[\s*(?:category\s*d\s*:\s*)?error/i.test(candidateTitle)
    ) {
      return UNIT_CASE_DEFINITIONS.ERROR;
    }
  }

  // 2. Classify by title text first (before ancestorTitles so suite names don't hijack every test)
  const matchKeywords = (str) => {
    const s = String(str || "").toLowerCase();
    if (!s) return null;
    if (
      /\b(error|errors|throw|throws|exception|reject|rejects|catch|fail|fails|failed|failure|invalid|malformed|unauthorized|forbidden|timeout|abort|crash)\b/.test(
        s,
      ) ||
      /\b(400|401|403|404|409|422|500)\b/.test(s)
    ) {
      return UNIT_CASE_DEFINITIONS.ERROR;
    }
    if (
      /\b(boundary|edge|null|undefined|empty|zero|negative|min|max|limit|overflow|nan|blank|missing|whitespace|single|truncated|large|falsy)\b/.test(
        s,
      )
    ) {
      return UNIT_CASE_DEFINITIONS.BOUNDARY;
    }
    if (
      /\b(branch|when|if|else|switch|case|fallback|skip|ignore|toggle|already|duplicate|false|true|without|default|existing)\b/.test(
        s,
      )
    ) {
      return UNIT_CASE_DEFINITIONS.BRANCH;
    }
    if (/\b(happy|valid|success|standard|normal|correctly)\b/.test(s)) {
      return UNIT_CASE_DEFINITIONS.HAPPY;
    }
    return null;
  };

  const titleMatch = matchKeywords(titleWithoutFnPrefix);
  if (titleMatch) return titleMatch;

  const fullText = [
    titleWithoutFnPrefix,
    tc.description || "",
    ...(Array.isArray(tc.ancestorTitles) ? tc.ancestorTitles : []),
  ].join(" ");

  return matchKeywords(fullText) || UNIT_CASE_DEFINITIONS.HAPPY;
}

/**
 * Computes required unit test coverage cases for a source file based on its Unit metrics
 * (functions count, branch count, complexity) while preserving Unit business rules.
 */
export function getRequiredUnitCasesForFile(file = {}, fileFunctions = []) {
  const funcsTotal = Number(
    file.funcsTotal ?? file.functionsTotal ?? fileFunctions.length ?? 0,
  );
  const branchesTotal = Number(file.branchesTotal ?? 0);
  const linesTotal = Number(file.linesTotal ?? 0);
  const maxComplexity = fileFunctions.reduce(
    (max, fn) => Math.max(max, Number(fn.cyclomatic ?? fn.complexity ?? 1)),
    1,
  );

  const required = [];
  if (funcsTotal > 0 || linesTotal > 0) {
    required.push(UNIT_CASE_DEFINITIONS.HAPPY);
    required.push(UNIT_CASE_DEFINITIONS.BOUNDARY);
  }
  if (branchesTotal > 0 || maxComplexity > 1) {
    required.push(UNIT_CASE_DEFINITIONS.BRANCH);
  }
  if (branchesTotal >= 2 || maxComplexity >= 2 || funcsTotal >= 2) {
    required.push(UNIT_CASE_DEFINITIONS.ERROR);
  }

  if (required.length === 0) {
    required.push(UNIT_CASE_DEFINITIONS.HAPPY);
  }
  return required;
}

function unitTestIdentity(tc, index) {
  return String(
    tc?.id ||
      `${tc?.testFile || tc?.filePath || "test"}::${tc?.title || tc?.testName || index}`,
  );
}

export function isUserOrExistingUnitTest(tc = {}) {
  const origin = String(tc?.origin || "").toUpperCase();
  if (
    origin === "AI_DRAFT" ||
    origin === "AI_SUGGESTED" ||
    origin === "AI" ||
    origin === "AI_GENERATED" ||
    tc?.isAiGenerated === true
  ) {
    return false;
  }
  return true;
}

/**
 * Computes per-function coverage and test mapping for a business logic source file.
 */
export function getFileUnitFunctionCoverage(
  file = {},
  fileFunctions = [],
  testCases = [],
) {
  const testableFunctions = getTestableUnitFunctions(file, fileFunctions);
  const allFunctions = Array.isArray(fileFunctions) ? fileFunctions : [];
  const fileFuncsPct = Number(file?.funcsPct ?? file?.functionsPct ?? 0);
  const fileLinesPct = Number(file?.linesPct ?? 0);

  const functions = testableFunctions.map((fn) => {
    const matchedTests = (testCases || []).filter(
      (tc) => matchUnitTestToFunction(tc, [fn])?.key === fn.key,
    );
    const hasPassedTest = matchedTests.some(isUnitTestPassed);
    const hasFailedTest = matchedTests.some(isUnitTestFailed);
    const hasDraftTest = matchedTests.length > 0;
    const covered =
      fn.hit > 0 ||
      fileFuncsPct >= 100 ||
      (fileLinesPct >= 100 && !hasFailedTest) ||
      (hasPassedTest && fileLinesPct > 0);
    return {
      ...fn,
      covered,
      passed: covered && !hasFailedTest,
      failed: hasFailedTest,
      hasDraftTest,
      testCount: matchedTests.length,
    };
  });

  const totalFunctions =
    functions.length > 0
      ? functions.length
      : Number(file?.funcsTotal ?? file?.functionsTotal ?? allFunctions.length ?? 0);
  const coveredFunctions =
    functions.length > 0
      ? functions.filter((f) => f.covered).length
      : Number(
          file?.funcsCovered ??
            file?.functionsCovered ??
            allFunctions.filter((f) => Number(f?.hit ?? f?.hits ?? 0) > 0).length ??
            0,
        );

  return {
    functions,
    totalFunctions,
    coveredFunctions: Math.min(totalFunctions, coveredFunctions),
    uncoveredFunctions: functions.filter((f) => !f.covered),
    isAllFunctionsCovered: totalFunctions > 0 ? coveredFunctions >= totalFunctions : fileLinesPct >= 100,
  };
}

/**
 * Annotates unit test cases with their target business logic function and category,
 * enforcing user-vs-AI precedence per (function, category) slot.
 */
export function annotateFileUnitTests(file = {}, fileFunctions = [], testCases = []) {
  const requiredCases = getRequiredUnitCasesForFile(file, fileFunctions);
  const requiredByKey = new Map(requiredCases.map((c) => [c.key, c]));
  const testableFunctions = getTestableUnitFunctions(file, fileFunctions);
  const useFunctionSlots = testableFunctions.length > 1;

  const orderedEntries = (testCases || []).map((tc, index) => {
    const def = classifyUnitTestCase(tc);
    const matchedFn = matchUnitTestToFunction(tc, testableFunctions);
    const passed = isUnitTestPassed(tc);
    const failed = isUnitTestFailed(tc);
    const isProjectExisting = isUserOrExistingUnitTest(tc);
    let score;
    if (isProjectExisting && !failed) {
      score = passed ? 220 : 200;
    } else if (!isProjectExisting && !failed) {
      score = passed ? 170 : 150;
    } else if (isProjectExisting && failed) {
      score = 40;
    } else {
      score = 20;
    }
    const slotKey =
      matchedFn && (useFunctionSlots || /^\[\s*[A-Za-z_$]/.test(String(tc.title || "").trim()))
        ? `FN::${matchedFn.name.toLowerCase()}::${def.key}`
        : def.key;
    return {
      tc,
      index,
      id: unitTestIdentity(tc, index),
      key: def.key,
      slotKey,
      matchedFn,
      def,
      passed,
      failed,
      isProjectExisting,
      score,
    };
  });

  const bestForSlot = new Map();
  for (const entry of orderedEntries) {
    const isFnSlot = entry.slotKey.startsWith("FN::");
    if (!isFnSlot && !requiredByKey.has(entry.key)) continue;
    const prev = bestForSlot.get(entry.slotKey);
    if (!prev || entry.score > prev.score) {
      bestForSlot.set(entry.slotKey, entry);
    }
  }

  const primaryBySlot = new Map();
  for (const [slotKey, entry] of bestForSlot.entries()) {
    primaryBySlot.set(slotKey, entry.id);
  }

  const annotations = {};
  let redundantCount = 0;
  let extraCount = 0;

  for (const entry of orderedEntries) {
    const isFnSlot = entry.slotKey.startsWith("FN::");
    const reqDef = requiredByKey.get(entry.key) || entry.def;
    const fnPrefix = entry.matchedFn ? `Fn: ${entry.matchedFn.name}()` : null;

    if (!isFnSlot && !requiredByKey.has(entry.key)) {
      extraCount++;
      annotations[entry.id] = {
        badgeType: "OPTIONAL",
        badgeLabel: fnPrefix ? `${fnPrefix} · ${entry.def.label}` : `Optional · ${entry.def.label}`,
        caseKey: entry.key,
        caseLabel: entry.def.label,
        targetFunction: entry.matchedFn?.name || null,
        functionLabel: entry.matchedFn ? `${entry.matchedFn.name}()` : null,
        isRemovableSuggestion: false,
      };
      continue;
    }

    const winner = bestForSlot.get(entry.slotKey);
    const isPrimary = primaryBySlot.get(entry.slotKey) === entry.id;
    const displayTarget = fnPrefix
      ? `${fnPrefix} · ${reqDef.label}`
      : `Case: ${reqDef.label}`;

    if (isPrimary) {
      const passed = entry.passed;
      const failed = entry.failed;
      annotations[entry.id] = {
        badgeType: passed
          ? "PRIMARY_PASS"
          : failed
            ? "PRIMARY_FAIL"
            : "PRIMARY_PENDING",
        badgeLabel: displayTarget,
        caseKey: reqDef.key,
        caseLabel: reqDef.label,
        targetFunction: entry.matchedFn?.name || null,
        functionLabel: entry.matchedFn ? `${entry.matchedFn.name}()` : null,
        isRemovableSuggestion: false,
      };
    } else if (
      entry.isProjectExisting &&
      entry.failed &&
      winner &&
      !winner.isProjectExisting &&
      !winner.failed
    ) {
      annotations[entry.id] = {
        badgeType: "PRIMARY_FAIL",
        badgeLabel: fnPrefix
          ? `Failed · ${entry.matchedFn.name}() · ${reqDef.label}`
          : `Failed · ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: reqDef.label,
        targetFunction: entry.matchedFn?.name || null,
        functionLabel: entry.matchedFn ? `${entry.matchedFn.name}()` : null,
        isRemovableSuggestion: true,
        supersededByAi: true,
      };
    } else {
      redundantCount++;
      annotations[entry.id] = {
        badgeType: "DUPLICATE",
        badgeLabel: fnPrefix
          ? `Duplicate · ${entry.matchedFn.name}() · ${reqDef.label}`
          : `Duplicate · ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: reqDef.label,
        targetFunction: entry.matchedFn?.name || null,
        functionLabel: entry.matchedFn ? `${entry.matchedFn.name}()` : null,
        isRemovableSuggestion: true,
      };
    }
  }

  return { annotations, redundantCount, extraCount };
}

/**
 * Full Unit Test coverage computation for a source file (both function-level and category-level).
 */
export function getFileUnitCaseCoverage(
  file = {},
  fileFunctions = [],
  testCases = [],
) {
  const requiredCases = getRequiredUnitCasesForFile(file, fileFunctions);
  const coveredKeys = new Set();
  const passedKeys = new Set();
  const failedKeys = new Set();
  let passedCount = 0;
  let failedCount = 0;

  for (const tc of testCases || []) {
    const def = classifyUnitTestCase(tc);
    coveredKeys.add(def.key);
    if (isUnitTestPassed(tc)) {
      passedCount++;
      passedKeys.add(def.key);
    } else if (isUnitTestFailed(tc)) {
      failedCount++;
      failedKeys.add(def.key);
    }
  }

  const cases = requiredCases.map((c) => ({
    ...c,
    covered: coveredKeys.has(c.key),
    passed: passedKeys.has(c.key),
    failed: failedKeys.has(c.key) && !passedKeys.has(c.key),
  }));

  const coveredCount = cases.filter((c) => c.covered).length;
  const passedCasesCount = cases.filter((c) => c.passed).length;
  const { annotations: scenarioAnnotations, redundantCount, extraCount } =
    annotateFileUnitTests(file, fileFunctions, testCases);
  const functionCoverage = getFileUnitFunctionCoverage(file, fileFunctions, testCases);

  return {
    cases,
    coveredCount,
    passedCasesCount,
    totalRequired: cases.length,
    missingCases: cases.filter((c) => !c.covered),
    passedCount,
    failedCount,
    notRunCount: Math.max(0, (testCases || []).length - passedCount - failedCount),
    isComplete: cases.length > 0 && coveredCount === cases.length,
    isFullyVerified:
      cases.length > 0 &&
      passedCasesCount === cases.length &&
      failedCount === 0,
    scenarioAnnotations,
    redundantCount,
    extraCount,
    functionCoverage,
  };
}

/**
 * Strips ANSI escape sequences and distills Jest / Vitest failure logs into
 * concise human-readable summaries for Unit Tests.
 */
export function summarizeUnitFailure(rawInput, parsedFailure = null) {
  return summarizeIntegrationFailure(rawInput, parsedFailure);
}
