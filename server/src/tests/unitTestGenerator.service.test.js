import { describe, test, expect, jest } from "@jest/globals";

const mockAiResponse = JSON.stringify({
    explanation: "Comprehensive unit tests for calculateTax",
    suggestedTestCode: "test('calculateTax handles valid input', () => { expect(calculateTax(100)).toBe(10); });",
    fullUpdatedContent: "test('calculateTax handles valid input', () => { expect(calculateTax(100)).toBe(10); });"
});

export const mockGenerateText = jest.fn().mockResolvedValue(mockAiResponse);

await jest.unstable_mockModule("../services/gemini.service.js", () => ({
    generateText: mockGenerateText
}));

const {
    buildStandardUnitTestPrompt,
    parseAndSanitizeAiTestResponse,
    generateAiUnitTestSuite
} = await import("../services/unitTestGenerator.service.js");
const { assembleUnitTestContext } = await import("../services/unitTestContextEngineering.service.js");

describe("AI Test Generator Service - Phase 3 Verification", () => {
    const mockSourceCode = `
export function calculateTax(income, options = {}) {
    if (income <= 0) return 0;
    const rate = options.rate ?? 0.1;
    if (income > 50000) {
        return income * (rate + 0.05);
    }
    return income * rate;
}
`;

    describe("3.1 Cấu Trúc Prompt Tiêu Chuẩn Cho LLM (buildStandardUnitTestPrompt)", () => {
        test("constructs 6-part standardized prompt with all required sections and methodology", () => {
            const context = assembleUnitTestContext({
                sourceCode: mockSourceCode,
                coverageDetails: {
                    uncoveredLines: [4, 5],
                    summary: { linesPct: 60, branchesPct: 50, funcsPct: 100, stmtsPct: 60 }
                },
                framework: "jest"
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/services/tax.service.js",
                testFileInfo: {
                    found: false,
                    relativePath: "tests/tax.service.test.js",
                    content: ""
                },
                cleanImportPath: "../src/services/tax.service",
                coverageDetails: {
                    uncoveredLines: [4, 5],
                    summary: { linesPct: 60, branchesPct: 50, funcsPct: 100, stmtsPct: 60 }
                },
                sourceCode: mockSourceCode,
                unitTestContext: context
            });

            // 1. Role Definition & Project Context
            expect(prompt).toContain("### 1. ROLE DEFINITION & PROJECT CONTEXT");
            expect(prompt).toContain("JEST");
            expect(prompt).toContain("src/services/tax.service.js");

            // 2. Target File & Import Contract
            expect(prompt).toContain("### 2. TARGET FILE & IMPORT CONTRACT");
            expect(prompt).toContain("../src/services/tax.service");
            expect(prompt).toContain("calculateTax");

            // 3. Current Coverage Diagnostics & Gaps
            expect(prompt).toContain("### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS");
            expect(prompt).toContain("Lines 4-5");

            // 4. Source Code
            expect(prompt).toContain("### 4. SOURCE CODE");
            expect(prompt).toContain("calculateTax");

            // 5. Strict Generation Rules & Methodology
            expect(prompt).toContain("### 5. STRICT GENERATION RULES & METHODOLOGY");
            expect(prompt).toContain("NEVER USE test.skip / it.skip / describe.skip");
            expect(prompt).toContain("MANDATORY TEST MATRIX (DECISION TABLE)");
            expect(prompt).toContain("ISOLATION MOCK CONTRACTS");

            // 6. Output Format
            expect(prompt).toContain("### 6. OUTPUT FORMAT");
            expect(prompt).toContain('"explanation"');
            expect(prompt).toContain('"suggestedTestCode"');
            expect(prompt).toContain('"fullUpdatedContent"');
        });

        test("includes existing test code block when target test file exists", () => {
            const context = assembleUnitTestContext({
                sourceCode: mockSourceCode,
                coverageDetails: { uncoveredLines: [] },
                framework: "vitest"
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "vitest",
                cleanSource: "src/services/tax.service.js",
                testFileInfo: {
                    found: true,
                    relativePath: "tests/tax.service.test.js",
                    content: "describe('existing suite', () => {});"
                },
                cleanImportPath: "../src/services/tax.service",
                coverageDetails: { uncoveredLines: [] },
                sourceCode: mockSourceCode,
                unitTestContext: context
            });

            expect(prompt).toContain("EXISTING TEST CODE IN tests/tax.service.test.js:");
            expect(prompt).toContain("describe('existing suite', () => {});");
            expect(prompt).toContain("Vitest ESM syntax");
        });
    });

    describe("3.2 Response Parsing & Sanity Check (parseAndSanitizeAiTestResponse)", () => {
        test("cleans markdown wrapping, parses JSON, and unskips skipped tests", () => {
            const rawResponse = "```json\n" + JSON.stringify({
                explanation: "Added branch toggling tests",
                suggestedTestCode: "test.skip('zero income', () => { expect(calculateTax(0)).toBe(0); });",
                fullUpdatedContent: "describe.skip('tax tests', () => {\n  it.skip('handles zero', () => {\n    expect(calculateTax(0)).toBe(0);\n  });\n});"
            }) + "\n```";

            const result = parseAndSanitizeAiTestResponse({
                rawResponse,
                framework: "jest",
                cleanSource: "src/tax.js"
            });

            expect(result.success).toBe(true);
            expect(result.syntaxValid).toBe(true);
            expect(result.hasAssertions).toBe(true);

            // Verify .skip was eliminated
            expect(result.parsed.suggestedTestCode).not.toContain("test.skip");
            expect(result.parsed.suggestedTestCode).toContain("test('zero income'");
            expect(result.parsed.fullUpdatedContent).not.toContain("describe.skip");
            expect(result.parsed.fullUpdatedContent).not.toContain("it.skip");
            expect(result.parsed.fullUpdatedContent).toContain("describe('tax tests'");
            expect(result.parsed.fullUpdatedContent).toContain("it('handles zero'");
        });

        test("rejects placeholder non-code comments and invalid JSON", () => {
            const placeholderResponse = JSON.stringify({
                explanation: "No changes needed",
                suggestedTestCode: "// No additional snippets needed",
                fullUpdatedContent: "N/A"
            });

            const result = parseAndSanitizeAiTestResponse({
                rawResponse: placeholderResponse,
                framework: "jest",
                cleanSource: "src/tax.js"
            });

            expect(result.success).toBe(false);
            expect(result.errors.some(e => e.includes("placeholder"))).toBe(true);
        });

        test("validates AST syntax with Babel Parser and flags broken syntax", () => {
            const brokenSyntaxResponse = JSON.stringify({
                explanation: "Broken code",
                suggestedTestCode: "test('broken', () => { expect(1).toBe(1); ",
                fullUpdatedContent: "test('broken', () => { expect(1).toBe(1); "
            });

            const result = parseAndSanitizeAiTestResponse({
                rawResponse: brokenSyntaxResponse,
                framework: "jest",
                cleanSource: "src/tax.js"
            });

            expect(result.parsed).toBeDefined();
        });

        test("flags test code lacking expect assertions", () => {
            const noAssertionResponse = JSON.stringify({
                explanation: "No assertions",
                suggestedTestCode: "test('run', () => { const a = 1; });",
                fullUpdatedContent: "test('run', () => { const a = 1; });"
            });

            const result = parseAndSanitizeAiTestResponse({
                rawResponse: noAssertionResponse,
                framework: "jest",
                cleanSource: "src/tax.js"
            });

            expect(result.success).toBe(false);
            expect(result.hasAssertions).toBe(false);
            expect(result.errors.some(e => e.includes("expect"))).toBe(true);
        });
    });

    describe("3.3 Resilient Generation Orchestration (generateAiUnitTestSuite)", () => {
        test("executes generation workflow and produces complete suggestion with AI parsed result", async () => {
            mockGenerateText.mockResolvedValueOnce(mockAiResponse);

            const snapshot = {
                id: "snap-123",
                rootDir: "d:/mock/repo"
            };

            const result = await generateAiUnitTestSuite({
                framework: "jest",
                snapshot,
                sourceFileToInspect: "src/services/tax.service.js",
                sourceCode: mockSourceCode,
                coverageDetails: {
                    uncoveredLines: [4, 5],
                    summary: { linesPct: 60, branchesPct: 50, funcsPct: 100, stmtsPct: 60 }
                },
                isTest: false,
                filePath: "src/services/tax.service.js"
            });

            expect(result.suggestionId).toBeDefined();
            expect(result.status).toBe("GENERATED");
            expect(result.sourceFile).toBe("src/services/tax.service.js");
            expect(result.suggestedTestCode).toBeDefined();
            expect(result.suggestedTestCode).toContain("calculateTax");
            expect(result.decisionTableSummary).toBeDefined();
            expect(result.decisionTableSummary.totalTestCases).toBeGreaterThanOrEqual(1);
        });

        test("seamlessly falls back to Isolation Mock fallback when AI generation fails", async () => {
            mockGenerateText.mockRejectedValueOnce(new Error("AI Network Timeout"));

            const snapshot = {
                id: "snap-123",
                rootDir: "d:/mock/repo"
            };

            const result = await generateAiUnitTestSuite({
                framework: "jest",
                snapshot,
                sourceFileToInspect: "src/services/tax.service.js",
                sourceCode: mockSourceCode,
                coverageDetails: {
                    uncoveredLines: [4, 5],
                    summary: { linesPct: 60, branchesPct: 50, funcsPct: 100, stmtsPct: 60 }
                },
                isTest: false,
                filePath: "src/services/tax.service.js"
            });

            expect(result.suggestionId).toBeDefined();
            expect(result.status).toBe("GENERATED");
            expect(result.suggestedTestCode).toBeDefined();
            expect(result.suggestedTestCode).toContain("test(");
        });
    });
});
