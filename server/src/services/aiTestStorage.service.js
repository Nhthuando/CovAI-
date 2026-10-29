import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Validates a file path to ensure it is relative and does not escape the root directory.
 * @param {string} rootDir 
 * @param {string} filePath 
 * @returns {string} The resolved absolute path
 */
export const resolveAndValidateAiTestPath = (rootDir, filePath) => {
    if (!rootDir || typeof rootDir !== 'string') throw new ServiceError("Invalid rootDir", 500);
    if (!filePath || typeof filePath !== 'string') throw new ServiceError("Invalid filePath", 400);

    if (path.isAbsolute(filePath)) {
        throw new ServiceError(`Generated path must be relative: ${filePath}`, 400);
    }
    if (filePath.replaceAll("\\", "/").split("/").some(part => /^(?:\.git|node_modules|\.covai-collaboration.*)$/i.test(part)
        || /^\.env(?:\.|$)/i.test(part) || /[\0\r\n]/.test(part))) {
        throw new ServiceError("Generated test path uses a reserved workspace location", 400);
    }

    const resolvedPath = path.resolve(rootDir, filePath);
    
    const relativeToRoot = path.relative(rootDir, resolvedPath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        throw new ServiceError(`Generated path attempts to escape snapshot root: ${filePath}`, 400);
    }

    return resolvedPath;
};

/**
 * Resolves the absolute path to the target application's main entry point.
 * Checks package.json main fields and standard candidate paths across server/backend/src/root.
 *
 * @param {string} rootDir 
 * @param {string} filePath 
 * @returns {string|null} Absolute path to entry point if found
 */
export const resolveAppEntryPoint = (rootDir, filePath) => {
    if (!rootDir || !filePath) return null;

    // 1. Check package.json main entry points if available
    const checkPkgMain = (dir) => {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                if (pkg.main && typeof pkg.main === 'string') {
                    const resolvedMain = path.resolve(dir, pkg.main);
                    if (fs.existsSync(resolvedMain)) return resolvedMain;
                    if (fs.existsSync(resolvedMain + ".js")) return resolvedMain + ".js";
                    if (fs.existsSync(path.join(resolvedMain, "index.js"))) return path.join(resolvedMain, "index.js");
                }
            } catch (_) {}
        }
        return null;
    };

    const pkgCandidates = [
        checkPkgMain(path.join(rootDir, "server")),
        checkPkgMain(path.join(rootDir, "backend")),
        checkPkgMain(rootDir),
    ].filter(Boolean);

    if (pkgCandidates.length > 0) {
        return pkgCandidates[0];
    }

    // 2. Candidate app paths in priority order
    const candidateAppPaths = [
        path.join(rootDir, "server", "index.js"),
        path.join(rootDir, "server", "app.js"),
        path.join(rootDir, "server", "server.js"),
        path.join(rootDir, "server", "src", "index.js"),
        path.join(rootDir, "server", "src", "app.js"),
        path.join(rootDir, "backend", "index.js"),
        path.join(rootDir, "backend", "app.js"),
        path.join(rootDir, "backend", "server.js"),
        path.join(rootDir, "backend", "src", "index.js"),
        path.join(rootDir, "backend", "src", "app.js"),
        path.join(rootDir, "src", "index.js"),
        path.join(rootDir, "src", "app.js"),
        path.join(rootDir, "src", "server.js"),
        path.join(rootDir, "index.js"),
        path.join(rootDir, "app.js"),
        path.join(rootDir, "server.js")
    ];

    return candidateAppPaths.find(p => fs.existsSync(p)) || null;
};

/**
 * Canonical helper to resolve relative imports to the project's app/server entry point.
 * Accurately calculates the relative path based on the test file's directory depth,
 * preventing corrupted imports (e.g. ../../server/index.js inside server/__tests__/).
 *
 * @param {string} code 
 * @param {string} rootDir 
 * @param {string} filePath 
 * @returns {string} Transformed code with correct relative app imports
 */
export const resolveAppImportPath = (code, rootDir, filePath) => {
    if (!code || typeof code !== 'string' || !rootDir || !filePath) return code;
    try {
        const fullTestPath = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
        const testDir = path.dirname(fullTestPath);

        const targetAppPath = resolveAppEntryPoint(rootDir, fullTestPath);
        if (!targetAppPath) {
            throw new ServiceError(`Could not locate application entry point for test '${filePath}' in snapshot root '${rootDir}'`, 422);
        }

        // Canonical relative path from the test directory to the target app entry
        let targetRelative = path.relative(testDir, targetAppPath).replace(/\\/g, "/");
        if (!targetRelative.startsWith(".")) {
            targetRelative = "./" + targetRelative;
        }
        const targetRelativeNoExt = targetRelative.replace(/\.js$/, "");

        // Match require or import of index, app, server, main, or entry points
        let modifiedCode = code;
        const importRegex = /(['"])((?:\.\.?\/)+[^'"]*?(?:index|app|server|main)(?:\.js)?)(['"])/g;
        modifiedCode = modifiedCode.replace(importRegex, (match, quote1, relImport, quote2) => {
            const resolvedCandidate = path.resolve(testDir, relImport);
            // If already resolves to the target entry point, keep it
            if (
                resolvedCandidate === targetAppPath ||
                resolvedCandidate + ".js" === targetAppPath ||
                path.join(resolvedCandidate, "index.js") === targetAppPath
            ) {
                return match;
            }
            const useExt = relImport.endsWith(".js") ? ".js" : "";
            return `${quote1}${targetRelativeNoExt}${useExt}${quote2}`;
        });

        // Verification: verify that the resulting app import resolves to an existing file
        const appMatches = [...modifiedCode.matchAll(/(?:require\s*\(\s*|from\s+)(['"])((?:\.\.?\/)+[^'"]*?(?:index|app|server|main)(?:\.js)?)\1/g)];
        for (const m of appMatches) {
            const rel = m[2];
            const abs = path.resolve(testDir, rel);
            const exists = fs.existsSync(abs) || fs.existsSync(abs + ".js") || fs.existsSync(path.join(abs, "index.js"));
            if (!exists) {
                throw new ServiceError(`Transformed import '${rel}' in '${filePath}' cannot be resolved to any existing entry point on disk (resolved to '${abs}')`, 422);
            }
        }

        return modifiedCode;
    } catch (e) {
        if (e instanceof ServiceError) throw e;
        return code;
    }
};

/**
 * Saves generated AI tests to the physical filesystem.
 * @param {string} rootDir 
 * @param {Array<{filePath: string, content: string}>} tests 
 */
export const saveAiTestsToFilesystem = (rootDir, tests) => {
    if (!tests || !Array.isArray(tests)) return;

    for (const test of tests) {
        const fullPath = resolveAndValidateAiTestPath(rootDir, test.filePath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const content = resolveAppImportPath(test.content, rootDir, fullPath);
        test.content = content;
        fs.writeFileSync(fullPath, content, 'utf8');
    }
};

/**
 * Removes previously generated AI tests from the physical filesystem.
 * @param {string} rootDir 
 * @param {Array<{filePath: string}>} tests 
 */
export const removeAiTestsFromFilesystem = (rootDir, tests) => {
    if (!tests || !Array.isArray(tests)) return;

    for (const test of tests) {
        try {
            const fullPath = resolveAndValidateAiTestPath(rootDir, test.filePath);
            if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, 'utf8');
                if (content.includes("[AI GENERATED]")) {
                    fs.unlinkSync(fullPath);
                }
            }
        } catch (e) {
            console.error(`[AiTestStorage] Error removing test file ${test.filePath}:`, e);
        }
    }
};
