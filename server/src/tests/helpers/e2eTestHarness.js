/**
 * e2eTestHarness.js
 * Reusable End-to-End Test Harness & Fixture Infrastructure for CovAI-
 *
 * Provides isolated test workspaces, Express coverage app mounting without server side-effects,
 * deterministic JWT auth headers, in-memory Prisma client mocking, LLM Gemini provider stubs,
 * synthetic runner execution, and Socket.IO event inspection.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import express from "express";
import { jest } from "@jest/globals";
import { dockerRunner } from "../../services/dockerRunner.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, "../../..");
const TEMP_BASE_DIR = path.join(SERVER_DIR, ".covai-temp");

// Ensure .covai-temp directory exists on load
if (!fs.existsSync(TEMP_BASE_DIR)) {
    try {
        fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });
    } catch (_) {}
}

/**
 * 1. Creates an isolated test Express application mounting /api/coverage.
 * Decoupled from server/index.js to prevent background workers and port binding collisions.
 *
 * @param {Object} [options]
 * @param {express.Router} [options.coverageRoute] - Optional custom router
 * @param {express.Router} [options.router] - Alias for coverageRoute
 * @returns {Promise<express.Application>}
 */
export async function createCoverageTestApp(options = {}) {
    const app = express();
    app.use(express.json());

    let router = options.coverageRoute || options.router;
    if (!router) {
        const routeModule = await import("../../routes/coverage.route.js");
        router = routeModule.default;
    }
    app.use("/api/coverage", router);

    // Standardized JSON error response handler
    app.use((err, req, res, next) => {
        const status = err.status || err.statusCode || 500;
        res.status(status).json({
            success: false,
            message: err.message || "Internal server error",
            code: err.code || "INTERNAL_ERROR"
        });
    });

    return app;
}

/**
 * 2. Generates a signed JWT bearer auth token string.
 *
 * @param {string} [userId="test-user-id"]
 * @param {Object} [options]
 * @param {string} [options.userName]
 * @param {string} [options.userEmail]
 * @param {string} [options.expiresIn="2h"]
 * @param {Object} [options.claims]
 * @returns {string} Raw JWT token string
 */
export function createTestAuthToken(userId = "test-user-id", options = {}) {
    const secret = process.env.JWT_SECRET || "covai-e2e-jwt-test-secret-key-2026";
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = secret;
    }
    const payload = {
        userId,
        userName: options.userName || "Test User",
        userEmail: options.userEmail || `${userId}@example.com`,
        ...(options.claims || options.payload || {})
    };
    return jwt.sign(payload, secret, { expiresIn: options.expiresIn || "2h" });
}

/**
 * Generates an Authorization header value ("Bearer <token>").
 *
 * @param {string} [userId="test-user-id"]
 * @param {Object} [options]
 * @returns {string} "Bearer <token>"
 */
export function createTestAuthHeader(userId = "test-user-id", options = {}) {
    const token = createTestAuthToken(userId, options);
    return `Bearer ${token}`;
}

/**
 * 3. Builds a high-fidelity in-memory Mock Prisma client.
 * Honors skip/take pagination, where filters, and access controls for snapshots and projects.
 *
 * @param {string} [snapshotId="snap-test-1"]
 * @param {string} [projectId="proj-test-1"]
 * @param {string} [userId="user-test-1"]
 * @param {string} [workspaceDir="/tmp/workspace"]
 * @param {Object} [mockData]
 * @returns {Object} Mock Prisma Client
 */
export function createMockPrisma(
    snapshotId = "snap-test-1",
    projectId = "proj-test-1",
    userId = "user-test-1",
    workspaceDir = "/tmp/workspace",
    mockData = {}
) {
    const files = [...(mockData.files || [])];
    const functions = [...(mockData.functions || [])];
    const summary = mockData.summary || {
        id: "sum-test-1",
        snapshotId,
        linesPct: 85,
        branchesPct: 75,
        funcsPct: 90,
        stmtsPct: 85,
        source: "unit"
    };

    const projectRecord = {
        id: projectId,
        name: "E2E Test Project",
        ownerId: userId,
        workspaceRevision: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...mockData.project
    };

    const snapshotRecord = {
        id: snapshotId,
        projectId,
        project: projectRecord,
        rootDir: workspaceDir,
        storagePath: workspaceDir,
        source: "manual",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...mockData.snapshot
    };

    projectRecord.snapshots = [snapshotRecord];

    const mockPrisma = {
        project: {
            findFirst: jest.fn(async (args) => {
                if (mockData.project === null) return null;
                if (args?.where?.id && args.where.id !== projectId) return null;
                return { ...projectRecord, snapshots: [snapshotRecord] };
            }),
            findUnique: jest.fn(async (args) => {
                if (mockData.project === null) return null;
                if (args?.where?.id && args.where.id !== projectId) return null;
                return { ...projectRecord, snapshots: [snapshotRecord] };
            }),
            update: jest.fn(async (args) => ({ ...projectRecord, ...(args?.data || {}) }))
        },
        projectSnapshot: {
            findFirst: jest.fn(async (args) => {
                if (mockData.snapshot === null) return null;
                if (args?.where?.id && args.where.id !== snapshotId) return null;
                return snapshotRecord;
            }),
            findUnique: jest.fn(async (args) => {
                if (mockData.snapshot === null) return null;
                if (args?.where?.id && args.where.id !== snapshotId) return null;
                return snapshotRecord;
            }),
            update: jest.fn(async (args) => ({ ...snapshotRecord, ...(args?.data || {}) }))
        },
        projectMember: {
            findUnique: jest.fn(async () => {
                if (mockData.member !== undefined) return mockData.member;
                return {
                    id: "mem-test-1",
                    projectId,
                    userId,
                    role: "OWNER",
                    disciplineRole: "PM"
                };
            }),
            findFirst: jest.fn(async () => mockData.member || null)
        },
        coverageFile: {
            findMany: jest.fn(async (args = {}) => {
                let result = [...files];
                if (args?.where?.snapshotId && args.where.snapshotId !== snapshotId) {
                    result = result.filter(f => f.snapshotId === args.where.snapshotId);
                }
                if (args?.where?.filePath?.contains) {
                    result = result.filter(f => f.filePath && f.filePath.includes(args.where.filePath.contains));
                }
                if (args?.where?.type) {
                    result = result.filter(f => !f.type || f.type === args.where.type);
                }
                if (args?.orderBy) {
                    const [field, order] = Object.entries(args.orderBy)[0] || [];
                    if (field) {
                        result.sort((a, b) => {
                            const valA = a[field] ?? 0;
                            const valB = b[field] ?? 0;
                            if (valA < valB) return order === "desc" ? 1 : -1;
                            if (valA > valB) return order === "desc" ? -1 : 1;
                            return 0;
                        });
                    }
                }
                const skip = args?.skip || 0;
                const take = args?.take !== undefined ? args.take : result.length;
                return result.slice(skip, skip + take);
            }),
            count: jest.fn(async (args = {}) => {
                let result = [...files];
                if (args?.where?.snapshotId && args.where.snapshotId !== snapshotId) {
                    result = result.filter(f => f.snapshotId === args.where.snapshotId);
                }
                if (args?.where?.filePath?.contains) {
                    result = result.filter(f => f.filePath && f.filePath.includes(args.where.filePath.contains));
                }
                return result.length;
            }),
            findFirst: jest.fn(async (args = {}) => {
                return files.find(f => !args?.where?.filePath || f.filePath === args.where.filePath) || null;
            }),
            findUnique: jest.fn(async (args = {}) => {
                return files.find(f => f.id === args?.where?.id) || null;
            })
        },
        coverageFunction: {
            findMany: jest.fn(async (args = {}) => {
                let result = [...functions];
                if (args?.where?.snapshotId && args.where.snapshotId !== snapshotId) {
                    result = result.filter(fn => fn.snapshotId === args.where.snapshotId);
                }
                if (args?.where?.filePath) {
                    if (typeof args.where.filePath === "string") {
                        result = result.filter(fn => fn.filePath === args.where.filePath);
                    } else if (args.where.filePath.contains) {
                        const needle = args.where.filePath.contains.toLowerCase();
                        result = result.filter(fn => fn.filePath && fn.filePath.toLowerCase().includes(needle));
                    }
                }
                if (args?.orderBy) {
                    const [field, order] = Object.entries(args.orderBy)[0] || [];
                    if (field) {
                        result.sort((a, b) => {
                            const valA = a[field] ?? 0;
                            const valB = b[field] ?? 0;
                            if (valA < valB) return order === "desc" ? 1 : -1;
                            if (valA > valB) return order === "desc" ? -1 : 1;
                            return 0;
                        });
                    }
                }
                const skip = args?.skip || 0;
                const take = args?.take !== undefined ? args.take : result.length;
                return result.slice(skip, skip + take);
            }),
            count: jest.fn(async (args = {}) => {
                let result = [...functions];
                if (args?.where?.snapshotId && args.where.snapshotId !== snapshotId) {
                    result = result.filter(fn => fn.snapshotId === args.where.snapshotId);
                }
                if (args?.where?.filePath) {
                    if (typeof args.where.filePath === "string") {
                        result = result.filter(fn => fn.filePath === args.where.filePath);
                    } else if (args.where.filePath.contains) {
                        const needle = args.where.filePath.contains.toLowerCase();
                        result = result.filter(fn => fn.filePath && fn.filePath.toLowerCase().includes(needle));
                    }
                }
                return result.length;
            })
        },
        coverageSummary: {
            findUnique: jest.fn(async () => summary),
            findFirst: jest.fn(async () => summary)
        },
        testRun: {
            findFirst: jest.fn(async () => mockData.testRun || null),
            findMany: jest.fn(async () => mockData.testRuns || []),
            create: jest.fn(async (args) => ({ id: "run-test-1", ...args?.data })),
            update: jest.fn(async (args) => ({ id: "run-test-1", ...args?.data }))
        },
        job: {
            findFirst: jest.fn(async () => mockData.job || null),
            findUnique: jest.fn(async () => mockData.job || null),
            create: jest.fn(async (args) => ({ id: "job-test-1", status: "QUEUED", ...args?.data })),
            update: jest.fn(async (args) => ({ id: "job-test-1", ...args?.data }))
        },
        aiTest: {
            findFirst: jest.fn(async () => mockData.aiTest || null),
            findMany: jest.fn(async () => mockData.aiTests || []),
            create: jest.fn(async (args) => ({ id: "ai-test-1", ...args?.data })),
            update: jest.fn(async (args) => ({ id: "ai-test-1", ...args?.data }))
        },
        $transaction: jest.fn(async (callbackOrArray) => {
            if (typeof callbackOrArray === "function") {
                return callbackOrArray(mockPrisma);
            }
            if (Array.isArray(callbackOrArray)) {
                return Promise.all(callbackOrArray);
            }
            return callbackOrArray;
        }),
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([]),
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        $extends: jest.fn(() => mockPrisma)
    };

    return mockPrisma;
}

/**
 * Installs the mock Prisma client into the application's config proxy.
 *
 * @param {Object} mockPrisma
 */
export async function installMockPrisma(mockPrisma) {
    const { setPrismaClient } = await import("../../config/prisma.js");
    if (typeof setPrismaClient === "function") {
        setPrismaClient(mockPrisma);
    }
}

// Internal Gemini mock function reference
let activeGeminiMockFn = jest.fn();

/**
 * 4. Stubs the Gemini LLM provider to return deterministic JSON test suites without network delays.
 *
 * @param {Function|string|Object} [generatorFnOrResponses]
 * @param {Object} [geminiModule] - Optional loaded module to spyOn directly
 * @returns {jest.Mock} The active Jest mock function
 */
export function mockGeminiProvider(generatorFnOrResponses, geminiModule = null) {
    let handler;
    if (typeof generatorFnOrResponses === "function") {
        handler = generatorFnOrResponses;
    } else if (typeof generatorFnOrResponses === "string") {
        handler = async () => generatorFnOrResponses;
    } else if (generatorFnOrResponses && typeof generatorFnOrResponses === "object") {
        const jsonStr = JSON.stringify(generatorFnOrResponses);
        handler = async () => jsonStr;
    } else {
        const defaultResponse = JSON.stringify({
            explanation: "Deterministic unit test suite generated by e2e test harness",
            suggestedTestCode: "describe('target functionality', () => {\n  it('executes primary scenario', () => {\n    expect(true).toBe(true);\n  });\n});",
            fullUpdatedContent: "describe('target functionality', () => {\n  it('executes primary scenario', () => {\n    expect(true).toBe(true);\n  });\n});"
        });
        handler = async () => defaultResponse;
    }

    activeGeminiMockFn.mockReset();
    activeGeminiMockFn.mockImplementation(handler);

    if (geminiModule && typeof geminiModule === "object") {
        try {
            jest.spyOn(geminiModule, "generateText").mockImplementation(handler);
        } catch (_) {}
    }

    return activeGeminiMockFn;
}

/**
 * Returns the currently active Gemini mock function.
 *
 * @returns {jest.Mock}
 */
export function getActiveGeminiMock() {
    return activeGeminiMockFn;
}

/**
 * Creates a complete mock structure for gemini.service.js suitable for jest.unstable_mockModule.
 *
 * @param {Function|string|Object} [defaultResponse]
 * @returns {Object}
 */
export function createGeminiServiceMock(defaultResponse) {
    const mock = mockGeminiProvider(defaultResponse);
    return {
        generateText: mock,
        generateTextWithTelemetry: mock,
        generateMultimodalText: mock,
        getGeminiApiKey: jest.fn().mockReturnValue("mock-gemini-key"),
        getGeminiClient: jest.fn().mockReturnValue({
            getGenerativeModel: jest.fn().mockReturnValue({
                generateContent: jest.fn().mockResolvedValue({
                    response: {
                        text: () => (typeof defaultResponse === "string" ? defaultResponse : JSON.stringify(defaultResponse || {}))
                    }
                })
            })
        }),
        validateGeminiKeys: jest.fn().mockReturnValue(true),
        markModelExhausted: jest.fn()
    };
}

/**
 * 5. Stubs dockerRunner.run and synthesizes fresh coverage artifacts into the workspace.
 * Decouples test execution from host Node/npm/Jest processes and prevents child process hanging.
 *
 * @param {string} [workspaceDir] - Root directory of the test workspace
 * @param {Object} [options]
 * @param {boolean} [options.failed=false] - If true, simulates test failure (exitCode = 1)
 * @param {Object} [options.testResults] - Custom test results payload
 * @param {Object} [options.coverageSummary] - Custom coverage summary payload
 * @param {Object} [options.coverageFinal] - Custom coverage final payload
 * @param {string} [options.stdout]
 * @param {string} [options.stderr]
 * @param {Function} [options.onRun] - Callback when dockerRunner.run is invoked
 * @returns {jest.SpyInstance}
 */
export function mockTestRunner(workspaceDir = "", options = {}) {
    const runnerSpy = jest.spyOn(dockerRunner, "run").mockImplementation(async (params) => {
        const targetDir = params?.snapshotPath || workspaceDir;
        const covDir = path.join(targetDir, "coverage");
        if (!fs.existsSync(covDir)) {
            try {
                fs.mkdirSync(covDir, { recursive: true });
            } catch (_) {}
        }

        const isFailed = Boolean(options.failed);
        const testResults = options.testResults || {
            success: !isFailed,
            numTotalTests: 1,
            numPassedTests: isFailed ? 0 : 1,
            numFailedTests: isFailed ? 1 : 0,
            testResults: [
                {
                    name: options.testFile || "test.js",
                    status: isFailed ? "failed" : "passed",
                    assertionResults: [
                        {
                            title: "executes unit test suite",
                            status: isFailed ? "failed" : "passed"
                        }
                    ]
                }
            ]
        };

        const coverageSummary = options.coverageSummary || {
            total: {
                lines: { total: 10, covered: 9, skipped: 0, pct: 90 },
                statements: { total: 10, covered: 9, skipped: 0, pct: 90 },
                functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
                branches: { total: 4, covered: 3, skipped: 0, pct: 75 }
            }
        };

        const coverageFinal = options.coverageFinal || {
            "src/index.js": {
                path: path.join(targetDir, "src/index.js"),
                statementMap: {},
                fnMap: {},
                branchMap: {},
                s: {},
                f: {},
                b: {}
            }
        };

        // Write synthetic artifacts to coverage directory
        try {
            fs.writeFileSync(path.join(covDir, "jest-results.json"), JSON.stringify(testResults, null, 2));
            fs.writeFileSync(path.join(covDir, "test-results.json"), JSON.stringify(testResults, null, 2));
            fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify(coverageSummary, null, 2));
            fs.writeFileSync(path.join(covDir, "coverage-final.json"), JSON.stringify(coverageFinal, null, 2));

            // Also write to targetDir directly for fallback resolution
            fs.writeFileSync(path.join(targetDir, "jest-results.json"), JSON.stringify(testResults, null, 2));
            fs.writeFileSync(path.join(targetDir, "test-results.json"), JSON.stringify(testResults, null, 2));
            fs.writeFileSync(path.join(targetDir, "coverage-summary.json"), JSON.stringify(coverageSummary, null, 2));
            fs.writeFileSync(path.join(targetDir, "coverage-final.json"), JSON.stringify(coverageFinal, null, 2));
        } catch (_) {}

        if (typeof options.onRun === "function") {
            options.onRun(params);
        }

        const exitCode = isFailed ? 1 : 0;
        return {
            success: exitCode === 0,
            exitCode,
            stdout: options.stdout || (exitCode === 0 ? "PASS test.js\nTests: 1 passed, 1 total" : "FAIL test.js\nTests: 1 failed, 1 total"),
            stderr: options.stderr || ""
        };
    });

    return runnerSpy;
}

/**
 * 6. Creates an isolated temporary directory under server/.covai-temp/ and writes initial files.
 * Adheres strictly to Monorepo Whitelist rules.
 *
 * @param {Object<string, string|Object>} [files={}] - Mapping of relative path to content
 * @returns {string} Absolute path to the created workspace directory
 */
export function createTestWorkspace(files = {}) {
    if (!fs.existsSync(TEMP_BASE_DIR)) {
        fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });
    }

    const uniquePrefix = `e2e-wf-${Date.now()}-${Math.random().toString(36).substring(2, 8)}-`;
    const workspaceDir = fs.mkdtempSync(path.join(TEMP_BASE_DIR, uniquePrefix));

    for (const [relPath, content] of Object.entries(files)) {
        const fullPath = path.join(workspaceDir, relPath);
        const parentDir = path.dirname(fullPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        const serialized = typeof content === "string" ? content : JSON.stringify(content, null, 2);
        fs.writeFileSync(fullPath, serialized, "utf8");
    }

    return workspaceDir;
}

/**
 * 7. Safely removes a test workspace directory with Windows file lock resilience.
 *
 * @param {string} dir - Path to directory
 */
export function cleanTestWorkspace(dir) {
    if (!dir || typeof dir !== "string") return;
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    } catch (_) {
        // Fallback for Windows transient locks
        try {
            setTimeout(() => {
                try {
                    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
                } catch (_) {}
            }, 300);
        } catch (_) {}
    }
}

/**
 * 8. Mock Socket.IO engine capturing room emissions.
 * Records events for unit_test:suggest_progress, unit_test:apply_progress, dashboard:job-progress, etc.
 *
 * @returns {Object} Mock global.io instance with inspection helpers
 */
export function mockSocketIo() {
    const emittedEvents = [];
    const roomEmits = new Map();

    const createRoomEmitter = (roomName) => ({
        emit: jest.fn((event, payload) => {
            const record = { room: roomName, event, payload, timestamp: Date.now() };
            emittedEvents.push(record);
            if (!roomEmits.has(roomName)) {
                roomEmits.set(roomName, []);
            }
            roomEmits.get(roomName).push(record);
            return true;
        })
    });

    const previousIo = global.io;

    const mockIo = {
        to: jest.fn((room) => createRoomEmitter(room)),
        in: jest.fn((room) => createRoomEmitter(room)),
        emit: jest.fn((event, payload) => {
            const record = { room: null, event, payload, timestamp: Date.now() };
            emittedEvents.push(record);
            return true;
        }),
        getEmittedEvents: () => [...emittedEvents],
        getEventsForRoom: (room) => [...(roomEmits.get(room) || [])],
        findEvent: (eventName, room = null) => {
            return emittedEvents.find(e => e.event === eventName && (room === null || e.room === room));
        },
        filterEvents: (eventName, room = null) => {
            return emittedEvents.filter(e => e.event === eventName && (room === null || e.room === room));
        },
        clearEvents: () => {
            emittedEvents.length = 0;
            roomEmits.clear();
        },
        restore: () => {
            global.io = previousIo;
        }
    };

    global.io = mockIo;
    return mockIo;
}

/**
 * Creates mock queue services for BullMQ job queues to avoid Redis connection errors during tests.
 *
 * @returns {Object}
 */
export function createMockQueueService() {
    return {
        jobQueue: {
            add: jest.fn().mockResolvedValue({ id: "mock-queue-job-1" }),
            getJob: jest.fn().mockResolvedValue(null)
        },
        addJobToQueue: jest.fn().mockResolvedValue({ id: "mock-queue-job-1" }),
        addSupertestCoveragePipeline: jest.fn().mockResolvedValue({ id: "mock-queue-job-1" })
    };
}
