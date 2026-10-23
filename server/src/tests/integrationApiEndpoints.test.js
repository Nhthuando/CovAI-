import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

// Mock external services before imports
jest.unstable_mockModule("../services/queue.service.js", () => ({
    addJobToQueue: jest.fn().mockResolvedValue(true),
}));

jest.unstable_mockModule("../services/gemini.service.js", () => ({
    generateText: jest.fn().mockResolvedValue(`
describe("Product API Tests", () => {
    it("should return 200 and products list", async () => {
        const res = await request(app).get("/api/products");
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("data");
    });
});
`),
}));

const {
    normalizeFramework,
    detectIntegrationFrameworksService,
    installIntegrationDependenciesService,
    queueIntegrationTestGenerationService,
    runIntegrationGenerationPipeline,
    queueRegenerateScenarioService,
    runRegenerateScenarioPipeline,
    updateIntegrationScenarioService,
    applyIntegrationTestsService,
} = await import("../services/integrationApiService.service.js");

const prisma = (await import("../config/prisma.js")).default;
const { addJobToQueue } = await import("../services/queue.service.js");
const { generateText } = await import("../services/gemini.service.js");

describe("Phase 4: API Endpoints & Real-time Job Processing Test Suite", () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase4-test-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    describe("Task 4.2: Framework Detection & Automatic Dependency Installation", () => {
        it("should correctly normalize framework identifier", () => {
            expect(normalizeFramework("supertest")).toBe("SUPERTEST");
            expect(normalizeFramework("SUPERTEST")).toBe("SUPERTEST");
            expect(normalizeFramework("playwright")).toBe("PLAYWRIGHT_API");
            expect(normalizeFramework("playwright_api")).toBe("PLAYWRIGHT_API");
            expect(normalizeFramework("PLAYWRIGHT")).toBe("PLAYWRIGHT_API");
        });

        it("should detect frameworks and return standardized structure", async () => {
            // Setup package.json with supertest
            const pkgPath = path.join(tempDir, "package.json");
            fs.writeFileSync(pkgPath, JSON.stringify({
                devDependencies: {
                    supertest: "^6.3.3",
                    jest: "^29.5.0",
                },
            }, null, 2));

            // Create integration test file
            const testDir = path.join(tempDir, "tests", "integration");
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(path.join(testDir, "api.test.js"), "const request = require('supertest');");

            const detection = await detectIntegrationFrameworksService({
                projectId: null,
                snapshotId: null,
                userId: "user-1",
            }).catch(() => null);

            // Directly run detection logic on tempDir
            const { detectIntegrationFrameworks } = await import("../services/integrationDetection.service.js");
            const result = await detectIntegrationFrameworks(tempDir);

            expect(result).toBeDefined();
            expect(result.framework).toBe("supertest");
            expect(result.hasTestFiles).toBe(true);
            expect(result.hasDependencies).toBe(true);
            expect(result.isZeroTestProject).toBe(false);
            expect(result.needsDependencyInstall).toBe(false);
        });

        it("should flag isZeroTestProject when no test files and no dependencies exist", async () => {
            const pkgPath = path.join(tempDir, "package.json");
            fs.writeFileSync(pkgPath, JSON.stringify({
                dependencies: { express: "^4.18.2" },
            }, null, 2));

            const { detectIntegrationFrameworks } = await import("../services/integrationDetection.service.js");
            const result = await detectIntegrationFrameworks(tempDir);

            expect(result.isZeroTestProject).toBe(true);
            expect(result.hasTestFiles).toBe(false);
            expect(result.suggestedFrameworks).toContain("supertest");
            expect(result.suggestedFrameworks).toContain("playwright");
        });
    });

    describe("Task 4.3: Comprehensive AI Test Generation & Regeneration", () => {
        it("should queue integration test generation and invoke addJobToQueue", async () => {
            const mockSnapshotId = "snap-p4-1";
            const mockUserId = "user-p4-1";
            const mockProjectId = "proj-p4-1";

            // Mock prisma calls
            jest.spyOn(prisma.projectSnapshot, "findUnique").mockResolvedValue({
                id: mockSnapshotId,
                projectId: mockProjectId,
                rootDir: tempDir,
                project: { ownerId: mockUserId },
            });

            jest.spyOn(prisma.aiTest, "findMany").mockResolvedValue([]);

            const createdJob = {
                id: "job-p4-gen-1",
                snapshotId: mockSnapshotId,
                projectId: mockProjectId,
                type: "AI_TESTS",
                status: "QUEUED",
            };
            jest.spyOn(prisma.job, "create").mockResolvedValue(createdJob);

            const result = await queueIntegrationTestGenerationService({
                snapshotId: mockSnapshotId,
                userId: mockUserId,
                framework: "playwright",
                targetEndpoints: ["GET /api/items"],
            });

            expect(result).toBeDefined();
            expect(result.job.id).toBe("job-p4-gen-1");
            expect(addJobToQueue).toHaveBeenCalledWith(
                "AI_TESTS",
                "job-p4-gen-1",
                expect.objectContaining({
                    mode: "INTEGRATION_GENERATION",
                    framework: "PLAYWRIGHT_API",
                    targetEndpoints: ["GET /api/items"],
                })
            );
        });

        it("should reject queueing when user-edited scenarios exist and force is false", async () => {
            const mockSnapshotId = "snap-p4-dirty";
            const mockUserId = "user-p4-dirty";

            jest.spyOn(prisma.projectSnapshot, "findUnique").mockResolvedValue({
                id: mockSnapshotId,
                projectId: "proj-1",
                project: { ownerId: mockUserId },
            });

            jest.spyOn(prisma.aiTest, "findMany").mockResolvedValue([
                {
                    id: "test-edited",
                    metaJson: JSON.stringify({
                        framework: "SUPERTEST",
                        requests: [
                            { method: "GET", path: "/api/items", userEdited: true },
                        ],
                    }),
                },
            ]);

            await expect(
                queueIntegrationTestGenerationService({
                    snapshotId: mockSnapshotId,
                    userId: mockUserId,
                    framework: "supertest",
                    targetEndpoints: ["GET /api/items"],
                    force: false,
                })
            ).rejects.toThrow("Cannot overwrite user-edited integration scenarios");
        });

        it("should run integration generation pipeline and persist AiTest records", async () => {
            const mockJobId = "job-exec-1";
            const mockSnapshotId = "snap-exec-1";
            const mockProjectId = "proj-exec-1";

            jest.spyOn(prisma.job, "findUnique").mockResolvedValue({
                id: mockJobId,
                status: "RUNNING",
                snapshot: { rootDir: tempDir },
            });
            jest.spyOn(prisma.job, "update").mockResolvedValue({});
            jest.spyOn(prisma.jobLog, "create").mockResolvedValue({});

            const mockCreatedAiTest = {
                id: "aitest-new-1",
                projectId: mockProjectId,
                snapshotId: mockSnapshotId,
                filePath: "tests/integration/api-integration.test.js",
            };
            jest.spyOn(prisma.aiTest, "create").mockResolvedValue(mockCreatedAiTest);

            const result = await runIntegrationGenerationPipeline({
                jobId: mockJobId,
                snapshotId: mockSnapshotId,
                projectId: mockProjectId,
                framework: "SUPERTEST",
                targetEndpoints: [],
            });

            expect(result).toBeDefined();
            expect(result.aiTestId).toBe("aitest-new-1");
            expect(result.scenariosCount).toBeGreaterThanOrEqual(1);
            expect(generateText).toHaveBeenCalled();
        });

        it("should queue scenario regeneration job", async () => {
            const mockSnapshotId = "snap-regen-1";
            const mockUserId = "user-regen-1";

            jest.spyOn(prisma.projectSnapshot, "findUnique").mockResolvedValue({
                id: mockSnapshotId,
                projectId: "proj-regen-1",
                project: { ownerId: mockUserId },
            });

            const createdJob = {
                id: "job-regen-1",
                status: "QUEUED",
            };
            jest.spyOn(prisma.job, "create").mockResolvedValue(createdJob);

            const result = await queueRegenerateScenarioService({
                snapshotId: mockSnapshotId,
                userId: mockUserId,
                scenarioId: "sc-fail-1",
                framework: "supertest",
                failureContext: {
                    failureLayer: "CONTROLLER_CRASH",
                    failureMessages: ["TypeError: Cannot read properties of null"],
                },
            });

            expect(result.job.id).toBe("job-regen-1");
            expect(addJobToQueue).toHaveBeenCalledWith(
                "AI_TESTS",
                "job-regen-1",
                expect.objectContaining({
                    mode: "INTEGRATION_REGENERATE",
                    scenarioId: "sc-fail-1",
                })
            );
        });
    });

    describe("Task 4.4: Scenario Editing & Source Code Application", () => {
        it("should update an integration scenario by scenarioId in aiTest metadata", async () => {
            const mockSnapshotId = "snap-edit-1";
            const mockUserId = "user-edit-1";
            const targetScenarioId = "sc-uuid-42";

            jest.spyOn(prisma.projectSnapshot, "findUnique").mockResolvedValue({
                id: mockSnapshotId,
                project: { ownerId: mockUserId },
            });

            const existingAiTest = {
                id: "aitest-1",
                content: `
describe("Cart API", () => {
    it("POST /api/cart/checkout should succeed", async () => {
        const res = await request(app).post("/api/cart/checkout").send({ items: [] });
        expect(res.status).toBe(200);
    });
});
`,
                metaJson: JSON.stringify({
                    framework: "SUPERTEST",
                    requests: [
                        {
                            scenarioId: targetScenarioId,
                            testName: "POST /api/cart/checkout should succeed",
                            method: "POST",
                            path: "/api/cart/checkout",
                            expectedStatus: 200,
                            enabled: true,
                        },
                    ],
                }),
            };

            jest.spyOn(prisma.aiTest, "findMany").mockResolvedValue([existingAiTest]);
            jest.spyOn(prisma.aiTest, "update").mockImplementation(async ({ data }) => ({
                ...existingAiTest,
                ...data,
            }));

            const result = await updateIntegrationScenarioService({
                snapshotId: mockSnapshotId,
                scenarioId: targetScenarioId,
                userId: mockUserId,
                updates: {
                    title: "POST /api/cart/checkout - customized title",
                    expectedStatus: 201,
                    enabled: true,
                },
            });

            expect(result.success).toBe(true);
            expect(result.updated).toBe(true);
            expect(prisma.aiTest.update).toHaveBeenCalled();
        });

        it("should apply tests into project source code securely and return suggestRerun", async () => {
            const mockSnapshotId = "snap-apply-1";
            const mockUserId = "user-apply-1";

            // Create server entry file so resolveAppEntryPoint succeeds
            const serverDir = path.join(tempDir, "server");
            fs.mkdirSync(serverDir, { recursive: true });
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ main: "server/app.js" }));
            fs.writeFileSync(path.join(serverDir, "app.js"), "module.exports = {};");

            jest.spyOn(prisma.projectSnapshot, "findUnique").mockResolvedValue({
                id: mockSnapshotId,
                rootDir: tempDir,
                project: { ownerId: mockUserId, rootDir: tempDir },
            });

            const testToApply = {
                id: "aitest-apply-1",
                filePath: "tests/integration/products.test.js",
                content: `
const request = require("supertest");
const app = require("../../server/app.js");

describe("Applied Integration Test", () => {
    it("GET /api/products returns 200", async () => {
        const res = await request(app).get("/api/products");
        expect(res.status).toBe(200);
    });
});
`,
                metaJson: JSON.stringify({
                    framework: "SUPERTEST",
                    status: "DRAFT",
                    requests: [{ testName: "GET /api/products returns 200" }],
                }),
            };

            jest.spyOn(prisma.aiTest, "findMany").mockResolvedValue([testToApply]);
            jest.spyOn(prisma.aiTest, "update").mockResolvedValue({ ...testToApply });

            const result = await applyIntegrationTestsService({
                snapshotId: mockSnapshotId,
                userId: mockUserId,
                testIds: ["aitest-apply-1"],
                fileName: "products.test.js",
            });

            expect(result.success).toBe(true);
            expect(result.suggestRerun).toBe(true);
            expect(result.appliedFiles).toHaveLength(1);

            // Check that the file was written to disk
            const writtenPath = path.join(tempDir, "tests", "integration", "products.test.js");
            expect(fs.existsSync(writtenPath)).toBe(true);
            const writtenContent = fs.readFileSync(writtenPath, "utf8");
            expect(writtenContent).toContain("Applied Integration Test");
        });

        it("should reject apply tests when path traversal is attempted", async () => {
            const mockSnapshotId = "snap-malicious";
            const mockUserId = "user-malicious";

            jest.spyOn(prisma.projectSnapshot, "findUnique").mockResolvedValue({
                id: mockSnapshotId,
                rootDir: tempDir,
                project: { ownerId: mockUserId },
            });

            const testToApply = {
                id: "aitest-bad",
                content: "it('exploit', () => {});",
                metaJson: JSON.stringify({ framework: "SUPERTEST" }),
            };

            jest.spyOn(prisma.aiTest, "findMany").mockResolvedValue([testToApply]);

            await expect(
                applyIntegrationTestsService({
                    snapshotId: mockSnapshotId,
                    userId: mockUserId,
                    targetFilePath: "../../etc/passwd",
                })
            ).rejects.toThrow();
        });
    });
});

