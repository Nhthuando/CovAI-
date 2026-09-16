import {
  createVitestCoverageJob,
  createSupertestCoverageJob,
  createPlaywrightSystemCoverageJob,
} from "../services/job.service";
import { processCoverageJob } from "../services/coverageRunner.service.js";
import prisma from "../config/prisma.js";

/**
 * Mock Prisma and services to simulate pipeline and coverage reporting without external dependencies.
 * Test cases validate processing and parsing for Unit, Integration, and System test coverage.
 */

// Mock Prisma database operations globally.
jest.mock("../config/prisma.js", () => ({
  projectSnapshot: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  coverageFile: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  coverageSummary: {
    upsert: jest.fn(),
  },
}));

jest.mock("../services/coverageSummaryParser.service.js", () => ({
  parseCoverageSummary: jest.fn(() => ({
    total: {
      lines: { pct: 85.6 },
      branches: { pct: 75.3 },
      functions: { pct: 92.7 },
      statements: { pct: 88.1 },
    },
    fileCount: 15,
  })),
}));

jest.mock("../services/coverageStorage.service", () => ({
  storeCoverageOutputs: jest.fn(() => ({
    baseStoragePath: "mock/storage/path",
  })),
}));

describe("Coverage Processing", () => {
  beforeAll(() => {
    // Mock Prisma snapshot data associated with the tests.
    prisma.projectSnapshot.findFirst.mockResolvedValue({
      id: "mockSnapshotId",
      rootDir: "/mock/project/root",
      project: { ownerId: "mockUserId" },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("Should process unit test coverage and store metrics", async () => {
    const job = await createVitestCoverageJob({
      projectId: "mockProjectId",
      userId: "mockUserId",
      snapshotId: "mockSnapshotId",
    });

    await processCoverageJob(job.id);

    expect(prisma.coverageFile.createMany).toHaveBeenCalled();
    expect(prisma.coverageSummary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { snapshotId: "mockSnapshotId" },
      }),
    );
    expect(prisma.coverageFile.createMany).toMatchSnapshot(); // Validate the created records
  });

  test("Should process integration test coverage with Supertest", async () => {
    const job = await createSupertestCoverageJob({
      projectId: "mockProjectId",
      userId: "mockUserId",
      snapshotId: "mockSnapshotId",
    });

    await processCoverageJob(job.id);

    expect(prisma.coverageFile.createMany).toHaveBeenCalled();
    expect(prisma.coverageSummary.upsert).toHaveBeenCalled();
  });

  test("Should process system test coverage with Playwright", async () => {
    const job = await createPlaywrightSystemCoverageJob({
      projectId: "mockProjectId",
      userId: "mockUserId",
      snapshotId: "mockSnapshotId",
    });

    await processCoverageJob(job.id);

    expect(prisma.coverageFile.createMany).toHaveBeenCalled();
    expect(prisma.coverageSummary.upsert).toHaveBeenCalled();
  });

  test("Error when missing snapshot for any test coverage processing", async () => {
    prisma.projectSnapshot.findFirst.mockResolvedValueOnce(null);

    await expect(processCoverageJob("invalidJobId")).rejects.toThrowError(
      "Snapshot not found for this project",
    );

    expect(prisma.coverageFile.createMany).not.toHaveBeenCalled();
  });
});
