import { jest } from "@jest/globals";

const prismaMock = {
    projectSnapshot: { findFirst: jest.fn() },
    coverageSummary: { findUnique: jest.fn() },
    coverageFile: { count: jest.fn(), findMany: jest.fn() },
    coverageFunction: { count: jest.fn(), findMany: jest.fn() },
    cfg: { count: jest.fn(), findMany: jest.fn() },
    cyclomatic: { count: jest.fn(), findMany: jest.fn() },
    aiSuggestion: { count: jest.fn(), findMany: jest.fn() },
    aiTest: { count: jest.fn(), findMany: jest.fn() },
};

jest.unstable_mockModule("../../src/config/prisma.js", () => ({
    default: prismaMock
}));

const { findReusableSnapshot, getCachedResult, reuseSnapshotHistory } = await import("../../src/services/snapshotReuse.service.js");
const prisma = prismaMock;
beforeEach(() => {
    jest.clearAllMocks();
});

describe("Snapshot History Reuse Service", () => {

    describe("findReusableSnapshot()", () => {

        it("should find snapshot by checksum", async () => {

            prisma.projectSnapshot.findFirst.mockResolvedValue({
                id: "snapshot-1",
            });

            const result = await findReusableSnapshot({
                projectId: "project-1",
                checksum: "abc123",
                commitSha: null,
            });

            expect(prisma.projectSnapshot.findFirst).toHaveBeenCalledWith({
                where: {
                    projectId: "project-1",
                    checksum: "abc123",
                },
                orderBy: {
                    createdAt: "desc",
                },
                select: {
                    id: true,
                },
            });

            expect(result).toEqual({
                id: "snapshot-1",
            });

        });

        it("should use commitSha when checksum missing", async () => {

            prisma.projectSnapshot.findFirst.mockResolvedValue({
                id: "snapshot-2",
            });

            await findReusableSnapshot({
                projectId: "project-1",
                checksum: null,
                commitSha: "commit123",
            });

            expect(prisma.projectSnapshot.findFirst).toHaveBeenCalledWith({
                where: {
                    projectId: "project-1",
                    commitSha: "commit123",
                },
                orderBy: {
                    createdAt: "desc",
                },
                select: {
                    id: true,
                },
            });

        });

        it("should return null if no checksum and commitSha", async () => {

            const result = await findReusableSnapshot({
                projectId: "project-1",
            });

            expect(result).toBeNull();

            expect(prisma.projectSnapshot.findFirst).not.toHaveBeenCalled();

        });

    });

    describe("getCachedResult()", () => {

        it("should load every cached artifact", async () => {

            prisma.coverageSummary.findUnique.mockResolvedValue({
                id: "summary",
            });

            prisma.coverageFile.findMany.mockResolvedValue([
                { id: 1 },
            ]);

            prisma.coverageFunction.findMany.mockResolvedValue([
                { id: 2 },
            ]);

            prisma.cfg.findMany.mockResolvedValue([
                { id: 3 },
            ]);

            prisma.cyclomatic.findMany.mockResolvedValue([
                { id: 4 },
            ]);

            prisma.aiSuggestion.findMany.mockResolvedValue([
                { id: 5 },
            ]);

            prisma.aiTest.findMany.mockResolvedValue([
                { id: 6 },
            ]);

            const result = await getCachedResult("snapshot-1");

            expect(result.reused).toBe(true);

            expect(result.sourceSnapshotId).toBe("snapshot-1");

            expect(result.coverageSummary.id).toBe("summary");

            expect(result.coverageFiles).toHaveLength(1);

            expect(result.coverageFunctions).toHaveLength(1);

            expect(result.cfgs).toHaveLength(1);

            expect(result.cyclomatic).toHaveLength(1);

            expect(result.aiSuggestions).toHaveLength(1);

            expect(result.aiTests).toHaveLength(1);

        });

    });

    describe("reuseSnapshotHistory()", () => {

        it("should reuse cached snapshot", async () => {

            prisma.projectSnapshot.findFirst.mockResolvedValue({
                id: "snapshot-100",
            });

            prisma.coverageSummary.findUnique.mockResolvedValue({
                id: "summary",
            });

            prisma.coverageFile.count.mockResolvedValue(10);

            prisma.coverageFunction.count.mockResolvedValue(20);

            prisma.cfg.count.mockResolvedValue(15);

            prisma.cyclomatic.count.mockResolvedValue(15);

            prisma.coverageFile.findMany.mockResolvedValue([]);

            prisma.coverageFunction.findMany.mockResolvedValue([]);

            prisma.cfg.findMany.mockResolvedValue([]);

            prisma.cyclomatic.findMany.mockResolvedValue([]);

            prisma.aiSuggestion.findMany.mockResolvedValue([]);

            prisma.aiTest.findMany.mockResolvedValue([]);

            const result = await reuseSnapshotHistory({
                projectId: "project-1",
                checksum: "abc123",
            });

            expect(result).not.toBeNull();

            expect(result.reused).toBe(true);

            expect(result.sourceSnapshotId).toBe("snapshot-100");

        });

        it("should return null when snapshot not found", async () => {

            prisma.projectSnapshot.findFirst.mockResolvedValue(null);

            const result = await reuseSnapshotHistory({
                projectId: "project-1",
                checksum: "abc123",
            });

            expect(result).toBeNull();

        });

        it("should return null when snapshot is incomplete", async () => {

            prisma.projectSnapshot.findFirst.mockResolvedValue({
                id: "snapshot-1",
            });

            prisma.coverageSummary.findUnique.mockResolvedValue(null);

            prisma.coverageFile.count.mockResolvedValue(0);

            prisma.coverageFunction.count.mockResolvedValue(0);

            prisma.cfg.count.mockResolvedValue(0);

            prisma.cyclomatic.count.mockResolvedValue(0);

            const result = await reuseSnapshotHistory({
                projectId: "project-1",
                checksum: "abc123",
            });

            expect(result).toBeNull();

        });

        it("should exclude current snapshot", async () => {

            prisma.projectSnapshot.findFirst.mockResolvedValue(null);

            await reuseSnapshotHistory({
                projectId: "project-1",
                checksum: "abc123",
                excludeSnapshotId: "snapshot-current",
            });

            expect(prisma.projectSnapshot.findFirst).toHaveBeenCalledWith({
                where: {
                    projectId: "project-1",
                    checksum: "abc123",
                    id: {
                        not: "snapshot-current",
                    },
                },
                orderBy: {
                    createdAt: "desc",
                },
                select: {
                    id: true,
                },
            });

        });

    });

});