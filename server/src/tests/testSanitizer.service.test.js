import {
    cleanAndDeduplicateTestContent,
    healImportPathsInTestCode,
    healMultilineStrings,
    healMismatchedQuotes,
    findTestBlockIntervalByTitle,
    updateTestBlockByTitle,
    ensureJestMockVirtualOption,
    balanceTestFileBraces
} from "../services/testSanitizer.service.js";
import { relaxToHaveBeenCalled } from "../services/applyTestSuggestion.service.js";
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

        test("removes orphan mock property fragments and orphan closing brackets", () => {
            const code = `
const path = require('path');

create: jest.fn(() => ({ post: jest.fn() }))
  }));

describe('test suite', () => {
    test('works', () => {
        expect(1).toBe(1);
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).not.toContain("create: jest.fn");
            expect(sanitized).not.toContain("}));");
            expect(sanitized).toContain("expect(1).toBe(1);");

            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("transforms axios mock into shared mock instance with globalThis.__mockAxiosInstance", () => {
            const code = `
const axios = require('axios');
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    post: jest.fn()
  }))
}));

// [deduped] const mockAxiosInstance = axios.create();

describe('axios service', () => {
    test('calls post', async () => {
        expect(mockAxiosInstance).toBeDefined();
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("globalThis.__mockAxiosInstance = instance;");
            expect(sanitized).toContain("const mockAxiosInstance = (typeof globalThis !== 'undefined' && globalThis.__mockAxiosInstance)");
            expect(sanitized).not.toContain("typeof axios");
            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("heals legacy mockAxiosInstance declarations containing typeof axios to prevent TDZ ReferenceError", () => {
            const code = `const mockAxiosInstance = (typeof globalThis !== 'undefined' && globalThis.__mockAxiosInstance) ? globalThis.__mockAxiosInstance : (typeof axios !== 'undefined' && axios.create ? axios.create() : { post: jest.fn(() => Promise.resolve({ data: {} })), get: jest.fn(() => Promise.resolve({ data: {} })) });
const { chatWithAI } = require('../../src/services/ai.service');
const axios = require('axios');
describe('ai', () => { test('ok', () => expect(true).toBe(true)); });
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).not.toContain("typeof axios");
            expect(sanitized).toContain("const ax = require('axios')");
            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("heals unclosed object literals inside tests that encounter statements before closing brace", () => {
            const code = `
const { analyzeRequirementById } = require('../../src/services/analysis.service');
const { models } = require('../../src/models');
const { analyzeText } = require('../../src/services/ai.service');
describe('analysis', () => {
  it('analyzes successfully', async () => {
    const mockRequirement = { 
        id: 1, 
        text: 'System must log in', 
    expect(mockRequirement.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'analyzed' }));
    expect(result.requirement).toEqual(mockRequirement);
  });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("update: jest.fn()");
            expect(sanitized).toContain("};");
            expect(sanitized).toContain("models.Requirement.findByPk.mockResolvedValue(mockRequirement)");
            expect(sanitized).toContain("analyzeRequirementById");
            const ast = parseJavaScriptCode(sanitized);
            expect(ast).not.toBeNull();
        });

        test("normalizes redundant monorepo prefixes in require calls", () => {
            const code = `
const aiService = require('../../backend/src/services/ai.service');
describe('monorepo path', () => {
    test('uses normalized path', () => {
        expect(aiService).toBeDefined();
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("require('../../src/services/ai.service')");
            expect(sanitized).not.toContain("../../backend/src/");
        });

        test("heals self-assignment of node builtin modules like const path = path to require('path')", () => {
            const code = `const path = path;\ndescribe('worker', () => { test('ok', () => { expect(1).toBe(1); }); });`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).not.toContain("const path = path;");
            expect(sanitized).toContain("const path = require('path');");
        });

        test("removes self-assignment of arbitrary non-builtin variables to avoid TDZ ReferenceError", () => {
            const code = `const customVar = customVar;\ndescribe('custom', () => { test('ok', () => { expect(1).toBe(1); }); });`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).not.toContain("const customVar = customVar;");
        });

        test("heals illegal assignments to reserved keyword default like const fnRef = default or let target = default", () => {
            const code = `import defaultExport from './index';\ndescribe('index', () => {\n  test('default category A', () => {\n    const fnRef: any = default;\n    let target = default;\n    if (typeof default === 'function') { target = new default(); }\n    expect(default).toBeDefined();\n  });\n});`;
            const sanitized = cleanAndDeduplicateTestContent(code, "", "tests/index.test.ts");
            expect(sanitized).not.toContain("const fnRef: any = default;");
            expect(sanitized).not.toContain("let target = default;");
            expect(sanitized).not.toMatch(/\btypeof\s+default\b(?!\w)/);
            expect(sanitized).not.toContain("new default()");
            expect(sanitized).toContain("typeof defaultExport");
        });
    });

    describe("healMultilineStrings", () => {
        test("converts multiline single-quoted strings with unescaped newlines into template literals", () => {
            const input = "const msg = 'First line\nSecond line\nThird line';";
            const healed = healMultilineStrings(input);
            expect(healed).toBe("const msg = `First line\nSecond line\nThird line`;");
        });

        test("converts multiline double-quoted strings with unescaped newlines into template literals", () => {
            const input = 'const msg = "Review:\n- Point 1\n- Point 2";';
            const healed = healMultilineStrings(input);
            expect(healed).toBe('const msg = `Review:\n- Point 1\n- Point 2`;');
        });

        test("leaves normal single-line strings untouched", () => {
            const input = "const a = 'hello world';\nconst b = \"foo bar\";";
            const healed = healMultilineStrings(input);
            expect(healed).toBe(input);
        });

        test("does not corrupt valid single-quoted test titles when preceded by regex with apostrophe", () => {
            const input = `
describe('resolveLocalFile', () => {
  it('checks directory', async () => {
    await expect(foo()).rejects.toThrow(/server's own directory/);
  });

  it('rejects a file larger than the cap', async () => {
    expect(1).toBe(1);
  });
});
`;
            const healed = healMultilineStrings(input);
            expect(healed).not.toContain("`rejects");
            expect(healed).toContain("it('rejects a file larger than the cap', async () => {");
            const ast = parseJavaScriptCode(healed);
            expect(ast.success).toBe(true);
        });

        test("heals mismatched quotes from LLMs or broken parsers", () => {
            const input = `
it(\`rejects a file larger than the cap', async () => {
  expect(id).toBe(\`42');
  expect(res).toBe(\`TaxExcluded');
});
jest.unstable_mockModule(\`dotenv', () => ({ default: {} }));
// on every single call, since Deposit doesn\`t honor
`;
            const healed = healMismatchedQuotes(input);
            expect(healed).toContain('it("rejects a file larger than the cap", async () => {');
            expect(healed).toContain("expect(id).toBe('42');");
            expect(healed).toContain("expect(res).toBe('TaxExcluded');");
            expect(healed).toContain("jest.unstable_mockModule('dotenv', () => ({ default: {} }));");
            expect(healed).toContain("// on every single call, since Deposit doesn't honor");
        });

        test("preserves valid mock objects and does not delete them via orphanMockRegex", () => {
            const input = `
import { jest, describe, it, expect } from '@jest/globals';

const mockQuickbooksClient = {
  authenticate: jest.fn().mockResolvedValue(undefined),
  getQuickbooks: jest.fn(),
};

const mockQuickbooksClientClass = {
  getInstance: jest.fn(),
};

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

const { getQuickbooksGeneralLedger } = await import('../../../src/handlers/get-quickbooks-general-ledger.handler');

describe('contract', () => {
  it('works', () => {
    expect(mockQuickbooksClient.authenticate).toBeDefined();
  });
});
`;
            const cleaned = cleanAndDeduplicateTestContent(input);
            expect(cleaned).toContain("authenticate: jest.fn().mockResolvedValue(undefined)");
            expect(cleaned).toContain("const mockQuickbooksClient = {");
            expect(cleaned).toContain("jest.unstable_mockModule");
            expect(cleaned).toContain("describe('contract'");
            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });

        test("heals unclosed top-level object declarations abruptly followed by imports or describe blocks", () => {
            const brokenInput = `
const mockQuickbooksClient = {

const { getQuickbooksGeneralLedger } = await import('../../../src/handlers/get-quickbooks-general-ledger.handler');

describe('contract', () => {
  it('calls auth', () => {
    mockQuickbooksClient.authenticate();
  });
});
`;
            const cleaned = cleanAndDeduplicateTestContent(brokenInput);
            expect(cleaned).toContain("authenticate: typeof jest !== 'undefined'");
            expect(cleaned).toContain("};\nconst { getQuickbooksGeneralLedger }");
            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });

        test("heals stray closing parentheses after statement terminators like toBeDefined(););", () => {
            const brokenInput = `
describe('controller tests', () => {
  it('TC-BRANCH-04: should handle request with file upload', async () => {
    expect(streamUpload).toBeDefined();
    expect(res.status).toBeDefined();
    expect(res.json).toBeDefined(););
  });

  it('TC-BRANCH-06: should handle request with avatar string', async () => {
    expect(streamUpload).not.toHaveBeenCalled();
    expect(res.status).toBeDefined();
    expect(res.json).toBeDefined(););
  });
});
`;
            const cleaned = cleanAndDeduplicateTestContent(brokenInput);
            expect(cleaned).not.toContain(";);");
            expect(cleaned).toContain("expect(res.json).toBeDefined();");
            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });

        test("relaxToHaveBeenCalled handles nested arguments without leaving trailing parentheses or syntax errors", () => {
            const inputWithNestedArgs = `
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: 'http://cloudinary.com/image.jpg' }));
    expect(streamUpload).toHaveBeenCalledWith(expect.anything());
    expect(res.status).toHaveBeenCalled();
`;
            const relaxed = relaxToHaveBeenCalled(inputWithNestedArgs);
            expect(relaxed).not.toContain("toHaveBeenCalled");
            expect(relaxed).not.toContain(";);");
            expect(relaxed).toContain("expect(res.json).toBeDefined();");
            expect(relaxed).toContain("expect(streamUpload).toBeDefined();");
            expect(relaxed).toContain("expect(res.status).toBeDefined();");
        });

        test("heals misplaced catch inside nested toSatisfy or callbacks caused by premature regex cuts", () => {
            const brokenInput = `
  test('TC-ERR-10/11: should catch errors, wrap them with cause, and throw after max retries', async () => {
    try {
  const originalError = new Error('network timeout');
    const operation = jest.fn().mockRejectedValue(originalError);

    const promise = retryAsync(operation, { retries: 2, delayMs: 200, label: 'database query' })
    promise.catch(() => {});
    promise.catch(() => {});
    const assertionPromise = expect(promise).rejects.toSatisfy((err) => {
      expect(err.message).toBe('Failed to complete database query after 2 attempts');
      expect(err.cause).toBe(originalError);
      return true;
    } catch (err) {
      expect(err).toBeDefined();
    }
    });

    await jest.runAllTimersAsync();
    await assertionPromise;
    expect(operation).toHaveBeenCalledTimes(2);
  });
`;
            const cleaned = cleanAndDeduplicateTestContent(brokenInput);
            expect(cleaned).not.toContain("} catch (err) {\n      expect(err).toBeDefined();\n    }\n    });");
            expect(cleaned).toContain("expect(err.cause).toBe(originalError);");
            expect(cleaned).toContain("toSatisfy(received, predicate)");
            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });

        test("injects toSatisfy polyfill when toSatisfy is used without expect.extend", () => {
            const input = `
test('uses toSatisfy matcher', async () => {
    await expect(p).rejects.toSatisfy(err => err.message === 'fail');
});
`;
            const cleaned = cleanAndDeduplicateTestContent(input);
            expect(cleaned).toContain("expect.extend");
            expect(cleaned).toContain("toSatisfy(received, predicate)");
        });

        test("findTestBlockIntervalByTitle accurately finds full test block spanning nested callbacks", () => {
            const code = `
describe('suite', () => {
  test('complex nested test', async () => {
    const a = 1;
    await expect(p).rejects.toSatisfy((err) => {
      expect(err.code).toBe(500);
      return true;
    });
    expect(a).toBe(1);
  });
});
`;
            const interval = findTestBlockIntervalByTitle(code, "complex nested test");
            expect(interval).not.toBeNull();
            expect(interval.testHeader).toContain("test('complex nested test'");
            expect(interval.testBody).toContain("toSatisfy");
            expect(interval.testBody).toContain("expect(a).toBe(1);");
            expect(interval.testTail.trim()).toBe("});");
        });

        test("updateTestBlockByTitle safely wraps test body without truncating at nested callbacks", () => {
            const code = `
  test('nested test', async () => {
    await expect(p).rejects.toSatisfy((err) => {
      return true;
    });
    expect(1).toBe(1);
  });
`;
            const updated = updateTestBlockByTitle(code, "nested test", (h, b, t) => {
                return `${h}\n    try {\n  ${b.trim()}\n    } catch (err) {\n      expect(err).toBeDefined();\n    }\n  });`;
            });
            expect(updated).toContain("try {");
            expect(updated).toContain("expect(1).toBe(1);");
            expect(updated).toContain("} catch (err) {");
            const ast = parseJavaScriptCode(updated);
            expect(ast.success).toBe(true);
        });
    });

    describe("findAssociatedTestFile", () => {
        test("does not match unrelated test file simply because of same package prefix", () => {
            const rootDir = process.cwd();
            const result = findAssociatedTestFile(rootDir, "src/models/document.model.js");
            if (!result.found) {
                expect(result.suggestedFilePath).toContain("document.model.test");
            } else {
                expect(result.filePath).toContain("document.model");
            }
        });
    });

    describe("Prisma Mock Hoist & Out-of-Scope Variable Invariants", () => {
        test("injects Prisma mock with mockSharedPrisma and mockCreatePrismaInstance complying with Jest hoist rules", () => {
            const code = `
const { prisma } = require('../lib/prisma');
describe('user service', () => {
    test('fetches user', async () => {
        expect(true).toBe(true);
    });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).toContain("mockSharedPrisma");
            expect(sanitized).toContain("mockCreatePrismaInstance");
            expect(sanitized).not.toContain("__sharedMockPrisma");
            expect(sanitized).not.toContain("_createPrismaMockInstance");

            // Verify AST parsing
            const ast = parseJavaScriptCode(sanitized);
            expect(ast.success).toBe(true);
        });

        test("does NOT inject duplicate universal mock when @prisma/client is already mocked with double quotes", () => {
            const code = `
jest.mock("@prisma/client", () => {
  const mPrisma = {
    food: { findUnique: jest.fn() }
  };
  return { PrismaClient: jest.fn(() => mPrisma) };
});
const prisma = new PrismaClient();
describe('cart controller', () => {
    test('works', () => { expect(prisma).toBeDefined(); });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code);
            expect(sanitized).not.toContain("Universal Prisma Mock");
            expect(sanitized).not.toContain("mockSharedPrisma");
            expect(sanitized).toContain('jest.mock("@prisma/client"');

            const ast = parseJavaScriptCode(sanitized);
            expect(ast.success).toBe(true);
        });

        test("heals legacy __sharedMockPrisma to mockSharedPrisma in existing test content", () => {
            const legacyCode = `
const _createPrismaMockInstance = () => ({});
const __sharedMockPrisma = _createPrismaMockInstance();
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => __sharedMockPrisma) }));
describe('legacy suite', () => {
    test('ok', () => { expect(__sharedMockPrisma).toBeDefined(); });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(legacyCode);
            expect(sanitized).toContain("mockSharedPrisma");
            expect(sanitized).toContain("mockCreatePrismaInstance");
            expect(sanitized).not.toContain("__sharedMockPrisma");
            expect(sanitized).not.toContain("_createPrismaMockInstance");

            const ast = parseJavaScriptCode(sanitized);
            expect(ast.success).toBe(true);
        });
    });

    describe("Bull Queue Mock & Virtual Mock Invariants", () => {
        test("purges false-positive Bull mocks and wire logic when test file does not import Bull", () => {
            const code = `
var mockImplementation = (typeof jest !== 'undefined' ? jest.fn() : {});
jest.mock('bull', () => {
  const MockBull = jest.fn().mockImplementation(() => ({
    process: (typeof mockProcess !== 'undefined' ? mockProcess : jest.fn()),
    on: (typeof mockOn !== 'undefined' ? mockOn : jest.fn()),
    add: (typeof mockAdd !== 'undefined' ? mockAdd : jest.fn(() => Promise.resolve({ id: '1' }))),
    getWaitingCount: (typeof mockGetWaitingCount !== 'undefined' ? mockGetWaitingCount : jest.fn(() => Promise.resolve(0))),
    getActiveCount: (typeof mockGetActiveCount !== 'undefined' ? mockGetActiveCount : jest.fn(() => Promise.resolve(0))),
    getCompletedCount: (typeof mockGetCompletedCount !== 'undefined' ? mockGetCompletedCount : jest.fn(() => Promise.resolve(0))),
    getFailedCount: (typeof mockGetFailedCount !== 'undefined' ? mockGetFailedCount : jest.fn(() => Promise.resolve(0))),
    getDelayedCount: (typeof mockGetDelayedCount !== 'undefined' ? mockGetDelayedCount : jest.fn(() => Promise.resolve(0))),
    close: (typeof mockClose !== 'undefined' ? mockClose : jest.fn(() => Promise.resolve())),
  }));
  MockBull.prototype.process = (typeof mockProcess !== 'undefined' ? mockProcess : jest.fn());
  MockBull.default = MockBull;
  return MockBull;
});
var mockProcess = typeof jest !== 'undefined' ? jest.fn() : (() => {});
var mockOn = typeof jest !== 'undefined' ? jest.fn() : (() => {});

describe("Cart Controller Unit Tests", () => {
  let req, res;
  beforeEach(() => {
    req = { body: {} };
    res = { json: jest.fn().mockReturnThis() };
    jest.clearAllMocks();
    if (typeof Bull !== 'undefined' && Bull) {
      if (!Bull.default) Bull.default = Bull;
      if (typeof mockProcess !== 'undefined') Bull.prototype.process = mockProcess;
    }
    if (typeof analysisQueue !== 'undefined' && analysisQueue) {
      if (typeof mockProcess !== 'undefined') analysisQueue.process = mockProcess;
    }
  });

  it("should validate cart items", () => {
    expect(res.json).toBeDefined();
  });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code, "", "cartController.test.js");
            expect(sanitized).not.toContain("jest.mock('bull'");
            expect(sanitized).not.toContain("var mockImplementation");
            expect(sanitized).not.toContain("var mockProcess");
            expect(sanitized).not.toContain("analysisQueue.process = mockProcess");
            expect(sanitized).toContain("Cart Controller Unit Tests");
            expect(sanitized).toContain("jest.clearAllMocks();");

            const ast = parseJavaScriptCode(sanitized);
            expect(ast.success).toBe(true);
        });

        test("does NOT hoist Jest mock methods like .mockImplementation as variable declarations", () => {
            const code = `
jest.mock('./paymentService', () => ({
  charge: jest.fn().mockImplementation(() => ({ success: true })),
  refund: jest.fn().mockReturnValue(true)
}));
describe("payment tests", () => {
  it("charges successfully", () => { expect(true).toBe(true); });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code, "", "payment.test.js");
            expect(sanitized).not.toContain("var mockImplementation =");
            expect(sanitized).not.toContain("var mockReturnValue =");

            const ast = parseJavaScriptCode(sanitized);
            expect(ast.success).toBe(true);
        });

        test("ensures Bull mock has { virtual: true } when file legitimately imports Bull", () => {
            const code = `
const Bull = require('bull');
describe("analysis worker job tests", () => {
  it("initializes worker queue", () => {
    const q = new Bull('analysisQueue');
    expect(q).toBeDefined();
  });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(code, "", "analysis.job.test.js");
            expect(sanitized).toContain("jest.mock('bull'");
            expect(sanitized).toContain("{ virtual: true }");

            const ast = parseJavaScriptCode(sanitized);
            expect(ast.success).toBe(true);
        });

        test("heals corrupted jest.mock('bull', (, { virtual: true }); => { syntax error", () => {
            const corrupted = `
const Bull = require('bull');
jest.mock('bull', (, { virtual: true }); => {
  const MockBull = jest.fn().mockImplementation(() => ({
    process: jest.fn(),
    close: jest.fn(() => Promise.resolve()),
  }));
  return MockBull;
}, { virtual: true });
describe("worker tests", () => {
  it("processes queue", () => {
    expect(true).toBe(true);
  });
});
`;
            const sanitized = cleanAndDeduplicateTestContent(corrupted, "", "tests/worker.test.js");
            expect(sanitized).not.toContain("(, { virtual: true }); =>");
            expect(sanitized).toContain("jest.mock('bull', () => {");
            const ast = parseJavaScriptCode(sanitized);
            expect(ast.success).toBe(true);
        });

        test("ensureJestMockVirtualOption safely adds virtual option without truncating at nested callbacks", () => {
            const input = `
jest.mock('bull', () => ({
  process: jest.fn((cb) => { return cb({ id: '1' }); }),
  close: jest.fn(() => Promise.resolve())
}));
`;
            const result = ensureJestMockVirtualOption(input, "bull");
            expect(result).toContain("jest.mock('bull', () => ({");
            expect(result).toContain("{ virtual: true }");
            const ast = parseJavaScriptCode(result);
            expect(ast.success).toBe(true);
        });

        test("collapses deeply nested analysisQueue assertions and remains idempotent across multiple runs", () => {
            let nested = `
describe("worker shutdown", () => {
  it("closes queue", () => {
    if (typeof analysisQueue !== 'undefined' && analysisQueue.close && analysisQueue.close.mock && analysisQueue.close.mock.calls.length > 0) { if (typeof analysisQueue !== 'undefined' && analysisQueue.close && analysisQueue.close.mock && analysisQueue.close.mock.calls.length > 0) { if (typeof analysisQueue !== 'undefined' && analysisQueue.close && analysisQueue.close.mock && analysisQueue.close.mock.calls.length > 0) { expect(analysisQueue.close).toHaveBeenCalled(); } else { expect(exitSpy).toHaveBeenCalledWith(0); } } else { expect(exitSpy).toHaveBeenCalledWith(0); } } else { expect(exitSpy).toHaveBeenCalledWith(0); }
  });
});
`;
            const pass1 = cleanAndDeduplicateTestContent(nested, "", "tests/worker.test.js");
            // Should collapse to single if
            const occurrences1 = (pass1.match(/if \(typeof analysisQueue !== 'undefined'/g) || []).length;
            expect(occurrences1).toBe(1);

            // Run pass 2 on pass 1 output - must remain idempotent and not re-nest
            const pass2 = cleanAndDeduplicateTestContent(pass1, "", "tests/worker.test.js");
            const occurrences2 = (pass2.match(/if \(typeof analysisQueue !== 'undefined'/g) || []).length;
            expect(occurrences2).toBe(1);

            const ast = parseJavaScriptCode(pass2);
            expect(ast.success).toBe(true);
        });

        test("collapses repeated message objects in ai.service tests and preserves idempotency", () => {
            const repeated = `
const { chatWithAI } = require('../../src/services/ai.service');
describe("ai chat", () => {
  it("chats", async () => {
    axios.create().post.mockResolvedValueOnce({
      data: {
        message: { content: 'Rewrite' }, message: { content: 'Rewrite' }, message: { content: 'Rewrite' }, choices: [{ message: { content: 'Rewrite' } }]
      }
    });
  });
});
`;
            const pass1 = cleanAndDeduplicateTestContent(repeated, "", "tests/services/ai.service.test.js");
            expect(pass1).not.toContain("message: { content: 'Rewrite' }, message: { content: 'Rewrite' }");
            const pass2 = cleanAndDeduplicateTestContent(pass1, "", "tests/services/ai.service.test.js");
            expect(pass2).toEqual(pass1);
            const ast = parseJavaScriptCode(pass2);
            expect(ast.success).toBe(true);
        });

        test("compresses excessive consecutive blank lines down to at most two", () => {
            const codeWithBlankLines = `
const a = 1;




const b = 2;
`;
            const cleaned = cleanAndDeduplicateTestContent(codeWithBlankLines, "", "test.js");
            expect(cleaned).not.toContain("\n\n\n");
            expect(cleaned).toContain("\n\nconst b = 2;");
        });
    });

    describe("healImportPathsInTestCode with jest.doMock", () => {
        test("heals storage paths inside jest.doMock and jest.dontMock", () => {
            const input = `
jest.doMock('../storage/projects/p1/github/123/repo/src/config', () => ({}));
jest.dontMock('../storage/projects/p1/github/123/repo/src/utils/logger');
jest.unmock('../storage/projects/p1/github/123/repo/src/models');
`;
            const result = healImportPathsInTestCode(input, "tests/worker.test.js");
            expect(result).toContain("jest.doMock('../src/config'");
            expect(result).toContain("jest.dontMock('../src/utils/logger'");
            expect(result).toContain("jest.unmock('../src/models'");
        });

        test("ensureJestMockVirtualOption works on jest.doMock calls", () => {
            const input = `
jest.doMock('bull', () => ({
  process: jest.fn(),
  close: jest.fn()
}));
`;
            const result = ensureJestMockVirtualOption(input, "bull");
            expect(result).toContain("jest.doMock('bull', () => ({");
            expect(result).toContain("{ virtual: true }");
        });
    });

    describe("models mock healing and balanceTestFileBraces safety", () => {
        test("heals malformed jest.mock('../../src/models') with premature closing brace", () => {
            const brokenMock = `
jest.mock('../../src/models', () => ({
  models: { Requirement: { update: jest.fn() } }
},
    Version: {
      create: jest.fn(() => Promise.resolve({ id: 1 })),
      findByPk: jest.fn(),
      findAll: jest.fn()
    },
    Document: {
      create: jest.fn(() => Promise.resolve({ id: 1 })),
      findByPk: jest.fn(),
      findAll: jest.fn()
    }));
describe('test suite', () => {
  it('works', () => { expect(true).toBe(true); });
});
`;
            const cleaned = cleanAndDeduplicateTestContent(brokenMock, "SyntaxError: Unexpected token, expected \",\" (44:11)", "tests/jobs/analysis.job.test.js");
            expect(cleaned).not.toContain("}, \n    Version:");
            expect(cleaned).toContain("models: {");
            expect(cleaned).toContain("Requirement:");
            expect(cleaned).toContain("Version:");
            expect(cleaned).toContain("Document:");
            const parsed = parseJavaScriptCode(cleaned);
            expect(parsed.success).toBe(true);
        });

        test("heals truncated assertions at EOF", () => {
            const truncatedCode = `
describe('analysis queue', () => {
  test('getQueueStats retrieves counts', async () => {
    const stats = await getQueueStats();
    expect(stats).toEqual({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5
`;
            const cleaned = cleanAndDeduplicateTestContent(truncatedCode, "", "tests/jobs/analysis.job.test.js");
            expect(cleaned).toContain("expect(stats).toEqual({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 });");
            const parsed = parseJavaScriptCode(cleaned);
            expect(parsed.success).toBe(true);
        });

        test("balanceTestFileBraces does not strip valid closing brackets on files with parse errors", () => {
            const codeWithSyntaxError = `
describe('suite', () => {
  test('test', () => {
    const x = @syntax_error@;
    expect(1).toBe(1);
  });
});
`;
            const result = balanceTestFileBraces(codeWithSyntaxError);
            expect(result.trim()).toContain("});");
            expect(result).toContain("describe('suite', () => {");
        });

        test("decouples glued inline imports and removes jest from @jest/globals", () => {
            const gluedCode = `jest.mock('../../../src/handlers/search.handler.ts', () => mockStub(), { virtual: true });import { describe, test, it, expect, jest } from '@jest/globals';
import { SearchTool } from '../../../src/tools/search.tool';
describe('search', () => {
  it('works', () => { expect(true).toBe(true); });
});`;
            const cleaned = cleanAndDeduplicateTestContent(gluedCode, "", "tests/unit/tools/search.tool.test.ts");
            expect(cleaned).toContain("jest.mock('../../../src/handlers/search.handler.ts', () => mockStub(), { virtual: true });\nimport { describe, test, it, expect } from '@jest/globals';");
            expect(cleaned).not.toContain(", jest }");
            expect(cleaned).not.toContain("{ describe, test, it, expect, jest }");
            expect(cleaned).toContain("// @ts-nocheck");
        });

        test("removes type-only definition virtual mocks cleanly without leaving syntax errors", () => {
            const codeWithTypeMock = `jest.mock('../../../src/handlers/search.handler.ts', () => mockStub(), { virtual: true });
jest.mock('../../../src/types/tool-definition.ts', () => mockStub(), { virtual: true });
import { describe, test, it, expect } from '@jest/globals';
describe('search', () => {
  it('works', () => { expect(true).toBe(true); });
});`;
            const cleaned = cleanAndDeduplicateTestContent(codeWithTypeMock, "", "tests/unit/tools/search.tool.test.ts");
            expect(cleaned).not.toContain("tool-definition.ts");
            expect(cleaned).toContain("search.handler.ts");
        });

        test("converts jest.mock to jest.unstable_mockModule when Jest Native ESM invariant fails", () => {
            const esmCode = `jest.mock('../../../src/handlers/search.handler.ts', () => mockStub(), { virtual: true });
import { describe, test, it, expect } from '@jest/globals';
describe('search', () => {
  it('works', () => { expect(true).toBe(true); });
});`;
            const rawOutput = "● Test suite failed to run\nThere should always be a Jest object already\nat invariant (node_modules/jest-util/build/index.js:774:11)\nat require (tests/unit/tools/search.tool.test.ts:28:104)";
            const cleaned = cleanAndDeduplicateTestContent(esmCode, rawOutput, "tests/unit/tools/search.tool.test.ts");
            expect(cleaned).toContain("jest.unstable_mockModule('../../../src/handlers/search.handler.ts'");
            expect(cleaned).not.toContain("jest.mock(");
        });

        test("heals runaway nested object closing braces in jest.mock and vi.mock factory closures and remains 100% idempotent", () => {
            const codeWithRunawayBraces = `jest.mock('../src/models', () => ({
  initDatabase: jest.fn(() => Promise.resolve()),
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(),
  },
  models: {
    Requirement: { findByPk: jest.fn() },
  },
}
}
}
}
}
}));
vi.mock('../backend/src/config', () => ({
  default: {
    queue: { analysisQueueName: 'test-queue' },
  }
}
}
}
}));
const { describe, it, expect } = require('vitest');
describe('test', () => {
  it('passes', () => expect(true).toBe(true));
});
`;
            let cleaned = codeWithRunawayBraces;
            for (let i = 0; i < 5; i++) {
                cleaned = cleanAndDeduplicateTestContent(cleaned, "", "tests/worker.test.js");
            }
            // Count closing braces inside models mock
            const modelsSection = cleaned.slice(0, cleaned.indexOf("vi.mock"));
            expect(modelsSection.match(/^\}\s*$/gm) || []).toEqual([]);
            expect(cleaned).toContain("models: {\n    Requirement: { findByPk: jest.fn() },\n  },\n}));");
            expect(cleaned).toContain("default: {\n    queue: { analysisQueueName: 'test-queue' },\n  }\n}));");

            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });

        test("heals corrupt duplicate catch clusters and removes orphaned catch blocks outside test functions", () => {
            const corruptedCode = `
describe('evaluator unit tests', () => {
    test('deep runner', async () => {
        try {
            expect(target).toBeDefined();
        } catch (err) {
            expect(err).toBeDefined();
  });

        } catch (err) {
            expect(err).toBeDefined();
        }
    } catch (err) {
            expect(err).toBeDefined();
        }
  });

describe('delta tests', () => {
    test('delta 1', async () => {
        expect(1).toBe(1);
    });
});
`;
            const cleaned = cleanAndDeduplicateTestContent(corruptedCode, "", "tests/utils/evaluator.test.ts");
            expect(cleaned).not.toContain("        } catch (err) {\n            expect(err).toBeDefined();\n        }\n    } catch");
            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });
    });
});


