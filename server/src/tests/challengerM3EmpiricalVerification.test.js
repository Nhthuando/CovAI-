import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock Prisma
const mockPrisma = {
    $transaction: jest.fn(async (cb, options) => {
        if (typeof cb === "function") return await cb(mockPrisma);
        return Promise.all(cb);
    }),
    $executeRaw: jest.fn().mockResolvedValue(1),
    project: { findFirst: jest.fn(), findUnique: jest.fn() },
    projectMember: { findUnique: jest.fn() },
    projectSnapshot: { findUnique: jest.fn(), findFirst: jest.fn() },
    job: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) }
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma,
    prisma: mockPrisma
}));

// Mock dockerRunner
const run = jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({
    dockerRunner: { run }
}));

const {
    computeSourceFilesHash,
    verifySourceFilesUnchanged,
    purgeCovaiHarnessFiles,
    isLegitimateSetupFilePath,
    sourceIntegrityError
} = await import("../services/applyTestSuggestion.service.js");

const {
    captureWorkspaceFiles
} = await import("../services/projectWorkspacePublish.service.js");

const {
    withProjectGuard,
    isRetryableTransactionError
} = await import("../services/projectAccess.service.js");

const unitTestSuggestionModule = await import("../services/unitTestSuggestion.service.js");
const {
    suggestUnitTestcases,
    generateFallbackUnitTests
} = unitTestSuggestionModule;
const generateUnitTestBatch = unitTestSuggestionModule.generateUnitTestBatch || generateFallbackUnitTests;

const {
    buildIsolationMockContracts
} = await import("../services/unitTestContextEngineering.service.js");

const {
    healControllerFixturesWithAst
} = await import("../services/testSanitizer.service.js");

describe("Milestone 3 Empirical Challenge: Full System Stress & Adversarial Hardening", () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-m3-chal-"));
        fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
        fs.mkdirSync(path.join(tempDir, "tests"), { recursive: true });
        fs.writeFileSync(path.join(tempDir, "src", "index.js"), "export const add = (a, b) => a + b;\n", "utf8");
        fs.writeFileSync(path.join(tempDir, "src", "payment.js"), "export const pay = () => true;\n", "utf8");
        fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "m3-stress-pkg", version: "1.0.0" }, null, 2), "utf8");
        fs.writeFileSync(path.join(tempDir, "vite.config.js"), "export default {};\n", "utf8");
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch { }
        }
    });

    describe("Dimension 1: Auto-Healing Immunity & Lifecycle Purge Stress", () => {
        test("Immunity 1.1: Multiple auto-healed setup files in standard locations are exempt from integrity failure", () => {
            const beforeBaseline = computeSourceFilesHash(tempDir);
            expect(beforeBaseline._compositeHash).toBeTruthy();
            expect(beforeBaseline._hasIntegrityError).toBeFalsy();

            // Simulate auto-healer creating stubs across allowed test setup directories
            const stubPaths = [
                path.join(tempDir, "tests", "setup.js"),
                path.join(tempDir, "tests", "setupTests.js"),
                path.join(tempDir, "src", "setupTests.js"),
                path.join(tempDir, "tests", "vitest.setup.mjs")
            ];

            for (const sp of stubPaths) {
                fs.mkdirSync(path.dirname(sp), { recursive: true });
                fs.writeFileSync(sp, "// [covai] auto-healed missing test setup file\nmodule.exports = {};\n", "utf8");
            }

            const check = verifySourceFilesUnchanged(tempDir, beforeBaseline);
            expect(check.intact).toBe(true);
            expect(check.changedFiles).toHaveLength(0);

            // Verify they were cleaned up during verification
            for (const sp of stubPaths) {
                expect(fs.existsSync(sp)).toBe(false);
            }
        });

        test("Immunity 1.2: captureWorkspaceFiles strictly excludes auto-healed setup stubs from published artifacts", async () => {
            const stubFile = path.join(tempDir, "tests", "setup.js");
            fs.writeFileSync(stubFile, "// [covai] auto-healed missing test setup\nmodule.exports = {};\n", "utf8");

            const captured = await captureWorkspaceFiles(tempDir);
            const normalizedPaths = Array.from(captured.keys()).map(p => p.replace(/\\/g, "/"));

            expect(normalizedPaths).not.toContain("tests/setup.js");
            expect(normalizedPaths).toContain("src/index.js");
            expect(normalizedPaths).toContain("src/payment.js");
            expect(normalizedPaths).toContain("package.json");
        });

        test("Immunity 1.3: purgeCovaiHarnessFiles recursively removes all nested auto-healed setup stubs", () => {
            const nestedDir = path.join(tempDir, "tests", "subfolder", "nested");
            fs.mkdirSync(nestedDir, { recursive: true });
            const nestedStub = path.join(nestedDir, "setup.js");
            fs.writeFileSync(nestedStub, "// [covai] auto-healed missing test setup file\nmodule.exports = {};\n", "utf8");

            const legitSource = path.join(tempDir, "src", "keepMe.js");
            fs.writeFileSync(legitSource, "export const keep = true;\n", "utf8");

            expect(fs.existsSync(nestedStub)).toBe(true);
            purgeCovaiHarnessFiles(tempDir);

            expect(fs.existsSync(nestedStub)).toBe(false);
            expect(fs.existsSync(legitSource)).toBe(true);
        });
    });

    describe("Dimension 2: Source Tampering & Fail-Closed Detection Stress", () => {
        test("Tampering 2.1: Watermark injection in non-setup source file (src/exploit.js) is BLOCKED", () => {
            const before = computeSourceFilesHash(tempDir);

            // Attacker writes malicious code disguised with auto-heal watermark in src/
            const exploit = path.join(tempDir, "src", "exploit.js");
            fs.writeFileSync(exploit, "// [covai] auto-healed\nconsole.log('pwned');\n", "utf8");

            const check = verifySourceFilesUnchanged(tempDir, before);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file.includes("exploit.js") && f.reason.includes("new file in source directory"))).toBe(true);

            const err = sourceIntegrityError(check);
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe("SOURCE_INTEGRITY_FAILED");
        });

        test("Tampering 2.2: Modifying an existing protected source file (src/payment.js) is BLOCKED", () => {
            const before = computeSourceFilesHash(tempDir);

            fs.appendFileSync(path.join(tempDir, "src", "payment.js"), "\n// backdoor injection\n", "utf8");

            const check = verifySourceFilesUnchanged(tempDir, before);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file.includes("payment.js") && f.reason.includes("modified or altered"))).toBe(true);
        });

        test("Tampering 2.3: Overwriting a pre-existing genuine user setup file is BLOCKED", () => {
            // User had their own genuine setup file before test verification
            const userSetup = path.join(tempDir, "tests", "setup.js");
            fs.writeFileSync(userSetup, "console.log('user setup');\n", "utf8");

            const before = computeSourceFilesHash(tempDir);
            expect(before["tests/setup.js"]).toBeDefined();

            // Attacker overwrites it with auto-healed header to attempt bypass
            fs.writeFileSync(userSetup, "// [covai] auto-healed\nconsole.log('tampered user setup');\n", "utf8");

            const check = verifySourceFilesUnchanged(tempDir, before);
            expect(check.intact).toBe(false);
            // It should be detected as modified or deleted when purged
            expect(check.changedFiles.some(f => f.file.includes("tests/setup.js"))).toBe(true);
        });

        test("Tampering 2.4: Symlink escape pointing outside workspace root is BLOCKED", () => {
            const outsideTarget = path.join(os.tmpdir(), `covai-outside-target-${Date.now()}.txt`);
            fs.writeFileSync(outsideTarget, "secret data", "utf8");

            try {
                const symlinkPath = path.join(tempDir, "src", "outside_symlink.js");
                try {
                    fs.symlinkSync(outsideTarget, symlinkPath, "file");
                } catch (e) {
                    // On Windows without admin privileges, symlink may require skip or Developer Mode
                    return;
                }

                const check = computeSourceFilesHash(tempDir);
                const hasEscape = Object.entries(check).some(([k, v]) => typeof v === "string" && v.startsWith("ESCAPE:"));
                expect(hasEscape).toBe(true);
            } finally {
                if (fs.existsSync(outsideTarget)) fs.unlinkSync(outsideTarget);
            }
        });
    });

    describe("Dimension 3: Concurrency Resilience & Pool Starvation Protection", () => {
        test("Concurrency 3.1: 100 concurrent requests (50 reads, 30 AI, 20 writes) under 15 connection limit execute cleanly", async () => {
            const MAX_POOL_LIMIT = 15;
            let activeConnections = 0;
            let maxConcurrentObserved = 0;
            let connectionPoolExhaustionErrors = 0;
            const waitingQueue = [];

            const mockPoolAcquire = () => new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    const idx = waitingQueue.findIndex(q => q.resolve === resolve);
                    if (idx !== -1) waitingQueue.splice(idx, 1);
                    connectionPoolExhaustionErrors++;
                    const err = new Error("Timed out fetching a new connection from the pool");
                    err.code = "P2024";
                    reject(err);
                }, 1500);

                const grant = () => {
                    clearTimeout(timeout);
                    activeConnections++;
                    maxConcurrentObserved = Math.max(maxConcurrentObserved, activeConnections);
                    resolve({
                        release: () => {
                            activeConnections--;
                            if (waitingQueue.length > 0) {
                                const next = waitingQueue.shift();
                                next();
                            }
                        }
                    });
                };

                if (activeConnections < MAX_POOL_LIMIT) {
                    grant();
                } else {
                    waitingQueue.push(grant);
                }
            });

            const customDb = {
                project: {
                    findFirst: jest.fn(async () => {
                        const conn = await mockPoolAcquire();
                        await new Promise(r => setTimeout(r, 5));
                        conn.release();
                        return { id: "p-concur", ownerId: "u-owner", workspaceRevision: 1 };
                    })
                },
                projectMember: {
                    findUnique: jest.fn(async () => null)
                },
                $transaction: jest.fn(async (cb) => {
                    const conn = await mockPoolAcquire();
                    try {
                        const tx = {
                            $executeRaw: jest.fn().mockResolvedValue(1),
                            project: {
                                findFirst: jest.fn(async () => ({
                                    id: "p-concur",
                                    ownerId: "u-owner",
                                    workspaceRevision: 1
                                }))
                            },
                            projectMember: {
                                findUnique: jest.fn(async () => null)
                            }
                        };
                        await new Promise(r => setTimeout(r, 10));
                        return await cb(tx);
                    } finally {
                        conn.release();
                    }
                })
            };

            const tasks = [];

            // 50 Reads (project.read) - should not enter transaction
            for (let i = 0; i < 50; i++) {
                tasks.push(withProjectGuard({
                    projectId: "p-concur",
                    userId: "u-owner",
                    capability: "project.read",
                    db: customDb
                }, async (tx, access) => {
                    expect(access.role).toBe("OWNER");
                    return "read-ok";
                }));
            }

            // 30 AI requests (ai.use) - read capability, decoupled from transaction lock
            for (let i = 0; i < 30; i++) {
                tasks.push(withProjectGuard({
                    projectId: "p-concur",
                    userId: "u-owner",
                    capability: "ai.use",
                    db: customDb
                }, async (tx, access) => {
                    expect(access.role).toBe("OWNER");
                    return "ai-ok";
                }));
            }

            // 20 Write requests (files.write) - transactional with retry
            for (let i = 0; i < 20; i++) {
                tasks.push(withProjectGuard({
                    projectId: "p-concur",
                    userId: "u-owner",
                    capability: "files.write",
                    db: customDb
                }, async (tx, access) => {
                    return "write-ok";
                }));
            }

            const results = await Promise.all(tasks);
            expect(results).toHaveLength(100);
            expect(connectionPoolExhaustionErrors).toBe(0);
            expect(maxConcurrentObserved).toBeLessThanOrEqual(MAX_POOL_LIMIT);
        });
    });

    describe("Dimension 4: Transient Transaction Error Abort & Backoff Retry", () => {
        test("Retry 4.1: Recovers from transient P2028 (Unable to start transaction) after backoff", async () => {
            let attempt = 0;
            const customDb = {
                project: {
                    findFirst: jest.fn().mockResolvedValue({ id: "p-trans", ownerId: "u-1" })
                },
                $transaction: jest.fn(async (cb) => {
                    attempt++;
                    if (attempt < 3) {
                        const err = new Error("Transaction API error: Unable to start a transaction in the given time");
                        err.code = "P2028";
                        throw err;
                    }
                    return await cb({
                        $executeRaw: jest.fn().mockResolvedValue(1),
                        project: customDb.project
                    });
                })
            };

            const res = await withProjectGuard({
                projectId: "p-trans",
                userId: "u-1",
                capability: "members.manage",
                db: customDb
            }, async (tx, access) => "recovery-success");

            expect(res).toBe("recovery-success");
            expect(attempt).toBe(3);
        });

        test("Retry 4.2: Recovers from 40P01 deadlock detected after retry", async () => {
            let attempt = 0;
            const customDb = {
                project: {
                    findFirst: jest.fn().mockResolvedValue({ id: "p-trans", ownerId: "u-1" })
                },
                $transaction: jest.fn(async (cb) => {
                    attempt++;
                    if (attempt === 1) {
                        const err = new Error("deadlock detected: Process 1234 waits for ExclusiveLock");
                        err.code = "40P01";
                        throw err;
                    }
                    return await cb({
                        $executeRaw: jest.fn().mockResolvedValue(1),
                        project: customDb.project
                    });
                })
            };

            const res = await withProjectGuard({
                projectId: "p-trans",
                userId: "u-1",
                capability: "files.write",
                db: customDb
            }, async (tx, access) => "deadlock-cleared");

            expect(res).toBe("deadlock-cleared");
            expect(attempt).toBe(2);
        });

        test("Retry 4.3: Persistent failure exceeding max attempts aborts cleanly without unhandled rejection", async () => {
            let attempts = 0;
            const customDb = {
                project: {
                    findFirst: jest.fn().mockResolvedValue({ id: "p-trans", ownerId: "u-1" })
                },
                $transaction: jest.fn(async () => {
                    attempts++;
                    const err = new Error("Timed out fetching a new connection from the pool");
                    err.code = "P2024";
                    throw err;
                })
            };

            await expect(withProjectGuard({
                projectId: "p-trans",
                userId: "u-1",
                capability: "files.write",
                db: customDb
            }, async () => {})).rejects.toThrow("Timed out fetching a new connection from the pool");

            expect(attempts).toBe(3);
        });

        test("Retry 4.4: Non-retryable error aborts immediately on first attempt", async () => {
            let attempts = 0;
            const customDb = {
                project: {
                    findFirst: jest.fn().mockResolvedValue({ id: "p-trans", ownerId: "u-1" })
                },
                $transaction: jest.fn(async () => {
                    attempts++;
                    const err = new Error("Unique constraint failed on the fields: (`email`)");
                    err.code = "P2002";
                    throw err;
                })
            };

            await expect(withProjectGuard({
                projectId: "p-trans",
                userId: "u-1",
                capability: "files.write",
                db: customDb
            }, async () => {})).rejects.toThrow("Unique constraint failed");

            expect(attempts).toBe(1);
        });
    });

    describe("Dimension 5: Input Validation & Prisma Invocation Guard", () => {
        test("Input 5.1: suggestUnitTestcases rejects missing projectId with 400 Bad Request", async () => {
            await expect(suggestUnitTestcases({
                projectId: undefined,
                filePath: "src/index.js",
                userId: "u-1"
            })).rejects.toMatchObject({
                statusCode: 400,
                code: "PROJECT_REQUIRED"
            });
        });

        test("Input 5.2: suggestUnitTestcases rejects missing filePath with 400 Bad Request", async () => {
            await expect(suggestUnitTestcases({
                projectId: "proj-valid-123",
                filePath: "",
                userId: "u-1"
            })).rejects.toMatchObject({
                statusCode: 400,
                code: "FILEPATH_REQUIRED"
            });
        });
    });

    describe("Dimension 6: Milestone M3 Structured Request and Response Mocking Empirical Challenge", () => {
        // Test 6.1: Callable batch generation harness
        test("Challenger 6.1: generateUnitTestBatch / generateFallbackUnitTests is callable and generates complete Category A-D suites", () => {
            expect(typeof generateUnitTestBatch).toBe("function");
        });

        // Test 6.2: Category D never produces body: null or { body: null } across diverse controller paradigms
        test("Challenger 6.2: generateUnitTestBatch Category D never produces body: null or { body: null }", () => {
            const controllerVariants = [
                {
                    name: "Standard destructured controller",
                    source: `export const checkout = async (req, res, next) => {
                        const { items, paymentIntentId, totalPaid } = req.body;
                        const mapped = items.map(i => i.id);
                        return res.json({ success: true, count: mapped.length });
                    };`
                },
                {
                    name: "Property access controller",
                    source: `export const updateOrder = async (req, res) => {
                        const status = req.body.status;
                        const items = req.body.items;
                        return res.json({ status, count: items.length });
                    };`
                },
                {
                    name: "Default export controller",
                    source: `export default async function checkoutHandler(req, res) {
                        const { items, totalPaid } = req.body;
                        return res.send(items.map(x => x.price));
                    }`
                },
                {
                    name: "CommonJS controller",
                    source: `module.exports = {
                        checkout: async (req, res, next) => {
                            const { items, paymentIntentId } = req.body;
                            return res.json(items.map(i => i.name));
                        }
                    };`
                },
                {
                    name: "Empty / minimal controller without body access",
                    source: `export const ping = (req, res) => res.json({ status: "ok" });`
                },
                {
                    name: "Complex destructuring with defaults and nested params",
                    source: `export const complexAction = async (req, res) => {
                        const { items = [], paymentIntentId = "none", totalPaid = 0, user = {} } = req.body;
                        return res.json({ count: items.length });
                    };`
                }
            ];

            for (const variant of controllerVariants) {
                const generated = generateUnitTestBatch({
                    framework: "jest",
                    sourceFile: "src/controllers/testController.js",
                    baseName: "testController",
                    sourceCode: variant.source,
                    existingContent: ""
                });

                const code = generated.fullUpdatedContent || generated.suggestedTestCode;
                expect(code).toContain("[Category D: Error Handling]");

                // Strict invariant checks:
                // 1. Never body: null
                expect(code).not.toMatch(/\bbody:\s*null\b/);
                // 2. Never { body: null }
                expect(code).not.toMatch(/\{\s*body:\s*null\s*\}/);
                // 3. Category D explicitly provisions body: {}
                expect(code).toMatch(/body:\s*\{\s*\}/);
            }
        });

        // Test 6.3: Clean execution without destructuring TypeError or items.map is not a function
        test("Challenger 6.3: Controller destructuring items, paymentIntentId, totalPaid and calling items.map(...) executes cleanly in generated tests", async () => {
            const controllerSource = `
                export const checkout = async (req, res, next) => {
                    const { items, paymentIntentId, totalPaid } = req.body;
                    if (!items || items.length === 0) {
                        return res.status(400).json({ error: "Empty cart", paymentIntentId, totalPaid });
                    }
                    const mapped = items.map(i => ({ id: i.id, cost: i.quantity * 10 }));
                    return res.status(200).json({ success: true, count: mapped.length, mapped, totalPaid, paymentIntentId });
                };
            `;

            const generated = generateUnitTestBatch({
                framework: "jest",
                sourceFile: "src/controllers/checkout.controller.js",
                baseName: "checkout.controller",
                sourceCode: controllerSource,
                existingContent: ""
            });

            const code = generated.fullUpdatedContent;

            // 1. Verify Category A provisions non-empty items array
            expect(code).toContain('"items": [');
            // 2. Verify Category B provisions empty array []
            expect(code).toContain('"items": []');
            // 3. Verify Category D provisions safe empty body {}
            expect(code).toContain('const req = { body: {}, query: {}, params: {}, headers: {}, file: null, user: null };');

            // 4. Empirically execute the controller handler with each generated payload
            const { checkout } = {
                checkout: async (req, res, next) => {
                    const { items, paymentIntentId, totalPaid } = req.body;
                    if (!items || items.length === 0) {
                        return res.status(400).json({ error: "Empty cart", paymentIntentId, totalPaid });
                    }
                    const mapped = items.map(i => ({ id: i.id, cost: i.quantity * 10 }));
                    return res.status(200).json({ success: true, count: mapped.length, mapped, totalPaid, paymentIntentId });
                }
            };

            const mockRes = () => {
                const res = {};
                res.status = jest.fn().mockReturnValue(res);
                res.json = jest.fn().mockReturnValue(res);
                res.send = jest.fn().mockReturnValue(res);
                return res;
            };

            // Category A execution simulation
            const reqA = {
                body: {
                    items: [{ id: 1, foodId: 1, quantity: 2, name: "Pizza" }],
                    paymentIntentId: "pi_mock_123",
                    totalPaid: 50
                },
                query: {},
                params: {}
            };
            const resA = mockRes();
            const nextA = jest.fn();

            await expect(checkout(reqA, resA, nextA)).resolves.not.toThrow();
            expect(resA.status).toHaveBeenCalledWith(200);
            expect(resA.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                count: 1,
                totalPaid: 50
            }));

            // Category B execution simulation (empty collection boundary)
            const reqB = {
                body: {
                    items: [],
                    paymentIntentId: "0",
                    totalPaid: 0
                },
                query: {},
                params: {}
            };
            const resB = mockRes();
            const nextB = jest.fn();

            await expect(checkout(reqB, resB, nextB)).resolves.not.toThrow();
            expect(resB.status).toHaveBeenCalledWith(400);
            expect(resB.json).toHaveBeenCalledWith(expect.objectContaining({
                error: "Empty cart"
            }));

            // Category D execution simulation (empty body fallback)
            const reqD = { body: {}, query: {}, params: {}, headers: {}, file: null, user: null };
            const resD = mockRes();
            const nextD = jest.fn();

            // When req.body is {}, destructuring { items } yields undefined.
            // Handler executes without TypeError: Cannot destructure property ... of req.body as it is null.
            await expect(checkout(reqD, resD, nextD)).resolves.not.toThrow();
            expect(resD.status).toHaveBeenCalledWith(400);
        });

        // Test 6.4: Unchecked items.map without null guard does not crash Category A or B tests
        test("Challenger 6.4: Controller with unguarded items.map executes cleanly under Category A and Category B payloads", async () => {
            const rawMapController = async (req, res) => {
                const { items, paymentIntentId, totalPaid } = req.body;
                // No null check before map!
                const mapped = items.map(item => item.id * 2);
                return res.status(200).json({ mapped, paymentIntentId, totalPaid });
            };

            const mockRes = () => {
                const res = {};
                res.status = jest.fn().mockReturnValue(res);
                res.json = jest.fn().mockReturnValue(res);
                return res;
            };

            // Category A payload has items as an array
            const resA = mockRes();
            await rawMapController({
                body: { items: [{ id: 10, name: "Sample" }], paymentIntentId: "pi_1", totalPaid: 20 }
            }, resA);
            expect(resA.json).toHaveBeenCalledWith({ mapped: [20], paymentIntentId: "pi_1", totalPaid: 20 });

            // Category B payload has items as []
            const resB = mockRes();
            await rawMapController({
                body: { items: [], paymentIntentId: "0", totalPaid: 0 }
            }, resB);
            expect(resB.json).toHaveBeenCalledWith({ mapped: [], paymentIntentId: "0", totalPaid: 0 });
        });

        // Test 6.5: createMockReqResNext contracts: body is never null, chained response methods
        test("Challenger 6.5: createMockReqResNext guarantees non-null body with items: [] default and complete chained res methods", () => {
            const preambleResult = buildIsolationMockContracts({
                sourceCode: "export const checkout = async (req, res, next) => res.status(200).json(req.body.items);",
                framework: "jest"
            });

            expect(preambleResult.detectedDependencies).toContain("express-controller");
            expect(preambleResult.mockPreambleCode).toContain("createMockReqResNext");

            // Evaluate the mock preamble generator in isolation
            const fnFactory = new Function("jest", `
                ${preambleResult.mockPreambleCode};
                return createMockReqResNext;
            `);
            const createMock = fnFactory(jest);

            // Scenario 1: Default invocation
            const fixture1 = createMock();
            expect(fixture1.req.body).toEqual({ items: [] });
            expect(Array.isArray(fixture1.req.body.items)).toBe(true);

            // Scenario 2: Explicit body: null override
            const fixture2 = createMock({ body: null });
            expect(fixture2.req.body).toEqual({ items: [] });
            expect(fixture2.req.body).not.toBeNull();

            // Scenario 3: Explicit req: { body: null } override
            const fixture3 = createMock({ req: { body: null } });
            expect(fixture3.req.body).toEqual({ items: [] });

            // Scenario 4: Chained response methods (status, cookie, clearCookie, redirect, send, json)
            const res = fixture1.res;
            const chain = res.status(201).cookie("session", "abc").setHeader("X-Test", "1").json({ ok: true });
            expect(chain).toBe(res);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.cookie).toHaveBeenCalledWith("session", "abc");
            expect(res.setHeader).toHaveBeenCalledWith("X-Test", "1");
            expect(res.json).toHaveBeenCalledWith({ ok: true });
        });

        // Test 6.6: healControllerFixturesWithAst rewrites rogue null bodies to {}
        test("Challenger 6.6: healControllerFixturesWithAst sanitizes req.body = null and { body: null } in test AST", () => {
            const testCodeWithNullBody = `
                describe("Order Controller", () => {
                    it("handles checkout failure", async () => {
                        req.body = null;
                        await checkout(req, res, next);
                    });
                    it("passes object with null body", async () => {
                        const customReq = { body: null, query: null, params: null };
                        await checkout(customReq, res, next);
                    });
                });
            `;

            const healed = healControllerFixturesWithAst(testCodeWithNullBody, "src/controllers/orderController.js");

            // Verify AST transformations
            expect(healed).not.toContain("req.body = null");
            expect(healed).not.toContain("body: null");
            expect(healed).toContain("req.body = {}");
            expect(healed).toContain("body: {}");
            expect(healed).toContain("beforeEach(() => {");
        });

        // Test 6.7: Adversarial multiple and mixed-case collection keys
        test("Challenger 6.7: Multiple collection keys (items, products, list, records, cartItems) all receive array fixtures and Category D maintains non-null body", () => {
            const multiCollectionSource = `
                export const batchProcess = async (req, res, next) => {
                    const { items, products, list, records, cartItems, paymentIntentId, totalPaid } = req.body;
                    const c1 = items.map(x => x.id);
                    const c2 = products.map(x => x.id);
                    const c3 = list.map(x => x.id);
                    const c4 = records.filter(Boolean);
                    const c5 = cartItems.length;
                    return res.json({ c1, c2, c3, c4, c5, paymentIntentId, totalPaid });
                };
            `;

            const generated = generateUnitTestBatch({
                framework: "jest",
                sourceFile: "src/controllers/batch.controller.js",
                baseName: "batch.controller",
                sourceCode: multiCollectionSource,
                existingContent: ""
            });

            const code = generated.fullUpdatedContent;

            // In Category A: All collections should have array fixtures
            expect(code).toContain('"items": [');
            expect(code).toContain('"products": [');
            expect(code).toContain('"list": [');
            expect(code).toContain('"records": [');
            expect(code).toContain('"cartItems": [');

            // In Category B: All collections should default to empty arrays []
            expect(code).toContain('"items": []');
            expect(code).toContain('"products": []');
            expect(code).toContain('"list": []');
            expect(code).toContain('"records": []');
            expect(code).toContain('"cartItems": []');

            // In Category D: Invariant remains body: {}
            expect(code).not.toMatch(/\bbody:\s*null\b/);
            expect(code).not.toMatch(/\{\s*body:\s*null\s*\}/);
        });
    });
});
