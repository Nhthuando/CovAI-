import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

export const requireContextOwner = async (projectId, userId, db = prisma) => {
    if (!userId) throw new ServiceError("Authentication required", 401);
    const project = await db.project.findFirst({ where: { id: projectId, ownerId: userId }, select: { id: true, name: true } });
    if (!project) throw new ServiceError("Project not found", 404);
    return project;
};
export const memoryFingerprint = content => crypto.createHash("sha256").update(content.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
export const ensureContextSettings = (projectId, userId, db = prisma) => db.aiContextSettings.upsert({
    where: { projectId }, update: {}, create: { projectId, userId },
});
export const getContextSettings = async (projectId, userId) => {
    await requireContextOwner(projectId, userId);
    return ensureContextSettings(projectId, userId);
};
export const saveContextSettings = async (projectId, userId, input) => {
    await requireContextOwner(projectId, userId);
    await ensureContextSettings(projectId, userId);
    const result = await prisma.aiContextSettings.updateMany({ where: { projectId, userId, revision: input.revision },
        data: { guidance: input.guidance, automaticMemory: input.automaticMemory, revision: { increment: 1 }, memoryGeneration: { increment: 1 } } });
    if (!result.count) throw new ServiceError("Settings changed in another tab. Reload before saving.", 409);
    return prisma.aiContextSettings.findUnique({ where: { projectId } });
};
const noteProjection = {
    id: true, content: true, pinned: true, revision: true, status: true, createdAt: true, updatedAt: true,
    sourceMessageId: true, conflictsWithId: true, sourceMessage: { select: { sessionId: true, content: true, session: { select: { title: true, snapshotId: true } } } },
};
export const listProjectMemories = async (projectId, userId) => {
    await requireContextOwner(projectId, userId);
    const rows = await prisma.projectMemory.findMany({ where: { projectId, userId, status: { in: ["ACTIVE", "REVIEW"] } }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], select: noteProjection, take: 100 });
    return rows.map(({ sourceMessage, ...row }) => ({ ...row, evidence: sourceMessage ? {
        sessionId: sourceMessage.sessionId, title: sourceMessage.session.title, snapshotId: sourceMessage.session.snapshotId,
        // The memory itself is an exact quote, not the entire potentially private turn.
        quote: row.content,
    } : null }));
};
export const createProjectMemory = async (projectId, userId, input) => {
    await requireContextOwner(projectId, userId);
    await ensureContextSettings(projectId, userId);
    return prisma.$transaction(async tx => {
        await tx.aiContextSettings.update({ where: { projectId }, data: { memoryGeneration: { increment: 1 } } });
        const fingerprint = memoryFingerprint(input.content);
        const existing = await tx.projectMemory.findUnique({ where: { projectId_userId_fingerprint: { projectId, userId, fingerprint } } });
        if ((!existing || existing.status === "FORGOTTEN") && await tx.projectMemory.count({ where: { projectId, userId, status: { in: ["ACTIVE", "REVIEW"] } } }) >= 100)
            throw new ServiceError("Memory limit reached (100 notes). Forget a note first.", 409);
        return tx.projectMemory.upsert({ where: { projectId_userId_fingerprint: { projectId, userId, fingerprint: memoryFingerprint(input.content) } },
            create: { projectId, userId, ...input, fingerprint: memoryFingerprint(input.content) },
            update: { ...input, status: "ACTIVE", sourceMessageId: null, conflictsWithId: null, revision: { increment: 1 } } });
    });
};
export const editProjectMemory = async (projectId, userId, id, input) => {
    await requireContextOwner(projectId, userId);
    return prisma.$transaction(async tx => {
        await ensureContextSettings(projectId, userId, tx);
        await tx.aiContextSettings.update({ where: { projectId }, data: { memoryGeneration: { increment: 1 } } });
        const prior = await tx.projectMemory.findFirst({ where: { id, projectId, userId, revision: input.revision, status: { in: ["ACTIVE", "REVIEW"] } } });
        if (!prior) throw new ServiceError("Memory changed or was removed. Reload before editing.", 409);
        const result = await tx.projectMemory.updateMany({ where: { id, projectId, userId, revision: input.revision, status: { in: ["ACTIVE", "REVIEW"] } },
            data: { content: input.content, pinned: input.pinned, status: "ACTIVE", conflictsWithId: null,
                ...(prior.content !== input.content ? { sourceMessageId: null } : {}), revision: { increment: 1 } } });
        // Keep the original fingerprint as a tombstone for that extraction, even after manual edits.
        if (!result.count) throw new ServiceError("Memory changed or was removed. Reload before editing.", 409);
        if (prior.status === "REVIEW" && prior.conflictsWithId) await tx.projectMemory.updateMany({
            where: { id: prior.conflictsWithId, projectId, userId, status: "ACTIVE" },
            data: { status: "FORGOTTEN", content: "", pinned: false, sourceMessageId: null, revision: { increment: 1 } },
        });
        return tx.projectMemory.findUnique({ where: { id } });
    });
};
export const forgetProjectMemory = async (projectId, userId, id) => {
    await requireContextOwner(projectId, userId);
    return prisma.$transaction(async tx => {
        await ensureContextSettings(projectId, userId, tx);
        await tx.aiContextSettings.update({ where: { projectId }, data: { memoryGeneration: { increment: 1 } } });
        const result = await tx.projectMemory.updateMany({ where: { id, projectId, userId }, data: { status: "FORGOTTEN", content: "", pinned: false, sourceMessageId: null, revision: { increment: 1 } } });
        if (!result.count) throw new ServiceError("Memory not found", 404);
    });
};
export const clearProjectMemories = async (projectId, userId) => {
    await requireContextOwner(projectId, userId);
    return prisma.$transaction(async tx => {
        await ensureContextSettings(projectId, userId, tx);
        await tx.aiContextSettings.update({ where: { projectId }, data: { memoryGeneration: { increment: 1 } } });
        await tx.projectMemory.updateMany({ where: { projectId, userId }, data: { status: "FORGOTTEN", content: "", pinned: false, sourceMessageId: null, revision: { increment: 1 } } });
    });
};
export const selectRelevantMemories = (rows, message, maxBytes = 6000) => {
    const words = new Set(message.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
    const scored = rows.filter(row => row.status === "ACTIVE").map(row => ({ ...row, score: [...new Set(row.content.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(word => words.has(word)).length }));
    scored.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt) || a.id.localeCompare(b.id));
    let bytes = 0;
    const hasMatches = scored.some(row => row.score > 0);
    return scored.filter(row => row.pinned || row.score > 0 || !hasMatches).filter(row => {
        bytes += Buffer.byteLength(row.content, "utf8"); return bytes <= maxBytes;
    }).slice(0, 8);
};
