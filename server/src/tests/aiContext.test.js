import { beforeEach, expect, it, jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db, resetContextFixture, session } from "./helpers/aiContextFixture.js";
jest.unstable_mockModule("../controllers/project.controller.js", () => ({ default: new Proxy({}, { get: () => jest.fn() }) }));
jest.unstable_mockModule("../controllers/quality.controller.js", () => ({ runQualityAnalysis: jest.fn(), fetchQualityReport: jest.fn() }));
const { default: router } = await import("../routes/project.route.js");
const { branchContextSession, loadContextSession } = await import("../services/chatContext.service.js");
const { saveContextSettings, clearProjectMemories, forgetProjectMemory, selectRelevantMemories, editProjectMemory } = await import("../services/projectMemory.service.js");
const app = express(); app.use(express.json()); app.use("/api/projects", router);
const auth = () => `Bearer ${jwt.sign({ userId: "owner-1" }, process.env.JWT_SECRET)}`;
beforeEach(() => { resetContextFixture(); process.env.JWT_SECRET = "ai-context-test-secret"; });

it("requires auth on context, memory and branch endpoints", async () => {
    for (const path of ["/ai-context", "/ai-context/memories", "/chat/sessions"]) expect((await request(app).get(`/api/projects/project-1${path}`)).status).toBe(401);
    expect((await request(app).post("/api/projects/project-1/chat/sessions/session-1/branch").send({})).status).toBe(401);
});
it("checks project ownership before reading settings or sessions", async () => {
    db.project.findFirst.mockResolvedValue(null);
    expect((await request(app).get("/api/projects/project-1/ai-context").set("Authorization", auth())).status).toBe(404);
    expect(db.aiContextSettings.upsert).not.toHaveBeenCalled();
    expect(db.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "project-1", ownerId: "owner-1" } }));
});
it("defaults memory off and rejects unknown settings/credential forms", async () => {
    const response = await request(app).get("/api/projects/project-1/ai-context").set("Authorization", auth());
    expect(response.body.data.automaticMemory).toBe(false);
    for (const input of [{ automaticMemory: true, guidance: "", revision: 0, rootDir: "C:/private" }, { automaticMemory: true, guidance: "api_key=verysecretcredential", revision: 0 }, { automaticMemory: true, guidance: "x".repeat(8001), revision: 0 }]) {
        expect((await request(app).put("/api/projects/project-1/ai-context").set("Authorization", auth()).send(input)).status).toBe(400);
    }
});
it("rejects stale settings saves", async () => {
    db.aiContextSettings.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveContextSettings("project-1", "owner-1", { guidance: "new", automaticMemory: true, revision: 2 })).rejects.toMatchObject({ statusCode: 409 });
});
it("rejects oversized messages, too many attachments and unknown chat controls", async () => {
    for (const input of [{ message: "x".repeat(16001) }, { message: "hello", attachments: Array.from({ length: 6 }, () => ({ type: "file" })) }, { message: "hello", userId: "another-user" }]) {
        expect((await request(app).post("/api/projects/project-1/chat").set("Authorization", auth()).send(input)).status).toBe(400);
    }
    expect(db.chatSession.create).not.toHaveBeenCalled();
    expect(db.chatMessage.create).not.toHaveBeenCalled();
});
it("clearing memory invalidates queued extractions and keeps transcripts", async () => {
    await clearProjectMemories("project-1", "owner-1");
    expect(db.aiContextSettings.update).toHaveBeenCalledWith(expect.objectContaining({ data: { memoryGeneration: { increment: 1 } } }));
    expect(db.projectMemory.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FORGOTTEN", content: "", sourceMessageId: null }) }));
    expect(db.chatMessage.deleteMany).not.toHaveBeenCalled();
});
it("forget keeps a tombstone and does not expose another user's note", async () => {
    db.projectMemory.updateMany.mockResolvedValue({ count: 0 });
    await expect(forgetProjectMemory("project-1", "owner-1", "foreign-note")).rejects.toMatchObject({ statusCode: 404 });
    expect(db.projectMemory.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign-note", projectId: "project-1", userId: "owner-1" } }));
});
it("selects bounded pinned/relevant notes and excludes forgotten/review notes", () => {
    const rows = [{ id: "a", content: "Use Jest", pinned: true, status: "ACTIVE", updatedAt: new Date() }, { id: "b", content: "Coverage decisions", pinned: false, status: "ACTIVE", updatedAt: new Date() }, { id: "c", content: "Use Jest instead", pinned: true, status: "REVIEW" }, { id: "d", content: "Use Jest", pinned: true, status: "FORGOTTEN" }];
    expect(selectRelevantMemories(rows, "Jest test").map(row => row.id)).toEqual(["a"]);
});
it("does not silently create a session when an explicit source is inaccessible", async () => {
    db.chatSession.findFirst.mockResolvedValue(null);
    const response = await request(app).post("/api/projects/project-1/chat").set("Authorization", auth()).send({ message: "hello", sessionId: "foreign-session" });
    expect(response.status).toBe(404); expect(db.chatSession.create).not.toHaveBeenCalled();
});
it("materializes an independent branch through the selected boundary", async () => {
    db.chatMessage.findMany.mockResolvedValue([
        { id: "m1", role: "user", content: "Use Jest", model: null, attachments: [] },
        { id: "m2", role: "assistant", content: "Agreed", model: null, attachments: [] },
        { id: "m3", role: "user", content: "Later change", model: null, attachments: [] },
    ]);
    db.chatSession.create.mockResolvedValue({ ...session, id: "branch-1", sourceSessionId: "session-1" });
    const branch = await branchContextSession("project-1", "owner-1", "session-1", { throughMessageId: "m2", useMemory: false });
    expect(branch.id).toBe("branch-1");
    const copies = db.chatMessage.createMany.mock.calls[0][0].data;
    expect(copies.map(row => row.content)).toEqual(["Use Jest", "Agreed"]);
    expect(copies.every(row => row.sessionId === "branch-1")).toBe(true);
    expect(copies[1].createdAt > copies[0].createdAt).toBe(true);
    expect(db.chatSession.update).not.toHaveBeenCalled();
});
it("rejects boundaries outside the source session and unrelated snapshots", async () => {
    db.chatMessage.findMany.mockResolvedValue([{ id: "m1" }]);
    await expect(branchContextSession("project-1", "owner-1", "session-1", { throughMessageId: "other", useMemory: true })).rejects.toMatchObject({ statusCode: 400 });
    db.projectSnapshot.findFirst.mockResolvedValue(null);
    await expect(branchContextSession("project-1", "owner-1", "session-1", { snapshotId: "foreign", useMemory: true })).rejects.toMatchObject({ statusCode: 404 });
    expect(db.chatSession.create).not.toHaveBeenCalled();
});
it("loads newest messages in chronological order and never exposes a lease token", async () => {
    db.chatSession.findFirst.mockResolvedValue({ ...session, processingToken: "private-lock" });
    db.chatMessage.findMany.mockResolvedValue([{ id: "new" }, { id: "old" }]);
    const result = await loadContextSession("project-1", "owner-1", "session-1");
    expect(result.messages.map(row => row.id)).toEqual(["old", "new"]);
    expect(result.session).not.toHaveProperty("processingToken");
});
it("accepting a conflicting note forgets only its owned predecessor", async () => {
    db.projectMemory.findFirst.mockResolvedValue({ id: "review", content: "Use Jest", status: "REVIEW", conflictsWithId: "old", sourceMessageId: "evidence" });
    await editProjectMemory("project-1", "owner-1", "review", { content: "Use Jest", pinned: true, revision: 0 });
    expect(db.projectMemory.updateMany.mock.calls[0][0].data).not.toHaveProperty("sourceMessageId");
    expect(db.projectMemory.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "old", projectId: "project-1", userId: "owner-1", status: "ACTIVE" }, data: expect.objectContaining({ status: "FORGOTTEN", content: "" }) }));
});
it("branches retain snapshot provenance and remap their summary cursor to copied messages", async () => {
    db.chatSession.findFirst.mockResolvedValue({ ...session, snapshotId: "old-snapshot", summary: "Earlier goals", summaryThroughId: "m1" });
    db.chatMessage.findMany.mockResolvedValue([{ id: "m1", content: "goal", role: "user" }, { id: "m2", content: "reply", role: "assistant" }]);
    await branchContextSession("project-1", "owner-1", "session-1", { useMemory: true });
    const copied = db.chatMessage.createMany.mock.calls[0][0].data;
    expect(db.chatSession.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceSnapshotId: "old-snapshot", summary: "Earlier goals", summaryThroughId: copied[0].id }) }));
    expect(copied[0].id).not.toBe("m1");
});
