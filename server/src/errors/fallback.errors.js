/**
 * @file fallback.errors.js
 * @description Custom error classes for the TODO Fallback Generator.
 *
 *   These errors are informational — they must never crash the pipeline.
 *   Catch them at the service boundary and convert them into fallback entries.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/**
 * Base class for all fallback-related errors.
 * Carries an optional `section` field so callers know which generator failed.
 */
export class FallbackGenerationError extends Error {
    /**
     * @param {string}  message          Safe, user-visible error description.
     * @param {string}  [section]        The pipeline section that failed (e.g. "cfg").
     * @param {unknown} [originalError]  Original caught value — never exposed externally.
     */
    constructor(message, section = null, originalError = null) {
        super(message);
        this.name = "FallbackGenerationError";
        this.section = section;
        /** @private — do NOT serialise or log this to external systems */
        this._originalError = originalError;
    }
}

// ---------------------------------------------------------------------------
// Specialisations
// ---------------------------------------------------------------------------

/**
 * Thrown when a generator returns a value that is structurally incomplete
 * (null, empty array, missing required field, etc.).
 */
export class IncompleteOutputError extends FallbackGenerationError {
    /**
     * @param {string}  section        The section whose output is incomplete.
     * @param {string}  [detail]       Additional safe context (no stack traces).
     * @param {unknown} [originalError]
     */
    constructor(section, detail = "", originalError = null) {
        const message = detail
            ? `Incomplete output for section "${section}": ${detail}`
            : `Incomplete output for section "${section}".`;
        super(message, section, originalError);
        this.name = "IncompleteOutputError";
    }
}

/**
 * Thrown when a required artifact (file, snapshot, report) is not found.
 */
export class MissingArtifactError extends FallbackGenerationError {
    /**
     * @param {string}  section        The section that requires the artifact.
     * @param {string}  [artifactName] Descriptive name of the missing artifact.
     * @param {unknown} [originalError]
     */
    constructor(section, artifactName = "artifact", originalError = null) {
        super(`Missing ${artifactName} required by section "${section}".`, section, originalError);
        this.name = "MissingArtifactError";
    }
}