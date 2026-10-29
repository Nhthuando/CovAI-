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
    ["coverage", "POST", "/s1/system/proposals/p1/apply", {}, "files.write"],
    ["coverage", "POST", "/s1/system/generate-tests", {}, "ai.use"],
    ["coverage", "GET", "/s1/system/assessments/a1/events", {}, "project.read"],
    ["coverage", "GET", "/project/p1/comparison", {}, "project.read"],
    ["git", "POST", "/command", { projectId: "p1" }, "integrations.write"],
    ["git", "GET", "/status", { projectId: "p1" }, "project.read"],
    ["pipeline", "POST", "/p1/run-analysis", {}, "tests.run"],
])("%s %s %s requires %s", (family, method, path, input, expected) => {
    expect(projectEndpointRule(family, method, path, input).capability).toBe(expected);
});
it("rejects raw host paths and does not permit body IDs to override path IDs", () => {
    expect(() => projectEndpointRule("file-manager", "POST", "/save", { filePath: "C:/secrets" })).toThrow("project-relative");
    expect(projectEndpointRule("projects", "PUT", "/p1/file-content", { projectId: "other" }).projectId).toBe("p1");
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
