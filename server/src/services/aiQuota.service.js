import { randomUUID } from "node:crypto";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { nextMidnight } from '../utils/geminiQuota.js';

const MAX_QUOTA = process.env.AI_DAILY_QUOTA ? parseInt(process.env.AI_DAILY_QUOTA) : 50;

export const reserveAiQuota = async ({ userId, requestKey, now = new Date() }, db = prisma) => {
  if (!userId || !requestKey) throw new ServiceError("AI quota identity is required", 400);
  return db.$transaction(async tx => {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw new ServiceError("User not found", 404);
  const existing = await tx.aiQuotaReservation.findUnique({ where: { userId_requestKey: { userId, requestKey } } });
  if (existing) return existing;

  // Get current date string in YYYY-MM-DD format (local timezone approximation)
  const timeZone = process.env.AI_QUOTA_TIMEZONE || 'Asia/Ho_Chi_Minh';
  const today = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);

  if (user.aiUsageDate !== today) {
    // New day, reset quota
    await tx.user.update({
      where: { id: userId },
      data: { aiUsageDate: today, aiUsageCount: 1 },
    });
  } else {
    // Same day, check quota
    if (user.aiUsageCount >= MAX_QUOTA) {
      const resetAt=nextMidnight(timeZone).toISOString();
      const display=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'medium'}).format(new Date(resetAt));
      const error=new ServiceError(`You have used all ${MAX_QUOTA} daily AI requests in CovAI. The application limit resets at ${display} (UTC+7). This is the CovAI limit, separate from the selected Gemini model quota.`,429);
      Object.assign(error,{code:'AI_APP_QUOTA_EXCEEDED',resetAt,quotaPeriod:'day'});
      throw error;
    }

    // Increment quota
    await tx.user.update({
      where: { id: userId },
      data: { aiUsageCount: user.aiUsageCount + 1 },
    });
  }
  return tx.aiQuotaReservation.create({ data: { userId, requestKey, usageDate: today, status: "RESERVED" } });
  });
};

export const consumeAiQuota = async (reservationId, db = prisma) => {
  await db.aiQuotaReservation.updateMany({ where: { id: reservationId, status: "RESERVED" }, data: { status: "CONSUMED" } });
};
// Refund only before dispatch, never on an ambiguous provider timeout.
export const releaseAiQuota = async (reservationId, db = prisma) => db.$transaction(async tx => {
  const reservation = await tx.aiQuotaReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) return;
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${reservation.userId} FOR UPDATE`;
  const released = await tx.aiQuotaReservation.updateMany({ where: { id: reservationId, status: "RESERVED" }, data: { status: "RELEASED" } });
  if (released.count) await tx.user.updateMany({ where: { id: reservation.userId, aiUsageDate: reservation.usageDate, aiUsageCount: { gt: 0 } }, data: { aiUsageCount: { decrement: 1 } } });
});
export const checkAndIncrementQuota = async userId => {
  const reservation = await reserveAiQuota({ userId, requestKey: `legacy:${randomUUID()}` });
  await consumeAiQuota(reservation.id);
  return true;
};

export const incrementTokenUsage = async (userId, tokens) => {
  if (!tokens || tokens <= 0) return;
  await prisma.user.update({
    where: { id: userId },
    data: { aiTokenUsage: { increment: tokens } }
  });
};
