import { createHash, randomUUID } from "node:crypto";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectAccess, withProjectGuard } from "./projectAccess.service.js";

const conflict = (message, code = "CHAT_BUSY") => Object.assign(new ServiceError(message, 409), { code });
export const chatRequestInputHash = input => createHash("sha256").update(JSON.stringify({
    message: input.message, sessionId: input.sessionId || null, snapshotId: input.snapshotId || null,
    model: input.model || null, useMemory: input.useMemory ?? true, attachments: input.attachments || [],
    screenContext: input.screenContext || null,
})).digest("hex");
export const publicChatRequest = row => ({
    id: row.id, requestId: row.id, sessionId: row.sessionId, status: row.status,
    userMessageId: row.userMessageId, assistantMessageId: row.assistantMessageId,
});
export const getChatRequest = async (projectId, userId, requestId) => {
    await resolveProjectAccess({ projectId, userId, capability: "project.read" });
    const row = await prisma.chatRequest.findFirst({ where: { id: requestId, session: { projectId } } });
    if (!row) throw new ServiceError("Chat request not found", 404);
    if (row.status === "PROCESSING") {
        const session = await prisma.chatSession.findFirst({ where: { id: row.sessionId, projectId }, select: { processingUntil: true } });
        if (!session?.processingUntil || new Date(session.processingUntil) <= new Date()) return publicChatRequest({ ...row, status: "FAILED" });
    }
    return publicChatRequest(row);
};
export const claimChatRequest = async ({ projectId, userId, input, snapshotId }) =>
    withProjectGuard({ projectId, userId, capability: "chat.write" }, async tx => {
        if (!input.clientRequestId) throw new ServiceError("clientRequestId is required", 400);
        const inputHash = chatRequestInputHash(input);
        const prior = await tx.chatRequest.findFirst({ where: {
            actorId: userId, clientRequestId: input.clientRequestId, session: { projectId },
        } });
        if (prior) {
            if (prior.inputHash !== inputHash) throw conflict("This request ID was already used for a different message.", "CHAT_REQUEST_CHANGED");
            if (prior.status === "PROCESSING") {
                const active = await tx.chatSession.findFirst({ where: { id: prior.sessionId, projectId, processingUntil: { gt: new Date() } } });
                if (!active) {
                    await tx.chatRequest.updateMany({ where: { id: prior.id, status: "PROCESSING" }, data: { status: "FAILED" } });
                    return { request: { ...prior, status: "FAILED" }, reused: true };
                }
            }
            return { request: prior, reused: true };
        }
        const session = input.sessionId
            ? await tx.chatSession.findFirst({ where: { id: input.sessionId, projectId } })
            : await tx.chatSession.create({ data: {
                projectId, userId, title: input.message.replace(/[\r\n]+/g, " ").slice(0, 40),
                useMemory: input.useMemory ?? true, snapshotId: snapshotId || null,
            } });
        if (!session) throw new ServiceError("Conversation not found", 404);
        const token = randomUUID();
        const lease = await tx.chatSession.updateMany({ where: {
            id: session.id, projectId,
            OR: [{ processingUntil: null }, { processingUntil: { lt: new Date() } }],
        }, data: { processingToken: token, processingUntil: new Date(Date.now() + 120000) } });
        if (!lease.count) throw conflict("This conversation is processing another message. Your draft was not saved.");
        const request = await tx.chatRequest.create({ data: {
            sessionId: session.id, actorId: userId, clientRequestId: input.clientRequestId,
            inputHash, status: "PROCESSING",
        } });
        return { request, session, token, reused: false };
    });

export const renewChatRequestLease = ({ projectId, userId, sessionId, token }) =>
    withProjectGuard({ projectId, userId, capability: "chat.write" }, async tx => {
        const result = await tx.chatSession.updateMany({ where: {
            id: sessionId, projectId, processingToken: token, processingUntil: { gt: new Date() },
        }, data: { processingUntil: new Date(Date.now() + 120000) } });
        if (!result.count) throw conflict("Conversation processing lease expired. The response will not be saved.");
    });

export const replayChatRequest = async request => {
    const assistant = request.assistantMessageId && await prisma.chatMessage.findFirst({ where: {
        id: request.assistantMessageId, sessionId: request.sessionId, role: "assistant",
    } });
    if (request.status === "SUCCEEDED" && assistant) return {
        ...publicChatRequest(request), reply: assistant.content, reused: true,
    };
    if (request.status === "PROCESSING") return { ...publicChatRequest(request), processing: true, reused: true };
    throw conflict("The previous attempt failed. Keep your draft and send it as a new request.", "CHAT_REQUEST_FAILED");
};
