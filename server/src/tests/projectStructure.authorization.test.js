import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const prismaMock = {
  project: { findFirst: jest.fn() },
  projectSnapshot: { findFirst: jest.fn() },
  job: { findFirst: jest.fn() },
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
const { resolveLatestOwnedProjectSnapshot, resolveOwnedProjectSnapshot, resolveOwnedJob } = await import("../services/projectScope.service.js");
const { analysisJobResponse, snapshotResponse } = await import("../services/analysisResponse.service.js");

beforeEach(() => jest.clearAllMocks());

describe("project structure authorization and safe projections", () => {
  it("returns a safe not-found error before querying a snapshot for a foreign project", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    await expect(resolveOwnedProjectSnapshot({ projectId: "foreign-project", userId: "owner-1" })).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.projectSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it("reports a processing upload when an owned project has no ready snapshot yet", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "project-1" });
    prismaMock.projectSnapshot.findFirst.mockResolvedValue(null);

    await expect(resolveLatestOwnedProjectSnapshot({ projectId: "project-1", userId: "owner-1", requireRoot: true }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("still processing") });
  });

  it("resolves the latest ready snapshot only after ownership is confirmed", async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: "project-1" });
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-2", projectId: "project-1", rootDir: "C:/workspace/snapshot-2" });

    const result = await resolveLatestOwnedProjectSnapshot({ projectId: "project-1", userId: "owner-1", requireRoot: true });

    expect(result.snapshot.id).toBe("snapshot-2");
    expect(prismaMock.projectSnapshot.findFirst).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("requires the owning project for job reads", async () => {
    prismaMock.job.findFirst.mockResolvedValue(null);
    await expect(resolveOwnedJob({ jobId: "job-1", userId: "owner-1" })).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "job-1", project: { ownerId: "owner-1" } } }));
  });

  it("omits raw payloads, results, and internal snapshot paths from projections", () => {
    const job = analysisJobResponse({ id: "job-1", type: "ANALYSIS", projectId: "project-1", snapshotId: "snapshot-1", status: "SUCCESS", progress: 100, payloadJson: "secret", resultJson: "raw", createdAt: new Date() });
    const snapshot = snapshotResponse({ id: "snapshot-1", source: "ZIP", checksum: "hash", commitSha: null, rootDir: "C:/private", storagePath: "projects/private.zip", createdAt: new Date(), structureAnalysis: { schemaVersion: 1 } });
    expect(job).not.toHaveProperty("payloadJson");
    expect(job).not.toHaveProperty("resultJson");
    expect(snapshot).not.toHaveProperty("rootDir");
    expect(snapshot).not.toHaveProperty("storagePath");
  });
});
