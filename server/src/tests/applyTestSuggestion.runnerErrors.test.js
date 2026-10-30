import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";

const prisma = {
    projectSnapshot: { findUnique: jest.fn() },
    coverageFile: { findMany: jest.fn().mockResolvedValue([]) }
};
await jest.unstable_mockModule("../config/prisma.js", () => ({ default: prisma, prisma }));
const { applyUnitTestSuggestion, activeApplyLocks } = await import("../services/applyTestSuggestion.service.js");

describe("apply suggestion with JSON-only runner failures", () => {
    let rootDir;
    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-apply-json-error-"));
        fs.mkdirSync(path.join(rootDir, "src"));
        fs.writeFileSync(path.join(rootDir, "src/math.js"), "export const add = (a, b) => a + b;\n");
        prisma.projectSnapshot.findUnique.mockResolvedValue({ id: "snap-json", projectId: "project-json", rootDir });
    });
    afterEach(() => {
        activeApplyLocks.clear();
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    test.each([false, true])("returns the actual failure even when coverage exists (%s)", async withCoverage => {
        const result = await applyUnitTestSuggestion({
            snapshotId: "snap-json", projectId: "project-json",
            suggestion: {
                sourceFile: "src/math.js", testFile: "tests/math.test.js", framework: "vitest",
                generatedCode: "test('adds', () => { throw new Error('service unavailable'); });"
            },
            runCoverageFn: async ({ sealedRunDir }) => {
                fs.writeFileSync(path.join(sealedRunDir, "vitest-results.json"), JSON.stringify({
                    success: false, numFailedTests: 1,
                    testResults: [{ name: path.join(rootDir, "tests/math.test.js"), status: "failed",
                        assertionResults: [{ status: "failed", title: "adds", failureMessages: ["Error: service unavailable"] }]
                    }]
                }));
                if (withCoverage) fs.writeFileSync(path.join(sealedRunDir, "coverage-final.json"), JSON.stringify({ "src/math.js": {} }));
            }
        });
        expect(result.success).toBe(false);
        expect(result.status).toBe("FAILED");
        expect(result.errorDetail).toContain("Error: service unavailable");
        expect(result.appliedSuggestions[0].error).toContain("Error: service unavailable");
        expect(result.newCoverage).toBeNull();
    });
});
