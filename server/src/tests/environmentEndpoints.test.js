/**
 * server/src/tests/environmentEndpoints.test.js
 *
 * Comprehensive Integration Test Suite for Milestone 2:
 * Backend API Endpoints, Workspace Persistence & Test Runner Integration.
 *
 * Suite 1: GET  /api/coverage/:snapshotId/unit/env-check (Pre-flight check)
 * Suite 2: POST /api/coverage/:snapshotId/unit/env (Persistence & Run Trigger)
 * Suite 3: Hermetic Fallback Runner Execution (useHermeticMock: true)
 * Suite 4: Runner Precedence Invariant (Explicit > .env.test > .env > .env.example > Hermetic Mock)
 */

import express from "express";
import request from "supertest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import jwt from "jsonwebtoken";
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

const TEST_JWT_SECRET = "covai_jwt_secret_for_endpoints_test_32chars";
process.env.JWT_SECRET = TEST_JWT_SECRET;

const mockSnapshotId = "snapshot-env-test-123";
const mockProjectId = "project-env-test-123";
const mockUserId = "user-test-123";

let currentWorkspaceDir = null;

// Mock Prisma
const prismaMock = {
  projectSnapshot: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  project: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  projectFileVersion: {
    findUnique: jest.fn(),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  },
  projectOperationRequest: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
  },
  projectOperation: {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((args) => Promise.resolve({ id: "op-1", primaryJobId: "job-run-test-456", status: "QUEUED", ...args.data })),
    update: jest.fn().mockResolvedValue({}),
  },
  jobLog: {
    create: jest.fn().mockResolvedValue({}),
  },
  job: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockImplementation((args) => Promise.resolve({ id: args?.where?.id || "job-run-test-456", status: "QUEUED" })),
    create: jest.fn().mockImplementation((args) => Promise.resolve({ id: "job-run-test-456", reused: false, ...args.data })),
    update: jest.fn().mockResolvedValue({}),
  },
  testRun: {
    create: jest.fn().mockResolvedValue({ id: "tr-1" }),
  },
};

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: prismaMock,
}));

// Mock BullMQ Queue Service
const mockAddJobToQueue = jest.fn().mockResolvedValue({ id: "bull-job-123" });
jest.unstable_mockModule("../services/queue.service.js", () => ({
  addJobToQueue: mockAddJobToQueue,
  jobQueue: { add: jest.fn() },
  addSupertestCoveragePipeline: jest.fn(),
}));

// Mock Project Access Guard to authorize mock user
jest.unstable_mockModule("../services/projectAccess.service.js", () => ({
  membershipWhere: jest.fn(() => ({})),
  resolveProjectAccess: jest.fn().mockResolvedValue({ role: "OWNER", project: { id: mockProjectId, workspaceRevision: 1 } }),
  resolveSnapshotAccess: jest.fn().mockResolvedValue({ role: "OWNER", project: { id: mockProjectId, workspaceRevision: 1 } }),
  withProjectGuard: jest.fn((opts, fn) => fn(prismaMock, { project: { id: opts?.projectId || mockProjectId, workspaceRevision: 1 } })),
}));

// Mock Project Mutation to write to current workspace directory and return revision
const mockMutateProjectWorkspace = jest.fn().mockImplementation(async (args) => {
  if (currentWorkspaceDir) {
    fs.writeFileSync(path.join(currentWorkspaceDir, ".env"), args.content, "utf8");
  }
  return {
    workspaceRevision: (args.expectedWorkspaceRevision || 1) + 1,
    path: ".env",
  };
});
jest.unstable_mockModule("../services/projectMutation.service.js", () => ({
  mutateProjectWorkspace: mockMutateProjectWorkspace,
}));

// Import controllers, routes, and runner helpers after registering mocks
const {
  checkUnitTestEnvironment,
  saveUnitTestEnvironment,
  runCoverageByType,
  runCoverage,
} = await import("../controllers/coverage.controller.js");

const { buildSetupContent } = await import("../services/runTestsJob.service.js");
const coverageRouter = (await import("../routes/coverage.route.js")).default;

describe("Milestone 2: Environment Endpoints & Test Runner Integration", () => {
  let tempDir;
  let app;
  let validAuthHeader;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "covai-m2-endpoints-"));
    currentWorkspaceDir = tempDir;

    // Create a default package.json in workspace root
    await fsp.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "covai-test-workspace", version: "1.0.0" }),
      "utf8"
    );

    // Reset mocks
    jest.clearAllMocks();

    // Default snapshot resolution
    const defaultSnapshot = {
      id: mockSnapshotId,
      projectId: mockProjectId,
      rootDir: tempDir,
      project: { id: mockProjectId, ownerId: mockUserId, name: "Test Project" },
    };
    prismaMock.projectSnapshot.findUnique.mockImplementation(async (query) => {
      if (query?.where?.id === mockSnapshotId) return defaultSnapshot;
      return null;
    });
    prismaMock.projectSnapshot.findFirst.mockImplementation(async (query) => {
      if (
        query?.where?.id === mockSnapshotId ||
        query?.where?.projectId === mockSnapshotId ||
        query?.where?.projectId === mockProjectId
      ) {
        return defaultSnapshot;
      }
      return null;
    });
    prismaMock.project.findUnique.mockResolvedValue({ id: mockProjectId, ownerId: mockUserId, workspaceRevision: 1 });
    prismaMock.project.findFirst.mockResolvedValue({ id: mockProjectId, ownerId: mockUserId, workspaceRevision: 1 });
    prismaMock.job.create.mockImplementation((args) =>
      Promise.resolve({ id: "job-run-test-456", reused: false, ...args.data })
    );

    // Generate valid JWT token
    const token = jwt.sign(
      { userId: mockUserId, userName: "Worker M2", userEmail: "worker_m2@covai.dev" },
      TEST_JWT_SECRET
    );
    validAuthHeader = `Bearer ${token}`;

    // Create test Express app mounting the actual coverage router
    app = express();
    app.use(express.json());
    app.use("/api/coverage", coverageRouter);
  });

  afterEach(async () => {
    currentWorkspaceDir = null;
    if (tempDir && fs.existsSync(tempDir)) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // =========================================================================
  // SUITE 1: GET /api/coverage/:snapshotId/unit/env-check
  // =========================================================================
  describe("Suite 1: GET /:snapshotId/unit/env-check (Pre-flight check)", () => {
    it("T1-1: returns requiresPrompt: true and missingRequired list when mandatory variables lack defaults", async () => {
      // Logic file with strictly required variable (no fallback)
      await fsp.writeFile(
        path.join(tempDir, "db.js"),
        'const db = process.env.DATABASE_URL;\nif (!db) throw new Error("DATABASE_URL is required");\nexport default db;',
        "utf8"
      );

      const res = await request(app)
        .get(`/api/coverage/${mockSnapshotId}/unit/env-check`)
        .set("Authorization", validAuthHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requiresPrompt).toBe(true);
      expect(res.body.data.missingRequired).toContain("DATABASE_URL");
      expect(res.body.data.detectedVariables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "DATABASE_URL",
            required: true,
            hasDefault: false,
            inferredMock: expect.stringMatching(/postgresql|database/i),
          }),
        ])
      );
    });

    it("T1-2: returns requiresPrompt: false when all env variables have default expressions", async () => {
      await fsp.writeFile(
        path.join(tempDir, "server.js"),
        'const port = process.env.PORT || 3000;\nconst mode = process.env.NODE_ENV ?? "development";\nexport { port, mode };',
        "utf8"
      );

      const res = await request(app)
        .get(`/api/coverage/${mockSnapshotId}/unit/env-check`)
        .set("Authorization", validAuthHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requiresPrompt).toBe(false);
      expect(res.body.data.missingRequired).toEqual([]);
      expect(res.body.data.detectedVariables.length).toBeGreaterThanOrEqual(2);
    });

    it("T1-3: returns requiresPrompt: false when missing variables are already defined in workspace .env", async () => {
      await fsp.writeFile(
        path.join(tempDir, "auth.js"),
        'const secret = process.env.JWT_SECRET;\nif (!secret) throw new Error("JWT_SECRET required");',
        "utf8"
      );
      await fsp.writeFile(
        path.join(tempDir, ".env"),
        "JWT_SECRET=super_configured_secret_value_1234\n",
        "utf8"
      );

      const res = await request(app)
        .get(`/api/coverage/${mockSnapshotId}/unit/env-check`)
        .set("Authorization", validAuthHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requiresPrompt).toBe(false);
      expect(res.body.data.missingRequired).toEqual([]);
      expect(res.body.data.existingVariables.JWT_SECRET).toBe("super_configured_secret_value_1234");
    });

    it("T1-4: returns 404 when snapshotId does not exist", async () => {
      prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce(null);
      prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get("/api/coverage/non-existent-snap/unit/env-check")
        .set("Authorization", validAuthHeader);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });

    it("T1-5: returns 409 when snapshot rootDir is not ready", async () => {
      prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
        id: mockSnapshotId,
        projectId: mockProjectId,
        rootDir: null,
      });

      const res = await request(app)
        .get(`/api/coverage/${mockSnapshotId}/unit/env-check`)
        .set("Authorization", validAuthHeader);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not ready/i);
    });
  });

  // =========================================================================
  // SUITE 2: POST /api/coverage/:snapshotId/unit/env
  // =========================================================================
  describe("Suite 2: POST /:snapshotId/unit/env (Persistence & Run Trigger)", () => {
    it("T2-1: persists configured variables into .env at workspace root", async () => {
      const payload = {
        envVariables: {
          DATABASE_URL: "postgresql://app:pass@db:5432/production_db",
          JWT_SECRET: "my_secure_jwt_secret_token_12345678",
        },
      };

      const res = await request(app)
        .post(`/api/coverage/${mockSnapshotId}/unit/env`)
        .set("Authorization", validAuthHeader)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.path).toBe(".env");
      expect(res.body.data.persisted).toBe(true);
      expect(res.body.data.envVariables).toEqual(payload.envVariables);
      expect(res.body.data.workspaceRevision).toBeDefined();

      // Verify physical .env file written to workspace root
      const envPath = path.join(tempDir, ".env");
      expect(fs.existsSync(envPath)).toBe(true);
      const envContent = await fsp.readFile(envPath, "utf8");
      expect(envContent).toContain("DATABASE_URL=postgresql://app:pass@db:5432/production_db");
      expect(envContent).toContain("JWT_SECRET=my_secure_jwt_secret_token_12345678");
    });

    it("T2-2: preserves existing .env comments and non-conflicting keys on update", async () => {
      await fsp.writeFile(
        path.join(tempDir, ".env"),
        "# Database Configuration\nDB_HOST=127.0.0.1\n# Security Secret\nAPP_NAME=CovAI\n",
        "utf8"
      );

      const res = await request(app)
        .post(`/api/coverage/${mockSnapshotId}/unit/env`)
        .set("Authorization", validAuthHeader)
        .send({
          envVariables: {
            DB_PORT: "5432",
            APP_NAME: "CovAI_Updated",
          },
        });

      expect(res.status).toBe(200);
      const envContent = await fsp.readFile(path.join(tempDir, ".env"), "utf8");
      expect(envContent).toContain("# Database Configuration");
      expect(envContent).toContain("DB_HOST=127.0.0.1");
      expect(envContent).toContain("# Security Secret");
      expect(envContent).toContain("APP_NAME=CovAI_Updated");
      expect(envContent).toContain("DB_PORT=5432");
    });

    it("T2-3: triggers unit test run when runAfterSave: true is requested", async () => {
      const res = await request(app)
        .post(`/api/coverage/${mockSnapshotId}/unit/env`)
        .set("Authorization", validAuthHeader)
        .send({
          envVariables: { STRIPE_KEY: "sk_test_123" },
          runAfterSave: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.runTriggered).toBe(true);
      expect(res.body.data.jobId).toBeDefined();
      expect(mockAddJobToQueue).toHaveBeenCalledWith("RUN_TESTS", expect.any(String));
    });

    it("T2-4: rejects non-object or array envVariables with 400", async () => {
      const res = await request(app)
        .post(`/api/coverage/${mockSnapshotId}/unit/env`)
        .set("Authorization", validAuthHeader)
        .send({ envVariables: ["INVALID_ARRAY"] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/envVariables must be an object/i);
    });

    it("T2-5: returns 404 when snapshotId does not exist during save", async () => {
      prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce(null);
      prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .post("/api/coverage/unknown-snap-id/unit/env")
        .set("Authorization", validAuthHeader)
        .send({ envVariables: { PORT: "3000" } });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 3: Hermetic Fallback Runner Execution (useHermeticMock: true)
  // =========================================================================
  describe("Suite 3: Hermetic Fallback Runner Execution", () => {
    it("T3-1: accepts useHermeticMock: true in POST /:snapshotId/unit/run and records flag in job payloadJson", async () => {
      const res = await request(app)
        .post(`/api/coverage/${mockSnapshotId}/unit/run`)
        .set("Authorization", validAuthHeader)
        .send({ restart: true, useHermeticMock: true });

      expect([200, 202]).toContain(res.status);
      expect(res.body.success).toBe(true);
      expect(prismaMock.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payloadJson: expect.stringMatching(/"useHermeticMock":\s*true/),
          }),
        })
      );
      expect(mockAddJobToQueue).toHaveBeenCalledWith(
        "RUN_TESTS",
        expect.any(String),
        expect.objectContaining({ useHermeticMock: true })
      );
    });

    it("T3-2: buildSetupContent synthesizes setup script with HERMETIC_MOCKS and sets process.env[k] = v", () => {
      const setupContent = buildSetupContent({
        rootDir: tempDir,
        hermeticMocks: {
          DATABASE_URL: "postgresql://mock_user:mock_pass@localhost:5432/mock_db",
          JWT_SECRET: "covai_mock_secret_key_32chars_test",
        },
      });

      expect(setupContent).toContain("HERMETIC_MOCKS");
      expect(setupContent).toContain("covai_mock_secret_key_32chars_test");
      expect(setupContent).toContain("postgresql://mock_user:mock_pass@localhost:5432/mock_db");
      expect(setupContent).toContain("process.env[k] = v");
    });

    it("T3-3: subpackage setups use buildSetupContent and include candidate directory resolution", () => {
      const subDir = path.join(tempDir, "server");
      const setupContent = buildSetupContent({
        rootDir: tempDir,
        targetDir: subDir,
        hermeticMocks: { API_KEY: "mock_subpackage_api_key_123" },
      });

      expect(setupContent).toContain("targetDirCandidate");
      expect(setupContent).toContain("rootDirCandidate");
      expect(setupContent).toContain("mock_subpackage_api_key_123");
      expect(setupContent).toContain(".env.test");
      expect(setupContent).toContain(".env");
      expect(setupContent).toContain(".env.example");
    });
  });

  // =========================================================================
  // SUITE 4: Runner Precedence Invariant (Explicit > .env.test > .env > .env.example > Hermetic Mock)
  // =========================================================================
  describe("Suite 4: Runner Precedence Invariant Verification", () => {
    it("T4-1: explicit process.env overrides workspace .env and mock", async () => {
      // Write .env with conflicting value
      await fsp.writeFile(path.join(tempDir, ".env"), "API_KEY=file_key\nPORT=8080\n", "utf8");

      const harnessContent = buildSetupContent({
        rootDir: tempDir,
        hermeticMocks: { API_KEY: "mock_key_val", PORT: "9999", UNTOUCHED: "mock_untouched" },
      });

      // Simulate Node execution with pre-set CLI environment
      const fakeProcess = {
        env: {
          API_KEY: "explicit_cli_key",
          NODE_ENV: "test",
        },
        exit: () => {},
        on: () => {},
      };

      const runnerFn = new Function("process", "fs", "path", "__filename", harnessContent);
      runnerFn(fakeProcess, fs, path, "covai-jest-setup.cjs");

      expect(fakeProcess.env.API_KEY).toBe("explicit_cli_key"); // Explicit CLI wins
      expect(fakeProcess.env.PORT).toBe("8080"); // .env wins over hermetic mock
      expect(fakeProcess.env.UNTOUCHED).toBe("mock_untouched"); // Hermetic mock fills missing
    });

    it("T4-2: .env.test takes precedence over .env and .env.example", async () => {
      await fsp.writeFile(path.join(tempDir, ".env.test"), "DB_NAME=test_database\n", "utf8");
      await fsp.writeFile(path.join(tempDir, ".env"), "DB_NAME=dev_database\n", "utf8");
      await fsp.writeFile(path.join(tempDir, ".env.example"), "DB_NAME=example_database\n", "utf8");

      const harnessContent = buildSetupContent({
        rootDir: tempDir,
        hermeticMocks: { DB_NAME: "mock_database" },
      });

      const fakeProcess = { env: {}, exit: () => {}, on: () => {} };
      const runnerFn = new Function("process", "fs", "path", "__filename", harnessContent);
      runnerFn(fakeProcess, fs, path, "covai-jest-setup.cjs");

      expect(fakeProcess.env.DB_NAME).toBe("test_database");
    });

    it("T4-3: workspace .env takes precedence over .env.example and hermetic mock defaults", async () => {
      await fsp.writeFile(path.join(tempDir, ".env"), "JWT_SECRET=production_env_secret\n", "utf8");
      await fsp.writeFile(path.join(tempDir, ".env.example"), "JWT_SECRET=example_secret_placeholder\n", "utf8");

      const harnessContent = buildSetupContent({
        rootDir: tempDir,
        hermeticMocks: { JWT_SECRET: "mock_generated_secret_string" },
      });

      const fakeProcess = { env: {}, exit: () => {}, on: () => {} };
      const runnerFn = new Function("process", "fs", "path", "__filename", harnessContent);
      runnerFn(fakeProcess, fs, path, "covai-jest-setup.cjs");

      expect(fakeProcess.env.JWT_SECRET).toBe("production_env_secret");
    });

    it("T4-4: hermetic mock populates unconfigured variables without crashing", () => {
      const harnessContent = buildSetupContent({
        rootDir: tempDir,
        hermeticMocks: {
          UNCONFIGURED_KEY: "hermetic_ram_mock_value_12345",
        },
      });

      const fakeProcess = { env: {}, exit: () => {}, on: () => {} };
      const runnerFn = new Function("process", "fs", "path", "__filename", harnessContent);
      runnerFn(fakeProcess, fs, path, "covai-jest-setup.cjs");

      expect(fakeProcess.env.UNCONFIGURED_KEY).toBe("hermetic_ram_mock_value_12345");
    });

    it("T4-5: root .env takes precedence over subpackage .env.example in multi-directory setups", async () => {
      const subDir = path.join(tempDir, "packages", "server");
      await fsp.mkdir(subDir, { recursive: true });

      await fsp.writeFile(path.join(tempDir, ".env"), "DATABASE_URL=postgresql://real:pass@prod.db:5432/real_db\n", "utf8");
      await fsp.writeFile(path.join(subDir, ".env.example"), "DATABASE_URL=postgresql://example:pass@localhost:5432/ex_db\n", "utf8");

      const harnessContent = buildSetupContent({
        rootDir: tempDir,
        targetDir: subDir,
      });

      const fakeProcess = { env: {}, exit: () => {}, on: () => {} };
      const runnerFn = new Function("process", "fs", "path", "__filename", harnessContent);
      runnerFn(fakeProcess, fs, path, "covai-jest-setup.cjs");

      expect(fakeProcess.env.DATABASE_URL).toBe("postgresql://real:pass@prod.db:5432/real_db");
    });

    it("T4-6: inline comments and physical multiline quotes are parsed cleanly in buildSetupContent", async () => {
      const multilineCert = "-----BEGIN CERTIFICATE-----\nMIIB...test\n-----END CERTIFICATE-----";
      const envLines = [
        "PORT=4000 # Server port",
        'API_KEY="my-secret-key-456" # Production token',
        `TLS_CERT="${multilineCert}"`,
      ].join("\n");
      await fsp.writeFile(path.join(tempDir, ".env"), envLines + "\n", "utf8");

      const harnessContent = buildSetupContent({ rootDir: tempDir });
      const fakeProcess = { env: {}, exit: () => {}, on: () => {} };
      const runnerFn = new Function("process", "fs", "path", "__filename", harnessContent);
      runnerFn(fakeProcess, fs, path, "covai-jest-setup.cjs");

      expect(fakeProcess.env.PORT).toBe("4000");
      expect(fakeProcess.env.API_KEY).toBe("my-secret-key-456");
      expect(fakeProcess.env.TLS_CERT).toBe(multilineCert);
    });
  });
});

