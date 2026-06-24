import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Discovers source code files in the root directory.
 * @param {string} rootDir - Absolute path to the project root directory.
 * @returns {string[]} - Array of absolute paths to the source files.
 */
export const discoverSourceFiles = (rootDir) => {
    // 1. Validate input
    if (!rootDir || typeof rootDir !== "string") {
        throw new ServiceError("Root directory path is required and must be a string", 400);
    }

    // 2. Check if directory exists
    if (!fs.existsSync(rootDir)) {
        throw new ServiceError("Root directory does not exist", 404);
    }

    // 3. Configure ignore list and allowed extensions
    const ignoredFolders = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
    const allowedExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

    const sourceFiles = [];

    // 4. Recursive directory traversal function
    const traverse = (currentPath) => {
        try {
            const items = fs.readdirSync(currentPath, { withFileTypes: true });

            for (const item of items) {
                const fullPath = path.join(currentPath, item.name);

                if (item.isDirectory()) {
                    // Skip ignored folders
                    if (!ignoredFolders.has(item.name)) {
                        traverse(fullPath);
                    }
                } else if (item.isFile()) {
                    // Check file extension
                    const ext = path.extname(item.name).toLowerCase();
                    if (allowedExtensions.has(ext)) {
                        sourceFiles.push(fullPath);
                    }
                }
            }
        } catch (error) {
            // Ignore directories without access permissions
            if (error.code !== 'EACCES') {
                console.error(`Error reading directory ${currentPath}:`, error.message);
            }
        }
    };

    // 5. Start the scanning process
    traverse(rootDir);

    return sourceFiles;
};
