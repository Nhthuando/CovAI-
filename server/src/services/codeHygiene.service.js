import prisma from '../config/prisma.js';

// Keeps Job.resultJson bounded; the summary always counts every issue.
export const MAX_STORED_HYGIENE_ISSUES = 500;

export const buildCodeHygieneResult = (snapshotId, summary, issues) => ({
    snapshotId,
    summary,
    issues: issues.slice(0, MAX_STORED_HYGIENE_ISSUES),
    issuesTruncated: issues.length > MAX_STORED_HYGIENE_ISSUES
});

const parseResult = (job) => {
    try {
        const result = JSON.parse(job?.resultJson || 'null');
        return result && typeof result === 'object' ? result : null;
    } catch {
        return null;
    }
};

export const getCodeHygieneReport = async (snapshotId) => {
    const job = await prisma.job.findFirst({
        where: { snapshotId, type: 'CODE_HYGIENE', status: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        select: { resultJson: true }
    });
    const result = parseResult(job);
    return {
        summary: result?.summary ?? null,
        issues: Array.isArray(result?.issues) ? result.issues : [],
        issuesTruncated: Boolean(result?.issuesTruncated)
    };
};

export const listProjectCodeHygieneSummaries = async (projectId, limit = 10) => {
    const jobs = await prisma.job.findMany({
        where: { projectId, type: 'CODE_HYGIENE', status: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { snapshotId: true, createdAt: true, resultJson: true }
    });
    return jobs.flatMap((job) => {
        const summary = parseResult(job)?.summary;
        return summary ? [{ ...summary, snapshotId: job.snapshotId, createdAt: job.createdAt }] : [];
    });
};
