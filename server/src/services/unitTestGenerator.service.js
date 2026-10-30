import fs from "fs";
import path from "path";
import { generateText } from "./gemini.service.js";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { normalizeTestFrameworkCode } from "./testFrameworkNormalization.service.js";
import { assembleUnitTestContext, buildIsolationMockContracts } from "./unitTestContextEngineering.service.js";
import {
    computeRelativeImportPath,
    formatLineRanges,
    generateFallbackUnitTests,
    findExistingTestFile,
    sanitizeSourceFilePath
} from "./unitTestSuggestion.service.js";
import { cleanAndDeduplicateTestContent, STATEMENT_SEPARATION_EXCLUSIONS, safeDecoupleInlineStatements, healBrokenCommentSplits, balanceTestFileBracesAndParens } from "./testSanitizer.service.js";
import { deduplicateAstDeclarations } from "./testHelperRegistry.service.js";

/**
 * GIAI ĐOẠN 3: AI TEST GENERATION (SINH TEST THÔNG MINH QUA LLM)
 *
 * Implements:
 * 3.1. Cấu trúc Prompt Tiêu Chuẩn Cho LLM (6 phần chặt chẽ)
 * 3.2. Response Parsing & Sanity Check (AST Syntax Validation, Anti-skip, Placeholder filtering)
 * 3.3. Resilient Generation Orchestration (Gemini LLM with Isolation Fallback)
 */

/**
 * 3.1 CẤU TRÚC PROMPT TIÊU CHUẨN CHO LLM (6 PHẦN CHẶT CHẼ)
 *
 * @param {object} params
 * @param {string} params.framework - "jest" or "vitest"
 * @param {string} params.cleanSource - Normalized source file path
 * @param {object} params.testFileInfo - Info on target test file
 * @param {string} params.cleanImportPath - Relative module import path
 * @param {object} params.coverageDetails - Line and branch diagnostics
 * @param {string} params.sourceCode - Raw source code
 * @param {object} params.unitTestContext - Output from assembleUnitTestContext
 * @returns {string} Fully engineered 6-part prompt
 */
export const buildStandardUnitTestPrompt = ({
    framework = "jest",
    cleanSource,
    testFileInfo,
    cleanImportPath,
    coverageDetails,
    sourceCode,
    unitTestContext
}) => {
    const isVitest = framework === "vitest";
    const isTest = Boolean(testFileInfo.found);
    const runnerContract = isVitest
        ? "Use ESM imports from 'vitest' and vi.fn/vi.spyOn/vi.mock. Never require('vitest') or use jest.*. Keep runner imports as ESM even when the source module uses CommonJS."
        : "For ESM tests import { jest } from '@jest/globals' before using jest.*. For CommonJS tests use the injected jest global without redeclaring it.";
    const pathContract = "Trace each input through normalization, validation/regex guards and early returns BEFORE choosing a later branch's expected result. An input rejected by an earlier guard cannot test a downstream result-type/error branch. Use an input accepted by all preceding guards, or isolate the real dependency with a supported mock. Never mock the function under test. Derive exact error messages from the reached return statement, not from the test title. Do not invent a passing test or weaken an assertion just to claim coverage of an unreachable branch.";

    const exportedSymbols = unitTestContext?.astMetadata?.exportedSymbolNames || [];
    const exportedSymbolsStr = exportedSymbols.length > 0 ? exportedSymbols.join(", ") : "All exported module members";
    const unexportedWarning = unitTestContext?.indirectTesting?.indirectGuidancePrompt || "";
    const mockInstructionsStr = unitTestContext?.mockContracts?.mockInstructions || "";
    const decisionTableMarkdown = unitTestContext?.decisionTable?.decisionTableMarkdown || "";
    const decisionGuidanceStr = unitTestContext?.coverageGaps?.guidanceSummary || "No complex branching detected";
    const cyclomaticComplexity = unitTestContext?.decisionTable?.summary?.cyclomaticComplexity ||
        unitTestContext?.astMetadata?.cyclomaticComplexity ||
        (1 + (unitTestContext?.astMetadata?.decisionPoints || []).length);

    const uncoveredLinesStr = formatLineRanges(coverageDetails?.uncoveredLines || []);
    const failedLinesStr = (coverageDetails?.failedLines || []).map(l => `Line ${l}: ${coverageDetails?.lines?.[l]?.error || "failed assertion"}`).join("\n") || "None";

    const branches = coverageDetails?.branches || coverageDetails?.branchFlow || [];
    const uncoveredBranches = branches.filter(b => b.status !== "fully_covered" || b.totalHits === 0);
    const branchDetailsStr = uncoveredBranches.length > 0
        ? uncoveredBranches.slice(0, 35).map(b => {
            const missingPaths = (b.paths || []).filter(p => !p.covered).map(p => `${p.type} branch`).join(" & ");
            return `- Line ${b.line} (${b.type}): condition "${b.condition || 'branch'}" -> MISSING: ${missingPaths || b.status}`;
        }).join("\n")
        : "All branches currently covered";

    const functions = coverageDetails?.functions || coverageDetails?.functionFlow || [];
    const uncoveredFunctions = functions.filter(f => !f.covered || f.hits === 0);
    const functionDetailsStr = uncoveredFunctions.length > 0
        ? uncoveredFunctions.slice(0, 30).map(f => `- Function "${f.realName || f.name}" (line ${f.line}) - 0 test invocations`).join("\n")
        : "All functions currently invoked";

    return isTest
        ? `You are an expert ${framework.toUpperCase()} unit testing engineer.
We need to improve and add new unit test cases to the EXISTING test file: ${testFileInfo.relativePath}
which tests the source file: ${cleanSource}

### 1. ROLE DEFINITION & PROJECT CONTEXT
- Testing Framework: ${framework.toUpperCase()} (${isVitest ? "Vitest ESM syntax: import { describe, test, it, expect, vi } from 'vitest';" : "Jest syntax: globals describe, test, it, expect, jest are available globally. In CommonJS NEVER import or declare 'jest' (e.g. NEVER write const { jest } = require('@jest/globals') or const jest = ...), as 'jest' is already a global parameter."})
- Target Test File: ${testFileInfo.relativePath} (Status: EXISTING FILE - MUST PRESERVE AND AUGMENT)
- Runner API contract: ${runnerContract}
- Branch reachability contract: ${pathContract}
- Target Source File: ${cleanSource}

### 2. TARGET FILE & IMPORT CONTRACT
- Source Module Import Path: "${cleanImportPath}" (e.g. import { ... } from '${cleanImportPath}';)
- EXPORTED PUBLIC SYMBOLS (ONLY import and call these directly): ${exportedSymbolsStr}
${unexportedWarning}
- MODEL SCHEMA INVARIANT: When testing Sequelize/Mongoose model definitions (e.g. defineVersionModel(sequelize)), ALWAYS import the exported function from "${cleanImportPath}". In expect(mockSequelize.define).toHaveBeenCalledWith(...) assertions, guarantee that every property object is properly closed with braces and comma (e.g. id: { type: ..., primaryKey: true },) before the next property or before the options object ({ tableName: ... }).
- CUCUMBER / GHERKIN AST FIXTURE INVARIANT: When testing Cucumber/Gherkin functions or AST code-generation (e.g. ParsedFeature, ParsedScenario, ParsedStep), NEVER pass incomplete mock step or scenario objects. Every step object MUST contain { lineNumber, stepText: string, keyword: 'Given'|'When'|'Then' }. Every scenario object MUST contain { lineNumber, title: string, steps: ParsedStep[] }.

### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS
- Current Coverage: Lines ${coverageDetails?.summary?.linesPct ?? 0}%, Branches ${coverageDetails?.summary?.branchesPct ?? 0}%, Functions ${coverageDetails?.summary?.funcsPct ?? 0}%, Statements ${coverageDetails?.summary?.stmtsPct ?? 0}%
- Control Flow Graph Complexity: Cyclomatic Complexity (CC) = ${cyclomaticComplexity} (Basis Paths = ${cyclomaticComplexity})
- Uncovered Lines in Source: ${uncoveredLinesStr}
- Uncovered Functions (0 invocations):
${functionDetailsStr}
- Uncovered Branches & Conditions:
${branchDetailsStr}
- CRITICAL DECISION POINTS & BRANCH TARGETS TO EXERCISE:
${decisionGuidanceStr}
- Failed Assertions in Previous Test Run:
${failedLinesStr}

### 4. SOURCE CODE & EXISTING TESTS
${sourceCode ? `SOURCE CODE UNDER TEST:
\`\`\`javascript
${sourceCode.slice(0, 25000)}
\`\`\`
` : ""}

EXISTING TEST CODE IN ${testFileInfo.relativePath}:
\`\`\`javascript
${(testFileInfo.content || "").slice(0, 25000)}
\`\`\`

### 5. STRICT GENERATION RULES & METHODOLOGY (TARGETING >=90% TO 100% COVERAGE)
1. NEVER USE test.skip / it.skip / describe.skip / xit / xtest:
   - Every single test MUST be active and runnable using \`test(...)\` or \`it(...)\`.
   - Tests marked with \`.skip\` produce 0% coverage increase and are strictly forbidden.
2. ONLY IMPORT EXPORTED SYMBOLS & TEST INTERNAL LOGIC INDIRECTLY:
${unexportedWarning}
3. REUSE EXISTING TEST MOCKS AND CONVENTIONS:
   - Carefully inspect the EXISTING TEST CODE in ${testFileInfo.relativePath}.
   - Re-use the exact same mocks, fixtures, and beforeEach configurations already established.
4. MANDATORY TEST MATRIX (DECISION TABLE) & CFG BASIS PATHS (CC = ${cyclomaticComplexity}, TARGET MINIMUM ${cyclomaticComplexity} BASIS PATHS):
   - To satisfy McCabe's Basis Path Testing invariant, generate at least ${cyclomaticComplexity} independent test scenarios covering all execution paths in the Control Flow Graph.
   - Follow this structured 4-category Decision Table created from AST analysis and coverage gaps:
${decisionTableMarkdown}
   - You MUST include test cases addressing all 4 essential business logic testing categories:
   - Category A (Happy Path): Standard valid invocations verifying expected business output.
   - Category B (Boundary Values): Edge inputs such as 0, negative numbers, empty arrays [], empty strings "", empty objects {}, and max limits.
   - Category C (Branch Toggling): For EVERY conditional statement (if/else, ternary ? :, switch/case, ||, &&, ??, ?.), write test cases testing BOTH the True branch AND the False branch! Specifically pass null and undefined to exercise ??, ||, and ?. fallbacks.
   - Category D (Error & Exception Handling): Force invalid parameters, test every 'throw' statement, and mock asynchronous dependency failures (rejected promises) to ensure 'catch' blocks are 100% executed.
5. REAL ASSERTIONS, NO TRIVIAL PLACEHOLDERS:
   - DO NOT write placeholder assertions like expect(true).toBe(true).
   - Every assertion must verify real outputs, state changes, or mock call arguments.
6. CRITICAL: NEVER RETURN PLACEHOLDER COMMENTS LIKE '// No additional snippets needed' OR 'N/A':
   - "suggestedTestCode" MUST contain executable test(...) or it(...) blocks importing and testing ${cleanSource}.
        if (typeof deduplicateAstDeclarations === 'function') {
            try {
                const dedupRes = deduplicateAstDeclarations(currentCode, { filePath });
                if (dedupRes.changed && dedupRes.code) currentCode = dedupRes.code;
            } catch (_) {}
        }
   - If no existing test file exists, "suggestedTestCode" MUST contain the complete test file code.
7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):
${mockInstructionsStr}
   - ONLY call functions listed under EXPORTED PUBLIC SYMBOLS (${exportedSymbolsStr}).
8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:
   - Every describe(...), test(...), it(...), and object literal MUST have fully-closed, matching parentheses ')' and braces '}'.
   - When declaring mock data objects, use standard 'const mockItem = { ... };' or 'var mockItem = globalThis["mockItem"] = globalThis["mockItem"] || { ... };'.
   - NEVER leave open parentheses or unclosed string literals at statement boundaries.
9. EXPRESS CONTROLLER & MIDDLEWARE FIXTURES CONTRACT:
   - When generating tests for Express controllers or route handlers (or mutating req.body, req.file, req.params, req.query, req.headers):
   - ALWAYS ensure 'req', 'res', and 'next' are properly initialized as objects before tests execute!
   - In beforeEach or within the test block:
     req = { body: {}, params: {}, query: {}, headers: {}, file: null, files: [], user: { id: 1, role: 'admin' } };
     res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis(), setHeader: jest.fn().mockReturnThis(), end: jest.fn().mockReturnThis() };
     next = jest.fn();
   - NEVER access properties like 'req.file = ...' or 'req.body = ...' without ensuring 'req' is an object.
10. RUNNER COMPATIBILITY (JEST & VITEST):
   - In Jest environments, use 'jest.fn()', 'jest.mock()', 'jest.spyOn()'.
   - NEVER access 'vi.fn()' in Jest suites unless 'vi' is explicitly imported or aliased to 'jest'.

### 6. OUTPUT FORMAT
Format your output strictly in JSON (ensure valid JSON syntax: values MUST be strings enclosed in double quotes "...", never backtick characters):
{
  "explanation": "Summary of the added test cases and which branches are covered",
  "suggestedTestCode": "// only executable test code blocks with real assertions",
  "fullUpdatedContent": "// complete test file content to be written"
}
`
        : `You are an expert ${framework.toUpperCase()} unit testing engineer.
We need to generate a comprehensive unit test suite to achieve >=90% to 100% coverage across all 4 metrics (Statements, Branches, Functions, Lines) and fix failed assertions for this source file.

### 1. ROLE DEFINITION & PROJECT CONTEXT
- Testing Framework: ${framework.toUpperCase()} (${isVitest ? "Vitest ESM syntax: import { describe, test, it, expect, vi } from 'vitest';" : "Jest syntax: describe, test, it, expect, jest are globally available. In CommonJS NEVER import or declare 'jest' (e.g. NEVER write const { jest } = require('@jest/globals') or const jest = ...), as 'jest' is already a global parameter."})
- Target Source File: ${cleanSource}
- Target Test File: ${testFileInfo.relativePath} (Status: NEW TEST FILE TO CREATE)
- Runner API contract: ${runnerContract}
- Branch reachability contract: ${pathContract}

### 2. TARGET FILE & IMPORT CONTRACT
- Source Module Import Path: "${cleanImportPath}" (MUST import from: '${cleanImportPath}'; DO NOT guess other folders!)
- EXPORTED PUBLIC SYMBOLS (ONLY import and call these directly): ${exportedSymbolsStr}
${unexportedWarning}

### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS
- Current Coverage: Lines ${coverageDetails?.summary?.linesPct ?? 0}%, Branches ${coverageDetails?.summary?.branchesPct ?? 0}%, Functions ${coverageDetails?.summary?.funcsPct ?? 0}%, Statements ${coverageDetails?.summary?.stmtsPct ?? 0}%
- Control Flow Graph Complexity: Cyclomatic Complexity (CC) = ${cyclomaticComplexity} (Basis Paths = ${cyclomaticComplexity})
- Uncovered Lines in Source: ${uncoveredLinesStr}
- Uncovered Functions (0 invocations):
${functionDetailsStr}
- Uncovered Branches & Conditions:
${branchDetailsStr}
- CRITICAL DECISION POINTS & BRANCH TARGETS TO EXERCISE:
${decisionGuidanceStr}
- Failed Assertions in Previous Test Run:
${failedLinesStr}

### 4. SOURCE CODE
\`\`\`javascript
${sourceCode.slice(0, 25000)}
\`\`\`

### 5. STRICT GENERATION RULES & METHODOLOGY (TARGETING >=90% TO 100% COVERAGE)
1. NEVER USE test.skip / it.skip / describe.skip / xit / xtest:
   - Every single test MUST be active and runnable using \`test(...)\` or \`it(...)\`.
   - Tests marked with \`.skip\` produce 0% coverage increase and are strictly forbidden.
2. ONLY IMPORT EXPORTED SYMBOLS & TEST INTERNAL LOGIC INDIRECTLY:
${unexportedWarning}
3. REUSE EXISTING TEST MOCKS AND CONVENTIONS:
   - If test code exists, re-use existing mock patterns and assertions.
4. MANDATORY TEST MATRIX (DECISION TABLE) & CFG BASIS PATHS (CC = ${cyclomaticComplexity}, MINIMUM ${cyclomaticComplexity} BASIS PATHS):
   - To satisfy McCabe's Basis Path Testing invariant, generate at least ${cyclomaticComplexity} independent test scenarios covering all execution paths in the Control Flow Graph.
   - Follow this structured 4-category Decision Table created from AST analysis and coverage gaps:
${decisionTableMarkdown}
   - You MUST include test cases addressing all 4 essential business logic testing categories:
   - Category A (Happy Path): Standard valid invocations verifying expected business output.
   - Category B (Boundary Values): Edge inputs such as 0, negative numbers, empty arrays [], empty strings "", empty objects {}, and max limits.
   - Category C (Branch Toggling): For EVERY conditional statement (if/else, switch, ternary, ||, &&, ??, ?.), craft test inputs executing BOTH the True branch AND the False branch! Specifically pass null and undefined to exercise ??, ||, and ?. fallbacks.
   - Category D (Error & Exception Handling): Force invalid parameters, test every 'throw' statement, and mock asynchronous dependency failures (rejected promises) to ensure 'catch' blocks are 100% executed.
5. REAL ASSERTIONS, NO TRIVIAL PLACEHOLDERS:
   - DO NOT write placeholder assertions like expect(true).toBe(true).
   - Assert exact return values, transformed objects, or mock invocations.
6. CRITICAL: NEVER RETURN PLACEHOLDER COMMENTS LIKE '// No additional snippets needed' OR 'N/A':
   - "suggestedTestCode" MUST contain executable test(...) or it(...) blocks importing and testing ${cleanSource}.
   - "fullUpdatedContent" MUST contain the complete, standalone test file ready to execute.
7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):
${mockInstructionsStr}
   - ONLY call functions listed under EXPORTED PUBLIC SYMBOLS (${exportedSymbolsStr}).
8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:
   - Every describe(...), test(...), it(...), and object literal MUST have fully-closed, matching parentheses ')' and braces '}'.
   - When declaring mock data objects, use standard 'const mockItem = { ... };' or 'var mockItem = globalThis["mockItem"] = globalThis["mockItem"] || { ... };'.
   - NEVER leave open parentheses or unclosed string literals at statement boundaries.
9. EXPRESS CONTROLLER & MIDDLEWARE FIXTURES CONTRACT:
   - When generating tests for Express controllers or route handlers (or mutating req.body, req.file, req.params, req.query, req.headers):
   - ALWAYS ensure 'req', 'res', and 'next' are properly initialized as objects before tests execute!
   - In beforeEach or within the test block:
     req = { body: {}, params: {}, query: {}, headers: {}, file: null, files: [], user: { id: 1, role: 'admin' } };
     res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis(), setHeader: jest.fn().mockReturnThis(), end: jest.fn().mockReturnThis() };
     next = jest.fn();
   - NEVER access properties like 'req.file = ...' or 'req.body = ...' without ensuring 'req' is an object.
10. RUNNER COMPATIBILITY (JEST & VITEST):
   - In Jest environments, use 'jest.fn()', 'jest.mock()', 'jest.spyOn()'.
   - NEVER access 'vi.fn()' in Jest suites unless 'vi' is explicitly imported or aliased to 'jest'.

### 6. OUTPUT FORMAT
Format your output strictly in JSON:
{
  "explanation": "Summary of the added test cases and which branches are covered",
  "suggestedTestCode": "// only executable test code blocks with real assertions",
  "fullUpdatedContent": "// complete test file content to be written"
}
`;
};

/**
 * Iterative AST Syntax Self-Healing Engine (Rule 5 & Rule 9)
 * Repairs missing semicolons at line:col, missing commas in objects/arrays,
 * unclosed blocks/braces, unseparated statements, and runs deep sanitization.
 */
export const autoHealAstSyntax = (codeString, { framework = "jest", filePath = "", maxRetries = 6 } = {}) => {
    if (!codeString || typeof codeString !== "string") {
        return { success: false, code: codeString, error: "Empty code" };
    }
    let currentCode = codeString;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (typeof balanceTestFileBracesAndParens === "function") {
            try {
                currentCode = balanceTestFileBracesAndParens(currentCode);
            } catch (_) {}
        }
        if (typeof cleanAndDeduplicateTestContent === "function") {
            try {
                currentCode = cleanAndDeduplicateTestContent(currentCode, "", filePath, { framework });
            } catch (_) {}
        if (typeof deduplicateAstDeclarations === 'function') {
            try {
                const dedupRes = deduplicateAstDeclarations(currentCode, { filePath });
                if (dedupRes.changed && dedupRes.code) currentCode = dedupRes.code;
            } catch (_) {}
        }
        }

        const parsed = parseJavaScriptCode(currentCode);
        if (parsed.success) {
            return { success: true, code: currentCode, ast: parsed.ast };
        }

        const msg = parsed.error || "";

        // 1. Missing semicolon at line:col (e.g. Missing semicolon. (2:15))
        const semiMatch = msg.match(/Missing semicolon\. \((\d+):(\d+)\)/);
        if (semiMatch) {
            const lineNum = parseInt(semiMatch[1], 10);
            const colNum = parseInt(semiMatch[2], 10);
            const lines = currentCode.split("\n");
            if (lineNum <= lines.length) {
                const line = lines[lineNum - 1];
                const before = line.slice(0, colNum);
                const after = line.slice(colNum);
                lines[lineNum - 1] = `${before};\n${after.trimStart()}`;
                currentCode = lines.join("\n");
                continue;
            }
        }

        // 2. Unexpected token (e.g. Unexpected token, expected "," (76:154) or Unexpected token ';')
        const unexpectedMatch = msg.match(/Unexpected token(?:, expected [",']?(.*?)[",']?)? \((\d+):(\d+)\)/);
        if (unexpectedMatch) {
            const expectedToken = unexpectedMatch[1] || "";
            const lineNum = parseInt(unexpectedMatch[2], 10);
            const colNum = parseInt(unexpectedMatch[3], 10);
            const lines = currentCode.split("\n");
            if (lineNum > 0 && lineNum <= lines.length) {
                const targetLine = lines[lineNum - 1];
                const stripped = targetLine
                    .replace(/\/\/.*$/, "")
                    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "");

                let pOpen = 0, pClose = 0;
                for (const ch of stripped) {
                    if (ch === "(") pOpen++;
                    else if (ch === ")") pClose++;
                }

                // If line has unclosed parentheses before semicolon, heal parentheses first!
                if (pOpen > pClose) {
                    const semiIdx = targetLine.lastIndexOf(";");
                    if (semiIdx !== -1) {
                        lines[lineNum - 1] = targetLine.slice(0, semiIdx) + ")".repeat(pOpen - pClose) + targetLine.slice(semiIdx);
                        currentCode = lines.join("\n");
                        continue;
                    }
                }

                if (expectedToken === ",") {
                    const before = targetLine.slice(0, colNum);
                    const after = targetLine.slice(colNum);
                    lines[lineNum - 1] = `${before}, ${after.trimStart()}`;
                    currentCode = lines.join("\n");
                    continue;
                }
            }
        }

        // 3. Balance unclosed braces at EOF
        const openBraces = (currentCode.match(/{/g) || []).length;
        const closeBraces = (currentCode.match(/}/g) || []).length;
        if (openBraces > closeBraces) {
            let diff = openBraces - closeBraces;
            let suffix = "";
            while (diff > 0) {
                suffix += "\n});";
                diff--;
            }
            currentCode = currentCode.trim() + suffix;
            continue;
        }

        // 4. Decouple glued inline statements safely
        const decoupled = safeDecoupleInlineStatements(currentCode);
        if (decoupled !== currentCode) {
            currentCode = decoupled;
            continue;
        }

        // 5. Check if trailing closing delimiter is needed at EOF
        if (!currentCode.trim().endsWith("}") && !currentCode.trim().endsWith(");")) {
            currentCode = currentCode.trim() + "\n});";
            continue;
        }

        return { success: false, code: currentCode, error: msg };
    }

    return { success: false, code: currentCode, error: "Exceeded AST self-healing retries" };
};

/**
 * 3.2 RESPONSE PARSING & SANITY CHECK (AST SYNTAX VALIDATION & ANTI-SKIP)
 *
 * Validates, cleans, and verifies the AI generated code:
 * - Strips markdown wrapping (```json, ```javascript, ```).
 * - Extracts JSON safely.
 * - Removes .skip from test.skip / it.skip / describe.skip / xit / xtest.
 * - Filters out placeholder text ("N/A", "// No additional snippets needed").
 * - Validates AST syntax using Babel Parser (flags/repairs syntax errors).
 * - Ensures presence of test blocks and expect assertions.
 *
 * @param {object} params
 * @param {string} params.rawResponse - Raw string response from Gemini
 * @param {string} params.framework - "jest" or "vitest"
 * @param {string} params.cleanSource - Target source file
 * @returns {object} { success: boolean, parsed: object, syntaxValid: boolean, errors: string[] }
 */
export const parseAndSanitizeAiTestResponse = ({
    rawResponse = "",
    framework = "jest",
    cleanSource = ""
}) => {
    const errors = [];
    if (!rawResponse || typeof rawResponse !== "string") {
        return { success: false, parsed: null, syntaxValid: false, errors: ["Empty AI response received"] };
    }

    let cleanText = rawResponse.trim();

    // 1. Strip markdown code fence blocks
    if (cleanText.includes("```json")) {
        cleanText = cleanText.replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim();
    } else if (cleanText.includes("```javascript") || cleanText.includes("```js")) {
        cleanText = cleanText.replace(/^[\s\S]*?```(?:javascript|js)\s*/i, "").replace(/```[\s\S]*$/, "").trim();
    } else if (cleanText.includes("```")) {
        cleanText = cleanText.replace(/^[\s\S]*?```\s*/, "").replace(/```[\s\S]*$/, "").trim();
    }

    // 2. Extract JSON payload
    let parsedJson = null;

    // 2.1 Direct regex extraction for LLM outputs that wrap code in backticks (`...`) instead of JSON string quotes
    const extractBacktickField = (fieldName, text) => {
        const match = text.match(new RegExp(`["']${fieldName}["']\\s*:\\s*\`([\\s\\S]*?)\`\\s*(?:,|\\n|\\r|\\})`, "m"));
        return match ? match[1] : null;
    };

    const btTestCode = extractBacktickField("suggestedTestCode", cleanText);
    const btFullContent = extractBacktickField("fullUpdatedContent", cleanText);
    const btExplanation = extractBacktickField("explanation", cleanText);

    if (btTestCode || btFullContent) {
        parsedJson = {
            explanation: btExplanation || "Targeted unit test cases for uncovered branches",
            suggestedTestCode: btTestCode || btFullContent || "",
            fullUpdatedContent: btFullContent || btTestCode || ""
        };
    }

    if (!parsedJson) {
        try {
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsedJson = JSON.parse(jsonMatch[0]);
            } else {
                parsedJson = JSON.parse(cleanText);
            }
        } catch (parseErr) {
            // Attempt mild JSON repair (e.g. unescaped newlines, backticks, or trailing commas)
            try {
                let repaired = cleanText
                    .replace(/:\s*`([\s\S]*?)`\s*([,}])/g, (m, val, post) => `: ${JSON.stringify(val)}${post}`)
                    .replace(/,\s*([}\]])/g, "$1") // trailing commas
                    .replace(/\r?\n/g, "\\n");
                const match = repaired.match(/\{[\s\S]*\}/);
                if (match) parsedJson = JSON.parse(match[0]);
            } catch (_) {
                // 2.2 Direct code extraction fallback from markdown code blocks or cleanText
                const codeBlockMatch = rawResponse.match(/```(?:javascript|js|typescript|ts)?\r?\n([\s\S]*?)```/);
                const candidateCode = codeBlockMatch ? codeBlockMatch[1] : cleanText;
                if (candidateCode && (candidateCode.includes("test(") || candidateCode.includes("it(") || candidateCode.includes("describe("))) {
                    parsedJson = {
                        explanation: "Extracted test suite from code block response",
                        suggestedTestCode: candidateCode.trim(),
                        fullUpdatedContent: candidateCode.trim()
                    };
                } else {
                    errors.push(`JSON parsing error: ${parseErr.message}`);
                }
            }
        }
    }

    if (!parsedJson) {
        return { success: false, parsed: null, syntaxValid: false, errors };
    }

    // 3. Anti-skip sanitization
    const unskipCode = (code) => {
        if (!code || typeof code !== "string") return code;
        return code
            .replace(/\b(test|it)\.skip\s*\(/g, "$1(")
            .replace(/\bdescribe\.skip\s*\(/g, "describe(")
            .replace(/\bxit\s*\(/g, "it(")
            .replace(/\bxtest\s*\(/g, "test(")
            .replace(/\bxdescribe\s*\(/g, "describe(");
    };

    if (parsedJson.suggestedTestCode) {
        parsedJson.suggestedTestCode = unskipCode(parsedJson.suggestedTestCode);
    }
    if (parsedJson.fullUpdatedContent) {
        parsedJson.fullUpdatedContent = unskipCode(parsedJson.fullUpdatedContent);
    }

    // 3.4. Decouple glued inline statements safely
    if (parsedJson.suggestedTestCode) {
        parsedJson.suggestedTestCode = safeDecoupleInlineStatements(parsedJson.suggestedTestCode);
    }
    if (parsedJson.fullUpdatedContent) {
        parsedJson.fullUpdatedContent = safeDecoupleInlineStatements(parsedJson.fullUpdatedContent);
    }

    // 3.5. Self-assignment sanitization (e.g. const path = path; -> const path = require('path'); or removal)
    const sanitizeSelfAssignments = (code) => {
        if (!code || typeof code !== "string") return code;
        const NODE_BUILTIN_MODULES = new Set([
            "path", "fs", "crypto", "http", "https", "os", "url", "util", "events", "stream",
            "child_process", "buffer", "zlib", "net", "tls", "cluster", "readline", "vm", "worker_threads"
        ]);
        const isTs = framework === "vitest" || /\bimport\s+/.test(code);
        return code.replace(
            /(?:^[ \t]*|\n[ \t]*)(const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*\2\s*;?[ \t]*(?:\r?\n|$)/gm,
            (match, kind, varName) => {
                if (NODE_BUILTIN_MODULES.has(varName)) {
                    return isTs
                        ? `\nimport ${varName} from '${varName}';\n`
                        : `\nconst ${varName} = require('${varName}');\n`;
                }
                return "\n";
            }
        );
    };

    if (parsedJson.suggestedTestCode) {
        parsedJson.suggestedTestCode = sanitizeSelfAssignments(parsedJson.suggestedTestCode);
    }
    if (parsedJson.fullUpdatedContent) {
        parsedJson.fullUpdatedContent = sanitizeSelfAssignments(parsedJson.fullUpdatedContent);
    }

    // 4. Placeholder detection & reconciliation
    const isPlaceholderCode = (str) => {
        if (!str || typeof str !== "string") return true;
        const t = str.trim();
        if (t.length < 30) return true;
        if (
            t.includes("N/A") ||
            t.includes("Providing full file content below") ||
            t.includes("No additional snippets needed") ||
            t.includes("fullUpdatedContent below") ||
            t.includes("next block")
        ) return true;
        if (t.startsWith("//") && !t.includes("test(") && !t.includes("it(")) return true;
        if (t.startsWith("N/A") || t.startsWith("None") || t.startsWith("No ")) return true;
        if (!t.includes("test(") && !t.includes("it(")) return true;
        return false;
    };

    if (isPlaceholderCode(parsedJson.suggestedTestCode) && !isPlaceholderCode(parsedJson.fullUpdatedContent)) {
        parsedJson.suggestedTestCode = parsedJson.fullUpdatedContent;
    } else if (isPlaceholderCode(parsedJson.fullUpdatedContent) && !isPlaceholderCode(parsedJson.suggestedTestCode)) {
        parsedJson.fullUpdatedContent = parsedJson.suggestedTestCode;
    }

    if (isPlaceholderCode(parsedJson.suggestedTestCode) && isPlaceholderCode(parsedJson.fullUpdatedContent)) {
        errors.push("Both suggestedTestCode and fullUpdatedContent contain placeholder comments or lack executable test blocks");
        return { success: false, parsed: parsedJson, syntaxValid: false, errors };
    }

    // Enforce runner imports before previewing or applying AI-generated code.
    for (const field of ["suggestedTestCode", "fullUpdatedContent"]) {
        if (parsedJson[field]) {
            parsedJson[field] = normalizeTestFrameworkCode(parsedJson[field], { framework });
        }
    }

    // 5. AST Syntax Validation & Universal Self-Healing via Babel Parser (Rule 5 & Rule 9)
    let codeToValidate = parsedJson.fullUpdatedContent || parsedJson.suggestedTestCode;
    const healResult = autoHealAstSyntax(codeToValidate, { framework, filePath: cleanSource });
    let syntaxValid = healResult.success;

    if (syntaxValid) {
        if (parsedJson.fullUpdatedContent) {
            const healedFull = autoHealAstSyntax(parsedJson.fullUpdatedContent, { framework, filePath: cleanSource });
            if (healedFull.success) parsedJson.fullUpdatedContent = healedFull.code;
        }
        if (parsedJson.suggestedTestCode) {
            const healedSuggested = autoHealAstSyntax(parsedJson.suggestedTestCode, { framework, filePath: cleanSource });
            if (healedSuggested.success) parsedJson.suggestedTestCode = healedSuggested.code;
        }
    } else {
        errors.push(`AST syntax validation failed: ${healResult.error || "Syntax error in generated test code"}`);
    }

    // 6. Ensure real assertions exist
    const hasAssertions = /expect\s*\(/.test(parsedJson.suggestedTestCode || parsedJson.fullUpdatedContent);
    if (!hasAssertions) {
        errors.push("Generated test code lacks expect(...) assertions");
    }

    const success = syntaxValid && errors.length === 0;

    return {
        success,
        parsed: parsedJson,
        syntaxValid,
        hasAssertions,
        errors
    };
};

/**
 * 3.3 RESILIENT GENERATION ORCHESTRATION (GEMINI LLM WITH ISOLATION FALLBACK)
 *
 * Runs the end-to-end Phase 3 generation process:
 * 1. Assembles complete Phase 1 AST & Phase 2 Context via assembleUnitTestContext.
 * 2. Builds 6-part standardized prompt via buildStandardUnitTestPrompt.
 * 3. Calls Gemini API with 45s race timeout.
 * 4. Parses and validates response via parseAndSanitizeAiTestResponse.
 * 5. Falls back seamlessly to generateFallbackUnitTests if AI service is offline or invalid.
 *
 * @param {object} params
 * @param {string} params.framework - "jest" or "vitest"
 * @param {object} params.snapshot - Project snapshot
 * @param {string} params.sourceFileToInspect - Relative source file under test
 * @param {string} params.sourceCode - Raw source code
 * @param {object} params.coverageDetails - Istanbul / v8 line/branch coverage data
 * @param {boolean} params.isTest - Whether target is existing test file
 * @param {string} params.filePath - Input target file path
 * @returns {Promise<object>} Suggestion result object
 */
export const generateAiUnitTestSuite = async ({
    userId,
    framework = "jest",
    snapshot,
    sourceFileToInspect,
    sourceCode,
    coverageDetails,
    isTest,
    filePath
}) => {
    const cleanSource = sanitizeSourceFilePath(snapshot?.rootDir, sourceFileToInspect);
    const ext = path.extname(cleanSource) || ".js";
    const baseName = path.basename(cleanSource, ext).replace(/\.(test|spec)$/i, "");

    const testFileInfo = isTest
        ? {
            found: true,
            relativePath: filePath,
            suggestedFilePath: filePath,
            absolutePath: path.join(snapshot.rootDir, filePath),
            fileName: path.basename(filePath),
            content: fs.existsSync(path.join(snapshot.rootDir, filePath)) ? fs.readFileSync(path.join(snapshot.rootDir, filePath), "utf8") : "",
            framework
        }
        : findExistingTestFile(snapshot.rootDir, cleanSource, framework);

    let proposalBase = {};
    if (userId && snapshot?.projectId && snapshot?.id) {
        const { captureProjectProposalBase } = await import("./projectProposalBase.service.js");
        proposalBase = await captureProjectProposalBase({ projectId: snapshot.projectId, snapshotId: snapshot.id, userId, path: testFileInfo.relativePath });
        testFileInfo.content = proposalBase.existingContent;
        testFileInfo.found = proposalBase.isExisting;
    }
    const cleanImportPath = computeRelativeImportPath(testFileInfo.relativePath, cleanSource, snapshot?.rootDir);

    // 1. Assemble Phase 1 AST & Phase 2 Context Engineering
    const unitTestContext = assembleUnitTestContext({
        sourceCode,
        coverageDetails,
        framework,
        existingTestCode: testFileInfo.content || ""
    });

    // 2. Build Standard 6-Part Prompt (Section 3.1)
    const prompt = buildStandardUnitTestPrompt({
        framework,
        cleanSource,
        testFileInfo,
        cleanImportPath,
        coverageDetails,
        sourceCode,
        unitTestContext
    });

    // 3. Invoke LLM with 90s Timeout
    let aiParsedResult = null;
    let aiGenerationError = null;
    let generationTimeout;

    try {
        let generationTimer;
        const responseText = await Promise.race([
            generateText(prompt),
            new Promise((_, reject) => { generationTimer = setTimeout(() => reject(new Error("AI generation timed out (90s limit reached)")), 90000); })
        ]).finally(() => clearTimeout(generationTimer));

        // 4. Parse & Sanitize Response (Section 3.2)
        const parseCheck = parseAndSanitizeAiTestResponse({
            rawResponse: responseText,
            framework,
            cleanSource
        });

        if (parseCheck.success && parseCheck.parsed) {
            aiParsedResult = parseCheck.parsed;
        } else {
            aiGenerationError = (parseCheck.errors || []).join("; ");
            console.warn(`[unitTestGenerator] AI sanity check warning (${framework}): ${aiGenerationError}`);
        }
    } catch (aiErr) {
        aiGenerationError = aiErr.message;
        console.warn(`[unitTestGenerator] AI Generation fallback triggered (${framework}): ${aiErr.message}`);
    } finally {
        clearTimeout(generationTimeout);
    }

    // 5. Resilient Isolation Mock Fallback if AI output failed validation
    if (!aiParsedResult) {
        aiParsedResult = generateFallbackUnitTests({
            framework,
            sourceFile: cleanSource,
            targetTestFile: testFileInfo.relativePath,
            rootDir: snapshot?.rootDir,
            baseName,
            uncoveredLines: coverageDetails?.uncoveredLines || [],
            existingContent: testFileInfo.content,
            sourceCode
        });
    }

    // 6. Format Final Primary Suggestion
    const cleanRepoPath = (p) => {
        if (!p) return "";
        let norm = p.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
        if (snapshot?.rootDir) {
            const normRoot = snapshot.rootDir.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
            if (norm.startsWith(normRoot)) norm = norm.slice(normRoot.length);
        }
        norm = norm.replace(/^.*\/repo\//, "");
        return norm.replace(/^\/+/, "");
    };

    const cleanSourceFile = cleanRepoPath(sourceFileToInspect);
    const cleanTargetTest = cleanRepoPath(testFileInfo.relativePath || testFileInfo.fullPath);

    const branches = coverageDetails?.branches || coverageDetails?.branchFlow || [];
    const uncoveredBranches = branches.filter(b => b.status !== "fully_covered" || b.totalHits === 0);
    const targetBranchesList = uncoveredBranches.map(b => `${b.type}:${b.line}`);
    const primaryTargetLines = coverageDetails?.uncoveredLines?.slice(0, 5) || [];
    const primaryReason = uncoveredBranches.length > 0
        ? `Branch ${uncoveredBranches[0].type} at line ${uncoveredBranches[0].line} (${uncoveredBranches[0].condition || "branch condition"}) was not executed`
        : (primaryTargetLines.length > 0
            ? `Lines ${primaryTargetLines.join(", ")} not tested in current suite`
            : "Add test cases covering edge cases and logical conditions");

    const primarySuggestion = {
        ...proposalBase,
        proposalBase: { ...proposalBase, existingContent: undefined },
        suggestionId: `sug-${Date.now()}-1`,
        sourceFile: cleanSourceFile,
        testFile: cleanTargetTest,
        targetTestFile: cleanTargetTest,
        framework,
        testType: "unit",
        targetLines: primaryTargetLines,
        targetBranches: targetBranchesList,
        reason: primaryReason,
        explanation: aiParsedResult.explanation || `Exhaustive ${framework.toUpperCase()} unit tests for ${cleanSourceFile}`,
        generatedCode: aiParsedResult.suggestedTestCode || aiParsedResult.fullUpdatedContent,
        suggestedTestCode: aiParsedResult.suggestedTestCode || aiParsedResult.fullUpdatedContent,
        originalCode: testFileInfo.content || "",
        fullUpdatedContent: aiParsedResult.fullUpdatedContent,
        status: "GENERATED",
        isExisting: testFileInfo.found,
        uncoveredLines: coverageDetails?.uncoveredLines || [],
        failedLines: coverageDetails?.failedLines || [],
        summary: coverageDetails?.summary ? {
            linesPct: coverageDetails.summary.linesPct ?? 0,
            branchesPct: coverageDetails.summary.branchesPct ?? 0,
            functionsPct: coverageDetails.summary.functionsPct ?? coverageDetails.summary.funcsPct ?? 0,
            statementsPct: coverageDetails.summary.statementsPct ?? coverageDetails.summary.stmtsPct ?? 0,
            funcsPct: coverageDetails.summary.functionsPct ?? coverageDetails.summary.funcsPct ?? 0,
            stmtsPct: coverageDetails.summary.statementsPct ?? coverageDetails.summary.stmtsPct ?? 0,
            ...coverageDetails.summary
        } : {
            linesPct: 0,
            branchesPct: 0,
            functionsPct: 0,
            statementsPct: 0
        },
        decisionTableSummary: unitTestContext?.decisionTable?.summary
    };

    return {
        ...primarySuggestion,
        suggestions: [primarySuggestion]
    };
};
