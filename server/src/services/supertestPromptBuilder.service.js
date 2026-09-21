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
        return filePath.includes("route") || filePath.includes("router") || filePath.includes("controller") || filePath.includes("app.") || filePath.includes("index.");
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
 * Formats API route information into the prompt segment.
 * Now includes a structured endpoint table extracted from source code.
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {string}
 */
export const includeRouteContext = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) return "";

    const endpoints = extractValidEndpoints(sourceCode);

    let segment = "### VALID API ENDPOINTS (Extracted from Source Code)\n\n";

    if (endpoints.length > 0) {
        segment += "**YOU MUST ONLY USE THESE ENDPOINTS. DO NOT INVENT ANY OTHER ENDPOINTS.**\n\n";
        segment += "| Method | Path | Source File |\n";
        segment += "|--------|------|-------------|\n";
        for (const ep of endpoints) {
            segment += `| ${ep.method} | ${ep.fullPath} | ${ep.sourceFile} |\n`;
        }
        segment += "\n";
        segment += "**CRITICAL:** If you generate a test for any endpoint NOT listed above, the test WILL FAIL with 404. Only test the endpoints above.\n\n";
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
    if (!sourceCode) return "../../src/app.js";

    // Prefer app.js over server.js to avoid calling app.listen()
    const appFile = sourceCode.find((f) => f.path.endsWith("app.js") && !f.path.includes("node_modules"));
    if (appFile) {
        return `../../${appFile.path}`;
    }

    // Fallback to index.js
    const indexFile = sourceCode.find((f) => f.path.endsWith("index.js") && (f.path.includes("src/") || f.path.includes("app/")));
    if (indexFile) {
        return `../../${indexFile.path}`;
    }

    return "../../src/app.js";
};

export const includeSupertestInstructions = (sourceCode) => {
    const appImportPath = detectAppImportPath(sourceCode);

    let segment = "### Integration Test Generation Rules\n\n";
    segment += "You MUST generate **Supertest + Jest** integration tests to verify the complete API processing flow (Client -> Route -> Controller -> Service -> Database -> Response).\n\n";
    
    segment += "#### 1. API Flow & Application Startup\n";
    segment += `- **CRITICAL: Import the app from \`${appImportPath}\`** (the Express app module that exports the app WITHOUT calling \`app.listen()\`). DO NOT import from \`server.js\` because it starts the HTTP server on a port.\n`;
    segment += "- If the source code uses ES modules (`import`/`export`), you MUST use `import` syntax. If it uses CommonJS (`require`), use `require`.\n";
    segment += "- Use `request(app)` from Supertest to make HTTP requests.\n";
    segment += "- DO NOT start the Express server on a port (do not call `app.listen()`).\n";
    segment += "- Send realistic request bodies, query params, and path params.\n";
    segment += "- Assert meaningful HTTP status codes and response bodies (`expect(res.status).toBe(200)`).\n";
    segment += "- Do NOT use `describe.only` or `it.only`.\n";
    segment += "- Check if the project uses ES Modules (`type: \"module\"` in package.json or import statements in source). If it does, you MUST use `import` statements instead of `require`.\n";
    segment += "- If the project uses CommonJS, use `require`.\n\n";

    segment += "#### ENDPOINT VERIFICATION (MANDATORY)\n";
    segment += "- **NEVER invent an endpoint.** Every HTTP method + path in your tests MUST appear in the 'VALID API ENDPOINTS' table above.\n";
    segment += "- If an endpoint is NOT in the table, DO NOT generate a test for it.\n";
    segment += "- DO NOT test `GET /`, `GET /api/health`, or any endpoint that is not explicitly registered in the source code.\n\n";

    segment += "#### 2. Database & External Dependencies\n";
    segment += "- The tests will run in an isolated Docker container.\n";
    segment += "- **ESM COMPATIBILITY (CRITICAL):** If the source code uses ES modules (`import`/`export`), you MUST follow these rules:\n";
    segment += "  - Add `import { jest } from '@jest/globals';` at the top of the test file.\n";
    segment += "  - **DO NOT use `jest.mock()`.** It does not work in ESM mode.\n";
    segment += "  - If the source code uses in-memory data stores (arrays, Maps, etc.) instead of a real database, test the REAL modules directly without mocking.\n";
    segment += "  - If the source code uses a real database (Prisma, Mongoose, etc.), use `jest.unstable_mockModule()` with dynamic `import()` to mock the database module BEFORE importing the app.\n";
    segment += "- If the source code uses CommonJS, you may use `jest.mock()` normally.\n";
    segment += "- DO NOT mock the route, controller, or the service under test! The test must verify the flow traversing through these layers.\n";

    segment += "#### 3. Test Scenarios\n";
    segment += "- Write tests for successful API flows (Happy Path).\n";
    segment += "- Write tests for validation failures (e.g., missing required fields resulting in 400 Bad Request).\n";
    segment += "- Write tests for error responses (e.g., Not Found, Unauthorized).\n\n";

    return segment;
};

export const includeSupertestOutputFormat = () => {
    let segment = "### Required Output Format\n\n";
    segment += "You MUST output a **JSON object** wrapped in a markdown code block (```json ... ```).\n";
    segment += "The JSON must have a single key `tests` containing an array of generated test files:\n\n";
    segment += "```json\n";
    segment += "{\n";
    segment += '  "tests": [\n';
    segment += "    {\n";
    segment += '      "filePath": "tests/integration/users.test.js",\n';
    segment += '      "content": "import request from \\\'supertest\\\';\\nimport app from \\\'../../src/app.js\\\';\\n\\n// Mock DB\\njest.mock(\\\'../../src/config/prisma.js\\\');\\n\\ndescribe(\\\'User API\\\', () => { it(\\\'should return 200\\\', async () => { ... }); });"\n';
    segment += "    }\n";
    segment += "  ]\n";
    segment += "}\n";
    segment += "```\n\n";
    
    segment += "**Rules for each test file:**\n";
    segment += "- `filePath`: relative path starting with `tests/integration/`.\n";
    segment += "- `content`: Complete, runnable Jest+Supertest test file code.\n";
    segment += "- Do NOT include explanations outside the JSON.\n\n";

    return segment;
};

/**
 * Main function: builds the complete Supertest generation prompt.
 * @param {Object} payload - AI context payload
 * @returns {string} The complete prompt string
 */
export const buildSupertestPrompt = (payload) => {
    let prompt = "You are an expert Backend QA Engineer. Your task is to analyze the provided source code and generate comprehensive Supertest integration test files for the API endpoints.\n\n";

    prompt += "---\n\n";

    if (payload.sourceCode) {
        prompt += includeSourceCode(payload.sourceCode);
        prompt += includeRouteContext(payload.sourceCode);
    }

    prompt += includeSupertestInstructions(payload.sourceCode);
    prompt += includeSupertestOutputFormat();

    prompt += "---\n\n";
    prompt += "Now analyze the source code above and generate the Supertest integration test files in the exact JSON format specified. Output ONLY the JSON object inside a markdown code block. Do NOT add any explanations before or after the JSON block.";

    return prompt;
};
