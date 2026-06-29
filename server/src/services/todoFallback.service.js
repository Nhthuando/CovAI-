/**
 * @file todoFallback.service.js
 * @description TODO Fallback Generator Service.
 *
 *   Handles partially generated pipeline outputs gracefully:
 *   preserves every successfully generated section, explains missing ones,
 *   and inserts standardised TODO placeholders — without throwing.
 *
 *   Public API
 *   ----------
 *   detectIncompleteOutput(sections)     → string[]
 *   explainFailure(section, error)       → { reason, section }
 *   createTodoPlaceholder(section, …)    → TodoPlaceholder
 *   mergeGeneratedSections(sections)     → { generated, todos }
 *   buildFallback(sections, failures)    → FallbackResponse
 *   generateFallbackResponse(sections)   → FallbackResponse  ← main entry point
 */

import { LOG_PREFIX, FAILURE_REASONS } from "../constants/fallback.constants.js";
import {
    FallbackGenerationError,
    IncompleteOutputError,
} from "../errors/fallback.errors.js";
import {
    isAbsent,
    buildTodoPlaceholder,
    partitionSections,
    assembleResponse,
    resolveFailureReason,
} from "../utils/fallback.util.js";

// ---------------------------------------------------------------------------
// Logging (thin wrapper — swap for your logger of choice)
// ---------------------------------------------------------------------------

const log = {
    info: (msg) => console.info(`${LOG_PREFIX} ${msg}`),
    warn: (msg) => console.warn(`${LOG_PREFIX} ${msg}`),
    error: (msg) => console.error(`${LOG_PREFIX} ${msg}`),
};

// ---------------------------------------------------------------------------
// 1. DETECT INCOMPLETE OUTPUT
// ---------------------------------------------------------------------------

/**
 * Inspects a map of section outputs and returns the names of every section
 * whose value is considered absent (null, undefined, empty string, empty
 * array, empty object, etc.).
 *
 * @param {Record<string, unknown>} sections
 *   Map of section name → raw generator output.
 * @returns {string[]}
 *   Names of the incomplete / missing sections.
 * @throws {FallbackGenerationError}
 *   Only when `sections` itself is not a plain object.
 *
 * @example
 * detectIncompleteOutput({ coverage: {...}, cfg: null })
 * // → ["cfg"]
 */
export const detectIncompleteOutput = (sections) => {
    if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
        throw new FallbackGenerationError(
            "detectIncompleteOutput expects a plain object of sections."
        );
    }

    const missing = Object.entries(sections)
        .filter(([, value]) => isAbsent(value))
        .map(([key]) => key);

    if (missing.length > 0) {
        log.info(`Detected incomplete output — missing sections: ${missing.join(", ")}`);
    }

    return missing;
};

// ---------------------------------------------------------------------------
// 2. EXPLAIN FAILURE
// ---------------------------------------------------------------------------

/**
 * Produces a safe, structured explanation for why a section failed.
 * Never exposes stack traces or internal error details.
 *
 * @param {string}  section  The section that could not be generated.
 * @param {unknown} [error]  The original caught error, if available.
 * @returns {{ section: string, reason: string }}
 *
 * @example
 * explainFailure("cfg", new Error("timeout"))
 * // → { section: "cfg", reason: "Generation timeout — ..." }
 */
export const explainFailure = (section, error = null) => {
    const reason = resolveFailureReason(error);
    log.warn(`Missing section "${section}" — ${reason}`);
    return { section, reason };
};

// ---------------------------------------------------------------------------
// 3. CREATE TODO PLACEHOLDER
// ---------------------------------------------------------------------------

/**
 * Builds a machine-readable TODO placeholder for a section that could not
 * be generated.  Always returns a frozen object — never throws.
 *
 * @param {string}  section         Section name.
 * @param {string}  reason          Safe failure reason (from FAILURE_REASONS).
 * @param {string}  [customMessage] Override the default TODO message.
 * @returns {{ todo: true, section: string, reason: string, message: string }}
 *
 * @example
 * createTodoPlaceholder("cfg", FAILURE_REASONS.MISSING_ARTIFACT)
 * // → { todo: true, section: "cfg", reason: "...", message: "TODO: ..." }
 */
export const createTodoPlaceholder = (section, reason, customMessage) => {
    const placeholder = buildTodoPlaceholder(section, reason, customMessage);
    log.info(`Inserted TODO for section "${section}"`);
    return placeholder;
};

// ---------------------------------------------------------------------------
// 4. MERGE GENERATED SECTIONS
// ---------------------------------------------------------------------------

/**
 * Separates a raw sections map into successfully generated content and
 * TODO placeholders for missing sections.
 *
 * Pre-existing errors (a section whose value is an Error instance) are
 * treated as absent and converted to TODO entries automatically.
 *
 * @param {Record<string, unknown>} sections
 *   Map of section name → raw generator output (may contain nulls, errors, etc.).
 * @returns {{
 *   generated: Record<string, unknown>,
 *   todos:     Record<string, { todo: true, section: string, reason: string, message: string }>,
 * }}
 *
 * @example
 * mergeGeneratedSections({
 *   coverage: { linesPct: 82 },
 *   cfg: null,
 * })
 * // → { generated: { coverage: ... }, todos: { cfg: { todo: true, ... } } }
 */
export const mergeGeneratedSections = (sections) => {
    // Normalise Error instances to null so partitionSections handles them uniformly.
    const normalised = Object.fromEntries(
        Object.entries(sections).map(([key, value]) => [
            key,
            value instanceof Error ? null : value,
        ])
    );

    const { generated, missing } = partitionSections(normalised);

    const todos = Object.fromEntries(
        missing.map((section) => [
            section,
            buildTodoPlaceholder(section, FAILURE_REASONS.EMPTY_OUTPUT),
        ])
    );

    return { generated, todos };
};

// ---------------------------------------------------------------------------
// 5. BUILD FALLBACK
// ---------------------------------------------------------------------------

/**
 * Combines pre-partitioned generated content with an explicit failures map
 * (errors caught during generation) into a complete fallback response.
 *
 * Use this when you are collecting errors as you go (e.g. in a pipeline loop)
 * and want to merge everything at the end.
 *
 * @param {Record<string, unknown>} sections
 *   Map of section name → successfully generated value (absent values are safe).
 * @param {Record<string, unknown>} [failures={}]
 *   Map of section name → caught error for sections that threw during generation.
 * @returns {{
 *   completed: boolean,
 *   generated: Record<string, unknown>,
 *   todos:     Record<string, unknown>,
 *   metadata:  { generatedCount: number, missingCount: number, timestamp: string },
 * }}
 *
 * @example
 * buildFallback(
 *   { coverage: { linesPct: 82 }, cfg: null },
 *   { aiTests: new Error("AI timeout") }
 * )
 */
export const buildFallback = (sections, failures = {}) => {
    const { generated, todos: todoFromSections } = mergeGeneratedSections(sections);

    // Convert explicit failures into TODO entries (overrides any same-key entry).
    const todoFromFailures = Object.fromEntries(
        Object.entries(failures).map(([section, error]) => {
            const { reason } = explainFailure(section, error);
            return [section, createTodoPlaceholder(section, reason)];
        })
    );

    const todos = { ...todoFromSections, ...todoFromFailures };

    const response = assembleResponse({ generated, todos });
    log.info(
        `Finished fallback generation — ` +
        `generated: ${response.metadata.generatedCount}, ` +
        `missing: ${response.metadata.missingCount}`
    );

    return response;
};

// ---------------------------------------------------------------------------
// 6. GENERATE FALLBACK RESPONSE  (main entry point)
// ---------------------------------------------------------------------------

/**
 * Main entry point for the TODO Fallback Generator.
 *
 * Accepts a raw sections map where values may be generator outputs, nulls,
 * Errors, empty arrays, or anything else a pipeline stage might return.
 * Always returns a well-formed response — never throws.
 *
 * @param {Record<string, unknown>} sections
 *   Map of section name → raw value from the generator.
 * @returns {{
 *   completed: boolean,
 *   generated: Record<string, unknown>,
 *   todos:     Record<string, unknown>,
 *   metadata:  { generatedCount: number, missingCount: number, timestamp: string },
 * }}
 *
 * @example
 * // Partial success
 * await generateFallbackResponse({
 *   coverage:      { linesPct: 82, branchesPct: 74 },
 *   cfg:           null,
 *   aiSuggestions: [{ priority: "HIGH", message: "..." }],
 *   aiTests:       new Error("AI provider timeout"),
 * });
 * // →
 * // {
 * //   completed: false,
 * //   generated: { coverage: {...}, aiSuggestions: [...] },
 * //   todos: {
 * //     cfg:     { todo: true, reason: "Empty output...", message: "TODO: ..." },
 * //     aiTests: { todo: true, reason: "AI provider unavailable...", message: "TODO: ..." },
 * //   },
 * //   metadata: { generatedCount: 2, missingCount: 2, timestamp: "..." },
 * // }
 *
 * @example
 * // Full success
 * await generateFallbackResponse({
 *   coverage: { linesPct: 95 },
 *   cfg:      [{ node: "A", edges: ["B"] }],
 * });
 * // → { completed: true, generated: { coverage: ..., cfg: ... }, todos: {}, metadata: ... }
 */
export const generateFallbackResponse = async (sections) => {
    // Guard — if the caller passes something nonsensical, recover with all-TODO.
    if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
        log.error("generateFallbackResponse received invalid input — returning empty fallback.");
        return assembleResponse({ generated: {}, todos: {} });
    }

    try {
        log.info("Detected incomplete output — starting fallback generation.");

        // Separate Error instances (explicit failures) from other values.
        const rawFailures = {};
        const rawSections = {};

        for (const [key, value] of Object.entries(sections)) {
            if (value instanceof Error) {
                rawFailures[key] = value;
            } else {
                rawSections[key] = value;
            }
        }

        const result = buildFallback(rawSections, rawFailures);

        if (result.completed) {
            log.info("Recovered partial generation — all sections present.");
        } else {
            log.info(
                `Recovered partial generation — ` +
                `${result.metadata.generatedCount} section(s) generated, ` +
                `${result.metadata.missingCount} TODO(s) inserted.`
            );
        }

        return result;
    } catch (err) {
        // Last-resort safety net — the pipeline must never crash here.
        log.error(`Unexpected error during fallback generation: ${err?.message ?? "unknown"}`);
        return assembleResponse({ generated: {}, todos: {} });
    }
};