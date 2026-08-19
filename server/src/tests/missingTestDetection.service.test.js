import { detectMissingTests } from "../services/missingTestDetection.service.js";
import prisma from "../config/prisma.js";
import fs from "fs";
import path from "path";

jest.mock("../config/prisma.js", () => ({
    project: {
        findUnique: jest.fn()
    }
}));

jest.mock("fs");
jest.mock("path");

describe("missingTestDetection.service", () => {
    const mockRootDir = "/mock/project";

    beforeEach(() => {
        jest.clearAllMocks();
        path.join.mockImplementation((...args) => args.join("/"));
        path.basename.mockImplementation((p) => p.split("/").pop());
        path.relative.mockImplementation((root, p) => p.replace(root, ""));
    });

    it("should return missing categories when no test files exist", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: "1", rootDir: mockRootDir });
        fs.existsSync.mockReturnValue(false); // No package.json
        fs.readdirSync.mockReturnValue([]); // No files

        const result = await detectMissingTests("1");

        expect(result.data.missingCategories).toEqual(["UNIT", "INTEGRATION", "SYSTEM"]);
        expect(result.data.availableFrameworks).toEqual([]);
    });

    it("should detect Jest unit tests", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: "1", rootDir: mockRootDir });
        fs.existsSync.mockImplementation((p) => p.endsWith("package.json"));
        fs.readFileSync.mockImplementation((p) => {
            if (p.endsWith("package.json")) return JSON.stringify({ devDependencies: { jest: "latest" } });
            return "";
        });

        // Mock file discovery
        const mockFiles = ["/mock/project/src/test.test.js"];
        fs.readdirSync.mockReturnValue(["src"]);
        fs.statSync.mockReturnValue({ isDirectory: () => true });
        // Simplified mock for getAllFiles recursion
        jest.spyOn(fs, "readdirSync").mockReturnValueOnce(["src"]).mockReturnValueOnce(["test.test.js"]);
        jest.spyOn(fs, "statSync").mockReturnValueOnce({ isDirectory: () => true }).mockReturnValueOnce({ isDirectory: () => false });

        const result = await detectMissingTests("1");

        expect(result.data.availableCategories).toContain("UNIT");
        expect(result.data.tests.unit.detected).toBe(true);
    });

    it("should detect Supertest integration tests", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: "1", rootDir: mockRootDir });
        fs.existsSync.mockImplementation((p) => p.endsWith("package.json"));
        fs.readFileSync.mockImplementation((p) => {
            if (p.endsWith("package.json")) return JSON.stringify({ devDependencies: { supertest: "latest" } });
            return "import request from 'supertest';";
        });

        jest.spyOn(fs, "readdirSync").mockReturnValueOnce(["src"]).mockReturnValueOnce(["api.integration.test.js"]);
        jest.spyOn(fs, "statSync").mockReturnValueOnce({ isDirectory: () => true }).mockReturnValueOnce({ isDirectory: () => false });

        const result = await detectMissingTests("1");

        expect(result.data.availableCategories).toContain("INTEGRATION");
        expect(result.data.tests.integration.detected).toBe(true);
    });
});
