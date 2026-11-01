/**
 * Path Sanitizer Utility
 * Strips internal server/docker storage paths (e.g. /app/storage/projects/.../repo/ or Windows storage paths)
 * from file paths, error messages, stack traces, and test suites so they are never leaked to clients.
 */

/**
 * Normalizes and sanitizes a file path to return a clean repository-relative path.
 * 
 * Examples:
 *  - "/app/storage/projects/cmut.../github/179.../repo/tests/unit/foo.test.ts" -> "tests/unit/foo.test.ts"
 *  - "D:\\NCKH\\CovAI-\\server\\storage\\projects\\cmut...\\github\\179...\\repo\\src\\foo.js" -> "src/foo.js"
 *  - "/app/storage/projects/cmut.../github/179.../repo" -> ""
 *  - "storage/projects/cmut.../snapshots/.../coverage/lcov.info" -> "lcov.info"
 *  - "tests/unit/foo.test.ts" -> "tests/unit/foo.test.ts"
 *
 * @param {string} p
 * @returns {string}
 */
export const cleanStoragePath = (p) => {
    if (!p || typeof p !== "string") return "";
    let clean = p.replace(/\\/g, "/").trim();

    // 1. If it contains /repo/<relativePath>, extract the relative path
    const repoMatch = clean.match(/(?:^|\/)repo\/(.+)$/i);
    if (repoMatch) {
        return repoMatch[1].replace(/^\/+/, "");
    }

    // 2. If it is exactly the repo root or storage directory without relative file
    if (/(?:^|\/)(?:repo|storage\/projects\/[^/]+(?:\/[^/]+)*)\/?$/i.test(clean)) {
        return "";
    }

    // 3. Match storage/projects/<projectId>/snapshots/<snapshotId>/coverage/<file>
    const covMatch = clean.match(/(?:^|\/)storage\/projects\/[^/]+\/snapshots\/[^/]+\/coverage\/(.+)$/i);
    if (covMatch) {
        return covMatch[1].replace(/^\/+/, "");
    }

    // 3b. Match uploads/snapshots/<snapshotId>/<projectName>/<file>
    const uploadProjMatch = clean.match(/(?:^|\/)uploads\/snapshots\/[^/]+\/[^/]+\/(.+)$/i);
    if (uploadProjMatch) {
        return uploadProjMatch[1].replace(/^\/+/, "");
    }
    const uploadDirectMatch = clean.match(/(?:^|\/)uploads\/snapshots\/[^/]+\/(.+)$/i);
    if (uploadDirectMatch) {
        return uploadDirectMatch[1].replace(/^\/+/, "");
    }

    // 4. Fallback: match storage/projects/<projectId>/.../<target>
    const storageProjectsMatch = clean.match(/(?:^|\/)storage\/projects\/[^/]+(?:\/[^/]+)*?\/(.+)$/i);
    if (storageProjectsMatch) {
        return storageProjectsMatch[1].replace(/^\/+/, "");
    }

    // 5. Strip drive letters and docker root prefix
    clean = clean.replace(/^[a-zA-Z]:\//, "");
    clean = clean.replace(/^\/app\/(?:storage|uploads)\/?/i, "");
    return clean.replace(/^\/+/, "");
};

/**
 * Strips internal storage paths from error logs, failure messages, stack traces, and console output.
 *
 * Examples:
 *  - "Cannot find module '@/foo' from '/app/storage/projects/cmut.../repo/tests/foo.test.ts'"
 *    -> "Cannot find module '@/foo' from 'tests/foo.test.ts'"
 *  - "at Object.<anonymous> (/app/storage/projects/.../repo/tests/bar.test.ts:18:2)"
 *    -> "at Object.<anonymous> (tests/bar.test.ts:18:2)"
 *
 * @param {string} text
 * @returns {string}
 */
export const cleanStorageText = (text) => {
    if (!text || typeof text !== "string") return text;
    let cleaned = text
        .replace(/(?:\/app|[a-zA-Z]:[\\/][^ \t\r\n'\"()]*)?[\\/]storage[\\/]projects[\\/][^ \t\r\n'\"()]+(?:[\\/][^ \t\r\n'\"()]+)*?[\\/]repo[\\/]/gi, "")
        .replace(/(?:\/app)?\/storage\/projects\/[^\s'\"()]+\/repo\//gi, "")
        .replace(/(?:\/app)?\/storage\/projects\/[^\s'\"()]+\/snapshots\/[^\s'\"()]+\/coverage\//gi, "")
        .replace(/(?:\/app)?\/storage\/projects\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?/gi, "")
        .replace(/(?:\/app|[a-zA-Z]:[\\/][^ \t\r\n'\"()]*)?[\\/]uploads[\\/]snapshots[\\/][^ \t\r\n'\"()]+[\\/][^ \t\r\n'\"()]+[\\/]/gi, "")
        .replace(/(?:\/app)?\/uploads\/snapshots\/[^\s'\"()]+\/[^\s'\"()]+\//gi, "")
        .replace(/\/app\/(?:storage|uploads)\/?/gi, "");
    return cleaned;
};

/**
 * Canonicalizes a file path so that paths within the project are consistently represented.
 * If rootDir points to a subpackage under repo (e.g. ".../repo/backend"), and filePath is "src/...",
 * canonicalizes to "backend/src/...".
 * If filePath has full storage or container prefix, cleanly normalizes to repository-relative format.
 *
 * @param {string} p
 * @param {string} [rootDir]
 * @returns {string}
 */
export const canonicalizeFilePath = (p, rootDir = "") => {
    if (!p || typeof p !== "string") return "";
    let clean = cleanStoragePath(p);
    if (!clean) return "";

    if (rootDir) {
        const normRoot = rootDir.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
        const normP = p.replace(/\\/g, "/").replace(/^\.?\//, "");
        if (normP.toLowerCase().startsWith(normRoot.toLowerCase() + "/")) {
            clean = normP.slice(normRoot.length + 1).replace(/^\/+/, "");
        }
        const subPkgMatch = normRoot.match(/(?:^|\/)repo\/([^/]+)/i);
        if (subPkgMatch) {
            const subPkg = subPkgMatch[1];
            const excludedSubPkgs = new Set(["src", "tests", "test", "__tests__", "lib", "dist", "build"]);
            if (!excludedSubPkgs.has(subPkg.toLowerCase())) {
                if (!clean.startsWith(subPkg + "/") && !clean.startsWith("repo/")) {
                    clean = `${subPkg}/${clean}`;
                }
            }
        }
    }
    return clean.replace(/\\/g, "/").replace(/^\.?\//, "");
};
