import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const txMock = {
  coverageFile: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    upsert: jest.fn(),
  },
  coverageSummary: {
    upsert: jest.fn(),
  },
};

const prismaMock = {
  projectSnapshot: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(async (fn) => fn(txMock)),
};

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: prismaMock,
}));

jest.unstable_mockModule("../services/projectAccess.service.js", () => ({
  resolveProjectAccess: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule("../services/projectOperationWorkspace.service.js", () => ({
  operationSnapshot: (s) => s,
  currentProjectOperation: () => null,
  stagePreparedPublication: jest.fn(),
}));

const { parseCoverageFilesForSnapshot, extractFilePath } = await import("../services/coverageFileParser.service.js");

describe("coverageFileParser.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({
      id: "snap-1",
      projectId: "proj-1",
      rootDir: "/app/storage/projects/proj-1/repo",
      project: { ownerId: "user-1" },
    });
  });

  it("canonicalizes subproject coverage paths relative to rootDir via extractFilePath", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-covparser-test-"));
    try {
      const serverSource = path.join(tempDir, "server", "src", "controllers", "chatController.js");
      fs.mkdirSync(path.dirname(serverSource), { recursive: true });
      fs.writeFileSync(serverSource, "export const chat = {};");

      const entry = { path: "src/controllers/chatController.js" };
      const resolved = extractFilePath(entry, "src/controllers/chatController.js", tempDir);

      expect(resolved).toBe("server/src/controllers/chatController.js");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws if required fields are missing", async () => {
    await expect(parseCoverageFilesForSnapshot({})).rejects.toThrow();
  });

  it("persists API route and app entry files via upsert when testType is INTEGRATION without overwriting CoverageSummary", async () => {
    const coverageReport = {
      total: { lines: { total: 20, covered: 15, pct: 75 } },
      "/app/storage/projects/proj-1/repo/src/routes/student.routes.js": {
        s: { "0": 1, "1": 1, "2": 0 },
      },
      "/app/storage/projects/proj-1/repo/src/app.js": {
        s: { "0": 1, "1": 1 },
      },
      "/app/storage/projects/proj-1/repo/tests/integration/student.test.js": {
        s: { "0": 1 },
      },
    };

    const result = await parseCoverageFilesForSnapshot({
      projectId: "proj-1",
      snapshotId: "snap-1",
      coverageReport,
      userId: "user-1",
      testType: "INTEGRATION",
    });

    expect(result.files.map((f) => f.filePath)).toEqual([
      "src/routes/student.routes.js",
      "src/app.js",
    ]);
    expect(txMock.coverageFile.deleteMany).not.toHaveBeenCalled();
    expect(txMock.coverageFile.upsert).toHaveBeenCalledTimes(2);
    expect(txMock.coverageSummary.upsert).not.toHaveBeenCalled();
  });

  it("filters out API route files when testType defaults to UNIT", async () => {
    const coverageReport = {
      "/app/storage/projects/proj-1/repo/src/routes/student.routes.js": {
        s: { "0": 1 },
      },
      "/app/storage/projects/proj-1/repo/src/services/student.service.js": {
        s: { "0": 1, "1": 0 },
      },
    };

    const result = await parseCoverageFilesForSnapshot({
      projectId: "proj-1",
      snapshotId: "snap-1",
      coverageReport,
      userId: "user-1",
    });

    expect(result.files.map((f) => f.filePath)).toEqual([
      "src/services/student.service.js",
    ]);
    expect(txMock.coverageFile.deleteMany).toHaveBeenCalledWith({
      where: { snapshotId: "snap-1" },
    });
    expect(txMock.coverageFile.createMany).toHaveBeenCalledTimes(1);
  });
});
