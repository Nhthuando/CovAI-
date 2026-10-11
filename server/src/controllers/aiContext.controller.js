import { z } from "zod";
import { ServiceError } from "../utils/serviceError.js";
import { parseContext, settingsSchema, noteSchema, editNoteSchema, sessionSchema, branchSchema, chatSchema, previewSchema } from "../validators/aiContext.validation.js";
import { getContextSettings, saveContextSettings, listProjectMemories, createProjectMemory, editProjectMemory, forgetProjectMemory, clearProjectMemories } from "../services/projectMemory.service.js";
import { listContextSessions, createContextSession, loadContextSession, renameContextSession, deleteContextSession, branchContextSession, assembleChatContext, contextPreview } from "../services/chatContext.service.js";
import { sendContextChat } from "../services/chat.service.js";

const endpoint = (run, status = 200) => async (req, res) => {
    try { return res.status(status).json({ success: true, data: await run(req) }); }
    catch (error) {
        if (error instanceof ServiceError) return res.status(error.statusCode).json({ success: false, message: error.message });
        // Avoid disclosing Prisma inputs, model prompts or private memory in errors/logs.
        console.error("[AIContext] Request failed:", error.name);
        return res.status(error.code === "P2002" ? 409 : 500).json({ success: false, message: error.code === "P2002" ? "This memory already exists. Reload the list." : "Could not update AI context. Please try again." });
    }
};
export const aiContextController = {
    settings: endpoint(req => getContextSettings(req.params.id, req.user.id)),
    saveSettings: endpoint(req => saveContextSettings(req.params.id, req.user.id, parseContext(settingsSchema, req.body))),
    memories: endpoint(req => listProjectMemories(req.params.id, req.user.id)),
    addMemory: endpoint(req => createProjectMemory(req.params.id, req.user.id, parseContext(noteSchema, req.body)), 201),
    editMemory: endpoint(req => editProjectMemory(req.params.id, req.user.id, req.params.memoryId, parseContext(editNoteSchema, req.body))),
    forgetMemory: endpoint(req => forgetProjectMemory(req.params.id, req.user.id, req.params.memoryId)),
    clearMemories: endpoint(req => clearProjectMemories(req.params.id, req.user.id)),
    preview: endpoint(async req => contextPreview(await assembleChatContext(req.params.id, req.user.id, parseContext(previewSchema, req.body)))),
    sessions: endpoint(req => listContextSessions(req.params.id, req.user.id)),
    createSession: endpoint(req => createContextSession(req.params.id, req.user.id, parseContext(sessionSchema, req.body)), 201),
    session: endpoint(req => loadContextSession(req.params.id, req.user.id, req.params.sessionId)),
    renameSession: endpoint(req => renameContextSession(req.params.id, req.user.id, req.params.sessionId, parseContext(z.object({ title: z.string().trim().min(1).max(120) }).strict(), req.body).title)),
    deleteSession: endpoint(req => deleteContextSession(req.params.id, req.user.id, req.params.sessionId)),
    branch: endpoint(req => branchContextSession(req.params.id, req.user.id, req.params.sessionId, parseContext(branchSchema, req.body)), 201),
    chat: endpoint(req => sendContextChat(req.params.id, req.user.id, parseContext(chatSchema, req.body))),
};
