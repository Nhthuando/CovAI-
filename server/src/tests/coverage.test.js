import { jest } from "@jest/globals";
import { EventEmitter } from "events";

let currentJobStatus = "QUEUED";

const mockPrisma = {
  projectSnapshot: {
    findUnique: jest.fn().mockResolvedValue({
      id: "mockSnapshotId",
      projectId: "mockProjectId",
      rootDir: "/mock/project/root",
    }),
    findFirst: jest.fn().mockResolvedValue({
      id: "mockSnapshotId",
      projectId: "mockProjectId",
      rootDir: "/mock/project/root",
    }),
    update: jest.fn().mockResolvedValue({}),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({ id: "mockUserId" }),
  },
  job: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockImplementation(() => Promise.resolve({
      id: "mockJobId",
      status: currentJobStatus,
      snapshotId: "mockSnapshotId",
      snapshot: { rootDir: "/mock/project/root" },
    })),
    create: jest.fn().mockImplementation(({ data }) => {
      currentJobStatus = "QUEUED";
      return Promise.resolve({
        id: "mockJobId",
        ...data,
        snapshot: { rootDir: "/mock/project/root" },
      });
    }),
    update: jest.fn().mockImplementation(({ data }) => {
      if (data?.status) currentJobStatus = data.status;
      return Promise.resolve({
        id: "mockJobId",
        status: currentJobStatus,
        snapshotId: "mockSnapshotId",
        snapshot: { rootDir: "/mock/project/root" },
      });
    }),
  },
  jobLog: {
    create: jest.fn().mockResolvedValue({}),
  },
  jobOutput: {
    upsert: jest.fn().mockResolvedValue({}),
  },
  coverageFile: {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  coverageSummary: {
    upsert: jest.fn().mockResolvedValue({}),
  },
};

const mockChild = new EventEmitter();
mockChild.stdout = new EventEmitter();
mockChild.stderr = new EventEmitter();
mockChild.kill = jest.fn();

await jest.unstable_mockModule("child_process", () => ({
  spawn: jest.fn().mockImplementation(() => {
    setImmediate(() => mockChild.emit("close", 0));
    return mockChild;
  }),
}));

await jest.unstable_mockModule("fs", () => ({
  default: {
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest.fn().mockReturnValue("{}"),
    statSync: jest.fn().mockReturnValue({ isDirectory: () => true }),
  },
}));

await jest.unstable_mockModule("../config/prisma.js", () => ({
  default: mockPrisma,
}));

const mockParseCoverageSummary = jest.fn(() => Promise.resolve({
  total: {
    lines: { pct: 85.6 },
    branches: { pct: 75.3 },
    functions: { pct: 92.7 },
    statements: { pct: 88.1 },
  },
  fileCount: 15,
}));

await jest.unstable_mockModule("../services/coverageSummaryParser.service.js", () => ({
  parseCoverageSummary: mockParseCoverageSummary,
}));

const mockStoreCoverageOutputs = jest.fn(() => Promise.resolve({
  baseStoragePath: "mock/storage/path",
}));

await jest.unstable_mockModule("../services/coverageStorage.service.js", () => ({
  storeCoverageOutputs: mockStoreCoverageOutputs,
}));

const {
  createVitestCoverageJob,
  createSupertestCoverageJob,
  createPlaywrightSystemCoverageJob,
  createSystemTestAnalysisJob,
} = await import("../services/job.service.js");
const { processCoverageJob } = await import("../services/coverageRunner.service.js");

describe("Coverage Processing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentJobStatus = "QUEUED";
    mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
      id: "mockSnapshotId",
      projectId: "mockProjectId",
      rootDir: "/mock/project/root",
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: "mockUserId" });
    mockPrisma.job.findFirst.mockResolvedValue(null);
  });

  test("Should process unit test coverage and store metrics", async () => {
    const job = await createVitestCoverageJob({
      projectId: "mockProjectId",
      userId: "mockUserId",
      snapshotId: "mockSnapshotId",
    });

    await processCoverageJob(job.id);

    expect(mockParseCoverageSummary).toHaveBeenCalled();
    expect(mockStoreCoverageOutputs).toHaveBeenCalled();
  });

  test("Should process integration test coverage with Supertest", async () => {
    const job = await createSupertestCoverageJob({
      projectId: "mockProjectId",
      userId: "mockUserId",
      snapshotId: "mockSnapshotId",
    });

    await processCoverageJob(job.id);

    expect(mockParseCoverageSummary).toHaveBeenCalled();
    expect(mockStoreCoverageOutputs).toHaveBeenCalled();
  });

  test("Should process system test coverage with Playwright", async () => {
    const job = await createPlaywrightSystemCoverageJob({
      projectId: "mockProjectId",
      userId: "mockUserId",
      snapshotId: "mockSnapshotId",
    });

    await processCoverageJob(job.id);

    expect(mockParseCoverageSummary).toHaveBeenCalled();
    expect(mockStoreCoverageOutputs).toHaveBeenCalled();
  });

  test("Should also work directly with createSystemTestAnalysisJob", async () => {
    const job = await createSystemTestAnalysisJob({
      projectId: "mockProjectId",
      userId: "mockUserId",
      snapshotId: "mockSnapshotId",
      runner: "playwright",
    });

    await processCoverageJob(job.id);

    expect(mockParseCoverageSummary).toHaveBeenCalled();
    expect(mockStoreCoverageOutputs).toHaveBeenCalled();
  });

  test("Error when missing snapshot for any test coverage processing", async () => {
    mockPrisma.projectSnapshot.findUnique.mockResolvedValueOnce(null);

    await expect(
      createVitestCoverageJob({
        projectId: "mockProjectId",
        userId: "mockUserId",
        snapshotId: "invalidSnapshotId",
      })
    ).rejects.toThrow("Snapshot not found");
  });
});
