import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const prismaMock = {
  projectSnapshot: { findFirst: jest.fn() },
  job: { findFirst: jest.fn(), create: jest.fn() },
  jobLog: { create: jest.fn() },
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/notification.service.js", () => ({ notificationService: { createJobFinishedNotification: jest.fn() } }));
jest.unstable_mockModule("../services/snapshotReuse.service.js", () => ({ reuseSnapshotHistory: jest.fn() }));

const { createAnalysisJob } = await import("../services/job.service.js");

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.jobLog.create.mockResolvedValue({ id: "log-1" });
});

describe("analysis job creation", () => {
  it("creates an ANALYSIS job for an owned ready snapshot", async () => {
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", projectId: "project-1", rootDir: "C:/internal/snapshot" });
    prismaMock.job.findFirst.mockResolvedValue(null);
    prismaMock.job.create.mockResolvedValue({ id: "job-1", projectId: "project-1", snapshotId: "snapshot-1", type: "ANALYSIS", status: "QUEUED", progress: 0 });

    const result = await createAnalysisJob({ projectId: "project-1", snapshotId: "snapshot-1", userId: "user-1" });

    expect(result).toMatchObject({ id: "job-1", type: "ANALYSIS", reused: false });
    expect(prismaMock.projectSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "snapshot-1", projectId: "project-1", project: { ownerId: "user-1" } },
    }));
    expect(prismaMock.job.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "ANALYSIS", status: "QUEUED" }) }));
  });

  it("reuses an active job for the same snapshot", async () => {
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", projectId: "project-1", rootDir: "C:/internal/snapshot" });
    prismaMock.job.findFirst.mockResolvedValue({ id: "job-existing", type: "ANALYSIS", status: "RUNNING" });

    const result = await createAnalysisJob({ projectId: "project-1", snapshotId: "snapshot-1", userId: "user-1" });

    expect(result).toEqual({ id: "job-existing", type: "ANALYSIS", status: "RUNNING", reused: true });
    expect(prismaMock.job.create).not.toHaveBeenCalled();
  });

  it("rejects a snapshot that is not ready", async () => {
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", projectId: "project-1", rootDir: null });
    await expect(createAnalysisJob({ projectId: "project-1", snapshotId: "snapshot-1", userId: "user-1" })).rejects.toMatchObject({ statusCode: 409 });
  });
});
