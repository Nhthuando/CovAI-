import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import {
    assembleUnitTestContext,
    buildIsolationMockContracts
} from "../services/unitTestContextEngineering.service.js";
import {
    buildStandardUnitTestPrompt,
    parseAndSanitizeAiTestResponse
} from "../services/unitTestGenerator.service.js";
import {
    buildFullTestPrompt
} from "../services/fullTestPromptBuilder.service.js";
import {
    parseJavaScriptCode
} from "../services/babelParser.service.js";

describe("Challenger 2 Empirical Verification — Milestone M1 Gate", () => {
    let tempRootDir;
    let controllersDir;
    let servicesDir;
    let testsDir;

    beforeAll(() => {
        // Create temporary project workspace on disk
        tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-challenger-m1-"));
        controllersDir = path.join(tempRootDir, "src", "controllers");
        servicesDir = path.join(tempRootDir, "src", "services");
        testsDir = path.join(tempRootDir, "tests", "controllers");

        fs.mkdirSync(controllersDir, { recursive: true });
        fs.mkdirSync(servicesDir, { recursive: true });
        fs.mkdirSync(testsDir, { recursive: true });

        // 1. Service directly importing @prisma/client
        const userServiceCode = `
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function getUserRecord(userId) {
    if (!userId) throw new Error("User ID is required");
    return prisma.user.findUnique({
        where: { id: userId }
    });
}

export async function createUserRecord(userData) {
    return prisma.user.create({
        data: userData
    });
}
`;
        fs.writeFileSync(path.join(servicesDir, "user.service.js"), userServiceCode, "utf8");

        // 2. Service written in TypeScript using require & Prisma
        const accountServiceCode = `
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

export function getAccountBalance(accountId: string) {
    return prisma.account.findUnique({ where: { id: accountId } });
}
`;
        fs.writeFileSync(path.join(servicesDir, "account.service.ts"), accountServiceCode, "utf8");

        // 3. Controller importing user.service.js (NO direct prisma mention in controller)
        const userControllerCode = `
import { getUserRecord, createUserRecord } from '../services/user.service.js';

export async function getUserController(req, res, next) {
    try {
        const { id } = req.params;
        const user = await getUserRecord(id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        return res.status(200).json({ success: true, data: user });
    } catch (err) {
        return next(err);
    }
}
`;
        fs.writeFileSync(path.join(controllersDir, "user.controller.js"), userControllerCode, "utf8");

        // 4. Controller importing account.service without extension
        const accountControllerCode = `
const { getAccountBalance } = require('../services/account.service');

exports.getAccount = async function(req, res, next) {
    try {
        const balance = await getAccountBalance(req.params.accountId);
        return res.status(200).json(balance);
    } catch (e) {
        next(e);
    }
};
`;
        fs.writeFileSync(path.join(controllersDir, "account.controller.js"), accountControllerCode, "utf8");

        // 5. Pure utility service without Prisma
        const mathServiceCode = `
export function addNumbers(a, b) {
    return a + b;
}
`;
        fs.writeFileSync(path.join(servicesDir, "math.service.js"), mathServiceCode, "utf8");

        // 6. Controller importing pure math service (NO Prisma anywhere)
        const mathControllerCode = `
import { addNumbers } from '../services/math.service.js';

export function addController(req, res) {
    const { a, b } = req.body;
    return res.json({ sum: addNumbers(a, b) });
}
`;
        fs.writeFileSync(path.join(controllersDir, "math.controller.js"), mathControllerCode, "utf8");
    });

    afterAll(() => {
        try {
            if (tempRootDir && fs.existsSync(tempRootDir)) {
                fs.rmSync(tempRootDir, { recursive: true, force: true });
            }
        } catch (_) {}
    });

    describe("Empirical Challenge 1: Transitive Dependency Inspection & Parameter Forwarding", () => {
        test("assembleUnitTestContext forwards sourceFile, targetTestFile, rootDir to buildIsolationMockContracts", () => {
            const controllerSource = fs.readFileSync(path.join(controllersDir, "user.controller.js"), "utf8");

            const context = assembleUnitTestContext({
                sourceCode: controllerSource,
                coverageDetails: {
                    uncoveredLines: [8, 9],
                    summary: { linesPct: 60, branchesPct: 50, funcsPct: 100, stmtsPct: 60 }
                },
                framework: "jest",
                sourceFile: "src/controllers/user.controller.js",
                targetTestFile: "tests/controllers/user.controller.test.js",
                rootDir: tempRootDir
            });

            // Must have detected dependencies
            expect(context.mockContracts).toBeDefined();
            expect(context.mockContracts.detectedDependencies).toContain("express-controller");
            expect(context.mockContracts.detectedDependencies).toContain("downstream-local-services");
            expect(context.mockContracts.detectedDependencies).toContain("prisma-db");

            // Mock preamble must contain hoisting-safe Prisma client mock
            expect(context.mockContracts.mockPreambleCode).toContain("jest.mock('@prisma/client'");
            expect(context.mockContracts.mockPreambleCode).toContain("_createModelMock");
            expect(context.mockContracts.mockPreambleCode).toContain("_createClientMock");
            expect(context.mockContracts.mockPreambleCode).toContain("globalThis.__mockPrisma");

            // Mock preamble must contain local service mock with test-relative path
            expect(context.mockContracts.mockPreambleCode).toContain("jest.mock('../services/user.service.js'");

            // Mock instructions must contain Prisma v7 isolation guidance
            expect(context.mockContracts.mockInstructions).toContain("MANDATORY ISOLATION MOCK CONTRACTS");
            expect(context.mockContracts.mockInstructions).toContain("Prisma DB");
            expect(context.mockContracts.mockInstructions).toContain("PrismaClientInitializationError in Prisma v7");

            // Engineered prompt context must contain mock preamble block
            expect(context.engineeredPromptContext).toContain("### SECTION 2: ISOLATION MOCK CONTRACTS");
            expect(context.engineeredPromptContext).toContain("MANDATORY ISOLATION MOCK PREAMBLE");
            expect(context.engineeredPromptContext).toContain("jest.mock('@prisma/client'");
        });

        test("negative control: without sourceFile or rootDir, indirect Prisma dependency cannot be resolved", () => {
            const controllerSource = fs.readFileSync(path.join(controllersDir, "user.controller.js"), "utf8");

            // Zero filesystem resolution parameters passed
            const unforwardedContext = assembleUnitTestContext({
                sourceCode: controllerSource,
                coverageDetails: {},
                framework: "jest"
            });

            // In unforwarded context, user.controller.js has no direct prisma mentions
            expect(unforwardedContext.mockContracts.detectedDependencies).not.toContain("prisma-db");
            expect(unforwardedContext.mockContracts.mockPreambleCode).not.toContain("jest.mock('@prisma/client'");
        });

        test("transitive inspection resolves extension-less TypeScript dependency (.ts) and detects Prisma", () => {
            const accountControllerSource = fs.readFileSync(path.join(controllersDir, "account.controller.js"), "utf8");

            const context = assembleUnitTestContext({
                sourceCode: accountControllerSource,
                coverageDetails: {},
                framework: "jest",
                sourceFile: "src/controllers/account.controller.js",
                targetTestFile: "tests/controllers/account.controller.test.js",
                rootDir: tempRootDir
            });

            expect(context.mockContracts.detectedDependencies).toContain("prisma-db");
            expect(context.mockContracts.mockPreambleCode).toContain("jest.mock('@prisma/client'");
            expect(context.mockContracts.mockInstructions).toContain("Prisma DB");
        });

        test("transitive inspection works under Vitest framework producing vi.hoisted and vi.mock", () => {
            const controllerSource = fs.readFileSync(path.join(controllersDir, "user.controller.js"), "utf8");

            const context = assembleUnitTestContext({
                sourceCode: controllerSource,
                coverageDetails: {},
                framework: "vitest",
                sourceFile: "src/controllers/user.controller.js",
                targetTestFile: "tests/controllers/user.controller.test.js",
                rootDir: tempRootDir
            });

            expect(context.mockContracts.detectedDependencies).toContain("prisma-db");
            expect(context.mockContracts.mockPreambleCode).toContain("vi.hoisted");
            expect(context.mockContracts.mockPreambleCode).toContain("vi.mock('@prisma/client'");
            expect(context.mockContracts.mockPreambleCode).not.toContain("jest.mock");
        });

        test("negative control: non-Prisma module does NOT produce prisma-db dependency", () => {
            const mathControllerSource = fs.readFileSync(path.join(controllersDir, "math.controller.js"), "utf8");

            const context = assembleUnitTestContext({
                sourceCode: mathControllerSource,
                coverageDetails: {},
                framework: "jest",
                sourceFile: "src/controllers/math.controller.js",
                targetTestFile: "tests/controllers/math.controller.test.js",
                rootDir: tempRootDir
            });

            expect(context.mockContracts.detectedDependencies).not.toContain("prisma-db");
            expect(context.mockContracts.mockPreambleCode).not.toContain("@prisma/client");
        });
    });

    describe("Empirical Challenge 2: Prompt Generation, Rule 7 & Formatting Invariants", () => {
        test("buildStandardUnitTestPrompt correctly interpolates Rule 7 and mock contracts in new file mode", () => {
            const controllerSource = fs.readFileSync(path.join(controllersDir, "user.controller.js"), "utf8");

            const context = assembleUnitTestContext({
                sourceCode: controllerSource,
                coverageDetails: {
                    uncoveredLines: [8, 9],
                    summary: { linesPct: 60, branchesPct: 50, funcsPct: 100, stmtsPct: 60 }
                },
                framework: "jest",
                sourceFile: "src/controllers/user.controller.js",
                targetTestFile: "tests/controllers/user.controller.test.js",
                rootDir: tempRootDir
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/controllers/user.controller.js",
                testFileInfo: {
                    found: false,
                    relativePath: "tests/controllers/user.controller.test.js",
                    content: ""
                },
                cleanImportPath: "../../src/controllers/user.controller.js",
                coverageDetails: {
                    uncoveredLines: [8, 9],
                    summary: { linesPct: 60, branchesPct: 50, funcsPct: 100, stmtsPct: 60 }
                },
                sourceCode: controllerSource,
                unitTestContext: context
            });

            // 1. Heading structure intact
            expect(prompt).toContain("### 1. ROLE DEFINITION & PROJECT CONTEXT");
            expect(prompt).toContain("### 2. TARGET FILE & IMPORT CONTRACT");
            expect(prompt).toContain("### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS");
            expect(prompt).toContain("### 4. SOURCE CODE");
            expect(prompt).toContain("### 5. STRICT GENERATION RULES & METHODOLOGY (TARGETING >=90% TO 100% COVERAGE)");
            expect(prompt).toContain("### 6. OUTPUT FORMAT");

            // 2. Rule 7 presence and integrity
            expect(prompt).toContain("7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):");
            expect(prompt).toContain("MANDATORY ISOLATION MOCK CONTRACTS:");
            expect(prompt).toContain("CRITICAL DATABASE ISOLATION CONTRACT (PRISMA v7):");
            expect(prompt).toContain("NEVER connect to a real database or allow unmocked 'new PrismaClient()' instantiation.");
            expect(prompt).toContain("Top-level mock mandate: You MUST mock '@prisma/client' and local DB singletons");
            expect(prompt).toContain("jest.mock('@prisma/client'");

            // 3. Subsequent rules preserved
            expect(prompt).toContain("8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:");
            expect(prompt).toContain("9. EXPRESS CONTROLLER & MIDDLEWARE FIXTURES CONTRACT:");
            expect(prompt).toContain("10. RUNNER COMPATIBILITY (JEST & VITEST):");
            expect(prompt).toContain("11. HERMETIC TEST TEARDOWN:");

            // 4. Output format section intact and valid JSON template
            expect(prompt).toContain('"explanation":');
            expect(prompt).toContain('"suggestedTestCode":');
            expect(prompt).toContain('"fullUpdatedContent":');

            // 5. Code fence markdown balance
            const codeBlockMatches = prompt.match(/```/g) || [];
            expect(codeBlockMatches.length % 2).toBe(0); // Balanced code fences
        });

        test("buildStandardUnitTestPrompt correctly interpolates Rule 7 and mock contracts in existing file mode", () => {
            const controllerSource = fs.readFileSync(path.join(controllersDir, "user.controller.js"), "utf8");

            const context = assembleUnitTestContext({
                sourceCode: controllerSource,
                coverageDetails: {
                    uncoveredLines: [8],
                    summary: { linesPct: 80, branchesPct: 75, funcsPct: 100, stmtsPct: 80 }
                },
                framework: "jest",
                sourceFile: "src/controllers/user.controller.js",
                targetTestFile: "tests/controllers/user.controller.test.js",
                rootDir: tempRootDir
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/controllers/user.controller.js",
                testFileInfo: {
                    found: true,
                    relativePath: "tests/controllers/user.controller.test.js",
                    content: "describe('existing suite', () => { it('initial test', () => {}); });"
                },
                cleanImportPath: "../../src/controllers/user.controller.js",
                coverageDetails: {
                    uncoveredLines: [8],
                    summary: { linesPct: 80, branchesPct: 75, funcsPct: 100, stmtsPct: 80 }
                },
                sourceCode: controllerSource,
                unitTestContext: context
            });

            // In existing test mode:
            expect(prompt).toContain("EXISTING test file: tests/controllers/user.controller.test.js");
            expect(prompt).toContain("### 4. SOURCE CODE & EXISTING TESTS");
            expect(prompt).toContain("describe('existing suite'");
            expect(prompt).toContain("7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):");
            expect(prompt).toContain("CRITICAL DATABASE ISOLATION CONTRACT (PRISMA v7):");
            expect(prompt).toContain("jest.mock('@prisma/client'");
            expect(prompt).toContain("### 6. OUTPUT FORMAT");

            // Code fence balance
            const codeBlockMatches = prompt.match(/```/g) || [];
            expect(codeBlockMatches.length % 2).toBe(0);
        });

        test("buildStandardUnitTestPrompt for Vitest embeds Vitest mock template in Rule 7", () => {
            const controllerSource = fs.readFileSync(path.join(controllersDir, "user.controller.js"), "utf8");

            const context = assembleUnitTestContext({
                sourceCode: controllerSource,
                coverageDetails: {},
                framework: "vitest",
                sourceFile: "src/controllers/user.controller.js",
                targetTestFile: "tests/controllers/user.controller.test.js",
                rootDir: tempRootDir
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "vitest",
                cleanSource: "src/controllers/user.controller.js",
                testFileInfo: {
                    found: false,
                    relativePath: "tests/controllers/user.controller.test.js",
                    content: ""
                },
                cleanImportPath: "../../src/controllers/user.controller.js",
                coverageDetails: {},
                sourceCode: controllerSource,
                unitTestContext: context
            });

            expect(prompt).toContain("7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):");
            expect(prompt).toContain("vi.hoisted");
            expect(prompt).toContain("vi.mock('@prisma/client'");
            expect(prompt).toContain("afterEach(() => { vi.restoreAllMocks(); });");
            expect(prompt).not.toContain("jest.mock('@prisma/client'");

            const codeBlockMatches = prompt.match(/```/g) || [];
            expect(codeBlockMatches.length % 2).toBe(0);
        });

        test("non-Prisma module prompt omits Prisma directive to prevent prompt pollution", () => {
            const mathControllerSource = fs.readFileSync(path.join(controllersDir, "math.controller.js"), "utf8");

            const context = assembleUnitTestContext({
                sourceCode: mathControllerSource,
                coverageDetails: {},
                framework: "jest",
                sourceFile: "src/controllers/math.controller.js",
                targetTestFile: "tests/controllers/math.controller.test.js",
                rootDir: tempRootDir
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/controllers/math.controller.js",
                testFileInfo: { found: false, relativePath: "tests/controllers/math.controller.test.js", content: "" },
                cleanImportPath: "../../src/controllers/math.controller.js",
                coverageDetails: {},
                sourceCode: mathControllerSource,
                unitTestContext: context
            });

            expect(prompt).not.toContain("CRITICAL DATABASE ISOLATION CONTRACT (PRISMA v7)");
            expect(prompt).not.toContain("jest.mock('@prisma/client'");
            expect(prompt).toContain("7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):");
        });

        test("adversarial stress: handles source code containing backticks, dollar templates, and regex slashes without corrupting prompt", () => {
            const adversarialSource = `
export function formatTemplates(str, val) {
    const regex = /https?:\\/\\/[^\\s/$.?#].[^\\s]*/gi;
    const template = \`Value is: \${val} \` + \`Literal backtick: \\\` and dollar: \\\$\`;
    const obj = { "\`nested\`": \`\${val}\` };
    return template;
}
`;
            const context = assembleUnitTestContext({
                sourceCode: adversarialSource,
                coverageDetails: {},
                framework: "jest"
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/template.js",
                testFileInfo: { found: false, relativePath: "tests/template.test.js", content: "" },
                cleanImportPath: "../src/template",
                coverageDetails: {},
                sourceCode: adversarialSource,
                unitTestContext: context
            });

            // Prompt must still contain all mandatory sections
            expect(prompt).toContain("### 1. ROLE DEFINITION & PROJECT CONTEXT");
            expect(prompt).toContain("### 4. SOURCE CODE");
            expect(prompt).toContain("### 5. STRICT GENERATION RULES & METHODOLOGY");
            expect(prompt).toContain("7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):");
            expect(prompt).toContain("8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:");
            expect(prompt).toContain("### 6. OUTPUT FORMAT");

            // Code fence balance
            const codeBlockMatches = prompt.match(/```/g) || [];
            expect(codeBlockMatches.length % 2).toBe(0);
        });

        test("adversarial stress: handles empty or undefined unitTestContext gracefully without crashing", () => {
            const promptWithNullContext = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/empty.js",
                testFileInfo: { found: false, relativePath: "tests/empty.test.js", content: "" },
                cleanImportPath: "../src/empty",
                coverageDetails: {},
                sourceCode: "export const x = 1;",
                unitTestContext: null
            });

            expect(promptWithNullContext).toContain("### 1. ROLE DEFINITION & PROJECT CONTEXT");
            expect(promptWithNullContext).toContain("### 5. STRICT GENERATION RULES & METHODOLOGY");
            expect(promptWithNullContext).toContain("7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):");
            expect(promptWithNullContext).toContain("8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:");
            expect(promptWithNullContext).toContain("### 6. OUTPUT FORMAT");

            const codeBlockMatches = promptWithNullContext.match(/```/g) || [];
            expect(codeBlockMatches.length % 2).toBe(0);
        });
    });

    describe("Empirical Challenge 3: AST Syntactic Integrity of Generated Mock Preamble", () => {
        test("Jest Prisma mock template parses as syntactically valid JavaScript via Babel AST", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import { PrismaClient } from '@prisma/client';",
                existingTestCode: "",
                framework: "jest"
            });

            expect(contracts.mockPreambleCode).toContain("jest.mock('@prisma/client'");
            const parseResult = parseJavaScriptCode(contracts.mockPreambleCode);
            expect(parseResult.success).toBe(true);
            expect(parseResult.ast).toBeDefined();
        });

        test("Vitest Prisma mock template parses as syntactically valid JavaScript via Babel AST", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import { PrismaClient } from '@prisma/client';",
                existingTestCode: "",
                framework: "vitest"
            });

            expect(contracts.mockPreambleCode).toContain("vi.mock('@prisma/client'");
            const parseResult = parseJavaScriptCode(contracts.mockPreambleCode);
            expect(parseResult.success).toBe(true);
            expect(parseResult.ast).toBeDefined();
        });

        test("parseAndSanitizeAiTestResponse successfully validates response containing top-level Prisma mock", () => {
            const validGeneratedTest = `
jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn(() => ({ user: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) } }))
  };
}, { virtual: true });

describe('UserController', () => {
  it('fetches user', async () => {
    expect(1).toBe(1);
  });
});
`;
            const rawResponse = JSON.stringify({
                explanation: "Tests with Prisma isolation mock",
                suggestedTestCode: validGeneratedTest,
                fullUpdatedContent: validGeneratedTest
            });

            const parsed = parseAndSanitizeAiTestResponse({
                rawResponse,
                framework: "jest",
                cleanSource: "src/controllers/user.controller.js"
            });

            expect(parsed.success).toBe(true);
            expect(parsed.syntaxValid).toBe(true);
            expect(parsed.hasAssertions).toBe(true);
            expect(parsed.parsed.fullUpdatedContent).toContain("jest.mock('@prisma/client'");
        });
    });

    describe("Empirical Challenge 4: Full Test Prompt Builder & System Agent Integration", () => {
        test("buildFullTestPrompt contains explicit database client mocking instructions", () => {
            const prompt = buildFullTestPrompt(
                "export function testMe() {}",
                "test('existing', () => {});",
                [{ name: "testMe", line: 1 }],
                { summary: { linesPct: 50 } },
                null
            );

            expect(prompt).toContain("DATABASE CLIENT MOCKING:");
            expect(prompt).toContain("@prisma/client");
            expect(prompt).toContain("in-memory proxies");
            expect(prompt).toContain("new PrismaClient()");
            expect(prompt).toContain("Task Instructions");
        });
    });
});
