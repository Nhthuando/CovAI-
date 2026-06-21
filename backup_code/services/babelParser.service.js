import { parse } from '@babel/parser';
import fs from 'fs';

/**
 * Reusable Babel parser configuration.
 */
const parserOptions = {
    sourceType: "module",
    plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "classPrivateMethods",
        "classPrivateProperties",
        "optionalChaining",
        "nullishCoalescingOperator",
        "dynamicImport",
        "objectRestSpread",
        "topLevelAwait"
    ]
};

/**
 * Parses a JavaScript code string into an AST.
 * @param {string} codeString - The JavaScript code to parse.
 * @returns {Object} Result object containing success status, AST, or error message.
 */
export const parseJavaScriptCode = (codeString) => {
    try {
        const ast = parse(codeString, parserOptions);
        return {
            success: true,
            ast
        };
    } catch (error) {
        return {
            success: false,
            ast: null,
            error: error.message
        };
    }
};

/**
 * Reads a JavaScript file and parses it into an AST.
 * @param {string} filePath - The path to the JavaScript file.
 * @returns {Object} Result object containing success status, AST, or error message.
        return {
            success: false,
            ast: null,
            error: error.message || 'Failed to parse code'
        };
    }
};

/**
 * Reads a JavaScript file and parses it into a Babel AST.
 * @param {string} filePath - The path to the file.
 * @returns {{success: boolean, ast: object|null, error?: string}}
 */
export const parseJavaScriptFile = (filePath) => {
    if (typeof filePath !== 'string') {
        return { success: false, ast: null, error: 'Invalid file path' };
    }

    if (!fs.existsSync(filePath)) {
        return {
            success: false,
            ast: null,
            error: `File does not exist: ${filePath}`
        };
    }

    try {
        const code = fs.readFileSync(filePath, 'utf-8');
        return parseJavaScriptCode(code);
    } catch (error) {
        return {
            success: false,
            ast: null,
            error: `Failed to read file: ${error.message}`
        };
    }
};