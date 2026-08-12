import prisma from '../config/prisma.js';

export const saveCodeHygieneReport = async (snapshotId, issues, summary) => {
    return await prisma.$transaction(async (tx) => {
        // Idempotent storage: delete existing
        await tx.codeHygieneIssue.deleteMany({ where: { snapshotId } });
        await tx.codeHygieneSummary.deleteMany({ where: { snapshotId } });

        // Bulk insert issues
        if (issues.length > 0) {
            await tx.codeHygieneIssue.createMany({
                data: issues.map(issue => ({
                    ...issue,
                    snapshotId
                }))
            });
        }

        // Insert summary
        return await tx.codeHygieneSummary.create({
            data: {
                ...summary,
                snapshotId
            }
        });
    });
};

export const getCodeHygieneReport = async (snapshotId) => {
    const summary = await prisma.codeHygieneSummary.findUnique({
        where: { snapshotId }
    });
    const issues = await prisma.codeHygieneIssue.findMany({
        where: { snapshotId }
    });
    return { summary, issues };
};