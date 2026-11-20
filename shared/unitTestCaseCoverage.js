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
 */
export function classifyUnitTestCase(tc = {}) {
  const explicitKey =
    UNIT_CATEGORY_TO_KEY[String(tc.caseKey || tc.category || "").toUpperCase()];
  if (explicitKey && UNIT_CASE_DEFINITIONS[explicitKey]) {
    return UNIT_CASE_DEFINITIONS[explicitKey];
  }

  const text = [
    tc.title || tc.testName || tc.name || "",
    ...(Array.isArray(tc.ancestorTitles) ? tc.ancestorTitles : []),
    tc.description || "",
  ]
    .join(" ")
    .toLowerCase();

  if (
    /\b(error|errors|throw|throws|exception|reject|rejects|catch|fail|fails|failed|failure|invalid|malformed|unauthorized|forbidden|timeout|abort|crash)\b/.test(
      text,
    ) ||
    /\b(400|401|403|404|409|422|500)\b/.test(text)
  ) {
    return UNIT_CASE_DEFINITIONS.ERROR;
  }

  if (
    /\b(boundary|edge|null|undefined|empty|zero|negative|min|max|limit|overflow|nan|blank|missing|whitespace|single|truncated|large)\b/.test(
      text,
    )
  ) {
    return UNIT_CASE_DEFINITIONS.BOUNDARY;
  }

  if (
    /\b(branch|when|if|else|switch|case|fallback|skip|ignore|toggle|already|duplicate|false|true|without|default|existing)\b/.test(
      text,
    )
  ) {
    return UNIT_CASE_DEFINITIONS.BRANCH;
  }

  return UNIT_CASE_DEFINITIONS.HAPPY;
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

/**
 * Annotates unit test cases with which required Unit case they satisfy vs Duplicate / Optional,
 * matching Integration's scenario annotation model.
 */
export function annotateFileUnitTests(file = {}, fileFunctions = [], testCases = []) {
  const requiredCases = getRequiredUnitCasesForFile(file, fileFunctions);
  const requiredByKey = new Map(requiredCases.map((c) => [c.key, c]));

  const orderedEntries = (testCases || []).map((tc, index) => {
    const def = classifyUnitTestCase(tc);
    const passed = isUnitTestPassed(tc);
    const failed = isUnitTestFailed(tc);
    const isProjectExisting =
      tc?.origin !== "AI_DRAFT" && tc?.origin !== "AI_SUGGESTED";
    // Higher score wins primary slot per required case
    const score =
      (passed ? 100 : failed ? 20 : 50) + (isProjectExisting ? 10 : 0);
    return {
      tc,
      index,
      id: unitTestIdentity(tc, index),
      key: def.key,
      def,
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

    const isPrimary = primaryByKey.get(entry.key) === entry.id;
    if (isPrimary) {
      const passed = isUnitTestPassed(entry.tc);
      const failed = isUnitTestFailed(entry.tc);
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
    passed: passedKeys.has(c.key) && !failedKeys.has(c.key),
    failed: failedKeys.has(c.key),
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
