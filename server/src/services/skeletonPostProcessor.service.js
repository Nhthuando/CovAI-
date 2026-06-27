import { ServiceError } from "../utils/serviceError.js";

/**
 * SCRUM-399: Remove markdown wrappers
 * Removes markdown code blocks from the generated skeleton code.
 */
export const removeMarkdownWrappers = (content) => {
    if (!content) return "";
    let cleaned = content;
    cleaned = cleaned.replace(/^```(javascript|js|ts|typescript)?\s*/i, "");
    cleaned = cleaned.replace(/```\s*$/i, "");
    return cleaned;
};

/**
 * SCRUM-402: Normalize whitespace
 * Removes excessive newlines from the code.
 */
export const normalizeWhitespace = (content) => {
    if (!content) return "";
    return content.replace(/\n{3,}/g, '\n\n').trim();
};

/**
 * SCRUM-403: Validate Jest syntax format
 * A heuristic validation to ensure the output looks like a Jest test.
 */
export const validateJestSyntax = (content) => {
    if (!content) return false;
    const hasDescribe = content.includes("describe(");
    const hasItOrTest = content.includes("it(") || content.includes("test(");
    return hasDescribe && hasItOrTest;
};

/**
 * SCRUM-401: Extract metadata
 * Extracts metrics such as the number of test suites and test cases.
 */
export const extractMetadata = (content) => {
    if (!content) return { describeCount: 0, testCount: 0 };
    const describeCount = (content.match(/describe\s*\(/g) || []).length;
    const testCount = (content.match(/(?:it|test)\s*\(/g) || []).length;
    return { describeCount, testCount };
};

/**
 * SCRUM-400: Generate generation summary
 * Generates an overall summary of the post-processing phase.
 */
export const generateGenerationSummary = (processedTests) => {
    let totalFiles = processedTests.length;
    let totalDescribes = 0;
    let totalTests = 0;
    
    processedTests.forEach(t => {
        const meta = t.metaJson ? JSON.parse(t.metaJson) : {};
        totalDescribes += meta.describeCount || 0;
        totalTests += meta.testCount || 0;
    });

    return {
        totalFiles,
        totalDescribes,
        totalTests,
        message: `Generated skeleton tests for ${totalFiles} files containing ${totalDescribes} test suites and ${totalTests} test cases.`
    };
};

/**
 * Main processor function
 */
export const processSkeletonTests = (tests) => {
    const processedTests = tests.map(test => {
        if (!test.content) return test;
        
        // SCRUM-399
        let content = removeMarkdownWrappers(test.content);
        
        // SCRUM-402
        content = normalizeWhitespace(content);
        
        // SCRUM-403
        const isValid = validateJestSyntax(content);
        if (!isValid) {
            console.warn(`[SkeletonPostProcessor] Test for ${test.filePath} may not be valid Jest syntax.`);
        }
        
        // SCRUM-401
        const metadata = extractMetadata(content);
        
        return {
            ...test,
            content,
            metaJson: JSON.stringify({ ...metadata, isValid })
        };
    });
    
    // SCRUM-400
    const summary = generateGenerationSummary(processedTests);
    
    return {
        processedTests,
        summary
    };
};
