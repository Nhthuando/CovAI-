export const FAILURE_CLASSIFICATIONS = Object.freeze({
    SOURCE_CONTRACT_MISMATCH: "SOURCE_CONTRACT_MISMATCH",
    MOCK_BINDING_ERROR: "MOCK_BINDING_ERROR",
    UNMOCKED_SPY_ASSERTION: "UNMOCKED_SPY_ASSERTION",
    FRAMEWORK_COMPATIBILITY_ERROR: "FRAMEWORK_COMPATIBILITY_ERROR",
    INVALID_ASSERTION: "INVALID_ASSERTION",
    REQUIREMENT_UNVERIFIED: "REQUIREMENT_UNVERIFIED",
    INVALID_MOCK_CONTRACT: "INVALID_MOCK_CONTRACT",
    INVALID_FIXTURE: "INVALID_FIXTURE",
    INCORRECT_EXPECTATION: "INCORRECT_EXPECTATION",
    SOURCE_DEFECT: "SOURCE_DEFECT",
    REQUIREMENT_MISMATCH: "REQUIREMENT_MISMATCH",
    MOCK_INITIALIZATION_ERROR: "MOCK_INITIALIZATION_ERROR",
    ENVIRONMENT_ERROR: "ENVIRONMENT_ERROR",
    UNKNOWN: "UNKNOWN",
});

/** Runtime messages alone can establish API misuse, but rarely prove business behavior. */
export function classifyReportedFailure(message, { hasComparison = false, framework } = {}) {
    const kind = FAILURE_CLASSIFICATIONS;
    if (framework !== 'vitest' && /\.toBeTypeOf is not a function/i.test(message)) {
        return { code: 'E', classification: kind.FRAMEWORK_COMPATIBILITY_ERROR, reason: 'The selected Jest runner does not implement this matcher.', repair: 'NORMALIZE_JEST_TYPEOF' };
    }
    if (/received value must be a mock or spy function|is not a spy or a call to a spy/i.test(message)) {
        return { code: 'E', classification: kind.UNMOCKED_SPY_ASSERTION, reason: 'The assertion targets a function that the runner did not register as a mock or spy.' };
    }
    if (/\.mock(?:ResolvedValue|RejectedValue|ReturnValue|Implementation)(?:Once)? is not a function|does not provide an export named|mock factory|jest\.mock\(\).*factory/i.test(message)) {
        return { code: 'E', classification: kind.MOCK_BINDING_ERROR, reason: 'The mock binding, factory, or imported export is incompatible with the test.' };
    }
    if (/Cannot find (?:module|package)|Failed to resolve import|Unable to prepare dependencies for Jest in the Docker workspace|\b(?:Docker|transform)\b.*(?:required|unavailable|failed)|ECONNREFUSED|MongoServerSelectionError/i.test(message)) {
        return { code: 'E', classification: kind.ENVIRONMENT_ERROR, reason: 'The runner reported a dependency, module resolution or environment error.' };
    }
    if (hasComparison) return { code: 'D', classification: kind.REQUIREMENT_UNVERIFIED,
        reason: 'The assertion disagrees with the observed value. The intended requirement needs independent evidence.' };
    return null;
}

/**
 * Classifies a test failure message/stack and optional contract violations
 * into a structured failure category.
 *
 * @param {object} params
 * @returns {{ classification: string, confidence: "high"|"medium"|"low", repairableMock: boolean, reason: string }}
 */
export function classifyTestFailure({
    errorMessage = "",
    stackTrace = "",
    contractViolations = [],
    mockDiagnostics = [],
    isRequirementMismatch = false,
} = {}) {
    const combined = `${errorMessage}\n${stackTrace}`.trim();

    if (isRequirementMismatch) {
        return {
            classification: FAILURE_CLASSIFICATIONS.REQUIREMENT_MISMATCH,
            confidence: "high",
            repairableMock: false,
            reason: "Test assertion conflicts with specified requirement.",
        };
    }

    // 1. Mock initialization / hoisting / module resolution errors
    if (
        mockDiagnostics.some((d) => ["MOCK_FACTORY_INVALID", "MOCK_HOIST_ORDER", "MOCK_MISSING_EXPORT"].includes(d.rule)) ||
        /Cannot access ['"]?[\w$]+['"]? before initialization/i.test(combined) ||
        /ReferenceError:.*before initialization/i.test(combined) ||
        /vi\.hoisted|jest\.mock\(\).*factory/i.test(combined) ||
        /does not provide an export named/i.test(combined)
    ) {
        return {
            classification: FAILURE_CLASSIFICATIONS.MOCK_INITIALIZATION_ERROR,
            confidence: "high",
            repairableMock: true,
            reason: "Mock hoisting, initialization order, or module export binding error.",
        };
    }

    // 2. Environment / Docker / DB connection errors
    if (
        /(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EACCES|DOCKER_|RUNNER_DISABLED|DOCKER_SOCKET_MISSING|DOCKER_DAEMON_UNAVAILABLE)/i.test(combined) ||
        /Cannot find package ['"]|Cannot find module ['"]/i.test(combined) ||
        /Missing required environment variable|MongoServerSelectionError|PrismaClientInitializationError/i.test(combined)
    ) {
        return {
            classification: FAILURE_CLASSIFICATIONS.ENVIRONMENT_ERROR,
            confidence: "high",
            repairableMock: false,
            reason: "Runtime environment, network, container, or missing module error.",
        };
    }

    // 3. Invalid mock contract (wrong return shape, missing chained method, sync vs async, empty mock object)
    if (
        contractViolations.some((v) =>
            ["MOCK_RETURN_TYPE_MISMATCH", "MOCK_CHAIN_MISMATCH", "MOCK_METHOD_MISSING", "MOCK_ASYNC_MISMATCH", "EMPTY_MOCK_OBJECT_FOR_CONTRACT"].includes(v.rule)
        ) ||
        /\.(?:map|filter|reduce|forEach|populate|lean|exec|sort|limit|skip|select|getMany|getOne|where|andWhere) is not a function/i.test(combined) ||
        /TypeError:\s+Cannot read propert(?:y|ies) of (?:undefined|null)/i.test(combined) ||
        /TypeError:\s+[\w$.]+ is not iterable/i.test(combined)
    ) {
        return {
            classification: FAILURE_CLASSIFICATIONS.INVALID_MOCK_CONTRACT,
            confidence: "high",
            repairableMock: true,
            reason: "Mocked dependency return shape, chainability, or method signature does not match source contract.",
        };
    }

    // 4. Invalid fixture data
    if (
        contractViolations.some((v) => v.rule === "MOCK_MISSING_REQUIRED_PROPERTIES") ||
        /BSONError|Cast to ObjectId failed|Invalid time value|Invalid Date|ValidationError/i.test(combined)
    ) {
        return {
            classification: FAILURE_CLASSIFICATIONS.INVALID_FIXTURE,
            confidence: "medium",
            repairableMock: true,
            reason: "Fixture payload is missing required fields or has incompatible field formats.",
        };
    }

    // 5. Incorrect test expectation (assertion mismatch without runtime crash)
    if (
        /AssertionError|expect\(.+\)\.(?:toBe|toEqual|toStrictEqual|toMatch|toContain|toHaveBeenCalled|toThrow)/i.test(combined) ||
        (/Expected:/i.test(combined) && /Received:/i.test(combined))
    ) {
        return {
            classification: FAILURE_CLASSIFICATIONS.INCORRECT_EXPECTATION,
            confidence: "high",
            repairableMock: false,
            reason: "Assertion expectation did not match actual returned value.",
        };
    }

    // 6. Source defect (syntax/logic exception in source file)
    if (/SyntaxError|RangeError|URIError/.test(combined)) {
        return {
            classification: FAILURE_CLASSIFICATIONS.SOURCE_DEFECT,
            confidence: "medium",
            repairableMock: false,
            reason: "Execution threw a language/runtime error outside mock contract issues.",
        };
    }

    return {
        classification: FAILURE_CLASSIFICATIONS.UNKNOWN,
        confidence: "low",
        repairableMock: false,
        reason: "Unable to classify failure automatically.",
    };
}
