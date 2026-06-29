/**
 * coverage.test.js — Jest unit tests cho tính năng coverage
 *
 * Covers:
 *  - coverageSummaryParser.service  (SCRUM-85, 118–122)
 *  - coverageStorage.service        (SCRUM-84, 113–117)
 *  - parseCoverageFilesForSnapshot  (coverageFiles.service)
 *  - processCoverageJob             (SCRUM-107–112)
 *
 * NOTE: Đổi SERVICE_FILE_NAME bên dưới cho khớp với tên file thực tế
 *       của hàm parseCoverageFilesForSnapshot trong project bạn.
 */

"use strict";

// ─── Tên file chứa parseCoverageFilesForSnapshot ────────────────────────────
// Kiểm tra trong src/services/ và sửa lại nếu khác tên này
const COVERAGE_FILES_SERVICE = "../services/coverageFiles.service.js";

// ─────────────────────────────────────────────────────────────
// MOCK FACTORIES
// Định nghĩa factory function riêng để tái sử dụng sau resetModules
// ─────────────────────────────────────────────────────────────

const makePrismaMock = () => ({
    coverageSummary: { upsert: jest.fn().mockResolvedValue({}) },
    coverageFile: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
    },
    projectSnapshot: {
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (cb) =>
        cb({
            coverageFile: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
            coverageSummary: { upsert: jest.fn().mockResolvedValue({}) },
        })
    ),
});

// Singleton mock — được reset thủ công trong beforeEach, KHÔNG dùng resetModules
let _prisma = makePrismaMock();

// ─────────────────────────────────────────────────────────────
// MOCKS — khai báo một lần, dùng singleton bên trong
// ─────────────────────────────────────────────────────────────

jest.mock("../config/prisma.js", () => ({
    __esModule: true,
    get default() { return _prisma; },
}));

jest.mock("../config/firebase.js", () => {
    const makeStream = () => {
        const { Writable } = require("stream");
        const s = new Writable({ write(c, e, cb) { cb(); } });
        // Emit finish synchronously when stream.end() is called
        const origEnd = s.end.bind(s);
        s.end = (...a) => { origEnd(...a); process.nextTick(() => s.emit("finish")); };
        return s;
    };
    return {
        __esModule: true,
        getBucket: jest.fn(() => ({
            file: jest.fn(() => ({ createWriteStream: jest.fn(makeStream) })),
        })),
    };
});

jest.mock("../services/job.service.js", () => ({
    __esModule: true,
    markJobRunning: jest.fn(),
    markJobSuccess: jest.fn(),
    markJobFailed: jest.fn(),
    updateJobProgress: jest.fn(),
    getJobById: jest.fn(),
    addJobLog: jest.fn(),
}));

jest.mock("../services/jobOutput.service.js", () => ({
    __esModule: true,
    appendJobOutput: jest.fn(),
    saveJobOutput: jest.fn(),
}));

jest.mock("child_process", () => ({ spawn: jest.fn() }));

// fs: partial mock — KHÔNG dùng resetModules nên mock này giữ nguyên suốt file
jest.mock("fs", () => {
    const actual = jest.requireActual("fs");
    return {
        ...actual,
        existsSync: jest.fn(),
        readFileSync: jest.fn(),
        mkdirSync: jest.fn(),
    };
});

// ─────────────────────────────────────────────────────────────
// REQUIRES (sau mock, một lần duy nhất)
// ─────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");

const { parseCoverageSummary } = require("../services/coverageSummaryParser.service.js");
const { ensureCoverageOutputDir,
    storeCoverageOutputs } = require("../services/coverageStorage.service.js");
const { processCoverageJob } = require("../services/coverageRunner.service.js");

// parseCoverageFilesForSnapshot — require với tên file thực tế
let parseCoverageFilesForSnapshot;
try {
    ({ parseCoverageFilesForSnapshot } = require(COVERAGE_FILES_SERVICE));
} catch (_) {
    // Nếu file không tồn tại, skip toàn bộ describe block đó
    parseCoverageFilesForSnapshot = null;
}

const jobService = require("../services/job.service.js");
const jobOutputService = require("../services/jobOutput.service.js");
const { spawn } = require("child_process");

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const makeSummaryEntry = (pct = 80) => ({
    lines: { total: 100, covered: pct, skipped: 0, pct },
    branches: { total: 50, covered: pct / 2, skipped: 0, pct },
    functions: { total: 20, covered: pct / 4, skipped: 0, pct },
    statements: { total: 120, covered: pct, skipped: 0, pct },
});

const makeCoverageSummaryJson = (filePct = 75) => ({
    total: makeSummaryEntry(90),
    "src/index.js": makeSummaryEntry(filePct),
    "src/utils.js": makeSummaryEntry(filePct - 10),
});

/** fs mock: existsSync = true, readFileSync = coverage JSON */
const mockFsWithCoverage = (data = makeCoverageSummaryJson(75)) => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(data));
};

/** Fake child process — emits stdout/stderr/close via setImmediate */
const makeFakeChild = ({ exitCode = 0, stdoutData = "", stderrData = "" } = {}) => {
    const { EventEmitter } = require("events");
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    setImmediate(() => {
        if (stdoutData) child.stdout.emit("data", Buffer.from(stdoutData));
        if (stderrData) child.stderr.emit("data", Buffer.from(stderrData));
        child.emit("close", exitCode);
    });
    return child;
};

// ─────────────────────────────────────────────────────────────
// beforeEach toàn cục — reset mock calls (KHÔNG resetModules)
// ─────────────────────────────────────────────────────────────
beforeEach(() => {
    jest.clearAllMocks();
    // Khôi phục prisma mock về trạng thái sạch
    _prisma = makePrismaMock();

    // Default job service mocks
    jobService.markJobRunning.mockResolvedValue(undefined);
    jobService.markJobSuccess.mockResolvedValue(undefined);
    jobService.markJobFailed.mockResolvedValue(undefined);
    jobService.updateJobProgress.mockResolvedValue(undefined);
    jobService.addJobLog.mockResolvedValue(undefined);
    jobService.getJobById.mockResolvedValue({
        id: "job-1",
        snapshotId: "snap-1",
        projectId: "proj-1",
        snapshot: { rootDir: "/project", jestConfigPath: null },
    });
    jobOutputService.saveJobOutput.mockResolvedValue(undefined);
    jobOutputService.appendJobOutput.mockResolvedValue(undefined);
});

// ═════════════════════════════════════════════════════════════
// 1. coverageSummaryParser.service  (SCRUM-85, 118–122)
// ═════════════════════════════════════════════════════════════
describe("parseCoverageSummary", () => {

    // ── validation ──────────────────────────────────────────────
    it("throws 400 when coverageDir is empty", async () => {
        await expect(parseCoverageSummary("", "snap-1"))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws 400 when snapshotId is empty", async () => {
        await expect(parseCoverageSummary("/dir", ""))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    // ── file reading errors ─────────────────────────────────────
    it("throws 404 when coverage-summary.json does not exist", async () => {
        fs.existsSync.mockReturnValue(false);
        await expect(parseCoverageSummary("/fake/coverage", "snap-1"))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it("throws 422 when file contains invalid JSON", async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue("not{{json");
        await expect(parseCoverageSummary("/fake/coverage", "snap-1"))
            .rejects.toMatchObject({ statusCode: 422 });
    });

    it("throws 422 when file has no 'total' key", async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify({ "src/a.js": makeSummaryEntry() }));
        await expect(parseCoverageSummary("/fake/coverage", "snap-1"))
            .rejects.toMatchObject({ statusCode: 422 });
    });

    // ── happy path ──────────────────────────────────────────────
    describe("happy path", () => {
        beforeEach(() => mockFsWithCoverage());

        it("returns correct pct for lines/branches/functions/statements (SCRUM-118..121)", async () => {
            const result = await parseCoverageSummary("/fake/coverage", "snap-1");
            expect(result.total.lines.pct).toBe(90);
            expect(result.total.branches.pct).toBe(90);
            expect(result.total.functions.pct).toBe(90);
            expect(result.total.statements.pct).toBe(90);
        });

        it("returns fileCount excluding 'total' key", async () => {
            const result = await parseCoverageSummary("/fake/coverage", "snap-1");
            expect(result.fileCount).toBe(2);
        });

        it("calls coverageSummary.upsert with correct data (SCRUM-122)", async () => {
            await parseCoverageSummary("/fake/coverage", "snap-1");
            expect(_prisma.coverageSummary.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { snapshotId: "snap-1" },
                    create: expect.objectContaining({ linesPct: 90 }),
                    update: expect.objectContaining({ linesPct: 90 }),
                })
            );
        });

        it("calls coverageFile.upsert for each file (2 calls)", async () => {
            await parseCoverageSummary("/fake/coverage", "snap-1");
            expect(_prisma.coverageFile.upsert).toHaveBeenCalledTimes(2);
        });

        it("upserts correct filePaths", async () => {
            await parseCoverageSummary("/fake/coverage", "snap-1");
            const paths = _prisma.coverageFile.upsert.mock.calls.map(
                (c) => c[0].where.snapshotId_filePath.filePath
            );
            expect(paths).toContain("src/index.js");
            expect(paths).toContain("src/utils.js");
        });
    });

    // ── SCRUM-118: line defaults ────────────────────────────────
    it("SCRUM-118: defaults to 0 when lines fields absent", async () => {
        const raw = { total: { branches: makeSummaryEntry(50).branches } };
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify(raw));
        const result = await parseCoverageSummary("/c", "s");
        expect(result.total.lines.pct).toBe(0);
        expect(result.total.lines.total).toBe(0);
    });

    // ── SCRUM-119: branch defaults ──────────────────────────────
    it("SCRUM-119: defaults to 0 when branches fields absent", async () => {
        const raw = { total: { lines: makeSummaryEntry(100).lines } };
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify(raw));
        const result = await parseCoverageSummary("/c", "s");
        expect(result.total.branches.pct).toBe(0);
    });
});

// ═════════════════════════════════════════════════════════════
// 2. coverageStorage.service  (SCRUM-84, 113–117)
// ═════════════════════════════════════════════════════════════
describe("coverageStorage.service", () => {

    // ── SCRUM-113 ───────────────────────────────────────────────
    describe("ensureCoverageOutputDir (SCRUM-113)", () => {
        it("creates coverage dir when it does not exist", () => {
            fs.existsSync.mockReturnValue(false);
            const dir = ensureCoverageOutputDir("/root");
            expect(fs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining("coverage"),
                { recursive: true }
            );
            expect(dir).toContain("coverage");
        });

        it("does NOT call mkdirSync when dir already exists", () => {
            fs.existsSync.mockReturnValue(true);
            ensureCoverageOutputDir("/root");
            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });
    });

    // ── storeCoverageOutputs ────────────────────────────────────
    describe("storeCoverageOutputs", () => {
        it("throws 400 when snapshotId missing", async () => {
            await expect(storeCoverageOutputs("", "proj-1", "/dir"))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it("throws 400 when projectId missing", async () => {
            await expect(storeCoverageOutputs("snap-1", "", "/dir"))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it("throws 400 when coverageDir missing", async () => {
            await expect(storeCoverageOutputs("snap-1", "proj-1", ""))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        describe("all 3 files present (SCRUM-114, 115, 116)", () => {
            beforeEach(() => {
                fs.existsSync.mockReturnValue(true);
                fs.readFileSync.mockReturnValue(Buffer.from("data"));
            });

            it("SCRUM-114: sets summaryStoragePath", async () => {
                const r = await storeCoverageOutputs("snap-1", "proj-1", "/cov");
                expect(r.summaryStoragePath).toContain("coverage-summary.json");
            });

            it("SCRUM-115: sets finalStoragePath", async () => {
                const r = await storeCoverageOutputs("snap-1", "proj-1", "/cov");
                expect(r.finalStoragePath).toContain("coverage-final.json");
            });

            it("SCRUM-116: sets lcovStoragePath", async () => {
                const r = await storeCoverageOutputs("snap-1", "proj-1", "/cov");
                expect(r.lcovStoragePath).toContain("lcov.info");
            });

            it("baseStoragePath contains projectId and snapshotId", async () => {
                const r = await storeCoverageOutputs("snap-1", "proj-1", "/cov");
                expect(r.baseStoragePath).toContain("proj-1");
                expect(r.baseStoragePath).toContain("snap-1");
            });

            it("SCRUM-117: updates snapshot.storageBasePath in DB", async () => {
                await storeCoverageOutputs("snap-1", "proj-1", "/cov");
                expect(_prisma.projectSnapshot.update).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: { id: "snap-1" },
                        data: expect.objectContaining({ storageBasePath: expect.any(String) }),
                    })
                );
            });
        });

        describe("files absent", () => {
            it("skips upload and returns no paths", async () => {
                fs.existsSync.mockReturnValue(false);
                const r = await storeCoverageOutputs("snap-1", "proj-1", "/cov");
                expect(r.summaryStoragePath).toBeUndefined();
                expect(r.finalStoragePath).toBeUndefined();
                expect(r.lcovStoragePath).toBeUndefined();
            });
        });
    });
});

// ═════════════════════════════════════════════════════════════
// 3. parseCoverageFilesForSnapshot
//    Skip toàn bộ nếu file service không tồn tại
// ═════════════════════════════════════════════════════════════
const describeIfExists = parseCoverageFilesForSnapshot ? describe : describe.skip;

describeIfExists("parseCoverageFilesForSnapshot", () => {
    const BASE = {
        projectId: "proj-1",
        snapshotId: "snap-1",
        userId: "user-1",
        coverageReport: makeCoverageSummaryJson(80),
    };

    const MOCK_SNAPSHOT = {
        id: "snap-1",
        projectId: "proj-1",
        project: { ownerId: "user-1" },
    };

    // ── validation ──────────────────────────────────────────────
    it("throws 400 when projectId missing", async () => {
        await expect(parseCoverageFilesForSnapshot({ ...BASE, projectId: "" }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws 400 when snapshotId missing", async () => {
        await expect(parseCoverageFilesForSnapshot({ ...BASE, snapshotId: "" }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws 400 when userId missing", async () => {
        await expect(parseCoverageFilesForSnapshot({ ...BASE, userId: "" }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws 400 when coverageReport is not an object", async () => {
        await expect(parseCoverageFilesForSnapshot({ ...BASE, coverageReport: "bad" }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws 404 when snapshot not found", async () => {
        _prisma.projectSnapshot.findFirst.mockResolvedValue(null);
        await expect(parseCoverageFilesForSnapshot(BASE))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it("throws 403 when user is not the owner", async () => {
        _prisma.projectSnapshot.findFirst.mockResolvedValue({
            ...MOCK_SNAPSHOT,
            project: { ownerId: "other-user" },
        });
        await expect(parseCoverageFilesForSnapshot(BASE))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    it("throws 400 when report has no file entries", async () => {
        _prisma.projectSnapshot.findFirst.mockResolvedValue(MOCK_SNAPSHOT);
        await expect(
            parseCoverageFilesForSnapshot({ ...BASE, coverageReport: { total: makeSummaryEntry() } })
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    // ── happy path ──────────────────────────────────────────────
    describe("happy path", () => {
        beforeEach(() => {
            _prisma.projectSnapshot.findFirst.mockResolvedValue(MOCK_SNAPSHOT);
        });

        it("returns totalFiles=2, summary, and files array", async () => {
            const r = await parseCoverageFilesForSnapshot(BASE);
            expect(r.totalFiles).toBe(2);
            expect(r.summary).toBeTruthy();
            expect(Array.isArray(r.files)).toBe(true);
        });

        it("summary.linesPct matches total.lines.pct (90)", async () => {
            const r = await parseCoverageFilesForSnapshot(BASE);
            expect(r.summary.linesPct).toBe(90);
        });

        it("each file row has required fields and correct snapshotId", async () => {
            const r = await parseCoverageFilesForSnapshot(BASE);
            for (const f of r.files) {
                expect(f).toHaveProperty("filePath");
                expect(f).toHaveProperty("linesPct");
                expect(f).toHaveProperty("branchesPct");
                expect(f).toHaveProperty("funcsPct");
                expect(f).toHaveProperty("stmtsPct");
                expect(f.snapshotId).toBe("snap-1");
            }
        });

        it("wraps DB writes in a transaction", async () => {
            await parseCoverageFilesForSnapshot(BASE);
            expect(_prisma.$transaction).toHaveBeenCalled();
        });

        it("handles array-format coverage report", async () => {
            const e = makeSummaryEntry(70);
            const r = await parseCoverageFilesForSnapshot({
                ...BASE,
                coverageReport: [
                    { path: "src/a.js", ...e },
                    { path: "src/b.js", ...makeSummaryEntry(60) },
                ],
            });
            expect(r.totalFiles).toBe(2);
        });

        it("handles { files: [...] } format", async () => {
            const r = await parseCoverageFilesForSnapshot({
                ...BASE,
                coverageReport: {
                    files: [
                        {
                            filePath: "src/c.js",
                            lines: { pct: 55 }, branches: { pct: 40 },
                            functions: { pct: 60 }, statements: { pct: 55 }
                        },
                    ],
                },
            });
            expect(r.totalFiles).toBe(1);
        });
    });
});

// ═════════════════════════════════════════════════════════════
// 4. processCoverageJob  (SCRUM-107–112)
// ═════════════════════════════════════════════════════════════
describe("processCoverageJob", () => {

    // Setup coverage fs mock mặc định cho mọi test trong group này
    beforeEach(() => {
        mockFsWithCoverage();
        spawn.mockReturnValue(makeFakeChild({ exitCode: 0 }));
    });

    // ── validation ──────────────────────────────────────────────
    it("throws 400 when jobId is empty", async () => {
        await expect(processCoverageJob(""))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    // ── markJobRunning errors ────────────────────────────────────
    it("returns early when markJobRunning throws 'Job not found'", async () => {
        jobService.markJobRunning.mockRejectedValue(new Error("Job not found"));
        await expect(processCoverageJob("job-1")).resolves.toBeUndefined();
        expect(jobService.getJobById).not.toHaveBeenCalled();
    });

    it("returns early when markJobRunning throws 'Only queued jobs can start'", async () => {
        jobService.markJobRunning.mockRejectedValue(new Error("Only queued jobs can start"));
        await expect(processCoverageJob("job-1")).resolves.toBeUndefined();
    });

    it("returns early when markJobRunning throws 'Cannot start a canceled job'", async () => {
        jobService.markJobRunning.mockRejectedValue(new Error("Cannot start a canceled job"));
        await expect(processCoverageJob("job-1")).resolves.toBeUndefined();
    });

    it("marks job failed when snapshot.rootDir is null", async () => {
        jobService.getJobById.mockResolvedValue({
            id: "job-1", snapshotId: "snap-1", projectId: "proj-1",
            snapshot: { rootDir: null },
        });
        await processCoverageJob("job-1");
        expect(jobService.markJobFailed).toHaveBeenCalled();
    });

    // ── SCRUM-107: spawn args ────────────────────────────────────
    describe("SCRUM-107: jest spawn arguments", () => {
        it("spawns 'npx jest' with --coverage and required reporters", async () => {
            await processCoverageJob("job-1");
            const [cmd, args] = spawn.mock.calls[0];
            expect(cmd).toBe("npx");
            expect(args).toContain("jest");
            expect(args).toContain("--coverage");
            expect(args).toContain("--coverageReporters=json-summary");
            expect(args).toContain("--coverageReporters=json");
            expect(args).toContain("--coverageReporters=lcov");
            expect(args).toContain("--forceExit");
        });

        it("passes --config when jestConfigPath is set", async () => {
            jobService.getJobById.mockResolvedValue({
                id: "job-1", snapshotId: "snap-1", projectId: "proj-1",
                snapshot: { rootDir: "/project", jestConfigPath: "jest.config.js" },
            });
            await processCoverageJob("job-1");
            const [, args] = spawn.mock.calls[0];
            expect(args.some((a) => a.startsWith("--config="))).toBe(true);
        });
    });

    // ── SCRUM-111: stdout/stderr capture ────────────────────────
    describe("SCRUM-111: stdout/stderr capture", () => {
        it("appends stdout to job output", async () => {
            spawn.mockReturnValue(makeFakeChild({ stdoutData: "PASS src/foo.test.js" }));
            await processCoverageJob("job-1");
            expect(jobOutputService.appendJobOutput).toHaveBeenCalledWith(
                "job-1",
                expect.objectContaining({ stdout: expect.stringContaining("PASS src/foo.test.js") })
            );
        });

        it("appends stderr to job output", async () => {
            spawn.mockReturnValue(makeFakeChild({ stderrData: "some warning text" }));
            await processCoverageJob("job-1");
            expect(jobOutputService.appendJobOutput).toHaveBeenCalledWith(
                "job-1",
                expect.objectContaining({ stderr: expect.stringContaining("some warning text") })
            );
        });
    });

    // ── SCRUM-112: timeout ───────────────────────────────────────
    describe("SCRUM-112: timeout handling", () => {
        it("kills child process and marks job failed on timeout", async () => {
            jest.useFakeTimers();

            const { EventEmitter } = require("events");
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.kill = jest.fn();
            spawn.mockReturnValue(child);

            const promise = processCoverageJob("job-1");

            // Tick qua 5 phút timeout
            await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 500);
            await promise;

            expect(child.kill).toHaveBeenCalledWith("SIGKILL");
            expect(jobService.markJobFailed).toHaveBeenCalled();

            jest.useRealTimers();
        }, 15_000);
    });

    // ── exit code handling ───────────────────────────────────────
    describe("exit code handling", () => {
        it("marks job FAILED when exit code >= 2", async () => {
            spawn.mockReturnValue(makeFakeChild({ exitCode: 2 }));
            await processCoverageJob("job-1");
            expect(jobService.markJobFailed).toHaveBeenCalled();
            expect(jobService.markJobSuccess).not.toHaveBeenCalled();
        });

        it("marks job SUCCESS when exit code is 1 (tests fail but coverage ok)", async () => {
            spawn.mockReturnValue(makeFakeChild({ exitCode: 1 }));
            await processCoverageJob("job-1");
            expect(jobService.markJobSuccess).toHaveBeenCalled();
        });

        it("marks job SUCCESS when exit code is 0", async () => {
            await processCoverageJob("job-1");
            expect(jobService.markJobSuccess).toHaveBeenCalled();
        });
    });

    // ── SCRUM-85: coverage parse + DB ───────────────────────────
    describe("SCRUM-85: coverage parsing and DB write", () => {
        it("markJobSuccess receives coverage percentages", async () => {
            await processCoverageJob("job-1");
            const [, result] = jobService.markJobSuccess.mock.calls[0];
            expect(typeof result.coverage.lines).toBe("number");
            expect(typeof result.coverage.branches).toBe("number");
            expect(typeof result.coverage.functions).toBe("number");
            expect(typeof result.coverage.statements).toBe("number");
        });

        it("markJobSuccess receives numeric fileCount", async () => {
            await processCoverageJob("job-1");
            const [, result] = jobService.markJobSuccess.mock.calls[0];
            expect(typeof result.fileCount).toBe("number");
        });

        it("marks job FAILED when coverage file is unreadable", async () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockImplementation(() => { throw new Error("disk error"); });
            await processCoverageJob("job-1");
            expect(jobService.markJobFailed).toHaveBeenCalled();
        });
    });

    // ── SCRUM-84: Firebase upload ────────────────────────────────
    describe("SCRUM-84: Firebase storage upload", () => {
        it("markJobSuccess includes storageBasePath", async () => {
            await processCoverageJob("job-1");
            const [, result] = jobService.markJobSuccess.mock.calls[0];
            expect(result).toHaveProperty("storageBasePath");
        });

        it("still marks job SUCCESS when Firebase upload fails", async () => {
            const firebase = require("../config/firebase.js");
            firebase.getBucket.mockReturnValue({
                file: jest.fn(() => ({
                    createWriteStream: jest.fn(() => {
                        const { Writable } = require("stream");
                        const s = new Writable({ write(c, e, cb) { cb(); } });
                        setImmediate(() => s.emit("error", new Error("Firebase down")));
                        return s;
                    }),
                })),
            });
            await processCoverageJob("job-1");
            expect(jobService.markJobSuccess).toHaveBeenCalled();
        });
    });
});