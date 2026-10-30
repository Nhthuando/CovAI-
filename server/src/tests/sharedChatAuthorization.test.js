import { beforeEach, expect, it } from "@jest/globals";
import { db, resetContextFixture, generate, quota, enqueue } from "./helpers/aiContextFixture.js";
const { listContextSessions, loadContextSession, createContextSession, deleteContextSession } = await import("../services/chatContext.service.js");
const { getContextSettings, listProjectMemories, createProjectMemory, clearProjectMemories } = await import("../services/projectMemory.service.js");
const { sendContextChat } = await import("../services/chat.service.js");
beforeEach(resetContextFixture);
const member = role => db.projectMember.findUnique.mockResolvedValue({ role });
it("a Viewer reads sessions, messages, settings and notes created by the Owner", async () => {
    member("VIEWER");
    await listContextSessions("project-1", "viewer");
    expect(db.chatSession.findMany.mock.calls[0][0].where).toEqual({ projectId: "project-1" });
    await loadContextSession("project-1", "viewer", "session-1");
    expect(db.chatSession.findFirst).toHaveBeenLastCalledWith({ where: { id: "session-1", projectId: "project-1" } });
    await getContextSettings("project-1", "viewer");
    await listProjectMemories("project-1", "viewer");
    expect(db.projectMemory.findMany.mock.calls[0][0].where).not.toHaveProperty("userId");
});
it("a Viewer cannot create chat, send to provider, edit notes or delete shared history", async () => {
    member("VIEWER");
    await expect(createContextSession("project-1", "viewer", {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(createProjectMemory("project-1", "viewer", { content: "Use Jest" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(deleteContextSession("project-1", "viewer", "session-1")).rejects.toMatchObject({ statusCode: 403 });
    await expect(sendContextChat("project-1", "viewer", { clientRequestId: "r1", message: "hello", attachments: [] }, { generate, quota, enqueue })).rejects.toMatchObject({ statusCode: 403 });
    expect(generate).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
    expect(db.chatMessage.create).not.toHaveBeenCalled();
    expect(db.projectMemory.upsert).not.toHaveBeenCalled();
    expect(db.aiContextSettings.upsert).not.toHaveBeenCalled();
});
it("an Editor writes shared notes but cannot clear project memory or delete shared chat", async () => {
    member("EDITOR");
    await createProjectMemory("project-1", "editor", { content: "Use Jest", pinned: false });
    expect(db.projectMemory.upsert.mock.calls[0][0].where).toHaveProperty("projectId_fingerprint");
    expect(db.projectMemory.upsert.mock.calls[0][0].create.userId).toBe("editor");
    await expect(clearProjectMemories("project-1", "editor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(deleteContextSession("project-1", "editor", "session-1")).rejects.toMatchObject({ statusCode: 403 });
});
it("the same completed request replays without another quota or provider call", async () => {
    const { chatRequestInputHash } = await import("../services/chatRequest.service.js");
    const input = { clientRequestId: "retry", sessionId: "session-1", message: "hello", attachments: [] };
    db.chatRequest.findFirst.mockResolvedValue({ id: "request-1", sessionId: "session-1", inputHash: chatRequestInputHash(input), status: "SUCCEEDED", assistantMessageId: "reply-1" });
    db.chatMessage.findFirst.mockResolvedValue({ id: "reply-1", role: "assistant", content: "Saved response" });
    const result = await sendContextChat("project-1", "owner-1", input, { generate, quota, enqueue });
    expect(result.reply).toBe("Saved response");
    expect(result.reused).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
});
it("revocation while the provider runs cannot commit a shared message pair", async () => {
    member("EDITOR");
    generate.mockImplementation(async () => { db.project.findFirst.mockResolvedValue(null); return "late response"; });
    await expect(sendContextChat("project-1", "editor", { clientRequestId: "late", sessionId: "session-1", message: "hello", attachments: [] }, { generate, quota, enqueue })).rejects.toMatchObject({ statusCode: 404 });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
});
it("an expired processing lease returns a terminal status so polling cannot hang forever", async () => {
    const { getChatRequest } = await import("../services/chatRequest.service.js");
    db.chatRequest.findFirst.mockResolvedValue({ id: "expired", sessionId: "session-1", status: "PROCESSING" });
    db.chatSession.findFirst.mockResolvedValue({ processingUntil: new Date(0) });
    expect(await getChatRequest("project-1", "owner-1", "expired")).toMatchObject({ status: "FAILED" });
    expect(db.chatRequest.updateMany).not.toHaveBeenCalled();
});
