import prisma from "../config/prisma.js";
import { randomUUID } from "node:crypto";
import { ServiceError } from "../utils/serviceError.js";
import { requireContextOwner, ensureContextSettings, selectRelevantMemories } from "./projectMemory.service.js";
import { withProjectGuard } from "./projectAccess.service.js";

export const messageOrder = [{ createdAt: "asc" }, { id: "asc" }];
export const requireOwnedSession = async (projectId, userId, sessionId, db = prisma) => {
    await requireContextOwner(projectId, userId, db);
    const session = await db.chatSession.findFirst({ where: { id: sessionId, projectId } });
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
    return (await prisma.chatSession.findMany({ where: { projectId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 100,
        include: { _count: { select: { messages: true } }, messages: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { content: true, createdAt: true, role: true } } } })).map(publicSession);
};
export const createContextSession = async (projectId, userId, input) => {
    return withProjectGuard({ projectId, userId, capability: "chat.write" }, async tx => {
        const snapshot = await resolveContextSnapshot(projectId, input.snapshotId, tx);
        return publicSession(await tx.chatSession.create({ data: { projectId, userId, title: input.title || "New Chat", useMemory: input.useMemory, snapshotId: snapshot?.id || null } }));
    });
};
export const loadContextSession = async (projectId, userId, sessionId) => {
    await requireContextOwner(projectId, userId);
    const session = await requireOwnedSession(projectId, userId, sessionId);
    const messages = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2001,
        include: { senderUser: { select: { id: true, name: true, email: true, avatarUrl: true } } } });
    return { session: publicSession(session), messages: messages.slice(0, 2000).reverse(), truncated: messages.length > 2000 };
};
export const renameContextSession = async (projectId, userId, sessionId, title) => {
    return withProjectGuard({ projectId, userId, capability: "chat.write" }, async tx => {
        await requireOwnedSession(projectId, userId, sessionId, tx);
        return publicSession(await tx.chatSession.update({ where: { id: sessionId }, data: { title } }));
    });
};
export const deleteContextSession = async (projectId, userId, sessionId) => {
    return withProjectGuard({ projectId, userId, capability: "chat.delete" }, async tx => {
        await requireOwnedSession(projectId, userId, sessionId, tx);
        await tx.chatSession.deleteMany({ where: { id: sessionId, projectId } });
    });
};
export const branchContextSession = async (projectId, userId, sessionId, input) => {
    return withProjectGuard({ projectId, userId, capability: "chat.write" }, async tx => {
        const snapshot = await resolveContextSnapshot(projectId, input.snapshotId, tx);
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
            senderUserId: row.senderUserId || null, replyToMessageId: copiedIds.get(row.replyToMessageId) || null,
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
    const notes = memoryEnabled ? await prisma.projectMemory.findMany({ where: { projectId, status: "ACTIVE" }, take: 100, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] }) : [];
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
    const screenContext = options.screenContext || null;
    const types = { unit: ["JEST", "VITEST"], integration: ["SUPERTEST"], system: ["PLAYWRIGHT", "CYPRESS"] };
    const testResults = snapshot && screenContext?.activity === "coverage" && types[screenContext.testType]
        ? await prisma.testRun.findFirst({ where: { snapshotId: snapshot.id, type: { in: types[screenContext.testType] } }, orderBy: { createdAt: "desc" },
            select: { id: true, type: true, status: true, executionMode: true, totalTests: true, passedTests: true, failedTests: true, skippedTests: true, finishedAt: true,
                scenarios: { where: { status: "FAILED" }, take: 8, select: { title: true, testFile: true, failureMessages: true } } } }) : null;
    if (screenContext?.testType && !testResults) warnings.push("No saved test run is available for the current screen. Do not infer results from conversation history.");
    if (testResults?.scenarios) testResults.scenarios = testResults.scenarios.map(row => ({ ...row,
        failureMessages: row.failureMessages.slice(0, 2).map(text => text.slice(0, 1500)) }));
    const snapshotInfo = snapshot ? { id: snapshot.id, commitSha: snapshot.commitSha, createdAt: snapshot.createdAt,
        analysisPackage: snapshot.rootDir?.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || null } : null;
    const summary = history.cursorValid ? session?.summary?.slice(0, 8000) || "" : "";
    return { project, settings, session, messages, recent: history.recent, summary, selectedNotes, memoryEnabled, warnings,
        screenContext, testResults, snapshot: snapshotInfo, coverage, files, omittedTurns: history.omitted };
};
export const contextPreview = context => ({
    sessionId: context.session?.id || null, sourceSessionId: context.session?.sourceSessionId || null,
    snapshot: context.snapshot, memoryEnabled: context.memoryEnabled, guidance: context.settings.guidance,
    memories: context.selectedNotes.map(({ id, content, sourceMessageId }) => ({ id, content, sourceMessageId })),
    recentTurnCount: context.recent.length, omittedTurnCount: context.omittedTurns, summaryIncluded: Boolean(context.summary),
    summary: context.summary, maintenanceStatus: context.session?.contextStatus || "READY",
    screenContext: context.screenContext, testResults: context.testResults, coverage: context.coverage, files: context.files.map(row => row.filePath), warnings: context.warnings,
    sizeUnit: "UTF-8 bytes (not exact model tokens)",
});
