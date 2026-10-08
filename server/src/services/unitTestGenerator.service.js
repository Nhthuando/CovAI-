import fs from "fs";
import path from "path";
import { generateText } from "./gemini.service.js";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { assembleUnitTestContext, buildIsolationMockContracts } from "./unitTestContextEngineering.service.js";
import {
    computeRelativeImportPath,
    formatLineRanges,
    generateFallbackUnitTests,
    findExistingTestFile,
    sanitizeSourceFilePath
} from "./unitTestSuggestion.service.js";

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

    const exportedSymbols = unitTestContext?.astMetadata?.exportedSymbolNames || [];
    const exportedSymbolsStr = exportedSymbols.length > 0 ? exportedSymbols.join(", ") : "All exported module members";
    const unexportedWarning = unitTestContext?.indirectTesting?.indirectGuidancePrompt || "";
    const mockInstructionsStr = unitTestContext?.mockContracts?.mockInstructions || "";
    const decisionTableMarkdown = unitTestContext?.decisionTable?.decisionTableMarkdown || "";
    const decisionGuidanceStr = unitTestContext?.coverageGaps?.guidanceSummary || "No complex branching detected";

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
- Target Source File: ${cleanSource}

### 2. TARGET FILE & IMPORT CONTRACT
- Source Module Import Path: "${cleanImportPath}" (e.g. import { ... } from '${cleanImportPath}';)
- EXPORTED PUBLIC SYMBOLS (ONLY import and call these directly): ${exportedSymbolsStr}
${unexportedWarning}

### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS
- Current Coverage: Lines ${coverageDetails?.summary?.linesPct ?? 0}%, Branches ${coverageDetails?.summary?.branchesPct ?? 0}%, Functions ${coverageDetails?.summary?.funcsPct ?? 0}%, Statements ${coverageDetails?.summary?.stmtsPct ?? 0}%
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
4. MANDATORY TEST MATRIX (DECISION TABLE) TO HIT >= 90% TO 100% COVERAGE:
   Follow this structured 4-category Decision Table created from AST analysis and coverage gaps:
${decisionTableMarkdown}
   You MUST include test cases addressing all 4 essential business logic testing categories:
   - Category A (Happy Path): Standard valid invocations verifying expected business output.
   - Category B (Boundary Values): Edge inputs such as 0, negative numbers, empty arrays [], empty strings "", empty objects {}, and max limits.
   - Category C (Branch Toggling): For EVERY conditional statement (if/else, ternary ? :, switch/case, ||, &&, ??, ?.), write test cases testing BOTH the True branch AND the False branch! Specifically pass null and undefined to exercise ??, ||, and ?. fallbacks.
   - Category D (Error & Exception Handling): Force invalid parameters, test every 'throw' statement, and mock asynchronous dependency failures (rejected promises) to ensure 'catch' blocks are 100% executed.
5. REAL ASSERTIONS, NO TRIVIAL PLACEHOLDERS:
   - DO NOT write placeholder assertions like expect(true).toBe(true).
   - Every assertion must verify real outputs, state changes, or mock call arguments.
6. CRITICAL: NEVER RETURN PLACEHOLDER COMMENTS LIKE '// No additional snippets needed' OR 'N/A':
   - "suggestedTestCode" MUST contain executable test(...) or it(...) blocks importing and testing ${cleanSource}.
   - If no existing test file exists, "suggestedTestCode" MUST contain the complete test file code.
7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):
${mockInstructionsStr}
   - ONLY call functions listed under EXPORTED PUBLIC SYMBOLS (${exportedSymbolsStr}).

### 6. OUTPUT FORMAT
Format your output strictly in JSON:
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

### 2. TARGET FILE & IMPORT CONTRACT
- Source Module Import Path: "${cleanImportPath}" (MUST import from: '${cleanImportPath}'; DO NOT guess other folders!)
- EXPORTED PUBLIC SYMBOLS (ONLY import and call these directly): ${exportedSymbolsStr}
${unexportedWarning}

### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS
- Current Coverage: Lines ${coverageDetails?.summary?.linesPct ?? 0}%, Branches ${coverageDetails?.summary?.branchesPct ?? 0}%, Functions ${coverageDetails?.summary?.funcsPct ?? 0}%, Statements ${coverageDetails?.summary?.stmtsPct ?? 0}%
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
4. MANDATORY TEST MATRIX (DECISION TABLE) TO HIT >= 90% TO 100% COVERAGE:
   Follow this structured 4-category Decision Table created from AST analysis and coverage gaps:
${decisionTableMarkdown}
   You MUST include test cases addressing all 4 essential business logic testing categories:
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
    try {
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            parsedJson = JSON.parse(jsonMatch[0]);
        } else {
            parsedJson = JSON.parse(cleanText);
        }
    } catch (parseErr) {
        // Attempt mild JSON repair (e.g. unescaped newlines or trailing comma)
        try {
            const repaired = cleanText
                .replace(/,\s*([}\]])/g, "$1") // trailing commas
                .replace(/\r?\n/g, "\\n");
            const match = repaired.match(/\{[\s\S]*\}/);
            if (match) parsedJson = JSON.parse(match[0]);
        } catch (_) {
            errors.push(`JSON parsing error: ${parseErr.message}`);
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

    // 5. AST Syntax Validation via Babel Parser
    const codeToValidate = parsedJson.fullUpdatedContent || parsedJson.suggestedTestCode;
    const astResult = parseJavaScriptCode(codeToValidate);
    let syntaxValid = astResult.success;

    if (!syntaxValid) {
        // Syntax auto-repair attempt: check for unclosed quotes or missing closing braces at EOF
        let repairedCode = codeToValidate;
        if (!repairedCode.endsWith("}") && !repairedCode.endsWith(");")) {
            repairedCode = repairedCode + "\n});";
            const retryAst = parseJavaScriptCode(repairedCode);
            if (retryAst.success) {
                syntaxValid = true;
                if (parsedJson.fullUpdatedContent) parsedJson.fullUpdatedContent = repairedCode;
                if (parsedJson.suggestedTestCode) parsedJson.suggestedTestCode = repairedCode;
            }
        }
    }

    if (!syntaxValid) {
        errors.push(`AST syntax validation failed: ${astResult.error || "Syntax error in generated test code"}`);
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

    // 3. Invoke LLM with 45s Timeout
    let aiParsedResult = null;
    let aiGenerationError = null;

    try {
        const responseText = await Promise.race([
            generateText(prompt),
            new Promise((_, reject) => setTimeout(() => reject(new Error("AI generation timed out (45s limit reached)")), 45000))
        ]);

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
