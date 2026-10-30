import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { jest, describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from "@jest/globals";
import prisma from "../config/prisma.js";
import { assertCollaborationTestDatabase } from "./helpers/collaborationDb.js";

const generate = jest.fn();
const generateVerified = jest.fn();
await jest.unstable_mockModule("../services/verifiedSystemGeneration.service.js", () => ({ generateColdStartSystemTests: generate, generateVerifiedSystemTests: generateVerified }));
await jest.unstable_mockModule("../services/queue.service.js", () => ({
    jobQueue: {}, addJobToQueue: jest.fn(), addSupertestCoveragePipeline: jest.fn(),
}));
await jest.unstable_mockModule("../services/systemTestFrameworkDetection.service.js", () => ({ detectSystemTestFrameworksForSnapshot: jest.fn(async () => ({})) }));
const { generateColdStartSystemTestsController } = await import("../controllers/coverage.controller.js");
const { readVersionedProjectFile } = await import("../services/projectFileVersion.service.js");
const { mutateProjectWorkspace } = await import("../services/projectMutation.service.js");
const { removeProjectMember } = await import("../services/projectMember.service.js");
const { createAiTestsJob } = await import("../services/job.service.js");
const { processAiTestsJob } = await import("../services/aiTestsJob.service.js");

const suite = process.env.COLLABORATION_INTEGRATION === "true" ? describe : describe.skip;
suite("cold-start publication against real PostgreSQL and filesystem", () => {
    let safe = false, root, owner, editor, viewer, project, snapshot;
    const operationParent = fileURLToPath(new URL("../../.covai-temp/collaboration-operations/", import.meta.url));
    beforeAll(() => { assertCollaborationTestDatabase(process.env.DATABASE_URL); safe = true; });
    beforeEach(async () => {
        if (!safe) throw new Error("Disposable database guard required");
        root = await fs.mkdtemp(path.join(os.tmpdir(), "covai-coldstart-collab-"));
        await fs.writeFile(path.join(root, "app.js"), "canonical source");
        const suffix = randomUUID();
        [owner, editor, viewer] = await Promise.all(["owner", "editor", "viewer"].map(name => prisma.user.create({ data: { email: `${name}-${suffix}@collaboration.test`, name } })));
        project = await prisma.project.create({ data: { name: `coldstart-${suffix}`, ownerId: owner.id } });
        snapshot = await prisma.projectSnapshot.create({ data: { projectId: project.id, source: "ZIP", storagePath: root, rootDir: root } });
        await prisma.projectMember.createMany({ data: [{ projectId: project.id, userId: editor.id, role: "EDITOR" }, { projectId: project.id, userId: viewer.id, role: "VIEWER" }] });
        generate.mockReset().mockImplementation(async ({ rootDir }) => {
            expect(path.resolve(rootDir)).not.toBe(path.resolve(root));
            await fs.mkdir(path.join(rootDir, "tests/e2e"), { recursive: true });
            await fs.writeFile(path.join(rootDir, "tests/e2e/generated.spec.js"), "prepared test bytes");
            await fs.writeFile(path.join(rootDir, "playwright.config.mjs"), "export default {};");
            return { framework: "PLAYWRIGHT", filePath: "tests/e2e/generated.spec.js", code: "prepared test bytes", suites: ["demo"], scenarios: ["opens home"], suiteCount: 1, scenarioCount: 1, configCreated: true, configPath: "playwright.config.mjs" };
        });
        generateVerified.mockReset().mockImplementation(async ({ rootDir }) => {
            expect(path.resolve(rootDir)).not.toBe(path.resolve(root));
            return { code: "verified prepared worker bytes", attempts: [], verificationRuns: 2, scenarioCount: 1, quality: {}, contextHash: "test-fixture-context", contextComplete: true, omittedFiles: [] };
        });
    });
    afterEach(async () => {
        if (!safe) return;
        const operations = project?.id ? await prisma.projectOperation.findMany({ where: { projectId: project.id }, select: { id: true } }) : [];
        if (project?.id) await prisma.project.deleteMany({ where: { id: project.id } });
        const userIds = [owner?.id, editor?.id, viewer?.id].filter(Boolean);
        if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith("covai-coldstart-collab-")) await fs.rm(root, { recursive: true, force: true });
        for (const { id } of operations) {
            if (!/^[\w-]+$/.test(id)) throw new Error("Unsafe operation cleanup ID");
            const directory = path.resolve(operationParent, id);
            if (path.dirname(directory) !== path.resolve(operationParent)) throw new Error("Unsafe operation cleanup path");
            await fs.rm(directory, { recursive: true, force: true });
        }
        root = owner = editor = viewer = project = snapshot = null;
    });
    afterAll(async () => { if (safe) await prisma.$disconnect(); });
    const request = actor => ({ user: { id: actor.id }, params: { snapshotId: snapshot.id }, body: { framework: "playwright" } });
    const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
    test("Editor publishes prepared config, tests and metadata as one revision", async () => {
        const res = response();
        await generateColdStartSystemTestsController(request(editor), res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(await fs.readFile(path.join(root, "tests/e2e/generated.spec.js"), "utf8")).toBe("prepared test bytes");
        expect(await prisma.aiTest.count({ where: { snapshotId: snapshot.id } })).toBe(1);
        expect(await prisma.project.findUnique({ where: { id: project.id } })).toMatchObject({ workspaceRevision: 1 });
    });
    test("Viewer is rejected before generation or writes", async () => {
        const res = response();
        await generateColdStartSystemTestsController(request(viewer), res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(generate).not.toHaveBeenCalled();
        expect(await prisma.aiTest.count({ where: { snapshotId: snapshot.id } })).toBe(0);
    });
    test.each(["source edit", "member removal"])("rejects publication after %s during generation", async change => {
        const original = generate.getMockImplementation();
        generate.mockImplementation(async input => {
            const result = await original(input);
            if (change === "source edit") {
                const base = await readVersionedProjectFile({ projectId: project.id, snapshotId: snapshot.id, userId: owner.id, path: "app.js" });
                await mutateProjectWorkspace({ projectId: project.id, snapshotId: snapshot.id, userId: owner.id, path: "app.js", kind: "WRITE_FILE", content: "newer owner edit", expectedVersion: base.version });
            } else {
                const member = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: editor.id } } });
                await removeProjectMember({ projectId: project.id, userId: owner.id, memberId: member.id, expectedRevision: member.revision });
            }
            return result;
        });
        const res = response();
        await generateColdStartSystemTestsController(request(editor), res);
        expect(res.status).toHaveBeenCalledWith(change === "source edit" ? 409 : 404);
        expect(await prisma.aiTest.count({ where: { snapshotId: snapshot.id } })).toBe(0);
        await expect(fs.access(path.join(root, "tests/e2e/generated.spec.js"))).rejects.toMatchObject({ code: "ENOENT" });
        expect(await fs.readFile(path.join(root, "app.js"), "utf8")).toBe(change === "source edit" ? "newer owner edit" : "canonical source");
    });
    test("AI worker commits metadata, generated file and terminal status together", async () => {
        const job = await createAiTestsJob({ projectId: project.id, snapshotId: snapshot.id, userId: editor.id, mode: "PLAYWRIGHT_E2E", executionMode: "full" });
        const result = await processAiTestsJob(job.id);
        expect(result.success).toBe(true);
        expect(await fs.readFile(path.join(root, "tests/system/ai-generated.spec.js"), "utf8")).toBe("verified prepared worker bytes");
        expect(await prisma.aiTest.count({ where: { snapshotId: snapshot.id, status: "VERIFIED" } })).toBe(1);
        expect(await prisma.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "SUCCESS" });
        expect(await prisma.projectOperation.findUnique({ where: { primaryJobId: job.id } })).toMatchObject({ status: "SUCCESS" });
    });
    test("canceling AI verification prevents canonical files and metadata from publishing", async () => {
        const job = await createAiTestsJob({ projectId: project.id, snapshotId: snapshot.id, userId: editor.id, mode: "PLAYWRIGHT_E2E", executionMode: "full" });
        const original = generateVerified.getMockImplementation();
        generateVerified.mockImplementation(async input => {
            const result = await original(input);
            await prisma.job.update({ where: { id: job.id }, data: { status: "CANCELED" } });
            return result;
        });
        await expect(processAiTestsJob(job.id)).rejects.toMatchObject({ code: "OPERATION_CANCELED" });
        expect(await prisma.aiTest.count({ where: { snapshotId: snapshot.id } })).toBe(0);
        expect(await prisma.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "CANCELED" });
        await expect(fs.access(path.join(root, "tests/system/ai-generated.spec.js"))).rejects.toMatchObject({ code: "ENOENT" });
    });
    test("failed verification preserves the previous verified file and discards setup changes", async () => {
        const filePath = "tests/system/ai-generated.spec.js";
        await fs.mkdir(path.join(root, "tests/system"), { recursive: true });
        await fs.writeFile(path.join(root, filePath), "previous verified bytes");
        await prisma.aiTest.create({ data: { projectId: project.id, snapshotId: snapshot.id, mode: "PLAYWRIGHT_E2E", status: "VERIFIED", filePath, content: "previous verified bytes" } });
        const job = await createAiTestsJob({ projectId: project.id, snapshotId: snapshot.id, userId: editor.id, mode: "PLAYWRIGHT_E2E", executionMode: "full" });
        generateVerified.mockImplementation(async ({ rootDir }) => {
            await fs.writeFile(path.join(rootDir, "playwright.config.mjs"), "unverified setup change");
            return { failed: true, code: "failed candidate", error: "Fixture verification failed", attempts: [] };
        });
        expect(await processAiTestsJob(job.id)).toMatchObject({ success: false });
        expect(await fs.readFile(path.join(root, filePath), "utf8")).toBe("previous verified bytes");
        await expect(fs.access(path.join(root, "playwright.config.mjs"))).rejects.toMatchObject({ code: "ENOENT" });
        expect(await prisma.aiTest.count({ where: { snapshotId: snapshot.id, status: "VERIFIED" } })).toBe(1);
        expect(await prisma.aiTest.count({ where: { snapshotId: snapshot.id, status: "FAILED" } })).toBe(1);
        expect(await prisma.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "FAILED" });
        expect(await prisma.project.findUnique({ where: { id: project.id } })).toMatchObject({ workspaceRevision: 0 });
    });
});
