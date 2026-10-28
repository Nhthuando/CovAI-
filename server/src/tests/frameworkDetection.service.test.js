import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const roots = [];

/** Creates a temp directory pre-populated with the given file map. */
const fixture = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-fw-detect-"));
    roots.push(root);
    for (const [rel, content] of Object.entries(files)) {
        const target = path.join(root, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
};

afterEach(() => roots.splice(0).forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mockProject = { id: "project-1" };

const prismaMock = {
    project: {
        findFirst: jest.fn(async () => mockProject),
    },
    projectSnapshot: {
        findFirst: jest.fn(async () => ({ rootDir: null })),
    },
};

jest.unstable_mockModule("../config/prisma.js", () => ({
    default: prismaMock,
}));

// ─── SUT – imported after mocks are registered ───────────────────────────────

const { detectProjectFrameworks } = await import("../services/frameworkDetection.service.js");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("frameworkDetection.service - detectProjectFrameworks", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prismaMock.project.findFirst.mockResolvedValue(mockProject);
        prismaMock.projectSnapshot.findFirst.mockResolvedValue({ rootDir: null });
    });

    describe("ownership verification", () => {
        it("throws 400 when projectId is an empty string", async () => {
            await expect(detectProjectFrameworks("", "owner-1")).rejects.toMatchObject({
                statusCode: 400,
                message: "projectId is required",
            });
        });

        it("throws 404 when the project does not belong to the user", async () => {
            prismaMock.project.findFirst.mockResolvedValueOnce(null);
            await expect(detectProjectFrameworks("project-1", "other-user")).rejects.toMatchObject({
                statusCode: 404,
                message: "Project not found or unauthorized",
            });
        });

        it("throws 404 when no snapshot with a rootDir exists yet", async () => {
            await expect(detectProjectFrameworks("project-1", "owner-1")).rejects.toMatchObject({
                statusCode: 404,
                message: "Project snapshot not ready",
            });
        });
    });

    describe("returns detected frameworks", () => {
        it("includes detectedFrameworks and frameworkType=single for a Jest project", async () => {
            const root = fixture({
                "package.json": JSON.stringify({ devDependencies: { jest: "^29" } }),
            });
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({ rootDir: root });
            const result = await detectProjectFrameworks("project-1", "owner-1");
            expect(result.detectedFrameworks).toContain("jest");
            expect(result.frameworkType).toBe("single");
            expect(result.primaryFramework).toBe("jest");
        });

        it("detects both jest and vitest and sets frameworkType=multiple", async () => {
            const root = fixture({
                "package.json": JSON.stringify({ devDependencies: { jest: "^29", vitest: "^2" } }),
            });
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({ rootDir: root });
            const result = await detectProjectFrameworks("project-1", "owner-1");
            expect(result.detectedFrameworks).toEqual(expect.arrayContaining(["jest", "vitest"]));
            expect(result.frameworkType).toBe("multiple");
            expect(result.hasMultipleFrameworks).toBe(true);
        });
    });

    describe("returns test file information", () => {
        it("lists discovered test files with their framework classification", async () => {
            const root = fixture({
                "package.json": JSON.stringify({ devDependencies: { jest: "^29" } }),
                "src/auth.test.js": "import { jest } from '@jest/globals'; test('x', () => {});",
            });
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({ rootDir: root });
            const result = await detectProjectFrameworks("project-1", "owner-1");
            expect(result.testFiles).toEqual(
                expect.arrayContaining([expect.objectContaining({ path: "src/auth.test.js", framework: "jest" })])
            );
            expect(result.testFileCount).toBeGreaterThan(0);
        });
    });

    describe("returns recommended framework", () => {
        it("recommends jest over vitest when both are detected", async () => {
            const root = fixture({
                "package.json": JSON.stringify({ devDependencies: { jest: "^29", vitest: "^2" } }),
            });
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({ rootDir: root });
            const result = await detectProjectFrameworks("project-1", "owner-1");
            expect(result.recommendedFramework).toBe("jest");
        });

        it("recommends vitest when only vitest is detected", async () => {
            const root = fixture({
                "package.json": JSON.stringify({ devDependencies: { vitest: "^2" } }),
                "vitest.config.ts": "export default {};",
            });
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({ rootDir: root });
            const result = await detectProjectFrameworks("project-1", "owner-1");
            expect(result.recommendedFramework).toBe("vitest");
        });
    });

    describe("handles project without tests", () => {
        it("returns hasTests=false, frameworkType=none, and recommendedFramework=null", async () => {
            const root = fixture({
                "package.json": JSON.stringify({ name: "bare-project", version: "1.0.0" }),
                "src/index.js": "console.log('hello');",
            });
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({ rootDir: root });
            const result = await detectProjectFrameworks("project-1", "owner-1");
            expect(result.hasTests).toBe(false);
            expect(result.frameworkType).toBe("none");
            expect(result.detectedFrameworks).toHaveLength(0);
            expect(result.recommendedFramework).toBeNull();
            expect(result.testFiles).toHaveLength(0);
            expect(result.testFileCount).toBe(0);
        });
    });
});
