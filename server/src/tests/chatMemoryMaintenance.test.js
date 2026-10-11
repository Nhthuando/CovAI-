import { beforeEach, expect, it } from "@jest/globals";
import { db, resetContextFixture, generate, settings, session } from "./helpers/aiContextFixture.js";
const { processChatContextMaintenance, parseMemoryExtraction } = await import("../services/chatMemoryMaintenance.service.js");
beforeEach(resetContextFixture);
const job = { projectId: "project-1", userId: "owner-1", sessionId: "session-1", userMessageId: "user-1", memoryGeneration: 0, extractMemory: true };

it("accepts only exact user quotes and excludes credentials", () => {
    const result = parseMemoryExtraction(JSON.stringify({ notes: [{ quote: "Use Jest" }, { quote: "Invented decision" }, { quote: "api_key=verysecretcredential" }] }), "Use Jest; api_key=verysecretcredential");
    expect(result).toEqual([{ quote: "Use Jest" }]);
});
it("skips extraction after memory is switched off or cleared", async () => {
    db.aiContextSettings.findUnique.mockResolvedValue({ ...settings, automaticMemory: true, memoryGeneration: 1 });
    await processChatContextMaintenance(job, { generate });
    expect(generate).not.toHaveBeenCalled(); expect(db.projectMemory.create).not.toHaveBeenCalled();
});
it("does not resurrect forgotten notes", async () => {
    db.aiContextSettings.findUnique.mockResolvedValue({ ...settings, automaticMemory: true });
    generate.mockResolvedValue('{"notes":[{"quote":"Use Jest"}]}');
    db.projectMemory.findUnique.mockResolvedValue({ id: "forgotten", status: "FORGOTTEN" });
    await processChatContextMaintenance(job, { generate });
    expect(db.projectMemory.create).not.toHaveBeenCalled();
});
it("rechecks the memory generation inside the save transaction", async () => {
    db.aiContextSettings.findUnique.mockResolvedValue({ ...settings, automaticMemory: true });
    generate.mockResolvedValue('{"notes":[{"quote":"Use Jest"}]}');
    db.aiContextSettings.updateMany.mockResolvedValue({ count: 0 });
    await processChatContextMaintenance(job, { generate });
    expect(db.projectMemory.create).not.toHaveBeenCalled();
});
it("saves sourced quotes and marks possible conflicts for review", async () => {
    db.aiContextSettings.findUnique.mockResolvedValue({ ...settings, automaticMemory: true });
    db.projectMemory.findMany.mockResolvedValue([{ id: "old", content: "Use Vitest" }]);
    generate.mockResolvedValue('{"notes":[{"quote":"Use Jest","conflictsWith":"old"}]}');
    await processChatContextMaintenance(job, { generate });
    expect(db.projectMemory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content: "Use Jest", sourceMessageId: "user-1", status: "REVIEW" }) }));
});
it("summarizes the old prefix with a guarded cursor and keeps recent turns", async () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? "assistant" : "user", content: `turn ${index}` }));
    db.chatMessage.findMany.mockResolvedValue(messages);
    generate.mockResolvedValue("Approved goals and pending work");
    await processChatContextMaintenance({ ...job, extractMemory: false }, { generate });
    expect(db.chatSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ summaryThroughId: session.summaryThroughId }), data: { summary: "Approved goals and pending work", summaryThroughId: "m5" } }));
    expect(generate.mock.calls[0][0]).not.toContain("turn 29");
});
it("does not recreate memory after its source conversation is deleted", async () => {
    db.chatSession.findFirst.mockResolvedValue(null);
    await processChatContextMaintenance(job, { generate });
    expect(generate).not.toHaveBeenCalled(); expect(db.projectMemory.create).not.toHaveBeenCalled();
});
it("records failed maintenance without throwing into a successful chat", async () => {
    db.aiContextSettings.findUnique.mockResolvedValue({ ...settings, automaticMemory: true });
    generate.mockRejectedValue(new Error("model unavailable"));
    await expect(processChatContextMaintenance(job, { generate })).resolves.toBeUndefined();
    expect(db.chatSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { contextStatus: "FAILED" } }));
});
