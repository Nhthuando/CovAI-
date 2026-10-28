import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";
import {
    applyCodeToTestFile,
    insertCodeIntoTestFile,
    sanitizeSuggestedTestCode
} from "../services/applyTestSuggestion.service.js";
import {
    cleanAndDeduplicateTestContent,
    healMismatchedQuotes,
    healMultilineStrings,
    healImportPathsInTestCode,
    sanitizeAllProjectTestFiles
} from "../services/testSanitizer.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { ServiceError } from "../utils/serviceError.js";

describe("Phase 4: Safe Apply & AST Sanitization", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase4-safe-apply-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { }
    });

    describe("4.1 Safe Apply Strategy (Create New vs Merge & Append)", () => {
        describe("Case 1: New test file creation", () => {
            test("creates complete test file with runner imports, source import, and describe block", () => {
                const srcDir = path.join(tempDir, "src", "services");
                fs.mkdirSync(srcDir, { recursive: true });
                const srcFile = path.join(srcDir, "order.service.js");
                fs.writeFileSync(srcFile, "export const processOrder = (id) => ({ id, status: 'processed' });", "utf8");

                const suggestion = {
                    sourceFile: "src/services/order.service.js",
                    testFile: "src/tests/order.service.test.js",
                    framework: "jest",
                    generatedCode: `describe('OrderService', () => {
  test('processes valid order', () => {
    expect(processOrder(123)).toEqual({ id: 123, status: 'processed' });
  });
});`
                };

                const result = applyCodeToTestFile(tempDir, suggestion);
                expect(result.changed).toBe(true);
                expect(result.targetTestFile).toBe("src/tests/order.service.test.js");

                const writtenPath = path.join(tempDir, "src", "tests", "order.service.test.js");
                expect(fs.existsSync(writtenPath)).toBe(true);
                const content = fs.readFileSync(writtenPath, "utf8");

                // Verifies runner imports or module import are present
                expect(content).toContain("order.service");
                expect(content).toContain("describe('OrderService'");
                expect(content).toContain("test('processes valid order'");

                // Verifies AST validity with Babel parser
                const ast = parseJavaScriptCode(content);
                expect(ast).not.toBeNull();
                expect(ast.success).toBe(true);
            });

            test("creates test file in tests/ when target uses tests/ directory", () => {
                const suggestion = {
                    sourceFile: "src/handlers/auth.handler.js",
                    testFile: "tests/auth.handler.test.ts",
                    framework: "vitest",
                    generatedCode: `import { describe, it, expect } from 'vitest';
describe('AuthHandler', () => {
  it('authenticates valid token', () => {
    expect(true).toBe(true);
  });
});`
                };

                const result = applyCodeToTestFile(tempDir, suggestion);
                expect(result.changed).toBe(true);
                const writtenPath = path.join(tempDir, "tests", "auth.handler.test.ts");
                expect(fs.existsSync(writtenPath)).toBe(true);
                const content = fs.readFileSync(writtenPath, "utf8");
                expect(content).toContain("describe('AuthHandler'");
            });
        });

        describe("Case 2: Existing test file merge and append", () => {
            test("preserves existing tests, extracts and hoists new imports, and appends new tests", () => {
                const testDir = path.join(tempDir, "tests");
                fs.mkdirSync(testDir, { recursive: true });
                const existingFile = path.join(testDir, "order.service.test.js");
                const existingContent = `const { processOrder } = require('../src/services/order.service');

describe('OrderService Baseline', () => {
  it('handles existing basic order', () => {
    expect(processOrder(1)).toBeDefined();
  });
});
`;
                fs.writeFileSync(existingFile, existingContent, "utf8");

                const suggestion = {
                    sourceFile: "src/services/order.service.js",
                    testFile: "tests/order.service.test.js",
                    framework: "jest",
                    generatedCode: `const { processOrder, cancelOrder } = require('../src/services/order.service');
const { auditLogger } = require('../src/utils/logger');

describe('OrderService - Extended Coverage', () => {
  it('cancels pending order when stock is zero', () => {
    expect(cancelOrder).toBeDefined();
  });
});`
                };

                const result = applyCodeToTestFile(tempDir, suggestion);
                expect(result.changed).toBe(true);

                const updated = fs.readFileSync(existingFile, "utf8");

                // 1. Existing user tests are 100% preserved
                expect(updated).toContain("describe('OrderService Baseline'");
                expect(updated).toContain("it('handles existing basic order'");

                // 2. New imports hoisted before test blocks
                expect(updated).toContain("auditLogger");
                expect(updated).toContain("cancelOrder");

                // 3. Deduplication: processOrder is not declared twice with const
                const declCount = (updated.match(/const\s+\{[^}]*processOrder[^}]*\}\s*=/g) || []).length;
                expect(declCount).toBe(1);

                // 4. New describe block appended
                expect(updated).toContain("describe('OrderService - Extended Coverage'");
                expect(updated).toContain("it('cancels pending order when stock is zero'");

                // 5. AST is clean and valid
                const ast = parseJavaScriptCode(updated);
                expect(ast).not.toBeNull();
                expect(ast.success).toBe(true);
            });

            test("renames incoming describe block to '${title} - Additional Coverage' when titles collide", () => {
                const testDir = path.join(tempDir, "tests");
                fs.mkdirSync(testDir, { recursive: true });
                const existingFile = path.join(testDir, "payment.test.js");
                const existingContent = `describe('PaymentService', () => {
  test('charges card successfully', () => {
    expect(1).toBe(1);
  });
});
`;
                fs.writeFileSync(existingFile, existingContent, "utf8");

                const suggestion = {
                    sourceFile: "src/services/payment.service.js",
                    testFile: "tests/payment.test.js",
                    framework: "jest",
                    generatedCode: `describe('PaymentService', () => {
  test('handles card decline edge case', () => {
    expect(2).toBe(2);
  });
});`
                };

                const result = applyCodeToTestFile(tempDir, suggestion);
                expect(result.changed).toBe(true);

                const content = fs.readFileSync(existingFile, "utf8");

                // Original test remains intact
                expect(content).toContain("test('charges card successfully'");

                // Colliding describe block safely renamed to '- Additional Coverage'
                expect(content).toContain("describe('PaymentService - Additional Coverage'");
                expect(content).toContain("test('handles card decline edge case'");

                const ast = parseJavaScriptCode(content);
                expect(ast).not.toBeNull();
                expect(ast.success).toBe(true);
            });

            test("deduplicates identical repeated suggestions without bloating file", () => {
                const testDir = path.join(tempDir, "tests");
                fs.mkdirSync(testDir, { recursive: true });
                const existingFile = path.join(testDir, "idem.test.js");
                const block = `describe('Idempotency', () => {\n  test('runs once', () => expect(true).toBe(true));\n});`;
                fs.writeFileSync(existingFile, block + "\n", "utf8");

                const suggestion = {
                    sourceFile: "src/idem.js",
                    testFile: "tests/idem.test.js",
                    framework: "jest",
                    generatedCode: block
                };

                const result = applyCodeToTestFile(tempDir, suggestion);
                expect(result.changed).toBe(false);
            });
        });
    });

    describe("4.2 AST Sanitizer & Syntax Protection", () => {
        describe("Rule 1: Heal Mismatched Quotes", () => {
            test("heals mismatched backtick and single quote in test titles and assertions", () => {
                const brokenCode = `
it(\`rejects invalid input', async () => {
  expect(val).toBe(\`SUCCESS');
});
describe(\`OrderModule', () => {
  test('handles refund\`, () => {
    expect(res).toEqual('REFUND\`);
  });
});`;
                const healed = healMismatchedQuotes(brokenCode);
                expect(healed).toContain('it("rejects invalid input", async () => {');
                expect(healed).toContain("expect(val).toBe('SUCCESS');");
                expect(healed).toContain('describe("OrderModule", () => {');
                expect(healed).toContain('test("handles refund", () => {');
                expect(healed).toContain("expect(res).toEqual('REFUND');");
            });

            test("heals mismatched double and single quotes", () => {
                const brokenCode = `
test("submits form', () => {
  expect(status).toBe("active');
});
it('renders button", () => {
  expect(visible).toEqual('yes");
});`;
                const healed = healMismatchedQuotes(brokenCode);
                expect(healed).toContain('test("submits form", () => {');
                expect(healed).toContain("expect(status).toBe('active');");
                expect(healed).toContain('it("renders button", () => {');
                expect(healed).toContain("expect(visible).toEqual('yes');");
            });
        });

        describe("Rule 2: Heal Multiline Strings", () => {
            test("converts single-quoted multiline string with unescaped newline into template literal", () => {
                const multilineCode = "const query = 'SELECT *\nFROM users\nWHERE id = 1';";
                const healed = healMultilineStrings(multilineCode);
                expect(healed).toBe("const query = `SELECT *\nFROM users\nWHERE id = 1`;");
            });

            test("converts double-quoted multiline string into template literal", () => {
                const multilineCode = 'const doc = "First line\nSecond line";';
                const healed = healMultilineStrings(multilineCode);
                expect(healed).toBe('const doc = `First line\nSecond line`;');
            });

            test("protects English comments with apostrophes and regex literals", () => {
                const codeWithComments = `
// don't touch this comment and doesn't break
/* can't fail either */
const pattern = /user's input/;
it('works', () => {
  expect(1).toBe(1);
});`;
                const healed = healMultilineStrings(codeWithComments);
                expect(healed).toContain("// don't touch this comment");
                expect(healed).toContain("/user's input/");
                expect(healed).toContain("it('works'");
                const ast = parseJavaScriptCode(healed);
                expect(ast.success).toBe(true);
            });
        });

        describe("Rule 3: Orphan Mock Protection", () => {
            test("removes broken cut-off mock fragments while keeping valid statement boundaries", () => {
                const brokenSnippet = `
const path = require('path');

create: jest.fn(() => ({ post: jest.fn() }))
  }));

describe('Valid Suite', () => {
  test('executes clean', () => {
    expect(true).toBe(true);
  });
});`;
                const cleaned = cleanAndDeduplicateTestContent(brokenSnippet);
                expect(cleaned).not.toContain("create: jest.fn");
                expect(cleaned).not.toContain("}));");
                expect(cleaned).toContain("describe('Valid Suite'");

                const ast = parseJavaScriptCode(cleaned);
                expect(ast.success).toBe(true);
            });

            test("does not corrupt complete multiline mock declarations", () => {
                const validMockCode = `
const mockService = {
  fetchData: jest.fn().mockResolvedValue({ id: 1 }),
  saveData: jest.fn().mockResolvedValue(true)
};

describe('Service Mocking', () => {
  it('mocks correctly', async () => {
    const res = await mockService.fetchData();
    expect(res.id).toBe(1);
  });
});`;
                const cleaned = cleanAndDeduplicateTestContent(validMockCode);
                expect(cleaned).toContain("fetchData: jest.fn()");
                expect(cleaned).toContain("saveData: jest.fn()");
                const ast = parseJavaScriptCode(cleaned);
                expect(ast.success).toBe(true);
            });
        });

        describe("Rule 4: Heal Unclosed Object Literals", () => {
            test("heals unclosed object literals that abruptly encounter expect statements", () => {
                const brokenObject = `
const { getUser } = require('../services/user');
describe('User', () => {
  it('loads user data', () => {
    const mockUser = {
      id: 1,
      name: 'Alice',
    expect(mockUser.id).toBe(1);
  });
});`;
                const cleaned = cleanAndDeduplicateTestContent(brokenObject);
                expect(cleaned).toContain("};");
                expect(cleaned).toContain("expect(mockUser.id).toBe(1)");

                const ast = parseJavaScriptCode(cleaned);
                expect(ast.success).toBe(true);
            });

            test("heals unclosed top-level object declarations followed by describe blocks", () => {
                const brokenTopLevel = `
const mockClient = {

describe('Client', () => {
  it('connects', () => {
    expect(mockClient.connect).toBeDefined();
  });
});`;
                const cleaned = cleanAndDeduplicateTestContent(brokenTopLevel);
                expect(cleaned).toContain("};");
                expect(cleaned).toContain("describe('Client'");

                const ast = parseJavaScriptCode(cleaned);
                expect(ast.success).toBe(true);
            });
        });

        describe("Rule 5: Strict Storage Guard", () => {
            test("rejects attempts to modify storage directory directly", () => {
                const suggestion = {
                    sourceFile: "src/auth.js",
                    testFile: "storage/projects/hack.test.js",
                    generatedCode: "test('hack', () => {});"
                };

                expect(() => applyCodeToTestFile(tempDir, suggestion)).toThrow(
                    /Strict Storage Guard|forbidden/i
                );
            });

            test("rejects path traversal attempts outside rootDir", () => {
                const suggestion = {
                    sourceFile: "src/auth.js",
                    testFile: "../../outside.test.js",
                    generatedCode: "test('outside', () => {});"
                };

                expect(() => applyCodeToTestFile(tempDir, suggestion)).toThrow(
                    /Path traversal forbidden/i
                );
            });

            test("sanitizeAllProjectTestFiles ignores storage directories", () => {
                const storageSubDir = path.join(tempDir, "storage", "projects", "fake");
                fs.mkdirSync(storageSubDir, { recursive: true });
                const secretFile = path.join(storageSubDir, "protected.test.js");
                const initialContent = "// Protected storage content - must not be modified";
                fs.writeFileSync(secretFile, initialContent, "utf8");

                // Run sanitizeAllProjectTestFiles on tempDir
                sanitizeAllProjectTestFiles(tempDir);

                // Verify file inside storage was never touched
                const contentAfter = fs.readFileSync(secretFile, "utf8");
                expect(contentAfter).toBe(initialContent);
            });

            test("allows applyCodeToTestFile when rootDir is a valid project repo inside storage (e.g. storage/projects/p1/github/123/repo)", () => {
                const repoDir = path.join(tempDir, "storage", "projects", "p1", "github", "123", "repo");
                fs.mkdirSync(path.join(repoDir, "tests"), { recursive: true });

                const suggestion = {
                    sourceFile: "src/auth.js",
                    testFile: "tests/auth.test.js",
                    generatedCode: "describe('auth in storage repo', () => { test('works', () => { expect(1).toBe(1); }); });"
                };

                const result = applyCodeToTestFile(repoDir, suggestion);
                expect(result.changed).toBe(true);
                expect(result.targetTestFile).toBe("tests/auth.test.js");
                expect(fs.existsSync(path.join(repoDir, "tests/auth.test.js"))).toBe(true);
                expect(fs.readFileSync(path.join(repoDir, "tests/auth.test.js"), "utf8")).toContain("auth in storage repo");
            });

            test("allows applyCodeToTestFile when testFile is an absolute path within the storage repo", () => {
                const repoDir = path.join(tempDir, "storage", "projects", "p1", "github", "123", "repo");
                const absTestFile = path.join(repoDir, "tests", "abs-auth.test.js");

                const suggestion = {
                    sourceFile: "src/auth.js",
                    testFile: absTestFile,
                    generatedCode: "describe('abs test in storage repo', () => { test('ok', () => {}); });"
                };

                const result = applyCodeToTestFile(repoDir, suggestion);
                expect(result.changed).toBe(true);
                expect(result.targetTestFile).toBe("tests/abs-auth.test.js");
                expect(fs.existsSync(absTestFile)).toBe(true);
            });

            test("rejects applyCodeToTestFile when rootDir is a raw storage directory", () => {
                const rawStorageDir = path.join(tempDir, "storage", "projects", "fake-raw");
                fs.mkdirSync(rawStorageDir, { recursive: true });

                const suggestion = {
                    sourceFile: "src/auth.js",
                    testFile: "tests/auth.test.js",
                    generatedCode: "test('fail', () => {});"
                };

                expect(() => applyCodeToTestFile(rawStorageDir, suggestion)).toThrow(
                    /Strict Storage Guard|forbidden/i
                );
            });
        });
    });
});
