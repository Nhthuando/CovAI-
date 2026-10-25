import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { loadSourceCode } from "./aiContextBuilder.service.js";
import { extractValidEndpoints } from "./apiEndpointParser.service.js";
import { getBucket } from "../config/firebase.js";
import { extractTestRequests } from "./testSourceParser.service.js";
import { parseUnifiedCoverage } from "./unifiedCoverageEngine.service.js";
import {
  diagnoseApiFailureLayer,
  traceApiEndpointCoverage,
  buildApiCoverageReport,
} from "./apiCoverageTracer.service.js";

export {
  diagnoseApiFailureLayer,
  traceApiEndpointCoverage,
  buildApiCoverageReport,
};
import crypto from "crypto";

export const extractValidatedTestRequests = (t) => {
  let reqs = extractTestRequests(t.content, t.filePath);
  if (!t.metaJson) return reqs;
  try {
    const meta =
      typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
    if (meta?.requests && Array.isArray(meta.requests)) {
      const metaMap = new Map(meta.requests.map((r) => [r.testName, r]));
      const validNames = new Set(meta.requests.map((r) => r.testName));
      const filteredReqs = reqs
        .filter((r) => validNames.has(r.testName))
        .map((r) => {
          const mr = metaMap.get(r.testName);
          return {
            ...r,
            scenarioId: mr?.scenarioId || r.scenarioId,
            userEdited: Boolean(mr?.userEdited),
            origin:
              mr?.origin || (mr?.userEdited ? "USER_MODIFIED" : "AI_GENERATED"),
            createdAt: mr?.createdAt || null,
            lastModifiedAt: mr?.lastModifiedAt || null,
            originalTestName: mr?.originalTestName || null,
          };
        });
      const presentNames = new Set(filteredReqs.map((r) => r.testName));

      // Include any scenario in meta.requests (e.g. user-added or custom) that AST didn't capture
      for (const mr of meta.requests) {
        if (mr?.testName && !presentNames.has(mr.testName)) {
          filteredReqs.push({
            testName: mr.testName,
            suiteName: mr.suiteName || "Integration Test Suite",
            method: (mr.method || "GET").toUpperCase(),
            path: mr.path || "/",
            testFile: t.filePath,
            scenarioId: mr.scenarioId,
            enabled: mr.enabled !== false,
            userEdited: Boolean(mr.userEdited),
            origin:
              mr.origin || (mr.userEdited ? "USER_ADDED" : "AI_GENERATED"),
            createdAt: mr.createdAt || null,
            lastModifiedAt: mr.lastModifiedAt || null,
            originalTestName: mr.originalTestName || null,
            expectedStatus: mr.expectedStatus || 200,
          });
          presentNames.add(mr.testName);
        }
      }
      return filteredReqs;
    }
  } catch {}
  return reqs;
};

function categorizeScenario(name) {
  const lower = (name || "").toLowerCase();
  if (
    lower.includes("error") ||
    lower.includes("fail") ||
    lower.includes("invalid") ||
    lower.includes("missing") ||
    lower.includes("not found")
  )
    return "Negative";
  if (
    lower.includes("auth") ||
    lower.includes("token") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  )
    return "Security";
  if (
    lower.includes("edge") ||
    lower.includes("boundary") ||
    lower.includes("limit")
  )
    return "Edge Case";
  return "Positive";
}

export function parseFailureMessages(failureMessages, req = null) {
  if (
    !failureMessages ||
    (Array.isArray(failureMessages) && failureMessages.length === 0)
  ) {
    return null;
  }
  const text = Array.isArray(failureMessages)
    ? failureMessages.join("\n")
    : String(failureMessages);
  if (!text.trim()) return null;

  // Clean ANSI escape codes
  const cleanText = text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );

  const firstLine = cleanText.split("\n")[0] || "";
  const headline = firstLine.replace(/^Error:\s*/, "").trim();

  // 1. Extract Expected and Received
  let expected = null;
  let received = null;
  const expMatch = cleanText.match(
    /Expected:\s*([\s\S]*?)(?=\n\s*Received:|\n\s*at|\n\n|$)/,
  );
  const recMatch = cleanText.match(
    /Received:\s*([\s\S]*?)(?=\n\s*(?:at|\d+\s*\|)|\n\n|$)/,
  );
  if (expMatch && recMatch) {
    expected = expMatch[1].trim();
    received = recMatch[1].trim();
  } else {
    const diffMatches = [...cleanText.matchAll(/\n([+-])\s+([^\n\r]+)/g)];
    for (const m of diffMatches) {
      const sign = m[1];
      const val = m[2].trim();
      if (val.startsWith("Expected") || val.startsWith("Received")) continue;
      if (sign === "-" && !expected) expected = val;
      if (sign === "+" && !received) received = val;
    }
    if (!expected && req?.expectedStatus) {
      expected = String(req.expectedStatus);
    }
  }

  // 2. Extract Diff block (- Expected / + Received)
  const diffLines = [];
  const lines = cleanText.split("\n");
  let capturingDiff = false;
  for (const line of lines) {
    if (line.includes("- Expected") || line.includes("+ Received")) {
      capturingDiff = true;
    }
    if (capturingDiff) {
      if (
        line.trim().startsWith("-") ||
        line.trim().startsWith("+") ||
        line.trim().startsWith("Object") ||
        line.trim().startsWith("Array")
      ) {
        diffLines.push(line);
      } else if (line.includes("at Object") || line.includes("at ")) {
        capturingDiff = false;
      }
    }
  }

  // 3. Extract Code Snippet / Frame
  const snippetLines = [];
  let brokenLineText = null;
  for (const line of lines) {
    if (
      /^\s*\d+\s*\|/.test(line) ||
      /^\s*>\s*\d+\s*\|/.test(line) ||
      /^\s*\|\s*\^/.test(line)
    ) {
      snippetLines.push(line);
      if (/^\s*>\s*\d+\s*\|/.test(line)) {
        brokenLineText = line.replace(/^\s*>\s*\d+\s*\|\s*/, "").trim();
      }
    }
  }

  // 4. Extract Stack File & Line
  const stackMatch =
    cleanText.match(/at\s+.*?\((.*?):(\d+):(\d+)\)/) ||
    cleanText.match(/at\s+(.*?):(\d+):(\d+)/);
  const file = stackMatch ? stackMatch[1] : null;
  const lineNum = stackMatch ? parseInt(stackMatch[2], 10) : null;
  const colNum = stackMatch ? parseInt(stackMatch[3], 10) : null;

  return {
    headline: headline || "Test Assertion Failed",
    expected,
    received,
    diff: diffLines.length > 0 ? diffLines.join("\n") : null,
    codeSnippet: snippetLines.length > 0 ? snippetLines.join("\n") : null,
    brokenLineText,
    file,
    line: lineNum,
    column: colNum,
    raw: cleanText,
  };
}

const endpointCache = new Map();
const firebaseCache = new Map();
const aiTestParseCache = new Map(); // Structure: Map<snapshotId, Map<aiTestId, { updatedAt: number, requests: Array }>>

export const invalidateEndpointCache = (snapshotId, rootDir = null) => {
  endpointCache.delete(snapshotId);
  firebaseCache.delete(snapshotId);
  aiTestParseCache.delete(snapshotId);
  if (rootDir) {
    try {
      import("fs").then((fsModule) => {
        const fs = fsModule.default || fsModule;
        import("path").then((pathModule) => {
          const path = pathModule.default || pathModule;
          const cacheFile = path.join(
            rootDir,
            ".covai-temp",
            `endpoints-${snapshotId}.json`,
          );
          if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
          }
        });
      });
    } catch (e) {}
  }
};

export const isMatch = (parsedReq, discoveredEp) => {
  if (!parsedReq || !discoveredEp) return false;
  if (parsedReq.method?.toUpperCase() !== discoveredEp.method?.toUpperCase())
    return false;

  const cleanPath =
    (parsedReq.path || "").split("?")[0].replace(/\/+$/, "") || "/";
  const cleanRoute =
    (discoveredEp.fullPath || discoveredEp.path || "").replace(/\/+$/, "") ||
    "/";

  // 1. Root route "/" MUST match ONLY root path "/"
  if (cleanRoute === "/") {
    return cleanPath === "/";
  }
  if (cleanPath === "/") {
    return false;
  }

  // 2. Exact match
  if (cleanPath.toLowerCase() === cleanRoute.toLowerCase()) return true;

  // 3. Parameterized match: e.g. /api/food-items/get/:id matches /api/food-items/get/123 or /api/food-items/get/:param
  const regexStr = "^" + cleanRoute.replace(/:[^\/]+/g, "[^/]+") + "$";
  if (new RegExp(regexStr, "i").test(cleanPath)) return true;

  // 4. Subpath suffix match: only when cleanRoute has at least 2 segments and does not conflict
  if (
    cleanRoute.startsWith("/") &&
    cleanRoute.length > 2 &&
    cleanRoute.includes("/")
  ) {
    const routeSegments = cleanRoute.split("/").filter(Boolean);
    const pathSegments = cleanPath.split("/").filter(Boolean);
    if (
      pathSegments.length >= routeSegments.length &&
      routeSegments.length >= 2
    ) {
      const pathTail = pathSegments.slice(-routeSegments.length);
      const matchesTail = routeSegments.every((seg, idx) => {
        if (seg.startsWith(":")) return true;
        return seg.toLowerCase() === pathTail[idx].toLowerCase();
      });
      if (matchesTail) return true;
    }
  }

  return false;
};

export const isMatchSuite = (suiteName, title, ep) => {
  const suite = (suiteName || "").trim();
  const tName = (title || "").trim();
  const epMethod = ep.method.toUpperCase();
  const epPath = (ep.fullPath || ep.path || "").replace(/\/+$/, "") || "/";

  // STRICT MATCHING FOR ROOT ENDPOINT "/"
  if (epPath === "/") {
    if (epMethod !== "GET") return false;
    // Reject if suite or title mentions ANY specific subpath
    if (
      /\/(api|cart|food|payment|auth|user|order|item|items)/i.test(suite) ||
      /\/(api|cart|food|payment|auth|user|order|item|items)/i.test(tName)
    ) {
      return false;
    }
    return (
      /(?:^|[>\s])GET\s+\/(?:$|[\s>])/i.test(suite) ||
      /\b(ROOT\s+API|BASE\s+URL|ROOT\s+ENDPOINT)\b/i.test(suite) ||
      /\b(ROOT\s+ENDPOINT|BASE\s+URL)\b/i.test(tName)
    );
  }

  const methodRegex = new RegExp(`\\b${epMethod}\\b`, "i");
  const hasMethod = methodRegex.test(suite) || methodRegex.test(tName);
  if (!hasMethod) return false;

  // For other endpoints:
  const escapedPath = epPath
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:[^\/]+/g, "[^/\\s>]+");
  const pathRegex = new RegExp(`(?:^|[\\s>])${escapedPath}(?:$|[\\s>])`, "i");
  if (pathRegex.test(suite) || pathRegex.test(tName)) return true;

  if (epPath.includes(":")) {
    const prefix = epPath.split("/:")[0];
    const prefixRegex = new RegExp(
      `(?:^|[\\s>])${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/[^/\\s>]+|/\\:[^/\\s>]+)`,
      "i",
    );
    if (prefixRegex.test(suite) || prefixRegex.test(tName)) return true;
  }

  return false;
};

export function evaluateEndpointMetrics({
  executedCount = 0,
  passedCount = 0,
  failedCount = 0,
  testScriptErrorCount = 0,
  verifiedPassedCount = 0,
  verifiedAssertionFailedCount = 0,
  consistentPassedCount = 0,
  hasRelevantTestFile = false,
  hasObservedServerResponse = false,
} = {}) {
  const hasGenuineApiCall =
    executedCount > 0 &&
    (hasObservedServerResponse ||
      (passedCount > 0 && testScriptErrorCount < executedCount) ||
      failedCount > testScriptErrorCount);
  const isContractVerified =
    executedCount > 0 &&
    (verifiedPassedCount > 0 || verifiedAssertionFailedCount > 0);
  const isVerifiedTested = isContractVerified;
  const isImplementationConsistent =
    executedCount > 0 && consistentPassedCount > 0;

  let status = "Uncovered";
  if (executedCount > 0) {
    if (testScriptErrorCount === executedCount) {
      status = "Script Error";
    } else if (failedCount > 0) {
      status = "Partial";
    } else if (passedCount === executedCount) {
      status = "Covered";
    } else {
      status = "Partial";
    }
  } else {
    if (hasRelevantTestFile) {
      status = "Not Executed";
    } else {
      status = "Uncovered";
    }
  }

  return {
    hasGenuineApiCall,
    isVerifiedTested,
    isContractVerified,
    isImplementationConsistent,
    status,
    isExecuted: hasGenuineApiCall,
    isVerified: isContractVerified,
  };
}

export const classifyScenarioFailure = (scenario, parsedReq) => {
  const status = (scenario.status || "").toLowerCase();
  const title = (scenario.title || "").toLowerCase();
  const messages = Array.isArray(scenario.failureMessages)
    ? scenario.failureMessages
    : scenario.failureMessages
      ? [String(scenario.failureMessages)]
      : [];
  const rawText = messages.join("\n");
  const text = rawText.replace(/\u001b\[[0-9;]*m/g, "");

  const isStripeFailureTest =
    (title.includes("stripe") &&
      (title.includes("fail") || title.includes("error"))) ||
    title.includes("stripe fails");

  // 1. Check for CONTRACT_UNVERIFIED on passed tests:
  // If a test PASSED by asserting HTTP 500 for client input errors (such as malformed ID, invalid ID, non-existent ID, or missing required fields)
  // on endpoints without an explicit verified business contract requirement:
  if (status === "passed") {
    if (
      isStripeFailureTest &&
      (parsedReq?.expectedStatus === 200 || title.includes("200"))
    ) {
      return "INVALID_TEST"; // Contradictory: test named Stripe failure asserted HTTP 200 success
    }

    const pathLower = (parsedReq?.path || "").toLowerCase();
    const isClientInputError =
      title.includes("invalid") ||
      title.includes("malformed") ||
      title.includes("non-existent") ||
      title.includes("not-found") ||
      title.includes("not found") ||
      title.includes("missing") ||
      title.includes("fails to create") ||
      title.includes("database fails") ||
      pathLower.includes("invalid") ||
      pathLower.includes("99999") ||
      pathLower.includes("non-existent") ||
      pathLower.includes("not-found");
    const expects500 =
      title.includes("500") || parsedReq?.expectedStatus === 500;
    const isCrudOrDataEndpoint =
      pathLower.includes("update") ||
      pathLower.includes("delete") ||
      pathLower.includes("create") ||
      title.includes("update") ||
      title.includes("delete") ||
      title.includes("create") ||
      title.includes("payment");

    const titleClaimsHappy200 =
      title.includes("happy path") ||
      (title.includes("should return 200") &&
        !title.includes("error") &&
        !title.includes("fail"));
    const assertsNegative =
      parsedReq?.expectedStatus === 404 ||
      scenario?.expectedStatus === 404 ||
      (parsedReq?.expectedStatus && parsedReq.expectedStatus >= 400);
    if (titleClaimsHappy200 && assertsNegative) {
      return "CONTRACT_UNVERIFIED";
    }

    if (expects500 && (isClientInputError || isCrudOrDataEndpoint)) {
      return "CONTRACT_UNVERIFIED";
    }
    if (
      parsedReq?.contractSource === "UNVERIFIED" ||
      scenario?.contractSource === "UNVERIFIED"
    ) {
      return "CONTRACT_UNVERIFIED";
    }
    return "PASSED";
  }

  if (status === "pending" || status === "skipped") return "SKIPPED";
  if (status === "not_run") return "NOT_EXECUTED";

  // 2. TEST_SCRIPT_ERROR: Syntax, runtime, module load failure, or broken mock function in test script
  if (
    scenario?.isSuiteLevelFailure ||
    /TypeError|ReferenceError|SyntaxError/i.test(text) ||
    text.includes("is not a function") ||
    text.includes("mockResolvedValue") ||
    text.includes("mockRejectedValue") ||
    text.includes("Cannot read propert") ||
    text.includes("is not defined") ||
    text.includes("Cannot find module") ||
    text.includes("MODULE_NOT_FOUND") ||
    text.includes("ERR_MODULE_NOT_FOUND")
  ) {
    return "TEST_SCRIPT_ERROR";
  }

  // 3. INFRASTRUCTURE_FAILED: Timeout or abnormal process exit
  if (
    /timed out|exceeded timeout|process exited with code|terminated/i.test(text)
  ) {
    return "INFRASTRUCTURE_FAILED";
  }

  // 4. INVALID_TEST: Contradictory assertion, arbitrary/hallucinated third-party mock value,
  // provider failure claimed without triggering it, or hallucinated schema properties
  if (
    (text.includes('Expected path: "clientSecret"') &&
      text.includes('Expected value: "pi_') &&
      text.includes('Received value: "pi_')) ||
    (text.includes('Expected path: "url"') &&
      text.includes("checkout.stripe.com") &&
      text.includes("Received value:"))
  ) {
    return "INVALID_TEST"; // Assertion checked arbitrary/hallucinated mock token instead of verified contract schema/property
  }
  if (isStripeFailureTest) {
    const payloadAmount = parsedReq?.payload?.amount;
    const roundsToZero =
      typeof payloadAmount === "number" &&
      Math.round((payloadAmount / 23000) * 100) === 0;
    if (
      payloadAmount === null ||
      roundsToZero ||
      text.includes("amount") ||
      (text.includes("Expected: 500") && text.includes("Received: 200"))
    ) {
      return "INVALID_TEST"; // Input payload does not trigger an actual Stripe network/SDK failure (e.g. rounded to 0 or null)
    }
  }
  // Expected 500 when server gracefully handles parameter (e.g. page=invalid returns 200 with fallback)
  const hasQueryFallback =
    Boolean(
      parsedReq?.queryParams &&
      (parsedReq.queryParams.page === "invalid" ||
        Object.values(parsedReq.queryParams).some((v) => v === "invalid")),
    ) ||
    /page=invalid/i.test(title) ||
    /page=invalid/i.test(text) ||
    /page=invalid/i.test(parsedReq?.path || "") ||
    /page=-/i.test(title) ||
    /page=-/i.test(text);
  const isGenericServerErrorExpectation =
    title.includes("internal server error") ||
    title.includes("internal error") ||
    title.includes("fails") ||
    title.includes("500") ||
    hasQueryFallback;

  if (
    isGenericServerErrorExpectation &&
    text.includes("Expected: 500") &&
    (text.includes("Received: 200") ||
      text.includes("Received: 201") ||
      text.includes("Received: 204"))
  ) {
    return "INVALID_TEST"; // Assumed failure causes 500 when in-memory mock or backend resolved successfully
  }
  // Hallucinated schema property: test expected 'items' but backend contract returns 'data'
  if (
    text.includes('Expected path: "items"') &&
    (text.includes('"data"') ||
      title.includes("list food items") ||
      /food-items/i.test(scenario.suiteName || ""))
  ) {
    return "INVALID_TEST";
  }

  // 5. CONTRACT_UNVERIFIED for failed scenarios where expectation itself had no verified contract source
  if (
    parsedReq?.contractSource === "UNVERIFIED" ||
    scenario?.contractSource === "UNVERIFIED"
  ) {
    return "CONTRACT_UNVERIFIED";
  }

  // 6. ASSERTION_FAILED: Regular backend assertion discrepancy against verified contract
  return "ASSERTION_FAILED";
};

export const determineScenarioType = (title, expStatus, payload) => {
  const lower = (title || "").toLowerCase();
  // 1. Edge Case: empty cart, empty payload, fallback, boundaries
  if (
    lower.includes("empty cart") ||
    lower.includes("empty items") ||
    lower.includes("empty payload") ||
    lower.includes("fallback") ||
    lower.includes("defaulting") ||
    lower.includes("boundary") ||
    lower.includes("limit") ||
    (payload && Array.isArray(payload.items) && payload.items.length === 0)
  ) {
    return "EDGE_CASE";
  }
  // 2. Negative: not found, 404, non-existent, unauthorized, 401, 403, 500 error cases.
  // NOTE: If expStatus is 404 or resource not found, it is NEGATIVE testing, regardless of misleading "happy path" title prefix.
  if (
    expStatus === 404 ||
    lower.includes("not found") ||
    lower.includes("404") ||
    lower.includes("non-existent") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    expStatus === 401 ||
    expStatus === 403
  ) {
    return "NEGATIVE";
  }
  // 3. Validation: missing required fields, invalid query params, schema validation errors (400, 422)
  if (
    lower.includes("validation") ||
    lower.includes("missing") ||
    lower.includes("invalid query") ||
    expStatus === 400 ||
    expStatus === 422
  ) {
    return "VALIDATION";
  }
  if (
    lower.includes("error") ||
    lower.includes("fail") ||
    (expStatus && expStatus >= 400)
  ) {
    return "NEGATIVE";
  }
  // 4. Happy Path: explicitly named happy path, health check, success, create successfully
  if (
    lower.includes("happy path") ||
    lower.includes("health check") ||
    lower.includes("running text") ||
    lower.includes("running status") ||
    (lower.includes("should return 200") &&
      !lower.includes("error") &&
      !lower.includes("fail"))
  ) {
    return "HAPPY_PATH";
  }
  if (expStatus === 200 || expStatus === 201 || expStatus === 204) {
    return "HAPPY_PATH";
  }
  return "HAPPY_PATH";
};

export const getClassificationReason = (
  classification,
  scenario,
  parsedReq = null,
  failureDetails = null,
) => {
  switch (classification) {
    case "PASSED":
      return "Test passed with verified contract expectation.";
    case "CONTRACT_UNVERIFIED": {
      const title = (scenario?.title || "").toLowerCase();
      const payload = parsedReq?.payload || scenario?.requestPayload;
      const titleClaimsHappy =
        title.includes("happy path") ||
        (title.includes("should return 200") &&
          !title.includes("error") &&
          !title.includes("fail"));
      const assertsNegative =
        parsedReq?.expectedStatus === 404 ||
        scenario?.expectedStatus === 404 ||
        (parsedReq?.expectedStatus && parsedReq.expectedStatus >= 400);
      if (titleClaimsHappy && assertsNegative) {
        return "Scenario title claims happy path ('should return 200') but test assertion expects HTTP 404 (Not Found). Retained as CONTRACT_UNVERIFIED until fixture, assertion, and contract source are consistent.";
      }
      if (
        title.includes("database creation fails") ||
        (title.includes("create") &&
          payload &&
          Object.keys(payload).length === 0)
      ) {
        return "Payload is missing required non-nullable fields ('name', 'image', 'price', 'rating'), triggering Prisma validation/constraint error caught by controller returning 500. Classified as CONTRACT_UNVERIFIED because 500 is an unhandled server catch-all rather than verified API contract.";
      }
      if (title.includes("amount") || title.includes("payment")) {
        return "External boundary / invalid payment amount triggers catch-all 500. Retained as CONTRACT_UNVERIFIED without independent contract specification.";
      }
      if (
        title.includes("non-existent") ||
        title.includes("invalid-id") ||
        title.includes("99999")
      ) {
        return "Resource not found or invalid ID triggers catch-all 500 rather than standard 400/404. Retained as CONTRACT_UNVERIFIED without independent contract specification.";
      }
      return "HTTP 500 catch-all or unverified expectation without independent API contract evidence.";
    }
    case "ASSERTION_FAILED":
      return "Valid test with verified contract expectation, but backend returned unexpected response.";
    case "INVALID_TEST":
      return "Test assertion contradicted server fallback, hallucinated property name, or asserted arbitrary ungrounded mock value.";
    case "TEST_SCRIPT_ERROR":
      return "Runtime exception or broken mock syntax in test script.";
    case "INFRASTRUCTURE_FAILED":
      return "Test process timed out or terminated unexpectedly.";
    case "SKIPPED":
      return "Scenario was skipped during test execution.";
    case "NOT_EXECUTED":
      return "Scenario was generated but not executed.";
    default:
      return "Unknown classification.";
  }
};

/**
 * Evaluates whether a scenario meets the strict criteria for being contract-verified.
 * Requires an independent contract source (OpenAPI, Swagger, formal spec).
 * Controller implementation inference (CONTROLLER_SOURCE) CANNOT make a scenario contract-verified.
 */
export const isScenarioContractVerified = (s) => {
  return Boolean(
    s &&
    s.contractVerification === "VERIFIED" &&
    (s.status === "passed" ||
      s.rawJestStatus === "passed" ||
      s.executionVerdict === "PASS") &&
    s.testValidity === "VALID" &&
    s.expectedStatus != null &&
    s.contractSource !== "CONTROLLER_SOURCE" &&
    s.contractSource !== "UNVERIFIED" &&
    s.contractSource !== "UNVERIFIED_CATCH_ALL" &&
    s.contractSource !== "UNFOUNDED_EXPECTATION" &&
    s.contractSource !== "NOT_CAPTURED" &&
    s.contractSource !== "UNKNOWN" &&
    ((s.resolvedUrl && s.resolvedUrl !== "mappingUnavailable") ||
      s.urlTemplate),
  );
};

/**
 * Builds the data payload for the Integration Test workspace.
 * Re-extracts endpoints dynamically from source code and merges with Jest execution results.
 */
export const buildIntegrationWorkspace = async (snapshotId) => {
  const start = Date.now();

  const startDb = Date.now();
  // 1. Run all DB queries concurrently
  const [testRuns, coverageSummary, coverageFiles, aiTests, snapshot, jobs] =
    await Promise.all([
      prisma.testRun.findMany({
        where: { snapshotId, type: { in: ["SUPERTEST", "PLAYWRIGHT_API"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { scenarios: true },
      }),
      prisma.coverageSummary.findUnique({ where: { snapshotId } }),
      prisma.coverageFile.findMany({ where: { snapshotId } }),
      prisma.aiTest.findMany({ where: { snapshotId } }),
      prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { storagePath: true, rootDir: true },
      }),
      prisma.job.findMany({
        where: { snapshotId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          errorMessage: true,
        },
      }),
    ]);
  const dbTime = Date.now() - startDb;
  const latestRun = (testRuns && testRuns[0]) || null;
  const analyzeJob = (jobs || []).find((j) => j.type === "ANALYSIS");
  const generateJob = (jobs || []).find((j) => j.type === "AI_TESTS");
  const executeJob = (jobs || []).find(
    (j) =>
      j.type === "SUPERTEST_COVERAGE" ||
      j.type === "COVERAGE_PIPELINE" ||
      j.type === "RUN_TESTS" ||
      j.type === "SYSTEM_TEST_ANALYSIS" ||
      j.type === "PLAYWRIGHT_SYSTEM_TEST" ||
      j.type === "CYPRESS_SYSTEM_TEST",
  );

  // 2. Load API Endpoints (Cached by snapshotId in memory and fs)
  const startAst = Date.now();
  let discoveredEndpointsCache = endpointCache.get(snapshotId);
  let discoveredEndpoints = [];
  let sourceFilesCount = 0;
  let sourceTime = 0;

  if (!discoveredEndpointsCache) {
    // Try file cache
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;
    const cacheFile = snapshot?.rootDir
      ? path.join(
          snapshot.rootDir,
          ".covai-temp",
          `endpoints-${snapshotId}.json`,
        )
      : null;

    try {
      if (cacheFile && fs.existsSync(cacheFile)) {
        const fileData = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        discoveredEndpoints = fileData.discoveredEndpoints;
        sourceFilesCount = fileData.sourceFilesCount;
        endpointCache.set(snapshotId, {
          discoveredEndpoints,
          sourceFilesCount,
        });
        discoveredEndpointsCache = endpointCache.get(snapshotId);
      }
    } catch (e) {
      console.error("Failed to read endpoint cache file", e);
    }

    // Fallback to computing
    if (!discoveredEndpointsCache) {
      const startSource = Date.now();
      const sourceCode = await loadSourceCode(snapshotId).catch(() => []);
      sourceTime = Date.now() - startSource;
      sourceFilesCount = sourceCode.length;
      discoveredEndpoints = extractValidEndpoints(sourceCode);
      endpointCache.set(snapshotId, { discoveredEndpoints, sourceFilesCount });

      if (cacheFile) {
        try {
          if (!fs.existsSync(path.dirname(cacheFile))) {
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          }
          fs.writeFileSync(
            cacheFile,
            JSON.stringify({ discoveredEndpoints, sourceFilesCount }),
            "utf8",
          );
        } catch (e) {
          console.error("Failed to write endpoint cache file", e);
        }
      }
    }
  } else {
    sourceFilesCount = discoveredEndpointsCache.sourceFilesCount;
    discoveredEndpoints = discoveredEndpointsCache.discoveredEndpoints;
  }
  const astTime = Date.now() - startAst;

  // 3. Gather Scenarios (Cached by snapshotId + latestRun)
  const startFb = Date.now();
  let testScenarios = [];
  const executeFailedBeforeTests =
    executeJob &&
    executeJob.status === "FAILED" &&
    (!latestRun || latestRun.createdAt < executeJob.createdAt);
  const firebaseCacheKey = `${snapshotId}_${latestRun?.id || "none"}`;
  if (executeFailedBeforeTests) {
    // Current execution job failed before tests could execute; do not load stale prior scenarios
    testScenarios = [];
  } else if (firebaseCache.has(firebaseCacheKey)) {
    testScenarios = firebaseCache.get(firebaseCacheKey);
  } else if (latestRun?.scenarios?.length > 0) {
    // FAST PATH 1: Directly use scenarios already retrieved from PostgreSQL DB (0ms network)
    testScenarios = latestRun.scenarios.map((s) => ({
      title: s.title,
      suiteName: s.suiteName,
      status: s.status,
      actualStatus:
        s.actualStatus !== undefined
          ? s.actualStatus
          : s.actualStatusFromRuntime !== undefined
            ? s.actualStatusFromRuntime
            : s.responseStatus !== undefined
              ? s.responseStatus
              : null,
      actualStatusFromRuntime:
        s.actualStatusFromRuntime !== undefined
          ? s.actualStatusFromRuntime
          : s.actualStatus !== undefined
            ? s.actualStatus
            : s.responseStatus !== undefined
              ? s.responseStatus
              : null,
      responseStatus:
        s.responseStatus !== undefined
          ? s.responseStatus
          : s.actualStatusFromRuntime !== undefined
            ? s.actualStatusFromRuntime
            : s.actualStatus !== undefined
              ? s.actualStatus
              : null,
      duration: typeof s.duration === "number" ? s.duration : s.durationMs || 0,
      failureMessages: s.failureMessages || [],
      testFile: s.testFile || null,
    }));
    firebaseCache.set(firebaseCacheKey, testScenarios);
  } else {
    // FAST PATH 2: Check local disk (0ms network)
    let loadedFromDisk = false;
    if (snapshot?.rootDir) {
      const candidatePaths = [
        path.join(snapshot.rootDir, "coverage", "integration-scenarios.json"),
        path.join(
          snapshot.rootDir,
          ".covai-temp",
          "integration-scenarios.json",
        ),
      ];
      for (const cand of candidatePaths) {
        try {
          if (fs.existsSync(cand)) {
            testScenarios = JSON.parse(fs.readFileSync(cand, "utf8"));
            loadedFromDisk = true;
            break;
          }
        } catch {
          // ignore disk read error
        }
      }
    }

    // SLOW FALLBACK: Only if DB and local disk do not have scenarios, query Firebase Cloud Storage
    if (!loadedFromDisk && snapshot?.storagePath) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Firebase scenario check timed out")),
            2500,
          ),
        );
        const downloadPromise = (async () => {
          const file = getBucket().file(
            `${snapshot.storagePath}/integration-scenarios.json`,
          );
          const [exists] = await file.exists();
          if (exists) {
            const [content] = await file.download();
            return JSON.parse(content.toString("utf8"));
          }
          return null;
        })();

        const downloaded = await Promise.race([
          downloadPromise,
          timeoutPromise,
        ]);
        if (downloaded && Array.isArray(downloaded)) {
          testScenarios = downloaded;
        }
      } catch (e) {
        console.warn(
          "[IntegrationWorkspace] Firebase scenario fetch skipped or timed out:",
          e.message,
        );
      }
    }
    firebaseCache.set(firebaseCacheKey, testScenarios);
  }
  const fbTime = Date.now() - startFb;

  // 3.5 Load Runtime Execution Evidence
  let runtimeEvidences = [];
  if (snapshot?.rootDir) {
    const candidateEvPaths = [
      path.join(snapshot.rootDir, "coverage", "runtime-evidence.json"),
      path.join(snapshot.rootDir, ".covai-temp", "runtime-evidence.json"),
    ];
    for (const cand of candidateEvPaths) {
      try {
        if (fs.existsSync(cand)) {
          const parsed = JSON.parse(fs.readFileSync(cand, "utf8"));
          if (Array.isArray(parsed) && parsed.length > 0) {
            runtimeEvidences = parsed;
            break;
          }
        }
      } catch (_) {}
    }
  }

  if (runtimeEvidences.length === 0 && snapshot?.storagePath) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Firebase runtime-evidence check timed out")),
          2500,
        ),
      );
      const downloadPromise = (async () => {
        const file = getBucket().file(
          `${snapshot.storagePath}/runtime-evidence.json`,
        );
        const [exists] = await file.exists();
        if (exists) {
          const [content] = await file.download();
          return JSON.parse(content.toString("utf8"));
        }
        return null;
      })();
      const downloaded = await Promise.race([downloadPromise, timeoutPromise]);
      if (downloaded && Array.isArray(downloaded)) {
        runtimeEvidences = downloaded;
      }
    } catch (e) {
      // non-fatal
    }
  }

  // Isolate runtime evidence to the active testRun to prevent mixing historical runs
  if (latestRun?.id && Array.isArray(runtimeEvidences)) {
    runtimeEvidences = runtimeEvidences.filter(
      (ev) => !ev.testRunId || ev.testRunId === latestRun.id,
    );
  }

  // We filter only SUPERTEST framework tests
  const integrationTests = aiTests.filter((t) => {
    if (!t.metaJson) return false;
    try {
      const meta =
        typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
      return (
        meta.framework === "SUPERTEST" || meta.framework === "PLAYWRIGHT_API"
      );
    } catch {
      return false;
    }
  });

  // 5.5 Load Unified Coverage and Trace API Coverage
  let fileCoverageMap = {};
  if (snapshot?.rootDir) {
    const candidateCovPaths = [
      path.join(snapshot.rootDir, "coverage", "coverage-final.json"),
      path.join(snapshot.rootDir, ".covai-temp", "coverage-final.json"),
    ];
    for (const cp of candidateCovPaths) {
      try {
        if (fs.existsSync(cp)) {
          const parsed = parseUnifiedCoverage(cp, snapshot.rootDir);
          if (parsed && parsed.files) {
            fileCoverageMap = parsed.files;
            break;
          }
        }
      } catch (_) {}
    }
  }

  let sourceCodeList = [];
  try {
    sourceCodeList = await loadSourceCode(snapshotId);
  } catch (_) {}

  const apiTraceResult = traceApiEndpointCoverage({
    endpoints: discoveredEndpoints,
    fileCoverageMap,
    sourceCode: sourceCodeList,
  });

  const endpointTraceMap = new Map();
  if (apiTraceResult?.endpointsTraceability) {
    for (const item of apiTraceResult.endpointsTraceability) {
      endpointTraceMap.set(
        `${(item.method || "").toUpperCase()} ${item.path}`,
        item,
      );
    }
  }

  // 6. Map Endpoints
  // Parse all integration tests to extract Supertest calls (using AST cache)
  const startTestParse = Date.now();
  let snapshotParseCache = aiTestParseCache.get(snapshotId);
  if (!snapshotParseCache) {
    snapshotParseCache = new Map();
    aiTestParseCache.set(snapshotId, snapshotParseCache);
  }

  // Precompute parsed integration tests once for all endpoints
  const parsedTests = integrationTests.map((t) => {
    const currentVersionKey = crypto
      .createHash("md5")
      .update((t.content || "") + "::" + (t.metaJson || ""))
      .digest("hex");
    let requests;
    const cacheEntry = snapshotParseCache.get(t.id);

    if (cacheEntry && cacheEntry.versionKey === currentVersionKey) {
      requests = cacheEntry.requests;
    } else {
      const tMeta =
        (typeof t.metaJson === "string"
          ? JSON.parse(t.metaJson)
          : t.metaJson) || {};
      requests = extractValidatedTestRequests(t).map((r) => {
        const metaReq = tMeta.requests
          ? tMeta.requests.find(
              (mr) =>
                (mr.scenarioId &&
                  (mr.scenarioId === r.scenarioId || mr.scenarioId === r.id)) ||
                mr.testName === r.testName,
            )
          : null;
        const fallbackId = crypto
          .createHash("md5")
          .update(r.testName)
          .digest("hex")
          .substring(0, 8);
        const scenarioId = metaReq?.scenarioId || fallbackId;
        return {
          ...r,
          testId: t.id,
          scenarioId,
          id: `${t.id}::${scenarioId}`,
          userEdited: metaReq
            ? Boolean(metaReq.userEdited)
            : Boolean(r.userEdited),
          origin:
            metaReq?.origin ||
            r.origin ||
            (metaReq?.userEdited ? "USER_MODIFIED" : "AI_GENERATED"),
          createdAt: metaReq?.createdAt || r.createdAt || null,
          lastModifiedAt: metaReq?.lastModifiedAt || r.lastModifiedAt || null,
          originalTestName:
            metaReq?.originalTestName || r.originalTestName || null,
        };
      });
      snapshotParseCache.set(t.id, { versionKey: currentVersionKey, requests });
    }

    let meta = null;
    if (t.metaJson) {
      try {
        meta =
          typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
      } catch {}
    }

    let approvedReqs = [];
    if (meta?.status === "APPROVED") {
      const approvedSet = new Set(meta.approvedScenarios || []);
      const metaReqsMap = new Map(
        (meta.requests || []).map((mr) => [mr.testName, mr.scenarioId]),
      );
      approvedReqs =
        meta.approvedScenarios && meta.approvedScenarios.length > 0
          ? requests.filter(
              (r) =>
                approvedSet.has(r.testName) ||
                (metaReqsMap.has(r.testName) &&
                  approvedSet.has(metaReqsMap.get(r.testName))),
            )
          : requests;
    }

    return {
      test: t,
      requests,
      approvedReqs,
    };
  });

  const allParsedRequests = [];
  parsedTests.forEach((pt) => allParsedRequests.push(...pt.requests));

  // Cleanup deleted aiTests to prevent memory leak
  const currentTestIds = new Set(integrationTests.map((t) => t.id));
  for (const cachedId of snapshotParseCache.keys()) {
    if (!currentTestIds.has(cachedId)) {
      snapshotParseCache.delete(cachedId);
    }
  }

  const testParseTime = Date.now() - startTestParse;

  const enrichedScenarios = testScenarios.map((s) => {
    let matchingRequests = allParsedRequests.filter(
      (pr) =>
        pr.testName === s.title &&
        (s.suiteName?.includes(pr.suiteName) ||
          pr.suiteName?.includes(s.suiteName) ||
          s.suiteName === pr.suiteName),
    );
    if (matchingRequests.length === 0 && s.scenarioId) {
      matchingRequests = allParsedRequests.filter(
        (pr) => pr.scenarioId === s.scenarioId,
      );
    }
    if (matchingRequests.length === 0 && s.title) {
      matchingRequests = allParsedRequests.filter(
        (pr) => pr.testName === s.title,
      );
    }
    return {
      ...s,
      requests: matchingRequests,
    };
  });

  let testedApis = 0;
  let executedApis = 0;
  let verifiedTestedApis = 0;
  let implementationConsistentApis = 0;
  let uncoveredApis = 0;
  let notExecutedApis = 0;

  const endpoints = discoveredEndpoints.map((ep) => {
    const controllerCoverage = coverageFiles.find(
      (cf) =>
        cf.filePath === ep.sourceFile || cf.filePath?.endsWith(ep.sourceFile),
    );
    const epKey = `${(ep.method || "").toUpperCase()} ${ep.fullPath || ep.path}`;
    const epTrace =
      endpointTraceMap.get(epKey) ||
      endpointTraceMap.get(`${(ep.method || "").toUpperCase()} ${ep.path}`) ||
      null;

    // Multi-level mapping with strict precedence:
    // 1. If scenario has extracted AST requests, ONLY use verified request matching
    // 2. Fallback to suite/title textual matching ONLY when no AST request was found
    const mappedScenarios = enrichedScenarios.filter((s) => {
      if (s.requests && s.requests.length > 0) {
        const matchesEp = s.requests.some((req) => isMatch(req, ep));
        if (!matchesEp) return false;
        // If suite explicitly defines a single HTTP method, do not cross-attribute to another method
        const suite = (s.suiteName || "").toUpperCase();
        const epMethod = ep.method.toUpperCase();
        const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
        const suiteMethods = methods.filter((m) =>
          new RegExp(`\\b${m}\\b`).test(suite),
        );
        if (suiteMethods.length === 1 && suiteMethods[0] !== epMethod) {
          return false;
        }
        return true;
      }
      return isMatchSuite(s.suiteName, s.title, ep);
    });

    const executedCount = mappedScenarios.length; // From the executed scenarios file in Firebase / latestRun
    const passedCount = mappedScenarios.filter(
      (s) => s.status === "passed",
    ).length;
    const failedCount = mappedScenarios.filter(
      (s) => s.status === "failed",
    ).length;
    const skippedCount = mappedScenarios.filter(
      (s) => s.status === "pending" || s.status === "skipped",
    ).length;

    const executedDurations = mappedScenarios.map(
      (s) => s.duration || s.durationMs || 0,
    );
    const totalDurationMs = executedDurations.reduce((acc, d) => acc + d, 0);
    const avgDurationMs =
      executedCount > 0 ? Math.round(totalDurationMs / executedCount) : 0;
    const minDurationMs =
      executedCount > 0 ? Math.min(...executedDurations) : 0;
    const maxDurationMs =
      executedCount > 0 ? Math.max(...executedDurations) : 0;

    let latencyStatus = "NORMAL";
    if (avgDurationMs > 0 && avgDurationMs < 80) {
      latencyStatus = "FAST";
    } else if (avgDurationMs > 250) {
      latencyStatus = "SLOW";
    }

    // Combine executed scenarios with unexecuted generated scenarios for this endpoint
    const allScenariosForEndpoint = [...mappedScenarios];
    const executedTitles = new Set(mappedScenarios.map((s) => s.title));
    const epGeneratedRequests = allParsedRequests.filter((req) =>
      isMatch(req, ep),
    );
    for (const genReq of epGeneratedRequests) {
      if (!executedTitles.has(genReq.testName)) {
        allScenariosForEndpoint.push({
          id:
            genReq.id ||
            `${genReq.testId}::${genReq.scenarioId || genReq.testName}`,
          scenarioId: genReq.scenarioId,
          testId: genReq.testId,
          title: genReq.testName,
          suiteName: genReq.suiteName || "",
          status: "not_run",
          duration: 0,
          durationMs: 0,
          failureMessages: [],
          requests: [genReq],
        });
        executedTitles.add(genReq.testName);
      }
    }

    const cleanScenarios = allScenariosForEndpoint.map(
      ({ requests, ...rest }) => {
        const req = requests
          ? requests.find((r) => isMatch(r, ep)) || requests[0]
          : null;
        const parsedFailure =
          rest.status === "failed" ||
          (rest.failureMessages && rest.failureMessages.length > 0)
            ? parseFailureMessages(rest.failureMessages, req)
            : null;
        const scDuration = rest.duration || rest.durationMs || 0;

        const expectedFromFailure =
          parsedFailure?.expected &&
          /^\d{3}$/.test(String(parsedFailure.expected).trim())
            ? Number(parsedFailure.expected)
            : null;
        const expectedFromTitle = rest.title.match(
          /(?:should return|returns?|status|mong đợi|kỳ vọng)\s*[:=]?\s*(\d{3})/i,
        )
          ? Number(
              rest.title.match(
                /(?:should return|returns?|status|mong đợi|kỳ vọng)\s*[:=]?\s*(\d{3})/i,
              )[1],
            )
          : null;
        const expectedStatus =
          req?.expectedStatus !== undefined && req?.expectedStatus !== null
            ? req.expectedStatus
            : expectedFromFailure || expectedFromTitle;

        const failureDiagnostics =
          rest.status === "failed"
            ? diagnoseApiFailureLayer({
                endpoint: ep,
                scenario: {
                  ...rest,
                  actualStatus:
                    rest.actualStatus !== undefined ? rest.actualStatus : null,
                  expectedStatus: expectedStatus,
                },
                failureMessages: rest.failureMessages || [],
                fileCoverageMap,
                sourceCode: sourceCodeList,
              })
            : null;
        const classification = classifyScenarioFailure(rest, req);
        const classificationReason = getClassificationReason(
          classification,
          rest,
          req,
          parsedFailure,
        );

        // Match runtime evidence items for this scenario title
        const scenarioTitleLower = (rest.title || "").trim().toLowerCase();
        const matchingEvidences = runtimeEvidences.filter((ev) => {
          const evTitle = (ev.testTitle || "").trim().toLowerCase();
          return (
            evTitle === scenarioTitleLower ||
            evTitle.endsWith(scenarioTitleLower) ||
            scenarioTitleLower.endsWith(evTitle) ||
            evTitle.includes(scenarioTitleLower) ||
            scenarioTitleLower.includes(evTitle)
          );
        });

        // Disambiguate main request vs setup / teardown requests
        let mainEv = null;
        const setupRequests = [];
        const teardownRequests = [];

        if (matchingEvidences.length > 0) {
          const epMethod = ep.method.toUpperCase();
          const mainMatches = matchingEvidences.filter((ev) => {
            if ((ev.requestMethod || "").toUpperCase() !== epMethod)
              return false;
            return isMatch(
              {
                method: ev.requestMethod,
                path: ev.resolvedUrl || ev.requestUrl,
              },
              ep,
            );
          });

          if (mainMatches.length > 0) {
            mainEv = mainMatches[mainMatches.length - 1];
          } else {
            mainEv = matchingEvidences[0];
          }

          for (const ev of matchingEvidences) {
            if (ev === mainEv) continue;
            const reqSummary = {
              requestMethod: ev.requestMethod,
              requestUrl: ev.requestUrl,
              resolvedUrl: ev.resolvedUrl,
              actualStatusFromRuntime: ev.actualStatusFromRuntime,
              capturedAt: ev.capturedAt,
              durationMs: ev.durationMs,
              evidenceSource: "TEST_SERVER_HTTP_RESPONSE",
            };
            const isBefore =
              mainEv.capturedAt &&
              ev.capturedAt &&
              new Date(ev.capturedAt) < new Date(mainEv.capturedAt);
            const isCreateOrSeed =
              ev.requestMethod === "POST" && ep.method !== "POST";
            if (isBefore || isCreateOrSeed) {
              setupRequests.push({
                ...reqSummary,
                purpose: "SETUP_FIXTURE_SEEDING",
                fixtureSource: "createRes.body.id",
              });
            } else {
              teardownRequests.push({
                ...reqSummary,
                purpose: "TEARDOWN_CLEANUP",
              });
            }
          }
        }

        // HTTP Response Evidence: captured directly from in-process test server agent
        let actualStatus = null;
        let actualStatusFromRuntime = null;
        let evidenceSource = "NOT_CAPTURED";
        let evidenceCapturedAt = null;

        if (
          parsedFailure?.received &&
          /^\d{3}$/.test(parsedFailure.received.trim())
        ) {
          actualStatus = Number(parsedFailure.received.trim());
          actualStatusFromRuntime = Number(parsedFailure.received.trim());
          evidenceSource = "TEST_RUNNER_ASSERTION_CAPTURE";
        } else if (
          mainEv &&
          mainEv.actualStatusFromRuntime !== undefined &&
          mainEv.actualStatusFromRuntime !== null
        ) {
          actualStatus = Number(mainEv.actualStatusFromRuntime);
          actualStatusFromRuntime = Number(mainEv.actualStatusFromRuntime);
          evidenceSource = "TEST_SERVER_HTTP_RESPONSE";
          evidenceCapturedAt = mainEv.capturedAt;
        } else if (
          rest.actualStatus !== undefined &&
          rest.actualStatus !== null
        ) {
          actualStatus = Number(rest.actualStatus);
          actualStatusFromRuntime = Number(rest.actualStatus);
          evidenceSource = "TEST_SERVER_HTTP_RESPONSE";
        } else if (
          rest.actualStatusFromRuntime !== undefined &&
          rest.actualStatusFromRuntime !== null
        ) {
          actualStatus = Number(rest.actualStatusFromRuntime);
          actualStatusFromRuntime = Number(rest.actualStatusFromRuntime);
          evidenceSource = "TEST_SERVER_HTTP_RESPONSE";
        } else if (
          rest.responseStatus !== undefined &&
          rest.responseStatus !== null
        ) {
          actualStatus = Number(rest.responseStatus);
          actualStatusFromRuntime = Number(rest.responseStatus);
          evidenceSource = "TEST_SERVER_HTTP_RESPONSE";
        }

        // DO NOT assign VERIFIED_CONTRACT when there is no traceable contract source.
        let contractSource = req?.contractSource || null;
        if (!contractSource) {
          if (classification === "CONTRACT_UNVERIFIED") {
            contractSource = "UNVERIFIED_CATCH_ALL";
          } else if (classification === "INVALID_TEST") {
            contractSource = "UNFOUNDED_EXPECTATION";
          } else if (classification === "TEST_SCRIPT_ERROR") {
            contractSource = "SCRIPT_ERROR";
          } else if (classification === "PASSED") {
            contractSource = "CONTROLLER_SOURCE";
          } else {
            contractSource = "NOT_CAPTURED";
          }
        }

        const sType = determineScenarioType(
          rest.title,
          expectedStatus,
          req?.payload,
        );
        const executionVerdict =
          rest.status === "passed"
            ? "PASS"
            : rest.status === "failed"
              ? classification === "TEST_SCRIPT_ERROR"
                ? "SCRIPT_ERROR"
                : classification === "INFRASTRUCTURE_FAILED"
                  ? "INFRA_FAILED"
                  : "FAIL"
              : rest.status === "pending" || rest.status === "skipped"
                ? "SKIPPED"
                : "NOT_EXECUTED";

        const testValidity =
          classification === "TEST_SCRIPT_ERROR"
            ? "TEST_SCRIPT_ERROR"
            : classification === "INVALID_TEST"
              ? "INVALID_TEST"
              : classification === "INFRASTRUCTURE_FAILED"
                ? "INFRASTRUCTURE_ERROR"
                : "VALID";

        // Independent traceable API contract sources (OpenAPI, Swagger, formal contract specs)
        const independentContractSources = [
          "OPENAPI_SPEC",
          "SWAGGER_DOC",
          "FORMAL_SPEC",
          "API_CONTRACT_SCHEMA",
        ];
        const isContractIndependent = Boolean(
          contractSource && independentContractSources.includes(contractSource),
        );
        const contractVerification = isContractIndependent
          ? "VERIFIED"
          : "UNVERIFIED";

        let contractEvidence = null;
        if (isContractIndependent) {
          contractEvidence =
            req?.contractEvidence ||
            `Traceable contract specification (${contractSource})`;
        } else if (contractSource === "CONTROLLER_SOURCE") {
          contractEvidence = `Inferred from controller implementation (${ep.controllerFile ? ep.controllerFile.split(/[\/\\]/).pop() : "controller"}). No independent OpenAPI/Swagger contract specification found.`;
        } else if (contractSource === "UNVERIFIED_CATCH_ALL") {
          contractEvidence =
            "Generic HTTP 500 catch-all without independent REST error contract.";
        } else {
          contractEvidence =
            classificationReason || "Unverified contract expectation.";
        }

        // Implementation Consistency dimension
        let implementationConsistency = "UNVERIFIED";
        if (testValidity === "VALID") {
          if (rest.status === "passed" && classification === "PASSED") {
            implementationConsistency = "CONSISTENT";
          } else if (
            rest.status === "failed" &&
            classification === "ASSERTION_FAILED"
          ) {
            implementationConsistency = "INCONSISTENT";
          } else if (
            rest.status === "passed" &&
            classification === "CONTRACT_UNVERIFIED"
          ) {
            // Passed against backend catch-all, but unverified business contract
            implementationConsistency = "CONSISTENT";
          }
        }

        const rawReqPath = req?.path || ep.fullPath || ep.path;
        const isFixtureIdVariable =
          /\/(seededId|deleteId|foodId|tempId)$/i.test(rawReqPath) ||
          /\/:param$/i.test(rawReqPath);
        const isLiteralId = /\/\d+$/.test(rawReqPath);
        const hasQueryParams = rawReqPath.includes("?");

        let urlTemplate = ep.fullPath || ep.path;
        let resolvedUrl = null;
        let resolutionSource = "STATIC_ROUTE";

        if (mainEv && mainEv.resolvedUrl) {
          urlTemplate = ep.fullPath || ep.path;
          resolvedUrl = mainEv.resolvedUrl;
          resolutionSource = isFixtureIdVariable
            ? "RUNTIME_FIXTURE_RESPONSE (createRes.body.id)"
            : isLiteralId
              ? "STATIC_LITERAL_ID"
              : "RUNTIME_RESOLVED_ROUTE";
        } else if (isFixtureIdVariable) {
          urlTemplate = ep.fullPath || ep.path;
          resolvedUrl = null; // Uninstrumented runtime socket: NOT_CAPTURED
          resolutionSource = "RUNTIME_FIXTURE_RESPONSE (createRes.body.id)";
        } else if (isLiteralId) {
          urlTemplate = ep.fullPath || ep.path;
          resolvedUrl = rawReqPath;
          resolutionSource = "STATIC_LITERAL_ID";
        } else if (hasQueryParams) {
          urlTemplate = `${ep.fullPath || ep.path}?${rawReqPath.split("?")[1].replace(/=[^&]+/g, "=:param")}`;
          resolvedUrl = rawReqPath;
          resolutionSource = "STATIC_QUERY_STRING";
        } else {
          urlTemplate = rawReqPath;
          resolvedUrl = rawReqPath;
          resolutionSource = "STATIC_ROUTE";
        }

        const requestMethod = req?.method || ep.method;
        const statusAssertion =
          rest.status === "passed"
            ? "PASS"
            : rest.status === "failed"
              ? "FAIL"
              : "NOT_EVALUATED";

        const statusAssertionResult = statusAssertion;

        const assertionResult =
          rest.status === "passed"
            ? `Passed${actualStatus ? ` (HTTP ${actualStatus})` : ""}`
            : `Failed (${parsedFailure?.headline || "Status mismatch"})`;

        const structuredEvidence = {
          testRunId: mainEv?.testRunId || latestRun?.id || null,
          scenarioId: mainEv?.scenarioId || rest.id || null,
          requestMethod: mainEv?.requestMethod || requestMethod,
          requestUrl: mainEv?.requestUrl || rawReqPath,
          requestUrlTemplate: urlTemplate,
          resolvedUrl: resolvedUrl,
          expectedStatus: expectedStatus,
          actualStatusFromRuntime: actualStatusFromRuntime,
          statusAssertionResult: statusAssertionResult,
          runnerVerdict: executionVerdict,
          capturedAt: evidenceCapturedAt || mainEv?.capturedAt || null,
          evidenceSource: evidenceSource,
          durationMs: mainEv?.durationMs || scDuration,
        };

        return {
          ...rest,
          targetEndpoint: `${ep.method.toUpperCase()} ${ep.fullPath || ep.path}`,
          failureLayer:
            failureDiagnostics?.failureLayer ||
            (rest.status === "failed" ? "ASSERTION_FAILED" : null),
          failureDiagnostics: failureDiagnostics || null,
          isFaultyExistingTest: Boolean(
            rest.isFaultyExistingTest ||
            (rest.status === "failed" &&
              (!rest.origin || !rest.origin.includes("AI_GENERATED"))) ||
            classification === "INVALID_TEST" ||
            classification === "TEST_SCRIPT_ERROR",
          ),
          rawJestStatus: rest.status,
          scenarioType: sType,
          executionVerdict,
          testValidity,
          contractVerification,
          implementationConsistency,
          urlTemplate,
          requestUrlTemplate: urlTemplate,
          resolvedUrl,
          resolutionSource,
          statusAssertion,
          statusAssertionResult,
          requestMethod,
          assertionResult,
          category:
            sType === "HAPPY_PATH"
              ? "Happy Path"
              : sType === "VALIDATION"
                ? "Validation"
                : sType === "NEGATIVE"
                  ? "Negative"
                  : "Edge Case",
          classification,
          qaClassification: classification,
          classificationReason,
          contractSource,
          contractEvidence,
          durationMs: scDuration,
          requestPayload: req?.payload || null,
          queryParams: req?.queryParams || null,
          expectedStatus,
          actualStatus,
          actualStatusFromRuntime,
          evidenceSource,
          capturedAt: evidenceCapturedAt,
          runtimeEvidence: structuredEvidence,
          setupRequests,
          teardownRequests,
          failureDetails: parsedFailure,
        };
      },
    );

    const unexecutedCount = allScenariosForEndpoint.filter(
      (s) => s.status === "not_run",
    ).length;
    const testScriptErrorCount = cleanScenarios.filter(
      (s) => s.classification === "TEST_SCRIPT_ERROR",
    ).length;

    const verifiedPassedCount = cleanScenarios.filter(
      isScenarioContractVerified,
    ).length;
    const verifiedAssertionFailedCount = cleanScenarios.filter(
      (s) =>
        s.contractVerification === "VERIFIED" &&
        s.classification === "ASSERTION_FAILED",
    ).length;
    const consistentPassedCount = cleanScenarios.filter(
      (s) => s.implementationConsistency === "CONSISTENT",
    ).length;
    const invalidOrUnverifiedCount = cleanScenarios.filter(
      (s) =>
        s.classification === "INVALID_TEST" ||
        s.classification === "CONTRACT_UNVERIFIED",
    ).length;
    const hasRelevantTestFile = parsedTests.some((pt) =>
      pt.requests.some((r) => isMatch(r, ep)),
    );
    const hasObservedServerResponse = cleanScenarios.some(
      (s) =>
        s.evidenceSource === "TEST_SERVER_HTTP_RESPONSE" ||
        (s.actualStatus !== null && s.actualStatus !== undefined) ||
        (s.actualStatusFromRuntime !== null &&
          s.actualStatusFromRuntime !== undefined),
    );
    const metrics = evaluateEndpointMetrics({
      executedCount,
      passedCount,
      failedCount,
      testScriptErrorCount,
      verifiedPassedCount,
      verifiedAssertionFailedCount,
      consistentPassedCount,
      hasRelevantTestFile,
      hasObservedServerResponse,
    });
    const hasGenuineApiCall = metrics.hasGenuineApiCall;
    const isVerifiedTested = metrics.isVerifiedTested;
    const isContractVerified = metrics.isContractVerified;
    const isImplementationConsistent = metrics.isImplementationConsistent;
    let status = metrics.status;

    if (executedCount > 0) {
      if (hasGenuineApiCall) {
        testedApis++;
        executedApis++;
      }
      if (isImplementationConsistent) {
        implementationConsistentApis++;
      }
      if (isVerifiedTested) {
        verifiedTestedApis++;
      }
    } else {
      if (hasRelevantTestFile) {
        notExecutedApis++;
      } else {
        uncoveredApis++;
      }
    }

    const generatedCount = parsedTests.reduce((acc, pt) => {
      return acc + pt.requests.filter((r) => isMatch(r, ep)).length;
    }, 0);

    const approvedCount = parsedTests.reduce((acc, pt) => {
      return acc + pt.approvedReqs.filter((r) => isMatch(r, ep)).length;
    }, 0);

    return {
      id: ep.id || `${ep.method}:${ep.fullPath}`,
      method: ep.method,
      path: ep.fullPath,
      route: ep.fullPath,
      status,
      testCount: executedCount, // Legacy for UI if needed
      executedCount,
      passedCount,
      failedCount,
      skippedCount: mappedScenarios.filter((s) => s.status === "pending")
        .length,
      unexecutedCount,
      testScriptErrorCount,
      verifiedPassedCount,
      verifiedAssertionFailedCount,
      consistentPassedCount,
      invalidOrUnverifiedCount,
      hasGenuineApiCall,
      isVerifiedTested,
      isContractVerified,
      isImplementationConsistent,
      passRate: executedCount > 0 ? (passedCount / executedCount) * 100 : 0,
      durationMs: totalDurationMs,
      avgDurationMs,
      minDurationMs,
      maxDurationMs,
      latencyStatus,
      mappedCodeCoverage: epTrace
        ? {
            statement: controllerCoverage?.stmtsPct || epTrace.coveragePct,
            branch: controllerCoverage?.branchesPct || 0,
            function: controllerCoverage?.funcsPct || 0,
            line: epTrace.coveragePct,
            linesCovered: epTrace.coveredLinesCount,
            totalLines: epTrace.totalLinesCount,
            uncoveredLines: epTrace.uncoveredLines || [],
            missingBranches: epTrace.missingBranches || [],
            status: epTrace.status,
          }
        : controllerCoverage
          ? {
              statement: controllerCoverage.stmtsPct,
              branch: controllerCoverage.branchesPct,
              function: controllerCoverage.funcsPct,
              line: controllerCoverage.linesPct,
              status: controllerCoverage.linesPct > 0 ? "COVERED" : "UNCOVERED",
            }
          : null,
      lineCoverage: epTrace
        ? {
            status: epTrace.status,
            coveragePct: epTrace.coveragePct,
            coveredLinesCount: epTrace.coveredLinesCount,
            totalLinesCount: epTrace.totalLinesCount,
            uncoveredLines: epTrace.uncoveredLines || [],
            missingBranches: epTrace.missingBranches || [],
          }
        : null,
      source: {
        sourceFile: ep.sourceFile,
        sourceLine: ep.provenance?.sourceLine || ep.sourceLine || null,
        sourceLineStart: ep.sourceLineStart || ep.sourceLine || null,
        sourceLineEnd: ep.sourceLineEnd || ep.sourceLine || null,
        routeSnippet: ep.routeSnippet || null,
        controllerFile: ep.controllerFile || null,
        controllerLine: ep.controllerLine || null,
        controllerLineStart:
          ep.controllerLineStart || ep.controllerLine || null,
        controllerLineEnd: ep.controllerLineEnd || null,
        controllerMethod: ep.controllerMethod,
        controllerSnippet: ep.controllerSnippet || null,
        middleware: ep.middleware,
        middlewares: ep.middlewares || [],
        params: ep.params,
        queryParams: ep.queryParams,
        requestBodySchema: ep.requestBodySchema,
        databaseModels: ep.databaseModels,
        responseStatusCodes: ep.responseStatusCodes,
        errorHandling: ep.errorHandling,
        requestProcessingChain: ep.requestProcessingChain,
        behaviorEvidence: ep.behaviorEvidence,
      },
      verification: {
        source: {
          status:
            ep.sourceFile ||
            ep.provenance?.resolutionStatus === "FULLY_RESOLVED"
              ? "FOUND_IN_SOURCE"
              : "SOURCE_UNVERIFIED",
          description: ep.sourceFile
            ? `Route definition confirmed in ${ep.sourceFile}${ep.sourceLine ? ` at line ${ep.sourceLine}` : ""}`
            : "No matching route definition was located in source code",
          detectionType: ep.provenance?.detectionType || "AST",
          sourceFile: ep.sourceFile || null,
          sourceLine: ep.sourceLine || null,
        },
        runtime: {
          status:
            executedCount > 0 && hasGenuineApiCall
              ? "RUNTIME_VERIFIED"
              : "NOT_EXECUTED",
          description:
            executedCount > 0 && hasGenuineApiCall
              ? `Observed HTTP test server execution evidence (${passedCount} passed, ${failedCount} failed)`
              : executedCount > 0
                ? "Scenarios executed but without observed live HTTP server response"
                : "No integration test has been executed for this endpoint yet",
          executedCount,
          passedCount,
          failedCount,
          avgDurationMs,
          latencyStatus,
        },
        contract: {
          status: isContractVerified
            ? "CONTRACT_VERIFIED"
            : "CONTRACT_UNVERIFIED",
          description: isContractVerified
            ? "Validated against independent authoritative API contract specification"
            : "No independent API contract specification (e.g. OpenAPI/Swagger spec) was provided in this project snapshot",
          contractSource: isContractVerified
            ? cleanScenarios[0]?.contractSource || "OPENAPI_SPEC"
            : null,
        },
        discovery: {
          snapshotId,
          analyzedAt: snapshot?.createdAt
            ? new Date(snapshot.createdAt).toISOString()
            : new Date().toISOString(),
          analysisSessionId: analyzeJob?.id || snapshotId,
          framework: snapshot?.framework || "Express",
        },
      },
      requestProcessingChain: ep.requestProcessingChain,
      behaviorEvidence: ep.behaviorEvidence,
      provenance: ep.provenance,
      generatedCount,
      approvedCount,
      scenarios: cleanScenarios,
    };
  });

  const targetedApis = endpoints.filter((ep) => ep.generatedCount > 0).length;
  const isValid =
    integrationTests.length > 0 &&
    integrationTests.every((t) => {
      try {
        const meta =
          typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
        return meta.isValid !== false;
      } catch {
        return false;
      }
    });

  const isApproved =
    integrationTests.length > 0 &&
    integrationTests.every((t) => {
      try {
        const meta =
          typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
        return meta.status === "APPROVED";
      } catch {
        return false;
      }
    });

  // Compute trustworthy quality classification
  const qualityClassification = {
    total: 0,
    validExecuted: 0,
    passed: 0,
    assertionFailures: 0,
    testScriptErrors: 0,
    invalidTests: 0,
    contractUnverified: 0,
    contractVerified: 0,
    implementationConsistent: 0,
    infrastructureFailures: 0,
    skipped: 0,
    notExecuted: 0,
  };

  // 1. Process all executed scenarios from enrichedScenarios
  const classifiedExecutedTitles = new Set();
  enrichedScenarios.forEach((sc) => {
    if (classifiedExecutedTitles.has(sc.title)) return;
    classifiedExecutedTitles.add(sc.title);

    const req = sc.requests && sc.requests[0] ? sc.requests[0] : null;
    const cls = classifyScenarioFailure(sc, req);

    // If this was an unmatched synthetic suite-level failure (e.g. filename placeholder when no scenarios could be recovered), record it under testScriptErrors without treating the file as an extra scenario
    const isUnmatchedSuiteFailure =
      sc.isSuiteLevelFailure &&
      !allParsedRequests.some((r) => r.testName === sc.title);
    if (isUnmatchedSuiteFailure && sc.status === "failed") {
      qualityClassification.testScriptErrors++;
      return;
    }

    qualityClassification.total++;

    if (sc.status === "passed") {
      if (cls === "CONTRACT_UNVERIFIED") {
        qualityClassification.contractUnverified++;
      } else {
        qualityClassification.passed++;
        qualityClassification.implementationConsistent++;
      }
    } else if (sc.status === "pending" || sc.status === "skipped") {
      qualityClassification.skipped++;
    } else {
      if (cls === "TEST_SCRIPT_ERROR") qualityClassification.testScriptErrors++;
      else if (cls === "INVALID_TEST") qualityClassification.invalidTests++;
      else if (cls === "CONTRACT_UNVERIFIED")
        qualityClassification.contractUnverified++;
      else if (cls === "INFRASTRUCTURE_FAILED")
        qualityClassification.infrastructureFailures++;
      else qualityClassification.assertionFailures++;
    }

    if (
      isScenarioContractVerified(sc) ||
      sc.contractVerification === "VERIFIED"
    ) {
      qualityClassification.contractVerified++;
    }
  });

  // 2. Count unexecuted generated scenarios
  const allGeneratedRequests = parsedTests.flatMap((pt) => pt.requests || []);
  const unexecutedGenerated = allGeneratedRequests.filter(
    (r) => !classifiedExecutedTitles.has(r.testName),
  );
  const uniqueUnexecutedTitles = new Set(
    unexecutedGenerated.map((r) => r.testName),
  );
  qualityClassification.notExecuted = uniqueUnexecutedTitles.size;
  qualityClassification.total += uniqueUnexecutedTitles.size;

  qualityClassification.validExecuted =
    qualityClassification.passed + qualityClassification.assertionFailures;

  // Phase 6B: Execution Semantics
  let semanticState = "NOT_EXECUTED";
  let executionJobId = null;
  let testRunId = null;

  if (executeJob) {
    executionJobId = executeJob.id;
    if (executeJob.status === "RUNNING" || executeJob.status === "QUEUED") {
      semanticState = "RUNNING";
    } else if (executeJob.status === "CANCELED") {
      semanticState = "CANCELED";
    } else if (executeJob.status === "FAILED") {
      if (latestRun && latestRun.createdAt >= executeJob.createdAt) {
        // TestRun exists and was created during this job
        if (latestRun.failedTests > 0) {
          semanticState = "TESTS_FAILED";
        } else if (latestRun.totalTests === 0) {
          semanticState = "FAILED_BEFORE_TEST_EXECUTION";
        } else {
          semanticState = "TESTS_FAILED"; // fallback
        }
      } else {
        semanticState = "FAILED_BEFORE_TEST_EXECUTION";
      }
    } else if (executeJob.status === "SUCCESS") {
      if (latestRun && latestRun.createdAt >= executeJob.createdAt) {
        if (latestRun.totalTests === 0) {
          semanticState = "NO_TESTS_EXECUTED";
        } else if (latestRun.failedTests > 0) {
          semanticState = "TESTS_FAILED";
        } else if (latestRun.passedTests === 0 && latestRun.skippedTests > 0) {
          semanticState = "SKIPPED";
        } else if (qualityClassification.contractUnverified > 0) {
          semanticState = "CONTRACT_VERIFICATION_REQUIRED";
        } else {
          semanticState = "SUCCESS";
        }
      } else {
        // SUCCESS job but no TestRun? This implies no tests existed to run.
        semanticState = "NO_TESTS_EXECUTED";
      }
    }
  }

  if (
    latestRun &&
    (!executeJob || latestRun.createdAt >= executeJob.createdAt)
  ) {
    testRunId = latestRun.id;
  }

  const allExecutedScenarios = endpoints
    .flatMap((e) => e.scenarios || [])
    .filter((s) => s.status === "passed" || s.status === "failed");
  const totalScenarioDuration = allExecutedScenarios.reduce(
    (acc, s) => acc + (s.durationMs || 0),
    0,
  );
  const avgRequestLatencyMs =
    allExecutedScenarios.length > 0
      ? Math.round(totalScenarioDuration / allExecutedScenarios.length)
      : 0;

  const totalTime = Date.now() - start;
  console.log(
    `[PERF: Integration Workspace] snapshotId=${snapshotId} Total=${totalTime}ms | FS_Read=${sourceTime}ms | AST_Extract=${astTime}ms | DB=${dbTime}ms | Firebase=${fbTime}ms | Test_Parse=${testParseTime}ms`,
  );

  return {
    snapshot: {
      id: snapshotId,
      rootDir: snapshot?.rootDir || "",
      framework: "Express", // Infer or placeholder
      sourceFilesAnalyzed: sourceFilesCount,
    },
    jobs: {
      analyze: analyzeJob
        ? { id: analyzeJob.id, status: analyzeJob.status }
        : null,
      generate: generateJob
        ? { id: generateJob.id, status: generateJob.status }
        : null,
      execute: executeJob
        ? {
            id: executeJob.id,
            status: executeJob.status,
            errorMessage: executeJob.errorMessage,
            createdAt: executeJob.createdAt,
          }
        : null,
    },
    summary: {
      discoveredApis: discoveredEndpoints.length,
      testedApis,
      executedApis,
      implementationConsistentApis,
      verifiedTestedApis,
      contractVerifiedApis: verifiedTestedApis,
      contractUnverifiedApis: discoveredEndpoints.length - verifiedTestedApis,
      uncoveredApis,
      notExecutedApis,
      scriptErrorApis: endpoints.filter((e) => e.status === "Script Error")
        .length,
      positiveScenarioCount: endpoints
        .flatMap((e) => e.scenarios || [])
        .filter((s) => s.scenarioType === "HAPPY_PATH").length,
      negativeBoundaryScenarioCount: endpoints
        .flatMap((e) => e.scenarios || [])
        .filter(
          (s) =>
            s.scenarioType === "NEGATIVE" ||
            s.scenarioType === "EDGE_CASE" ||
            s.scenarioType === "VALIDATION" ||
            (s.expectedStatus && s.expectedStatus >= 400),
        ).length,
      endpointsWithPositiveCoverage: endpoints.filter((e) =>
        (e.scenarios || []).some((s) => s.scenarioType === "HAPPY_PATH"),
      ).length,
      endpointsWithNegativeBoundaryCoverage: endpoints.filter((e) =>
        (e.scenarios || []).some(
          (s) =>
            s.scenarioType === "NEGATIVE" ||
            s.scenarioType === "EDGE_CASE" ||
            s.scenarioType === "VALIDATION" ||
            (s.expectedStatus && s.expectedStatus >= 400),
        ),
      ).length,
      runnerAssertionPassRate:
        latestRun?.totalTests > 0
          ? Math.round(
              ((latestRun.passedTests || 0) / latestRun.totalTests) * 100,
            )
          : 0,
      qualityClassification,
      totalTests: latestRun?.totalTests || 0,
      passedTests: latestRun?.passedTests || 0,
      failedTests: latestRun?.failedTests || 0,
      skippedTests: latestRun?.skippedTests || 0,
      runnerAssertions: {
        total: latestRun?.totalTests || 0,
        passed: latestRun?.passedTests || 0,
        failed: latestRun?.failedTests || 0,
        skipped: latestRun?.skippedTests || 0,
      },
      durationMs: latestRun?.durationMs || 0,
      avgRequestLatencyMs,
      avgEndpointLatencyMs:
        testedApis > 0
          ? Math.round(
              endpoints
                .filter((e) => e.executedCount > 0)
                .reduce((acc, e) => acc + (e.avgDurationMs || 0), 0) /
                testedApis,
            )
          : 0,
      semanticState,
      executionJobId,
      testRunId,
      endpointCoverageMetrics: apiTraceResult?.summary || {
        totalEndpoints: discoveredEndpoints.length,
        coveredEndpoints: 0,
        uncoveredEndpoints: discoveredEndpoints.length,
        endpointCoveragePct: 0,
        effectiveCoveragePct: 0,
      },
      endpointsTraceability: apiTraceResult?.endpointsTraceability || [],
      codeCoverage: coverageSummary
        ? {
            statement: coverageSummary.stmtsPct,
            branch: coverageSummary.branchesPct,
            function: coverageSummary.funcsPct,
            line: coverageSummary.linesPct,
          }
        : null,
      fileCoverages: coverageFiles.map((cf) => ({
        filePath: cf.filePath,
        statement: cf.stmtsPct,
        branch: cf.branchesPct,
        function: cf.funcsPct,
        line: cf.linesPct,
      })),
      metricDefinitions: {
        runnerPassRate: {
          meaning:
            "Percentage of executed test scenarios that passed without assertion errors or uncaught runtime exceptions.",
          formula: "passed / (passed + failed) × 100",
          denominator: "executed scenarios",
        },
        validExecuted: {
          meaning:
            "Scenarios testing genuine, contract-consistent API behavior (excluding unverified HTTP 500 catch-alls and test script errors).",
          formula: "passed + assertionFailures",
          denominator: "total scenarios",
        },
        contractUnverified: {
          meaning:
            "Test scenarios that asserted HTTP 500 for client-side errors without an explicit OpenAPI or Swagger contract requiring a 500.",
          formula: "scenarios with catch-all 500 without contract",
          denominator: "total scenarios",
        },
        endpointCoverage: {
          meaning:
            "Percentage of distinct discovered API endpoints supported by genuine execution evidence.",
          formula: "testedApis / discoveredApis × 100",
          denominator: "discovered API endpoints",
        },
      },
      provenance: {
        apiCoverage: {
          source: "Endpoint Analysis + Test Scenario Mapping",
          metric: "API Endpoint Coverage",
          formula: "tested endpoints / discovered endpoints × 100",
          scope: "Discovered Express Endpoints",
          snapshotId,
          jobId: generateJob?.id || null,
          testRunId: null,
          timestamp: generateJob?.createdAt || new Date(),
          limitation:
            "Static mapping; does not guarantee runtime execution hit",
        },
        execution: {
          source: "TestRunner Report",
          metric: "Execution Results",
          formula: "Pass / Fail / Skip from test runner output",
          scope: "Integration Tests",
          snapshotId,
          jobId: executionJobId,
          testRunId: testRunId,
          timestamp: latestRun?.createdAt || executeJob?.createdAt || null,
          limitation: null,
        },
        codeCoverage: {
          source: "Coverage Parser (Istanbul/V8)",
          metric: "Project Code Coverage",
          formula: "Executed instructions / Total instructions × 100",
          scope:
            "Backend controllers & services (`server/controllers/`, `server/services/`, `server/routes/`)",
          exclusions: "`client/`, `node_modules/`, `coverage/`, `tests/`",
          environment:
            "Node.js v20+, Express + In-Memory Prisma Mock Fixture, Jest + Supertest",
          snapshotId,
          jobId: executionJobId,
          testRunId: testRunId,
          timestamp: coverageSummary?.createdAt || latestRun?.createdAt || null,
          limitation: "Reflects instrumented backend endpoints only",
        },
        scenarioCount: {
          source: "AI Test Generation",
          metric: "Scenario Count",
          formula: "Parsed scenarios from generated test files",
          scope: "Integration Test Scripts",
          snapshotId,
          jobId: generateJob?.id || null,
          testRunId: null,
          timestamp: generateJob?.createdAt || new Date(),
          limitation:
            "Static count of 'it' or 'test' blocks; dynamically skipped tests may not execute",
        },
      },
    },
    generation: {
      hasAnalysis: analyzeJob?.status === "SUCCESS",
      hasGeneratedTests: integrationTests.length > 0,
      targetedApis,
      generatedFiles: integrationTests.length,
      generatedScenarios: allParsedRequests.length,
      isApproved,
      isValid,
    },
    endpoints,
    aiTests: integrationTests.map((t) => {
      const meta =
        (typeof t.metaJson === "string"
          ? JSON.parse(t.metaJson)
          : t.metaJson) || {};
      const cacheEntry = snapshotParseCache.get(t.id);
      const cachedRequests = cacheEntry
        ? cacheEntry.requests
        : extractValidatedTestRequests(t);
      return {
        id: t.id,
        filePath: t.filePath,
        status: meta.status || "DRAFT",
        isValid: meta.isValid !== false,
        requests: cachedRequests.map((r) => {
          const metaReq = meta.requests
            ? meta.requests.find(
                (mr) =>
                  (mr.scenarioId &&
                    (mr.scenarioId === r.scenarioId ||
                      mr.scenarioId === r.id)) ||
                  mr.testName === r.testName,
              )
            : null;
          const fallbackId = crypto
            .createHash("md5")
            .update(r.testName)
            .digest("hex")
            .substring(0, 8);
          return {
            ...r,
            scenarioId: metaReq?.scenarioId || r.scenarioId || fallbackId,
            category: categorizeScenario(r.testName),
            enabled: metaReq ? metaReq.enabled !== false : true,
            userEdited: metaReq ? Boolean(metaReq.userEdited) : false,
            origin:
              metaReq?.origin ||
              (metaReq?.userEdited ? "USER_MODIFIED" : "AI_GENERATED"),
            createdAt: metaReq?.createdAt || null,
            lastModifiedAt: metaReq?.lastModifiedAt || null,
            originalTestName: metaReq?.originalTestName || null,
          };
        }),
      };
    }),
    execution: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          completedAt: latestRun.finishedAt || null,
          totalTests:
            latestRun.totalTests ??
            (latestRun.passedTests || 0) + (latestRun.failedTests || 0),
          passedTests: latestRun.passedTests || 0,
          failedTests: latestRun.failedTests || 0,
          skippedTests: latestRun.skippedTests || 0,
          durationMs: latestRun.durationMs || 0,
          timestamp: latestRun.finishedAt || latestRun.createdAt || null,
        }
      : null,
    semanticState,
  };
};

/**
 * GET History of Integration Tests for a snapshot
 */
export const getIntegrationHistoryService = async (snapshotId) => {
  const jobs = await prisma.job.findMany({
    where: {
      snapshotId,
      type: { in: ["ANALYSIS", "AI_TESTS", "SUPERTEST_COVERAGE"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const testRuns = await prisma.testRun.findMany({
    where: { snapshotId, type: "SUPERTEST" },
    orderBy: { createdAt: "desc" },
  });

  return {
    jobs,
    testRuns,
  };
};
