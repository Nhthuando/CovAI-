import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

import {
    resolveSnapshotRootDir,
    applyCodeToTestFile,
    cleanAndDeduplicateTestContent,
    sanitizeAllProjectTestFiles,
    autoHealTestFailures,
    computeSourceFilesHash,
    verifySourceFilesUnchanged,
    resolveContainerOrHostTestPath,
    replaceBalancedMethodCall,
    insertCodeIntoTestFile,
    applyUnitTestSuggestion
} from "../services/applyTestSuggestion.service.js";

import {
    ensureJestMockVirtualOption,
    ensureAllRelativeJestMocksVirtual,
    healImportPathsInTestCode,
    cleanAndDeduplicateTestContent as sanitizeTestContent
} from "../services/testSanitizer.service.js";

import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { validateGeneratedTestCode, autoRepairTestSyntaxWithAst, validateTestCodeAst } from "../validators/aiTestCode.validator.js";

describe("Unit Test Apply Workflow & System Invariants Suite", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-apply-workflow-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    describe("1. Storage Code Immutability Guard & Workspace Safety", () => {
        test("guarantees source files remain 100% byte-for-byte identical before and after applying tests", () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            const sourceFile = path.join(srcDir, "calculator.js");
            const sourceCode = "export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\n";
            fs.writeFileSync(sourceFile, sourceCode, "utf8");

            const initialHash = computeSourceFilesHash(tempDir);
            expect(initialHash).not.toBeNull();
            expect(initialHash._compositeHash).toBeDefined();

            const suggestion = {
                sourceFile: "src/calculator.js",
                testFile: "tests/calculator.test.js",
                framework: "jest",
                generatedCode: "describe('calculator', () => { test('add', () => expect(add(1, 2)).toBe(3)); });",
                fullUpdatedContent: "describe('calculator', () => { test('add', () => expect(add(1, 2)).toBe(3)); });\n"
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);

            // Verify source file was untouched
            const isUnchanged = verifySourceFilesUnchanged(tempDir, initialHash);
            expect(isUnchanged.intact).toBe(true);
            expect(isUnchanged.changedFiles).toHaveLength(0);
            const currentSource = fs.readFileSync(sourceFile, "utf8");
            expect(currentSource).toBe(sourceCode);
        });

        test("strictly blocks path traversal with '..' segments aiming outside workspace", () => {
            const suggestion = {
                sourceFile: "src/service.js",
                testFile: "../../../etc/passwd.test.js",
                framework: "jest",
                generatedCode: "test('forbidden', () => {});"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow();
        });

        test("strictly rejects attempts to write test code directly into production source directories", () => {
            const suggestion = {
                sourceFile: "src/service.js",
                testFile: "src/service.js",
                framework: "jest",
                generatedCode: "test('forbidden overwrite', () => {});"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow();
        });

        test("strictly rejects attempts to write into environment or package configuration files", () => {
            const forbiddenTargets = [".env", "package.json", "docker-compose.yml", "tsconfig.json"];
            for (const target of forbiddenTargets) {
                expect(() => {
                    applyCodeToTestFile(tempDir, {
                        sourceFile: "src/service.js",
                        testFile: target,
                        framework: "jest",
                        generatedCode: "test('forbidden', () => {});"
                    });
                }).toThrow();
            }
        });
    });

    describe("2. AST Merging & Top-of-File ESM Import Hoisting", () => {
        test("safely merges new tests into an existing test file without duplicating describe blocks", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "auth.test.js");

            const initialContent = `import { describe, it, expect } from '@jest/globals';
describe('Auth Service', () => {
  it('logs in user successfully', () => {
    expect(true).toBe(true);
  });
});
`;
            fs.writeFileSync(testFile, initialContent, "utf8");

            const suggestion = {
                sourceFile: "src/auth.js",
                testFile: "tests/auth.test.js",
                framework: "jest",
                generatedCode: `describe('Auth Service', () => {
  it('rejects invalid password', () => {
    expect(false).toBe(false);
  });
});`
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);

            const merged = fs.readFileSync(testFile, "utf8");
            expect(merged).toContain("logs in user successfully");
            expect(merged).toContain("rejects invalid password");

            const parsed = parseJavaScriptCode(merged);
            expect(parsed.success).toBe(true);
        });

        test("hoists top-level ESM imports before test suites rather than inside blocks", () => {
            const existingContent = `const existingHelper = () => true;
describe('Order Suite', () => {
  it('creates order', () => expect(existingHelper()).toBe(true));
});
`;
            const codeToInsert = `import { calculateTax } from '../src/tax.js';
describe('Order Suite', () => {
  it('calculates tax', () => expect(calculateTax(100)).toBe(10));
});
`;
            const merged = insertCodeIntoTestFile(existingContent, codeToInsert);
            expect(merged).toContain("import { calculateTax } from '../src/tax.js';");
            expect(merged).toContain("it('calculates tax'");

            const parsed = parseJavaScriptCode(merged);
            expect(parsed.success).toBe(true);
        });

        test("deduplicates identical require and import statements during merging", () => {
            const code = `
const { format } = require('date-fns');
const { format } = require('date-fns');

describe('suite', () => {
  it('test', () => expect(1).toBe(1));
});
`;
            const cleaned = cleanAndDeduplicateTestContent(code, "", "tests/test.js");
            const occurrences = (cleaned.match(/const\s+\{\s*format\s*\}\s*=\s*require\('date-fns'\)/g) || []).length;
            expect(occurrences).toBe(1);

            const parsed = parseJavaScriptCode(cleaned);
            expect(parsed.success).toBe(true);
        });
    });

    describe("3. Universal RAM Virtual Mock Isolation", () => {
        test("ensures Jest mocks have { virtual: true } to support uninstalled or dynamic modules", () => {
            const code = `
jest.mock('uninstalled-third-party-package', () => ({
  doSomething: jest.fn(() => true)
}));
jest.mock('../relative/missing/service', () => ({
  fetchData: jest.fn()
}));
`;
            const withVirtual = ensureJestMockVirtualOption(code, 'uninstalled-third-party-package');
            expect(withVirtual).toContain("{ virtual: true }");

            const relVirtual = ensureAllRelativeJestMocksVirtual(withVirtual);
            expect(relVirtual).toContain("{ virtual: true }");

            const parsed = parseJavaScriptCode(relVirtual);
            expect(parsed.success).toBe(true);
        });

        test("auto-injects universal virtual mocks for common missing third-party packages in RAM", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "notification.test.js");

            fs.writeFileSync(testFile, `
describe('Notification', () => {
  it('triggers toast', () => {
    toast.success('Done');
    expect(true).toBe(true);
  });
});
`, "utf8");

            const rawRunnerOutput = "Error: Cannot find package 'sonner' imported from tests/notification.test.js";
            const healed = autoHealTestFailures(tempDir, ["tests/notification.test.js"], null, rawRunnerOutput);
            expect(healed).toBe(true);

            const updatedContent = fs.readFileSync(testFile, "utf8");
            expect(updatedContent).toContain("jest.mock('sonner'");
            expect(updatedContent).toContain("{ virtual: true }");
            expect(updatedContent).toContain("toast:");

            const parsed = parseJavaScriptCode(updatedContent);
            expect(parsed.success).toBe(true);
        });
    });

    describe("4. TDZ Sanitization & Self-Assignment Healing", () => {
        test("heals Node.js built-in self-assignments into proper CommonJS require statements", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "fsUtils.test.js");

            fs.writeFileSync(testFile, `
const path = path;
const fs = fs;
describe('file utils', () => {
  it('reads directory', () => {
    expect(path.join('a', 'b')).toBe('a/b');
  });
});
`, "utf8");

            const rawOutput = "ReferenceError: Cannot access 'path' before initialization\n    at tests/fsUtils.test.js:2:14";
            const healed = autoHealTestFailures(tempDir, ["tests/fsUtils.test.js"], null, rawOutput);
            expect(healed).toBe(true);

            const updated = fs.readFileSync(testFile, "utf8");
            expect(updated).not.toContain("const path = path;");
            expect(updated).toContain("const path = require('path');");

            const parsed = parseJavaScriptCode(updated);
            expect(parsed.success).toBe(true);
        });

        test("strips user-defined self-assignments that trigger Temporal Dead Zone errors", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "userModule.test.js");

            fs.writeFileSync(testFile, `
const customUserData = customUserData;
describe('user test', () => {
  it('checks user', () => {
    expect(true).toBe(true);
  });
});
`, "utf8");

            const rawOutput = "ReferenceError: Cannot access 'customUserData' before initialization";
            const healed = autoHealTestFailures(tempDir, ["tests/userModule.test.js"], null, rawOutput);
            expect(healed).toBe(true);

            const updated = fs.readFileSync(testFile, "utf8");
            expect(updated).not.toContain("const customUserData = customUserData;");

            const parsed = parseJavaScriptCode(updated);
            expect(parsed.success).toBe(true);
        });
    });

    describe("5. Thenable Proxy Deadlock Prevention", () => {
        test("dynamic mock proxy handler returns undefined for 'then' and 'catch' to prevent runner hangs", async () => {
            const createSafeMockProxy = () => {
                const target = {
                    name: "SafeProxyMock",
                    execute: jest.fn(() => Promise.resolve({ success: true }))
                };
                return new Proxy(target, {
                    get(t, prop) {
                        if (prop === "then" || prop === "catch" || prop === "finally" || typeof prop === "symbol") {
                            return undefined;
                        }
                        if (prop in t) {
                            return t[prop];
                        }
                        return jest.fn();
                    }
                });
            };

            const proxy = createSafeMockProxy();
            expect(proxy.then).toBeUndefined();
            expect(proxy.catch).toBeUndefined();
            expect(proxy.finally).toBeUndefined();

            // Promise.resolve on a thenable proxy can hang if .then returns another proxy or function.
            // With Thenable deadlock prevention, it resolves immediately to the proxy itself.
            const resolved = await Promise.race([
                Promise.resolve(proxy),
                new Promise((_, reject) => setTimeout(() => reject(new Error("DEADLOCK")), 100))
            ]);

            expect(resolved).toBe(proxy);
            expect(resolved.name).toBe("SafeProxyMock");
        });
    });

    describe("6. Balanced Parenthesis Assertion Mutation & Zero-Argument Token Sanitization", () => {
        test("safely mutates assertions containing nested parentheses and complex arguments without truncating", () => {
            const line = "      expect(transformer.process({ nested: fn(1, 2) })).toEqual(expect.objectContaining({ valid: true }));";
            const mutated = replaceBalancedMethodCall(line, ["toEqual", "toStrictEqual"], ".toBeDefined()");
            expect(mutated).toBe("      expect(transformer.process({ nested: fn(1, 2) })).toBeDefined();");
            expect(mutated).not.toContain("objectContaining");
        });

        test("sanitizes trailing orphaned fragments after zero-argument assertions like .toBeDefined()", () => {
            const corruptedCode = `
describe('widget', () => {
  it('renders widget', () => {
    expect(getWidget(id)).toBeDefined() item$/');
    expect(getTitle()).toBeUndefined() extraRandomGarbage);
  });
});
`;
            const healed = sanitizeTestContent(corruptedCode, "", "tests/widget.test.js");
            expect(healed).toContain("expect(getWidget(id)).toBeDefined();");
            expect(healed).toContain("expect(getTitle()).toBeUndefined();");
            expect(healed).not.toContain("item$/'");
            expect(healed).not.toContain("extraRandomGarbage");

            const parsed = parseJavaScriptCode(healed);
            expect(parsed.success).toBe(true);
        });
    });

    describe("7. Test Unskipping Activation (allowUnskip: true)", () => {
        test("converts it.skip, test.skip, xit, xtest into active tests when allowUnskip is enabled", () => {
            const skippedCode = `
describe('Skipped Suite', () => {
  it.skip('first test', () => expect(1).toBe(1));
  test.skip('second test', () => expect(2).toBe(2));
  xit('third test', () => expect(3).toBe(3));
  xtest('fourth test', () => expect(4).toBe(4));
  describe.skip('skipped subsuite', () => {
    it('inner', () => expect(5).toBe(5));
  });
});
`;
            const unskipped = sanitizeTestContent(skippedCode, "", "tests/skipped.test.js", { allowUnskip: true });
            expect(unskipped).not.toMatch(/\b(?:test|it|describe)\.skip\s*\(/);
            expect(unskipped).not.toMatch(/\b(?:xit|xtest|xdescribe)\s*\(/);

            expect(unskipped).toContain("it('first test'");
            expect(unskipped).toContain("test('second test'");
            expect(unskipped).toContain("it('third test'");
            expect(unskipped).toContain("test('fourth test'");
            expect(unskipped).toContain("describe('skipped subsuite'");

            const parsed = parseJavaScriptCode(unskipped);
            expect(parsed.success).toBe(true);
        });

        test("preserves skipped tests intact when allowUnskip is omitted or false", () => {
            const skippedCode = `
describe('Skipped Suite', () => {
  it.skip('preserved skip', () => expect(1).toBe(1));
});
`;
            const preserved = sanitizeTestContent(skippedCode, "", "tests/preserved.test.js", { allowUnskip: false });
            expect(preserved).toContain("it.skip('preserved skip'");
        });
    });

    describe("8. Container Path Mapping & Auto-Healing Resilience", () => {
        test("maps container paths (/app/repo/...) accurately to host paths", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const hostTestFile = path.join(testDir, "auth.test.js");
            fs.writeFileSync(hostTestFile, "// test content\n", "utf8");

            const containerPath = "/app/repo/tests/auth.test.js";
            const resolved = resolveContainerOrHostTestPath(containerPath, tempDir);
            expect(resolved).toBe(hostTestFile);
            expect(fs.existsSync(resolved)).toBe(true);
        });

        test("autoHealTestFailures repairs unclosed delimiters and syntax errors automatically", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "syntax.test.js");

            // Deliberately unclosed describe block
            fs.writeFileSync(testFile, `
describe('Unclosed Block', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2);
`, "utf8");

            const rawOutput = "SyntaxError: Unexpected end of input in tests/syntax.test.js";
            const healed = autoHealTestFailures(tempDir, ["tests/syntax.test.js"], null, rawOutput);
            expect(healed).toBe(true);

            const updatedContent = fs.readFileSync(testFile, "utf8");
            const parsed = parseJavaScriptCode(updatedContent);
            expect(parsed.success).toBe(true);
        });
    });
});
