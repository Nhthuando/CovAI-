import prisma from '../config/prisma.js';

export const saveAiTestResult = async (data) => {
  const db = prisma;
  
  if (!db) {
    throw new Error('Prisma client instance is not properly initialized.');
  }

  const { aiTestId, status, output, error, duration } = data;

  // Kiểm tra xem aiTestId có tồn tại trong bảng AiTest không
  const aiTest = await db.aiTest.findUnique({
    where: { id: aiTestId },
  });

  if (!aiTest) {
    console.warn(`AiTest with id ${aiTestId} not found. Creating a placeholder.`);
    
    const project = await db.project.findFirst();
    const snapshot = await db.projectSnapshot.findFirst();

    if (project && snapshot) {
      await db.aiTest.create({
        data: {
          id: aiTestId,
          projectId: project.id,
          snapshotId: snapshot.id,
          mode: 'SKELETON',
          content: 'Placeholder content for testing',
        },
      });
    } else {
      throw new Error(`Cannot create AiTest placeholder: No project or snapshot found.`);
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

export const getAllAiTests = async () => {
  const db = prisma;
  if (!db) {
    throw new Error('Prisma client instance is not properly initialized.');
  }
  return await db.aiTest.findMany({
    include: {
      aiTestResult: true,
    },
  });
};
