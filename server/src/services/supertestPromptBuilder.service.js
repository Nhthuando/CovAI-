/**
 * Supertest Prompt Builder Service
 * Builds AI prompts specifically for generating Supertest integration tests.
 */
import { extractValidEndpoints } from "./apiEndpointParser.service.js";


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

    // 2. Existing Tests (Established Response Schemas & Status Contracts)
    const existingTests = (testFiles || []).filter(f =>
        !f.path.includes("node_modules") && (f.path.includes("integration") || f.path.includes("unit") || f.path.includes("api.test"))
    );

    if (existingTests.length > 0) {
        hasContent = true;
        segment += "#### Existing Test Suites (Established Request & Response Contracts)\n";
        existingTests.slice(0, 4).forEach(f => {
            segment += `##### File: \`${f.path}\`\n\`\`\`javascript\n`;
            segment += f.content.split("\n").slice(0, 100).join("\n") + "\n```\n\n";
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
    }

    if (hasSchema) {
        segment += "**CRITICAL DATABASE SCHEMA VALIDATION RULES:**\n";
        segment += "- In-memory database mocks automatically enforce schema constraints at runtime.\n";
        segment += "- When writing happy-path tests for POST creation endpoints (such as `POST /api/food-items/create/`), your request body MUST provide ALL required non-nullable fields defined in the model without `@default`.\n";
        segment += "- Specifically for the `Food` model (`model Food`):\n";
        segment += "  * REQUIRED non-nullable fields without `@default`: `name` (String), `image` (String), `price` (Float/Int), `rating` (Float/Int).\n";
        segment += "  * OPTIONAL fields: `description` (String?), `category` (String?), `isAvailable` (Boolean or String?). Always supply boolean `true` for `isAvailable`.\n";
        segment += "  * The happy-path creation request payload MUST contain `name`, `image`, `price`, AND `rating` (e.g. `{ name: 'Delicious Pizza', image: 'https://example.com/pizza.jpg', price: 60000, rating: 4.5, category: 'Fast Food', isAvailable: true }`). Omitting `image` or `rating` will trigger runtime validation errors and cause tests to fail.\n\n";
    }

    return hasSchema ? segment : "";
};

/**
 * Formats API route information into the prompt segment.
 * Now includes a structured endpoint table extracted from source code.
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {string}
 */
export const includeRouteContext = (sourceCode, targetEndpoints = null) => {
    if (!sourceCode || sourceCode.length === 0) return "";

    const endpoints = targetEndpoints || extractValidEndpoints(sourceCode);

    let segment = "### VALID API ENDPOINTS (Extracted from Source Code)\n\n";

    if (endpoints.length > 0) {
        segment += "**YOU MUST ONLY USE THESE ENDPOINTS. DO NOT INVENT ANY OTHER ENDPOINTS.**\n\n";
        segment += "| Method | Path | Controller | Middleware | Payload Schema | DB Models | Source File | Required Coverage Focus |\n";
        segment += "|--------|------|------------|------------|----------------|-----------|-------------|-------------------------|\n";
        for (const ep of endpoints) {
            const controller = ep.controllerMethod || "-";
            const middleware = ep.middleware ? ep.middleware.join(", ") : "-";
            const payload = ep.requestBodySchema ? ep.requestBodySchema.join(", ") : "-";
            const db = ep.databaseModels ? ep.databaseModels.join(", ") : "-";
            const missing = ep.missingCoverageRequested && ep.missingCoverageRequested.length > 0 ? ep.missingCoverageRequested.join(" AND ") : "Happy Path (200/201) AND Error Edge Case (400/404/500)";
            segment += `| ${ep.method} | ${ep.fullPath} | ${controller} | ${middleware} | ${payload} | ${db} | ${ep.sourceFile} | ${missing} |\n`;
        }
        segment += "\n";
        segment += "**CRITICAL INSTRUCTION:** For each endpoint listed above, you MUST write the scenarios explicitly requested in the 'Required Coverage Focus' column. If 'Happy Path (200/201)' is requested, you MUST name the test containing 'happy' or '200'. If 'Error Edge Case (400/404/500)' is requested, you MUST name the test containing 'error' or '404'. Do NOT invent any endpoints not in this table!\n\n";
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
 * Detects the correct app entry point file path for import.
 * Returns the path to app.js (not server.js) to avoid calling app.listen().
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {string} Relative import path for tests
 */
const detectAppImportPath = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) return "../../server/index.js";

    // 1. Prefer app.js over server.js to avoid calling app.listen()
    const appFile = sourceCode.find((f) => f.path.endsWith("app.js") && !f.path.includes("node_modules") && !f.path.includes("test"));
    if (appFile) {
        return `../../${appFile.path}`;
    }

    // 2. Check for index.js in server/, src/, app/
    const serverIndex = sourceCode.find((f) => f.path.endsWith("index.js") && (f.path.includes("server/") || f.path.includes("src/") || f.path.includes("app/")) && !f.path.includes("node_modules") && !f.path.includes("test"));
    if (serverIndex) {
        return `../../${serverIndex.path}`;
    }

    // 3. Fallback to any index.js
    const indexFile = sourceCode.find((f) => f.path.endsWith("index.js") && !f.path.includes("node_modules") && !f.path.includes("test"));
    if (indexFile) {
        return `../../${indexFile.path}`;
    }

    return "../../server/index.js";
};

export const includeSupertestInstructions = (sourceCode) => {
    const appImportPath = detectAppImportPath(sourceCode);

    let segment = "### Integration Test Generation Rules\n\n";
    segment += "You MUST generate **Supertest + Jest** integration tests to verify the complete API processing flow (Client -> Route -> Controller -> Service -> Database -> Response).\n\n";
    
    segment += "#### 1. API Flow & Application Startup\n";
    segment += `- **CRITICAL: Import the app from \`${appImportPath}\`** (the Express app module that exports the app WITHOUT calling \`app.listen()\`). DO NOT import from \`server.js\` because it starts the HTTP server on a port.\n`;
    segment += "- If the source code uses ES modules (`import`/`export`), you MUST use `import` syntax. If it uses CommonJS (`require`), use `require`.\n";
    segment += "- **AST PARSER COMPATIBILITY (CRITICAL):** You MUST write tests using inline Supertest chains exactly like: `await request(app).get('/api/users')`. DO NOT assign `request(app)` to a variable first. DO NOT abstract it into a helper function. The `request(app)` call MUST be inline inside the `it()` or `test()` block or else the tests will be silently ignored.\n";
    segment += "- DO NOT start the Express server on a port (do not call `app.listen()`).\n";
    segment += "- Send realistic request bodies, query params, and path params.\n";
    segment += "- Assert meaningful HTTP status codes and response bodies (`expect(res.status).toBe(200)`).\n";
    segment += "- Do NOT use `describe.only` or `it.only`.\n";
    segment += "- Check if the project uses ES Modules (`type: \"module\"` in package.json or import statements in source). If it does, you MUST use `import` statements instead of `require`.\n";
    segment += "- If the project uses CommonJS, use `require`.\n\n";

    segment += "#### ENDPOINT VERIFICATION (MANDATORY)\n";
    segment += "- **NEVER invent an endpoint or generate tests for unlisted routes.** Every HTTP method + path in your tests MUST appear in the 'VALID API ENDPOINTS' table above.\n";
    segment += "- For EVERY endpoint present in the 'VALID API ENDPOINTS' table (including `GET /` if listed in the table), you MUST generate test scenarios according to the 'Required Coverage Focus' column.\n";
    segment += "- If an endpoint is NOT in the table, DO NOT generate any tests or describe blocks for it.\n\n";

    segment += "#### 2. Database & External Dependencies\n";
    segment += "- **AUTOMATED DATABASE MOCKING ACTIVE:** CovAI automatically provides an in-memory database mock environment (for Prisma, Mongoose, etc.) through Jest's `setupFilesAfterEnv`. Database calls (such as `findMany`, `findUnique`, `create`, `update`, `delete`, `$connect`) are safely intercepted in-memory and will succeed without needing a live database connection.\n";
    segment += "- **STRICT PROHIBITION ON INTERNAL SERVICE/CONTROLLER MOCKING:** DO NOT use `jest.mock()`, `jest.spyOn()`, `mockResolvedValue`, or `mockRejectedValue` on internal controllers, services, routers, or database clients. Tests that attempt to call `mockResolvedValue` or `mockRejectedValue` will fail at runtime with `TypeError: mockResolvedValue is not a function`. You MUST test the system as an integrated whole via Supertest HTTP requests.\n";
    segment += "- If the source code uses ES modules (`import`/`export`), use standard `import request from 'supertest';` and `import app from '...';`.\n";
    segment += "- If the source code uses CommonJS (`require`), use `const request = require('supertest');` and `const app = require('...');`.\n\n";

    segment += "#### 3. Test Scenarios & Contract-Driven Oracle\n";
    segment += "- **COVERAGE BREADTH:** You MUST generate at least one \"Happy Path\" (200/201) AND one \"Error Edge Case\" (400/404) per endpoint.\n";
    segment += "- **REQUIRED FIELDS FOR RESOURCE CREATION (CRITICAL):**\n";
    segment += "  * When generating happy-path tests for POST creation endpoints (e.g., `POST /api/food-items/create/`), you MUST supply all required non-nullable fields defined in the database schema (`name`, `image`, `price`, `rating`, with `isAvailable: true`). Never omit required schema fields like `image` or `rating` in happy-path tests!\n";
    segment += "  * When testing missing required fields or empty payload `{}` for `POST /api/food-items/create/`, name the scenario accurately: `validation edge case: should return 500 when required fields are missing`. DO NOT name it 'database creation fails' because it is testing missing required fields constraint validation, not database infrastructure failure.\n";
    segment += "- **EMPTY CART VALIDATION BEHAVIOR:**\n";
    segment += "  * When testing `POST /api/cart/validate` with an empty items array (`{ items: [] }`), this is valid empty-cart edge case behavior returning 200 with total 0: name the scenario `edge case: should return 200 with 0 total for empty cart`.\n";
    segment += "- **ROOT ENDPOINT HEALTH CHECK (GET /):**\n";
    segment += "  * For the static root endpoint `GET /`, generate exactly ONE concise happy-path test (`happy path: GET / should return 200`). Do not generate redundant duplicate tests for the static root endpoint.\n";
    segment += "- **DETERMINISTIC ASSERTIONS FOR PARAMETERIZED ROUTES (:id):**\n";
    segment += "  * For routes with `:id` parameters (e.g. `GET /api/food-items/get/:id`, `PUT /api/food-items/update/:id`, `DELETE /api/food-items/delete/:id`), ALWAYS use deterministic assertions. NEVER write conditional assertions like `if (res.status === 200) { ... } else { expect(res.status).toBe(404); }`.\n";
    segment += "  * When testing happy path for `GET /api/food-items/get/:id`, you MUST query a valid item (e.g. create one first via `POST /api/food-items/create/` or fetch the first item from `GET /api/food-items`) to obtain a verified existing ID, then expect 200 with matching properties (`id`, `name`). For negative case, explicitly query a non-existent ID like `999999` and expect 404 (`Food item not found`).\n";
    segment += "- **THIRD-PARTY SDK & PAYMENT ASSERTIONS (CRITICAL):**\n";
    segment += "  * For external service integrations such as Stripe (`/api/payments/create-payment-intent`):\n";
    segment += "    - For `amount > 0`: assert property existence and boolean flag: `expect(res.status).toBe(200); expect(res.body).toHaveProperty('clientSecret'); expect(res.body.free).toBe(false);`. DO NOT assert arbitrary hardcoded mock secrets like `expect(res.body).toHaveProperty('clientSecret', 'pi_test_secret_456')` because secret strings vary by environment!\n";
    segment += "    - For `amount === 0`: assert `expect(res.status).toBe(200); expect(res.body.free).toBe(true); expect(res.body).toHaveProperty('url');`. DO NOT assert hardcoded arbitrary checkout URLs like `'https://checkout.stripe.com/c/pay/cs_test_123'`.\n";
    segment += "- **RESPONSE SCHEMA CONTRACT (CRITICAL):** Inspect the controller and service return statements, existing test suites, and frontend API consumers provided above before writing assertions.\n";
    segment += "  * If the service/tests return `{ data: [...], total, page, totalPages }`, your assertion MUST expect `res.body.data` (e.g. `expect(res.body).toHaveProperty('data')` or `expect(Array.isArray(res.body.data)).toBe(true)`). NEVER guess or hallucinate unverified property names like `items`!\n";
    segment += "- **QUERY PARAMETER FALLBACKS:**\n";
    segment += "  * If the controller uses fallback defaults for query params (e.g. `page: parseInt(page) || 1`), testing `?page=invalid` MUST verify that the endpoint gracefully falls back to page 1 and returns HTTP 200 with default page data. Do NOT expect HTTP 500 for non-numeric query parameters when the code has graceful fallback logic!\n";
    segment += "- **CLIENT INPUT ERRORS vs UNHANDLED SERVER ERRORS:**\n";
    segment += "  * Client input errors (such as malformed IDs, missing required fields) belong to HTTP 400 Bad Request or HTTP 404 Not Found according to standard REST contracts.\n";
    segment += "  * NEVER write tests that expect HTTP 500 as the intended, valid business contract for client input errors. If the backend implementation currently catches all errors and returns 500 due to unhandled database exceptions, write assertions checking for proper contract status (400/404) or document the discrepancy.\n";
    segment += "- **EXTERNAL SERVICE FAILURE BOUNDARIES (STRIPE):**\n";
    segment += "  * When testing error conditions for external integrations (such as Stripe `POST /api/payments/create-payment-intent`):\n";
    segment += "    - The application converts amount from VND to USD cents via `Math.round((amount / 23000) * 100)`.\n";
    segment += "    - Small amounts like `amount: -100` VND round to `0 USD cents` and trigger free order (HTTP 200) instead of an error! DO NOT send small numbers like `-100`.\n";
    segment += "    - To genuinely trigger a Stripe SDK amount error at the external boundary, provide a realistic negative amount like `{ amount: -50000 }` (which evaluates to `-217 USD cents` < 0) or non-numeric `{ amount: 'invalid-amount' }` (which evaluates to `NaN`).\n";
    segment += "    - The mock will throw `StripeInvalidRequestError`, and the controller catch block returns HTTP 500 (`res.status(500).json({ error: error.message })`).\n";
    segment += "  * All assertions must check exact status codes (`expect(res.status).toBe(200)` or `500`) and expected response fields based on the actual API contract. Do NOT write loose assertions like `expect([200, 500]).toContain(res.status)`.\n\n";

    segment += "#### 4. Security & Authentication\n";
    segment += "- **SECURITY (CRITICAL):** Explicitly DO NOT hardcode real production credentials, API keys, or JWT tokens in the test files.\n";
    segment += "- Require the use of environment variables (e.g., `process.env.TEST_JWT_SECRET`) or inject a mocked auth context to bypass middlewares safely.\n\n";

    return segment;
};

export const includeSupertestOutputFormat = () => {
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
    segment += '      "filePath": "tests/integration/users.test.js",\n';
    segment += '      "content": "import request from \\\'supertest\\\';\\nimport app from \\\'../../src/app.js\\\';\\n\\ndescribe(\\\'User API\\\', () => { it(\\\'happy path: should return 200\\\', async () => { const res = await request(app).get(\\\'/api/users\\\'); expect(res.status).toBe(200); }); });"\n';
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
export const buildSupertestPrompt = (payload, targetEndpoints = null, pathConstraints = []) => {
    let prompt = "You are an expert Backend QA Engineer. Your task is to analyze the provided source code, API contracts, existing test suites, and client consumers to generate comprehensive Supertest integration test files for the API endpoints.\n\n";

    prompt += "---\n\n";

    if (payload.sourceCode) {
        prompt += includeSourceCode(payload.sourceCode);
        prompt += includeDatabaseSchemaContext(payload.sourceCode);
        prompt += includeContractContext(payload.sourceCode, payload.testFiles);
        prompt += includeRouteContext(payload.sourceCode, targetEndpoints);
    }

    const effectiveConstraints = (Array.isArray(pathConstraints) && pathConstraints.length > 0)
        ? pathConstraints
        : (Array.isArray(payload?.pathConstraints) ? payload.pathConstraints : []);

    if (effectiveConstraints.length > 0) {
        prompt += includePathConstraints(effectiveConstraints);
    }

    prompt += includeSupertestInstructions(payload.sourceCode);
    prompt += includeSupertestOutputFormat();

    prompt += "---\n\n";
    prompt += "Now analyze the source code and contracts above and generate the Supertest integration test files in the exact JSON format specified. Output ONLY the JSON object inside a markdown code block. Do NOT add any explanations before or after the JSON block.";

    return prompt;
};
