import { expect, it, jest } from "@jest/globals";
await jest.unstable_mockModule("../config/prisma.js", () => ({ default: {} }));
const { projectEndpointRule, enforceProjectEndpointPolicy } = await import("../middlewares/projectEndpointPolicy.js");
it.each([
    ["projects", "GET", "/p1/export", {}, "project.export"],
    ["projects", "POST", "/p1/ai-context/preview", {}, "project.read"],
    ["projects", "PUT", "/p1/ai-context", {}, "memory.write"],
    ["projects", "DELETE", "/p1/ai-context/memories", {}, "chat.delete"],
    ["projects", "DELETE", "/p1/ai-context/memories/m1", {}, "memory.write"],
    ["projects", "POST", "/p1/chat", {}, "chat.write"],
    ["projects", "DELETE", "/p1/chat/sessions/s1", {}, "chat.delete"],
    ["projects", "POST", "/p1/run-analysis", {}, "tests.run"],
    ["projects", "POST", "/p1/upload-zip", {}, "integrations.write"],
    ["projects", "PUT", "/p1/file-content", {}, "files.write"],
    ["coverage", "POST", "/s1/system/catalog/c1/confirm-expected", {}, "evidence.approve"],
    ["coverage", "GET", "/s1/system/setup", {}, "project.read"],
    ["coverage", "POST", "/s1/system/setup/apply", {}, "evidence.approve"],
    ["coverage", "POST", "/s1/system/setup/environment", {}, "evidence.approve"],
    ["coverage", "POST", "/s1/system/proposals/p1/apply", {}, "evidence.approve"],
    ["coverage", "POST", "/s1/system/generation-drafts/d1/apply", {}, "evidence.approve"],
    ["coverage", "POST", "/s1/system/versions", {}, "evidence.approve"],
    ["coverage", "POST", "/s1/system/versions/v1/restore", {}, "evidence.approve"],
    ["coverage", "POST", "/s1/system/versions/v1/check", {}, "tests.run"],
    ["coverage", "POST", "/s1/system/generate-tests", {}, "ai.use"],
    ["coverage", "GET", "/s1/system/assessments/a1/events", {}, "project.read"],
    ["coverage", "GET", "/project/p1/comparison", {}, "project.read"],
    ["git", "POST", "/command", { projectId: "p1" }, "integrations.write"],
    ["git", "GET", "/status", { projectId: "p1" }, "project.read"],
    ["git", "POST", "/stage", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/stage-hunk", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/unstage-hunk", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/revert-hunk", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/commit", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/undo-commit", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/discard", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/gitignore", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/conflicts/resolve", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/stashes", { projectId: "p1" }, "vcs.local"],
    ["git", "DELETE", "/stashes/0", { projectId: "p1" }, "vcs.local"],
    ["git", "POST", "/publish-github", { projectId: "p1" }, "integrations.write"],
    ["git", "POST", "/fetch", { projectId: "p1" }, "integrations.write"],
    ["git", "POST", "/sync", { projectId: "p1" }, "integrations.write"],
    ["git", "POST", "/rebase", { projectId: "p1" }, "integrations.write"],
    ["git", "POST", "/tags", { projectId: "p1" }, "integrations.write"],
    ["git", "DELETE", "/tags/v1.0.0", { projectId: "p1" }, "integrations.write"],
    ["git", "POST", "/github/pulls", { projectId: "p1" }, "integrations.write"],
    ["git", "GET", "/github/pulls", { projectId: "p1" }, "project.read"],
    ["git", "GET", "/github/checks", { projectId: "p1" }, "project.read"],
    ["git", "POST", "/push", { projectId: "p1" }, "integrations.write"],
    ["git", "POST", "/checkout", { projectId: "p1" }, "integrations.write"],
    ["git", "POST", "/merge", { projectId: "p1" }, "integrations.write"],
    ["git", "POST", "/ai-commit-message", { projectId: "p1" }, "ai.use"],
    ["snapshot-vcs", "GET", "/p1/status", {}, "project.read"],
    ["snapshot-vcs", "POST", "/p1/stage", {}, "vcs.local"],
    ["snapshot-vcs", "POST", "/p1/checkpoints", {}, "vcs.local"],
    ["snapshot-vcs", "POST", "/p1/rollback", {}, "snapshot.restore"],
    ["snapshot-vcs", "GET", "/p1/checkpoints/c1/export-zip", {}, "project.export"],
    ["snapshot-vcs", "POST", "/p1/ai-summary", {}, "ai.use"],
    ["snapshot-vcs", "POST", "/p1/branches", {}, "vcs.local"],
    ["snapshot-vcs", "POST", "/p1/branches/b1/checkout", {}, "snapshot.restore"],
    ["snapshot-vcs", "POST", "/p1/branches/merge", {}, "snapshot.restore"],
    ["snapshot-vcs", "DELETE", "/p1/tags/t1", {}, "snapshot.restore"],
    ["snapshot-vcs", "POST", "/p1/gc", {}, "snapshot.restore"],
    ["snapshot-vcs", "GET", "/status", { projectId: "p1" }, "project.read"],
    ["snapshot-vcs", "POST", "/checkpoints", { projectId: "p1" }, "vcs.local"],
    ["snapshot-vcs", "POST", "/checkpoints/c1/restore", { projectId: "p1" }, "snapshot.restore"],
    ["snapshot-vcs", "GET", "/checkpoints/c1/export-zip", { projectId: "p1" }, "project.export"],
    ["pipeline", "POST", "/p1/run-analysis", {}, "tests.run"],
])("%s %s %s requires %s", (family, method, path, input, expected) => {
    expect(projectEndpointRule(family, method, path, input).capability).toBe(expected);
});
it("rejects raw host paths and does not permit body IDs to override path IDs", () => {
    expect(() => projectEndpointRule("file-manager", "POST", "/save", { filePath: "C:/secrets" })).toThrow("project-relative");
    expect(projectEndpointRule("projects", "PUT", "/p1/file-content", { projectId: "other" }).projectId).toBe("p1");
});
it("safely normalizes empty or undefined snapshotId strings without throwing Invalid resource identifier", () => {
    const getCfgEmpty = projectEndpointRule("projects", "GET", "/p1/cfg", { snapshotId: "" });
    expect(getCfgEmpty.projectId).toBe("p1");
    expect(getCfgEmpty.snapshotId).toBeUndefined();
    expect(getCfgEmpty.capability).toBe("project.read");

    const buildCfgEmpty = projectEndpointRule("projects", "POST", "/p1/cfg/build", { snapshotId: "" });
    expect(buildCfgEmpty.projectId).toBe("p1");
    expect(buildCfgEmpty.snapshotId).toBeUndefined();
    expect(buildCfgEmpty.capability).toBe("tests.run");

    const getCcUndef = projectEndpointRule("projects", "GET", "/p1/cc", { snapshotId: "undefined" });
    expect(getCcUndef.projectId).toBe("p1");
    expect(getCcUndef.snapshotId).toBeUndefined();

    const getCfgValid = projectEndpointRule("projects", "GET", "/p1/cfg", { snapshotId: "snap-123" });
    expect(getCfgValid.projectId).toBe("p1");
    expect(getCfgValid.snapshotId).toBe("snap-123");
});
it("rejects cross-project snapshots before passing to a controller", async () => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const resolver = jest.fn(async input => {
        expect(input).toMatchObject({ projectId: "p1", snapshotId: "s1", userId: "actor" });
        throw Object.assign(new Error("Snapshot not found"), { statusCode: 404 });
    });
    const middleware = enforceProjectEndpointPolicy("projects", {
        db: { projectSnapshot: { findUnique: jest.fn(async () => ({ projectId: "other" })) } },
        resolveSnapshotAccess: resolver,
    });
    await middleware({ method: "PUT", path: "/p1/file-content", query: {}, body: { snapshotId: "s1" }, user: { id: "actor" } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
});
it("rejects a denied role before the controller and dependent work", async () => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const middleware = enforceProjectEndpointPolicy("projects", { resolveProjectAccess: jest.fn(async () => { throw Object.assign(new Error("Forbidden"), { statusCode: 403 }); }) });
    await middleware({ method: "POST", path: "/p1/run-analysis", query: {}, body: {}, user: { id: "viewer" } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
});