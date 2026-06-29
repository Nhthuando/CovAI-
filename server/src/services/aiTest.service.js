import prisma from "../config/prisma.js";
import { ServiceError } from "./project.service.js";
import { generateText } from "./gemini.service.js";
import { buildFullTestPrompt } from "./fullTestPromptBuilder.service.js";
import { buildAiPayload } from "./aiContextBuilder.service.js";
import { validateGeneratedTest } from "./testValidation.service.js";

export const generateFullTest = async ({ projectId, snapshotId, userId }) => {
  // 1. Verify access
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: userId },
  });
  if (!project) throw new ServiceError("Project not found", 404);

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      coverageSummary: true,
      coverageFuncs: true,
      cfgs: true,
      cyclomatics: true,
    },
  });
  if (!snapshot) throw new ServiceError("Snapshot not found", 404);

  const aiPayloadResult = await buildAiPayload(snapshotId);
  const payload = aiPayloadResult.payload;

  // 2. Build prompt
  const prompt = buildFullTestPrompt({
    sourceCode: payload.sourceCode,
    coverageData: payload.coverage,
    cfgData: payload.cfg,
    cyclomaticData: payload.complexity,
  });

  // 3. AI Generation
  let generatedCode;
  try {
    generatedCode = await generateText(prompt);
  } catch (error) {
    generatedCode = `// TODO: AI Generation failed. Manual intervention required.\n// Error: ${error.message}`;
  }

  // 4. Validate
  const validation = validateGeneratedTest(generatedCode);
  if (!validation.valid) {
    throw new ServiceError(
      `AI generated invalid test code: ${validation.errors.join(", ")}`,
      422,
    );
  }

  // 5. Save
  return await prisma.aiTest.create({
    data: {
      projectId,
      snapshotId,
      mode: "FULL",
      content: generatedCode,
    },
  });
};

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

export const saveAiTestResult = async (data) => {
  const db = prisma;

  if (!db) {
    throw new Error("Prisma client instance is not properly initialized.");
  }

  const { aiTestId, status, output, error, duration } = data;

  // Kiểm tra xem aiTestId có tồn tại trong bảng AiTest không
  const aiTest = await db.aiTest.findUnique({
    where: { id: aiTestId },
  });

  if (!aiTest) {
    console.warn(
      `AiTest with id ${aiTestId} not found. Creating a placeholder.`,
    );

    const project = await db.project.findFirst();
    const snapshot = await db.projectSnapshot.findFirst();

    if (project && snapshot) {
      await db.aiTest.create({
        data: {
          id: aiTestId,
          projectId: project.id,
          snapshotId: snapshot.id,
          mode: "SKELETON",
          content: "Placeholder content for testing",
        },
      });
    } else {
      throw new Error(
        `Cannot create AiTest placeholder: No project or snapshot found.`,
      );
    }
  }

  return await db.aiTestResult.upsert({
    where: { aiTestId },
    update: { status, output, error, duration },
    create: {
      aiTestId,
      status,
      output,
      error,
      duration,
    },
  });
};

export const getAiTestsList = async ({
  projectId,
  userId,
  page = 1,
  limit = 20,
  status,
}) => {
  const db = prisma;
  if (!db)
    throw new Error("Prisma client instance is not properly initialized.");

  if (!projectId) {
    const error = new Error("Project ID is required");
    error.status = 400;
    throw error;
  }

  // Security Check: Verify project ownership
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });

  if (!project) {
    const error = new Error("Project not found");
    error.status = 404;
    throw error;
  }

  if (project.ownerId !== userId) {
    const error = new Error(
      "Forbidden: You do not have access to this project",
    );
    error.status = 403;
    throw error;
  }

  // Pagination calculations
  const skip = (Math.max(1, page) - 1) * limit;

  // Build Filter
  const where = {
    projectId,
    ...(status && { AiTestResult: { status } }), // Lọc theo PASS/FAIL nếu truyền vào
  };

  // Fetch data in parallel
  const [total, tests] = await Promise.all([
    db.aiTest.count({ where }),
    db.aiTest.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        snapshotId: true,
        mode: true,
        filePath: true,
        createdAt: true,
        AiTestResult: {
          select: {
            id: true,
            status: true,
            duration: true,
            error: true, // Vẫn trả error ra ngoài list để frontend biết lý do tóm tắt
            createdAt: true,
          },
        },
      },
    }),
  ]);

  return {
    data: tests,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  };
};
