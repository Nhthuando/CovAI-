import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import {
    extractModuleSpecifiers,
    resolveSpecifierToRelativePath,
    stripExtension,
    buildProjectTestDependencyMap,
    findTestsImportingSource
} from "../services/testDependencyResolver.service.js";

describe("TestDependencyResolver Service", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-test-dep-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    describe("extractModuleSpecifiers", () => {
        it("extracts static ES6 imports", () => {
            const code = `
                import { foo } from "./services/auth.service";
                import bar from '../utils/helper.js';
                import '@jest/globals';
            `;
            const specs = extractModuleSpecifiers(code);
            expect(specs).toContain("./services/auth.service");
            expect(specs).toContain("../utils/helper.js");
            expect(specs).toContain("@jest/globals");
        });

        it("extracts dynamic import and require", () => {
            const code = `
                const { handler } = await import('../../../src/handlers/create-quickbooks-account.handler');
                const legacy = require('../../legacy/old-util');
            `;
            const specs = extractModuleSpecifiers(code);
            expect(specs).toContain("../../../src/handlers/create-quickbooks-account.handler");
            expect(specs).toContain("../../legacy/old-util");
        });

        it("extracts jest mock directives", () => {
            const code = `
                jest.mock('../clients/quickbooks-client', () => ({}));
                jest.unstable_mockModule('../../../src/handlers/invoice.handler', () => ({}));
            `;
            const specs = extractModuleSpecifiers(code);
            expect(specs).toContain("../clients/quickbooks-client");
            expect(specs).toContain("../../../src/handlers/invoice.handler");
        });
    });

    describe("resolveSpecifierToRelativePath", () => {
        it("resolves nested relative path correctly", () => {
            const rootDir = tempDir;
            const testRel = "tests/unit/handlers/create-account.handlers.test.ts";
            const specifier = "../../../src/handlers/create-quickbooks-account.handler";

            const resolved = resolveSpecifierToRelativePath(rootDir, testRel, specifier);
            expect(resolved).toBe("src/handlers/create-quickbooks-account.handler");
        });

        it("resolves root-relative path aliases @/", () => {
            const rootDir = tempDir;
            const testRel = "tests/user.test.ts";
            const specifier = "@/services/user.service";

            const resolved = resolveSpecifierToRelativePath(rootDir, testRel, specifier);
            expect(resolved).toBe("src/services/user.service");
        });

        it("returns null for external npm modules", () => {
            const rootDir = tempDir;
            const testRel = "tests/auth.test.ts";
            const specifier = "express";

            const resolved = resolveSpecifierToRelativePath(rootDir, testRel, specifier);
            expect(resolved).toBeNull();
        });
    });

    describe("findTestsImportingSource", () => {
        it("links a test file with a DIFFERENT name to a target source file", () => {
            // Setup project structure
            // src/handlers/create-quickbooks-account.handler.ts
            // tests/unit/handlers/create-account.handlers.test.ts (different name!)
            const srcDir = path.join(tempDir, "src", "handlers");
            fs.mkdirSync(srcDir, { recursive: true });
            const sourceFile = path.join(srcDir, "create-quickbooks-account.handler.ts");
            fs.writeFileSync(sourceFile, `export const createQuickbooksAccount = () => {};`, "utf8");

            const testDir = path.join(tempDir, "tests", "unit", "handlers");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "create-account.handlers.test.ts");
            fs.writeFileSync(testFile, `
                import { describe, it, expect } from '@jest/globals';
                const { createQuickbooksAccount } = await import('../../../src/handlers/create-quickbooks-account.handler');

                describe('create account', () => {
                    it('creates account', () => {
                        expect(createQuickbooksAccount).toBeDefined();
                    });
                });
            `, "utf8");

            const matches = findTestsImportingSource(tempDir, "src/handlers/create-quickbooks-account.handler.ts");

            expect(matches).toHaveLength(1);
            expect(matches[0].filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
            expect(matches[0].relationType).toBe("DIRECT_IMPORT");
            expect(matches[0].testCount).toBe(1);
        });

        it("returns multiple test files if multiple tests import the same source", () => {
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "auth.service.js"), `export const login = () => {};`, "utf8");

            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });

            // Test 1: Unit test
            fs.writeFileSync(path.join(testDir, "auth.unit.test.js"), `
                import { login } from '../src/services/auth.service';
                it('unit test', () => {});
            `, "utf8");

            // Test 2: Integration test
            fs.writeFileSync(path.join(testDir, "api-integration.test.js"), `
                const { login } = require('../src/services/auth.service');
                it('integration test 1', () => {});
                it('integration test 2', () => {});
            `, "utf8");

            const matches = findTestsImportingSource(tempDir, "src/services/auth.service.js");

            expect(matches).toHaveLength(2);
            const filePaths = matches.map(m => m.filePath);
            expect(filePaths).toContain("tests/auth.unit.test.js");
            expect(filePaths).toContain("tests/api-integration.test.js");
        });
    });
});
