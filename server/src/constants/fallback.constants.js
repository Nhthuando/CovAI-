/**
 * @file fallback.constants.js
 * @description Centralised string constants for the TODO Fallback Generator.
 *   Import from here — never hardcode these strings elsewhere.
 */

// ---------------------------------------------------------------------------
// Section identifiers
// ---------------------------------------------------------------------------

/**
 * Canonical names for every pipeline section.
 * Add new generators here so the rest of the system picks them up automatically.
 *
 * @readonly
 * @enum {string}
 */
export const SECTION_NAMES = Object.freeze({
    COVERAGE: "coverage",
    CFG: "cfg",
    CYCLOMATIC: "cyclomatic",
    AI_SUGGESTIONS: "aiSuggestions",
    AI_TESTS: "aiTests",
    DOCUMENTATION: "documentation",
    DEPENDENCIES: "dependencies",
});

// ---------------------------------------------------------------------------
// Failure reasons (safe, user-visible messages — no stack traces)
// ---------------------------------------------------------------------------

/**
 * Human-readable explanations for why a section could not be generated.
 *
 * @readonly
 * @enum {string}
 */
export const FAILURE_REASONS = Object.freeze({
    MISSING_ARTIFACT: "Missing artifact — required input was not found.",
    INVALID_SNAPSHOT: "Invalid snapshot — the snapshot data is corrupt or incomplete.",
    GENERATION_TIMEOUT: "Generation timeout — the operation exceeded the time limit.",
    AI_PROVIDER_UNAVAILABLE: "AI provider unavailable — the upstream service did not respond.",
    PARSER_ERROR: "Parser error — the output could not be parsed.",
    DEPENDENCY_INSTALL_FAILED: "Dependency installation failed — packages could not be resolved.",
    COVERAGE_FILE_MISSING: "Coverage file missing — no coverage report was produced.",
    UNSUPPORTED_LANGUAGE: "Unsupported language — this generator does not support the detected language.",
    INVALID_JSON: "Invalid JSON — the generator returned malformed output.",
    EMPTY_OUTPUT: "Empty output — the generator produced no usable content.",
    UNKNOWN: "Unknown error — generation failed for an unexpected reason.",
});

// ---------------------------------------------------------------------------
// TODO placeholder messages (machine-readable, per section)
// ---------------------------------------------------------------------------

/**
 * Default TODO messages inserted when a section cannot be generated.
 * Keys match SECTION_NAMES values.
 *
 * @readonly
 * @type {Record<string, string>}
 */
export const TODO_MESSAGES = Object.freeze({
    [SECTION_NAMES.COVERAGE]:
        "TODO: Run test suite to produce a coverage report.",
    [SECTION_NAMES.CFG]:
        "TODO: Generate control flow graph once coverage becomes available.",
    [SECTION_NAMES.CYCLOMATIC]:
        "TODO: Compute cyclomatic complexity after CFG is built.",
    [SECTION_NAMES.AI_SUGGESTIONS]:
        "TODO: Retry AI suggestion generation when the provider is available.",
    [SECTION_NAMES.AI_TESTS]:
        "TODO: Retry AI test generation when the provider is available.",
    [SECTION_NAMES.DOCUMENTATION]:
        "TODO: Generate documentation once source parsing succeeds.",
    [SECTION_NAMES.DEPENDENCIES]:
        "TODO: Resolve dependencies and re-run installation.",
    _DEFAULT:
        "TODO: Retry generation for this section.",
});

// ---------------------------------------------------------------------------
// Log prefixes
// ---------------------------------------------------------------------------

/** Prefix for every log line emitted by the fallback service. */
export const LOG_PREFIX = "[Fallback]";