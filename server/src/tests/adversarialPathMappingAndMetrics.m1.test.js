import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Prisma Mock ─────────────────────────────────────────────────────────────
const upsertSummaryCalls = [];
const upsertFileCalls = [];
const prismaMock = {
    $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') return await cb(prismaMock);
        if (Array.isArray(cb)) return await Promise.all(cb);
        return cb;
    }),
    coverageSummary: {
        findUnique: jest.fn(),
        upsert: jest.fn(async (args) => {
            upsertSummaryCalls.push(args);
            return { id: 'summary-1', ...args.create };
        }),
    },
    coverageFile: {
        findMany: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(async (args) => {
            upsertFileCalls.push(args);
            return { id: `file-${upsertFileCalls.length}`, ...args.create };
        }),
    },
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
    },
    project: {
        findFirst: jest.fn(),
    },
    projectMember: {
        findUnique: jest.fn().mockResolvedValue(null),
    },
    testRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
    },
    job: {
        findFirst: jest.fn().mockResolvedValue(null),
    },
    aiTest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ai-1' }),
        update: jest.fn().mockResolvedValue({ id: 'ai-1' }),
    },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock,
    prisma: prismaMock,
}));

// Mock project access so controllers don't reject
jest.unstable_mockModule('../services/projectAccess.service.js', () => ({
    membershipWhere: jest.fn(() => ({})),
    resolveProjectAccess: jest.fn().mockResolvedValue(true),
    resolveSnapshotAccess: jest.fn().mockResolvedValue(true),
    withProjectGuard: jest.fn((opts, fn) => fn()),
}));

// Mock queue to avoid Redis connection hanging tests
jest.unstable_mockModule('../services/queue.service.js', () => ({
    addJobToQueue: jest.fn(),
    addSupertestCoveragePipeline: jest.fn(),
    jobQueue: {},
}));

// Dynamic imports after module mocks
const { cleanStoragePath, cleanStorageText, canonicalizeFilePath } = await import('../utils/pathSanitizer.js');
const { parseCoverageSummary } = await import('../services/coverageSummaryParser.service.js');
const {
    getCoverageFiles,
    getCoverageSummary,
    resolveProjectRelativePath,
    getNormalizedMatchKey,
} = await import('../controllers/coverage.controller.js');

describe('Milestone 1 Adversarial Verification Suite: Path Mapping & Metrics Propagation', () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        upsertSummaryCalls.length = 0;
        upsertFileCalls.length = 0;
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-m1-adversarial-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 1: canonicalizeFilePath Deep Stress Testing
    // ─────────────────────────────────────────────────────────────────────────
    describe('1. canonicalizeFilePath Probing & Edge Cases', () => {
        test('1.1: subproject path "src/controllers/chatController.js" when running from monorepo root', () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'controllers', 'chatController.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const chat = {};');

            const res = canonicalizeFilePath('src/controllers/chatController.js', tempDir);
            expect(res).toBe('server/src/controllers/chatController.js');
        });

        test('1.2: subproject path when rootDir is subproject folder under /repo/server', () => {
            const subprojectRoot = '/app/storage/projects/cmut123/github/999/repo/server';
            const res = canonicalizeFilePath('src/controllers/chatController.js', subprojectRoot);
            expect(res).toBe('server/src/controllers/chatController.js');
        });

        test('1.3: full storage subproject path under /repo/server', () => {
            const fullPath = '/app/storage/projects/cmut123/github/999/repo/server/src/controllers/chatController.js';
            const res = canonicalizeFilePath(fullPath, tempDir);
            expect(res).toBe('server/src/controllers/chatController.js');
        });

        test('1.4: already canonicalized path "server/src/controllers/chatController.js" does not double prefix', () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'controllers', 'chatController.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const chat = {};');

            const res = canonicalizeFilePath('server/src/controllers/chatController.js', tempDir);
            expect(res).toBe('server/src/controllers/chatController.js');
        });

        test('1.5: single-package project paths (e.g. "src/index.js") preserved without prepending server/', () => {
            const rootSource = path.join(tempDir, 'src', 'index.js');
            fs.mkdirSync(path.dirname(rootSource), { recursive: true });
            fs.writeFileSync(rootSource, 'console.log("single-package");');

            const res = canonicalizeFilePath('src/index.js', tempDir);
            expect(res).toBe('src/index.js');
        });

        test('1.6: multiple candidate subprojects (client, backend, services)', () => {
            const clientSource = path.join(tempDir, 'client', 'src', 'App.jsx');
            const backendSource = path.join(tempDir, 'backend', 'src', 'api.js');
            const serviceSource = path.join(tempDir, 'services', 'worker', 'job.js');
            fs.mkdirSync(path.dirname(clientSource), { recursive: true });
            fs.mkdirSync(path.dirname(backendSource), { recursive: true });
            fs.mkdirSync(path.dirname(serviceSource), { recursive: true });
            fs.writeFileSync(clientSource, 'export default () => null;');
            fs.writeFileSync(backendSource, 'export const api = {};');
            fs.writeFileSync(serviceSource, 'export const runJob = () => {};');

            expect(canonicalizeFilePath('src/App.jsx', tempDir)).toBe('client/src/App.jsx');
            expect(canonicalizeFilePath('src/api.js', tempDir)).toBe('backend/src/api.js');
            expect(canonicalizeFilePath('worker/job.js', tempDir)).toBe('services/worker/job.js');
        });

        test('1.7: custom subproject folder discovered via readdirSync', () => {
            const customSubDir = path.join(tempDir, 'microservice-auth', 'src', 'auth.js');
            fs.mkdirSync(path.dirname(customSubDir), { recursive: true });
            fs.writeFileSync(customSubDir, 'export const auth = {};');

            const res = canonicalizeFilePath('src/auth.js', tempDir);
            expect(res).toBe('microservice-auth/src/auth.js');
        });

        test('1.8: non-existent file or unusual extensions do not throw and cleanly format', () => {
            expect(canonicalizeFilePath('src/unknown/nonexistent.wasm', tempDir)).toBe('src/unknown/nonexistent.wasm');
            expect(canonicalizeFilePath('src/legacy.min.js', tempDir)).toBe('src/legacy.min.js');
            expect(canonicalizeFilePath('styles/theme.module.scss', tempDir)).toBe('styles/theme.module.scss');
            expect(canonicalizeFilePath('config/.env.local', tempDir)).toBe('config/.env.local');
        });

        test('1.9: rootDir folder basename stripped if path starts with it', () => {
            const rootBasename = path.basename(tempDir);
            const serverSource = path.join(tempDir, 'server', 'src', 'index.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const a = 1;');

            const input = `${rootBasename}/server/src/index.js`;
            expect(canonicalizeFilePath(input, tempDir)).toBe('server/src/index.js');
        });

        test('1.10: null, undefined, empty string, path traversal, windows backslashes and leading slashes', () => {
            expect(canonicalizeFilePath(null, tempDir)).toBe('');
            expect(canonicalizeFilePath(undefined, tempDir)).toBe('');
            expect(canonicalizeFilePath('', tempDir)).toBe('');
            expect(canonicalizeFilePath('   ', tempDir)).toBe('');
            expect(canonicalizeFilePath('server\\src\\controllers\\chatController.js', tempDir)).toBe('server/src/controllers/chatController.js');
            expect(canonicalizeFilePath('/server/src/controllers/chatController.js', tempDir)).toBe('server/src/controllers/chatController.js');
            expect(canonicalizeFilePath('./server/src/controllers/chatController.js', tempDir)).toBe('server/src/controllers/chatController.js');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 2: coverageSummaryParser Overlapping Merges & Math.max Protection
    // ─────────────────────────────────────────────────────────────────────────
    describe('2. coverageSummaryParser Overlapping Merging & Math.max', () => {
        test('2.1: overlapping entries [80% then 0%] preserves 80% coverage via Math.max', async () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'controllers', 'chatController.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const chat = {};');

            const covDir = path.join(tempDir, 'coverage');
            fs.mkdirSync(covDir, { recursive: true });
            const mockCoverage = {
                total: {
                    lines: { total: 20, covered: 16, skipped: 0, pct: 80 },
                    statements: { total: 20, covered: 16, skipped: 0, pct: 80 },
                    functions: { total: 4, covered: 4, skipped: 0, pct: 100 },
                    branches: { total: 4, covered: 2, skipped: 0, pct: 50 },
                },
                // First entry has positive coverage
                'src/controllers/chatController.js': {
                    lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
                    statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
                    functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
                    branches: { total: 2, covered: 1, skipped: 0, pct: 50 },
                },
                // Second entry has 0% coverage (e.g. from an unexecuted suite)
                'server/src/controllers/chatController.js': {
                    lines: { total: 10, covered: 0, skipped: 0, pct: 0 },
                    statements: { total: 10, covered: 0, skipped: 0, pct: 0 },
                    functions: { total: 2, covered: 0, skipped: 0, pct: 0 },
                    branches: { total: 2, covered: 0, skipped: 0, pct: 0 },
                },
            };
            fs.writeFileSync(path.join(covDir, 'coverage-summary.json'), JSON.stringify(mockCoverage));

            const res = await parseCoverageSummary(covDir, 'snap-101', { rootDir: tempDir });
            expect(res.fileCount).toBe(2);

            // Verify upsertFileCalls: must be exactly 1 deduped entry for server/src/controllers/chatController.js
            expect(upsertFileCalls.length).toBe(1);
            const row = upsertFileCalls[0].create;
            expect(row.filePath).toBe('server/src/controllers/chatController.js');
            expect(row.linesPct).toBe(80);
            expect(row.stmtsPct).toBe(80);
            expect(row.funcsPct).toBe(100);
            expect(row.branchesPct).toBe(50);
        });

        test('2.2: reverse ordering [0% then 80%] ensures 80% coverage overwrites 0%', async () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'controllers', 'chatController.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const chat = {};');

            const covDir = path.join(tempDir, 'coverage');
            fs.mkdirSync(covDir, { recursive: true });
            const mockCoverage = {
                total: {
                    lines: { total: 20, covered: 16, skipped: 0, pct: 80 },
                    statements: { total: 20, covered: 16, skipped: 0, pct: 80 },
                    functions: { total: 4, covered: 4, skipped: 0, pct: 100 },
                    branches: { total: 4, covered: 2, skipped: 0, pct: 50 },
                },
                // First entry has 0%
                'server/src/controllers/chatController.js': {
                    lines: { total: 10, covered: 0, skipped: 0, pct: 0 },
                    statements: { total: 10, covered: 0, skipped: 0, pct: 0 },
                    functions: { total: 2, covered: 0, skipped: 0, pct: 0 },
                    branches: { total: 2, covered: 0, skipped: 0, pct: 0 },
                },
                // Second entry has 85%
                'src/controllers/chatController.js': {
                    lines: { total: 10, covered: 9, skipped: 0, pct: 90 },
                    statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
                    functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
                    branches: { total: 2, covered: 1, skipped: 0, pct: 50 },
                },
            };
            fs.writeFileSync(path.join(covDir, 'coverage-summary.json'), JSON.stringify(mockCoverage));

            await parseCoverageSummary(covDir, 'snap-102', { rootDir: tempDir });

            expect(upsertFileCalls.length).toBe(1);
            const row = upsertFileCalls[0].create;
            expect(row.filePath).toBe('server/src/controllers/chatController.js');
            expect(row.linesPct).toBe(90);
            expect(row.stmtsPct).toBe(80);
        });

        test('2.3: cross-metric Math.max (file A has higher lines, file B has higher branches)', async () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'utils', 'helper.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const help = () => {};');

            const covDir = path.join(tempDir, 'coverage');
            fs.mkdirSync(covDir, { recursive: true });
            const mockCoverage = {
                total: {
                    lines: { total: 20, covered: 20, skipped: 0, pct: 100 },
                    statements: { total: 20, covered: 20, skipped: 0, pct: 100 },
                    functions: { total: 4, covered: 4, skipped: 0, pct: 100 },
                    branches: { total: 4, covered: 4, skipped: 0, pct: 100 },
                },
                'src/utils/helper.js': {
                    lines: { total: 10, covered: 9, skipped: 0, pct: 90 },
                    statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
                    functions: { total: 4, covered: 1, skipped: 0, pct: 25 },
                    branches: { total: 4, covered: 1, skipped: 0, pct: 25 },
                },
                'server/src/utils/helper.js': {
                    lines: { total: 10, covered: 3, skipped: 0, pct: 30 },
                    statements: { total: 10, covered: 4, skipped: 0, pct: 40 },
                    functions: { total: 4, covered: 4, skipped: 0, pct: 100 },
                    branches: { total: 4, covered: 3, skipped: 0, pct: 75 },
                },
            };
            fs.writeFileSync(path.join(covDir, 'coverage-summary.json'), JSON.stringify(mockCoverage));

            await parseCoverageSummary(covDir, 'snap-103', { rootDir: tempDir });

            expect(upsertFileCalls.length).toBe(1);
            const row = upsertFileCalls[0].create;
            expect(row.filePath).toBe('server/src/utils/helper.js');
            expect(row.linesPct).toBe(90);    // Math.max(90, 30)
            expect(row.stmtsPct).toBe(80);    // Math.max(80, 40)
            expect(row.funcsPct).toBe(100);   // Math.max(25, 100)
            expect(row.branchesPct).toBe(75); // Math.max(25, 75)
        });

        test('2.4: missing coverage-summary.json or corrupt json throws appropriate ServiceErrors', async () => {
            const emptyDir = path.join(tempDir, 'empty-cov');
            fs.mkdirSync(emptyDir, { recursive: true });

            await expect(parseCoverageSummary(emptyDir, 'snap-err-1')).rejects.toThrow(/not found/);

            fs.writeFileSync(path.join(emptyDir, 'coverage-summary.json'), '{ invalid json');
            await expect(parseCoverageSummary(emptyDir, 'snap-err-2')).rejects.toThrow(/Unable to parse/);

            fs.writeFileSync(path.join(emptyDir, 'coverage-summary.json'), JSON.stringify({ noTotal: true }));
            await expect(parseCoverageSummary(emptyDir, 'snap-err-3')).rejects.toThrow(/missing 'total' field/);
        });

        test('2.5: zero-code total correctly results in 0% across all metrics in CoverageSummary', async () => {
            const covDir = path.join(tempDir, 'coverage-zero');
            fs.mkdirSync(covDir, { recursive: true });
            const mockCoverage = {
                total: {
                    lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
                    statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
                    functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
                    branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                },
            };
            fs.writeFileSync(path.join(covDir, 'coverage-summary.json'), JSON.stringify(mockCoverage));

            const res = await parseCoverageSummary(covDir, 'snap-zero', { rootDir: tempDir });
            expect(upsertSummaryCalls.length).toBe(1);
            const summaryRow = upsertSummaryCalls[0].create;
            expect(summaryRow.linesPct).toBe(0);
            expect(summaryRow.stmtsPct).toBe(0);
            expect(summaryRow.branchesPct).toBe(0);
            expect(summaryRow.funcsPct).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 3: coverage.controller getCoverageFiles & getCoverageSummary
    // ─────────────────────────────────────────────────────────────────────────
    describe('3. coverage.controller Non-Zero Metrics & Synthetic 0% Avoidance', () => {
        test('3.1: getCoverageFiles returns non-zero metrics and upgrades legacy uncanonicalized DB paths', async () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'controllers', 'chatController.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const chat = () => {};');

            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-ctrl-1',
                projectId: 'proj-1',
                rootDir: tempDir,
                project: { ownerId: 'user-1', name: 'CovAI' },
            });

            // DB has legacy un-prefixed record with 88% coverage
            prismaMock.coverageFile.findMany.mockResolvedValue([
                {
                    id: 'f-1',
                    filePath: 'src/controllers/chatController.js',
                    linesPct: 88,
                    branchesPct: 75,
                    funcsPct: 100,
                    stmtsPct: 88,
                },
            ]);
            prismaMock.coverageFile.count.mockResolvedValue(1);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-ctrl-1' },
                query: { type: 'unit' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await getCoverageFiles(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const data = res.json.mock.calls[0][0].data;
            expect(data.files.length).toBe(1);
            const file = data.files[0];
            // Path upgraded to canonical
            expect(file.filePath).toBe('server/src/controllers/chatController.js');
            // Coverage preserved!
            expect(file.linesPct).toBe(88);
            expect(file.stmtsPct).toBe(88);
        });

        test('3.2: getCoverageFiles does NOT overwrite positive coverage when logic scanner finds the same file', async () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'controllers', 'chatController.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const chat = () => { if (true) return 1; return 0; };');

            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-ctrl-2',
                projectId: 'proj-1',
                rootDir: tempDir,
                project: { ownerId: 'user-1', name: 'CovAI' },
            });

            // DB already has canonical record with 92% coverage
            prismaMock.coverageFile.findMany.mockResolvedValue([
                {
                    id: 'f-canonical',
                    filePath: 'server/src/controllers/chatController.js',
                    linesPct: 92,
                    branchesPct: 80,
                    funcsPct: 100,
                    stmtsPct: 92,
                },
            ]);
            prismaMock.coverageFile.count.mockResolvedValue(1);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-ctrl-2' },
                query: { type: 'unit' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await getCoverageFiles(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const data = res.json.mock.calls[0][0].data;
            // Must have only 1 file, NOT a second synthetic 0% record
            expect(data.files.length).toBe(1);
            expect(data.files[0].filePath).toBe('server/src/controllers/chatController.js');
            expect(data.files[0].linesPct).toBe(92);
            expect(data.files[0].id).toBe('f-canonical');
        });

        test('3.3: getCoverageSummary selects freshest non-zero summary over stale 0% summary', async () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'controllers', 'chatController.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'export const chat = () => 1;');

            // 1. Root stale summary with 0%
            const staleCovDir = path.join(tempDir, 'coverage');
            fs.mkdirSync(staleCovDir, { recursive: true });
            fs.writeFileSync(path.join(staleCovDir, 'coverage-summary.json'), JSON.stringify({
                total: { lines: { pct: 0 }, statements: { pct: 0 }, functions: { pct: 0 }, branches: { pct: 0 } },
                'server/src/controllers/chatController.js': {
                    lines: { total: 10, covered: 0, pct: 0 },
                    statements: { total: 10, covered: 0, pct: 0 },
                    functions: { total: 2, covered: 0, pct: 0 },
                    branches: { total: 0, covered: 0, pct: 0 },
                }
            }));

            // 2. Subproject fresh summary with 85%
            const freshCovDir = path.join(tempDir, 'server', 'coverage');
            fs.mkdirSync(freshCovDir, { recursive: true });
            fs.writeFileSync(path.join(freshCovDir, 'coverage-summary.json'), JSON.stringify({
                total: { lines: { pct: 85 }, statements: { pct: 85 }, functions: { pct: 100 }, branches: { pct: 75 } },
                'src/controllers/chatController.js': {
                    lines: { total: 10, covered: 8, pct: 80 },
                    statements: { total: 10, covered: 8, pct: 80 },
                    functions: { total: 2, covered: 2, pct: 100 },
                    branches: { total: 0, covered: 0, pct: 0 },
                }
            }));

            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-ctrl-3',
                projectId: 'proj-1',
                rootDir: tempDir,
                project: { ownerId: 'user-1', name: 'CovAI' },
            });
            prismaMock.coverageSummary.findUnique.mockResolvedValue(null);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-ctrl-3' },
                query: { type: 'unit' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await getCoverageSummary(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const data = res.json.mock.calls[0][0].data;
            expect(data.coverage.statements).toBe(80);
            expect(data.coverage.lines).toBe(80);
            expect(data.coverage.statements).toBeGreaterThan(0);
        });

        test('3.4: getCoverageSummary DB summary fallback when disk summary is missing', async () => {
            const emptyRepoDir = path.join(tempDir, 'empty-repo');
            fs.mkdirSync(emptyRepoDir, { recursive: true });

            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-ctrl-4',
                projectId: 'proj-1',
                rootDir: emptyRepoDir,
                project: { ownerId: 'user-1', name: 'CovAI' },
            });
            prismaMock.coverageSummary.findUnique.mockResolvedValue({
                id: 'cs-1',
                snapshotId: 'snap-ctrl-4',
                linesPct: 83.5,
                branchesPct: 70,
                funcsPct: 90,
                stmtsPct: 85,
            });
            prismaMock.coverageFile.findMany.mockResolvedValue([]);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-ctrl-4' },
                query: { type: 'unit' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await getCoverageSummary(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const data = res.json.mock.calls[0][0].data;
            expect(data.coverage.statements).toBe(85);
            expect(data.coverage.lines).toBe(83.5);
            expect(data.coverage.branches).toBe(70);
            expect(data.coverage.functions).toBe(90);
        });

        test('3.5: getCoverageSummary DB files aggregation fallback when disk summary and DB summary missing', async () => {
            const emptyRepoDir = path.join(tempDir, 'empty-repo-2');
            fs.mkdirSync(emptyRepoDir, { recursive: true });

            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-ctrl-5',
                projectId: 'proj-1',
                rootDir: emptyRepoDir,
                project: { ownerId: 'user-1', name: 'CovAI' },
            });
            prismaMock.coverageSummary.findUnique.mockResolvedValue(null);
            prismaMock.coverageFile.findMany.mockResolvedValue([
                { filePath: 'server/src/controllers/auth.js', linesPct: 80, stmtsPct: 80, funcsPct: 100, branchesPct: 60 },
                { filePath: 'server/src/controllers/user.js', linesPct: 90, stmtsPct: 90, funcsPct: 100, branchesPct: 80 },
            ]);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-ctrl-5' },
                query: { type: 'unit' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await getCoverageSummary(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const data = res.json.mock.calls[0][0].data;
            expect(data.coverage.statements).toBe(85);
            expect(data.coverage.lines).toBe(85);
            expect(data.coverage.branches).toBe(70);
            expect(data.coverage.functions).toBe(100);
        });

        test('3.6: getCoverageFiles sort by linesPct desc places covered files first and handles pagination', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-ctrl-6',
                projectId: 'proj-1',
                rootDir: tempDir,
                project: { ownerId: 'user-1', name: 'CovAI' },
            });
            prismaMock.coverageFile.findMany.mockResolvedValue([
                { id: 'f1', filePath: 'server/src/low.js', linesPct: 10, stmtsPct: 10, funcsPct: 10, branchesPct: 10 },
                { id: 'f2', filePath: 'server/src/high.js', linesPct: 95, stmtsPct: 95, funcsPct: 100, branchesPct: 90 },
                { id: 'f3', filePath: 'server/src/mid.js', linesPct: 50, stmtsPct: 50, funcsPct: 50, branchesPct: 50 },
            ]);
            prismaMock.coverageFile.count.mockResolvedValue(3);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-ctrl-6' },
                query: { type: 'unit', sortBy: 'linesPct', order: 'desc', page: '1', limit: '2' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await getCoverageFiles(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const data = res.json.mock.calls[0][0].data;
            expect(data.files.length).toBe(2);
            expect(data.files[0].filePath).toBe('server/src/high.js');
            expect(data.files[0].linesPct).toBe(95);
            expect(data.files[1].filePath).toBe('server/src/mid.js');
            expect(data.files[1].linesPct).toBe(50);
            expect(data.pagination.total).toBe(3);
        });

        test('3.7: getCoverageFiles handles multiple distinct backend logic files without collision', async () => {
            const authSource = path.join(tempDir, 'server', 'src', 'services', 'authService.js');
            const userSource = path.join(tempDir, 'server', 'src', 'services', 'userService.js');
            fs.mkdirSync(path.dirname(authSource), { recursive: true });
            fs.writeFileSync(authSource, 'export const auth = () => true;');
            fs.writeFileSync(userSource, 'export const user = () => false;');

            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-ctrl-7',
                projectId: 'proj-1',
                rootDir: tempDir,
                project: { ownerId: 'user-1', name: 'CovAI' },
            });
            prismaMock.coverageFile.findMany.mockResolvedValue([
                { id: 'fs1', filePath: 'server/src/services/authService.js', linesPct: 80, stmtsPct: 80, funcsPct: 80, branchesPct: 80 },
                { id: 'fs2', filePath: 'server/src/services/userService.js', linesPct: 40, stmtsPct: 40, funcsPct: 40, branchesPct: 40 },
            ]);
            prismaMock.coverageFile.count.mockResolvedValue(2);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-ctrl-7' },
                query: { type: 'unit' },
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };

            await getCoverageFiles(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const data = res.json.mock.calls[0][0].data;
            expect(data.files.length).toBe(2);
            const authEntry = data.files.find(f => f.filePath === 'server/src/services/authService.js');
            const userEntry = data.files.find(f => f.filePath === 'server/src/services/userService.js');
            expect(authEntry).toBeDefined();
            expect(authEntry.linesPct).toBe(80);
            expect(userEntry).toBeDefined();
            expect(userEntry.linesPct).toBe(40);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 4: Helper Functions (resolveProjectRelativePath & getNormalizedMatchKey)
    // ─────────────────────────────────────────────────────────────────────────
    describe('4. Subproject Helper Functions Deep Probing', () => {
        test('4.1: resolveProjectRelativePath with various prefixes and disk presences', () => {
            const serverSource = path.join(tempDir, 'server', 'src', 'index.js');
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, 'console.log(1);');

            // Direct match
            expect(resolveProjectRelativePath('server/src/index.js', tempDir)).toBe('server/src/index.js');
            // Candidate prefix resolution
            expect(resolveProjectRelativePath('src/index.js', tempDir)).toBe('server/src/index.js');
            // Non-existent path returns clean path
            expect(resolveProjectRelativePath('src/nonexistent.js', tempDir)).toBe('src/nonexistent.js');
        });

        test('4.2: getNormalizedMatchKey strips all known subproject prefixes case-insensitively', () => {
            expect(getNormalizedMatchKey('SERVER/src/controllers/chat.js')).toBe('src/controllers/chat.js');
            expect(getNormalizedMatchKey('backend/src/controllers/chat.js')).toBe('src/controllers/chat.js');
            expect(getNormalizedMatchKey('CLIENT/src/components/button.jsx')).toBe('src/components/button.jsx');
            expect(getNormalizedMatchKey('frontend/src/App.vue')).toBe('src/app.vue');
            expect(getNormalizedMatchKey('app/src/index.ts')).toBe('src/index.ts');
            expect(getNormalizedMatchKey('api/src/routes.js')).toBe('src/routes.js');
            expect(getNormalizedMatchKey('src/controllers/chat.js')).toBe('src/controllers/chat.js');
        });
    });
});
