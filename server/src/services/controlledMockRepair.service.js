import { validateAndNormalizeMocks, validateMockContracts } from "./mockValidation.service.js";
import { generateUniversalMocks } from "./universalMockEngine.service.js";
import { classifyTestFailure, FAILURE_CLASSIFICATIONS } from "./testFailureClassifier.service.js";

const REPAIRABLE_CLASSES = new Set([
    FAILURE_CLASSIFICATIONS.INVALID_MOCK_CONTRACT,
    FAILURE_CLASSIFICATIONS.MOCK_INITIALIZATION_ERROR,
    FAILURE_CLASSIFICATIONS.INVALID_FIXTURE,
]);

/**
 * Strips existing top-level jest.mock / vi.mock statements and replaces them
 * with freshly generated universal mocks when a repairable mock/fixture
 * failure occurs. Never modifies production source code or test assertions.
 */
function replaceMockDeclarations(testCode = "", newMockCode = "", framework = "jest") {
    const runner = framework === "vitest" ? "vi" : "jest";
    // Remove simple top-level runner.mock(...) blocks before prepending regenerated mocks
    const lines = testCode.split(/\r?\n/);
    const kept = [];
    let skippingMock = false;
    let parenDepth = 0;

    for (const line of lines) {
        if (!skippingMock && new RegExp(`^\\s*${runner}\\.mock\\s*\\(`).test(line)) {
            skippingMock = true;
            parenDepth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
            if (parenDepth <= 0 && /;\s*$/.test(line)) {
                skippingMock = false;
                parenDepth = 0;
            }
            continue;
        }
        if (skippingMock) {
            parenDepth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
            if (parenDepth <= 0) {
                skippingMock = false;
                parenDepth = 0;
            }
            continue;
        }
        kept.push(line);
    }

    const body = kept.join("\n").replace(/^\s*\n/, "");
    return newMockCode ? `${newMockCode}\n\n${body}` : body;
}

/**
 * Performs bounded mock-only repair for a failing generated test.
 * Never alters source code or weakens test assertions.
 *
 * @param {object} params
 * @returns {object} Repair outcome
 */
export function attemptControlledMockRepair({
    testCode = "",
    sourceCode = "",
    sourceFile = "",
    testFile = "",
    rootDir = "",
    framework = "jest",
    errorMessage = "",
    stackTrace = "",
    attempt = 1,
    maxAttempts = 2,
} = {}) {
    if (attempt > maxAttempts) {
        return {
            repaired: false,
            stoppedReason: "MAX_REPAIR_ATTEMPTS_EXCEEDED",
            code: testCode,
            classification: null,
        };
    }

    const universal = generateUniversalMocks({
        rootDir,
        sourceCode,
        sourceFile,
        existingTestCode: testCode,
        targetTestFile: testFile,
        framework,
    });

    const preContract = validateMockContracts({
        code: testCode,
        contracts: universal.contractReport?.contracts || [],
        framework: universal.framework,
    });

    const preNorm = validateAndNormalizeMocks({
        code: testCode,
        filePath: testFile,
        sourceFile,
        rootDir,
        framework: universal.framework,
    });

    const failure = classifyTestFailure({
        errorMessage,
        stackTrace,
        contractViolations: preContract.violations,
        mockDiagnostics: preNorm.diagnostics,
    });

    if (!REPAIRABLE_CLASSES.has(failure.classification)) {
        return {
            repaired: false,
            stoppedReason: `NON_REPAIRABLE_${failure.classification}`,
            code: testCode,
            classification: failure,
        };
    }

    // Apply universal mocks + normalization
    let candidateCode = universal.mockCode
        ? replaceMockDeclarations(preNorm.code, universal.mockCode, universal.framework)
        : preNorm.code;

    const postNorm = validateAndNormalizeMocks({
        code: candidateCode,
        filePath: testFile,
        sourceFile,
        rootDir,
        framework: universal.framework,
    });
    candidateCode = postNorm.code;

    const postContract = validateMockContracts({
        code: candidateCode,
        contracts: universal.contractReport?.contracts || [],
        framework: universal.framework,
    });

    return {
        repaired: candidateCode !== testCode && postNorm.valid && postContract.valid,
        code: candidateCode,
        classification: failure,
        preContractViolations: preContract.violations,
        postContractViolations: postContract.violations,
        repairs: postNorm.repairs,
        adapterSelections: universal.adapterSelections,
    };
}
