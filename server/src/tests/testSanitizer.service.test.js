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

        test("resolves duplicate simple top-level declarations safely without forward renaming", () => {
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
            expect(sanitized).toContain("// [deduped] const mockSequelizeInstance = { authenticate: jest.fn() };");
            expect(sanitized).toContain("expect(mockSequelizeInstance).toBeDefined();");

            // Verify with Babel parser
            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("resolves duplicate ESM imports safely", () => {
            const code = `
import { createQuickbooksBill } from '../../src/handlers/bill.handlers.js';
import { createQuickbooksBill, getQuickbooksBill } from '../../src/handlers/bill.handlers.js';
import { createQuickbooksBill } from './bill-alias.js';

describe('suite', () => {
    test('one', () => { expect(createQuickbooksBill).toBeDefined(); });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("import { getQuickbooksBill } from '../../src/handlers/bill.handlers.js';");
            expect(sanitized).toContain("// [deduped] import { createQuickbooksBill } from './bill-alias.js';");

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

        test("preserves scoped local variables across tests and does not rename property accesses like result.result", () => {
            const code = `
describe('suite', () => {
    it('test 1', async () => {
        const result = await handler();
        expect(result.isError).toBe(false);
        expect(result.result).toEqual({ Id: '1' });
    });
    it('test 2', async () => {
        const result = await handler();
        expect(result.isError).toBe(false);
        expect(result.result).toEqual([]);
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code, "", "tests/handler.test.ts");
            expect(sanitized).toContain("const result = await handler();");
            expect(sanitized).toContain("expect(result.result).toEqual({ Id: '1' });");
            expect(sanitized).toContain("expect(result.result).toEqual([]);");
            expect(sanitized).not.toContain("result_dedup");
        });

        test("preserves TypeScript syntax and type casting in .ts files", () => {
            const code = `
describe('ts test', () => {
    it('calls', () => {
        const [[reqOptions]] = (mockHttpsRequest as jest.Mock).mock.calls as any[][];
        const seen: any[] = [];
        expect(reqOptions).toBeDefined();
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code, "", "tests/unit/helpers/register-tool.test.ts");
            expect(sanitized).toContain("(mockHttpsRequest as jest.Mock).mock.calls as any[][]");
            expect(sanitized).toContain("const seen: any[] = []");
            expect(sanitized).not.toContain("calls [][]");
            expect(sanitized).not.toContain("seen[]");
        });

        test("removes illegal jest declarations in CommonJS require statements", () => {
            const code = `
const { jest } = require('@jest/globals');
const { jest, describe, test, it, expect } = require('@jest/globals');
const jest = require('@jest/globals');

describe('config module', () => {
    test('works', () => {
        expect(true).toBe(true);
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("const { describe, test, it, expect } = require('@jest/globals');");
            expect(sanitized).not.toContain("const { jest }");
            expect(sanitized).not.toContain("const jest = require");

            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("does not remove identical require statements inside test function bodies (braceDepth > 0)", () => {
            const code = `
describe('config module', () => {
    test('test 1', () => {
        process.env.NODE_ENV = 'development';
        const config = require('../../src/config/index');
        expect(config.env).toBe('development');
    });

    test('test 2', () => {
        process.env.NODE_ENV = 'production';
        const config = require('../../src/config/index');
        expect(config.env).toBe('production');
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            const matches = [...sanitized.matchAll(/const config = require\('\.\.\/\.\.\/src\/config\/index'\);/g)];
            expect(matches.length).toBe(2);
        });

        test("heals ReferenceError by re-injecting required module into test blocks where it is missing", () => {
            const code = `
describe('config module', () => {
    test('test 1', () => {
        const config = require('../../src/config/index');
        expect(config.env).toBe('development');
    });

    test('test 2', () => {
        expect(config.env).toBe('production');
    });
});
`;
            const rawOutput = "ReferenceError: config is not defined";
            const sanitized = cleanAndDeduplicateTestContent(code, rawOutput);
            expect(sanitized).toContain("const config = require('../../src/config/index');");
            const test2Match = sanitized.match(/test\('test 2'[\s\S]*?expect\(config\.env\)/);
            expect(test2Match[0]).toContain("const config = require('../../src/config/index');");
        });

        test("heals Identifier jest has already been declared error in rawOutput", () => {
            const code = `
const jest = require('./my-custom-jest');
describe('test', () => {
    test('one', () => { expect(1).toBe(1); });
});
`;
            const rawOutput = "SyntaxError: Identifier 'jest' has already been declared";
            const sanitized = cleanAndDeduplicateTestContent(code, rawOutput);
            expect(sanitized).toContain("var jest = require('./my-custom-jest');");
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
