/**
 * Supertest Prompt Builder Service
 * Builds AI prompts specifically for generating Supertest integration tests.
 */
import { extractValidEndpoints } from "./apiEndpointParser.service.js";
import { withAgentContext } from '../agents/registry.js';
import {
    detectIntegrationLanguage,
    getEndpointRequiredCases,
} from "../../../shared/integrationCaseCoverage.js";
import { extractDatabaseSchemaConstraints } from "./integrationAiTestGenerator.service.js";
import { parsePrismaSchemaModels, generatePrismaSeeds } from "./databaseMockTemplate.service.js";
import { parseJavaScriptCode } from "./babelParser.service.js";
import path from "path";


/**
 * Formats source code files into a readable markdown segment for the prompt.
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {string}
 */
export const includeSourceCode = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) {
        return "No source code available.\n\n";
    }

    const isRouteOrController = (filePath) => {
        return filePath.includes("route") || filePath.includes("router") || filePath.includes("controller") || filePath.includes("service") || filePath.includes("model") || filePath.includes("schema") || filePath.includes("prisma") || filePath.includes("app.") || filePath.includes("index.");
    };

    const sortedFiles = [...sourceCode].sort((a, b) => {
        const aIsPrimary = isRouteOrController(a.path);
        const bIsPrimary = isRouteOrController(b.path);
        if (aIsPrimary && !bIsPrimary) return -1;
        if (!aIsPrimary && bIsPrimary) return 1;
        return 0;
    });

    let segment = "### Source Code\n\n";
    const files = sortedFiles.slice(0, 15);
    files.forEach((file) => {
        segment += `#### File: ${file.path}\n`;
        segment += "```javascript\n";
        const lines = file.content.split("\n").slice(0, 200);
        segment += lines.join("\n") + "\n";
        segment += "```\n\n";
    });

    if (sourceCode.length > 15) {
        segment += `_... and ${sourceCode.length - 15} more files (omitted for brevity)._\n\n`;
    }

    return segment;
};

/**
 * Formats API contract evidence from client callers and existing tests.
 * @param {Array<{path: string, content: string}>} sourceCode
 * @param {Array<{path: string, content: string}>} testFiles
 * @returns {string}
 */
export const includeContractContext = (sourceCode = [], testFiles = []) => {
    let segment = "### API Contract Evidence & Client Consumers (Ground Truth)\n\n";
    let hasContent = false;

    // 1. Client API Consumers (Frontend services, fetch/axios callers)
    const clientFiles = (sourceCode || []).filter(f =>
        f.path.includes("client/") && (f.path.includes("api.") || f.path.includes("service") || f.content?.includes("fetch(") || f.content?.includes("axios"))
    );

    if (clientFiles.length > 0) {
        hasContent = true;
        segment += "#### Frontend Client API Consumer Expectations\n";
        clientFiles.slice(0, 4).forEach(f => {
            segment += `##### File: \`${f.path}\`\n\`\`\`javascript\n`;
            segment += f.content.split("\n").slice(0, 90).join("\n") + "\n```\n\n";
        });
    }

    // 2. Existing Tests (Established Response Schemas, Status Contracts, and Naming Language/Style)
    const existingTests = (testFiles || []).filter(f => {
        const filePath = String(f?.path || "");
        const content = String(f?.content || "");
        if (filePath.includes("node_modules") || filePath.includes(".covai-temp")) return false;
        return (
            filePath.includes("integration") ||
            filePath.includes("unit") ||
            filePath.includes("api.test") ||
            /supertest|request\s*\(|superagent/i.test(content)
        );
    }).sort((a, b) => {
        const aUser = String(a?.content || "").includes("[AI GENERATED]") ? 1 : 0;
        const bUser = String(b?.content || "").includes("[AI GENERATED]") ? 1 : 0;
        return aUser - bUser;
    });

    if (existingTests.length > 0) {
        hasContent = true;
        segment += "#### Existing Test Suites (Established Contracts, Setup & Naming Language)\n";
        existingTests.slice(0, 4).forEach(f => {
            segment += `##### File: \`${f.path}\`\n\`\`\`javascript\n`;
            segment += f.content.split("\n").slice(0, 120).join("\n") + "\n```\n\n";
        });
    }

    return hasContent ? segment : "";
};

/**
 * Formats database schema models and required fields for prompt context.
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {string}
 */
export const includeDatabaseSchemaContext = (sourceCode = []) => {
    let segment = "### Database Schema & Model Constraints (Ground Truth for Request Payloads)\n\n";
    let hasSchema = false;

    const prismaFiles = (sourceCode || []).filter(f => f.path.endsWith(".prisma") || f.path.includes("schema.prisma"));
    for (const file of prismaFiles) {
        hasSchema = true;
        segment += `#### Prisma Schema File (\`${file.path}\`)\n`;
        segment += "```prisma\n" + file.content + "\n```\n\n";
        try {
            const parsedModels = parsePrismaSchemaModels(file.content);
            const seeds = generatePrismaSeeds(parsedModels);
            const seedPreview = {};
            for (const [mKey, rows] of Object.entries(seeds)) {
                if (Array.isArray(rows) && rows.length > 0) seedPreview[mKey] = rows.slice(0, 2);
            }
            if (Object.keys(seedPreview).length > 0) {
                segment += "#### Pre-Seeded Mock Database Records (Available in In-Memory Prisma Store at Test Start)\n";
                segment += "```json\n" + JSON.stringify(seedPreview, null, 2) + "\n```\n\n";
            }
        } catch (_) {}
    }

    const mongooseFiles = (sourceCode || []).filter(
        f => /mongoose\.model|new\s+(?:mongoose\.)?Schema/i.test(f.content || "")
    );
    if (mongooseFiles.length > 0) {
        hasSchema = true;
        segment += "#### Mongoose Model Definitions (In-Memory Mock Active — Pre-Seeded `_id`: `'507f191e810c19729de860ea'`)\n";
        mongooseFiles.slice(0, 5).forEach(f => {
            segment += `##### File: \`${f.path}\`\n\`\`\`javascript\n${(f.content || "").split("\n").slice(0, 80).join("\n")}\n\`\`\`\n\n`;
        });
    }

    if (hasSchema) {
        segment += "**CRITICAL DATABASE SCHEMA VALIDATION RULES:**\n";
        segment += "- When writing happy-path tests for POST/PUT creation endpoints, your request body MUST provide all required non-nullable fields defined in the database schema without @default.\n";
        try {
            const models = extractDatabaseSchemaConstraints(sourceCode);
            models.forEach(m => {
                const reqList = m.requiredFields.map(f => `${f.name} (${f.type})`).join(", ");
                segment += `- Model \`${m.modelName}\`: Required non-nullable fields: [${reqList || 'none'}]\n`;
            });
            segment += "\n";
        } catch (_) {}
    }

    return hasSchema ? segment : "";
};

/**
 * Formats API route information into the prompt segment.
 * Now includes a structured endpoint table extracted from source code.
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {string}
 */
export const includeRouteContext = (sourceCode, targetEndpoints = null, options = {}) => {
    if (!sourceCode || sourceCode.length === 0) return "";

    const endpoints = targetEndpoints || extractValidEndpoints(sourceCode);
    const language = options?.language === "vi" ? "vi" : "en";

    let segment = "### VALID API ENDPOINTS (Extracted from Source Code)\n\n";

    if (endpoints.length > 0) {
        segment += "**YOU MUST ONLY USE THESE ENDPOINTS. DO NOT INVENT ANY OTHER ENDPOINTS.**\n\n";
        segment += "| Method | Path | Controller | Middleware | Payload Schema | DB Models | Source File | Required Coverage Focus |\n";
        segment += "|--------|------|------------|------------|----------------|-----------|-------------|-------------------------|\n";
        const endpointsWithExisting = [];
        for (const ep of endpoints) {
            const controller = ep.controllerMethod || "-";
            const middleware = ep.middleware ? ep.middleware.join(", ") : "-";
            const payload = ep.requestBodySchema ? ep.requestBodySchema.join(", ") : "-";
            const db = ep.databaseModels ? ep.databaseModels.join(", ") : "-";
            const requiredHints =
                Array.isArray(ep.missingCoverageRequested) && ep.missingCoverageRequested.length > 0
                    ? ep.missingCoverageRequested
                    : getEndpointRequiredCases(ep).map((c) => c.promptHint);
            const missing = requiredHints.join(" AND ");
            segment += `| ${ep.method} | ${ep.fullPath} | ${controller} | ${middleware} | ${payload} | ${db} | ${ep.sourceFile} | ${missing} |\n`;
            if (Array.isArray(ep.existingScenarios) && ep.existingScenarios.length > 0) {
                endpointsWithExisting.push(ep);
            }
        }
        segment += "\n";
        if (endpointsWithExisting.length > 0) {
            segment += "#### Existing User Scenarios (Preserved Automatically — Reference Only)\n";
            for (const ep of endpointsWithExisting) {
                segment += `- **${ep.method} ${ep.fullPath}**:\n`;
                for (const ex of ep.existingScenarios) {
                    const statusText = ex.expectedStatus ? `Expected ${ex.expectedStatus}` : "Status asserted";
                    const caseText = ex.caseLabel || ex.caseKey || "Covered";
                    segment += `  * \`${ex.testName}\` (${caseText}, ${statusText}) — preserved as user scenario.\n`;
                }
            }
            segment += "\n";
        }

        const totalRequiredTests = endpoints.reduce((sum, ep) => {
            const count = Array.isArray(ep.missingCoverageRequested) && ep.missingCoverageRequested.length > 0
                ? ep.missingCoverageRequested.length
                : getEndpointRequiredCases(ep).length;
            return sum + count;
        }, 0);

        segment += `**CRITICAL TOKEN-SAVING CAP:** For each endpoint listed above, write **EXACTLY ONE dedicated \`it(...)\` test block for EACH individual item** in 'Required Coverage Focus' (TOTAL = **${totalRequiredTests}** \`it(...)\` blocks across all endpoints — NEVER generate extra/bonus scenarios beyond those exact items! Always generate the exact proposed cases even if user scenarios exist; overlap is labeled automatically in the UI).\n`;
        segment += "**STRICT STATUS ASSERTION RULE:** Inspect the controller implementation and assert a **SINGLE exact HTTP status code** per test (`expect(res.status).toBe(200)`, `expect(res.status).toBe(400)`, `expect(res.status).toBe(404)`). **NEVER** use `expect([...]).toContain(res.status)` with multiple unrelated codes like `[200, 201, 404]` or `[400, 422, 404, 500]`.\n";
        if (language === "vi") {
            segment += "**LANGUAGE RULE (MANDATORY — VIETNAMESE):** The existing tests and/or API messages in this repository are in **Vietnamese**. You MUST write ALL `describe(...)` and `it(...)` test descriptions, inline comments, and `suggestions[].message` in **natural Vietnamese** matching the project's existing test style (e.g., `'Thành công (200): Xóa lớp học hợp lệ'`, `'Lỗi dữ liệu (400): Mã lớp học không hợp lệ'`, `'Không tìm thấy (404): Lớp học không tồn tại'`). Do NOT write English test titles!\n";
        } else {
            segment += "**LANGUAGE RULE (ENGLISH):** Name each `it(...)` test clearly in English matching its case ('happy path: ...', 'validation 400: ...', '401/403 unauthorized: ...', '404 not found: ...', or '500 edge case: ...').\n";
        }
        segment += "Do NOT invent any endpoints not in this table!\n\n";
        segment += "**STRICT SCOPE RESTRICTION (CRITICAL):** The user has SELECTIVELY picked only the endpoints listed in the table above. Even if the provided source code files contain other route definitions (e.g. other endpoints in the same route or controller file), you are STRICTLY FORBIDDEN from generating any `describe()`, `it()`, or `test()` blocks for any endpoint NOT present in the table. Generating tests for unselected routes will cause an immediate rejection.\n\n";
    } else {
        segment += "No specific route definitions were detected. Analyze the source code carefully to identify endpoints.\n\n";
    }

    // Also list route/controller files for reference
    const routeFiles = sourceCode.filter(
        (f) =>
            f.path.includes("route") ||
            f.path.includes("router") ||
            f.path.includes("controller") ||
            f.path.includes("app.js") ||
            f.path.includes("index.js")
    );

    if (routeFiles.length > 0) {
        segment += "### Route / Controller / App Files\n\n";
        routeFiles.slice(0, 10).forEach((file) => {
            segment += `- **${file.path}**\n`;
        });
        segment += "\n";
    }

    return segment;
};

/**
 * Detects the backend subpackage prefix (e.g. "server", "backend", "api", or "")
 * so generated integration tests sit inside the backend package's test root.
 */
export const detectBackendSubdir = (sourceCode = [], testFiles = []) => {
    const allPaths = [...(sourceCode || []), ...(testFiles || [])]
        .map((f) => String(f?.path || "").replace(/\\/g, "/"))
        .filter(Boolean);

    for (const sub of ["server", "backend", "api"]) {
        const hasBackendFiles = allPaths.some((p) =>
            p.startsWith(`${sub}/`) && (
                p.includes("/routes/") ||
                p.includes("/controllers/") ||
                p.endsWith("/index.js") ||
                p.endsWith("/app.js") ||
                p.endsWith("/server.js") ||
                p.includes("/tests/integration/")
            )
        );
        if (hasBackendFiles) return sub;
    }
    return "";
};

export const detectIntegrationTestBaseDir = (sourceCode = [], testFiles = []) => {
    const sub = detectBackendSubdir(sourceCode, testFiles);
    return sub ? `${sub}/tests/integration` : "tests/integration";
};

const analyzeEntryExports = (content = "", filePath = "") => {
    const info = {
        hasDefaultExport: false,
        hasNamedAppExport: false,
        hasTopLevelListen: false,
        mountedRouters: [],
        inlineRoutes: [],
    };
    if (!content) return info;

    const parsed = parseJavaScriptCode(content, { filePath });
    if (!parsed.success || !parsed.ast?.program?.body) {
        info.hasDefaultExport = /\bexport\s+default\b/.test(content);
        info.hasNamedAppExport = /\bexport\s+(?:const|let|var)\s+app\b|\bexport\s*\{[^}]*\bapp\b/.test(content);
        info.hasTopLevelListen = /\.listen\s*\(/.test(content);
        return info;
    }

    const importMap = new Map();
    for (const stmt of parsed.ast.program.body) {
        if (stmt.type === "ImportDeclaration") {
            const spec = stmt.source?.value;
            if (!spec) continue;
            for (const sp of stmt.specifiers || []) {
                importMap.set(sp.local?.name, {
                    source: spec,
                    imported: sp.type === "ImportDefaultSpecifier" ? "default" : (sp.imported?.name || sp.local?.name),
                });
            }
        } else if (stmt.type === "ExportDefaultDeclaration") {
            info.hasDefaultExport = true;
        } else if (stmt.type === "ExportNamedDeclaration") {
            if (stmt.declaration?.type === "VariableDeclaration") {
                for (const d of stmt.declaration.declarations || []) {
                    if (d.id?.name === "app") info.hasNamedAppExport = true;
                }
            }
            for (const sp of stmt.specifiers || []) {
                if ((sp.exported?.name || sp.exported?.value) === "app") info.hasNamedAppExport = true;
            }
        } else if (stmt.type === "ExpressionStatement") {
            const expr = stmt.expression;
            if (expr?.type === "CallExpression" && expr.callee?.type === "MemberExpression") {
                const objName = expr.callee.object?.name;
                const propName = expr.callee.property?.name;
                if (propName === "listen") {
                    info.hasTopLevelListen = true;
                }
                if (objName === "app" && propName === "use") {
                    const firstArg = expr.arguments?.[0];
                    const secondArg = expr.arguments?.[1];
                    const mountPrefix = firstArg?.type === "StringLiteral" ? firstArg.value : null;
                    const handlerNode = mountPrefix ? secondArg : firstArg;
                    if (handlerNode?.type === "Identifier" && importMap.has(handlerNode.name)) {
                        const imported = importMap.get(handlerNode.name);
                        if (imported.source.startsWith(".")) {
                            info.mountedRouters.push({
                                varName: handlerNode.name,
                                prefix: mountPrefix,
                                source: imported.source,
                                imported: imported.imported,
                            });
                        }
                    }
                }
                if (objName === "app" && ["get", "post", "put", "patch", "delete"].includes(propName)) {
                    const routeArg = expr.arguments?.[0];
                    if (routeArg?.type === "StringLiteral") {
                        info.inlineRoutes.push({
                            method: propName.toUpperCase(),
                            path: routeArg.value,
                        });
                    }
                }
            }
            // Check module.exports = app / module.exports = { app }
            if (expr?.type === "AssignmentExpression" && expr.left?.type === "MemberExpression") {
                const leftObj = expr.left.object?.name;
                const leftProp = expr.left.property?.name;
                if (leftObj === "module" && leftProp === "exports") {
                    if (expr.right?.type === "Identifier" && expr.right.name === "app") {
                        info.hasDefaultExport = true;
                    } else if (expr.right?.type === "ObjectExpression") {
                        const props = expr.right.properties || [];
                        if (props.some((p) => (p.key?.name || p.key?.value) === "app")) {
                            info.hasNamedAppExport = true;
                        }
                    }
                }
            }
        }
    }
    return info;
};

/**
 * Detects the correct app entry point context and exact import strategy.
 * Handles default exports, named `{ app }` exports, and route-composed monorepos where `index.js` does not export `app`.
 */
export const detectAppEntryContext = (sourceCode = [], testFiles = [], testFilePath = null) => {
    const testBaseDir = detectIntegrationTestBaseDir(sourceCode, testFiles);
    const effectiveTestFile = testFilePath || `${testBaseDir}/api.test.js`;
    const fromDir = path.posix.dirname(effectiveTestFile.replace(/\\/g, "/"));
    const relFromTest = (targetPath) => {
        const cleanTarget = String(targetPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
        let rel = path.posix.relative(fromDir, cleanTarget);
        if (!rel.startsWith(".")) rel = `./${rel}`;
        return rel;
    };

    const candidates = (sourceCode || []).filter((f) => {
        const p = String(f?.path || "").replace(/\\/g, "/");
        if (!p || p.includes("node_modules") || p.includes("test") || p.startsWith("client/") || p.startsWith("frontend/")) return false;
        return /(?:^|\/)(?:app|index|server)\.[cm]?[jt]s$/i.test(p);
    });
    candidates.sort((a, b) => {
        const score = (p) => (/app\.[cm]?[jt]s$/i.test(p) ? 0 : /index\.[cm]?[jt]s$/i.test(p) ? 1 : 2);
        return score(a.path) - score(b.path);
    });

    const entry = candidates[0] || null;
    if (!entry) {
        return {
            testBaseDir,
            entryPath: null,
            appImportPath: "../../server/src/app.js",
            exportKind: "COMPOSE_ROUTES",
            exportsApp: false,
            mountedRouters: [],
            inlineRoutes: [],
        };
    }

    const exportsInfo = analyzeEntryExports(entry.content || "", entry.path);
    const appImportPath = relFromTest(entry.path);
    let exportKind = "COMPOSE_ROUTES";
    if (exportsInfo.hasDefaultExport && !exportsInfo.hasTopLevelListen) {
        exportKind = "DEFAULT_EXPORT";
    } else if (exportsInfo.hasNamedAppExport && !exportsInfo.hasTopLevelListen) {
        exportKind = "NAMED_APP_EXPORT";
    } else if (exportsInfo.hasDefaultExport) {
        exportKind = "DEFAULT_EXPORT";
    } else if (exportsInfo.hasNamedAppExport) {
        exportKind = "NAMED_APP_EXPORT";
    }

    const entryDir = path.posix.dirname(String(entry.path).replace(/\\/g, "/"));
    const mountedRouters = exportsInfo.mountedRouters.map((r) => {
        const resolved = path.posix.normalize(path.posix.join(entryDir, r.source));
        return { ...r, resolvedPath: resolved, importFromTest: relFromTest(resolved) };
    });

    return {
        testBaseDir,
        entryPath: entry.path,
        appImportPath,
        exportKind,
        exportsApp: exportKind !== "COMPOSE_ROUTES",
        hasTopLevelListen: exportsInfo.hasTopLevelListen,
        mountedRouters,
        inlineRoutes: exportsInfo.inlineRoutes,
    };
};

const detectAppImportPath = (sourceCode, testFiles = []) => {
    return detectAppEntryContext(sourceCode, testFiles).appImportPath;
};

export const includeSupertestInstructions = (sourceCode, options = {}) => {
    const appContext = detectAppEntryContext(sourceCode, options?.testFiles || []);
    const appImportPath = appContext.appImportPath;
    const moduleType = options?.moduleType || "auto";
    const usesPrisma = (sourceCode || []).some((f) => /@prisma\/client|prisma\.(?:find|create|update|delete|upsert|count)/.test(f.content || ""));

    let segment = "### Integration Test Generation Rules\n\n";
    segment += "You MUST generate **Supertest + Jest** integration tests to verify the complete API processing flow (Client -> Route -> Controller -> Service -> Database -> Response).\n\n";
    
    segment += "#### 1. API Flow & Application Startup\n";
    if (appContext.exportKind === "COMPOSE_ROUTES") {
        segment += `- **CRITICAL (ROUTE COMPOSITION MODE):** \`${appContext.entryPath || "index.js"}\` does **NOT** export \`app\` (and/or calls \`listen()\` at startup). **DO NOT** import \`app\` from \`${appImportPath}\`! Importing it directly will crash with \`SyntaxError: does not provide an export named 'default'\`.\n`;
        segment += "- Instead, create a fresh Express app inside the test file and mount only the route/middleware modules being tested:\n";
        if (moduleType === "commonjs") {
            segment += "  ```js\n  const express = require('express');\n  const request = require('supertest');\n  const eventRoutes = require('../../src/routes/event.routes.js');\n  const app = express(); app.use(express.json()); app.use(eventRoutes);\n  ```\n";
        } else {
            segment += "  ```js\n  import { jest, describe, it, expect, beforeEach } from '@jest/globals';\n  import express from 'express';\n  import request from 'supertest';\n  // Register await jest.unstable_mockModule(...) FIRST, then dynamically await import routes:\n  const { default: routeMod } = await import('../../src/routes/...');\n  const app = express(); app.use(express.json()); app.use(routeMod);\n  ```\n";
            if (appContext.mountedRouters.length > 0) {
                segment += `- **Detected Route / Middleware Modules** (import relative to \`${appContext.testBaseDir}/\`): ${appContext.mountedRouters.map((r) => `\`${r.importFromTest}\`${r.prefix ? ` mounted at \`${r.prefix}\`` : ""}`).join(", ")}.\n`;
            }
            if (appContext.inlineRoutes.length > 0) {
                segment += `- **Inline Routes in entry file**: ${appContext.inlineRoutes.map((r) => `\`${r.method} ${r.path}\``).join(", ")} — reproduce simple health routes on the test \`app\` if testing them.\n`;
            }
        }
    } else if (appContext.exportKind === "NAMED_APP_EXPORT") {
        segment += `- **CRITICAL:** \`${appContext.entryPath}\` exports \`app\` as a **NAMED** export! Import it as \`${moduleType === "commonjs" ? `const { app } = require('${appImportPath}');` : `const { app } = await import('${appImportPath}');`}\` — NEVER use default import \`import app from ...\`. DO NOT call \`app.listen()\`.\n`;
    } else {
        segment += `- **CRITICAL: Import the app from \`${appImportPath}\`** (default export, WITHOUT calling \`app.listen()\`). DO NOT import from \`server.js\` if it starts the HTTP server on a port.\n`;
    }

    if (moduleType === "commonjs") {
        segment += "- **MODULE SYNTAX (MANDATORY — COMMONJS):** This project runs Jest in **CommonJS** mode. You MUST use `const request = require('supertest');` and `require(...)`. Do NOT use ES module `import` syntax.\n";
    } else if (moduleType === "esm") {
        segment += "- **MODULE SYNTAX (MANDATORY — ES MODULES):** This project runs Jest in **ES Module** (`--experimental-vm-modules`) mode. Use `import { jest, describe, it, expect, beforeEach } from '@jest/globals';`, `import request from 'supertest';`, ALWAYS include `.js` extensions on all relative module paths, register any module mocks using `await jest.unstable_mockModule(...)` BEFORE dynamically calling `await import(...)`, and place test files under `" + appContext.testBaseDir + "/`.\n";
    } else {
        segment += "- Match the project's module system (`import` with `.js` extensions for `" + '"type": "module"' + "`, `require` for CommonJS).\n";
    }
    segment += "- **AST PARSER COMPATIBILITY (CRITICAL):** You MUST write tests using inline Supertest chains exactly like: `await request(app).get('/api/users')`. DO NOT assign `request(app)` to a variable first. DO NOT abstract it into a helper function. The `request(app)` call MUST be inline inside the `it()` or `test()` block or else the tests will be silently ignored.\n";
    segment += "- DO NOT start the Express server on a port (do not call `app.listen()`).\n";
    segment += "- Send realistic request bodies, query params, and path params.\n";
    segment += "- Assert meaningful HTTP status codes and response bodies (`expect(res.status).toBe(200)`).\n";
    segment += "- Do NOT use `describe.only` or `it.only`.\n\n";

    segment += "#### ENDPOINT VERIFICATION (MANDATORY)\n";
    segment += "- **NEVER invent an endpoint or generate tests for unlisted routes.** Every HTTP method + path in your tests MUST appear in the 'VALID API ENDPOINTS' table above.\n";
    segment += "- For EVERY endpoint present in the 'VALID API ENDPOINTS' table (including `GET /` if listed in the table), you MUST generate test scenarios according to the 'Required Coverage Focus' column.\n";
    segment += "- If an endpoint is NOT in the table, DO NOT generate any tests or describe blocks for it.\n\n";

    segment += "#### 2. Database & External Dependencies\n";
    if (moduleType === "esm") {
        segment += "- **ESM DATABASE & AI SDK MOCKING (CRITICAL):** In `--experimental-vm-modules`, `setupFilesAfterEnv` `jest.mock()` does **NOT** intercept ES `import` statements! You MUST mock database modules (`@prisma/client` and relative `prisma.js` path) AND external network AI SDKs (`@google/generative-ai` / `ai.service.js`) using `await jest.unstable_mockModule(...)` **BEFORE** calling `const { ... } = await import(...)` on your routes/controllers so tests NEVER fail trying to reach Postgres/external Gemini APIs.\n";
        if (usesPrisma) {
            segment += "- Include realistic mock return values on Prisma model `jest.fn()` stubs matching the route/service expectations.\n";
        }
    } else {
        segment += "- **AUTOMATED DATABASE MOCKING ACTIVE:** CovAI provides an in-memory database mock environment (Prisma/Mongoose/SQL) via Jest's `setupFilesAfterEnv`.\n";
        segment += "- **STRICT PROHIBITION ON INTERNAL SERVICE/CONTROLLER MOCKING:** DO NOT mock internal controllers/services in CommonJS when testing integrated DB flows via Supertest HTTP requests.\n";
    }
    segment += "\n";

    segment += "#### 3. Multi-Scenario 5-Tier Testing Strategy (Ground Truth & Contract-Driven)\n";
    segment += "- **TIER 1 — Happy Path (200/201)**: Provide valid payloads fulfilling all non-nullable database and schema constraints. Assert exact success status and returned payload fields.\n";
    segment += "- **TIER 2 — Negative Validation (400)**: Intentionally omit required schema fields or send invalid data types to test rejection and error messaging.\n";
    segment += "- **TIER 3 — Authentication & Authorization (401/403)**: For endpoints with auth middlewares, verify that missing or invalid tokens return 401, and unauthorized roles return 403.\n";
    segment += "- **TIER 4 — Not Found & Conflicts (404/409)**: Query non-existent entities (such as non-existent IDs like 999999) to verify 404, and duplicate unique records to verify 409.\n";
    segment += "- **TIER 5 — Edge Cases & Boundary Values**: Test boundary conditions such as empty collections, zero/negative quantities, and special characters.\n";
    segment += "- **RESPONSE SCHEMA CONTRACT**: Inspect the controller return statements, service handlers, and frontend callers provided above before writing assertions. Always assert real payload properties returned by the code rather than guessing.\n\n";
    segment += "#### 4. Security & Authentication\n";
    segment += "- **SECURITY (CRITICAL):** Explicitly DO NOT hardcode real production credentials, API keys, or JWT tokens in the test files.\n";
    segment += "- Require the use of environment variables (e.g., `process.env.TEST_JWT_SECRET`) or inject a mocked auth context to bypass middlewares safely.\n\n";

    return segment;
};

export const includeSupertestOutputFormat = (options = {}) => {
    const isCjs = options?.moduleType === "commonjs";
    const testBaseDir = options?.testBaseDir || "tests/integration";
    const appImportPath = options?.appImportPath || "../../src/app.js";
    const sampleContent = isCjs
        ? `"const request = require(\\'supertest\\');\\nconst app = require(\\'${appImportPath}\\');\\n\\ndescribe(\\'User API\\', () => { it(\\'happy path: should return 200\\', async () => { const res = await request(app).get(\\'/api/users\\'); expect(res.status).toBe(200); }); });"`
        : `"import { jest, describe, it, expect } from \\'@jest/globals\\';\\nimport express from \\'express\\';\\nimport request from \\'supertest\\';\\nconst app = express(); app.use(express.json());\\n\\ndescribe(\\'User API\\', () => { it(\\'happy path: should return 200\\', async () => { const res = await request(app).get(\\'/api/users\\'); expect(res.status).toBe(200); }); });"`;
    let segment = "### Required Output Format\n\n";
    segment += "You MUST output a **JSON object** wrapped in a markdown code block (```json ... ```).\n";
    segment += "The JSON must have TWO keys: `suggestions` (for test planning / chain of thought) and `tests` (for code generation):\n\n";
    segment += "```json\n";
    segment += "{\n";
    segment += '  "suggestions": [\n';
    segment += "    {\n";
    segment += '      "filePath": "src/controllers/users.controller.js",\n';
    segment += '      "functionName": "POST /api/users",\n';
    segment += '      "priority": "HIGH",\n';
    segment += '      "message": "Missing email should return 400 Bad Request."\n';
    segment += "    }\n";
    segment += "  ],\n";
    segment += '  "tests": [\n';
    segment += "    {\n";
    segment += `      "filePath": "${testBaseDir}/users.test.js",\n`;
    segment += `      "content": ${sampleContent}\n`;
    segment += "    }\n";
    segment += "  ]\n";
    segment += "}\n";
    segment += "```\n\n";
    
    segment += "**Rules for `suggestions`:**\n";
    segment += "- Think step-by-step! Before writing code, use the `suggestions` array to plan out exactly which endpoints you will test, and what scenarios (happy path, error edges) you will cover.\n";
    segment += "- `filePath`: The controller or router file related to the endpoint.\n";
    segment += "- `functionName`: The HTTP method and route path (e.g., `POST /api/users`).\n";
    segment += "- `priority`: Use `HIGH` for critical happy paths and security errors, `MEDIUM` for standard validation errors.\n";
    segment += "- `message`: A short description of the test scenario.\n\n";

    segment += "**Rules for `tests`:**\n";
    segment += "- `filePath`: relative path starting with `tests/integration/`.\n";
    segment += "- `content`: Complete, runnable Jest+Supertest test file code that implements the scenarios planned in `suggestions`.\n";
    segment += "- Do NOT include explanations outside the JSON.\n\n";

    return segment;
};

/**
 * Formats backward path constraints and uncovered branch conditions for AI test generation.
 * @param {Array<{type: string, condition: string, requiredBranch: string, line: number, uncoveredLine?: number, filePath?: string, status?: string}>} pathConstraints
 * @returns {string}
 */
export const includePathConstraints = (pathConstraints = []) => {
    if (!pathConstraints || !Array.isArray(pathConstraints) || pathConstraints.length === 0) {
        return "";
    }

    let segment = "### Backward Path Slicing & Uncovered Branch Constraints (Target Execution Paths)\n\n";
    segment += "The following uncovered code branches and their gating conditions have been traced back to source code via AST backward path slicing.\n";
    segment += "Your generated Supertest scenarios **MUST target these specific branch conditions** to execute previously uncovered lines:\n\n";

    pathConstraints.slice(0, 10).forEach((pc, idx) => {
        const fileRef = pc.filePath ? `File: \`${pc.filePath}\` | ` : "";
        const targetLineRef = pc.uncoveredLine ? ` (Uncovered target line ${pc.uncoveredLine})` : "";
        const lineRef = pc.line ? `Line ${pc.line}` : "Unknown line";

        segment += `${idx + 1}. **${fileRef}${lineRef}${targetLineRef}**\n`;
        segment += `   - **Branch Construct**: \`${pc.type || 'CONTROL_FLOW'}\`\n`;

        if (pc.status === 'UNRESOLVED' || pc.condition === 'unresolved') {
            segment += `   - **Condition**: Unresolved expression at line ${pc.line || 'unknown'} (ambiguous, dynamic, or non-static branch)\n`;
            segment += `   - **Status**: UNRESOLVED (not a verified deterministic path constraint)\n`;
            segment += `   - **Testing Guidance**: Do NOT assume a verified condition. Test this endpoint with exploratory edge-case inputs to probe this unreached path.\n`;
        } else {
            segment += `   - **Condition Expression**: \`${pc.condition}\`\n`;
            segment += `   - **Required Branch Outcome**: **\`${pc.requiredBranch}\`**\n`;
            if (pc.type === 'IF') {
                const isServerContext = /req\.(user|session|auth|token|claims)/i.test(pc.condition);
                if (isServerContext) {
                    segment += `   - **Testing Action**: Server-side auth context condition! DO NOT pass this in \`req.body\`. Set proper \`Authorization\` headers (e.g. \`.set('Authorization', 'Bearer ...')\`) or authenticate through the project's auth route/helper to ensure \`${pc.condition}\` evaluates to **${pc.requiredBranch}**.\n`;
                } else {
                    segment += `   - **Testing Action**: Send request data causing \`${pc.condition}\` to evaluate to **${pc.requiredBranch}**.\n`;
                }
            } else if (pc.type === 'SWITCH') {
                segment += `   - **Testing Action**: Supply request parameters matching switch case: \`${pc.condition}\`.\n`;
            } else if (pc.type === 'TRY_CATCH') {
                segment += `   - **Testing Action**: ${pc.requiredBranch === 'CATCH' ? 'Trigger an exception in the tested route to exercise this catch handler.' : 'Ensure smooth execution without throwing.'}\n`;
            } else if (pc.type === 'TERNARY') {
                segment += `   - **Testing Action**: Supply input causing ternary condition \`${pc.condition}\` to evaluate to **${pc.requiredBranch}**.\n`;
            }
        }
        segment += "\n";
    });

    if (pathConstraints.length > 10) {
        segment += `_... and ${pathConstraints.length - 10} more branch constraints omitted for brevity._\n\n`;
    }

    segment += "**CRITICAL INSTRUCTION:** For every branch condition above, create at least one dedicated test scenario explicitly engineered to fulfill that branch requirement!\n\n";

    return segment;
};

/**
 * Main function: builds the complete Supertest generation prompt.
 * @param {Object} payload - AI context payload
 * @param {Array} targetEndpoints - Optional array of endpoints to restrict generation to
 * @param {Array} pathConstraints - Optional array of backward path slicing constraints
 * @returns {string} The complete prompt string
 */
export const buildSupertestPrompt = (payload, targetEndpoints = null, pathConstraints = [], options = {}) => {
    const existingScenarios = Array.isArray(targetEndpoints)
        ? targetEndpoints.flatMap((ep) => (Array.isArray(ep?.existingScenarios) ? ep.existingScenarios : []))
        : [];
    const language = detectIntegrationLanguage({
        existingScenarios,
        testFiles: payload?.testFiles || [],
        sourceCode: payload?.sourceCode || [],
    });
    const moduleType = options?.moduleType || payload?.moduleType || "auto";

    let prompt = "You are an expert Backend QA Engineer. Your task is to analyze the provided source code, API contracts, existing test suites, and client consumers to generate comprehensive Supertest integration test files for the API endpoints.\n\n";

    if (language === "vi") {
        prompt += "**OUTPUT LANGUAGE REQUIREMENT:** Existing tests and/or controller messages in this codebase use **Vietnamese**. You MUST write all `describe(...)`, `it(...)` test titles, comments, and `suggestions[].message` in natural **Vietnamese**, while keeping valid JavaScript/Supertest code and matching existing test style.\n\n";
    }

    prompt += "---\n\n";

    if (payload.sourceCode) {
        prompt += includeSourceCode(payload.sourceCode);
        prompt += includeDatabaseSchemaContext(payload.sourceCode);
        prompt += includeContractContext(payload.sourceCode, payload.testFiles);
        prompt += includeRouteContext(payload.sourceCode, targetEndpoints, { language });
    }

    const effectiveConstraints = (Array.isArray(pathConstraints) && pathConstraints.length > 0)
        ? pathConstraints
        : (Array.isArray(payload?.pathConstraints) ? payload.pathConstraints : []);

    if (effectiveConstraints.length > 0) {
        prompt += includePathConstraints(effectiveConstraints);
    }

    prompt += includeSupertestInstructions(payload.sourceCode, { moduleType, testFiles: payload?.testFiles || [] });
    const appCtxForFormat = detectAppEntryContext(payload?.sourceCode || [], payload?.testFiles || []);
    prompt += includeSupertestOutputFormat({
        moduleType,
        testBaseDir: appCtxForFormat.testBaseDir,
        appImportPath: appCtxForFormat.appImportPath,
    });

    prompt += "---\n\n";
    prompt += "Now analyze the source code and contracts above and generate the Supertest integration test files in the exact JSON format specified. Output ONLY the JSON object inside a markdown code block. Do NOT add any explanations before or after the JSON block.";

    return withAgentContext(prompt, 'integration-test');
};
