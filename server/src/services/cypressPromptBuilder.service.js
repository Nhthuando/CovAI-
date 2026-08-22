/**
 * Cypress Prompt Builder Service
 * Builds AI prompts specifically for generating Cypress E2E test files,
 * categorized into positive, negative, and boundary scenarios.
 */

/**
 * Formats source code files into a readable markdown segment for the prompt.
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {string}
 */
export const includeCypressSourceCode = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) {
        return "No source code available.\n\n";
    }

    let segment = "### Source Code\n\n";
    // Limit to first 10 files to keep prompt size manageable
    const files = sourceCode.slice(0, 10);
    files.forEach((file) => {
        segment += `#### File: ${file.path}\n`;
        segment += "```javascript\n";
        // Limit each file to 200 lines to avoid token overflow
        const lines = file.content.split("\n").slice(0, 200);
        segment += lines.join("\n") + "\n";
        segment += "```\n\n";
    });

    if (sourceCode.length > 10) {
        segment += `_... and ${sourceCode.length - 10} more files (omitted for brevity)._\n\n`;
    }

    return segment;
};

/**
 * Formats API route information into the prompt segment.
 * Extracted from source code heuristically (files containing "router" or "route").
 * @param {Array<{path: string, content: string}>} sourceCode
 * @returns {string}
 */
export const includeRouteContext = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) return "";

    const routeFiles = sourceCode.filter(
        (f) =>
            f.path.includes("route") ||
            f.path.includes("router") ||
            f.path.includes("controller")
    );

    if (routeFiles.length === 0) return "";

    let segment = "### Detected API Routes / Controllers\n\n";
    routeFiles.slice(0, 5).forEach((file) => {
        segment += `- **${file.path}**\n`;
    });
    segment += "\n";

    return segment;
};

/**
 * Builds the scenario classification instructions for the AI.
 * @returns {string}
 */
export const includeCypressScenarioInstructions = () => {
    let segment = "### Cypress Scenario Classification\n\n";

    segment += "You MUST generate three categories of Cypress E2E tests:\n\n";

    segment += "#### 1. Positive Scenarios (`// @positive`)\n";
    segment +=
        "- Happy path flows where valid inputs produce expected successful responses.\n";
    segment +=
        "- Example: A user submits a valid login form and sees the dashboard.\n";
    segment +=
        "- Use `cy.request()` for API assertions or `cy.get()` for UI interactions.\n\n";

    segment += "#### 2. Negative Scenarios (`// @negative`)\n";
    segment +=
        "- Flows with invalid inputs, missing required fields, wrong credentials, or unauthorized access.\n";
    segment +=
        "- Example: Submitting empty username/password should return a 400 error.\n";
    segment +=
        "- Assert on error messages, status codes (4xx/5xx), and proper error UI.\n\n";

    segment += "#### 3. Boundary Scenarios (`// @boundary`)\n";
    segment +=
        "- Flows that test edge values: empty strings, null/undefined, maximum field lengths, zero values, and limit conditions.\n";
    segment +=
        "- Example: Submitting a username that is exactly 256 characters long.\n";
    segment +=
        "- Focus on where valid inputs end and invalid inputs begin.\n\n";

    return segment;
};

/**
 * Builds Cypress-specific output format instructions.
 * @returns {string}
 */
export const includeCypressOutputFormat = () => {
    let segment = "### Required Output Format\n\n";

    segment +=
        "You MUST output a **JSON object** wrapped in a markdown code block (```json ... ```).\n";
    segment += "The JSON must have exactly these three keys:\n\n";
    segment += "```json\n";
    segment += "{\n";
    segment += '  "positiveTests": [\n';
    segment += "    {\n";
    segment +=
        '      "filePath": "cypress/e2e/auth/auth.positive.cy.js",\n';
    segment +=
        '      "content": "// @positive\\n\\ndescribe(\'Auth - Positive\', () => { it(\'should login with valid credentials\', () => { ... }); });"\n';
    segment += "    }\n";
    segment += "  ],\n";
    segment += '  "negativeTests": [\n';
    segment += "    {\n";
    segment +=
        '      "filePath": "cypress/e2e/auth/auth.negative.cy.js",\n';
    segment +=
        '      "content": "// @negative\\n\\ndescribe(\'Auth - Negative\', () => { it(\'should reject empty password\', () => { ... }); });"\n';
    segment += "    }\n";
    segment += "  ],\n";
    segment += '  "boundaryTests": [\n';
    segment += "    {\n";
    segment +=
        '      "filePath": "cypress/e2e/auth/auth.boundary.cy.js",\n';
    segment +=
        '      "content": "// @boundary\\n\\ndescribe(\'Auth - Boundary\', () => { it(\'should handle max-length username\', () => { ... }); });"\n';
    segment += "    }\n";
    segment += "  ]\n";
    segment += "}\n";
    segment += "```\n\n";

    segment +=
        "**Rules for each test file in the arrays:**\n";
    segment +=
        "- `filePath`: relative path starting with `cypress/e2e/`, use the feature/module name as subdirectory.\n";
    segment +=
        "- `content`: Complete, runnable Cypress test file code. Start with the `// @positive`, `// @negative`, or `// @boundary` comment tag.\n";
    segment +=
        "- Each `content` must use `describe()` and `it()` blocks and real Cypress commands (`cy.visit()`, `cy.get()`, `cy.request()`, `cy.intercept()`).\n";
    segment +=
        "- Use `http://localhost:3000` as the `baseUrl` placeholder (or use `cy.visit('/')` with Cypress config).\n";
    segment += "- Do NOT use Playwright or Jest syntax.\n";
    segment += "- Do NOT include explanations outside the JSON.\n\n";

    return segment;
};

/**
 * Builds Cypress coding conventions instructions.
 * @returns {string}
 */
export const includeCypressCodingConventions = () => {
    let segment = "### Cypress Coding Conventions\n\n";

    segment += "Follow these Cypress best practices:\n";
    segment +=
        "- Use `cy.intercept()` to stub external API calls.\n";
    segment +=
        "- Use `beforeEach()` to set up common state (e.g., `cy.login()` custom commands).\n";
    segment +=
        "- Use `cy.request()` for direct API endpoint testing (no UI navigation needed).\n";
    segment +=
        "- Prefer data-testid attributes: `cy.get('[data-testid=\"submit-btn\"]')`.\n";
    segment +=
        "- Chain assertions: `.should('be.visible')`, `.should('have.value', '...')`.\n";
    segment +=
        "- Use `cy.wrap()` for wrapping non-Cypress values in assertions.\n\n";

    return segment;
};

/**
 * Main function: builds the complete Cypress generation prompt.
 * @param {Object} payload - AI context payload (sourceCode, coverage, etc.)
 * @returns {string} The complete prompt string
 */
export const buildCypressPrompt = (payload) => {
    let prompt =
        "You are an expert Cypress E2E test engineer. Your task is to analyze the provided source code and generate comprehensive Cypress end-to-end test files.\n\n";
    prompt +=
        "You must produce three separate sets of tests: **positive scenarios**, **negative scenarios**, and **boundary scenarios**.\n\n";

    prompt += "---\n\n";

    // Inject source code context
    if (payload.sourceCode) {
        prompt += includeCypressSourceCode(payload.sourceCode);
    }

    // Inject route/controller context
    if (payload.sourceCode) {
        prompt += includeRouteContext(payload.sourceCode);
    }

    // Scenario classification instructions
    prompt += includeCypressScenarioInstructions();

    // Cypress coding conventions
    prompt += includeCypressCodingConventions();

    // Output format
    prompt += includeCypressOutputFormat();

    prompt += "---\n\n";
    prompt +=
        "Now analyze the source code above and generate the Cypress test files in the exact JSON format specified. Output ONLY the JSON object inside a markdown code block. Do NOT add any explanations before or after the JSON block.";

    return prompt;
};
