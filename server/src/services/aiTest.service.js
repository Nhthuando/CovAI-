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

export const getAiTestsList = async ({ projectId, userId, page = 1, limit = 20, status }) => {
  const db = prisma;
  if (!db) throw new Error('Prisma client instance is not properly initialized.');

  if (!projectId) {
    const error = new Error('Project ID is required');
    error.status = 400;
    throw error;
  }

  // Security Check: Verify project ownership
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true }
  });

  if (!project) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }

  if (project.ownerId !== userId) {
    const error = new Error('Forbidden: You do not have access to this project');
    error.status = 403;
    throw error;
  }

  // Pagination calculations
  const skip = (Math.max(1, page) - 1) * limit;

  // Build Filter
  const where = {
    projectId,
    ...(status && { aiTestResult: { status } }) // Lọc theo PASS/FAIL nếu truyền vào
  };

  // Fetch data in parallel
  const [total, tests] = await Promise.all([
    db.aiTest.count({ where }),
    db.aiTest.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        snapshotId: true,
        mode: true,
        filePath: true,
        createdAt: true,
        aiTestResult: {
          select: {
            id: true,
            status: true,
            duration: true,
            error: true, // Vẫn trả error ra ngoài list để frontend biết lý do tóm tắt
            createdAt: true
          }
        }
      }
    })
  ]);

  return {
    data: tests,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit)
    }
  };
};
