import fs from "fs";
import path from "path";
import os from "os";
import {
    detectIntegrationFrameworks,
    classifyIntegrationPermutation,
    analyzeTestFileContent,
    installIntegrationDependencies,
} from "../services/integrationDetection.service.js";
import { dockerRunner } from "../services/dockerRunner.service.js";

describe("Phase 1: Integration Testing Detection & 4 Permutations Engine", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-integration-test-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
        } catch (_) {}
    });

    describe("Task 1.2: Playwright API Testing & Dual-Framework Detection", () => {
        test("should identify Playwright API test syntax vs Supertest syntax", () => {
            const supertestCode = "import request from 'supertest';\nconst res = await request(app).get('/api/users');";
            const playwrightCode = "import { test, expect } from '@playwright/test';\ntest('get users', async ({ request }) => {\n  const res = await request.get('/api/users');\n});";
            const genericUnitTest = "test('math', () => { expect(1 + 1).toBe(2); });";

            const stAnalysis = analyzeTestFileContent(supertestCode);
            expect(stAnalysis.isSupertest).toBe(true);
            expect(stAnalysis.isPlaywrightApi).toBe(false);

            const pwAnalysis = analyzeTestFileContent(playwrightCode);
            expect(pwAnalysis.isPlaywrightApi).toBe(true);
            expect(pwAnalysis.isSupertest).toBe(false);

            const genericAnalysis = analyzeTestFileContent(genericUnitTest);
            expect(genericAnalysis.isSupertest).toBe(false);
            expect(genericAnalysis.isPlaywrightApi).toBe(false);
        });

        test("should detect Playwright API dependency, configuration and test files", async () => {
            fs.writeFileSync(
                path.join(tempDir, "package.json"),
                JSON.stringify({
                    devDependencies: { "@playwright/test": "^1.40.0" },
                    scripts: { test: "playwright test" },
                })
            );
            fs.writeFileSync(path.join(tempDir, "playwright.config.js"), "module.exports = {};");
            fs.mkdirSync(path.join(tempDir, "tests"), { recursive: true });
            fs.writeFileSync(
                path.join(tempDir, "tests", "users.api.test.js"),
                "import { test, expect } from '@playwright/test';\ntest('test api', async ({ request }) => {\n  await request.get('/api/users');\n});"
            );

            const result = await detectIntegrationFrameworks(tempDir);
            expect(result.detected).toBe(true);
            expect(result.primaryFramework).toBe("playwright");
            expect(result.playwrightApi.detected).toBe(true);
            expect(result.playwrightApi.hasDep).toBe(true);
            expect(result.playwrightApiFiles).toHaveLength(1);
            expect(result.runner).toBe("playwright");
            expect(result.configFile).toBe("playwright.config.js");
            expect(result.permutation).toBe("HAS_TESTS_AND_DEPS");
        });
    });

    describe("Task 1.3: 4 Permutations Engine", () => {
        test("Permutation A (HAS_TESTS_AND_DEPS): ready for execution", () => {
            const detection = {
                hasTestFiles: true,
                hasDependencies: true,
                supertest: { files: ["tests/api.test.js"], hasDep: true },
                playwrightApi: { files: [], hasDep: false },
            };

            const perm = classifyIntegrationPermutation(detection);
            expect(perm.permutation).toBe("HAS_TESTS_AND_DEPS");
            expect(perm.readyForExecution).toBe(true);
            expect(perm.isZeroTestProject).toBe(false);
            expect(perm.needsUserSelection).toBe(false);
            expect(perm.needsInstall).toBe(false);
            expect(perm.targetFramework).toBe("supertest");
        });

        test("Permutation B (ZERO_TESTS_NO_DEPS): prompts user selection between Supertest and Playwright", () => {
            const detection = {
                hasTestFiles: false,
                hasDependencies: false,
                supertest: { files: [], hasDep: false },
                playwrightApi: { files: [], hasDep: false },
            };

            const perm = classifyIntegrationPermutation(detection);
            expect(perm.permutation).toBe("ZERO_TESTS_NO_DEPS");
            expect(perm.readyForExecution).toBe(false);
            expect(perm.isZeroTestProject).toBe(true);
            expect(perm.needsUserSelection).toBe(true);
            expect(perm.needsInstall).toBe(false);
            expect(perm.proposedFrameworks).toHaveLength(2);
            expect(perm.proposedFrameworks.map((f) => f.id)).toEqual(["supertest", "playwright"]);
        });

        test("Permutation C (HAS_DEPS_NO_TESTS): automatically targets installed framework for Cold-Start", () => {
            const detection = {
                hasTestFiles: false,
                hasDependencies: true,
                supertest: { files: [], hasDep: false },
                playwrightApi: { files: [], hasDep: true },
            };

            const perm = classifyIntegrationPermutation(detection);
            expect(perm.permutation).toBe("HAS_DEPS_NO_TESTS");
            expect(perm.readyForExecution).toBe(false);
            expect(perm.isZeroTestProject).toBe(true);
            expect(perm.needsUserSelection).toBe(false);
            expect(perm.needsInstall).toBe(false);
            expect(perm.targetFramework).toBe("playwright");
        });

        test("Permutation D (HAS_TESTS_NO_DEPS): infers required library and builds install command", () => {
            const detection = {
                hasTestFiles: true,
                hasDependencies: false,
                supertest: { files: ["tests/integration.spec.js"], hasDep: false },
                playwrightApi: { files: [], hasDep: false },
            };

            const perm = classifyIntegrationPermutation(detection);
            expect(perm.permutation).toBe("HAS_TESTS_NO_DEPS");
            expect(perm.readyForExecution).toBe(false);
            expect(perm.isZeroTestProject).toBe(false);
            expect(perm.needsUserSelection).toBe(false);
            expect(perm.needsInstall).toBe(true);
            expect(perm.inferredFramework).toBe("supertest");
            expect(perm.missingPackages).toEqual(["supertest", "jest"]);
            expect(perm.installCommand).toBe("npm install --save-dev supertest jest");
            expect(perm.confirmActionText).toBe("Cài đặt thư viện phát hiện & Chạy tiếp");
        });
    });

    describe("Dependency Installer Service", () => {
        test("should update package.json when installing integration dependencies", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "sample-app" }, null, 2));

            const origRun = dockerRunner.run;
            let runCalled = false;
            dockerRunner.run = async () => {
                runCalled = true;
                return { success: true, exitCode: 0, stdout: "added 2 packages", stderr: "" };
            };

            try {
                const res = await installIntegrationDependencies({
                    rootDir: tempDir,
                    packages: ["supertest", "jest"],
                    framework: "supertest",
                });

                expect(runCalled).toBe(true);
                expect(res.packages).toEqual(["supertest", "jest"]);

                const updatedPkg = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf8"));
                expect(updatedPkg.devDependencies).toBeDefined();
                expect(updatedPkg.devDependencies.supertest).toBeDefined();
                expect(updatedPkg.devDependencies.jest).toBeDefined();
            } finally {
                dockerRunner.run = origRun;
            }
        });
    });
});
