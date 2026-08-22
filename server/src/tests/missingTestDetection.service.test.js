import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const roots = [];
const prismaMock = { project: { findUnique: jest.fn() } };

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/aiSuggestion.service.js", () => ({
    getAiSuggestions: jest.fn().mockResolvedValue({ suggestions: [] }),
}));

const { detectMissingTests } = await import("../services/missingTestDetection.service.js");

const fixture = (files = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-missing-tests-"));
    roots.push(root);
    for (const [relativePath, content] of Object.entries(files)) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("missingTestDetection.service", () => {
    let rootDir;

    beforeEach(() => {
        jest.clearAllMocks();
        rootDir = fixture();
        prismaMock.project.findUnique.mockImplementation(async () => ({ id: "1", rootDir, ownerId: "owner-1" }));
    });

    it("returns all categories as missing when package metadata is absent", async () => {
        const result = await detectMissingTests("1");
        expect(result.data.missingCategories).toEqual(["UNIT", "INTEGRATION", "SYSTEM"]);
        expect(result.data.availableFrameworks).toEqual([]);
    });

    it("detects existing Jest unit tests", async () => {
        fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ devDependencies: { jest: "latest" } }));
        fs.mkdirSync(path.join(rootDir, "src"));
        fs.writeFileSync(path.join(rootDir, "src", "auth.test.js"), "import { jest } from '@jest/globals'; test('x', () => {});");

        const result = await detectMissingTests("1");
        expect(result.data.availableCategories).toContain("UNIT");
        expect(result.data.tests.unit).toMatchObject({ detected: true, framework: "JEST" });
    });

    it("detects existing Supertest integration tests", async () => {
        fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ devDependencies: { supertest: "latest" } }));
        fs.mkdirSync(path.join(rootDir, "src"));
        fs.writeFileSync(path.join(rootDir, "src", "api.integration.test.js"), "import request from 'supertest';");

        const result = await detectMissingTests("1");
        expect(result.data.availableCategories).toContain("INTEGRATION");
        expect(result.data.tests.integration).toMatchObject({ detected: true, framework: "SUPERTEST" });
    });
});
