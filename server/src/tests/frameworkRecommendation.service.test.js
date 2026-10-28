import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const roots = [];
const fixture = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-framework-service-"));
    roots.push(root);
    for (const [relative, content] of Object.entries(files)) {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
};

const prismaMock = { projectSnapshot: { update: jest.fn() } };
const scopeMock = {
    resolveLatestOwnedProjectSnapshot: jest.fn(),
    resolveOwnedProjectSnapshot: jest.fn(),
};

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/projectScope.service.js", () => scopeMock);

const { getFrameworkRecommendation, selectTestingFramework } = await import("../services/frameworkRecommendation.service.js");

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("frameworkRecommendation.service", () => {
    let rootDir;

    beforeEach(() => {
        jest.clearAllMocks();
        rootDir = fixture({ "package.json": JSON.stringify({ devDependencies: { jest: "^29" } }) });
        const snapshot = { id: "snapshot-1", rootDir, selectedTestingFramework: null };
        scopeMock.resolveLatestOwnedProjectSnapshot.mockResolvedValue({ project: { id: "project-1" }, snapshot });
        scopeMock.resolveOwnedProjectSnapshot.mockResolvedValue({ project: { id: "project-1" }, snapshot });
        prismaMock.projectSnapshot.update.mockResolvedValue(snapshot);
    });

    it("persists a recommendation for the latest owned snapshot", async () => {
        const result = await getFrameworkRecommendation({ projectId: "project-1", userId: "owner-1" });
        expect(result).toMatchObject({ snapshotId: "snapshot-1", recommendedFramework: "jest", selectedTestingFramework: null });
        expect(prismaMock.projectSnapshot.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "snapshot-1" },
            data: expect.objectContaining({ frameworkRecommendationJson: expect.any(String) }),
        }));
    });

    it("saves selection and reports installation requirements", async () => {
        const result = await selectTestingFramework({ projectId: "project-1", snapshotId: "snapshot-1", userId: "owner-1", framework: "vitest" });
        expect(result).toMatchObject({ selectedTestingFramework: "vitest", selection: { requiresInstallation: true } });
        expect(prismaMock.projectSnapshot.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ selectedTestingFramework: "vitest" }),
        }));
    });

    it("rejects invalid framework values before mutating a snapshot", async () => {
        await expect(selectTestingFramework({ projectId: "project-1", snapshotId: "snapshot-1", userId: "owner-1", framework: "playwright" }))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(prismaMock.projectSnapshot.update).not.toHaveBeenCalled();
    });

    it("uses scoped snapshot resolution for an explicit selection", async () => {
        await selectTestingFramework({ projectId: "project-1", snapshotId: "snapshot-1", userId: "owner-1", framework: "jest" });
        expect(scopeMock.resolveOwnedProjectSnapshot).toHaveBeenCalledWith({
            projectId: "project-1", snapshotId: "snapshot-1", userId: "owner-1", requireRoot: true,
        });
    });
});
