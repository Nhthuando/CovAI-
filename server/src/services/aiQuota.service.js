import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

const MAX_QUOTA = process.env.AI_DAILY_QUOTA ? parseInt(process.env.AI_DAILY_QUOTA) : 50;

export const checkAndIncrementQuota = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ServiceError("User not found", 404);

  // Get current date string in YYYY-MM-DD format (local timezone approximation)
  const today = new Date().toLocaleDateString('en-CA');

  if (user.aiUsageDate !== today) {
    // New day, reset quota
    await prisma.user.update({
      where: { id: userId },
      data: { aiUsageDate: today, aiUsageCount: 1 },
    });
    return true;
  } else {
    // Same day, check quota
    if (user.aiUsageCount >= MAX_QUOTA) {
      throw new ServiceError("QUOTA_EXCEEDED", 429);
    }

    // Increment quota
    await prisma.user.update({
      where: { id: userId },
      data: { aiUsageCount: user.aiUsageCount + 1 },
    });
    return true;
  }
};

export const incrementTokenUsage = async (userId, tokens) => {
  if (!tokens || tokens <= 0) return;
  await prisma.user.update({
    where: { id: userId },
    data: { aiTokenUsage: { increment: tokens } }
  });
};
