import prisma from "../config/prisma.js";
import { randomUUID } from "node:crypto";
import { ServiceError } from "../utils/serviceError.js";
import { requireContextOwner, ensureContextSettings, selectRelevantMemories } from "./projectMemory.service.js";

export const messageOrder = [{ createdAt: "asc" }, { id: "asc" }];
export const requireOwnedSession = async (projectId, userId, sessionId, db = prisma) => {
    const session = await db.chatSession.findFirst({ where: { id: sessionId, projectId, userId } });
    if (!session) throw new ServiceError("Conversation not found", 404);
    return session;
};
export const resolveContextSnapshot = async (projectId, snapshotId, db = prisma) => {
    const row = await db.projectSnapshot.findFirst({ where: { projectId, ...(snapshotId ? { id: snapshotId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, commitSha: true, createdAt: true, rootDir: true } });
    if (snapshotId && !row) throw new ServiceError("Snapshot not found", 404);
    return row;
};
export const publicSession = row => {
    const { processingToken, processingUntil, summary, summaryThroughId, ...safe } = row;
    return { ...safe, hasSummary: Boolean(summary) };
};
export const listContextSessions = async (projectId, userId) => {
    await requireContextOwner(projectId, userId);
    return (await prisma.chatSession.findMany({ where: { projectId, userId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 100,
        include: { _count: { select: { messages: true } }, messages: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { content: true, createdAt: true, role: true } } } })).map(publicSession);
};
export const createContextSession = async (projectId, userId, input) => {
    await requireContextOwner(projectId, userId);
    const snapshot = await resolveContextSnapshot(projectId, input.snapshotId);
    return publicSession(await prisma.chatSession.create({ data: { projectId, userId, title: input.title || "New Chat", useMemory: input.useMemory, snapshotId: snapshot?.id || null } }));
};
export const loadContextSession = async (projectId, userId, sessionId) => {
    await requireContextOwner(projectId, userId);
    const session = await requireOwnedSession(projectId, userId, sessionId);
    const messages = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2001 });
    return { session: publicSession(session), messages: messages.slice(0, 2000).reverse(), truncated: messages.length > 2000 };
};
export const renameContextSession = async (projectId, userId, sessionId, title) => {
    await requireContextOwner(projectId, userId);
    await requireOwnedSession(projectId, userId, sessionId);
    return publicSession(await prisma.chatSession.update({ where: { id: sessionId }, data: { title } }));
};
export const deleteContextSession = async (projectId, userId, sessionId) => {
    await requireContextOwner(projectId, userId);
    await requireOwnedSession(projectId, userId, sessionId);
    await prisma.chatSession.deleteMany({ where: { id: sessionId, projectId, userId } });
};
export const branchContextSession = async (projectId, userId, sessionId, input) => {
    await requireContextOwner(projectId, userId);
    const snapshot = await resolveContextSnapshot(projectId, input.snapshotId);
    return prisma.$transaction(async tx => {
        const source = await requireOwnedSession(projectId, userId, sessionId, tx);
        const messages = await tx.chatMessage.findMany({ where: { sessionId }, orderBy: messageOrder, take: 2001 });
        if (messages.length > 2000) throw new ServiceError("Conversation is too large to branch. Start a new chat using saved memory.", 413);
        const end = input.throughMessageId ? messages.findIndex(row => row.id === input.throughMessageId) : messages.length - 1;
        if (end < 0) throw new ServiceError("Branch boundary not found in this conversation", 400);
        const inherited = messages.slice(0, end + 1);
        const copiedIds = new Map(inherited.map(row => [row.id, randomUUID()]));
        const summaryThroughId = copiedIds.get(source.summaryThroughId) || null;
        const attachmentBytes = inherited.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row.attachments || [])), 0);
        if (attachmentBytes > 5 * 1024 * 1024) throw new ServiceError("Conversation attachments are too large to branch.", 413);
        const branch = await tx.chatSession.create({ data: { projectId, userId, title: input.title || `Branch: ${source.title}`.slice(0, 120), useMemory: input.useMemory,
            sourceSessionId: source.id, sourceSnapshotId: source.sourceSnapshotId || source.snapshotId,
            sourceMessageId: inherited.at(-1).id, snapshotId: snapshot?.id || null, contextStatus: "READY",
            summary: summaryThroughId ? source.summary : null, summaryThroughId } });
        // Materialize independent messages. FK cascades from deleting the source cannot erase them.
        // Millisecond offsets preserve transcript order independently of generated message IDs.
        const now = Date.now();
        await tx.chatMessage.createMany({ data: inherited.map((row, index) => ({ id: copiedIds.get(row.id), sessionId: branch.id, role: row.role, content: row.content, model: row.model,
            attachments: durableAttachments(row.attachments), createdAt: new Date(now - inherited.length + index) })) });
        return publicSession(branch);
    });
};
export const durableAttachments = attachments => (Array.isArray(attachments) ? attachments : []).map(att => ({
    type: att.type, name: att.name, path: att.path, mimeType: att.mimeType,
    ...(typeof att.content === "string" ? { content: att.content.slice(0, 100000) } : {}),
    ...(typeof att.data === "string" && att.data.length <= 1500000 ? { data: att.data } : {}),
}));

export const boundHistory = (messages, summaryThroughId, maxBytes = 40000) => {
    const cursor = summaryThroughId ? messages.findIndex(row => row.id === summaryThroughId) : -1;
    const pending = cursor >= 0 ? messages.slice(cursor + 1) : messages;
    let bytes = 0;
    const recent = [];
    for (const row of [...pending].reverse()) {
        const size = Buffer.byteLength(row.content, "utf8");
        if (bytes + size > maxBytes || recent.length >= 24) break;
        bytes += size; recent.unshift(row);
    }
    return { recent, omitted: pending.length - recent.length, cursorValid: !summaryThroughId || cursor >= 0 };
};
export const assembleChatContext = async (projectId, userId, options = {}) => {
    const project = await requireContextOwner(projectId, userId);
    const settings = await ensureContextSettings(projectId, userId);
    const session = options.sessionId ? await requireOwnedSession(projectId, userId, options.sessionId) : null;
    const snapshot = await resolveContextSnapshot(projectId, options.snapshotId);
    const rows = session ? await prisma.chatMessage.findMany({ where: { sessionId: session.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25 }) : [];
    const messages = rows.reverse();
    // A verified cursor can predate the bounded message window in very long chats.
    const outsideCursor = session?.summaryThroughId && !messages.some(row => row.id === session.summaryThroughId)
        ? await prisma.chatMessage.findFirst({ where: { id: session.summaryThroughId, sessionId: session.id } }) : null;
    const cursorBeforeWindow = outsideCursor && messages[0] && (new Date(outsideCursor.createdAt) < new Date(messages[0].createdAt)
        || (+new Date(outsideCursor.createdAt) === +new Date(messages[0].createdAt) && outsideCursor.id < messages[0].id));
    const history = boundHistory(messages, cursorBeforeWindow ? null : session?.summaryThroughId);
    const cursor = messages.find(row => row.id === session?.summaryThroughId) || outsideCursor;
    const pendingCount = session ? await prisma.chatMessage.count({ where: { sessionId: session.id, ...(cursor ? { OR: [
        { createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ] } : {}) } }) : 0;
    history.omitted = Math.max(history.omitted, pendingCount - history.recent.length);
    const memoryEnabled = settings.automaticMemory && (options.useMemory ?? session?.useMemory ?? true);
    const notes = memoryEnabled ? await prisma.projectMemory.findMany({ where: { projectId, userId, status: "ACTIVE" }, take: 100, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] }) : [];
    const selectedNotes = selectRelevantMemories(notes, options.message || "");
    const warnings = [];
    if (session?.snapshotId && snapshot?.id !== session.snapshotId) warnings.push("This conversation started on another snapshot. Historical code claims may be outdated.");
    if (session?.sourceSnapshotId && snapshot?.id !== session.sourceSnapshotId) warnings.push("This branch inherited a transcript from another snapshot. Re-check historical code claims against current files.");
    if (history.omitted || (session?.summaryThroughId && !history.cursorValid)) warnings.push("Older turns were omitted from this request; only available summary and recent turns are included.");
    if (session?.contextStatus === "FAILED") warnings.push("Previous context maintenance failed. Memory may not include the latest decisions.");
    if (history.recent.some(row => durableAttachments(row.attachments).some(att => att.type === "image" || att.mimeType?.startsWith("image/")))) warnings.push("Earlier images are not re-sent automatically. Attach an image again if it is needed.");
    if (history.recent.some(row => durableAttachments(row.attachments).some(att => !att.content && att.type !== "image"))) warnings.push("Some earlier attachments have no durable text content and were omitted.");
    const coverage = snapshot ? await prisma.coverageSummary.findUnique({ where: { snapshotId: snapshot.id }, select: { linesPct: true, branchesPct: true, funcsPct: true, stmtsPct: true } }) : null;
    const files = snapshot && options.message?.trim().toLowerCase() === "analyze coverage" ? await prisma.coverageFile.findMany({ where: { snapshotId: snapshot.id }, select: { filePath: true, linesPct: true, branchesPct: true, funcsPct: true, stmtsPct: true }, take: 60, orderBy: { filePath: "asc" } }) : [];
    const snapshotInfo = snapshot ? { id: snapshot.id, commitSha: snapshot.commitSha, createdAt: snapshot.createdAt,
        analysisPackage: snapshot.rootDir?.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || null } : null;
    const summary = history.cursorValid ? session?.summary?.slice(0, 8000) || "" : "";
    return { project, settings, session, messages, recent: history.recent, summary, selectedNotes, memoryEnabled, warnings,
        snapshot: snapshotInfo, coverage, files, omittedTurns: history.omitted };
};
export const contextPreview = context => ({
    sessionId: context.session?.id || null, sourceSessionId: context.session?.sourceSessionId || null,
    snapshot: context.snapshot, memoryEnabled: context.memoryEnabled, guidance: context.settings.guidance,
    memories: context.selectedNotes.map(({ id, content, sourceMessageId }) => ({ id, content, sourceMessageId })),
    recentTurnCount: context.recent.length, omittedTurnCount: context.omittedTurns, summaryIncluded: Boolean(context.summary),
    summary: context.summary, maintenanceStatus: context.session?.contextStatus || "READY",
    coverage: context.coverage, files: context.files.map(row => row.filePath), warnings: context.warnings,
    sizeUnit: "UTF-8 bytes (not exact model tokens)",
});
