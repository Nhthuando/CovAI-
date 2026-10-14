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

    const resolvedPath = path.resolve(rootDir, filePath);
    
    const relativeToRoot = path.relative(rootDir, resolvedPath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        throw new ServiceError(`Generated path attempts to escape snapshot root: ${filePath}`, 400);
    }

    return resolvedPath;
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

        let content = test.content;
        // Automatically resolve app import if model pointed to ../../index when server is in server/index.js
        if (
            (content.includes('"../../index"') || content.includes("'../../index'") || content.includes('"../../index.js"') || content.includes("'../../index.js'")) &&
            !fs.existsSync(path.join(rootDir, 'index.js')) &&
            fs.existsSync(path.join(rootDir, 'server', 'index.js'))
        ) {
            content = content.replace(/(['"])\.\.\/\.\.\/index(\.js)?(['"])/g, '$1../../server/index.js$3');
        }

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
