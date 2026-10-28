import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, it, expect, beforeEach, afterEach } from "@jest/globals";
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

describe("Phase 3: Hoàn Thiện Cơ Chế Safe Apply & AST Sanitizer", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase3-safe-apply-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { }
    });

    describe("3.1 Chiến Lược Áp Dụng: Tạo Mới Test File (Case 1: New Test File)", () => {
        test("tạo mới file test hoàn chỉnh với runner imports, module import và mock contract", () => {
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            const srcFile = path.join(srcDir, "billing.service.js");
            fs.writeFileSync(srcFile, "export function generateInvoice(order) { return { id: order.id, total: 100 }; }", "utf8");

            const suggestion = {
                sourceFile: "src/services/billing.service.js",
                testFile: "src/tests/billing.service.test.js",
                framework: "jest",
                generatedCode: `describe('BillingService', () => {
  test('generates valid invoice for customer', () => {
    const res = generateInvoice({ id: 1 });
    expect(res.total).toBe(100);
  });
});`
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);
            expect(result.targetTestFile).toBe("src/tests/billing.service.test.js");

            const writtenPath = path.join(tempDir, "src", "tests", "billing.service.test.js");
            expect(fs.existsSync(writtenPath)).toBe(true);
            const content = fs.readFileSync(writtenPath, "utf8");

            // Kiểm tra import module nguồn và describe block
            expect(content).toContain("billing.service");
            expect(content).toContain("describe('BillingService'");
            expect(content).toContain("test('generates valid invoice for customer'");

            // Xác minh AST hợp lệ 100% bằng Babel parser (0 syntax error)
            const ast = parseJavaScriptCode(content);
            expect(ast.success).toBe(true);
        });

        test("tạo mới file test Vitest với ESM runner import chuẩn", () => {
            const suggestion = {
                sourceFile: "src/utils/math.js",
                testFile: "tests/math.test.js",
                framework: "vitest",
                generatedCode: `describe('MathUtils', () => {
  it('calculates sum', () => {
    expect(1 + 1).toBe(2);
  });
});`
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);

            const writtenPath = path.join(tempDir, "tests", "math.test.js");
            const content = fs.readFileSync(writtenPath, "utf8");
            expect(content).toContain("import { describe, it, test, expect");
            expect(content).toContain("from 'vitest'");
            expect(content).toContain("describe('MathUtils'");

            const ast = parseJavaScriptCode(content);
            expect(ast.success).toBe(true);
        });
    });

    describe("3.2 Chiến Lược Hợp Nhất & Khử Trùng Lặp (Case 2: Merge & Deduplicate)", () => {
        test("bảo tồn 100% test cũ của người dùng, hoist imports/mocks lên đầu file, và append test mới", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "user.service.test.js");

            const initialUserContent = `const { getUserById } = require('../src/services/user.service');

describe('UserService - Original Suite', () => {
  it('fetches existing user by ID', () => {
    expect(getUserById(1)).toBeDefined();
  });
});
`;
            fs.writeFileSync(testFile, initialUserContent, "utf8");

            const incomingCode = `const { getUserById, deleteUser } = require('../src/services/user.service');
const { auditLog } = require('../src/utils/audit');
jest.mock('axios', () => ({ get: jest.fn(() => Promise.resolve({ data: {} })) }));
process.env.API_URL = 'http://localhost';

describe('UserService - Additional Delta Coverage', () => {
  it('deletes user cleanly', () => {
    expect(deleteUser).toBeDefined();
  });
});`;

            const suggestion = {
                sourceFile: "src/services/user.service.js",
                testFile: "tests/user.service.test.js",
                framework: "jest",
                generatedCode: incomingCode
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);

            const mergedContent = fs.readFileSync(testFile, "utf8");

            // 1. Bảo tồn 100% test cũ của người dùng
            expect(mergedContent).toContain("describe('UserService - Original Suite'");
            expect(mergedContent).toContain("it('fetches existing user by ID'");

            // 2. Hoist import và mock lên trước describe block đầu tiên
            const firstDescribeIdx = mergedContent.indexOf("describe('UserService - Original Suite'");
            const axiosMockIdx = mergedContent.indexOf("jest.mock('axios'");
            const auditLogIdx = mergedContent.indexOf("auditLog");
            expect(axiosMockIdx).toBeLessThan(firstDescribeIdx);
            expect(auditLogIdx).toBeLessThan(firstDescribeIdx);

            // 3. Khử trùng lặp destructuring require: getUserById không bị khai báo trùng
            const declCount = (mergedContent.match(/getUserById/g) || []).length;
            expect(declCount).toBeGreaterThanOrEqual(1);
            // Không có 2 câu lệnh const khai báo lại cùng biến
            expect(mergedContent).not.toMatch(/const\s+\{\s*getUserById\s*\}\s*=\s*require[\s\S]*const\s+\{\s*getUserById/);

            // 4. Nối khối describe mới vào cuối file
            expect(mergedContent).toContain("describe('UserService - Additional Delta Coverage'");
            expect(mergedContent).toContain("it('deletes user cleanly'");

            // 5. AST an toàn 100%
            const ast = parseJavaScriptCode(mergedContent);
            expect(ast.success).toBe(true);
        });

        test("tự động đổi tên các khối describe mới nếu trùng tên để tránh ghi đè test cũ (hỗ trợ cả backtick)", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "auth.test.js");

            const initialContent = `describe('Auth Suite', () => {
  test('logs in user', () => {
    expect(true).toBe(true);
  });
});
`;
            fs.writeFileSync(testFile, initialContent, "utf8");

            // Suggestion 1: Trùng tên describe 'Auth Suite'
            const suggestion1 = {
                sourceFile: "src/auth.js",
                testFile: "tests/auth.test.js",
                framework: "jest",
                generatedCode: `describe('Auth Suite', () => {
  test('handles invalid password', () => {
    expect(false).toBe(false);
  });
});`
            };

            applyCodeToTestFile(tempDir, suggestion1);
            let content = fs.readFileSync(testFile, "utf8");

            expect(content).toContain("describe('Auth Suite'");
            expect(content).toContain("describe('Auth Suite - Additional Coverage'");

            // Suggestion 2: Trùng tên bằng template literal `Auth Suite`
            const suggestion2 = {
                sourceFile: "src/auth.js",
                testFile: "tests/auth.test.js",
                framework: "jest",
                generatedCode: "describe(`Auth Suite`, () => {\n  test('handles lockout', () => expect(1).toBe(1));\n});"
            };

            applyCodeToTestFile(tempDir, suggestion2);
            content = fs.readFileSync(testFile, "utf8");

            // Khối thứ 3 tự động nhận suffix '- Additional Coverage 2'
            expect(content).toContain("describe(`Auth Suite - Additional Coverage 2`");

            const ast = parseJavaScriptCode(content);
            expect(ast.success).toBe(true);
        });

        test("đảm bảo tính lũy thừa (Idempotency): không chèn lặp khi cùng suggestion được apply nhiều lần", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "idempotent.test.js");

            const codeSnippet = `describe('Idempotent Module', () => {
  test('runs stably', () => {
    expect(1).toBe(1);
  });
});`;
            fs.writeFileSync(testFile, codeSnippet + "\n", "utf8");

            const suggestion = {
                sourceFile: "src/idempotent.js",
                testFile: "tests/idempotent.test.js",
                framework: "jest",
                generatedCode: codeSnippet
            };

            const firstRun = applyCodeToTestFile(tempDir, suggestion);
            expect(firstRun.changed).toBe(false);

            const content = fs.readFileSync(testFile, "utf8");
            expect(content.trim()).toBe(codeSnippet.trim());
        });
    });

    describe("3.3 Bộ Lọc Cú Pháp AST Sanitizer (Syntax Protection Filters)", () => {
        test("Rule 1: Heal Mismatched Quotes - sửa các cặp nháy lệch do AI sinh ra", () => {
            const mismatched = `
it(\`rejects invalid input', async () => {
  expect(val).toBe(\`OK');
});
describe("AuthModule', () => {
  test('handles token\`, () => {
    expect(token).toEqual("VALID');
  });
});`;
            const healed = healMismatchedQuotes(mismatched);
            expect(healed).toContain('it("rejects invalid input", async () => {');
            expect(healed).toContain("expect(val).toBe('OK');");
            expect(healed).toContain('describe("AuthModule", () => {');
            expect(healed).toContain('test("handles token", () => {');
            expect(healed).toContain("expect(token).toEqual('VALID');");
        });

        test("Rule 2: Heal Multiline Strings - chuyển chuỗi nhiều dòng có newline thành template literals", () => {
            const multiline = "const sql = 'SELECT *\\nFROM orders\\nWHERE status = \"OPEN\"';";
            const multilineCode = "const sql = 'SELECT *\nFROM orders\nWHERE status = \"OPEN\"';";
            const healed = healMultilineStrings(multilineCode);
            expect(healed).toContain("`SELECT *\nFROM orders\nWHERE status = \"OPEN\"`");

            // Bảo vệ comment tiếng Anh có dấu apostrophe không bị biến thành backtick
            const englishComment = `// User's order doesn't have an ID\nconst a = 1;`;
            const healedComment = healMultilineStrings(englishComment);
            expect(healedComment).toContain("// User's order doesn't have an ID");
        });

        test("Rule 3: Orphan Mock Protection - loại bỏ đoạn mock bị cắt xén dở dang cú pháp", () => {
            const brokenMock = `
const path = require('path');

create: jest.fn(() => ({ post: jest.fn() }))
  }));

describe('Clean Suite', () => {
  test('works', () => expect(true).toBe(true));
});`;
            const cleaned = cleanAndDeduplicateTestContent(brokenMock);
            expect(cleaned).not.toContain("create: jest.fn");
            expect(cleaned).not.toContain("}));");
            expect(cleaned).toContain("describe('Clean Suite'");

            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });

        test("Rule 4: Heal Unclosed Object Literals - tự động đóng object literal bị bỏ lửng", () => {
            const unclosedObject = `
describe('Account', () => {
  it('validates account profile', () => {
    const mockProfile = {
      name: 'Test Account',
      role: 'ADMIN',
    expect(mockProfile.name).toBe('Test Account');
  });
});`;
            const cleaned = cleanAndDeduplicateTestContent(unclosedObject);
            expect(cleaned).toContain("};");
            expect(cleaned).toContain("expect(mockProfile.name).toBe('Test Account')");

            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });

        test("Rule 5: CommonJS Jest Global Rule - khử bỏ khai báo const jest = require('@jest/globals')", () => {
            const codeWithRedeclaredJest = `
const { jest } = require('@jest/globals');
const { processItem } = require('../src/item');

describe('Item', () => {
  test('mocks cleanly', () => {
    expect(jest.fn).toBeDefined();
  });
});`;
            const cleaned = cleanAndDeduplicateTestContent(codeWithRedeclaredJest);
            expect(cleaned).not.toContain("const { jest } = require('@jest/globals')");
            expect(cleaned).toContain("const { processItem } = require('../src/item')");

            const ast = parseJavaScriptCode(cleaned);
            expect(ast.success).toBe(true);
        });

        test("Rule 6: Strict Storage Guard - từ chối mọi thao tác ghi hoặc duyệt ra ngoài thư mục an toàn", () => {
            const storageAttempt = {
                sourceFile: "src/user.js",
                testFile: "storage/projects/p1/repo/tests/hack.test.js",
                generatedCode: "test('hack', () => {});"
            };

            expect(() => applyCodeToTestFile(tempDir, storageAttempt)).toThrow(
                /Strict Storage Guard|forbidden/i
            );

            const traversalAttempt = {
                sourceFile: "src/user.js",
                testFile: "../../etc/evil.test.js",
                generatedCode: "test('evil', () => {});"
            };

            expect(() => applyCodeToTestFile(tempDir, traversalAttempt)).toThrow(
                /Path traversal forbidden/i
            );
        });
    });
});
