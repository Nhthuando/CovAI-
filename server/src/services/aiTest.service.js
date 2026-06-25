import prisma from "../config/prisma.js";
import { ServiceError } from "./project.service.js";

export const getAiTestById = async ({ projectId, testId, userId }) => {
  // 1. Verify project ownership
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: userId },
  });

  if (!project) {
    throw new ServiceError("Project not found or unauthorized", 403);
  }

  // 2. Find the test
  const aiTest = await prisma.aiTest.findFirst({
    where: { id: testId, projectId },
  });

  if (!aiTest) {
    throw new ServiceError("AI Test not found", 404);
  }

  return aiTest;
};

export const listAiTests = async ({
  projectId,
  userId,
  page = 1,
  limit = 10,
}) => {
  // 1. Verify project ownership
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: userId },
  });

  if (!project) {
    throw new ServiceError("Project not found or unauthorized", 403);
  }

  // 2. Count total
  const total = await prisma.aiTest.count({
    where: { projectId },
  });

  // 3. Fetch paginated records
  const items = await prisma.aiTest.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: parseInt(limit),
  });

  return {
    items,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  };
};
