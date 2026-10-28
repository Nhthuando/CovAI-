/**
 * @file fallback.util.js
 * @description Pure helper functions for the TODO Fallback Generator.
 *
 *   All functions here are side-effect-free and independently unit-testable.
 *   No Prisma, no Express, no logging — keep it that way.
 */

import { FAILURE_REASONS, TODO_MESSAGES } from "../constants/fallback.constants.js";

// ---------------------------------------------------------------------------
// Incomplete-output detection
// ---------------------------------------------------------------------------

/**
 * Returns true when `value` is considered an absent / empty output.
 *
 * Handles:
 *   • null / undefined
 *   • empty string / whitespace-only string
 *   • empty array
 *   • empty plain object  {}
 *   • objects whose every own value is null / undefined
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isAbsent = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") {
        const keys = Object.keys(value);
        if (keys.length === 0) return true;
        // An object whose every own value is null/undefined is also absent.
        return keys.every((k) => value[k] === null || value[k] === undefined);
    }
    return false;
};

/**
 * Attempts to parse `raw` as JSON.
 * Returns `{ ok: true, value }` on success or `{ ok: false }` on failure.
 *
 * @param {unknown} raw
 * @returns {{ ok: true; value: unknown } | { ok: false }}
 */
export const tryParseJson = (raw) => {
    if (typeof raw !== "string") return { ok: false };
    try {
        return { ok: true, value: JSON.parse(raw) };
    } catch {
        return { ok: false };
    }
};

/**
 * Returns true when `value` contains a required field that is absent.
 *
 * @param {unknown}  value
 * @param {string[]} requiredFields
 * @returns {boolean}
 */
export const hasMissingRequiredField = (value, requiredFields = []) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return requiredFields.some((field) => isAbsent(value[field]));
};

// ---------------------------------------------------------------------------
// TODO placeholder construction
// ---------------------------------------------------------------------------

/**
 * Builds a machine-readable TODO placeholder for a pipeline section.
 *
 * @param {string} section  Section name (should match a SECTION_NAMES value).
 * @param {string} reason   Safe failure reason (from FAILURE_REASONS).
 * @param {string} [customMessage]  Override the default TODO message.
 * @returns {{
 *   todo:    true,
 *   section: string,
 *   reason:  string,
 *   message: string,
 * }}
 */
export const buildTodoPlaceholder = (section, reason, customMessage) => {
    const message =
        customMessage ??
        TODO_MESSAGES[section] ??
        TODO_MESSAGES._DEFAULT;

    return Object.freeze({
        todo: true,
        section,
        reason,
        message,
    });
};

// ---------------------------------------------------------------------------
// Section partitioning
// ---------------------------------------------------------------------------

/**
 * Splits a raw sections map into `generated` (non-absent values) and
 * `missing` (absent values), without mutating the input.
 *
 * @param {Record<string, unknown>} sections  Map of section name → raw value.
 * @returns {{
 *   generated: Record<string, unknown>,
 *   missing:   string[],
 * }}
 */
export const partitionSections = (sections) => {
    const generated = {};
    const missing = [];

    for (const [key, value] of Object.entries(sections)) {
        if (isAbsent(value)) {
            missing.push(key);
        } else {
            generated[key] = value;
        }
    }

    return { generated, missing };
};

// ---------------------------------------------------------------------------
// Response assembly
// ---------------------------------------------------------------------------

/**
 * Builds the standardised fallback response envelope.
 *
 * @param {{
 *   generated: Record<string, unknown>,
 *   todos:     Record<string, ReturnType<typeof buildTodoPlaceholder>>,
 * }} params
 * @returns {{
 *   completed: boolean,
 *   generated: Record<string, unknown>,
 *   todos:     Record<string, unknown>,
 *   metadata:  { generatedCount: number, missingCount: number, timestamp: string },
 * }}
 */
export const assembleResponse = ({ generated, todos }) => {
    const generatedCount = Object.keys(generated).length;
    const missingCount = Object.keys(todos).length;

    return {
        completed: missingCount === 0,
        generated,
        todos,
        metadata: {
            generatedCount,
            missingCount,
            timestamp: new Date().toISOString(),
        },
    };
};

// ---------------------------------------------------------------------------
// Safe reason resolution
// ---------------------------------------------------------------------------

/**
 * Maps a caught error to a safe FAILURE_REASONS string.
 * Never exposes stack traces or internal details.
 *
 * @param {unknown} error
 * @returns {string}
 */
export const resolveFailureReason = (error) => {
    if (!error) return FAILURE_REASONS.UNKNOWN;

    const name = error?.name ?? "";
    const message = (error?.message ?? "").toLowerCase();

    if (name === "MissingArtifactError") return FAILURE_REASONS.MISSING_ARTIFACT;
    if (name === "IncompleteOutputError") return FAILURE_REASONS.EMPTY_OUTPUT;

    if (message.includes("timeout")) return FAILURE_REASONS.GENERATION_TIMEOUT;
    if (message.includes("json")) return FAILURE_REASONS.INVALID_JSON;
    if (message.includes("parse")) return FAILURE_REASONS.PARSER_ERROR;
    if (message.includes("snapshot")) return FAILURE_REASONS.INVALID_SNAPSHOT;
    if (message.includes("coverage")) return FAILURE_REASONS.COVERAGE_FILE_MISSING;
    if (message.includes("dependency") || message.includes("install"))
        return FAILURE_REASONS.DEPENDENCY_INSTALL_FAILED;
    if (message.includes("ai") || message.includes("provider") || message.includes("openai"))
        return FAILURE_REASONS.AI_PROVIDER_UNAVAILABLE;
    if (message.includes("unsupported") || message.includes("language"))
        return FAILURE_REASONS.UNSUPPORTED_LANGUAGE;

    return FAILURE_REASONS.UNKNOWN;
};