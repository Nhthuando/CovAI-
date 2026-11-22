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

export function isUnitTestPassed(tc) {
  const status = String(tc?.status || "").toUpperCase();
  return status === "PASS" || status === "PASSED";
}

export function isUnitTestFailed(tc) {
  const status = String(tc?.status || "").toUpperCase();
  return status === "FAIL" || status === "FAILED";
}

/**
 * Classifies a unit test case into one of the 4 standard CovAI unit test categories.
 * Checks explicit caseKey/category and explicit leading title tags first so that
 * incidental words in a scenario description never misclassify its intended case.
 */
export function classifyUnitTestCase(tc = {}) {
  const explicitKey =
    UNIT_CATEGORY_TO_KEY[String(tc.caseKey || tc.category || "").toUpperCase()];
  if (explicitKey && UNIT_CASE_DEFINITIONS[explicitKey]) {
    return UNIT_CASE_DEFINITIONS[explicitKey];
  }

  const rawTitle = String(tc.title || tc.testName || tc.name || "").trim();

  // 1. Check explicit bracketed tag, category label, or leading TC-* prefix in title
  if (
    /^(?:\[\s*happy(?:\s*path)?\s*\]|happy\s*path\s*[:\-]|category\s*a\b|tc[-_\s]*happy\b)/i.test(
      rawTitle,
    ) ||
    /\[\s*category\s*a\s*:\s*happy\s*path\s*\]/i.test(rawTitle)
  ) {
    return UNIT_CASE_DEFINITIONS.HAPPY;
  }
  if (
    /^(?:\[\s*boundary(?:\s*\/\s*edge|\s*values?)?\s*\]|boundary(?:\s*\/\s*edge|\s*values?)?\s*[:\-]|category\s*b\b|tc[-_\s]*(?:bound(?:ary)?|edge)\b)/i.test(
      rawTitle,
    ) ||
    /\[\s*category\s*b\s*:\s*boundary/i.test(rawTitle)
  ) {
    return UNIT_CASE_DEFINITIONS.BOUNDARY;
  }
  if (
    /^(?:\[\s*branch(?:\s*paths?|\s*toggling|\s*coverage)?\s*\]|branch(?:\s*paths?|\s*toggling)?\s*[:\-]|category\s*c\b|tc[-_\s]*branch\b)/i.test(
      rawTitle,
    ) ||
    /\[\s*category\s*c\s*:\s*branch/i.test(rawTitle)
  ) {
    return UNIT_CASE_DEFINITIONS.BRANCH;
  }
  if (
    /^(?:\[\s*error(?:\s*handling|\s*&\s*exception)?\s*\]|error(?:\s*handling)?\s*[:\-]|category\s*d\b|tc[-_\s]*err(?:or)?\b)/i.test(
      rawTitle,
    ) ||
    /\[\s*category\s*d\s*:\s*error/i.test(rawTitle)
  ) {
    return UNIT_CASE_DEFINITIONS.ERROR;
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

  const titleMatch = matchKeywords(rawTitle);
  if (titleMatch) return titleMatch;

  const fullText = [
    rawTitle,
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
 * Annotates unit test cases with which required Unit case they satisfy vs Duplicate / Optional,
 * enforcing user-vs-AI precedence:
 * - If the user's existing test (PROJECT_EXISTING / USER) passed or has not failed yet,
 *   the user's test is Primary (`Case: <Label>`) and any AI test for the same case is marked `Duplicate`.
 * - If the user's existing test FAILED after running and an AI test for that case passed (or is valid),
 *   the user's test is marked `Failed · <Label>` and the AI test becomes Primary (`Case: <Label>`).
 */
export function annotateFileUnitTests(file = {}, fileFunctions = [], testCases = []) {
  const requiredCases = getRequiredUnitCasesForFile(file, fileFunctions);
  const requiredByKey = new Map(requiredCases.map((c) => [c.key, c]));

  const orderedEntries = (testCases || []).map((tc, index) => {
    const def = classifyUnitTestCase(tc);
    const passed = isUnitTestPassed(tc);
    const failed = isUnitTestFailed(tc);
    const isProjectExisting = isUserOrExistingUnitTest(tc);
    let score;
    if (isProjectExisting && !failed) {
      // User's existing test is valid (passed or not yet failed) -> always preferred over AI
      score = passed ? 220 : 200;
    } else if (!isProjectExisting && !failed) {
      // AI test is valid (passed or pending draft) -> takes over Primary if user test failed or is absent
      score = passed ? 170 : 150;
    } else if (isProjectExisting && failed) {
      score = 40;
    } else {
      score = 20;
    }
    return {
      tc,
      index,
      id: unitTestIdentity(tc, index),
      key: def.key,
      def,
      passed,
      failed,
      isProjectExisting,
      score,
    };
  });

  const bestForKey = new Map();
  for (const entry of orderedEntries) {
    if (!requiredByKey.has(entry.key)) continue;
    const prev = bestForKey.get(entry.key);
    if (!prev || entry.score > prev.score) {
      bestForKey.set(entry.key, entry);
    }
  }

  const primaryByKey = new Map();
  for (const [key, entry] of bestForKey.entries()) {
    primaryByKey.set(key, entry.id);
  }

  const annotations = {};
  let redundantCount = 0;
  let extraCount = 0;

  for (const entry of orderedEntries) {
    const reqDef = requiredByKey.get(entry.key);
    if (!reqDef) {
      extraCount++;
      annotations[entry.id] = {
        badgeType: "OPTIONAL",
        badgeLabel: `Optional · ${entry.def.label}`,
        caseKey: entry.key,
        caseLabel: entry.def.label,
        isRemovableSuggestion: false,
      };
      continue;
    }

    const winner = bestForKey.get(entry.key);
    const isPrimary = primaryByKey.get(entry.key) === entry.id;
    if (isPrimary) {
      const passed = entry.passed;
      const failed = entry.failed;
      annotations[entry.id] = {
        badgeType: passed
          ? "PRIMARY_PASS"
          : failed
            ? "PRIMARY_FAIL"
            : "PRIMARY_PENDING",
        badgeLabel: `Case: ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: reqDef.label,
        isRemovableSuggestion: false,
      };
    } else if (
      entry.isProjectExisting &&
      entry.failed &&
      winner &&
      !winner.isProjectExisting &&
      !winner.failed
    ) {
      // User's pre-existing test failed after running and was superseded by a valid AI test
      annotations[entry.id] = {
        badgeType: "PRIMARY_FAIL",
        badgeLabel: `Failed · ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: reqDef.label,
        isRemovableSuggestion: true,
        supersededByAi: true,
      };
    } else {
      redundantCount++;
      annotations[entry.id] = {
        badgeType: "DUPLICATE",
        badgeLabel: `Duplicate · ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: reqDef.label,
        isRemovableSuggestion: true,
      };
    }
  }

  return { annotations, redundantCount, extraCount };
}

/**
 * Full Unit Test case coverage computation for a source file.
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
  };
}

/**
 * Strips ANSI escape sequences and distills Jest / Vitest failure logs into
 * concise human-readable summaries for Unit Tests.
 */
export function summarizeUnitFailure(rawInput, parsedFailure = null) {
  return summarizeIntegrationFailure(rawInput, parsedFailure);
}
