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
  "addeventlistener",
  "removeeventlistener",
  "addlistener",
  "removelistener",
  "dispatchevent",
  "clearinterval",
  "cleartimeout",
  "requestidlecallback",
  "pushstate",
  "replacestate",
]);

export function isTrivialCallbackFunctionName(rawName = "") {
  const clean = String(rawName || "")
    .trim()
    .replace(/\(\)$/, "")
    .replace(/^\((.*)\)$/, "$1")
    .trim()
    .toLowerCase();
  if (!clean) return true;
  if (TRIVIAL_CALLBACK_NAMES.has(clean)) return true;
  if (/^anonymous_\d+$/i.test(clean) || /^fn_\d+$/i.test(clean) || /^<anonymous@[^>]+>$/i.test(clean)) return true;
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

export const UNIT_TECHNIQUE_DEFINITIONS = {
  HAPPY: {
    key: "HAPPY",
    label: "Happy Path",
    shortLabel: "Happy Path",
    description: "Standard valid inputs exercising core expected behavior.",
  },
  EQUIVALENCE: {
    key: "EQUIVALENCE",
    label: "Equivalence Partition",
    shortLabel: "Equivalence",
    description: "Representative valid and invalid input classes/formats.",
  },
  BOUNDARY: {
    key: "BOUNDARY",
    label: "Boundary Value",
    shortLabel: "Boundary",
    description: "Min/max limits, zero, negative, empty, null, or blank edges.",
  },
  BRANCH: {
    key: "BRANCH",
    label: "Decision / Branch",
    shortLabel: "Decision / Branch",
    description: "Conditional combinations, fallbacks, and alternate paths.",
  },
  ERROR: {
    key: "ERROR",
    label: "Error Guessing",
    shortLabel: "Error Guessing",
    description: "Rejected dependencies, thrown exceptions, and fault states.",
  },
};

const RESERVED_BRACKET_CATEGORY_RE =
  /^(?:happy(?:\s*path)?|boundary(?:\s*\/\s*edge|\s*values?)?|edge(?:\s*cases?)?|equivalence(?:\s*partition(?:ing)?)?|decision(?:\s*table)?|branch(?:\s*paths?|\s*toggling|\s*coverage)?|error(?:\s*handling|\s*guessing|\s*&\s*exception)?|category\s*[a-e]|tc[-_\s])/i;

/**
 * Extracts an explicit leading `[functionName]` tag from a unit test title when present
 * (ignoring category tags such as `[Happy Path]`, `[Boundary / Edge]`, etc.).
 */
export function extractLeadingFunctionTag(rawTitle = "") {
  const match = String(rawTitle || "")
    .trim()
    .match(/^\[\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\]/);
  if (!match || !match[1]) return null;
  const candidate = match[1].trim();
  if (RESERVED_BRACKET_CATEGORY_RE.test(candidate)) return null;
  const methodName = candidate.split(".").pop().trim();
  if (!methodName || isTrivialCallbackFunctionName(methodName)) return null;
  if (methodName === "defaultExport" || methodName === "default") return null;
  return methodName;
}

/**
 * Classifies the specific Test Design Technique used by a unit test scenario
 * (Happy Path, Equivalence Partition, Boundary Value, Decision / Branch, Error Guessing).
 */
export function classifyUnitTestTechnique(tc = {}) {
  const explicitTech = String(tc.technique || tc.techniqueKey || "").trim().toUpperCase();
  if (explicitTech && UNIT_TECHNIQUE_DEFINITIONS[explicitTech]) {
    return UNIT_TECHNIQUE_DEFINITIONS[explicitTech];
  }

  const rawTitle = String(tc.title || tc.testName || tc.name || "").trim();
  const cleanTitle = rawTitle.replace(
    /^\[\s*(?!(?:happy|boundary|edge|equivalence|decision|branch|error|category\s+[a-e]|tc[-_]))[A-Za-z_$][A-Za-z0-9_$.]*\s*\]\s*/i,
    "",
  );
  const lower = cleanTitle.toLowerCase();

  if (
    /\b(equivalence|partition|unsupported|unrecognized|unknown\s+type|invalid\s+(?:type|format|plan|card|mode|role|currency|enum|status|event_type)|valid\s+(?:plan|card|mode|role|currency|format)|preset|tier|class)\b/.test(
      lower,
    ) ||
    (/\b400\b/.test(lower) && /\b(validation|schema|invalid|unsupported|format)\b/.test(lower))
  ) {
    return UNIT_TECHNIQUE_DEFINITIONS.EQUIVALENCE;
  }

  if (
    /\b(boundary|edge|null|undefined|empty|zero|negative|min|max|limit|overflow|nan|blank|whitespace|single|truncated|large|exceed|cap|caps|threshold)\b/.test(
      lower,
    )
  ) {
    return UNIT_TECHNIQUE_DEFINITIONS.BOUNDARY;
  }

  if (
    /\b(decision|branch|fallback|when\s+.*\s+(?:is|are)\s+(?:missing|absent|omitted|present|provided)|toggle|alternate|already|existing|else|switch|without)\b/.test(
      lower,
    )
  ) {
    return UNIT_TECHNIQUE_DEFINITIONS.BRANCH;
  }

  if (
    /\b(error|errors|throw|throws|exception|reject|rejects|catch|fail|fails|failed|failure|timeout|abort|crash|corrupt|500)\b/.test(
      lower,
    )
  ) {
    return UNIT_TECHNIQUE_DEFINITIONS.ERROR;
  }

  const baseCase = classifyUnitTestCase(tc);
  return UNIT_TECHNIQUE_DEFINITIONS[baseCase.key] || UNIT_TECHNIQUE_DEFINITIONS.HAPPY;
}

/**
 * Extracts and normalizes testable business logic functions for a unit source file.
 * Prioritizes named business functions while retaining full Istanbul function telemetry,
 * and falls back to explicit `[fnName]` tags in mapped test cases when Istanbul telemetry is not yet available.
 */
export function getTestableUnitFunctions(file = {}, fileFunctions = [], testCases = []) {
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
  if (namedBusinessFns.length > 0) return namedBusinessFns;
  if (normalized.length > 0) return normalized;

  // Fallback when Istanbul function telemetry hasn't run yet: infer target functions from `[fnName]` scenario prefixes
  if (Array.isArray(testCases) && testCases.length > 0) {
    const inferredByLower = new Map();
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const tagFn = extractLeadingFunctionTag(tc?.title || tc?.testName || tc?.name || "");
      if (!tagFn) continue;
      const lower = tagFn.toLowerCase();
      const passed = isUnitTestPassed(tc);
      const existing = inferredByLower.get(lower);
      if (existing) {
        if (passed) {
          existing.hit += 1;
          existing.coveredByExecution = true;
        }
        continue;
      }
      inferredByLower.set(lower, {
        key: `FN:${tagFn}:${inferredByLower.size + 1}`,
        name: tagFn,
        startLine: null,
        hit: passed ? 1 : 0,
        cyclomatic: 1,
        isCallback: false,
        inferredFromTests: true,
        coveredByExecution: passed,
      });
    }
    if (inferredByLower.size > 0) return [...inferredByLower.values()];
  }

  return normalized;
}

/**
 * Matches a unit test case to ALL business logic functions in the file that it
 * targets or exercises via `[fnName]` tags, `@covers fn1, fn2`, title words,
 * code calls, and optional intra-file caller->callee relationships.
 */
export function matchUnitTestToFunctions(
  tc = {},
  testableFunctions = [],
  functionCallees = null,
) {
  if (!tc || !Array.isArray(testableFunctions) || testableFunctions.length === 0) {
    return [];
  }

  const byLowerName = new Map();
  for (const fn of testableFunctions) {
    const key = String(fn?.name || "").trim().toLowerCase();
    if (key && !byLowerName.has(key)) byLowerName.set(key, fn);
  }

  const matched = [];
  const addedKeys = new Set();
  const addMatch = (fn) => {
    if (!fn || addedKeys.has(fn.key)) return;
    addedKeys.add(fn.key);
    matched.push(fn);
  };

  const addToken = (rawToken) => {
    const token = String(rawToken || "")
      .trim()
      .replace(/\(\)$/, "")
      .split(".")
      .pop()
      .trim()
      .toLowerCase();
    if (!token) return;
    const hit = byLowerName.get(token);
    if (hit) addMatch(hit);
  };

  if (Array.isArray(tc.targetFunctions)) {
    for (const tf of tc.targetFunctions) addToken(tf);
  }
  if (tc.targetFunction) {
    for (const part of String(tc.targetFunction).split(",")) addToken(part);
  }

  const rawTitle = String(tc.title || tc.testName || tc.name || "").trim();
  const rawCode = String(tc.code || "");

  // 1. Check bracketed tags `[fnName]` or `[fn1, fn2]` in title
  const bracketMatches = [...rawTitle.matchAll(/\[\s*([^\]]+)\s*\]/g)];
  for (const m of bracketMatches) {
    for (const part of String(m[1] || "").split(/[,+/|&]/)) {
      addToken(part);
    }
  }

  // 2. Check `@covers fn1, fn2` annotations in title or test body comments
  const coversSource = `${rawTitle}\n${rawCode}`;
  for (const m of coversSource.matchAll(/@covers\s*[:\-]?\s*([^\n\r*]+)/gi)) {
    for (const part of String(m[1] || "").split(/[,+/|&\s]+/)) {
      addToken(part);
    }
  }

  // Sort functions by descending name length so `getArticleStats` matches before `getArticle`
  const sortedFns = [...testableFunctions].sort((a, b) => b.name.length - a.name.length);

  // 3. Check whole-word matches in title
  for (const fn of sortedFns) {
    if (fn.name.length < 2) continue;
    const escaped = fn.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(rawTitle)) {
      addMatch(fn);
    }
  }

  // 4. Check function invocations in test code body
  if (rawCode) {
    for (const fn of sortedFns) {
      if (fn.name.length < 2) continue;
      const escaped = fn.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\s*\\(`, "i").test(rawCode)) {
        addMatch(fn);
      }
    }
  }

  // 5. Expand transitive intra-file helper callees (e.g. exportedFn -> internal helperFn)
  if (matched.length > 0 && functionCallees && typeof functionCallees === "object") {
    const queue = matched.map((f) => f.name);
    const visited = new Set(queue.map((n) => n.toLowerCase()));
    while (queue.length > 0) {
      const caller = queue.shift();
      const callees =
        functionCallees[caller] ||
        functionCallees[caller.toLowerCase()] ||
        [];
      if (!Array.isArray(callees)) continue;
      for (const calleeName of callees) {
        const lower = String(calleeName || "").trim().toLowerCase();
        if (!lower || visited.has(lower)) continue;
        visited.add(lower);
        const fnObj = byLowerName.get(lower);
        if (fnObj) {
          addMatch(fnObj);
          queue.push(fnObj.name);
        }
      }
    }
  }

  // 6. Single-function file fallback: tests mapped to a 1-function file target that function
  if (matched.length === 0 && testableFunctions.length === 1) {
    addMatch(testableFunctions[0]);
  }

  return matched;
}

/**
 * Matches a unit test case to a primary business logic function in the file if referenced
 * in `[functionName]` title tags, title words, or test code body.
 */
export function matchUnitTestToFunction(tc = {}, testableFunctions = [], functionCallees = null) {
  return matchUnitTestToFunctions(tc, testableFunctions, functionCallees)[0] || null;
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
  const testableFunctions = getTestableUnitFunctions(file, fileFunctions, testCases);
  const allFunctions = Array.isArray(fileFunctions) ? fileFunctions : [];
  const fileFuncsPct = Number(file?.funcsPct ?? file?.functionsPct ?? 0);
  const fileLinesPct = Number(file?.linesPct ?? 0);
  const functionCallees = file?.functionCallees || null;

  const functions = testableFunctions.map((fn) => {
    const matchedTests = (testCases || []).filter((tc) =>
      matchUnitTestToFunctions(tc, testableFunctions, functionCallees).some(
        (m) => m.key === fn.key,
      ),
    );
    const hasPassedTest = matchedTests.some(isUnitTestPassed);
    const hasFailedTest = matchedTests.some(isUnitTestFailed);
    const hasDraftTest = matchedTests.length > 0;
    // A function with any failing assertion MUST NOT count as verified/covered.
    // Whenever at least one matched scenario passed (and none failed), count the function as covered
    // even if a selective run did not collect per-file Istanbul line hits yet.
    const rawExecutedHit =
      hasPassedTest ||
      fn.hit > 0 ||
      fileFuncsPct >= 100 ||
      fileLinesPct >= 100;
    const covered = !hasFailedTest && rawExecutedHit;
    return {
      ...fn,
      covered,
      passed: covered,
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
    isAllFunctionsCovered:
      totalFunctions > 0
        ? coveredFunctions >= totalFunctions && !functions.some((f) => f.failed)
        : fileLinesPct >= 100,
  };
}

/**
 * Annotates unit test cases with their target business logic function and category,
 * enforcing user-vs-AI precedence per (function, category) slot.
 */
export function annotateFileUnitTests(file = {}, fileFunctions = [], testCases = []) {
  const requiredCases = getRequiredUnitCasesForFile(file, fileFunctions);
  const requiredByKey = new Map(requiredCases.map((c) => [c.key, c]));
  const testableFunctions = getTestableUnitFunctions(file, fileFunctions, testCases);
  const useFunctionSlots = testableFunctions.length > 1;

  const normalizeScenarioIntent = (rawTitle = "") =>
    String(rawTitle || "")
      .trim()
      .replace(/^\[\s*[^\]]+\s*\]\s*[:\-]?\s*/i, "")
      .replace(/^should\s+/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const orderedEntries = (testCases || []).map((tc, index) => {
    const def = classifyUnitTestCase(tc);
    const technique = classifyUnitTestTechnique(tc);
    const matchedFns = matchUnitTestToFunctions(
      tc,
      testableFunctions,
      file?.functionCallees || null,
    );
    const explicitTagFn = extractLeadingFunctionTag(tc?.title || tc?.testName || tc?.name || "");
    const matchedFn =
      matchedFns[0] ||
      (explicitTagFn ? { key: `FN:${explicitTagFn}:0`, name: explicitTagFn } : null);
    const effectiveMatchedFns =
      matchedFns.length > 0 ? matchedFns : matchedFn ? [matchedFn] : [];
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
    const rawTitleStr = String(tc.title || tc.testName || "").trim();
    const normTitle = rawTitleStr.toLowerCase().replace(/\s+/g, " ");
    const normIntent = normalizeScenarioIntent(rawTitleStr);
    const isRedundantFile = /(?:^|\/)[^/]*\.redundant\./i.test(
      String(tc.testFile || tc.filePath || "").replace(/\\/g, "/"),
    );
    const fnKeyPrefix = matchedFn ? matchedFn.name.toLowerCase() : "module";
    const hasFunctionTarget = Boolean(
      matchedFn && (useFunctionSlots || Boolean(explicitTagFn)),
    );
    const categorySlotKey = hasFunctionTarget
      ? `FN::${fnKeyPrefix}::${def.key}`
      : def.key;
    // Distinct scenarios targeting different intents/branches/boundaries/error codes (e.g. 400 validation vs 500 error)
    // get distinct scenario slots so they are NEVER falsely flagged Duplicate against each other;
    // only scenarios with the same normalized intent/title (or superseded by an existing project test in the same category) are flagged Duplicate.
    let slotKey;
    if (isRedundantFile) {
      slotKey = categorySlotKey;
    } else if (isProjectExisting) {
      slotKey = `EXISTING::${fnKeyPrefix}::${normTitle || index}`;
    } else if (hasFunctionTarget && normIntent) {
      slotKey = `SCENARIO::${fnKeyPrefix}::${normIntent}`;
    } else {
      slotKey = categorySlotKey;
    }
    return {
      tc,
      index,
      id: unitTestIdentity(tc, index),
      key: def.key,
      technique,
      slotKey,
      categorySlotKey,
      normTitle,
      normIntent,
      isRedundantFile,
      matchedFn,
      matchedFns: effectiveMatchedFns,
      def,
      passed,
      failed,
      isProjectExisting,
      score,
    };
  });

  const bestForSlot = new Map();
  const coveredExistingCategorySlots = new Map();
  const coveredExistingIntents = new Map();
  const passingAiCategorySlots = new Map();
  for (const entry of orderedEntries) {
    const isFnSlot = entry.categorySlotKey.startsWith("FN::");
    if (!isFnSlot && !requiredByKey.has(entry.key)) continue;
    if (entry.isProjectExisting && !entry.isRedundantFile && !entry.failed) {
      const prevExisting = coveredExistingCategorySlots.get(entry.categorySlotKey);
      if (!prevExisting || entry.score > prevExisting.score) {
        coveredExistingCategorySlots.set(entry.categorySlotKey, entry);
      }
      if (entry.normIntent) {
        const intentKey = `${entry.matchedFn ? entry.matchedFn.name.toLowerCase() : "module"}::${entry.normIntent}`;
        const prevIntent = coveredExistingIntents.get(intentKey);
        if (!prevIntent || entry.score > prevIntent.score) {
          coveredExistingIntents.set(intentKey, entry);
        }
      }
    } else if (!entry.isProjectExisting && !entry.failed) {
      const prevAi = passingAiCategorySlots.get(entry.categorySlotKey);
      if (!prevAi || entry.score > prevAi.score) {
        passingAiCategorySlots.set(entry.categorySlotKey, entry);
      }
    }
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
    const isFnSlot = entry.categorySlotKey.startsWith("FN::");
    const reqDef = requiredByKey.get(entry.key) || entry.def;
    const techDef = entry.technique || UNIT_TECHNIQUE_DEFINITIONS.HAPPY;
    const matchedNames = (entry.matchedFns || []).map((f) => f.name);
    const fnLabel =
      matchedNames.length > 0
        ? matchedNames.map((n) => `${n}()`).join(", ")
        : null;
    const fnPrefix = fnLabel ? `Fn: ${fnLabel}` : null;

    if (!isFnSlot && !requiredByKey.has(entry.key)) {
      extraCount++;
      annotations[entry.id] = {
        badgeType: "OPTIONAL",
        badgeLabel: fnPrefix || `Case: ${reqDef.label}`,
        caseKey: entry.key,
        caseLabel: fnLabel || reqDef.label,
        techniqueKey: techDef.key,
        techniqueLabel: techDef.label,
        targetFunction: entry.matchedFn?.name || null,
        targetFunctions: matchedNames,
        functionLabel: fnLabel,
        isRemovableSuggestion: false,
      };
      continue;
    }

    const intentKey = `${entry.matchedFn ? entry.matchedFn.name.toLowerCase() : "module"}::${entry.normIntent}`;
    const existingWinnerForIntent = entry.normIntent
      ? coveredExistingIntents.get(intentKey)
      : null;
    const existingWinnerForCategory = coveredExistingCategorySlots.get(entry.categorySlotKey);
    const existingWinner = isFnSlot && !entry.isRedundantFile
      ? existingWinnerForIntent
      : existingWinnerForCategory;
    const isSupersededByExisting =
      (!entry.isProjectExisting || entry.isRedundantFile) && Boolean(existingWinner);
    const aiReplacement =
      entry.isProjectExisting && entry.failed
        ? passingAiCategorySlots.get(entry.categorySlotKey) || null
        : null;
    const winner = isSupersededByExisting
      ? existingWinner
      : aiReplacement || bestForSlot.get(entry.slotKey);
    const isPrimary =
      !isSupersededByExisting &&
      !aiReplacement &&
      primaryBySlot.get(entry.slotKey) === entry.id;
    const displayTarget = fnPrefix || `Case: ${reqDef.label}`;

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
        caseLabel: fnLabel || reqDef.label,
        techniqueKey: techDef.key,
        techniqueLabel: techDef.label,
        targetFunction: entry.matchedFn?.name || null,
        targetFunctions: matchedNames,
        functionLabel: fnLabel,
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
        badgeLabel: fnLabel ? `Failed · ${fnLabel}` : `Failed · ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: fnLabel || reqDef.label,
        techniqueKey: techDef.key,
        techniqueLabel: techDef.label,
        targetFunction: entry.matchedFn?.name || null,
        targetFunctions: matchedNames,
        functionLabel: fnLabel,
        isRemovableSuggestion: true,
        supersededByAi: true,
      };
    } else {
      redundantCount++;
      annotations[entry.id] = {
        badgeType: "DUPLICATE",
        badgeLabel: fnLabel ? `Duplicate · ${fnLabel}` : `Duplicate · ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: fnLabel || reqDef.label,
        techniqueKey: techDef.key,
        techniqueLabel: techDef.label,
        targetFunction: entry.matchedFn?.name || null,
        targetFunctions: matchedNames,
        functionLabel: fnLabel,
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

  const techniqueSummary = Object.values(UNIT_TECHNIQUE_DEFINITIONS).map((tech) => {
    const count = Object.values(scenarioAnnotations).filter(
      (a) => a.techniqueKey === tech.key && a.badgeType !== "DUPLICATE",
    ).length;
    return { ...tech, count };
  });

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
    techniqueSummary,
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

/**
 * Classifies a failing unit test case (Jest or Vitest) into a structured root-cause diagnosis,
 * mirroring Integration Test's failure diagnostic panel.
 * Returns null if no failure is present.
 */
export function diagnoseUnitFailure(tc = null) {
  if (!tc) return null;
  const rawList = Array.isArray(tc.failureMessages)
    ? tc.failureMessages
    : typeof tc === "string"
      ? [tc]
      : tc.failureMessage
        ? [tc.failureMessage]
        : [];
  const rawText = rawList
    .filter(Boolean)
    .map((m) => String(m))
    .join("\n")
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "")
    .trim();

  const isFailed =
    typeof tc === "string"
      ? Boolean(rawText)
      : isUnitTestFailed(tc) || Boolean(rawText);
  if (!isFailed) return null;

  const summary =
    (typeof tc === "object" && tc.failureSummary) ||
    summarizeUnitFailure(rawList.length > 0 ? rawList : rawText) ||
    "Unit test failed without detailed output.";

  // Extract first relevant stack location (e.g. src/utils/math.js:42:10)
  const locMatch = rawText.match(
    /(?:at\s+.*?\(?|[\s(])([A-Za-z0-9_./\\-]+\.(?:[cm]?[jt]sx?)):(\d+)(?::(\d+))?/,
  );
  const locationHint = locMatch
    ? `${locMatch[1].replace(/\\/g, "/")}:${locMatch[2]}${locMatch[3] ? `:${locMatch[3]}` : ""}`
    : null;

  const rawExcerpt = rawText
    ? rawText.split(/\r?\n/).slice(0, 18).join("\n").slice(0, 1800)
    : "";

  // 1. Missing module / package resolution failure
  const missingMod =
    rawText.match(/Cannot find module ['"]([^'"]+)['"]/i) ||
    rawText.match(/Cannot find package ['"]([^'"]+)['"]/i) ||
    rawText.match(/Failed to resolve import ['"]([^'"]+)['"]/i) ||
    rawText.match(/ERR_MODULE_NOT_FOUND.*?['"]([^'"]+)['"]/i);
  if (missingMod) {
    const target = missingMod[1];
    const isRelative = target.startsWith(".") || target.startsWith("/");
    return {
      failureLayer: "MODULE_NOT_FOUND",
      label: "Module / Import Error",
      explanation: isRelative
        ? `Test could not resolve relative import "${target}". The file path or ESM extension may be incorrect.`
        : `Package "${target}" is missing or cannot be resolved by the test runner.`,
      suggestedFix: isRelative
        ? "Verify the relative import path and file extension (.js/.ts), or regenerate this test case."
        : `Install "${target}" via Test Setup or mock it in the unit test file.`,
      summary,
      locationHint,
      rawExcerpt,
    };
  }

  // 2. Syntax / ESM-vs-CJS / Transform failure
  if (
    /SyntaxError:|Unexpected token|Cannot use import statement outside a module|Must use import to load ES Module|ERR_REQUIRE_ESM|Transform failed/i.test(
      rawText,
    )
  ) {
    return {
      failureLayer: "SYNTAX_ERROR",
      label: "Syntax / ESM Transform Error",
      explanation:
        "The test runner failed to parse or transform the test or source module (often an ESM/CJS or JSX mismatch).",
      suggestedFix:
        "Switch between Vitest (native ESM/Vite) and Jest in Test Setup, or inspect the syntax around the indicated line.",
      summary,
      locationHint,
      rawExcerpt,
    };
  }

  // 3. Mock hoisting / mock setup errors
  if (
    /out-of-scope variables|Invalid variable access|jest\.mock|vi\.mock|mockResolvedValue|mockImplementation|is not a mock function|Cannot spy/i.test(
      rawText,
    )
  ) {
    return {
      failureLayer: "MOCK_ERROR",
      label: "Mock / Spy Setup Error",
      explanation:
        "A dependency mock or spy failed during hoisting or invocation.",
      suggestedFix:
        "Ensure mocked variables use `vi.hoisted(...)` (Vitest) or `mock*` prefixed / global references (Jest) and return the expected method shapes.",
      summary,
      locationHint,
      rawExcerpt,
    };
  }

  // 4. Timeout
  if (
    /Exceeded timeout|Test timed out|Async callback was not invoked|Timeout - Async/i.test(
      rawText,
    )
  ) {
    return {
      failureLayer: "TIMEOUT",
      label: "Async Timeout",
      explanation:
        "The test exceeded the execution timeout waiting for an async operation, timer, or unresolved Promise.",
      suggestedFix:
        "Mock external network/DB calls, ensure Promises resolve/reject, or restore real timers (`vi.useRealTimers()` / `jest.useRealTimers()`).",
      summary,
      locationHint,
      rawExcerpt,
    };
  }

  // 5. Assertion failure (Expected vs Received)
  const expectedMatch = rawText.match(/Expected(?:\s+value)?:\s*([^\r\n]+)/i);
  const receivedMatch = rawText.match(/Received(?:\s+value)?:\s*([^\r\n]+)/i);
  if (
    expectedMatch ||
    receivedMatch ||
    /AssertionError|expect\(|toBe|toEqual|toStrictEqual|toMatch|toThrow|toHaveBeenCalled/i.test(
      rawText,
    )
  ) {
    const diffHint =
      expectedMatch && receivedMatch
        ? `Expected ${expectedMatch[1].trim()} but received ${receivedMatch[1].trim()}.`
        : "The actual return value, side effect, or thrown error did not match the assertion.";
    return {
      failureLayer: "ASSERTION_FAILED",
      label: "Assertion Mismatch",
      explanation: diffHint,
      suggestedFix:
        "Check whether the source function has a real bug or if the test assertion/mock setup needs updating.",
      summary,
      locationHint,
      rawExcerpt,
    };
  }

  // 6. Generic runtime exception (TypeError, ReferenceError, etc.)
  const errTypeMatch = rawText.match(
    /\b(TypeError|ReferenceError|RangeError|URIError|Error):\s*([^\r\n]+)/,
  );
  return {
    failureLayer: "RUNTIME_ERROR",
    label: errTypeMatch ? errTypeMatch[1] : "Runtime Error",
    explanation: errTypeMatch
      ? `${errTypeMatch[1]}: ${errTypeMatch[2].trim()}`
      : summary,
    suggestedFix:
      "Inspect null/undefined inputs, required environment variables, or unmocked dependencies at the reported line.",
    summary,
    locationHint,
    rawExcerpt,
  };
}
