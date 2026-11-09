/**
 * Path Sanitizer Utility
 * Strips internal server/docker storage paths (e.g. /app/storage/projects/.../repo/ or Windows storage paths)
 * from file paths, error messages, stack traces, and test suites so they are never leaked to clients.
 */
import fs from "fs";
import path from "path";

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

    // 1b. Match .covai-temp/collaboration-operations/<id>/<file>
    const collabMatch = clean.match(/(?:^|\/)\.?covai-temp\/collaboration-operations\/[^/]+\/(.+)$/i);
    if (collabMatch) {
        return collabMatch[1].replace(/^\/+/, "");
    }
    const tempMatch = clean.match(/(?:^|\/)\.?covai-temp\/[^/]+\/(.+)$/i);
    if (tempMatch) {
        return tempMatch[1].replace(/^\/+/, "");
    }

    // 2. If it is exactly the repo root or storage directory without relative file
    if (/(?:^|\/)(?:repo|storage\/projects\/[^/]+(?:\/[^/]+)*|\.?covai-temp(?:\/[^/]+)*)\/?$/i.test(clean)) {
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
    clean = clean.replace(/^\/app\/(?:storage|uploads|\.?covai-temp)\/?/i, "");
    clean = clean.replace(/^app\/(?:storage|uploads|\.?covai-temp)\/?/i, "");
    clean = clean.replace(/^\/app\//i, "");
    clean = clean.replace(/^app\//i, "");
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
        .replace(/(?:\/app|[a-zA-Z]:[\\/][^ \t\r\n'\"()]*)?[\\/]\.?covai-temp[\\/]collaboration-operations[\\/][^ \t\r\n'\"()]+[\\/]/gi, "")
        .replace(/(?:\/app|[a-zA-Z]:[\\/][^ \t\r\n'\"()]*)?[\\/]\.?covai-temp[\\/][^ \t\r\n'\"()]+[\\/]/gi, "")
        .replace(/(?:\/app)?\/storage\/projects\/[^\s'\"()]+\/repo\//gi, "")
        .replace(/(?:\/app)?\/storage\/projects\/[^\s'\"()]+\/snapshots\/[^\s'\"()]+\/coverage\//gi, "")
        .replace(/(?:\/app)?\/storage\/projects\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?/gi, "")
        .replace(/(?:\/app|[a-zA-Z]:[\\/][^ \t\r\n'\"()]*)?[\\/]uploads[\\/]snapshots[\\/][^ \t\r\n'\"()]+[\\/][^ \t\r\n'\"()]+[\\/]/gi, "")
        .replace(/(?:\/app)?\/uploads\/snapshots\/[^\s'\"()]+\/[^\s'\"()]+\//gi, "")
        .replace(/\/app\/(?:storage|uploads|\.?covai-temp)\/?/gi, "")
        .replace(/^app\/(?:storage|uploads|\.?covai-temp)\/?/gi, "");
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

        const KNOWN_SUBPROJECTS = new Set(["server", "backend", "client", "frontend", "services", "api"]);
        const CONTAINER_DIRS = new Set(["repo", "snapshots", "uploads", "storage", "projects", "app", ".covai-temp", "collaboration-operations"]);
        const rootBaseName = path.basename(normRoot);
        const parentBaseName = path.basename(path.dirname(normRoot));

        if (rootBaseName && KNOWN_SUBPROJECTS.has(rootBaseName.toLowerCase())) {
            if (parentBaseName && !CONTAINER_DIRS.has(parentBaseName.toLowerCase()) && clean.toLowerCase().startsWith(parentBaseName.toLowerCase() + "/")) {
                clean = clean.slice(parentBaseName.length + 1).replace(/^\/+/, "");
            }
            if (clean.toLowerCase().startsWith(rootBaseName.toLowerCase() + "/")) {
                clean = `${rootBaseName}/${clean.slice(rootBaseName.length + 1).replace(/^\/+/, "")}`;
            } else if (!clean.startsWith("repo/")) {
                clean = `${rootBaseName}/${clean}`;
            }
        } else {
            // If clean starts with rootDir's folder name (e.g. "gemini_chatbox/server/src/..."), strip it
            if (rootBaseName && clean.toLowerCase().startsWith(rootBaseName.toLowerCase() + "/")) {
                clean = clean.slice(rootBaseName.length + 1).replace(/^\/+/, "");
            }

            const subPkgMatch = normRoot.match(/(?:^|\/)repo\/([^/]+)/i);
            if (subPkgMatch) {
                const subPkg = subPkgMatch[1];
                if (KNOWN_SUBPROJECTS.has(subPkg.toLowerCase())) {
                    if (!clean.toLowerCase().startsWith(subPkg.toLowerCase() + "/") && !clean.startsWith("repo/")) {
                        clean = `${subPkg}/${clean}`;
                    }
                }
            }
        }

        // If file does not exist directly at <rootDir>/<clean>, check if it exists in subprojects (e.g. server, backend, client, frontend, services)
        try {
            if (fs.existsSync(rootDir)) {
                const directPath = path.join(rootDir, clean);
                if (!fs.existsSync(directPath)) {
                    const CANDIDATE_SUBPROJECTS = ["server", "backend", "client", "frontend", "services"];
                    let resolved = false;
                    for (const sub of CANDIDATE_SUBPROJECTS) {
                        if (fs.existsSync(path.join(rootDir, sub, clean))) {
                            clean = `${sub}/${clean}`;
                            resolved = true;
                            break;
                        }
                    }
                    if (!resolved) {
                        try {
                            const entries = fs.readdirSync(rootDir, { withFileTypes: true });
                            for (const entry of entries) {
                                if (entry.isDirectory() && !["node_modules", ".git", "coverage", "dist", "build", ".next", ".cache", ".covai-temp"].includes(entry.name)) {
                                    if (fs.existsSync(path.join(rootDir, entry.name, clean))) {
                                        clean = `${entry.name}/${clean}`;
                                        break;
                                    }
                                }
                            }
                        } catch { }
                    }
                }
            }
        } catch { }
    }
    return clean.replace(/\\/g, "/").replace(/^\.?\//, "");
};
