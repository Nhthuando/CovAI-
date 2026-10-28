import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const prismaMock = {
  projectOperationRequest:{findUnique:jest.fn(async()=>null),create:jest.fn(async({data})=>({id:'alias',...data}))},
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
  project: {findFirst:jest.fn()},
  projectSnapshot: { findFirst: jest.fn() },
  projectOperation: {findUnique:jest.fn(),findFirst:jest.fn(),create:jest.fn()},
  job: { findFirst: jest.fn(),findUnique:jest.fn(), create: jest.fn() },
  jobLog: { create: jest.fn() },
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/notification.service.js", () => ({ notificationService: { createJobFinishedNotification: jest.fn() } }));
jest.unstable_mockModule("../services/snapshotReuse.service.js", () => ({ reuseSnapshotHistory: jest.fn() }));

const { createAnalysisJob } = await import("../services/job.service.js");

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.jobLog.create.mockResolvedValue({ id: "log-1" });
  prismaMock.$transaction.mockImplementation(run=>run(prismaMock));
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.project.findFirst.mockResolvedValue({id:'project-1',ownerId:'user-1',workspaceRevision:0});
  prismaMock.projectOperation.findUnique.mockResolvedValue(null);
  prismaMock.projectOperation.findFirst.mockResolvedValue(null);
  prismaMock.projectOperation.create.mockResolvedValue({id:'operation-1',status:'QUEUED'});
});

describe("analysis job creation", () => {
  it("creates an ANALYSIS job for an owned ready snapshot", async () => {
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", projectId: "project-1", rootDir: "C:/internal/snapshot" });
    prismaMock.job.findFirst.mockResolvedValue(null);
    prismaMock.job.create.mockResolvedValue({ id: "job-1", projectId: "project-1", snapshotId: "snapshot-1", type: "ANALYSIS", status: "QUEUED", progress: 0 });

    const result = await createAnalysisJob({ projectId: "project-1", snapshotId: "snapshot-1", userId: "user-1" });

    expect(result).toMatchObject({ id: "job-1", type: "ANALYSIS", reused: false });
    expect(prismaMock.projectSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "snapshot-1", projectId: "project-1" },
    }));
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'project-1'})}));
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.job.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "ANALYSIS", status: "QUEUED" }) }));
  });

  it("reuses an active job for the same snapshot", async () => {
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", projectId: "project-1", rootDir: "C:/internal/snapshot" });
    prismaMock.projectOperation.findFirst.mockResolvedValue({id:'operation-existing',primaryJobId:'job-existing',status:'RUNNING'});
    prismaMock.job.findUnique.mockResolvedValue({ id: "job-existing", type: "ANALYSIS", status: "RUNNING" });

    const result = await createAnalysisJob({ projectId: "project-1", snapshotId: "snapshot-1", userId: "user-1" });

    expect(result).toMatchObject({ id: "job-existing", type: "ANALYSIS", status: "RUNNING", reused: true,operationId:'operation-existing' });
    expect(prismaMock.job.create).not.toHaveBeenCalled();
  });

  it("rejects a snapshot that is not ready", async () => {
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", projectId: "project-1", rootDir: null });
    await expect(createAnalysisJob({ projectId: "project-1", snapshotId: "snapshot-1", userId: "user-1" })).rejects.toMatchObject({ statusCode: 409 });
  });
});
