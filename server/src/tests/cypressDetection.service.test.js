import { describe, it, beforeEach, jest, expect } from '@jest/globals';

jest.unstable_mockModule("../config/prisma.js", () => ({
    default: {
        project: {
            findUnique: jest.fn()
        },
        projectSnapshot: {
            findFirst: jest.fn()
        }
    }
}));

jest.unstable_mockModule("fs", () => ({
    default: {
        existsSync: jest.fn(),
        readFileSync: jest.fn(),
        readdirSync: jest.fn(),
        statSync: jest.fn(),
        lstatSync: jest.fn()
    }
}));

jest.unstable_mockModule("path", () => ({
    default: {
        join: jest.fn(),
        resolve: jest.fn(),
        relative: jest.fn(),
        normalize: jest.fn(),
        dirname: jest.fn()
    }
}));

const { detectCypressMetadata } = await import("../services/cypressDetection.service.js");
const prisma = (await import("../config/prisma.js")).default;
const fs = (await import("fs")).default;
const path = (await import("path")).default;

describe("CypressDetectionService", () => {
    const mockRootDir = "/mock/project";
    const projectId = "test-project-id";

    beforeEach(() => {
        jest.clearAllMocks();
        // Mock path methods for cross-platform consistency in tests
        path.join.mockImplementation((...args) => args.join("/"));
        path.resolve.mockImplementation((...args) => args.join("/"));
        path.relative.mockImplementation((from, to) => to.replace(from + "/", ""));
        path.normalize.mockImplementation((p) => p);
        path.dirname.mockImplementation((p) => {
            const parts = p.split("/");
            parts.pop();
            return parts.join("/");
        });

        // Default mock behaviors
        fs.existsSync.mockReturnValue(false);
        fs.readFileSync.mockReturnValue("");
        fs.readdirSync.mockReturnValue([]);
        fs.statSync.mockImplementation((p) => ({
            isDirectory: () => !p.includes(".")
        }));
        fs.lstatSync.mockImplementation((p) => ({
            isDirectory: () => !p.includes(".")
        }));
    });

    it("should throw error if projectId is missing", async () => {
        await expect(detectCypressMetadata(null)).rejects.toThrow("projectId is required");
    });

    it("should throw error if project not found", async () => {
        prisma.project.findUnique.mockResolvedValue(null);
        await expect(detectCypressMetadata(projectId)).rejects.toThrow("Project not found");
    });

    it("should return detected=false if package.json does not exist", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: projectId, rootDir: mockRootDir });
        prisma.projectSnapshot.findFirst.mockResolvedValue({ rootDir: mockRootDir });
        fs.existsSync.mockReturnValue(false);

        const result = await detectCypressMetadata(projectId);
        expect(result.detected).toBe(false);
    });

    it("should detect Cypress dependency, config, and test files", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: projectId, rootDir: mockRootDir });
        prisma.projectSnapshot.findFirst.mockResolvedValue({ rootDir: mockRootDir });

        fs.existsSync.mockImplementation((p) => {
            return p === mockRootDir || p === mockRootDir + "/cypress" || p === mockRootDir + "/cypress/e2e" || p.endsWith("package.json") || p.endsWith("cypress.config.js") || p.endsWith("login.cy.js");
        });

        fs.readFileSync.mockImplementation((p) => {
            if (p.endsWith("package.json")) {
                return JSON.stringify({
                    devDependencies: { cypress: "^13.0.0" }
                });
            }
            return "";
        });

        // Mock recursive file scanning
        fs.readdirSync.mockImplementation((p) => {
            if (p === mockRootDir) return ["cypress", "package.json", "cypress.config.js"];
            if (p === mockRootDir + "/cypress") return ["e2e"];
            if (p === mockRootDir + "/cypress/e2e") return ["login.cy.js"];
            return [];
        });

        const result = await detectCypressMetadata(projectId);

        expect(result.detected).toBe(true);
        expect(result.version).toBe("^13.0.0");
        expect(result.configPath).toBe("cypress.config.js");
        expect(result.testDirectory).toBe("cypress/e2e");
        expect(result.testFiles).toContain("cypress/e2e/login.cy.js");
    });

    it("should detect Cypress when only config exists", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: projectId, rootDir: mockRootDir });
        prisma.projectSnapshot.findFirst.mockResolvedValue({ rootDir: mockRootDir });

        fs.existsSync.mockImplementation((p) => {
            return p === mockRootDir || p.endsWith("package.json") || p.endsWith("cypress.config.ts");
        });

        fs.readFileSync.mockImplementation((p) => {
            if (p.endsWith("package.json")) return JSON.stringify({});
            return "";
        });

        const result = await detectCypressMetadata(projectId);

        expect(result.detected).toBe(true);
        expect(result.configPath).toBe("cypress.config.ts");
    });

    it("should detect Cypress when only test files exist", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: projectId, rootDir: mockRootDir });
        prisma.projectSnapshot.findFirst.mockResolvedValue({ rootDir: mockRootDir });

        fs.existsSync.mockImplementation((p) => {
            return p === mockRootDir || p === mockRootDir + "/src" || p.endsWith("package.json") || p.endsWith("app.cy.ts");
        });
        fs.readFileSync.mockImplementation((p) => {
            if (p.endsWith("package.json")) return JSON.stringify({});
            return "";
        });

        fs.readdirSync.mockImplementation((p) => {
            if (p === mockRootDir) return ["src"];
            if (p === mockRootDir + "/src") return ["app.cy.ts"];
            return [];
        });

        const result = await detectCypressMetadata(projectId);

        expect(result.detected).toBe(true);
        expect(result.testFiles).toContain("src/app.cy.ts");
    });

    it("should detect tests in cypress/component", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: projectId, rootDir: mockRootDir });
        prisma.projectSnapshot.findFirst.mockResolvedValue({ rootDir: mockRootDir });

        fs.existsSync.mockImplementation((p) => {
            return p === mockRootDir || p === mockRootDir + "/cypress" || p === mockRootDir + "/cypress/component" || p.endsWith("package.json") || p.endsWith("Button.cy.jsx");
        });
        fs.readFileSync.mockImplementation((p) => {
            if (p.endsWith("package.json")) return JSON.stringify({});
            return "";
        });

        fs.readdirSync.mockImplementation((p) => {
            if (p === mockRootDir) return ["cypress"];
            if (p === mockRootDir + "/cypress") return ["component"];
            if (p === mockRootDir + "/cypress/component") return ["Button.cy.jsx"];
            return [];
        });

        const result = await detectCypressMetadata(projectId);

        expect(result.detected).toBe(true);
        expect(result.testDirectory).toBe("cypress/component");
        expect(result.testFiles).toContain("cypress/component/Button.cy.jsx");
    });

    it("should ignore specified directories", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: projectId, rootDir: mockRootDir });
        prisma.projectSnapshot.findFirst.mockResolvedValue({ rootDir: mockRootDir });

        fs.existsSync.mockImplementation((p) => {
            return p === mockRootDir || p === mockRootDir + "/cypress" || p === mockRootDir + "/cypress/e2e" || p === mockRootDir + "/node_modules" || p.endsWith("package.json") || p.endsWith("test.cy.js");
        });
        fs.readFileSync.mockImplementation((p) => {
            if (p.endsWith("package.json")) return JSON.stringify({});
            return "";
        });

        fs.readdirSync.mockImplementation((p) => {
            if (p === mockRootDir) return ["node_modules", "dist", "cypress"];
            if (p === mockRootDir + "/cypress") return ["e2e"];
            if (p === mockRootDir + "/cypress/e2e") return ["test.cy.js"];
            if (p === mockRootDir + "/node_modules") return ["some-lib"];
            return [];
        });

        const result = await detectCypressMetadata(projectId);

        expect(result.testFiles).toContain("cypress/e2e/test.cy.js");
        expect(result.testFiles).not.toContain(expect.stringContaining("node_modules"));
    });

    it("should handle invalid package.json gracefully", async () => {
        prisma.project.findUnique.mockResolvedValue({ id: projectId, rootDir: mockRootDir });
        prisma.projectSnapshot.findFirst.mockResolvedValue({ rootDir: mockRootDir });

        fs.existsSync.mockImplementation((p) => {
            return p === mockRootDir || p.endsWith("package.json");
        });
        fs.readFileSync.mockReturnValue("invalid json");

        const result = await detectCypressMetadata(projectId);
        expect(result.detected).toBe(false);
    });
});