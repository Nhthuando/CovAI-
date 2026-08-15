export const PROJECT_STRUCTURE_SCHEMA_VERSION = 1;

export const SUPPORTED_SOURCE_EXTENSIONS = Object.freeze([
    ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
]);

export const IGNORED_DIRECTORY_NAMES = new Set([
    "node_modules", ".git", "dist", "build", "coverage", ".cache",
    ".next", ".nuxt", ".turbo", "vendor",
]);

export const MODULE_FORMATS = Object.freeze({
    ESM: "ESM",
    COMMON_JS: "CommonJS",
    MIXED: "Mixed",
    UNKNOWN: "Unknown",
});

export const DIAGNOSTIC_CATEGORIES = Object.freeze({
    DISCOVERY: "discovery",
    READ: "read",
    PARSE: "parse",
    DEPENDENCY: "dependency",
    CLASSIFICATION: "classification",
});

export const SAFE_JOB_STATUSES = Object.freeze([
    "QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELED",
]);
