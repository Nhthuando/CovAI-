export const CATEGORY_LABELS = {
  HAPPY_PATH: {
    label: "Happy Path",
    color: "text-emerald-400 border-emerald-500/25 bg-emerald-500/10",
  },
  VALIDATION: {
    label: "Validation 400",
    color: "text-amber-400 border-amber-500/25 bg-amber-500/10",
  },
  SECURITY: {
    label: "Auth / Security",
    color: "text-purple-400 border-purple-500/25 bg-purple-500/10",
  },
  NOT_FOUND: {
    label: "Not Found 404",
    color: "text-zinc-400 border-zinc-500/25 bg-zinc-500/10",
  },
  RESILIENCY: {
    label: "Edge / Resiliency",
    color: "text-rose-400 border-rose-500/25 bg-rose-500/10",
  },
};

/**
 * Classify a test scenario into a standardized API contract category.
 */
export function classifyScenario(sc) {
  const title = (sc?.title || sc?.name || sc?.testName || "").toLowerCase();
  const cat = (sc?.category || "").toUpperCase();
  const status = Number(sc?.expectedStatus || sc?.actualStatus || 0);

  if (
    cat === "SECURITY" ||
    status === 401 ||
    status === 403 ||
    title.includes("401") ||
    title.includes("403") ||
    title.includes("unauthorized") ||
    title.includes("forbidden") ||
    title.includes("auth") ||
    title.includes("token")
  ) {
    return CATEGORY_LABELS.SECURITY;
  }
  if (
    cat === "NOT_FOUND" ||
    status === 404 ||
    title.includes("404") ||
    title.includes("not found") ||
    title.includes("non-existent")
  ) {
    return CATEGORY_LABELS.NOT_FOUND;
  }
  if (
    cat === "VALIDATION" ||
    status === 400 ||
    status === 422 ||
    title.includes("400") ||
    title.includes("422") ||
    title.includes("invalid") ||
    title.includes("missing") ||
    title.includes("validation") ||
    title.includes("bad request")
  ) {
    return CATEGORY_LABELS.VALIDATION;
  }
  if (
    cat === "RESILIENCY" ||
    cat === "EDGE_CASE" ||
    status >= 500 ||
    title.includes("500") ||
    title.includes("error") ||
    title.includes("fail") ||
    title.includes("edge") ||
    title.includes("duplicate") ||
    title.includes("conflict")
  ) {
    return CATEGORY_LABELS.RESILIENCY;
  }
  return CATEGORY_LABELS.HAPPY_PATH;
}

/**
 * Evaluate whether an endpoint's scenarios actually cover its expected contract cases
 * (Happy Path, Validation, Auth, Not Found, Edge/Error) and whether they have passed.
 */
export function getEndpointCaseCoverage(ep, scenarios = []) {
  const method = (ep?.method || "GET").toUpperCase();
  const pathStr = ep?.path || ep?.route || ep?.fullPath || "/";
  const snippet = (ep?.source?.logicSnippet || ep?.logicSnippet || "").toLowerCase();
  const middlewares = (ep?.middlewares || []).join(" ").toLowerCase();
  const statusCodes = (
    ep?.source?.behaviorEvidence?.responseStatusCodes ||
    ep?.source?.responseStatusCodes ||
    []
  ).map(Number);

  const requiredCases = [{ key: "HAPPY", label: "Happy 2xx" }];
  if (
    ["POST", "PUT", "PATCH"].includes(method) ||
    statusCodes.includes(400) ||
    statusCodes.includes(422) ||
    /req\.body|400|422|invalid|missing/.test(snippet)
  ) {
    requiredCases.push({ key: "VALIDATION", label: "Validation 400" });
  }
  if (
    statusCodes.includes(401) ||
    statusCodes.includes(403) ||
    /auth|token|jwt|bearer|401|403|forbidden|unauthorized/.test(`${middlewares} ${snippet}`)
  ) {
    requiredCases.push({ key: "AUTH", label: "Auth 401/403" });
  }
  if (
    pathStr.includes(":") ||
    statusCodes.includes(404) ||
    statusCodes.includes(409) ||
    /404|409|not found/.test(snippet)
  ) {
    requiredCases.push({ key: "NOT_FOUND", label: "Not Found 404" });
  }
  if (/catch|500|throw|limit|length|boundary/.test(snippet)) {
    requiredCases.push({ key: "EDGE", label: "Edge / Error" });
  }

  const coveredKeys = new Set();
  let passedCount = 0;
  let failedCount = 0;
  for (const sc of scenarios) {
    const cat = classifyScenario(sc);
    const title = (sc.title || sc.name || sc.testName || "").toLowerCase();
    const exp = Number(sc.expectedStatus || 200);
    if (cat === CATEGORY_LABELS.HAPPY_PATH) coveredKeys.add("HAPPY");
    else if (cat === CATEGORY_LABELS.VALIDATION) coveredKeys.add("VALIDATION");
    else if (cat === CATEGORY_LABELS.SECURITY) coveredKeys.add("AUTH");
    else if (cat === CATEGORY_LABELS.NOT_FOUND) coveredKeys.add("NOT_FOUND");
    else coveredKeys.add("EDGE");

    if (exp === 400 || exp === 422) coveredKeys.add("VALIDATION");
    if (exp === 401 || exp === 403) coveredKeys.add("AUTH");
    if (exp === 404 || exp === 409) coveredKeys.add("NOT_FOUND");
    if (exp >= 500 || /boundary|edge|limit|empty|more than|fewer than/.test(title)) {
      coveredKeys.add("EDGE");
    }

    if (
      sc.status === "passed" ||
      sc.rawJestStatus === "passed" ||
      sc.executionVerdict === "PASS"
    ) {
      passedCount++;
    } else if (
      sc.status === "failed" ||
      sc.rawJestStatus === "failed" ||
      sc.executionVerdict === "FAIL"
    ) {
      failedCount++;
    }
  }

  const cases = requiredCases.map((c) => ({
    ...c,
    covered: coveredKeys.has(c.key),
  }));
  const coveredCount = cases.filter((c) => c.covered).length;
  return {
    cases,
    coveredCount,
    totalRequired: cases.length,
    missingCases: cases.filter((c) => !c.covered),
    isComplete: cases.length > 0 && coveredCount === cases.length,
    passedCount,
    failedCount,
    notRunCount: Math.max(0, scenarios.length - passedCount - failedCount),
  };
}
