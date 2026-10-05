import { cleanAndDeduplicateTestContent, healImportPathsInTestCode } from "../services/testSanitizer.service.js";
import { findAssociatedTestFile } from "../services/fileCoverage.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";

describe("testSanitizer.service", () => {
    describe("cleanAndDeduplicateTestContent", () => {
        test("resolves duplicate destructuring declarations", () => {
            const code = `
const { DataTypes } = require('sequelize');
const { models } = require('../models');

const { DataTypes } = require("sequelize");
const { sequelize, initDatabase, models } = require("../../src/models/index");
describe('sample', () => {
    test('works', () => {
        expect(true).toBe(true);
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("// [deduped] const { DataTypes } = require(\"sequelize\");");
            expect(sanitized).toContain("const { sequelize, initDatabase } = require(\"../../src/models/index\");");

            // Verify with Babel parser: 0 syntax errors!
            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("resolves duplicate simple top-level declarations", () => {
            const code = `
const mockSequelizeInstance = { define: jest.fn() };

describe('suite 1', () => {
    test('one', () => { expect(mockSequelizeInstance).toBeDefined(); });
});

const mockSequelizeInstance = { authenticate: jest.fn() };
describe('suite 2', () => {
    test('two', () => { expect(mockSequelizeInstance).toBeDefined(); });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("const mockSequelizeInstance_dedup = { authenticate: jest.fn() };");
            expect(sanitized).toContain("expect(mockSequelizeInstance_dedup).toBeDefined();");

            // Verify with Babel parser
            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("removes non-code placeholder comments and invalid describe blocks", () => {
            const code = `
describe('real suite', () => {
    test('ok', () => { expect(true).toBe(true); });
});

describe('AI Suggested Unit Tests', () => {
    N/A - See fullUpdatedContent
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).not.toContain("N/A - See fullUpdatedContent");
            expect(sanitized).not.toContain("AI Suggested Unit Tests");

            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("cleans corrupt TypeScript annotations in JS files", () => {
            const code = `
const mockFn = jest.fn(((data: any)) => data);
const secondFn = (val: string, num: number) => num;
describe('ts annotations', () => {
    test('cleans', () => {
        expect(mockFn(1)).toBe(1);
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("(data)");
            expect(sanitized).toContain("(val, num)");

            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });
    });

    describe("findAssociatedTestFile", () => {
        test("does not match unrelated test file simply because of same package prefix", () => {
            const rootDir = process.cwd();
            const result = findAssociatedTestFile(rootDir, "src/models/document.model.js");
            // If document.model.test.js doesn't exist, it should return found: false and suggest a clean path
            if (!result.found) {
                expect(result.suggestedFilePath).toContain("document.model.test");
            } else {
                expect(result.filePath).toContain("document.model");
            }
        });
    });
});
