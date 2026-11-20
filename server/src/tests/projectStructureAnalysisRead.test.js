import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const prismaMock = {
  project: { findFirst: jest.fn() },
  projectSnapshot: { findFirst: jest.fn() },
  projectStructureAnalysis: { findUnique: jest.fn() },
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/projectAccess.service.js", () => ({
  membershipWhere: jest.fn(() => ({})),
  resolveProjectAccess: jest.fn(async () => ({ project: { id: "project-1", ownerId: "user-1" } })),
  withProjectGuard: jest.fn(async (_opts, fn) => fn()),
}));

const { getProjectStructureAnalysis } = await import("../services/project.service.js");

describe("getProjectStructureAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({
      id: "snapshot-1",
      projectId: "project-1",
      rootDir: "C:/workspace/snapshot-1",
    });
  });

  it("throws 404 when row only contains integration workspace metadata without architecture graph", async () => {
    prismaMock.projectStructureAnalysis.findUnique.mockResolvedValue({
      snapshotId: "snapshot-1",
      schemaVersion: 1,
      resultJson: JSON.stringify({
        integrationScan: { explicitlyScanned: true, discoveredEndpoints: [] },
        peakIntegrationReport: { isPeakCoverageReport: true },
      }),
    });

    await expect(
      getProjectStructureAnalysis({
        projectId: "project-1",
        snapshotId: "snapshot-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Architecture analysis not found",
    });
  });

  it("returns parsed structure analysis when summary and graph nodes are present", async () => {
    const payload = {
      schemaVersion: 1,
      summary: { totalFiles: 1, totalFunctions: 2 },
      graph: { nodes: [{ id: "n1", relativePath: "src/index.js", role: "route", functions: [] }], edges: [] },
    };
    prismaMock.projectStructureAnalysis.findUnique.mockResolvedValue({
      snapshotId: "snapshot-1",
      schemaVersion: 1,
      resultJson: JSON.stringify(payload),
    });

    const result = await getProjectStructureAnalysis({
      projectId: "project-1",
      snapshotId: "snapshot-1",
      userId: "user-1",
    });

    expect(result).toEqual(payload);
  });
});
