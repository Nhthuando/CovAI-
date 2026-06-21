import prisma from '../config/prisma.js';

export async function getCyclomaticBySnapshot(params) {
    const { snapshotId, filePath, functionName } = params;

    const where = { snapshotId };
    if (filePath) where.filePath = filePath;
    if (functionName) where.functionName = functionName;

    return await prisma.cyclomatic.findMany({
        where,
        orderBy: {
            value: 'desc'
        }
    });
}

