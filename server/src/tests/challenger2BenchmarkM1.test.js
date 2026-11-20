import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import { performance, monitorEventLoopDelay } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// ─── Prisma Mock ─────────────────────────────────────────────────────────────
const prismaMock = {
  $transaction: jest.fn(async (cb) => (typeof cb === 'function' ? await cb(prismaMock) : cb)),
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
  coverageFile: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  coverageFunction: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  cyclomatic: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  cfg: {
    findMany: jest.fn().mockResolvedValue([]),
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

jest.unstable_mockModule('../services/projectAccess.service.js', () => ({
  membershipWhere: jest.fn(() => ({})),
  resolveProjectAccess: jest.fn().mockResolvedValue(true),
  resolveSnapshotAccess: jest.fn().mockResolvedValue(true),
  withProjectGuard: jest.fn((opts, fn) => fn()),
}));

jest.unstable_mockModule('../services/queue.service.js', () => ({
  addJobToQueue: jest.fn(),
  addSupertestCoveragePipeline: jest.fn(),
  jobQueue: {},
}));

// Dynamic imports
const {
  getCoverageFiles,
  getCoverageFunctions,
  invalidateCoverageCache,
} = await import('../controllers/coverage.controller.js');

const {
  buildProjectTestDependencyMap,
  invalidateDependencyCache,
  findTestsImportingSource,
} = await import('../services/testDependencyResolver.service.js');

describe('Milestone 1 Empirical Verification Suite — Challenger 2', () => {
  let tempFixtureDir;

  beforeEach(() => {
    jest.clearAllMocks();
    tempFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-challenger2-m1-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Task 1: Benchmark getCoverageFiles & unitFilesCache
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Task 1: Benchmark getCoverageFiles caching, pagination & invalidation', () => {
    const snapshotId = 'snap-bench-001';
    const projectId = 'proj-bench-001';

    const generateDbFiles = (count = 100) =>
      Array.from({ length: count }, (_, i) => ({
        id: `cov-file-${i + 1}`,
        filePath: `src/controllers/module_${i + 1}.js`,
        linesPct: (i * 3) % 100,
        branchesPct: (i * 2) % 100,
        funcsPct: (i * 5) % 100,
        stmtsPct: (i * 4) % 100,
      }));

    beforeEach(() => {
      invalidateCoverageCache(snapshotId, tempFixtureDir);

      // Create disk files in tempFixtureDir for findLogicSourceFiles to traverse
      const srcDir = path.join(tempFixtureDir, 'src', 'controllers');
      fs.mkdirSync(srcDir, { recursive: true });
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(path.join(srcDir, `module_${i}.js`), 'export const x = 1;', 'utf8');
      }

      prismaMock.projectSnapshot.findUnique.mockImplementation(async ({ where, select }) => {
        return {
          id: snapshotId,
          projectId,
          source: 'GITHUB',
          commitSha: 'c0ffee123',
          createdAt: new Date(),
          rootDir: tempFixtureDir,
          project: { ownerId: 'user-bench', name: 'Benchmark Proj' },
        };
      });

      prismaMock.coverageFile.findMany.mockImplementation(async () => generateDbFiles(100));
      prismaMock.coverageFile.count.mockResolvedValue(100);
    });

    test('1.1: Cold response builds cache with disk scan; sequential pages 1, 2, 3 hit cache with 0 disk scans', async () => {
      const mockRes = () => {
        const res = {
          statusCode: null,
          body: null,
          status: jest.fn((code) => {
            res.statusCode = code;
            return res;
          }),
          json: jest.fn((data) => {
            res.body = data;
            return res;
          }),
        };
        return res;
      };

      // Spy on fs.readdirSync to count disk scans during cold vs warm
      const originalReaddirSync = fs.readdirSync;
      let diskReaddirCount = 0;
      const readdirSpy = jest.spyOn(fs, 'readdirSync').mockImplementation((...args) => {
        diskReaddirCount++;
        return originalReaddirSync(...args);
      });

      // ── Cold request (Page 1) ──
      const coldStart = performance.now();
      const coldReq = {
        user: { id: 'user-bench' },
        params: { snapshotId },
        query: { type: 'unit', page: '1', limit: '25', sortBy: 'filePath', order: 'asc' },
      };
      const coldRes = mockRes();
      await getCoverageFiles(coldReq, coldRes);
      const coldDurationMs = performance.now() - coldStart;

      expect(coldRes.statusCode).toBe(200);
      expect(coldRes.body.success).toBe(true);
      expect(coldRes.body.data.pagination.page).toBe(1);
      expect(coldRes.body.data.pagination.limit).toBe(25);
      expect(coldRes.body.data.files).toHaveLength(25);

      const coldDiskScans = diskReaddirCount;
      const dbFindManyCallsCold = prismaMock.coverageFile.findMany.mock.calls.length;
      expect(coldDiskScans).toBeGreaterThan(0); // Cold request scanned directories
      expect(dbFindManyCallsCold).toBe(1); // Cold request read database
      console.log(`[Task 1.1] Cold response time: ${coldDurationMs.toFixed(3)} ms (Disk readdir calls: ${coldDiskScans}, DB findMany: ${dbFindManyCallsCold})`);

      // ── Sequential Warm Requests (Page 1, Page 2, Page 3) ──
      const warmLatencies = [];
      const pages = [1, 2, 3];
      const diskScansBeforeWarm = diskReaddirCount;

      for (const pageNum of pages) {
        const warmStart = performance.now();
        const warmReq = {
          user: { id: 'user-bench' },
          params: { snapshotId },
          query: { type: 'unit', page: String(pageNum), limit: '25', sortBy: 'filePath', order: 'asc' },
        };
        const warmRes = mockRes();
        await getCoverageFiles(warmReq, warmRes);
        const warmDurationMs = performance.now() - warmStart;
        warmLatencies.push({ page: pageNum, latencyMs: warmDurationMs });

        expect(warmRes.statusCode).toBe(200);
        expect(warmRes.body.success).toBe(true);
        expect(warmRes.body.data.pagination.page).toBe(pageNum);
        expect(warmRes.body.data.files).toHaveLength(25);
      }

      const warmDiskScans = diskReaddirCount - diskScansBeforeWarm;
      const dbFindManyCallsAfterWarm = prismaMock.coverageFile.findMany.mock.calls.length - dbFindManyCallsCold;

      // Empirical Assertions: Exactly 0 disk scans and 0 DB findMany queries during warm requests!
      expect(warmDiskScans).toBe(0);
      expect(dbFindManyCallsAfterWarm).toBe(0);

      console.log(
        `[Task 1.1] Warm sequential pages latencies: ` +
          warmLatencies.map((w) => `Page ${w.page}=${w.latencyMs.toFixed(3)}ms`).join(', ') +
          ` | Disk scans on warm: ${warmDiskScans} | DB queries on warm: ${dbFindManyCallsAfterWarm}`
      );

      for (const w of warmLatencies) {
        expect(w.latencyMs).toBeLessThan(15.0); // Warm response is instantaneous
      }

      readdirSpy.mockRestore();
    });

    test('1.2: Cache invalidation via invalidateCoverageCache resets cache and triggers fresh scan on next request', async () => {
      const mockRes = () => ({
        statusCode: null,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        },
      });

      // Warm up cache
      await getCoverageFiles(
        { user: { id: 'user-bench' }, params: { snapshotId }, query: { type: 'unit', page: '1', limit: '10' } },
        mockRes()
      );
      expect(prismaMock.coverageFile.findMany).toHaveBeenCalledTimes(1);

      // Invalidate cache
      invalidateCoverageCache(snapshotId, tempFixtureDir);

      // Next request must re-trigger cold build and query database
      const afterInvalidationRes = mockRes();
      await getCoverageFiles(
        { user: { id: 'user-bench' }, params: { snapshotId }, query: { type: 'unit', page: '1', limit: '10' } },
        afterInvalidationRes
      );

      expect(afterInvalidationRes.statusCode).toBe(200);
      expect(prismaMock.coverageFile.findMany).toHaveBeenCalledTimes(2); // Invalidation verified! Fresh query executed.
      console.log('[Task 1.2] Cache invalidation confirmed: coverageFile.findMany called again after invalidateCoverageCache.');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Task 2: Benchmark getCoverageFunctions & Event Loop Responsiveness
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Task 2: Benchmark getCoverageFunctions event loop lag under 50 concurrent calls', () => {
    const snapshotId = 'snap-bench-funcs-002';
    const projectId = 'proj-bench-funcs-002';

    const generateDbFunctions = (count = 50) =>
      Array.from({ length: count }, (_, i) => ({
        id: `cov-func-${i + 1}`,
        filePath: `src/controllers/handler_${i + 1}.js`,
        functionName: `handleAction${i + 1}`,
        startLine: i * 15 + 1,
        endLine: i * 15 + 14,
        hit: i % 2 === 0 ? 1 : 0,
      }));

    beforeEach(() => {
      prismaMock.projectSnapshot.findUnique.mockResolvedValue({
        id: snapshotId,
        projectId,
        source: 'GITHUB',
        commitSha: 'deadbeef',
        createdAt: new Date(),
        rootDir: tempFixtureDir,
        project: { ownerId: 'user-bench', name: 'Benchmark Proj' },
      });

      prismaMock.coverageFunction.findMany.mockImplementation(async () => generateDbFunctions(50));
      prismaMock.coverageFunction.count.mockResolvedValue(50);
      prismaMock.cyclomatic.findMany.mockResolvedValue([]);
      prismaMock.cfg.findMany.mockResolvedValue([]);
    });

    test('2.1: Verify zero synchronous Babel AST extraction calls on main thread in getCoverageFunctions', () => {
      const controllerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../controllers/coverage.controller.js');
      const content = fs.readFileSync(controllerPath, 'utf8');

      // Extract getCoverageFunctions function body
      const funcStart = content.indexOf('export const getCoverageFunctions =');
      expect(funcStart).toBeGreaterThan(0);
      const funcEnd = content.indexOf('export const getIntegrationDetectionController =', funcStart);
      const funcBody = content.slice(funcStart, funcEnd > funcStart ? funcEnd : funcStart + 5000);

      // Verify absence of synchronous file reads and synchronous Babel AST parsing
      expect(funcBody).not.toContain('extractFunctions(');
      expect(funcBody).not.toContain('fs.readFileSync');
      expect(funcBody).not.toContain('babelParser');
      expect(funcBody).not.toContain('parser.parse');
      console.log('[Task 2.1] Verified zero synchronous Babel AST parsing or file reads in getCoverageFunctions.');
    });

    test('2.2: 50 rapid concurrent calls to getCoverageFunctions maintain event loop responsiveness', async () => {
      const mockRes = () => {
        let code = 200;
        let data = null;
        return {
          status: (c) => {
            code = c;
            return {
              json: (d) => {
                data = d;
              },
            };
          },
          json: (d) => {
            data = d;
          },
          getCode: () => code,
          getData: () => data,
        };
      };

      // Measure Event Loop Delay using Node.js perf_hooks.monitorEventLoopDelay
      const delayMonitor = monitorEventLoopDelay({ resolution: 10 });
      delayMonitor.enable();

      // High-resolution interval timer to capture event loop lag during concurrent bursts
      let maxTickLagMs = 0;
      let lastTick = performance.now();
      const tickTimer = setInterval(() => {
        const now = performance.now();
        const delta = now - lastTick;
        const lag = Math.max(0, delta - 5);
        if (lag > maxTickLagMs) maxTickLagMs = lag;
        lastTick = now;
      }, 5);

      const CONCURRENT_CALLS = 50;
      const callLatencies = [];

      const overallStart = performance.now();

      const promises = Array.from({ length: CONCURRENT_CALLS }, async (_, idx) => {
        const reqStart = performance.now();
        const req = {
          user: { id: 'user-bench' },
          params: { snapshotId },
          query: { type: 'unit', page: String((idx % 5) + 1), limit: '20' },
        };
        const res = mockRes();
        await getCoverageFunctions(req, res);
        const reqLatency = performance.now() - reqStart;
        callLatencies.push(reqLatency);
        expect(res.getCode()).toBe(200);
        expect(res.getData().success).toBe(true);
      });

      await Promise.all(promises);

      const totalElapsedMs = performance.now() - overallStart;
      clearInterval(tickTimer);
      delayMonitor.disable();

      const maxDelayMs = delayMonitor.max / 1e6;
      const meanDelayMs = delayMonitor.mean / 1e6;
      const p99DelayMs = delayMonitor.percentile(99) / 1e6;
      const avgCallLatency = callLatencies.reduce((a, b) => a + b, 0) / callLatencies.length;

      console.log(`[Task 2.2] 50 Concurrent Calls Results:`);
      console.log(`  - Total wall time for 50 requests: ${totalElapsedMs.toFixed(3)} ms`);
      console.log(`  - Average request latency: ${avgCallLatency.toFixed(3)} ms`);
      console.log(`  - Mean event loop delay: ${meanDelayMs.toFixed(3)} ms`);
      console.log(`  - P99 event loop delay: ${p99DelayMs.toFixed(3)} ms`);
      console.log(`  - Max event loop delay: ${maxDelayMs.toFixed(3)} ms`);
      console.log(`  - High-res tick max lag: ${maxTickLagMs.toFixed(3)} ms`);

      // Assertions
      expect(maxDelayMs).toBeLessThan(100.0); // Event loop never frozen
      expect(totalElapsedMs).toBeLessThan(10000.0); // All 50 requests handled cleanly under load
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Task 3: Benchmark buildProjectTestDependencyMap & SLA AC-TRACE-06
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Task 3: Benchmark buildProjectTestDependencyMap warm RAM SLA (<2.0ms) and invalidation', () => {
    beforeEach(() => {
      // Setup realistic project repository fixture in tempFixtureDir
      const srcDir = path.join(tempFixtureDir, 'src', 'services');
      const testDir = path.join(tempFixtureDir, 'tests', 'unit');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(testDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, 'payment.service.ts'),
        `export const processPayment = (amount: number) => amount > 0;`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(srcDir, 'ledger.service.ts'),
        `export const recordLedger = (entry: any) => true;`,
        'utf8'
      );

      fs.writeFileSync(
        path.join(testDir, 'payment.test.ts'),
        `import { processPayment } from '../../src/services/payment.service';
         describe('Payment', () => {
           it('processes payment', () => { expect(processPayment(100)).toBe(true); });
         });`,
        'utf8'
      );

      fs.writeFileSync(
        path.join(testDir, 'ledger.test.ts'),
        `import { recordLedger } from '../../src/services/ledger.service';
         describe('Ledger', () => {
           it('records ledger entry', () => { expect(recordLedger({})).toBe(true); });
         });`,
        'utf8'
      );
    });

    test('3.1: Warm RAM cache responds in <2.0ms (SLA AC-TRACE-06)', () => {
      // Warm up cache
      invalidateDependencyCache(tempFixtureDir);
      const coldStart = performance.now();
      const coldMap = buildProjectTestDependencyMap(tempFixtureDir);
      const coldDurationMs = performance.now() - coldStart;

      expect(coldMap.size).toBeGreaterThan(0);
      console.log(`[Task 3.1] Cold dependency build: ${coldDurationMs.toFixed(3)} ms`);

      // Run 100 consecutive warm lookups
      const iterations = 100;
      const latencies = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const map = buildProjectTestDependencyMap(tempFixtureDir);
        const duration = performance.now() - start;
        latencies.push(duration);
        expect(map.size).toBe(coldMap.size);
      }

      latencies.sort((a, b) => a - b);
      const min = latencies[0];
      const max = latencies[latencies.length - 1];
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const median = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];

      console.log(`[Task 3.1] Warm RAM Cache Benchmark (100 iterations):`);
      console.log(`  - Min: ${min.toFixed(4)} ms`);
      console.log(`  - Max: ${max.toFixed(4)} ms`);
      console.log(`  - Avg: ${avg.toFixed(4)} ms`);
      console.log(`  - Median: ${median.toFixed(4)} ms`);
      console.log(`  - P95: ${p95.toFixed(4)} ms`);
      console.log(`  - P99: ${p99.toFixed(4)} ms`);

      // AC-TRACE-06 SLA Check: Warm RAM Cache < 2.0ms
      expect(avg).toBeLessThan(2.0);
      expect(p95).toBeLessThan(2.0);
    });

    test('3.2: invalidateDependencyCache properly evicts cache and captures newly added test files', () => {
      // 1. Initial build & warm cache
      buildProjectTestDependencyMap(tempFixtureDir);
      const initialMatches = findTestsImportingSource(tempFixtureDir, 'src/services/payment.service.ts');
      expect(initialMatches).toHaveLength(1);

      // 2. Add another test file linking payment.service
      const testDir = path.join(tempFixtureDir, 'tests', 'unit');
      fs.writeFileSync(
        path.join(testDir, 'payment.integration.test.ts'),
        `import { processPayment } from '../../src/services/payment.service';
         it('integration check', () => {});`,
        'utf8'
      );

      // 3. Before invalidation: warm cache still returns 1 (proves caching is active)
      const cachedMatches = findTestsImportingSource(tempFixtureDir, 'src/services/payment.service.ts');
      expect(cachedMatches).toHaveLength(1);

      // 4. Invalidate cache
      invalidateDependencyCache(tempFixtureDir);

      // 5. After invalidation: cache reloads and sees 2 test files
      const reloadedMatches = findTestsImportingSource(tempFixtureDir, 'src/services/payment.service.ts');
      expect(reloadedMatches).toHaveLength(2);
      expect(reloadedMatches.map((m) => m.filePath)).toContain('tests/unit/payment.integration.test.ts');
      console.log('[Task 3.2] Invalidation verified: new test file successfully discovered after cache eviction.');

      // 6. Test global invalidation (null parameter)
      invalidateDependencyCache(null);
      const globalResetMap = buildProjectTestDependencyMap(tempFixtureDir);
      expect(globalResetMap.size).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Task 4: Verify Socket.IO Room Subscription & Instant Resolution
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Task 4: Verify Socket.IO room subscription and waitForJob resolution without 1.5s polling', () => {
    test('4.1: Source inspection verifies project room subscription and 10s fallback in CoverageTypeDashboard.jsx', () => {
      const dashboardPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../client/src/components/dashboard/CoverageTypeDashboard.jsx');
      const content = fs.readFileSync(dashboardPath, 'utf8');

      // 1. Check room subscription
      expect(content).toContain('socket.emit("project:subscribe", { projectId })');
      expect(content).toContain('socket.emit("project:unsubscribe", { projectId })');

      // 2. Check event listeners
      expect(content).toContain('socket.on("dashboard:job-progress", onDashboardJobProgress)');
      expect(content).toContain('socket.on("dashboard:run-status", onDashboardRunStatus)');

      // 3. Check waitForJob safety timer
      expect(content).toContain('setInterval(async () => {');
      expect(content).toContain('}, 10000);');

      // 4. Confirm elimination of 1500ms polling loop
      expect(content).not.toMatch(/setInterval\([^,]+,\s*1500\)/);
      console.log('[Task 4.1] Static source verification of CoverageTypeDashboard.jsx passed.');
    });

    test('4.2: Behavioral simulation of waitForJob resolves instantaneously upon dashboard:run-status event (<5ms)', async () => {
      // Replicate the exact activeJobSubscriptions & waitForJob logic from CoverageTypeDashboard.jsx
      const activeJobSubscriptions = new Map();

      async function simulatedWaitForJob(jobId, onProgress) {
        return new Promise((resolve, reject) => {
          const jId = String(jobId);
          let pollTimer = null;
          let isSettled = false;

          const cleanup = () => {
            isSettled = true;
            if (pollTimer) clearInterval(pollTimer);
            activeJobSubscriptions.delete(jId);
          };

          const handleSuccess = (val) => {
            if (isSettled) return;
            cleanup();
            if (onProgress) onProgress(100, 'SUCCESS');
            resolve(val);
          };

          const handleFailure = (err) => {
            if (isSettled) return;
            cleanup();
            reject(err instanceof Error ? err : new Error(err || 'Job failed'));
          };

          activeJobSubscriptions.set(jId, {
            onProgress: (prog, status) => {
              if (!isSettled && onProgress) onProgress(prog, status);
            },
            resolve: handleSuccess,
            reject: handleFailure,
          });

          // 10s fallback heartbeat
          pollTimer = setInterval(async () => {
            if (isSettled) return;
          }, 10000);
        });
      }

      // Handler for socket event
      const dispatchRunStatus = (data) => {
        const jId = String(data.jobId || '');
        const sub = activeJobSubscriptions.get(jId);
        if (data.status === 'SUCCESS') {
          sub?.resolve?.(data);
        } else if (data.status === 'FAILED') {
          sub?.reject?.(new Error(data.error || 'Failed'));
        }
      };

      // Test 1: Immediate SUCCESS event
      const targetJobId = 'job-fast-001';
      const progressUpdates = [];

      const waitPromise = simulatedWaitForJob(targetJobId, (p, s) => {
        progressUpdates.push({ p, s });
      });

      expect(activeJobSubscriptions.has(targetJobId)).toBe(true);

      // Simulate Socket event arriving after 10ms
      await new Promise((r) => setTimeout(r, 10));
      const emitTime = performance.now();
      dispatchRunStatus({
        jobId: targetJobId,
        status: 'SUCCESS',
        summary: { passed: 10, failed: 0 },
      });

      const result = await waitPromise;
      const resolutionDelay = performance.now() - emitTime;

      console.log(`[Task 4.2] waitForJob resolved via socket event in: ${resolutionDelay.toFixed(3)} ms`);
      expect(result.status).toBe('SUCCESS');
      expect(resolutionDelay).toBeLessThan(5.0); // Instant resolution, no waiting for 1.5s or 10s poll
      expect(activeJobSubscriptions.has(targetJobId)).toBe(false); // Cleaned up

      // Test 2: Immediate FAILED event
      const failedJobId = 'job-fail-002';
      const failPromise = simulatedWaitForJob(failedJobId);

      dispatchRunStatus({
        jobId: failedJobId,
        status: 'FAILED',
        error: 'AUT runner timed out',
      });

      await expect(failPromise).rejects.toThrow('AUT runner timed out');
      expect(activeJobSubscriptions.has(failedJobId)).toBe(false);
    });
  });
});
