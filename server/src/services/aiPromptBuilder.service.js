/**
 * SCRUM-296: Include source code
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
 * SCRUM-295: Include coverage metrics
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
        promptSegment += "#### Function Hit Counts\n";
        coverage.functions.forEach((func) => {
            promptSegment += `- ${func.functionName} (${func.filePath}:${func.startLine}): Hits ${func.hit}\n`;
        });
        promptSegment += "\n";
    }

    return promptSegment;
};

/**
 * SCRUM-294: Include CFG information
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
 * SCRUM-293: Include complexity scores
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
 * SCRUM-292: Include testing instructions
 * Generates instructions based on the mode.
 */
export const includeTestingInstructions = (mode = "FULL", existingTestFiles = []) => {
    let promptSegment = "### Testing Instructions\n\n";
    
    promptSegment += "You are an expert software tester. Your task is to write tests using the **Jest** framework.\n";
    
    if (existingTestFiles && existingTestFiles.length > 0) {
        promptSegment += "\nThe project already contains the following test files. Try to align with their style or improve upon them:\n";
        existingTestFiles.forEach(file => {
            promptSegment += `- ${file.path}\n`;
        });
        promptSegment += "\n";
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
 * Instructs the AI on the required JSON output format for suggestions.
 */
export const includeSuggestionFormat = () => {
    let promptSegment = "### Output Format\n\n";
    promptSegment += "You MUST output your refactoring suggestions and test recommendations as a **JSON array** of objects. Do not wrap the JSON in other text except markdown code blocks (```json ... ```).\n";
    promptSegment += "Each object in the array MUST contain exactly these fields:\n";
    promptSegment += "- `filePath` (string): The path to the file being analyzed.\n";
    promptSegment += "- `functionName` (string): The name of the specific function targeted by the suggestion.\n";
    promptSegment += "- `priority` (string): Must be exactly 'HIGH', 'MEDIUM', or 'LOW' according to the Prioritization Rules.\n";
    promptSegment += "- `message` (string): A clear, concise explanation of the suggestion or the test case to be written.\n\n";
    promptSegment += "Example Output:\n";
    promptSegment += "```json\n";
    promptSegment += "[\n  {\n    \"filePath\": \"src/auth.js\",\n    \"functionName\": \"loginUser\",\n    \"priority\": \"HIGH\",\n    \"message\": \"High complexity without coverage. Add tests for invalid credentials.\"\n  }\n]\n";
    promptSegment += "```\n\n";
    
    return promptSegment;
};

/**
 * SCRUM-291: Build final prompt
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
    finalPrompt += includeTestingInstructions(mode, payload.testFiles);
    finalPrompt += includeSuggestionFormat();
    
    finalPrompt += "---\n\nPlease review the provided code, metrics, and CFG data carefully. Output the requested JSON array of suggestions in a markdown code block.";
    
    return finalPrompt;
};
