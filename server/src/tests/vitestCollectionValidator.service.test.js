import { describe, it, expect } from "@jest/globals";
import path from "path";
import {
    resolveVitestExecutable,
    validateVitestAstStructure,
    healVitestCode,
    validateAndHealVitestTestCollection,
    runVitestCollectionDryRun
} from "../services/vitestCollectionValidator.service.js";

describe("Vitest Collection Validator Service", () => {
    describe("resolveVitestExecutable", () => {
        it("finds vitest entry point or binary", () => {
            const rootCandidate = path.resolve("uploads/snapshots/cmw2tdy3f0001ngmx0pemtldv/AI/gemini_chatbox");
            const resolved = resolveVitestExecutable(rootCandidate);
            expect(resolved).toBeTruthy();
            expect(typeof resolved).toBe("string");
            expect(resolved.includes("vitest")).toBe(true);
        });

        it("falls back gracefully when rootDir is null", () => {
            const resolved = resolveVitestExecutable(null);
            // On a dev host or CI with vitest in node_modules, it may find it or return null
            if (resolved) {
                expect(typeof resolved).toBe("string");
            }
        });
    });

    describe("validateVitestAstStructure", () => {
        it("validates compliant Vitest test code", () => {
            const code = `
                import { describe, it, expect, vi } from 'vitest';
                describe('my suite', () => {
                    it('passes', () => {
                        expect(1).toBe(1);
                    });
                });
            `;
            const res = validateVitestAstStructure(code);
            expect(res.valid).toBe(true);
            expect(res.errors).toHaveLength(0);
            expect(res.testCount).toBe(1);
        });

        it("detects invalid nested test registrations", () => {
            const code = `
                import { describe, it, expect } from 'vitest';
                describe('my suite', () => {
                    it('parent test', () => {
                        it('nested test', () => {
                            expect(true).toBe(true);
                        });
                    });
                });
            `;
            const res = validateVitestAstStructure(code);
            expect(res.valid).toBe(false);
            expect(res.nestedTestCount).toBe(1);
            expect(res.errors.some(e => e.includes("nested test registration"))).toBe(true);
        });

        it("detects incompatible Jest mocking APIs in Vitest", () => {
            const code = `
                import { describe, it, expect } from 'vitest';
                describe('my suite', () => {
                    it('uses jest.fn', () => {
                        const m = jest.fn();
                        expect(m).toBeDefined();
                    });
                });
            `;
            const res = validateVitestAstStructure(code);
            expect(res.valid).toBe(false);
            expect(res.jestApiOccurrences).toContain("jest.fn");
        });
    });

    describe("healVitestCode", () => {
        it("replaces jest APIs with vi APIs and ensures imports", () => {
            const broken = `
                describe('sample', () => {
                    const fn = jest.fn();
                    jest.mock('fs');
                    it('works', () => {
                        expect(fn).toBeDefined();
                    });
                });
            `;
            const healed = healVitestCode(broken);
            expect(healed).toContain("vi.fn");
            expect(healed).toContain("vi.mock");
            expect(healed).not.toContain("jest.fn");
            expect(healed).toContain("from 'vitest'");
        });

        it("injects virtual mock when collection error reports missing module", () => {
            const code = `
                import { describe, it, expect } from 'vitest';
                it('test', () => expect(true).toBe(true));
            `;
            const healed = healVitestCode(code, { collectionError: "Cannot find module 'non-existent-lib'" });
            expect(healed).toContain("vi.mock('non-existent-lib'");
        });
    });

    describe("validateAndHealVitestTestCollection", () => {
        it("successfully validates compliant code via AST and heals Jest APIs", async () => {
            const codeWithJest = `
                describe('auto healed suite', () => {
                    it('executes without error', () => {
                        const stub = jest.fn();
                        expect(stub).toBeDefined();
                    });
                });
            `;
            const result = await validateAndHealVitestTestCollection({
                testCode: codeWithJest,
                rootDir: null,
                maxRetries: 2
            });

            expect(result.success).toBe(true);
            expect(result.code).toContain("vi.fn");
            expect(result.code).not.toContain("jest.fn");
        });
    });
});
