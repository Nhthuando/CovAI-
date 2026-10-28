/**
 * Cypress Post Processor Service
 * Processes raw AI output into validated, classified Cypress E2E test records.
 * Handles: parsing AI JSON response, validating Cypress syntax,
 * classifying scenario types (positive/negative/boundary), and metadata extraction.
 */

import { parseAiResponse } from "./aiSuggestionParser.service.js";

// ─── Validators ────────────────────────────────────────────────────────────

/**
 * Validates that a string contains Cypress-specific syntax.
 * @param {string} content
 * @returns {boolean}
 */
export const validateCypressSyntax = (content) => {
    if (!content || typeof content !== "string") return false;

    const hasDescribe = content.includes("describe(");
    const hasIt = content.includes("it(") || content.includes("test(");
    const hasCypressCommand =
        content.includes("cy.") ||
        content.includes("cy.visit") ||
        content.includes("cy.get") ||
        content.includes("cy.request") ||
        content.includes("cy.intercept");

    return hasDescribe && hasIt && hasCypressCommand;
};

/**
 * Removes markdown code block wrappers from content.
 * @param {string} content
 * @returns {string}
 */
export const removeMarkdownWrappers = (content) => {
    if (!content) return "";
    let cleaned = content;
    cleaned = cleaned.replace(/^```(javascript|js|ts|typescript|cypress)?\s*/i, "");
    cleaned = cleaned.replace(/```\s*$/i, "");
    return cleaned.trim();
};

/**
 * Normalizes excessive whitespace in generated code.
 * @param {string} content
 * @returns {string}
 */
export const normalizeWhitespace = (content) => {
    if (!content) return "";
    return content.replace(/\n{3,}/g, "\n\n").trim();
};

// ─── Scenario Classification ────────────────────────────────────────────────

/**
 * Determines the scenario type of a test file from its content or the AI-output array key.
 * Falls back to tag-based detection in the content.
 * @param {string} content
 * @param {'positive'|'negative'|'boundary'} [explicitType] - Set when known from JSON key
 * @returns {'positive'|'negative'|'boundary'|'unknown'}
 */
export const classifyScenarioType = (content, explicitType = null) => {
    if (explicitType && ["positive", "negative", "boundary"].includes(explicitType)) {
        return explicitType;
    }

    if (!content) return "unknown";

    // Tag-based detection in the file content (highest priority)
    if (/@positive/i.test(content)) return "positive";
    if (/@negative/i.test(content)) return "negative";
    if (/@boundary/i.test(content)) return "boundary";

    const lowerContent = content.toLowerCase();

    // Negative keywords checked first to avoid false positive matches
    // e.g. "invalid credential" should not match "valid" inside "invalid"
    if (
        /\binvalid\b/.test(lowerContent) ||
        /\bunauthorized\b/.test(lowerContent) ||
        /\bforbidden\b/.test(lowerContent) ||
        /\breject\b/.test(lowerContent) ||
        /\b4[0-9][0-9]\b/.test(lowerContent) ||
        /\b5[0-9][0-9]\b/.test(lowerContent) ||
        lowerContent.includes("should fail") ||
        lowerContent.includes("should return error")
    )
        return "negative";

    if (
        /\bboundary\b/.test(lowerContent) ||
        /\bedge case\b/.test(lowerContent) ||
        lowerContent.includes("max length") ||
        lowerContent.includes("empty string") ||
        /\bnull\b/.test(lowerContent)
    )
        return "boundary";

    if (
        lowerContent.includes("happy path") ||
        lowerContent.includes("valid input") ||
        lowerContent.includes("success")
    )
        return "positive";

    return "unknown";
};

// ─── Metadata Extraction ────────────────────────────────────────────────────

/**
 * Extracts test metadata (describe count, it count) from Cypress file content.
 * @param {string} content
 * @returns {{ describeCount: number, testCount: number, hasCypressCommands: boolean, scenarioType: string }}
 */
export const extractCypressMetadata = (content, scenarioType = "unknown") => {
    if (!content) {
        return { describeCount: 0, testCount: 0, hasCypressCommands: false, scenarioType };
    }

    const describeCount = (content.match(/describe\s*\(/g) || []).length;
    // Use word-boundary regex to avoid matching 'it' inside words like 'visit', 'intercept', etc.
    const testCount = (content.match(/(?<![\w.])(?:it|test)\s*\(/g) || []).length;
    const hasCypressCommands = /cy\./i.test(content);

    return { describeCount, testCount, hasCypressCommands, scenarioType };
};

// ─── Output Format Validation ───────────────────────────────────────────────

/**
 * Validates that the AI parsed output has the expected Cypress JSON structure.
 * Expected: { positiveTests: [...], negativeTests: [...], boundaryTests: [...] }
 * @param {any} parsedData
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateCypressOutputFormat = (parsedData) => {
    const errors = [];

    if (!parsedData || typeof parsedData !== "object") {
        errors.push("Parsed AI data must be a JSON object.");
        return { valid: false, errors };
    }

    const requiredKeys = ["positiveTests", "negativeTests", "boundaryTests"];
    for (const key of requiredKeys) {
        if (parsedData[key] !== undefined && !Array.isArray(parsedData[key])) {
            errors.push(`"${key}" must be an array.`);
        }
    }

    // At least one key must be present and non-empty
    const hasAnyTests = requiredKeys.some(
        (k) => Array.isArray(parsedData[k]) && parsedData[k].length > 0
    );

    if (!hasAnyTests) {
        errors.push(
            "AI output contains no test files in positiveTests, negativeTests, or boundaryTests."
        );
    }

    return { valid: errors.length === 0, errors };
};

// ─── Summary Generator ──────────────────────────────────────────────────────

/**
 * Generates a human-readable summary of the Cypress generation result.
 * @param {{ positiveTests: any[], negativeTests: any[], boundaryTests: any[] }} result
 * @returns {{ totalFiles: number, byScenario: object, message: string }}
 */
export const generateCypressSummary = ({ positiveTests, negativeTests, boundaryTests }) => {
    const byScenario = {
        positive: positiveTests.length,
        negative: negativeTests.length,
        boundary: boundaryTests.length,
    };
    const totalFiles = positiveTests.length + negativeTests.length + boundaryTests.length;

    const message =
        `Generated ${totalFiles} Cypress test file(s): ` +
        `${byScenario.positive} positive, ${byScenario.negative} negative, ${byScenario.boundary} boundary scenario(s).`;

    return { totalFiles, byScenario, message };
};

// ─── Single Test File Processor ─────────────────────────────────────────────

/**
 * Processes a single raw test entry from the AI output.
 * @param {{ filePath: string, content: string }} rawTest
 * @param {'positive'|'negative'|'boundary'} scenarioType
 * @param {{ projectId: string, snapshotId: string }} context
 * @returns {object|null} Processed test record or null if invalid
 */
export const processSingleCypressTest = (rawTest, scenarioType, { projectId, snapshotId }) => {
    if (!rawTest || !rawTest.filePath || !rawTest.content) {
        console.warn(
            `[CypressPostProcessor] Skipping test entry with missing filePath or content.`
        );
        return null;
    }

    let content = removeMarkdownWrappers(rawTest.content);
    content = normalizeWhitespace(content);

    // Prepend watermark and scenario tag if not already present
    const scenarioTag = `// @${scenarioType}`;
    if (!content.includes(scenarioTag)) {
        content = `${scenarioTag}\n// [AI GENERATED] This Cypress test was automatically generated by CovAI.\n\n${content}`;
    } else {
        content = `// [AI GENERATED] This Cypress test was automatically generated by CovAI.\n\n${content}`;
    }

    const isValid = validateCypressSyntax(content);
    if (!isValid) {
        console.warn(
            `[CypressPostProcessor] Test file "${rawTest.filePath}" may not contain valid Cypress syntax.`
        );
    }

    const detectedType = classifyScenarioType(content, scenarioType);
    const metadata = extractCypressMetadata(content, detectedType);

    return {
        projectId,
        snapshotId,
        filePath: rawTest.filePath.trim(),
        mode: "CYPRESS",
        content,
        metaJson: JSON.stringify({ ...metadata, isValid }),
    };
};

// ─── Main Processor ─────────────────────────────────────────────────────────

/**
 * Main orchestrator: parses AI response text, validates format,
 * processes each scenario type, and returns classified results.
 *
 * @param {string} responseText - Raw AI text response from Gemini
 * @param {{ projectId: string, snapshotId: string }} context
 * @returns {{
 *   positiveTests: object[],
 *   negativeTests: object[],
 *   boundaryTests: object[],
 *   allTests: object[],
 *   summary: object
 * }}
 */
export const processCypressTests = (responseText, { projectId, snapshotId }) => {
    // Step 1: Parse JSON from AI response
    const parsedData = parseAiResponse(responseText);

    // Step 2: Validate structure
    const formatValidation = validateCypressOutputFormat(parsedData);
    if (!formatValidation.valid) {
        console.warn(
            `[CypressPostProcessor] Format validation issues: ${formatValidation.errors.join(", ")}`
        );
        // Non-fatal: continue with what we have
    }

    const rawPositive = Array.isArray(parsedData.positiveTests)
        ? parsedData.positiveTests
        : [];
    const rawNegative = Array.isArray(parsedData.negativeTests)
        ? parsedData.negativeTests
        : [];
    const rawBoundary = Array.isArray(parsedData.boundaryTests)
        ? parsedData.boundaryTests
        : [];

    // Step 3: Process each category
    const context = { projectId, snapshotId };

    const positiveTests = rawPositive
        .map((t) => processSingleCypressTest(t, "positive", context))
        .filter(Boolean);

    const negativeTests = rawNegative
        .map((t) => processSingleCypressTest(t, "negative", context))
        .filter(Boolean);

    const boundaryTests = rawBoundary
        .map((t) => processSingleCypressTest(t, "boundary", context))
        .filter(Boolean);

    const allTests = [...positiveTests, ...negativeTests, ...boundaryTests];

    // Step 4: Generate summary
    const summary = generateCypressSummary({ positiveTests, negativeTests, boundaryTests });

    return {
        positiveTests,
        negativeTests,
        boundaryTests,
        allTests,
        summary,
    };
};
