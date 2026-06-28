import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import {
    markJobRunning,
    markJobSuccess,
    markJobFailed,
    updateJobProgress,
    getJobById,
    addJobLog,
} from "./job.service.js";
import { saveJobOutput, appendJobOutput } from "./jobOutput.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { ServiceError } from "../utils/serviceError.js";

const INSTALL_TIMEOUT_MS = 3 * 60 * 1000; // 3 phút
const JEST_TIMEOUT_MS = 5 * 60 * 1000;    // 5 phút

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

/**
 * SCRUM-139: Chạy npm install --prefer-offline trong rootDir.
 * Capture stdout/stderr, timeout 3 phút.
 * @returns {Promise<void>} - resolve bình thường hoặc throw Error nếu thất bại
 */
const runNpmInstall = (jobId, rootDir) => {
    return new Promise((resolve, reject) => {
        let timedOut = false;

        addJobLog(jobId, "INFO", `[SCRUM-139] Bắt đầu npm install tại: ${rootDir}`).catch(() => { });

        const child = spawn("npm", ["install", "--prefer-offline"], {
            cwd: rootDir,
            shell: true,
            env: { ...process.env, CI: "true" },
        });

        const timer = setTimeout(async () => {
            timedOut = true;
            child.kill("SIGKILL");
            const msg = `npm install vượt quá timeout ${INSTALL_TIMEOUT_MS / 1000}s`;
            await addJobLog(jobId, "ERROR", msg).catch(() => { });
            reject(new Error(msg));
        }, INSTALL_TIMEOUT_MS);

        child.stdout.on("data", async (chunk) => {
            const text = chunk.toString();
            await appendJobOutput(jobId, { stdout: text }).catch(() => { });
        });

        child.stderr.on("data", async (chunk) => {
            const text = chunk.toString();
            await appendJobOutput(jobId, { stderr: text }).catch(() => { });
        });

        child.on("close", async (code) => {
            clearTimeout(timer);
            if (timedOut) return;

            if (code === 0) {
                await addJobLog(jobId, "INFO", "[SCRUM-139] npm install hoàn thành thành công.").catch(() => { });
                resolve();
            } else {
                const msg = `[SCRUM-139] npm install thất bại với exit code ${code}`;
                await addJobLog(jobId, "ERROR", msg).catch(() => { });
                reject(new Error(msg));
            }
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            if (timedOut) return;
            reject(err);
        });
    });
};

/**
 * SCRUM-140: Chạy jest --coverage trong rootDir.
 * Capture stdout/stderr, timeout 5 phút.
 * @returns {Promise<{ exitCode: number }>}
 */
const runJestCoverage = (jobId, rootDir, jestConfigPath) => {
    return new Promise((resolve, reject) => {
        let timedOut = false;

        const jestArgs = [
            "--coverage",
            "--coverageReporters=json-summary",
            "--coverageReporters=json",
            "--coverageReporters=lcov",
            "--forceExit",
            "--testTimeout=30000",
        ];

        if (jestConfigPath) {
            jestArgs.push(`--config=${jestConfigPath}`);
        }

        addJobLog(jobId, "INFO", `[SCRUM-140] Bắt đầu jest --coverage tại: ${rootDir}`).catch(() => { });

        const child = spawn("npx", ["jest", ...jestArgs], {
            cwd: rootDir,
            shell: true,
            env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
        });

        const timer = setTimeout(async () => {
            timedOut = true;
            child.kill("SIGKILL");
            const msg = `jest --coverage vượt quá timeout ${JEST_TIMEOUT_MS / 1000}s`;
            await addJobLog(jobId, "ERROR", msg).catch(() => { });
            reject(new Error(msg));
        }, JEST_TIMEOUT_MS);

        child.stdout.on("data", async (chunk) => {
            const text = chunk.toString();
            process.stdout.write(`[Jest ${jobId}] ${text}`);
            await appendJobOutput(jobId, { stdout: text }).catch(() => { });
        });

        child.stderr.on("data", async (chunk) => {
            const text = chunk.toString();
            process.stderr.write(`[Jest ${jobId}] ${text}`);
            await appendJobOutput(jobId, { stderr: text }).catch(() => { });
        });

        child.on("close", async (code) => {
            clearTimeout(timer);
            if (timedOut) return;

            // Jest exit code 1 = có test fail nhưng coverage vẫn sinh → chấp nhận
            // exit code >= 2 = lỗi nghiêm trọng (config sai, không chạy được)
            if (code !== null && code >= 2) {
                const msg = `[SCRUM-140] jest kết thúc với exit code ${code} (lỗi nghiêm trọng)`;
                await addJobLog(jobId, "ERROR", msg).catch(() => { });
                reject(new Error(msg));
                return;
            }

            await addJobLog(jobId, "INFO", `[SCRUM-140] jest kết thúc (exit ${code}), coverage đã sinh.`).catch(() => { });
            resolve({ exitCode: code });
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            if (timedOut) return;
            reject(err);
        });
    });
};

/**
 * SCRUM-141: Parse coverage-final.json để lấy per-file coverage data.
 * Trả về parsed object hoặc null nếu file không tồn tại.
 */
const readCoverageFinal = (coverageDir) => {
    const finalPath = path.join(coverageDir, "coverage-final.json");
    if (!fs.existsSync(finalPath)) {
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(finalPath, "utf8"));
        return raw;
    } catch {
        return null;
    }
};

/**
 * SCRUM-141: Parse per-file coverage từ coverage-final.json và lưu CoverageFile vào DB.
 * Sử dụng parseCoverageFilesForSnapshot nếu hợp lệ.
 */
const parseFinalCoverageFiles = async (jobId, snapshotId, projectId, userId, coverageDir) => {
    const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
    const coverageReport = readCoverageFinal(coverageDir);

    if (!coverageReport) {
        await addJobLog(jobId, "WARN", "[SCRUM-141] coverage-final.json không tồn tại, bỏ qua parse CoverageFile.").catch(() => { });
        return;
    }

    try {
        const result = await parseCoverageFilesForSnapshot({
            projectId,
            snapshotId,
            coverageReport,
            userId,
        });
        await addJobLog(
            jobId,
            "INFO",
            `[SCRUM-141] Đã parse ${result.totalFiles} CoverageFile records.`
        ).catch(() => { });
    } catch (err) {
        // Không fail toàn bộ pipeline nếu parse file lỗi
        await addJobLog(jobId, "WARN", `[SCRUM-141] Lỗi parse CoverageFile: ${err.message}`).catch(() => { });
    }
};

/**
 * SCRUM-141: Parse per-function coverage từ coverage-final.json và lưu CoverageFunction vào DB.
 */
const parseFinalCoverageFunctions = async (jobId, snapshotId, projectId, userId, coverageDir) => {
    const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");
    const coverageReport = readCoverageFinal(coverageDir);

    if (!coverageReport) {
        await addJobLog(jobId, "WARN", "[SCRUM-141] coverage-final.json không tồn tại, bỏ qua parse CoverageFunction.").catch(() => { });
        return;
    }

    try {
        const result = await parseCoverageFunctionsForSnapshot({
            projectId,
            snapshotId,
            coverageReport,
            userId,
        });
        await addJobLog(
            jobId,
            "INFO",
            `[SCRUM-141] Đã parse ${result.totalFunctions} CoverageFunction records.`
        ).catch(() => { });
    } catch (err) {
        await addJobLog(jobId, "WARN", `[SCRUM-141] Lỗi parse CoverageFunction: ${err.message}`).catch(() => { });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SCRUM-88: Full Coverage Analysis Pipeline cho RUN_TESTS job.
 *
 * Luồng:
 *  1. markJobRunning                               — SCRUM-143
 *  2. updateJobProgress(10)                        — SCRUM-144
 *  3. npm install (runNpmInstall)                  — SCRUM-139
 *  4. updateJobProgress(35)                        — SCRUM-144
 *  5. jest --coverage (runJestCoverage)            — SCRUM-140
 *  6. updateJobProgress(65)                        — SCRUM-144
 *  7. parseCoverageSummary → CoverageSummary DB    — SCRUM-141
 *  8. parseFinalCoverageFiles → CoverageFile DB    — SCRUM-141
 *  9. parseFinalCoverageFunctions → CoverageFunction DB — SCRUM-141
 * 10. updateJobProgress(85)                        — SCRUM-144
 * 11. storeCoverageOutputs → Firebase              — SCRUM-142
 * 12. updateJobProgress(100)                       — SCRUM-144
 * 13. markJobSuccess                               — SCRUM-143
 *
 * @param {string} jobId  - ID của Job có type="RUN_TESTS"
 */
export const processRunTestsJob = async (jobId) => {
    assertStringField(jobId, "jobId");

    // ── SCRUM-143: Chuyển sang RUNNING ───────────────────────────────────────
    try {
        await markJobRunning(jobId);
    } catch (error) {
        if (
            error.message === "Job not found" ||
            error.message === "Only queued jobs can start" ||
            error.message === "Cannot start a canceled job"
        ) {
            console.log(`[RunTestsJob ${jobId}] Bỏ qua: ${error.message}`);
            return;
        }
        console.error(`[RunTestsJob ${jobId}] Lỗi khi chuyển RUNNING:`, error);
        return;
    }

    // ── Lấy thông tin Job + Snapshot ─────────────────────────────────────────
    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[RunTestsJob ${jobId}] Không lấy được Job:`, error);
        return;
    }

    // Validate snapshot có rootDir
    if (!job.snapshot?.rootDir) {
        const msg = "Snapshot chưa có rootDir — INGEST job chưa hoàn thành.";
        console.error(`[RunTestsJob ${jobId}] ${msg}`);
        await markJobFailed(jobId, new Error(msg)).catch(() => { });
        return;
    }

    const rootDir = job.snapshot.rootDir;
    const snapshotId = job.snapshotId;
    const projectId = job.projectId;
    const userId = job.userId;
    const jestConfigPath = job.snapshot.jestConfigPath ?? null;
    const coverageDir = path.join(rootDir, "coverage");

    // Khởi tạo output record
    await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });

    // ── SCRUM-144: Progress 10% — bắt đầu ───────────────────────────────────
    await updateJobProgress(jobId, 10).catch(() => { });
    await addJobLog(jobId, "INFO", "Pipeline RUN_TESTS bắt đầu.").catch(() => { });

    try {
        // ── SCRUM-139: Install dependencies ──────────────────────────────────
        await addJobLog(jobId, "INFO", "Bước 1/4: Cài dependencies...").catch(() => { });
        await runNpmInstall(jobId, rootDir);

        // ── SCRUM-144: Progress 35% — sau install ─────────────────────────────
        await updateJobProgress(jobId, 35).catch(() => { });

        // ── SCRUM-140: Execute coverage analysis ──────────────────────────────
        await addJobLog(jobId, "INFO", "Bước 2/4: Chạy jest --coverage...").catch(() => { });
        const { exitCode } = await runJestCoverage(jobId, rootDir, jestConfigPath);

        // ── SCRUM-144: Progress 65% — sau jest ───────────────────────────────
        await updateJobProgress(jobId, 65).catch(() => { });

        // ── SCRUM-141: Parse reports ──────────────────────────────────────────
        await addJobLog(jobId, "INFO", "Bước 3/4: Parse coverage reports...").catch(() => { });

        // Parse coverage-summary.json → CoverageSummary + CoverageFile (from summary)
        let summaryResult = null;
        try {
            summaryResult = await parseCoverageSummary(coverageDir, snapshotId);
            await addJobLog(
                jobId,
                "INFO",
                `[SCRUM-141] Summary: lines=${summaryResult.total.lines.pct}%, ` +
                `branches=${summaryResult.total.branches.pct}%, ` +
                `functions=${summaryResult.total.functions.pct}%, ` +
                `statements=${summaryResult.total.statements.pct}% | files=${summaryResult.fileCount}`
            ).catch(() => { });
        } catch (parseErr) {
            await addJobLog(jobId, "WARN", `[SCRUM-141] Lỗi parse coverage-summary: ${parseErr.message}`).catch(() => { });
        }

        // Parse coverage-final.json → CoverageFile (per-file detail)
        await parseFinalCoverageFiles(jobId, snapshotId, projectId, userId, coverageDir);

        // Parse coverage-final.json → CoverageFunction (per-function detail)
        await parseFinalCoverageFunctions(jobId, snapshotId, projectId, userId, coverageDir);

        // Verify lcov.info
        const lcovPath = path.join(coverageDir, "lcov.info");
        const hasLcov = fs.existsSync(lcovPath);
        await addJobLog(jobId, "INFO", `lcov.info: ${hasLcov ? "có" : "không tìm thấy"}`).catch(() => { });

        // ── SCRUM-144: Progress 85% — sau parse ──────────────────────────────
        await updateJobProgress(jobId, 85).catch(() => { });

        // ── SCRUM-142: Store results lên Firebase ─────────────────────────────
        await addJobLog(jobId, "INFO", "Bước 4/4: Lưu coverage files lên Firebase...").catch(() => { });
        let storageResult = {};
        try {
            storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);
            await addJobLog(
                jobId,
                "INFO",
                `[SCRUM-142] Đã upload coverage files: ${storageResult.baseStoragePath}`
            ).catch(() => { });
        } catch (storageErr) {
            // Không fail toàn bộ pipeline nếu storage lỗi
            await addJobLog(
                jobId,
                "WARN",
                `[SCRUM-142] Không thể upload coverage files: ${storageErr.message}`
            ).catch(() => { });
        }

        // ── SCRUM-144: Progress 100% ──────────────────────────────────────────
        await updateJobProgress(jobId, 100).catch(() => { });

        // ── SCRUM-143: markJobSuccess ─────────────────────────────────────────
        await markJobSuccess(jobId, {
            jestExitCode: exitCode,
            coverage: summaryResult
                ? {
                    lines: summaryResult.total.lines.pct,
                    branches: summaryResult.total.branches.pct,
                    functions: summaryResult.total.functions.pct,
                    statements: summaryResult.total.statements.pct,
                }
                : null,
            fileCount: summaryResult?.fileCount ?? null,
            hasLcov,
            storageBasePath: storageResult.baseStoragePath ?? null,
        });

        console.log(`[RunTestsJob ${jobId}] Pipeline hoàn thành thành công.`);

    } catch (error) {
        console.error(`[RunTestsJob ${jobId}] Lỗi pipeline:`, error);
        await addJobLog(jobId, "ERROR", `Lỗi pipeline: ${error.message}`).catch(() => { });
        // ── SCRUM-143: markJobFailed ──────────────────────────────────────────
        await markJobFailed(jobId, error).catch((markErr) => {
            console.error(`[RunTestsJob ${jobId}] Không thể đánh dấu FAILED:`, markErr);
        });
    }
};
