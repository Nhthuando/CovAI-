/**
 * SCRUM-386: Include source code
 * Formats the raw source code files into a readable markdown string.
 */
export const includeSourceCode = (sourceCode) => {
    if (!sourceCode || sourceCode.length === 0) return "No source code available.";

    let promptSegment = "### Source Code\n\n";
    sourceCode.forEach((file) => {
        promptSegment += `#### File: ${file.path}\n`;
        promptSegment += "```javascript\n";
        promptSegment += file.content + "\n";
        promptSegment += "```\n\n";
    });

    return promptSegment;
};

/**
 * SCRUM-392: Include uncovered functions
 * Formats the coverage data into text.
 */
export const includeCoverageMetrics = (coverage) => {
    if (!coverage || !coverage.summary) return "No coverage data available.";

    let promptSegment = "### Coverage Metrics\n\n";
    promptSegment += "#### Summary\n";
    promptSegment += `- Lines: ${coverage.summary.linesPct}%\n`;
    promptSegment += `- Branches: ${coverage.summary.branchesPct}%\n`;
    promptSegment += `- Functions: ${coverage.summary.funcsPct}%\n`;
    promptSegment += `- Statements: ${coverage.summary.stmtsPct}%\n\n`;

    if (coverage.files && coverage.files.length > 0) {
        promptSegment += "#### File Coverage\n";
        coverage.files.forEach((file) => {
            promptSegment += `- **${file.filePath}**: Lines ${file.linesPct}%, Branches ${file.branchesPct}%, Funcs ${file.funcsPct}%\n`;
        });
        promptSegment += "\n";
    }

    if (coverage.functions && coverage.functions.length > 0) {
        const uncovered = coverage.functions.filter(f => f.hit === 0);
        if (uncovered.length > 0) {
            promptSegment += "#### Uncovered Functions\n";
            promptSegment += "The following functions currently have no test coverage. Focus your testing efforts here:\n";
            uncovered.forEach((func) => {
                promptSegment += `- ${func.functionName} (${func.filePath}:${func.startLine})\n`;
            });
            promptSegment += "\n";
        }
    }

    return promptSegment;
};

/**
 * SCRUM-391: Include CFG information
 * Formats Control Flow Graph data.
 */
export const includeCfgInformation = (cfgArray) => {
    if (!cfgArray || cfgArray.length === 0) return "No Control Flow Graph (CFG) data available.";

    let promptSegment = "### Control Flow Graphs\n\n";
    cfgArray.forEach((cfg) => {
        promptSegment += `#### CFG for Function: ${cfg.functionName} (${cfg.filePath}:${cfg.startLine})\n`;
        promptSegment += "```json\n";
        // Formatting the JSON string nicely if it's stored as string
        try {
            const parsed = typeof cfg.graphJson === "string" ? JSON.parse(cfg.graphJson) : cfg.graphJson;
            promptSegment += JSON.stringify(parsed, null, 2) + "\n";
        } catch (e) {
            promptSegment += cfg.graphJson + "\n";
        }
        promptSegment += "```\n\n";
    });

    return promptSegment;
};

/**
 * SCRUM-390: Include complexity score
 * Formats the cyclomatic complexity.
 */
export const includeComplexityScores = (complexityArray) => {
    if (!complexityArray || complexityArray.length === 0) return "No Cyclomatic Complexity data available.";

    let promptSegment = "### Cyclomatic Complexity\n\n";
    complexityArray.forEach((c) => {
        promptSegment += `- **${c.functionName}** (${c.filePath}): Score ${c.value}\n`;
    });
    promptSegment += "\n";

    return promptSegment;
};

/**
 * SCRUM-389: Request Jest skeleton output
 * Generates instructions based on the mode and hasJest flag.
 */
export const includeTestingInstructions = (mode = "FULL", existingTestFiles = [], options = {}) => {
    const hasJest = options.hasJest || false;
    const hasVitest = options.hasVitest || false;
    const selectedFramework = ["jest", "vitest"].includes(options.selectedFramework)
        ? options.selectedFramework
        : null;
    const framework = selectedFramework === "jest" ? "Jest" : selectedFramework === "vitest" ? "Vitest" : hasVitest ? "Vitest" : "Jest";

    let promptSegment = "### Testing Instructions\n\n";
    
    promptSegment += `You are an expert software tester. Your task is to write tests using the **${framework}** framework.\n`;
    
    if (hasJest || hasVitest) {
        promptSegment += `The project already uses ${framework} for testing.\n`;
        if (existingTestFiles && existingTestFiles.length > 0) {
            promptSegment += "The project contains the following test files. You must analyze the coverage metrics, read the existing test files, and generate the FULL updated test file code that adds missing coverage.\n";
            existingTestFiles.forEach(file => {
                promptSegment += `- ${file.path}\n`;
            });
            promptSegment += "\n";
        } else {
            promptSegment += `Although ${framework} is configured, no test files were found. Generate FULL robust, executable test files for the uncovered source code.\n`;
        }
    } else {
        promptSegment += `The project currently DOES NOT have a testing framework set up. Your task is to act as the primary test writer and generate FULL, robust, and executable ${framework} test files for the source files from scratch.\n`;
    }

    if (mode === "SKELETON") {
        promptSegment += "Please generate only the **skeletons** of the test cases (i.e., `describe` and `it` blocks with clear, descriptive names) without implementing the actual test logic inside the `it` blocks.\n";
    } else {
        promptSegment += "Please generate **full, robust, and executable test cases**. Ensure you mock any external dependencies or side effects. Aim to cover the uncovered branches and lines indicated by the coverage metrics.\n";
    }

    return promptSegment;
};

/**
 * SCRUM-324, 326, 327, 328: Include Prioritization Rules
 * Instructs the AI on how to assign priorities to its suggestions.
 */
export const includePrioritizationRules = () => {
    let promptSegment = "### Recommendation Prioritization Rules\n\n";
    promptSegment += "When generating refactoring suggestions or test case recommendations, you MUST assign a priority based on the following strict rules:\n";
    
    promptSegment += "- **HIGH Priority**: Apply to functions that have high cyclomatic complexity (e.g., score > 10) AND low test coverage (e.g., < 50%), OR if you identify critical logical bugs or security vulnerabilities. These are the core areas needing immediate attention.\n";
    promptSegment += "- **MEDIUM Priority**: Apply to functions with moderate complexity or coverage, or when suggesting tests for non-critical edge cases and error handling paths.\n";
    promptSegment += "- **LOW Priority**: Apply to minor refactoring, code style cleanups, or suggestions for functions that already have high coverage and low complexity.\n\n";
    
    return promptSegment;
};

/**
 * SCRUM-325: Store priority values (Suggestion Format)
 * Instructs the AI on the required JSON output format for suggestions and test files.
 */
export const includeSuggestionFormat = () => {
    let promptSegment = "### Output Format\n\n";
    promptSegment += "You MUST output your response as a **JSON object** with TWO properties: `suggestions` and `tests`. Do not wrap the JSON in other text except markdown code blocks (```json ... ```).\n";
    promptSegment += "The structure MUST be exactly as follows:\n";
    promptSegment += "```json\n";
    promptSegment += "{\n";
    promptSegment += "  \"suggestions\": [\n";
    promptSegment += "    {\n";
    promptSegment += "      \"filePath\": \"src/auth.js\",\n";
    promptSegment += "      \"functionName\": \"loginUser\",\n";
    promptSegment += "      \"priority\": \"HIGH\",\n";
    promptSegment += "      \"message\": \"High complexity without coverage. Add tests for invalid credentials.\"\n";
    promptSegment += "    }\n";
    promptSegment += "  ],\n";
    promptSegment += "  \"tests\": [\n";
    promptSegment += "    {\n";
    promptSegment += "      \"filePath\": \"src/auth.test.js\",\n";
    promptSegment += "      \"mode\": \"FULL\",\n";
    promptSegment += "      \"content\": \"import { loginUser } ... \\n describe(...) \\n ...\"\n";
    promptSegment += "    }\n";
    promptSegment += "  ]\n";
    promptSegment += "}\n";
    promptSegment += "```\n\n";
    promptSegment += "- **suggestions**: An array of refactoring suggestions or test recommendations.\n";
    promptSegment += "- **tests**: An array of actual test file generation. Set `filePath` to the appropriate test file path. Put the complete updated or new test file code in `content`.\n";
    
    return promptSegment;
};

/**
 * SCRUM-388: Request mock hints
 */
export const includeMockHints = () => {
    return "Please provide comments or hints in the generated test skeletons indicating what external services, databases, or complex logic should be mocked (e.g., // TODO: Mock this database call).\n\n";
};

/**
 * SCRUM-387: Create prompt template
 * Orchestrates all segments into a final prompt string.
 */
export const buildFinalPrompt = (payload, options = {}) => {
    const mode = options.mode || "FULL";
    
    let finalPrompt = "You are an AI assistant designed to analyze source code and provide highly effective test cases and refactoring suggestions based on context metrics.\n\n";
    
    finalPrompt += "Here is the context of the project:\n\n";
    
    finalPrompt += includeSourceCode(payload.sourceCode);
    finalPrompt += includeCoverageMetrics(payload.coverage);
    finalPrompt += includeComplexityScores(payload.complexity);
    finalPrompt += includeCfgInformation(payload.cfg);
    
    finalPrompt += includePrioritizationRules();
    finalPrompt += includeTestingInstructions(mode, payload.testFiles, {
        ...options,
        selectedFramework: options.selectedFramework || payload.selectedTestingFramework,
    });
    finalPrompt += includeMockHints();
    finalPrompt += includeSuggestionFormat();
    
    finalPrompt += "---\n\nPlease review the provided code, metrics, and CFG data carefully. Output the requested JSON object containing `suggestions` and `tests` in a markdown code block.";
    
    return finalPrompt;
};
