import { jest } from "@jest/globals";
import { fileURLToPath } from "node:url";
export const db = {};
for (const name of ["project", "projectMember", "projectSnapshot", "chatSession", "chatMessage", "chatRequest", "projectEvent", "aiContextSettings", "projectMemory", "coverageSummary", "coverageFile", "testRun"])
    db[name] = Object.fromEntries(["findFirst", "findUnique", "findMany", "create", "createMany", "upsert", "update", "updateMany", "deleteMany", "count"].map(method => [method, jest.fn()]));
db.$transaction = jest.fn(async action => typeof action === "function" ? action(db) : Promise.all(action));
db.$executeRaw = jest.fn(async () => 1);
export const generate = jest.fn(async () => "AI reply");
export const quota = jest.fn(async () => true);
export const enqueue = jest.fn(async () => {});
const modulePath = path => fileURLToPath(new URL(path, import.meta.url));
jest.unstable_mockModule(modulePath("../../config/prisma.js"), () => ({ default: db }));
jest.unstable_mockModule(modulePath("../../services/gemini.service.js"), () => ({ generateText: generate, generateMultimodalText: generate }));
jest.unstable_mockModule(modulePath("../../services/aiQuota.service.js"), () => ({
    checkAndIncrementQuota: quota, reserveAiQuota: async () => { await quota(); return { id: "quota-1" }; },
    consumeAiQuota: jest.fn(), releaseAiQuota: jest.fn(),
}));
jest.unstable_mockModule(modulePath("../../services/projectEvent.service.js"), () => ({
    publishProjectEvent: jest.fn(async data => ({ id: "event-1", ...data, tx: undefined })),
    deliverProjectEvent: jest.fn(async () => {}),
}));
jest.unstable_mockModule(modulePath("../../services/queue.service.js"), () => ({ addJobToQueue: enqueue }));
export const settings = { projectId: "project-1", userId: "owner-1", automaticMemory: false, guidance: "Prefer meaningful assertions", revision: 0, memoryGeneration: 0 };
export const session = { id: "session-1", projectId: "project-1", userId: "owner-1", title: "Testing todo", useMemory: true, snapshotId: "snapshot-1", summary: null, summaryThroughId: null, contextStatus: "READY" };
export const resetContextFixture = () => {
    jest.clearAllMocks();
    for (const model of Object.values(db).filter(item => typeof item === "object")) {
        model.findMany.mockResolvedValue([]); model.count.mockResolvedValue(0); model.updateMany.mockResolvedValue({ count: 1 });
        model.findUnique.mockResolvedValue(null); model.findFirst.mockResolvedValue(null);
        model.create.mockImplementation(async ({ data }) => ({ id: "created-1", ...data }));
        model.createMany.mockResolvedValue({ count: 1 }); model.deleteMany.mockResolvedValue({ count: 1 });
        model.update.mockImplementation(async ({ data }) => ({ ...data }));
    }
    db.project.findFirst.mockResolvedValue({ id: "project-1", ownerId: "owner-1", name: "Todo project" });
    db.projectMember.findUnique.mockResolvedValue(null);
    db.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", commitSha: "abc123", createdAt: new Date(), rootDir: "C:/private/repo/server" });
    db.chatSession.findFirst.mockResolvedValue({ ...session });
    db.chatMessage.findFirst.mockResolvedValue({ id: "user-1", sessionId: "session-1", role: "user", content: "Use Jest for this project", createdAt: new Date() });
    db.aiContextSettings.upsert.mockResolvedValue({ ...settings }); db.aiContextSettings.findUnique.mockResolvedValue({ ...settings });
    db.coverageSummary.findUnique.mockResolvedValue(null);
    generate.mockResolvedValue("AI reply"); quota.mockResolvedValue(true); enqueue.mockResolvedValue(undefined);
};
