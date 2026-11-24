import { parse } from "@babel/parser";
import { withAgentContext } from "../agents/registry.js";
import _traverse from "@babel/traverse";
const traverse = _traverse.default || _traverse;
import { ServiceError } from "../utils/serviceError.js";
import { extractValidEndpoints } from "./apiEndpointParser.service.js";
import { normalizeFilePath } from "./unifiedCoverageEngine.service.js";
import {
  detectIntegrationLanguage,
  getEndpointRequiredCases,
} from "../../../shared/integrationCaseCoverage.js";

/**
 * Integration AI Test Generator Service (Phase 2 - CovAI)
 *
 * Provides:
 * 1. Deep Context Harvesting: AST controller snippet, branch conditions, validation schemas, database models.
 * 2. Multi-Scenario Prompt Strategy for both Supertest and Playwright API (Happy Path 200/201, Negative 400, Auth 401/403, Not Found 404, Edge Cases).
 * 3. AST Safety Validator: Babel syntax validation & forbidden API quarantine.
 * 4. AI Fix Faulty Test: Repairs broken pre-existing tests based on failure layer diagnostics.
 */

const FORBIDDEN_IDENTIFIERS = ["eval"];
const FORBIDDEN_MODULES = [
  "child_process",
  "node:child_process",
  "cluster",
  "worker_threads",
];
const FORBIDDEN_CALLS = [
  "process.exit",
  "fs.rmSync",
  "fs.rm",
  "rmdirSync",
  "child_process.exec",
];

/**
 * Safely parses JavaScript/TypeScript code into Babel AST.
 */
export const parseCodeToAst = (code = "") => {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new ServiceError("Empty code provided for AST parsing", 422);
  }
  try {
    return parse(code, {
      sourceType: "module",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "dynamicImport",
        "objectRestSpread",
      ],
    });
  } catch (err) {
    throw new ServiceError(`AST syntax error: ${err.message}`, 422);
  }
};

/**
 * Extracts conditional branch expressions (if/else, ternary, validation checks)
 * from a controller or router handler code snippet.
 *
 * @param {string} codeSnippet - Controller function source code
 * @returns {Array<Object>} List of branch conditions and testing scenarios
 */
export const harvestBranchConditions = (codeSnippet = "") => {
  if (
    !codeSnippet ||
    typeof codeSnippet !== "string" ||
    codeSnippet.trim().length === 0
  ) {
    return [];
  }

  const branches = [];

  try {
    const ast = parseCodeToAst(codeSnippet);

    traverse(ast, {
      IfStatement(p) {
        const loc = p.node.loc?.start;
        const line = loc ? loc.line : 1;

        // Extract condition string and consequent snippet
        let condText = "condition";
        let bodySnippet = "";
        try {
          const lines = codeSnippet.split("\n");
          if (lines[line - 1]) {
            const m = lines[line - 1].match(/if\s*\((.*?)\)/);
            if (m && m[1]) condText = m[1].trim();
          }
          const start = Math.max(0, line - 1);
          const end = p.node.loc?.end ? p.node.loc.end.line : start + 5;
          bodySnippet = lines.slice(start, end).join("\n");
        } catch (_) {}

        const lowerCond = condText.toLowerCase();

        let category = "VALIDATION_CHECK";
        let suggestedStatus = 400;

        // 1. Direct Ground Truth: check if the if-body explicitly returns a status code
        const statusMatch = bodySnippet.match(/status\(\s*(\d{3})\s*\)/);
        if (statusMatch) {
          suggestedStatus = Number(statusMatch[1]);
          if (suggestedStatus === 401 || suggestedStatus === 403)
            category = "AUTH_OR_PERMISSION";
          else if (suggestedStatus === 404) category = "RESOURCE_NOT_FOUND";
          else if (suggestedStatus === 409) category = "RESOURCE_CONFLICT";
          else if (suggestedStatus === 400 || suggestedStatus === 422)
            category = "VALIDATION_CHECK";
          else category = "EDGE_CASE";
        } else if (
          lowerCond.includes("auth") ||
          lowerCond.includes("token") ||
          lowerCond.includes("role") ||
          lowerCond.includes("admin") ||
          lowerCond.includes("unauthorized") ||
          lowerCond.includes("forbidden")
        ) {
          category = "AUTH_OR_PERMISSION";
          suggestedStatus =
            lowerCond.includes("role") || lowerCond.includes("admin")
              ? 403
              : 401;
        } else if (
          lowerCond.includes("!") &&
          (lowerCond.includes("notfound") ||
            lowerCond.includes("order") ||
            lowerCond.includes("user_id") ||
            lowerCond.includes("exist"))
        ) {
          category = "RESOURCE_NOT_FOUND";
          suggestedStatus = 404;
        } else if (
          lowerCond.includes("duplicate") ||
          lowerCond.includes("conflict")
        ) {
          category = "RESOURCE_CONFLICT";
          suggestedStatus = 409;
        }

        let scenarioTitle = `negative: should return ${suggestedStatus} when ${condText} triggers`;
        if (category === "AUTH_OR_PERMISSION") {
          scenarioTitle = `auth negative: should return ${suggestedStatus} when unauthorized (${condText})`;
        } else if (category === "RESOURCE_NOT_FOUND") {
          scenarioTitle = `not found: should return ${suggestedStatus} when resource does not exist (${condText})`;
        } else if (category === "RESOURCE_CONFLICT") {
          scenarioTitle = `conflict: should return 409 when resource already exists (${condText})`;
        }

        branches.push({
          type: "IF",
          line,
          condition: condText,
          category,
          suggestedStatus,
          scenarioTitle,
        });
      },

      ConditionalExpression(p) {
        const line = p.node.loc?.start?.line || 1;
        branches.push({
          type: "TERNARY",
          line,
          condition: "ternary_branch",
          category: "EDGE_CASE",
          suggestedStatus: 200,
          scenarioTitle: `edge case: should test both branches of ternary expression at line ${line}`,
        });
      },
    });
  } catch (_) {
    // Fallback regex if AST parsing of standalone snippet encounters syntax gaps
    const ifRegex = /if\s*\((.*?)\)/g;
    let match;
    let idx = 1;
    while ((match = ifRegex.exec(codeSnippet)) !== null) {
      const cond = match[1].trim();
      branches.push({
        type: "IF",
        line: idx++,
        condition: cond,
        category: "VALIDATION_CHECK",
        suggestedStatus: 400,
        scenarioTitle: `negative: should trigger validation error for condition (${cond})`,
      });
    }
  }

  return branches;
};

/**
 * Extracts ground-truth database schema models and non-nullable fields.
 *
 * @param {Array<Object>} sourceCode - Source code files
 * @returns {Array<Object>} Discovered models with required fields
 */
export const extractDatabaseSchemaConstraints = (sourceCode = []) => {
  const models = [];
  const prismaFiles = (sourceCode || []).filter((f) => {
    const p = f.path || f.filePath || "";
    return p.endsWith(".prisma") || p.includes("schema.prisma");
  });

  for (const file of prismaFiles) {
    if (!file.content) continue;
    const modelBlocks = file.content.split(/model\s+([A-Za-z0-9_]+)\s*\{/);

    for (let i = 1; i < modelBlocks.length; i += 2) {
      const modelName = modelBlocks[i];
      const body = modelBlocks[i + 1] ? modelBlocks[i + 1].split("}")[0] : "";

      const requiredFields = [];
      const optionalFields = [];

      const fieldLines = body.split("\n");
      for (const line of fieldLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@"))
          continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const fieldName = parts[0];
          const fieldType = parts[1];

          if (
            fieldName === "id" ||
            fieldName === "createdAt" ||
            fieldName === "updatedAt"
          )
            continue;

          const isOptional =
            fieldType.includes("?") || trimmed.includes("@default");
          if (isOptional) {
            optionalFields.push({ name: fieldName, type: fieldType });
          } else {
            requiredFields.push({ name: fieldName, type: fieldType });
          }
        }
      }

      models.push({
        modelName,
        requiredFields,
        optionalFields,
      });
    }
  }

  return models;
};

/**
 * Harvests deep context for an API endpoint.
 * Combines Route definition, Controller snippet, branch conditions, DB models, and Frontend callers.
 *
 * @param {Object} params
 * @param {Object} params.endpoint - API Endpoint metadata
 * @param {Array<Object>} params.sourceCode - Full project source code
 * @returns {Object} Deep context package
 */
export const harvestApiDeepContext = ({
  endpoint = {},
  sourceCode = [],
} = {}) => {
  const method = (endpoint.method || "GET").toUpperCase();
  const routePath = endpoint.path || "/";

  // 1. Controller Code Snippet (fallback to sourceFile for inline route handlers)
  let controllerSnippet = endpoint.controllerSnippet || "";
  const controllerFile = endpoint.controllerFile || endpoint.sourceFile;

  if (!controllerSnippet && controllerFile) {
    const normTarget = normalizeFilePath(controllerFile);
    const fileObj = sourceCode.find((f) => {
      const p = f.path || f.filePath || "";
      return normalizeFilePath(p) === normTarget || p.endsWith(normTarget);
    });
    if (fileObj && fileObj.content) {
      const lines = fileObj.content.split("\n");
      const start = Math.max(
        0,
        (endpoint.controllerLineStart ||
          endpoint.controllerLine ||
          endpoint.sourceLineStart ||
          1) - 1,
      );
      const end = Math.min(
        lines.length,
        endpoint.controllerLineEnd || endpoint.sourceLineEnd || start + 120,
      );
      controllerSnippet = lines.slice(start, end).join("\n");
    }
  }

  // 1.5 Collect locally imported service/validator modules referenced by controller/route (up to 2 hops)
  const importedModules = [];
  const seenImported = new Set();
  const resolveLocalImportsFrom = (sourceContent, baseFilePath, depth = 0) => {
    if (!sourceContent || !baseFilePath || depth > 2) return;
    const normBase = normalizeFilePath(baseFilePath);
    const baseParts = normBase.split("/").slice(0, -1);
    const importRe =
      /(?:import\s+[\s\S]*?from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(sourceContent)) !== null) {
      const rel = m[1];
      const stack = [...baseParts];
      for (const seg of rel.split("/")) {
        if (!seg || seg === ".") continue;
        if (seg === "..") stack.pop();
        else stack.push(seg);
      }
      const joined = stack.join("/");
      const targetObj = (sourceCode || []).find((f) => {
        const fp = normalizeFilePath(f.path || f.filePath || "");
        return (
          fp === joined || fp === `${joined}.js` || fp === `${joined}/index.js`
        );
      });
      if (targetObj && targetObj.content) {
        const fp = targetObj.path || targetObj.filePath;
        if (!seenImported.has(fp)) {
          seenImported.add(fp);
          importedModules.push({ filePath: fp, content: targetObj.content });
          resolveLocalImportsFrom(targetObj.content, fp, depth + 1);
        }
      }
    }
  };
  const findSourceFile = (targetPath) => {
    if (!targetPath) return null;
    const norm = normalizeFilePath(targetPath);
    return (sourceCode || []).find((f) => {
      const p = normalizeFilePath(f.path || f.filePath || "");
      return p === norm || p.endsWith(norm);
    });
  };
  const ctrlObj = findSourceFile(controllerFile);
  if (ctrlObj?.content) {
    resolveLocalImportsFrom(
      ctrlObj.content,
      ctrlObj.path || ctrlObj.filePath,
      0,
    );
  }
  const routeFile = endpoint.routerFile || endpoint.sourceFile;
  const routerObj = findSourceFile(routeFile);
  if (routerObj?.content) {
    resolveLocalImportsFrom(
      routerObj.content,
      routerObj.path || routerObj.filePath,
      0,
    );
  }

  // 2. Harvest Branch Conditions from Controller Snippet
  const branchConditions = harvestBranchConditions(controllerSnippet);

  // 3. Database Models & Required Fields
  const allModels = extractDatabaseSchemaConstraints(sourceCode);
  const relatedModels = allModels.filter(
    (m) =>
      (endpoint.databaseModels || []).includes(m.modelName) ||
      controllerSnippet.toLowerCase().includes(m.modelName.toLowerCase()),
  );

  // 4. Frontend Consumer Evidence (fetch/axios calls)
  const frontendCallers = (sourceCode || [])
    .filter((f) => {
      const p = f.path || f.filePath || "";
      return (
        (p.includes("client/") ||
          p.includes("frontend/") ||
          p.includes("src/api/")) &&
        f.content &&
        f.content.includes(routePath)
      );
    })
    .map((f) => {
      const lines = (f.content || "").split("\n");
      const matchingLines = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(routePath)) {
          matchingLines.push(
            lines
              .slice(Math.max(0, i - 2), Math.min(lines.length, i + 5))
              .join("\n"),
          );
        }
      }
      return {
        filePath: f.path || f.filePath || "unknown",
        snippet: matchingLines.join("\n---\n"),
      };
    });

  return {
    method,
    path: routePath,
    controllerFile: endpoint.controllerFile || "unknown",
    controllerSnippet,
    importedModules,
    branchConditions,
    relatedModels,
    frontendCallers,
    middlewares: endpoint.middlewares || [],
    serviceLayer: endpoint.serviceLayer || null,
  };
};

/**
 * Builds a multi-scenario prompt for Supertest or Playwright API testing.
 * Implements the 5 standard testing scenarios:
 * 1. Happy Path (200/201)
 * 2. Negative Validation Error (400)
 * 3. Auth / Permissions (401/403)
 * 4. Not Found / Conflict (404/409)
 * 5. Edge Cases & Boundary Limits
 *
 * @param {Object} params
 * @param {Array<Object>} params.endpoints - Selected API endpoints
 * @param {Array<Object>} params.sourceCode - Project source code files
 * @param {"supertest" | "playwright"} [params.framework] - Target framework
 * @param {Array<Object>} [params.uncoveredBranches] - Specific uncovered branches from plancoverageengine
 * @returns {string} Fully rendered prompt
 */
/**
 * Locate Express entry file(s) and router files from loaded sourceCode so both
 * generation and repair prompts have the exact route mounting prefixes and middlewares.
 */
const collectAppEntryAndRouteFiles = (sourceCode = [], endpoints = []) => {
  const normalizedFiles = (sourceCode || []).map((f) => ({
    path: f.path || f.filePath || "",
    normPath: normalizeFilePath(f.path || f.filePath || ""),
    content: String(f.content || ""),
  }));

  const entryFiles = normalizedFiles
    .filter(
      (f) =>
        /(?:^|\/)(?:src\/)?(?:index|app|server|main)\.[jt]sx?$/i.test(
          f.normPath,
        ) &&
        /\bexpress\s*\(/.test(f.content) &&
        !/node_modules|client\/|frontend\//i.test(f.normPath),
    )
    .slice(0, 2);

  const routePaths = new Set(
    (endpoints || [])
      .map((ep) => ep?.routerFile || ep?.sourceFile)
      .filter(Boolean)
      .map((p) => normalizeFilePath(p)),
  );
  const routeFiles = normalizedFiles
    .filter(
      (f) =>
        routePaths.has(f.normPath) &&
        !entryFiles.some((ef) => ef.normPath === f.normPath),
    )
    .slice(0, 8);

  return { entryFiles, routeFiles };
};

export const buildIntegrationTestPrompt = ({
  endpoints = [],
  sourceCode = [],
  testFiles = [],
  framework = "supertest",
  uncoveredBranches = [],
  language = null,
  targetFilePath = null,
} = {}) => {
  const isPlaywright =
    framework === "playwright" ||
    String(framework).toLowerCase().includes("playwright");
  const frameworkName = isPlaywright
    ? "Playwright API Testing (@playwright/test)"
    : "Supertest + Jest";
  const existingScenarios = (endpoints || []).flatMap((ep) =>
    Array.isArray(ep?.existingScenarios) ? ep.existingScenarios : [],
  );
  const resolvedLanguage =
    language ||
    detectIntegrationLanguage({
      existingScenarios,
      testFiles,
      sourceCode,
    });

  let prompt = `You are a Principal Software Engineer & QA Architect specializing in Node.js API Testing.\n`;
  prompt += `Your task is to generate comprehensive, production-ready integration tests using **${frameworkName}**.\n\n`;
  if (resolvedLanguage === "vi") {
    prompt += `**LANGUAGE RULE (MANDATORY — VIETNAMESE):** Existing project tests and/or controller messages are written in **Vietnamese**. Write all \`describe(...)\` / \`it(...)\` titles and inline comments in natural **Vietnamese**, matching the repository's existing test style.\n\n`;
  }

  prompt += `### 1. TARGET FRAMEWORK SPECIFICATION: ${frameworkName.toUpperCase()}\n\n`;

  if (isPlaywright) {
    prompt += `#### Playwright API Testing Guidelines:\n`;
    prompt += `- Use a SINGLE \`import { test, expect } from '@playwright/test';\` statement at the top of the file.\n`;
    prompt += `- Use the built-in \`request\` fixture in test arguments: \`test('title', async ({ request }) => { ... });\`.\n`;
    prompt += `- Use standard Playwright API methods: \`await request.get(path)\`, \`await request.post(path, { data: payload })\`, \`await request.put(...)\`, \`await request.delete(...)\`.\n`;
    prompt += `- Status assertions: \`expect(res.status()).toBe(200)\` or \`expect(res.ok()).toBeTruthy()\`.\n`;
    prompt += `- Body assertions: assert ONLY fields actually returned by the controller/service below (never invent fields like \`weeklyStats\` unless seen in source code).\n`;
    prompt += `- Target file path MUST start with \`tests/api/\` or the backend's \`tests/api/\` directory (target: \`${targetFilePath || "tests/api/orders.api.spec.js"}\`).\n\n`;
  } else {
    prompt += `#### Supertest + Jest Guidelines:\n`;
    prompt += `- Follow the repository's module system and existing integration test mocking pattern shown below (if ESM \`"type": "module"\`, use \`import { jest, describe, it, expect, beforeEach } from '@jest/globals';\` and \`await jest.unstable_mockModule(...)\` BEFORE dynamically importing routes/app; if CommonJS, use \`require\` and \`jest.mock(...)\`).\n`;
    prompt += `- Mock external AI/network/payment/email services (e.g. \`ai.service.js\`, \`@google/generative-ai\`) and Prisma/DB modules when existing tests do so, so tests pass deterministically offline without live API keys.\n`;
    prompt += `- Use inline chain calls: \`const res = await request(app).post(path).send(payload);\`.\n`;
    prompt += `- Status assertions: \`expect(res.status).toBe(200);\`.\n`;
    prompt += `- Body assertions: assert ONLY fields actually returned by the controller/service below.\n`;
    prompt += `- **NEVER re-implement or duplicate inline app routes (e.g. NEVER write \`app.get("/", ...)\`) inside your test file.** Always import the real \`app\` from the project's entry file (e.g. \`index.js\` / \`app.js\`) or mount the real exported routers AFTER \`jest.unstable_mockModule(...)\` / \`jest.mock(...)\`. CovAI automatically guards \`app.listen()\` / \`server.listen()\` when running in Jest, so importing the real entry module is safe and required for true endpoint line coverage (100% of endpoints).\n`;
    prompt += `- DO NOT call \`app.listen()\` inside tests.\n`;
    prompt += `- Target file path: \`${targetFilePath || "tests/integration/orders.test.js"}\` (MUST reside inside \`tests/integration/\`; calculate all relative \`import\` / \`jest.unstable_mockModule\` paths relative to that exact file location).\n\n`;
  }

  const targetList =
    endpoints.length > 0 ? endpoints : extractValidEndpoints(sourceCode);
  const { entryFiles, routeFiles } = collectAppEntryAndRouteFiles(
    sourceCode,
    targetList,
  );

  if (entryFiles.length > 0 || routeFiles.length > 0 || targetList.length > 0) {
    prompt += `### 1.2 APPLICATION ENTRY & EXACT ROUTE MOUNTING MAP (SOURCE OF TRUTH)\n`;
    prompt += `**CRITICAL ROUTING RULE:** Every request path in your tests MUST match the exact mounted URL below. **NEVER invent or prepend \`/api\` unless the Express entry file explicitly mounts that router with \`app.use('/api', router)\`.**\n`;
    if (targetList.length > 0) {
      prompt += `Exact Mounted Endpoints (ALL ${targetList.length} MUST be tested):\n`;
      targetList.forEach((ep, idx) => {
        const epMethod = (ep.method || "GET").toUpperCase();
        const epPath = ep.fullPath || ep.path || "/";
        const reqCases = getEndpointRequiredCases(ep);
        prompt += `  ${idx + 1}. \`${epMethod} ${epPath}\` (Route file: \`${ep.routerFile || ep.sourceFile || "entry"}\`, Required cases: ${reqCases.length} -> ${reqCases.map((c) => c.promptHint).join(", ")})\n`;
      });
      prompt += `\n`;
    }
    for (const ef of entryFiles) {
      let relImportExample = "";
      if (targetFilePath && ef.path) {
        const fromParts = normalizeFilePath(targetFilePath)
          .split("/")
          .slice(0, -1);
        const toParts = normalizeFilePath(ef.path).split("/");
        let common = 0;
        while (
          common < fromParts.length &&
          common < toParts.length &&
          fromParts[common] === toParts[common]
        ) {
          common++;
        }
        const ups =
          "../".repeat(Math.max(0, fromParts.length - common)) || "./";
        relImportExample = `${ups}${toParts.slice(common).join("/")}`;
      }
      prompt += `\`\`\`javascript\n// Express Entry File (EXACT app.use mounts & imports): ${ef.path}${relImportExample ? `\n// Import in test via: const { default: app } = await import('${relImportExample}');` : ""}\n${ef.content.slice(0, 2500)}\n\`\`\`\n`;
    }
    for (const rf of routeFiles) {
      prompt += `\`\`\`javascript\n// Route Definition: ${rf.path}\n${rf.content.slice(0, 800)}\n\`\`\`\n`;
    }
    prompt += `\n`;
  }

  const sampleTestFiles = (testFiles || [])
    .filter((tf) => tf?.content && tf.content.trim().length > 0)
    .slice(0, 2);
  if (sampleTestFiles.length > 0) {
    prompt += `### 1.5 EXISTING REPOSITORY TEST PATTERN (MOCKING SYNTAX REFERENCE ONLY — FOLLOW SECTION 1.2 FOR ROUTE MOUNTS)\n`;
    for (const tf of sampleTestFiles) {
      prompt += `\`\`\`javascript\n// Existing test: ${tf.path || "integration.test.js"}\n${String(tf.content).slice(0, 1500)}\n\`\`\`\n\n`;
    }
  }

  prompt += `### 2. REQUIRED CASE CONTRACT & STRICT TOKEN-SAVING CAP\n`;
  prompt += `- Generate **EXACTLY ONE** dedicated \`${isPlaywright ? "test" : "it"}(...)\` block for each item under **Required Cases to Generate** across ALL **${targetList.length}** endpoints (1 test per required case, **NO MORE, NO LESS** — never skip any endpoint!).\n`;
  prompt += `- Existing user scenarios are always preserved separately; still generate the exact N required cases per endpoint so overlaps can be inspected and triaged by the user.\n`;
  prompt += `- **STRICT STATUS ASSERTION:** Assert ONE exact HTTP status code per test (e.g. \`expect(res.status).toBe(200)\`, \`400\`, \`404\`, \`500\`). NEVER hedge with \`expect([200, 201, 404]).toContain(res.status)\`.\n`;
  prompt += `- **EXCEPTION / EDGE CASE (500) RULE:** For every \`Edge / Server Error (500)\` required case, trigger the controller's \`catch\` / error handler by calling \`.mockRejectedValueOnce(new Error("Simulated internal error"))\` on the mocked DB/service call ONLY for that test (never mutate shared mock behavior across tests), and assert \`expect(res.status).toBe(500)\` plus the actual JSON error key from the controller.\n`;
  prompt += `- **MOCK ALL EXPORTS RULE:** Whenever mocking ANY project module via \`jest.unstable_mockModule(...)\` or \`jest.mock(...)\`, you MUST export **every** \`default\` AND named export used across the entry, routes, controllers, or services (e.g. for \`socket.js\`, include BOTH \`initializeSocketServer\` AND \`getSocketInstance\`; for service modules, export both \`default\` and all named helpers). Better yet: only mock leaf external/DB/side-effect modules (\`prisma\`, \`ai.service\`, \`socket.js\`, \`cron\`), NOT controllers or routes!\n`;
  prompt += `- **IMPORT REAL ENTRY APP:** Whenever an Express entry file is shown in Section 1.2 (e.g. \`index.js\` / \`app.js\`), mock any side-effect modules it imports (DB, socket, cron jobs, external AI services) BEFORE dynamically importing the real entry file \`const { default: app } = await import(...)\` — never re-declare synthetic \`app.get("/", ...)\` stubs.\n\n`;

  prompt += `### 3. DEEP API ENDPOINT INVENTORY & SOURCE CONTEXT\n\n`;

  for (const ep of targetList) {
    const deepCtx = harvestApiDeepContext({ endpoint: ep, sourceCode });
    const requiredHints =
      Array.isArray(ep.missingCoverageRequested) &&
      ep.missingCoverageRequested.length > 0
        ? ep.missingCoverageRequested
        : getEndpointRequiredCases(ep).map((c) => c.promptHint);

    prompt += `#### Endpoint: \`${deepCtx.method} ${deepCtx.path}\`\n`;
    prompt += `- Controller File: \`${deepCtx.controllerFile}\`\n`;
    prompt += `- Required Cases to Generate (EXACT COUNT = ${requiredHints.length}): ${requiredHints.join(" | ")}\n`;

    if (
      Array.isArray(ep.existingScenarios) &&
      ep.existingScenarios.length > 0
    ) {
      prompt += `- **Existing User Scenarios (Preserved Separately — Reference Only)**:\n`;
      ep.existingScenarios.forEach((ex) => {
        prompt += `  * \`${ex.testName}\` (${ex.caseLabel || ex.caseKey}, Expected ${ex.expectedStatus || "asserted"})\n`;
      });
    }

    if (deepCtx.middlewares && deepCtx.middlewares.length > 0) {
      prompt += `- Active Middlewares: ${deepCtx.middlewares.map((m) => m.name || m).join(", ")}\n`;
    }

    if (deepCtx.controllerSnippet) {
      prompt += `\`\`\`javascript\n// Handler Snippet:\n${deepCtx.controllerSnippet.slice(0, 2500)}\n\`\`\`\n`;
    }

    if (
      Array.isArray(deepCtx.importedModules) &&
      deepCtx.importedModules.length > 0
    ) {
      for (const mod of deepCtx.importedModules.slice(0, 5)) {
        prompt += `\`\`\`javascript\n// Dependency Module (${mod.filePath}):\n${String(mod.content).slice(0, 6000)}\n\`\`\`\n`;
      }
    }

    if (deepCtx.branchConditions.length > 0) {
      prompt += `- **Discovered Branch Conditions to Cover**:\n`;
      deepCtx.branchConditions.forEach((b) => {
        prompt += `  * Line ${b.line} (${b.category}): Condition \`${b.condition}\` -> Expect HTTP ${b.suggestedStatus}\n`;
      });
    }

    if (deepCtx.relatedModels.length > 0) {
      prompt += `- **Database Constraints**:\n`;
      deepCtx.relatedModels.forEach((m) => {
        const reqNames = m.requiredFields
          .map((f) => `${f.name} (${f.type})`)
          .join(", ");
        prompt += `  * Model \`${m.modelName}\` Required Non-Nullable Fields: [${reqNames || "none"}]\n`;
      });
    }

    if (deepCtx.frontendCallers.length > 0) {
      prompt += `- **Frontend Consumer Expectations (Ground Truth)**:\n`;
      deepCtx.frontendCallers.slice(0, 2).forEach((fc) => {
        prompt += `\`\`\`javascript\n// File: ${fc.filePath}\n${fc.snippet.slice(0, 300)}\n\`\`\`\n`;
      });
    }

    prompt += `\n`;
  }

  if (uncoveredBranches.length > 0) {
    prompt += `### 4. UNCOVERED BRANCH CONSTRAINTS (HIGH PRIORITY GATING CONDITIONS)\n`;
    prompt += `Coverage analysis identified the following uncovered branches. You MUST target them:\n`;
    uncoveredBranches.slice(0, 8).forEach((b, idx) => {
      prompt += `${idx + 1}. File: \`${b.filePath || "controller"}\` | Line: ${b.line} | Missing Path: ${JSON.stringify(b.missingPaths || [])}\n`;
    });
    prompt += `\n`;
  }

  prompt += `### 5. REQUIRED OUTPUT JSON FORMAT\n`;
  prompt += `Output MUST be a JSON object inside a \`\`\`json\`\`\` code block:\n`;
  prompt += `\`\`\`json\n`;
  prompt += `{\n`;
  prompt += `  "tests": [\n`;
  prompt += `    {\n`;
  prompt += `      "filePath": "${targetFilePath || (isPlaywright ? "tests/api/orders.api.spec.js" : "tests/integration/orders.test.js")}",\n`;
  prompt += `      "content": "// Full runnable test code with describe/it or test blocks..."\n`;
  prompt += `    }\n`;
  prompt += `  ]\n`;
  prompt += `}\n`;
  prompt += `\`\`\`\n\n`;
  prompt += `OUTPUT STRICTLY VALID JSON ONLY. NO OTHER EXPLANATORY TEXT OUTSIDE THE JSON BLOCK.`;

  return withAgentContext(prompt, "integration-test");
};

/**
 * Builds a targeted repair prompt after running generated integration tests against
 * the actual Express app / Jest runner when one or more scenarios fail.
 */
export const buildIntegrationRepairPrompt = ({
  code = "",
  failureSummary = "",
  framework = "supertest",
  endpoints = [],
  sourceCode = [],
  targetFilePath = null,
  missingCases = [],
  unexpectedPaths = [],
} = {}) => {
  const isPlaywright =
    framework === "playwright" ||
    String(framework).toLowerCase().includes("playwright");
  const { entryFiles, routeFiles } = collectAppEntryAndRouteFiles(
    sourceCode,
    endpoints,
  );
  let prompt = `You are a Principal Node.js QA & Test Repair Engineer.\n`;
  prompt += `We executed the generated ${isPlaywright ? "Playwright API" : "Supertest + Jest"} integration test suite${targetFilePath ? ` at \`${targetFilePath}\`` : ""} against the project and one or more test cases FAILED or missed required endpoints.\n`;
  prompt += `Fix ALL failing test cases AND add any missing endpoint scenarios so that EVERY endpoint (${endpoints.length} total) and EVERY required test case passes 100% when executed in Jest (NODE_ENV=test).\n\n`;

  if (targetFilePath) {
    prompt += `### 0. TARGET TEST FILE PATH\n\`${targetFilePath}\` (all relative \`import\`, \`jest.unstable_mockModule\`, \`jest.mock\`, and \`require\` specifiers MUST resolve accurately relative to this file directory).\n\n`;
  }

  prompt += `### 1. CURRENT FAILING TEST FILE\n\`\`\`javascript\n${code}\n\`\`\`\n\n`;
  prompt += `### 2. ACTUAL JEST EXECUTION FAILURE OUTPUT\n\`\`\`\n${String(failureSummary).slice(0, 5000)}\n\`\`\`\n\n`;

  if (
    (Array.isArray(missingCases) && missingCases.length > 0) ||
    (Array.isArray(unexpectedPaths) && unexpectedPaths.length > 0)
  ) {
    prompt += `### 2.5 MISSING OR MISMATCHED ENDPOINT COVERAGE (MUST FIX TO REACH 100%)\n`;
    if (missingCases.length > 0) {
      prompt += `- **MISSING REQUIRED ENDPOINTS/CASES (YOU MUST INCLUDE ALL OF THESE):**\n`;
      for (const mc of missingCases) {
        prompt += `  * \`${mc.method} ${mc.path}\` -> Missing: ${mc.missingLabels.join(", ")}\n`;
      }
    }
    if (unexpectedPaths.length > 0) {
      prompt += `- **WRONG REQUEST PATHS DETECTED IN TESTS (DO NOT USE WRONG PREFIX LIKE \`/api\` UNLESS IN ENTRY FILE):**\n`;
      for (const up of unexpectedPaths) {
        prompt += `  * \`${up.method} ${up.path}\` in test "${up.testName}"\n`;
      }
    }
    prompt += `\n`;
  }

  if (entryFiles.length > 0 || routeFiles.length > 0) {
    prompt += `### 2.8 EXPRESS ENTRY & ROUTE FILES (EXACT APP MOUNTS — CHECK BEFORE TOUCHING ROUTES!)\n`;
    for (const ef of entryFiles) {
      prompt += `\`\`\`javascript\n// Express Entry File: ${ef.path}\n${ef.content.slice(0, 2200)}\n\`\`\`\n`;
    }
    for (const rf of routeFiles) {
      prompt += `\`\`\`javascript\n// Route File: ${rf.path}\n${rf.content.slice(0, 600)}\n\`\`\`\n`;
    }
    prompt += `\n`;
  }

  if (Array.isArray(endpoints) && endpoints.length > 0) {
    prompt += `### 3. ACTUAL ENDPOINT & DEPENDENCY SOURCE CONTEXT (ALL ${endpoints.length} ENDPOINTS)\n`;
    for (const ep of endpoints) {
      const deepCtx = harvestApiDeepContext({ endpoint: ep, sourceCode });
      const reqCases = getEndpointRequiredCases(ep);
      prompt += `- \`${deepCtx.method} ${ep.fullPath || deepCtx.path}\` (${deepCtx.controllerFile}) | Required: ${reqCases.map((c) => c.promptHint).join(", ")}\n`;
      if (deepCtx.controllerSnippet) {
        prompt += `\`\`\`javascript\n${deepCtx.controllerSnippet.slice(0, 1400)}\n\`\`\`\n`;
      }
      for (const mod of (deepCtx.importedModules || []).slice(0, 4)) {
        prompt += `\`\`\`javascript\n// ${mod.filePath}\n${String(mod.content).slice(0, 9000)}\n\`\`\`\n`;
      }
    }
  }

  prompt += `### 4. STRICT REPAIR RULES\n`;
  prompt += `1. Keep ONE single top-level import block (no duplicate imports/declarations).\n`;
  prompt += `2. Fix wrong payloads, missing DB/external service mocks (check every \`prisma.<model>.<method>\` and imported service method in Section 3!), wrong route mount prefixes (check Section 2.8!), or hallucinated response body keys.\n`;
  prompt += `3. Assert ONE exact HTTP status code per test (matching what the controller actually returns for that case).\n`;
  prompt += `4. Do NOT delete failing endpoints or scenarios — fix them so ALL ${endpoints.length} endpoints and ALL required cases are covered AND PASSING. Never replace a real imported route/app handler with a stubbed inline \`app.get(...)\` in the test file.\n`;
  prompt += `5. Return ONLY a JSON object inside \`\`\`json\`\`\`:\n\`\`\`json\n{\n  "content": "// Complete repaired, runnable test file..."\n}\n\`\`\``;

  return withAgentContext(prompt, "integration-test", { phase: "repair" });
};

/**
 * Validates generated test code using Babel AST parser.
 * Checks for syntax validity, framework conformance, and quarantine against dangerous APIs.
 *
 * @param {string} code - Test code content
 * @param {"supertest" | "playwright"} [framework] - Framework
 * @returns {{ valid: boolean, ast: Object }}
 */
export const validateIntegrationTestCode = (
  code = "",
  framework = "supertest",
) => {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new ServiceError("Generated test code is empty", 422);
  }

  const ast = parseCodeToAst(code);

  const checkNode = (node) => {
    if (!node || typeof node !== "object") return;

    // Check dangerous imports
    if (node.type === "ImportDeclaration" && node.source?.value) {
      if (FORBIDDEN_MODULES.includes(node.source.value)) {
        throw new ServiceError(
          `Generated test contains forbidden module import: ${node.source.value}`,
          422,
        );
      }
    }

    // Check dangerous require calls
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments?.[0]?.value &&
      FORBIDDEN_MODULES.includes(node.arguments[0].value)
    ) {
      throw new ServiceError(
        `Generated test contains forbidden module require: ${node.arguments[0].value}`,
        422,
      );
    }

    // Check dangerous function calls
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      FORBIDDEN_IDENTIFIERS.includes(node.callee.name)
    ) {
      throw new ServiceError(
        `Generated test contains forbidden call: ${node.callee.name}()`,
        422,
      );
    }

    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression"
    ) {
      const obj = node.callee.object?.name;
      const prop = node.callee.property?.name;
      const callName = `${obj}.${prop}`;
      if (FORBIDDEN_CALLS.includes(callName)) {
        throw new ServiceError(
          `Generated test contains forbidden call: ${callName}()`,
          422,
        );
      }
    }

    for (const k of Object.keys(node)) {
      const child = node[k];
      if (Array.isArray(child)) {
        for (const item of child) checkNode(item);
      } else if (child && typeof child === "object" && child.type) {
        checkNode(child);
      }
    }
  };

  checkNode(ast.program);

  return { valid: true, ast };
};

/**
 * Builds an AI repair prompt to fix an existing faulty test file based on
 * runtime failure diagnostics and last executed line traces.
 *
 * @param {Object} params
 * @param {string} params.testFileContent - Existing faulty test code
 * @param {string} params.testFilePath - Relative file path of the test
 * @param {Object} params.failureReport - Diagnostic details from diagnoseApiFailureLayer
 * @param {Object} [params.endpoint] - Target API endpoint
 * @param {Array<Object>} [params.sourceCode] - Source code files
 * @param {"supertest" | "playwright"} [params.framework] - Target framework
 * @returns {string} Repair prompt
 */
export const buildFaultyTestFixPrompt = ({
  testFileContent = "",
  testFilePath = "",
  failureReport = {},
  endpoint = {},
  sourceCode = [],
  framework = "supertest",
} = {}) => {
  let prompt = `You are an expert Test Automation Engineer specializing in repairing broken API integration tests.\n`;
  prompt += `A pre-existing test file in the repository failed during execution.\n\n`;

  prompt += `### 1. FAILING TEST FILE: \`${testFilePath}\`\n`;
  prompt += `\`\`\`javascript\n${testFileContent}\n\`\`\`\n\n`;

  prompt += `### 2. RUNTIME FAILURE DIAGNOSTICS & TRACEABILITY\n`;
  prompt += `- **Failure Layer**: \`${failureReport.failureLayer || "UNKNOWN_ERROR"}\`\n`;
  prompt += `- **Explanation**: ${failureReport.explanation || "N/A"}\n`;
  prompt += `- **Failing Component**: \`${failureReport.failingComponent || "Unknown"}\`\n`;

  if (failureReport.lastExecutedLine) {
    prompt += `- **Last Executed Line**: Line ${failureReport.lastExecutedLine.line} in \`${failureReport.lastExecutedLine.filePath || endpoint.controllerFile || "controller"}\`\n`;
    if (failureReport.lastExecutedLine.codeSnippet) {
      prompt += `\`\`\`javascript\n// Last Executed Code Snippet:\n${failureReport.lastExecutedLine.codeSnippet}\n\`\`\`\n`;
    }
  }

  if (failureReport.suggestedFix) {
    prompt += `- **Diagnostic Recommendation**: ${failureReport.suggestedFix}\n`;
  }

  if (endpoint && endpoint.controllerSnippet) {
    prompt += `\n### 3. ACTUAL CONTROLLER IMPLEMENTATION (GROUND TRUTH)\n`;
    prompt += `\`\`\`javascript\n${endpoint.controllerSnippet}\n\`\`\`\n\n`;
  }

  prompt += `### 4. REPAIR INSTRUCTIONS\n`;
  prompt += `1. Fix the broken assertions, payloads, headers, or route paths so the test accurately matches the actual implementation contract.\n`;
  prompt += `2. If the failure layer was \`ASSERTION_FAILED\`, align the expected status code and response body fields with the actual controller response.\n`;
  prompt += `3. If the failure layer was \`MIDDLEWARE_REJECTED\`, supply valid auth headers or mock authorization context.\n`;
  prompt += `4. If the failure layer was \`ROUTER_NOT_FOUND\`, correct the URL path or HTTP method to match the router mount definition.\n`;
  prompt += `5. Output the complete repaired test file in the following JSON format inside a \`\`\`json\`\`\` code block:\n\n`;
  prompt += `\`\`\`json\n`;
  prompt += `{\n`;
  prompt += `  "filePath": "${testFilePath}",\n`;
  prompt += `  "fixedContent": "// Repaired, full runnable test code...",\n`;
  prompt += `  "repairSummary": "Explanation of changes made to fix the test"\n`;
  prompt += `}\n`;
  prompt += `\`\`\`\n`;

  return withAgentContext(prompt, "integration-test", { phase: "repair" });
};
