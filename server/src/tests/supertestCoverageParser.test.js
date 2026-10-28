import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

const prismaMock = {
    coverageSummary: {
        upsert: jest.fn().mockResolvedValue({ id: 'summary-1' }),
    },
    coverageFile: {
        upsert: jest.fn().mockResolvedValue({ id: 'file-1' }),
    },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock,
}));

const { parseCoverageSummary } = await import('../services/coverageSummaryParser.service.js');

describe('supertestCoverageParser', () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-parse-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('should parse valid coverage-summary.json', async () => {
        const mockCoverage = {
            total: {
                lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
                branches: { total: 2, covered: 1, skipped: 0, pct: 50 },
                functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                statements: { total: 10, covered: 8, skipped: 0, pct: 80 }
            },
            'src/index.js': {
                lines: { total: 10, covered: 8, skipped: 0, pct: 80 }
            }
        };
        fs.writeFileSync(path.join(tempDir, 'coverage-summary.json'), JSON.stringify(mockCoverage));

        const result = await parseCoverageSummary(tempDir, 'snapshot-123');
        expect(result.summary).toBeDefined();
        expect(prismaMock.coverageSummary.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { snapshotId: 'snapshot-123' },
            create: expect.objectContaining({
                snapshotId: 'snapshot-123',
                linesPct: 80,
                branchesPct: 50,
                funcsPct: 100,
                stmtsPct: 80,
            }),
        }));
        expect(prismaMock.coverageFile.upsert).toHaveBeenCalled();
        expect(result.fileCount).toBe(1);
    });
});