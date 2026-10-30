import { beforeEach, expect, it, jest } from "@jest/globals";
await jest.unstable_mockModule("../config/prisma.js", () => ({ default: {} }));
const { reserveAiQuota, releaseAiQuota, consumeAiQuota } = await import("../services/aiQuota.service.js");
const now = new Date("2026-10-28T10:00:00Z");
let db, user, reservations, queryRaw;
beforeEach(() => {
    reservations = [];
    const limit = Number(process.env.AI_DAILY_QUOTA || 50);
    user = { id: "actor", aiUsageDate: "2026-10-28", aiUsageCount: limit - 1 };
    queryRaw = jest.fn(async () => [{ id: user.id }]);
    const tx = {
        $queryRaw: queryRaw,
        user: {
            findUnique: jest.fn(async () => ({ ...user })),
            update: jest.fn(async ({ data }) => Object.assign(user, data)),
            updateMany: jest.fn(async ({ where }) => {
                if (user.aiUsageDate !== where.aiUsageDate || user.aiUsageCount <= 0) return { count: 0 };
                user.aiUsageCount--; return { count: 1 };
            }),
        },
        aiQuotaReservation: {
            findUnique: jest.fn(async ({ where }) => reservations.find(row => where.id ? row.id === where.id : row.userId === where.userId_requestKey.userId && row.requestKey === where.userId_requestKey.requestKey) || null),
            create: jest.fn(async ({ data }) => { const row = { id: `q${reservations.length}`, ...data }; reservations.push(row); return { ...row }; }),
            updateMany: jest.fn(async ({ where, data }) => { const row = reservations.find(item => item.id === where.id && item.status === where.status); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
        },
    };
    // The harness models the serialization provided by the User FOR UPDATE lock.
    // Real PostgreSQL concurrency remains an integration/E2E gate.
    let tail = Promise.resolve();
    db = { ...tx, $transaction: jest.fn(action => { const run = tail.then(() => action(tx)); tail = run.catch(() => {}); return run; }) };
});
it("reserves the final quota slot once across concurrent distinct requests", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => reserveAiQuota({ userId: "actor", requestKey: `r${i}`, now }, db)));
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(reservations).toHaveLength(1);
    expect(user.aiUsageCount).toBe(Number(process.env.AI_DAILY_QUOTA || 50));
    expect(queryRaw).toHaveBeenCalledTimes(10);
    expect(queryRaw.mock.calls[0][0].join("?")).toContain('FOR UPDATE');
});
it("a repeated request key does not charge twice", async () => {
    const a = await reserveAiQuota({ userId: "actor", requestKey: "stable", now }, db);
    const b = await reserveAiQuota({ userId: "actor", requestKey: "stable", now }, db);
    expect(b.id).toBe(a.id);
    expect(reservations).toHaveLength(1);
});
it("consumed requests cannot be refunded and predispatch release is idempotent", async () => {
    const quota = await reserveAiQuota({ userId: "actor", requestKey: "used", now }, db);
    await consumeAiQuota(quota.id, db);
    const count = user.aiUsageCount;
    await releaseAiQuota(quota.id, db);
    expect(user.aiUsageCount).toBe(count);
    user.aiUsageCount--;
    const unused = await reserveAiQuota({ userId: "actor", requestKey: "unused", now }, db);
    await releaseAiQuota(unused.id, db);
    await releaseAiQuota(unused.id, db);
    expect(user.aiUsageCount).toBe(count - 1);
});
