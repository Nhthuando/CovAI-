import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";
import { DIAGNOSTIC_CATEGORIES, IGNORED_DIRECTORY_NAMES, SUPPORTED_SOURCE_EXTENSIONS } from "./projectStructure.constants.js";

const normalizeRelativePath = (rootDir, absolutePath) =>
    path.relative(rootDir, absolutePath).split(path.sep).join("/");

const assertRootDir = (rootDir) => {
    if (!rootDir || typeof rootDir !== "string") {
        throw new ServiceError("Root directory path is required and must be a string", 400);
    }
    if (!fs.existsSync(rootDir)) {
        throw new ServiceError("Root directory does not exist", 404);
    }
};

/**
 * Discovers source code files in the root directory.
 * @param {string} rootDir - Absolute path to the project root directory.
 * @returns {string[]} - Array of absolute paths to the source files.
 */
export const discoverSourceFiles = (rootDir) => {
    assertRootDir(rootDir);
    const sourceFiles = [];
    const traverse = (currentPath) => {
        try {
            const items = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(currentPath, item.name);
                if (item.isDirectory()) {
                    if (!IGNORED_DIRECTORY_NAMES.has(item.name)) {
                        traverse(fullPath);
                    }
                } else if (item.isFile()) {
                    const ext = path.extname(item.name).toLowerCase();
                    if (SUPPORTED_SOURCE_EXTENSIONS.includes(ext)) {
                        sourceFiles.push(fullPath);
                    }
                }
            }
        } catch { /* Legacy API intentionally skips inaccessible directories. */ }
    };
    traverse(rootDir);
    return sourceFiles.sort((left, right) => left.localeCompare(right));
};

/**
 * Snapshot-only discovery for Architecture analysis. Absolute paths never leave
 * this service; consumers receive only normalized snapshot-relative metadata.
 */
export const discoverSnapshotSourceFiles = (rootDir) => {
    assertRootDir(rootDir);
    const files = [];
    const diagnostics = [];

    const visit = (directory) => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch (error) {
            diagnostics.push({
                category: DIAGNOSTIC_CATEGORIES.DISCOVERY,
                severity: "warning",
                path: normalizeRelativePath(rootDir, directory) || undefined,
                message: "Directory could not be read",
            });
            return;
        }

        for (const entry of entries) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) visit(absolutePath);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!SUPPORTED_SOURCE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;
            files.push({ absolutePath, relativePath: normalizeRelativePath(rootDir, absolutePath) });
        }
    };

    visit(rootDir);
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return { files, diagnostics };
};
