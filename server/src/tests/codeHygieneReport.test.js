import { jest, test, expect } from '@jest/globals';

const job = { findFirst: jest.fn(), findMany: jest.fn() };
await jest.unstable_mockModule('../config/prisma.js', () => ({ default: { job } }));

const {
    buildCodeHygieneResult,
    getCodeHygieneReport,
    listProjectCodeHygieneSummaries
} = await import('../services/codeHygiene.service.js');

test('keeps every issue at the storage limit', () => {
    const issues = Array.from({ length: 500 }, (_, index) => ({ line: index + 1 }));
    const summary = { totalIssues: issues.length };

    expect(buildCodeHygieneResult('s1', summary, issues)).toEqual({
        snapshotId: 's1',
        summary,
        issues,
        issuesTruncated: false
    });
});

test('caps stored issues and preserves the full summary count', () => {
    const issues = Array.from({ length: 501 }, (_, index) => ({ line: index + 1 }));
    const summary = { totalIssues: issues.length };

    expect(buildCodeHygieneResult('s1', summary, issues)).toEqual({
        snapshotId: 's1',
        summary,
        issues: issues.slice(0, 500),
        issuesTruncated: true
    });
});

test('reads the report from the newest successful hygiene job for the snapshot', async () => {
    const report = {
        summary: { totalIssues: 1 },
        issues: [{ filePath: 'src/a.js', line: 1 }],
        issuesTruncated: false
    };
    job.findFirst.mockResolvedValueOnce({ resultJson: JSON.stringify(report) });

    await expect(getCodeHygieneReport('s1')).resolves.toEqual(report);
    expect(job.findFirst).toHaveBeenCalledWith({
        where: { snapshotId: 's1', type: 'CODE_HYGIENE', status: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        select: { resultJson: true }
    });
});

test.each([
    ['no successful job', null],
    ['malformed result JSON', { resultJson: '{' }]
])('returns an empty report for %s', async (_scenario, result) => {
    job.findFirst.mockResolvedValueOnce(result);

    await expect(getCodeHygieneReport('s1')).resolves.toEqual({
        summary: null,
        issues: [],
        issuesTruncated: false
    });
});

test('skips project jobs without a summary', async () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const summary = { totalIssues: 1 };
    job.findMany.mockResolvedValueOnce([
        { snapshotId: 's1', createdAt, resultJson: JSON.stringify({ summary }) },
        { snapshotId: 's2', createdAt, resultJson: JSON.stringify({ issues: [] }) },
        { snapshotId: 's3', createdAt, resultJson: '{' }
    ]);

    await expect(listProjectCodeHygieneSummaries('p1')).resolves.toEqual([
        { ...summary, snapshotId: 's1', createdAt }
    ]);
    expect(job.findMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', type: 'CODE_HYGIENE', status: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { snapshotId: true, createdAt: true, resultJson: true }
    });
});
