import prisma from '../config/prisma.js';

export async function storeComplexity(data) {
    const existing = await prisma.cyclomatic.findFirst({
        where: {
            snapshotId: data.snapshotId,
            filePath: data.filePath,
            functionName: data.functionName
        }
    });

    if (existing) {
        return await prisma.cyclomatic.update({
            where: { id: existing.id },
            data: { value: data.value }
        });
    } else {
        return await prisma.cyclomatic.create({
            data: {
                snapshotId: data.snapshotId,
                filePath: data.filePath,
                functionName: data.functionName,
                value: data.value
            }
        });
    }
}