import { summarizeIntegrationFailure } from "./integrationCaseCoverage.js";

export const SYSTEM_CASE_DEFINITIONS = {
  HAPPY: {
    key: "HAPPY",
    category: "HAPPY_FLOW",
    label: "Happy Flow",
    description: "Primary end-to-end user journey succeeds across UI, API, and state.",
  },
  EDGE: {
    key: "EDGE",
    category: "EDGE_INPUT",
    label: "Edge / Input",
    description: "Empty states, boundary form inputs, duplicate checks, or validation feedback.",
  },
  ERROR: {
    key: "ERROR",
    category: "ERROR_RECOVERY",
    label: "Error / Fallback",
    description: "Error responses, unauthorized actions, 404 routes, or fallback recovery.",
  },
  AUTH: {
    key: "AUTH",
    category: "STATE_PERSISTENCE",
    label: "State / Auth",
    description: "Reload persistence, real DB state check, session/auth or route guards.",
  },
};

export const SYSTEM_CATEGORY_TO_KEY = {
  HAPPY_FLOW: "HAPPY",
  HAPPY: "HAPPY",
  EDGE_INPUT: "EDGE",
  EDGE: "EDGE",
  BOUNDARY: "EDGE",
  ERROR_RECOVERY: "ERROR",
  ERROR: "ERROR",
  STATE_PERSISTENCE: "AUTH",
  PERSISTENCE: "AUTH",
  AUTH: "AUTH",
};

export function isSystemScenarioPassed(sc) {
  const s = String(sc?.status || sc?.lastRunStatus || "").toUpperCase();
  return s === "PASS" || s === "PASSED";
}

export function isSystemScenarioFailed(sc) {
  const s = String(sc?.status || sc?.lastRunStatus || "").toUpperCase();
  return s === "FAIL" || s === "FAILED" || s === "TIMEDOUT" || s === "INTERRUPTED";
}

/**
 * Classifies a system E2E scenario into one of the 4 System Test journey categories.
 */
export function classifySystemScenario(sc = {}) {
  const explicitKey =
    SYSTEM_CATEGORY_TO_KEY[String(sc.caseKey || sc.category || "").toUpperCase()];
  if (explicitKey && SYSTEM_CASE_DEFINITIONS[explicitKey]) {
    return SYSTEM_CASE_DEFINITIONS[explicitKey];
  }

  const text = [
    sc.title || sc.testName || sc.name || "",
    sc.suiteName || "",
    ...(Array.isArray(sc.expectedJson) ? sc.expectedJson : []),
    ...(Array.isArray(sc.flowJson) ? sc.flowJson : []),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /\b(error|fail|failed|failure|invalid|401|403|404|500|offline|reject|denied|unauthorized|forbidden|fallback|recover)\b/.test(
      text,
    )
  ) {
    return SYSTEM_CASE_DEFINITIONS.ERROR;
  }

  if (
    /\b(login|logout|auth|session|token|reload(?:s|ed|ing)?|refresh(?:es|ed|ing)?|persist(?:s|ed|ence|ing)?|database|cookie|role|guard)\b/.test(
      text,
    )
  ) {
    return SYSTEM_CASE_DEFINITIONS.AUTH;
  }

  if (
    /\b(empty|blank|missing|boundary|edge|limit|max|min|required|validation|warning|duplicate|toggle|cancel|filter|search)\b/.test(
      text,
    )
  ) {
    return SYSTEM_CASE_DEFINITIONS.EDGE;
  }

  return SYSTEM_CASE_DEFINITIONS.HAPPY;
}

/**
 * Derives required E2E cases for a spec file or feature group.
 */
export function getRequiredSystemCasesForGroup(group = {}, scenarios = []) {
  const combinedText = [
    group.name || group.filePath || "",
    ...(group.routes || []),
    ...(scenarios || []).map((s) => `${s.title || ""} ${s.suiteName || ""}`),
  ]
    .join(" ")
    .toLowerCase();

  const required = [SYSTEM_CASE_DEFINITIONS.HAPPY, SYSTEM_CASE_DEFINITIONS.EDGE];
  if (
    /\b(login|auth|session|dashboard|todo|article|event|persist|reload|crud|create|delete|form)\b/.test(
      combinedText,
    ) ||
    scenarios.length >= 2
  ) {
    required.push(SYSTEM_CASE_DEFINITIONS.AUTH);
  }
  if (
    /\b(error|delete|404|401|500|invalid|fail|form|api)\b/.test(combinedText) ||
    scenarios.length >= 3
  ) {
    required.push(SYSTEM_CASE_DEFINITIONS.ERROR);
  }
  return required;
}

function scenarioIdentity(sc, idx) {
  return String(
    sc?.id || `${sc?.filePath || sc?.testFile || "spec"}::${sc?.title || idx}`,
  );
}

/**
 * Annotates System scenarios with Case coverage vs Duplicate vs Optional badges.
 */
export function annotateSystemGroupScenarios(group = {}, scenarios = []) {
  const required = getRequiredSystemCasesForGroup(group, scenarios);
  const reqByKey = new Map(required.map((c) => [c.key, c]));

  const entries = (scenarios || []).map((sc, idx) => {
    const def = classifySystemScenario(sc);
    const passed = isSystemScenarioPassed(sc);
    const failed = isSystemScenarioFailed(sc);
    const origin = String(sc?.origin || "").toUpperCase();
    const isAiScenario = origin === "AI_DRAFT" || origin === "AI_GENERATED" || Boolean(sc?.isDraft);
    const isUserOwned =
      Boolean(sc?.userEdited) ||
      origin === "PROJECT_EXISTING" ||
      origin === "USER_ADDED" ||
      origin === "USER_MODIFIED" ||
      !isAiScenario;
    const score = (passed ? 100 : failed ? 20 : 50) + (isUserOwned ? 15 : 0);
    return {
      sc,
      id: scenarioIdentity(sc, idx),
      key: def.key,
      def,
      score,
    };
  });

  const bestForKey = new Map();
  for (const entry of entries) {
    if (!reqByKey.has(entry.key)) continue;
    const prev = bestForKey.get(entry.key);
    if (!prev || entry.score > prev.score) {
      bestForKey.set(entry.key, entry);
    }
  }

  const primaryByKey = new Map(
    [...bestForKey.entries()].map(([k, v]) => [k, v.id]),
  );

  const annotations = {};
  let redundantCount = 0;
  let extraCount = 0;

  for (const entry of entries) {
    const reqDef = reqByKey.get(entry.key);
    if (!reqDef) {
      extraCount++;
      annotations[entry.id] = {
        badgeType: "OPTIONAL",
        badgeLabel: `Optional · ${entry.def.label}`,
        caseKey: entry.key,
        caseLabel: entry.def.label,
      };
      continue;
    }

    if (primaryByKey.get(entry.key) === entry.id) {
      const passed = isSystemScenarioPassed(entry.sc);
      const failed = isSystemScenarioFailed(entry.sc);
      annotations[entry.id] = {
        badgeType: passed
          ? "PRIMARY_PASS"
          : failed
            ? "PRIMARY_FAIL"
            : "PRIMARY_PENDING",
        badgeLabel: `Case: ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: reqDef.label,
      };
    } else {
      redundantCount++;
      annotations[entry.id] = {
        badgeType: "DUPLICATE",
        badgeLabel: `Duplicate · ${reqDef.label}`,
        caseKey: reqDef.key,
        caseLabel: reqDef.label,
      };
    }
  }

  return { annotations, redundantCount, extraCount };
}

export function getSystemGroupCaseCoverage(group = {}, scenarios = []) {
  const required = getRequiredSystemCasesForGroup(group, scenarios);
  const coveredKeys = new Set();
  const passedKeys = new Set();
  const failedKeys = new Set();
  let passedCount = 0;
  let failedCount = 0;

  for (const sc of scenarios || []) {
    const def = classifySystemScenario(sc);
    coveredKeys.add(def.key);
    if (isSystemScenarioPassed(sc)) {
      passedCount++;
      passedKeys.add(def.key);
    } else if (isSystemScenarioFailed(sc)) {
      failedCount++;
      failedKeys.add(def.key);
    }
  }

  const cases = required.map((c) => ({
    ...c,
    covered: coveredKeys.has(c.key),
    passed: passedKeys.has(c.key) && !failedKeys.has(c.key),
    failed: failedKeys.has(c.key),
  }));

  const { annotations: scenarioAnnotations, redundantCount, extraCount } =
    annotateSystemGroupScenarios(group, scenarios);

  return {
    cases,
    coveredCount: cases.filter((c) => c.covered).length,
    passedCasesCount: cases.filter((c) => c.passed).length,
    totalRequired: cases.length,
    passedCount,
    failedCount,
    notRunCount: Math.max(0, (scenarios || []).length - passedCount - failedCount),
    scenarioAnnotations,
    redundantCount,
    extraCount,
  };
}

/**
 * Strips ANSI codes & Playwright/Cypress call-log boilerplate into a concise failure summary.
 */
export function summarizeSystemFailure(rawInput, parsedFailure = null) {
  const joined = Array.isArray(rawInput)
    ? rawInput.join("\n")
    : String(rawInput || "");
  const clean = joined
    .replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\u001b/g, "")
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "")
    .trim();

  if (!clean) {
    return "E2E assertion or browser step failed during System Test execution.";
  }

  const timeoutLoc = clean.match(/locator\(\s*(['"`])((?:\\.|(?!\1).)+)\1\s*\)/i);
  if (/timeout|timed out/i.test(clean)) {
    const target = timeoutLoc?.[2] || "";
    const expectMatch = clean.match(/expect\([^)]*\)\s*\.([a-zA-Z0-9_]+)/);
    if (expectMatch && target) {
      return `Timeout on expect('${target}').${expectMatch[1]}(): Element state not reached in time.`;
    }
    if (target) {
      return `Playwright timeout waiting for locator '${target}'.`;
    }
    return "Browser action or page load timed out waiting for expected UI state.";
  }

  if (/net::ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(clean)) {
    return "Connection refused: Target app frontend/backend server did not respond on expected URL.";
  }

  return summarizeIntegrationFailure(clean, parsedFailure);
}
