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

export const CASE_DEFINITIONS = {
  HAPPY: { key: "HAPPY", label: "Happy 2xx", promptHint: "Happy Path (200/201)" },
  VALIDATION: {
    key: "VALIDATION",
    label: "Validation 400",
    promptHint: "Validation Error (400/422)",
  },
  AUTH: {
    key: "AUTH",
    label: "Auth 401/403",
    promptHint: "Auth / Permission (401/403)",
  },
  NOT_FOUND: {
    key: "NOT_FOUND",
    label: "Not Found 404",
    promptHint: "Not Found / Conflict (404/409)",
  },
  EDGE: {
    key: "EDGE",
    label: "Edge / Error",
    promptHint: "Edge / Server Error (500)",
  },
};

export function isScenarioPassed(sc) {
  const status = String(sc?.status || "").toLowerCase();
  const raw = String(sc?.rawJestStatus || "").toLowerCase();
  const verdict = String(sc?.executionVerdict || "").toUpperCase();
  return status === "passed" || status === "pass" || raw === "passed" || verdict === "PASS";
}

export function isScenarioFailed(sc) {
  const status = String(sc?.status || "").toLowerCase();
  const raw = String(sc?.rawJestStatus || "").toLowerCase();
  const verdict = String(sc?.executionVerdict || "").toUpperCase();
  return status === "failed" || status === "fail" || raw === "failed" || verdict === "FAIL";
}

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
    title.includes("token") ||
    title.includes("chưa đăng nhập") ||
    title.includes("không có quyền") ||
    title.includes("truy cập trái phép") ||
    title.includes("quyền truy cập") ||
    title.includes("xác thực") ||
    title.includes("hết hạn")
  ) {
    return CATEGORY_LABELS.SECURITY;
  }
  if (
    cat === "NOT_FOUND" ||
    status === 404 ||
    status === 409 ||
    title.includes("404") ||
    title.includes("409") ||
    title.includes("not found") ||
    title.includes("non-existent") ||
    title.includes("không tìm thấy") ||
    title.includes("không tồn tại") ||
    title.includes("chưa tồn tại") ||
    title.includes("đã tồn tại") ||
    title.includes("xung đột")
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
    title.includes("bad request") ||
    title.includes("không hợp lệ") ||
    title.includes("sai định dạng") ||
    title.includes("dữ liệu sai") ||
    title.includes("thiếu") ||
    title.includes("bắt buộc") ||
    title.includes("ngăn chặn") ||
    title.includes("ràng buộc")
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
    title.includes("conflict") ||
    title.includes("lỗi hệ thống") ||
    title.includes("lỗi máy chủ") ||
    title.includes("lỗi server") ||
    title.includes("ngoại lệ") ||
    title.includes("trùng lặp")
  ) {
    return CATEGORY_LABELS.RESILIENCY;
  }
  return CATEGORY_LABELS.HAPPY_PATH;
}

/**
 * Map a scenario object to its primary required-case key.
 */
export function getScenarioCaseKey(sc) {
  const cat = classifyScenario(sc);
  if (cat === CATEGORY_LABELS.HAPPY_PATH) return "HAPPY";
  if (cat === CATEGORY_LABELS.VALIDATION) return "VALIDATION";
  if (cat === CATEGORY_LABELS.SECURITY) return "AUTH";
  if (cat === CATEGORY_LABELS.NOT_FOUND) return "NOT_FOUND";
  return "EDGE";
}

/**
 * Compute required contract test cases for an API endpoint (shared between backend AI & frontend UI).
 */
export function getEndpointRequiredCases(ep) {
  const method = (ep?.method || "GET").toUpperCase();
  const pathStr = ep?.path || ep?.route || ep?.fullPath || "/";
  const snippet = (
    ep?.source?.logicSnippet ||
    ep?.source?.controllerSnippet ||
    ep?.logicSnippet ||
    ep?.controllerSnippet ||
    ep?.source?.routeSnippet ||
    ep?.routeSnippet ||
    ""
  ).toLowerCase();
  const hasTryCatch = Boolean(
    ep?.errorHandling?.hasTryCatch ||
      ep?.source?.errorHandling?.hasTryCatch ||
      ep?.source?.behaviorEvidence?.errorHandling?.hasTryCatch ||
      ep?.behaviorEvidence?.errorHandling?.hasTryCatch,
  );

  const rawMiddlewares =
    ep?.middlewares ||
    ep?.middleware ||
    ep?.source?.middlewares ||
    ep?.source?.middleware ||
    [];
  const middlewares = (Array.isArray(rawMiddlewares) ? rawMiddlewares : [rawMiddlewares])
    .map((m) => (typeof m === "string" ? m : m?.name || ""))
    .join(" ")
    .toLowerCase();

  const rawStatusCodes =
    ep?.source?.behaviorEvidence?.responseStatusCodes ||
    ep?.behaviorEvidence?.responseStatusCodes ||
    ep?.source?.responseStatusCodes ||
    ep?.responseStatusCodes ||
    [];
  const statusCodes = rawStatusCodes.map(Number);

  const requiredCases = [{ ...CASE_DEFINITIONS.HAPPY }];
  if (
    ["POST", "PUT", "PATCH"].includes(method) ||
    statusCodes.includes(400) ||
    statusCodes.includes(422) ||
    /req\.body|400|422|invalid|missing/.test(snippet)
  ) {
    requiredCases.push({ ...CASE_DEFINITIONS.VALIDATION });
  }
  if (
    statusCodes.includes(401) ||
    statusCodes.includes(403) ||
    /auth|token|jwt|bearer|401|403|forbidden|unauthorized/.test(`${middlewares} ${snippet}`)
  ) {
    requiredCases.push({ ...CASE_DEFINITIONS.AUTH });
  }
  if (
    pathStr.includes(":") ||
    statusCodes.includes(404) ||
    statusCodes.includes(409) ||
    /404|409|not found/.test(snippet)
  ) {
    requiredCases.push({ ...CASE_DEFINITIONS.NOT_FOUND });
  }
  const hasExplicitNon5xxCatch =
    statusCodes.length > 0 &&
    !statusCodes.some((s) => s >= 500) &&
    !/500|5\d\d|next\s*\(|limit|length|boundary/.test(snippet);

  if (
    !hasExplicitNon5xxCatch &&
    (hasTryCatch ||
      /catch|500|5\d\d|throw|next\s*\(|limit|length|boundary|error|exception|async\s+|await\s+|prisma|mongoose|sequelize|knex|typeorm/.test(
        snippet,
      ))
  ) {
    requiredCases.push({ ...CASE_DEFINITIONS.EDGE });
  }

  return requiredCases;
}

/**
 * Classify each scenario's role relative to an endpoint's required contract cases.
 * Marks which scenario satisfies each required case (so users see which tests are needed)
 * vs redundant duplicates or optional/extra scenarios outside required cases.
 */
export function annotateEndpointScenarios(ep, scenarios = []) {
  const requiredCases = getEndpointRequiredCases(ep);
  const requiredMap = new Map(requiredCases.map((c) => [c.key, c]));

  const isPrimaryBetter = (candidate, current) => {
    const score = (sc) => {
      if (isScenarioPassed(sc)) return 30;
      if (!isScenarioFailed(sc)) return 20;
      return 10;
    };
    const originScore = (sc) => {
      const origin = String(sc?.origin || "").toUpperCase();
      if (sc?.userEdited || origin === "PROJECT_EXISTING" || origin === "USER_ADDED" || origin === "USER_MODIFIED") {
        return 2;
      }
      return 1;
    };
    return score(candidate) + originScore(candidate) > score(current) + originScore(current);
  };

  // Pick one primary scenario per required case key
  const primaryByCaseKey = new Map();
  scenarios.forEach((sc, idx) => {
    const caseKey = getScenarioCaseKey(sc);
    if (!requiredMap.has(caseKey)) return;
    const prevIdx = primaryByCaseKey.get(caseKey);
    if (prevIdx === undefined || isPrimaryBetter(sc, scenarios[prevIdx])) {
      primaryByCaseKey.set(caseKey, idx);
    }
  });

  const primaryIndexSet = new Set(primaryByCaseKey.values());
  let redundantCount = 0;
  let extraCount = 0;

  const annotations = scenarios.map((sc, idx) => {
    const caseKey = getScenarioCaseKey(sc);
    const reqDef = requiredMap.get(caseKey);
    const passed = isScenarioPassed(sc);
    const failed = isScenarioFailed(sc);

    if (reqDef) {
      if (primaryIndexSet.has(idx)) {
        return {
          caseKey,
          caseLabel: reqDef.label,
          isRequiredCase: true,
          isPrimaryMatch: true,
          role: passed ? "MATCHED_PASS" : failed ? "MATCHED_FAIL" : "MATCHED_PENDING",
        };
      }
      redundantCount++;
      return {
        caseKey,
        caseLabel: reqDef.label,
        isRequiredCase: true,
        isPrimaryMatch: false,
        role: "DUPLICATE",
      };
    }

    extraCount++;
    return {
      caseKey,
      caseLabel: CASE_DEFINITIONS[caseKey]?.label || caseKey,
      isRequiredCase: false,
      isPrimaryMatch: false,
      role: "OPTIONAL_EXTRA",
    };
  });

  return { annotations, redundantCount, extraCount };
}

/**
 * Evaluate whether an endpoint's scenarios cover and pass all required contract cases.
 */
export function getEndpointCaseCoverage(ep, scenarios = []) {
  const requiredCases = getEndpointRequiredCases(ep);
  const coveredKeys = new Set();
  const passedKeys = new Set();
  const failedKeys = new Set();
  let passedCount = 0;
  let failedCount = 0;

  for (const sc of scenarios) {
    const caseKey = getScenarioCaseKey(sc);
    const title = (sc?.title || sc?.name || sc?.testName || "").toLowerCase();
    const exp = Number(sc?.expectedStatus || 0);
    const matchedKeys = new Set([caseKey]);

    // Also credit secondary explicit boundary/status cues only when unambiguous
    if (
      exp >= 500 ||
      /boundary|edge|limit|empty|more than|fewer than|giới hạn|ngoại lệ|rỗng|tối đa|tối thiểu/.test(
        title,
      )
    ) {
      matchedKeys.add("EDGE");
    }

    for (const k of matchedKeys) {
      coveredKeys.add(k);
    }

    if (isScenarioPassed(sc)) {
      passedCount++;
      for (const k of matchedKeys) {
        passedKeys.add(k);
      }
    } else if (isScenarioFailed(sc)) {
      failedCount++;
      for (const k of matchedKeys) {
        failedKeys.add(k);
      }
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
    annotateEndpointScenarios(ep, scenarios);

  return {
    cases,
    coveredCount,
    passedCasesCount,
    totalRequired: cases.length,
    missingCases: cases.filter((c) => !c.covered),
    unverifiedCases: cases.filter((c) => !c.passed),
    isComplete: cases.length > 0 && coveredCount === cases.length,
    isFullyVerified:
      cases.length > 0 &&
      passedCasesCount === cases.length &&
      failedCount === 0,
    passedCount,
    failedCount,
    notRunCount: Math.max(0, scenarios.length - passedCount - failedCount),
    scenarioAnnotations,
    redundantCount,
    extraCount,
  };
}

const VIETNAMESE_CHAR_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/**
 * Detect whether integration tests and API messages in the repository are written in Vietnamese or English.
 * Checks preserved user/project tests first, then falls back to source code strings/comments.
 * @returns {"vi" | "en"}
 */
export function detectIntegrationLanguage({
  existingScenarios = [],
  testFiles = [],
  sourceCode = [],
} = {}) {
  const scenarioTexts = (existingScenarios || [])
    .map((sc) => `${sc?.testName || sc?.title || sc?.name || ""} ${sc?.description || ""}`)
    .join(" ");
  if (VIETNAMESE_CHAR_REGEX.test(scenarioTexts)) {
    return "vi";
  }

  const nonAiTestContents = (testFiles || [])
    .filter((f) => typeof f?.content === "string" && !f.content.includes("[AI GENERATED]"))
    .map((f) => f.content)
    .join("\n");
  if (VIETNAMESE_CHAR_REGEX.test(nonAiTestContents)) {
    return "vi";
  }

  // Respect explicit existing non-AI tests written purely in English before checking source code comments
  if (existingScenarios.length > 0 || nonAiTestContents.trim().length > 0) {
    return "en";
  }

  const apiSourceSample = (sourceCode || [])
    .filter((f) => {
      const p = String(f?.path || f?.filePath || "").toLowerCase();
      return (
        p.includes("route") ||
        p.includes("controller") ||
        p.includes("service") ||
        p.endsWith("index.js") ||
        p.endsWith("app.js")
      );
    })
    .slice(0, 10)
    .map((f) => f.content || "")
    .join("\n");

  return VIETNAMESE_CHAR_REGEX.test(apiSourceSample) ? "vi" : "en";
}

/**
 * Strips ANSI color escape codes and summarizes verbose Jest / Supertest error logs
 * into a concise, human-readable root cause string.
 */
export function summarizeIntegrationFailure(rawInput, parsedFailure = null) {
  const rawJoined = Array.isArray(rawInput)
    ? rawInput.join("\n")
    : String(rawInput || "");
  const cleanText = rawJoined
    .replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\u001b/g, "")
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "")
    .trim();

  if (!cleanText) {
    return "Assertion or runtime failure during API test execution.";
  }

  if (/Cannot use import statement outside a module/i.test(cleanText)) {
    const fileMatch = cleanText.match(/([A-Za-z0-9_.\-/]+\.(?:test|spec)\.[cm]?[jt]s):(\d+)/);
    const loc = fileMatch ? ` (${fileMatch[1]}:${fileMatch[2]})` : "";
    return `Module syntax mismatch${loc}: Test uses ES module 'import' inside a CommonJS Jest runner (use require() or enable ESM).`;
  }

  const modNotFound = cleanText.match(/Cannot find module ['"]([^'"]+)['"]/i);
  if (modNotFound) {
    return `Missing module '${modNotFound[1]}': Check relative import path or install dependency.`;
  }

  const jsErrorMatch = cleanText.match(
    /(?:SyntaxError|TypeError|ReferenceError|RangeError):\s*([^\n\r]{1,180})/,
  );
  if (jsErrorMatch && !/expect\(/i.test(jsErrorMatch[0])) {
    return jsErrorMatch[0].trim();
  }

  if (
    parsedFailure?.expected &&
    parsedFailure?.received &&
    /^\d{3}$/.test(String(parsedFailure.expected).trim()) &&
    /^\d{3}$/.test(String(parsedFailure.received).trim())
  ) {
    return `HTTP status mismatch: Expected ${String(parsedFailure.expected).trim()}, got ${String(parsedFailure.received).trim()}.`;
  }

  const statusPair = cleanText.match(/Expected:\s*(\d{3})[\s\S]{0,60}?Received:\s*(\d{3})/i)
    || cleanText.match(/expected\s+(\d{3})\b[^,\n]*,\s*got\s+(\d{3})\b/i);
  if (statusPair) {
    return `HTTP status mismatch: Expected ${statusPair[1]}, got ${statusPair[2]}.`;
  }

  if (parsedFailure?.expected && parsedFailure?.received) {
    const expShort = String(parsedFailure.expected).replace(/\s+/g, " ").slice(0, 70);
    const recShort = String(parsedFailure.received).replace(/\s+/g, " ").slice(0, 70);
    return `Assertion mismatch: Expected ${expShort}, got ${recShort}.`;
  }

  if (/Exceeded timeout of \d+ ms|Timeout - Async callback/i.test(cleanText)) {
    return "Test timed out waiting for HTTP response or async operation.";
  }

  const meaningfulLines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^Test suite failed to run$/i.test(l) &&
        !/^Jest encountered an unexpected token/i.test(l) &&
        !/^Out of the box Jest supports/i.test(l) &&
        !/^Here's what you can do:/i.test(l) &&
        !/^Details:/i.test(l) &&
        !/^[•*-]\s/.test(l) &&
        !/^https?:\/\//.test(l) &&
        !/^at\s+/.test(l) &&
        !/^\d+\s*\|/.test(l),
    );

  const firstUseful = meaningfulLines[0] || cleanText.split("\n")[0];
  return firstUseful.length > 200 ? `${firstUseful.slice(0, 197)}...` : firstUseful;
}
