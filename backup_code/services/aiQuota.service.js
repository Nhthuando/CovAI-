import prisma from "../config/prisma.js";

class ServiceError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const MAX_QUOTA = process.env.AI_DAILY_QUOTA ? parseInt(process.env.AI_DAILY_QUOTA) : 50;

export const checkAndIncrementQuota = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ServiceError(404, "User not found");

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
      throw new ServiceError(429, "QUOTA_EXCEEDED");
    }
    
    // Increment quota
    await prisma.user.update({
      where: { id: userId },
      data: { aiUsageCount: user.aiUsageCount + 1 },
    });
    return true;
  }
};
