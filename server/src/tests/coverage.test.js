import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

const mockPrisma = {
    projectSnapshot: {
        update: jest.fn().mockResolvedValue({}),
    },
};

const mockBucket = {
    file: jest.fn(),
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: mockPrisma,
}));

jest.unstable_mockModule('../config/firebase.js', () => ({
    getBucket: jest.fn(() => mockBucket),
}));

const { storeCoverageOutputs } = await import('../services/coverageStorage.service.js');

const makeWriteStream = () => {
    const stream = new Writable({
        write(chunk, encoding, callback) {
            callback();
        },
    });

    const end = stream.end.bind(stream);
    stream.end = (...args) => {
        end(...args);
        process.nextTick(() => stream.emit('finish'));
    };

    return stream;
};

describe('coverage storage regression', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.projectSnapshot.update.mockResolvedValue({});
        mockBucket.file.mockReturnValue({
            createWriteStream: jest.fn(() => makeWriteStream()),
        });
    });

    it('updates ProjectSnapshot using the Prisma field storagePath and returns the storage prefix', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-coverage-'));
        const baseStoragePath = 'projects/proj-1/snapshots/snap-1/coverage';

        try {
            fs.writeFileSync(path.join(tempDir, 'coverage-summary.json'), JSON.stringify({ total: { lines: { pct: 90 } } }));
            fs.writeFileSync(path.join(tempDir, 'coverage-final.json'), JSON.stringify({ total: { lines: { pct: 90 } } }));
            fs.writeFileSync(path.join(tempDir, 'lcov.info'), 'TN:\nSF:src/index.js\nend_of_record\n');

            const result = await storeCoverageOutputs('snap-1', 'proj-1', tempDir);

            expect(result.baseStoragePath).toBe(baseStoragePath);
            expect(mockPrisma.projectSnapshot.update).toHaveBeenCalledWith({
                where: { id: 'snap-1' },
                data: { storagePath: baseStoragePath },
            });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
