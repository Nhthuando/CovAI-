import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default || _traverse;
import { ServiceError } from "../utils/serviceError.js";
import { extractValidEndpoints } from "./apiEndpointParser.service.js";
import { normalizeFilePath } from "./unifiedCoverageEngine.service.js";

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
const FORBIDDEN_MODULES = ["child_process", "node:child_process", "cluster", "worker_threads"];
const FORBIDDEN_CALLS = ["process.exit", "fs.rmSync", "fs.rm", "rmdirSync", "child_process.exec"];

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
            plugins: ["jsx", "typescript", "classProperties", "dynamicImport", "objectRestSpread"],
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
    if (!codeSnippet || typeof codeSnippet !== "string" || codeSnippet.trim().length === 0) {
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
                    if (suggestedStatus === 401 || suggestedStatus === 403) category = "AUTH_OR_PERMISSION";
                    else if (suggestedStatus === 404) category = "RESOURCE_NOT_FOUND";
                    else if (suggestedStatus === 409) category = "RESOURCE_CONFLICT";
                    else if (suggestedStatus === 400 || suggestedStatus === 422) category = "VALIDATION_CHECK";
                    else category = "EDGE_CASE";
                } else if (lowerCond.includes("auth") || lowerCond.includes("token") || lowerCond.includes("role") || lowerCond.includes("admin") || lowerCond.includes("unauthorized") || lowerCond.includes("forbidden")) {
                    category = "AUTH_OR_PERMISSION";
                    suggestedStatus = lowerCond.includes("role") || lowerCond.includes("admin") ? 403 : 401;
                } else if (lowerCond.includes("!") && (lowerCond.includes("notfound") || lowerCond.includes("order") || lowerCond.includes("user_id") || lowerCond.includes("exist"))) {
                    category = "RESOURCE_NOT_FOUND";
                    suggestedStatus = 404;
                } else if (lowerCond.includes("duplicate") || lowerCond.includes("conflict")) {
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
                if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;

                const parts = trimmed.split(/\s+/);
                if (parts.length >= 2) {
                    const fieldName = parts[0];
                    const fieldType = parts[1];

                    if (fieldName === "id" || fieldName === "createdAt" || fieldName === "updatedAt") continue;

                    const isOptional = fieldType.includes("?") || trimmed.includes("@default");
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
export const harvestApiDeepContext = ({ endpoint = {}, sourceCode = [] } = {}) => {
    const method = (endpoint.method || "GET").toUpperCase();
    const routePath = endpoint.path || "/";

    // 1. Controller Code Snippet
    let controllerSnippet = endpoint.controllerSnippet || "";
    const controllerFile = endpoint.controllerFile;

    if (!controllerSnippet && controllerFile) {
        const normTarget = normalizeFilePath(controllerFile);
        const fileObj = sourceCode.find((f) => {
            const p = f.path || f.filePath || "";
            return normalizeFilePath(p) === normTarget || p.endsWith(normTarget);
        });
        if (fileObj && fileObj.content) {
            const lines = fileObj.content.split("\n");
            const start = Math.max(0, (endpoint.controllerLineStart || endpoint.controllerLine || 1) - 1);
            const end = Math.min(lines.length, endpoint.controllerLineEnd || (start + 30));
            controllerSnippet = lines.slice(start, end).join("\n");
        }
    }

    // 2. Harvest Branch Conditions from Controller Snippet
    const branchConditions = harvestBranchConditions(controllerSnippet);

    // 3. Database Models & Required Fields
    const allModels = extractDatabaseSchemaConstraints(sourceCode);
    const relatedModels = allModels.filter((m) =>
        (endpoint.databaseModels || []).includes(m.modelName) ||
        controllerSnippet.toLowerCase().includes(m.modelName.toLowerCase())
    );

    // 4. Frontend Consumer Evidence (fetch/axios calls)
    const frontendCallers = (sourceCode || []).filter((f) => {
        const p = f.path || f.filePath || "";
        return (
            (p.includes("client/") || p.includes("frontend/") || p.includes("src/api/")) &&
            (f.content && f.content.includes(routePath))
        );
    }).map((f) => {
        const lines = (f.content || "").split("\n");
        const matchingLines = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(routePath)) {
                matchingLines.push(lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 5)).join("\n"));
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
export const buildIntegrationTestPrompt = ({
    endpoints = [],
    sourceCode = [],
    framework = "supertest",
    uncoveredBranches = [],
} = {}) => {
    const isPlaywright = framework === "playwright";
    const frameworkName = isPlaywright ? "Playwright API Testing (@playwright/test)" : "Supertest + Jest";

    let prompt = `You are a Principal Software Engineer & QA Architect specializing in Node.js API Testing.\n`;
    prompt += `Your task is to generate comprehensive, production-ready integration tests using **${frameworkName}**.\n\n`;

    prompt += `### 1. TARGET FRAMEWORK SPECIFICATION: ${frameworkName.toUpperCase()}\n\n`;

    if (isPlaywright) {
        prompt += `#### Playwright API Testing Guidelines:\n`;
        prompt += `- Use \`import { test, expect } from '@playwright/test';\` (or \`require\` if CommonJS).\n`;
        prompt += `- Use the built-in \`request\` fixture in test arguments: \`test('title', async ({ request }) => { ... });\`.\n`;
        prompt += `- Use standard Playwright API methods: \`await request.get(path)\`, \`await request.post(path, { data: payload })\`, \`await request.put(...)\`, \`await request.delete(...)\`.\n`;
        prompt += `- Status assertions: \`expect(res.status()).toBe(200)\` or \`expect(res.ok()).toBeTruthy()\`.\n`;
        prompt += `- Body assertions: \`const body = await res.json(); expect(body).toHaveProperty('id');\`.\n`;
        prompt += `- Target file path MUST start with: \`tests/api/\` (e.g. \`tests/api/orders.api.spec.js\`).\n\n`;
    } else {
        prompt += `#### Supertest + Jest Guidelines:\n`;
        prompt += `- Use \`import request from 'supertest';\` and import the Express app module.\n`;
        prompt += `- Use inline chain calls: \`const res = await request(app).post(path).send(payload);\`.\n`;
        prompt += `- Status assertions: \`expect(res.status).toBe(200);\`.\n`;
        prompt += `- Body assertions: \`expect(res.body).toHaveProperty('id');\`.\n`;
        prompt += `- DO NOT call \`app.listen()\`. Import the app instance directly.\n`;
        prompt += `- Target file path MUST start with: \`tests/integration/\` (e.g. \`tests/integration/orders.test.js\`).\n\n`;
    }

    prompt += `### 2. MULTI-SCENARIO COVERAGE REQUIREMENTS (MANDATORY 5-TIER STRATEGY)\n`;
    prompt += `For each API Endpoint, you MUST generate scenarios covering all 5 tiers:\n`;
    prompt += `1. **Tier 1 — Happy Path (200 / 201)**: Valid payload containing all required fields. Assert exact status code and returned payload data structure.\n`;
    prompt += `2. **Tier 2 — Negative Validation (400 Bad Request)**: Omit required fields, pass wrong data types (e.g. string for number), or send empty object \`{}\`. Assert 400 Bad Request.\n`;
    prompt += `3. **Tier 3 — Authentication & Authorization (401 Unauthorized / 403 Forbidden)**: If the route has auth middlewares, verify request without token returns 401, or insufficient role returns 403.\n`;
    prompt += `4. **Tier 4 — Not Found & Conflicts (404 Not Found / 409 Conflict)**: Query non-existent ID (e.g. \`999999\` or random UUID) expecting 404, or duplicate unique fields expecting 409.\n`;
    prompt += `5. **Tier 5 — Edge Cases & Boundary Limits**: Empty arrays, negative numbers, special characters, max length boundaries.\n\n`;

    prompt += `### 3. DEEP API ENDPOINT INVENTORY & SOURCE CONTEXT\n\n`;

    const targetList = endpoints.length > 0 ? endpoints : extractValidEndpoints(sourceCode);

    for (const ep of targetList) {
        const deepCtx = harvestApiDeepContext({ endpoint: ep, sourceCode });

        prompt += `#### Endpoint: \`${deepCtx.method} ${deepCtx.path}\`\n`;
        prompt += `- Controller File: \`${deepCtx.controllerFile}\`\n`;

        if (deepCtx.middlewares && deepCtx.middlewares.length > 0) {
            prompt += `- Active Middlewares: ${deepCtx.middlewares.map((m) => m.name || m).join(", ")}\n`;
        }

        if (deepCtx.controllerSnippet) {
            prompt += `\`\`\`javascript\n// Handler Snippet:\n${deepCtx.controllerSnippet.slice(0, 500)}\n\`\`\`\n`;
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
                const reqNames = m.requiredFields.map((f) => `${f.name} (${f.type})`).join(", ");
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
    prompt += `      "filePath": "${isPlaywright ? "tests/api/orders.api.spec.js" : "tests/integration/orders.test.js"}",\n`;
    prompt += `      "content": "// Full runnable test code with describe/it or test blocks..."\n`;
    prompt += `    }\n`;
    prompt += `  ]\n`;
    prompt += `}\n`;
    prompt += `\`\`\`\n\n`;
    prompt += `OUTPUT STRICTLY VALID JSON ONLY. NO OTHER EXPLANATORY TEXT OUTSIDE THE JSON BLOCK.`;

    return prompt;
};

/**
 * Validates generated test code using Babel AST parser.
 * Checks for syntax validity, framework conformance, and quarantine against dangerous APIs.
 *
 * @param {string} code - Test code content
 * @param {"supertest" | "playwright"} [framework] - Framework
 * @returns {{ valid: boolean, ast: Object }}
 */
export const validateIntegrationTestCode = (code = "", framework = "supertest") => {
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
                    422
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
                422
            );
        }

        // Check dangerous function calls
        if (
            node.type === "CallExpression" &&
            node.callee?.type === "Identifier" &&
            FORBIDDEN_IDENTIFIERS.includes(node.callee.name)
        ) {
            throw new ServiceError(`Generated test contains forbidden call: ${node.callee.name}()`, 422);
        }

        if (node.type === "CallExpression" && node.callee?.type === "MemberExpression") {
            const obj = node.callee.object?.name;
            const prop = node.callee.property?.name;
            const callName = `${obj}.${prop}`;
            if (FORBIDDEN_CALLS.includes(callName)) {
                throw new ServiceError(`Generated test contains forbidden call: ${callName}()`, 422);
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

    return prompt;
};
