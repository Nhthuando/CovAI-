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
import { appendJobOutput, saveJobOutput } from "./jobOutput.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";

const RUN_TESTS_TIMEOUT_MS = 5 * 60 * 1000; // 5 phút

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};



/**
 * RUN_TESTS pipeline — SCRUM-107..SCRUM-112:
 *  1. markJobRunning
 *  2. spawn jest --coverage với reporters json-summary, json, lcov
 *  3. Capture stdout/stderr (SCRUM-111)
 *  4. Timeout 5 phút (SCRUM-112)
 *  5. Parse coverage-summary.json → DB (SCRUM-108)
 *  6. Parse coverage-final.json → DB (SCRUM-109)
 *  7. Verify lcov.info (SCRUM-110)
 *  8. markJobSuccess
 */
export const processCoverageJob = async (jobId) => {
    assertStringField(jobId, "jobId");

    // ── Chuyển sang RUNNING ───────────────────────────────────────────────
    try {
        await markJobRunning(jobId);
    } catch (error) {
        if (
            error.message === "Job not found" ||
            error.message === "Only queued jobs can start" ||
            error.message === "Cannot start a canceled job"
        ) {
            console.log(`[CoverageRunner ${jobId}] Bỏ qua: ${error.message}`);
            return;
        }
        console.error(`[CoverageRunner ${jobId}] Lỗi khi chuyển RUNNING:`, error);
        return;
    }

    // ── Lấy thông tin Job + Snapshot ─────────────────────────────────────
    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[CoverageRunner ${jobId}] Không lấy được Job:`, error);
        return;
    }

    if (!job.snapshot?.rootDir) {
        const msg = "Snapshot chưa có rootDir — INGEST job chưa hoàn thành.";
        console.error(`[CoverageRunner ${jobId}] ${msg}`);
        await markJobFailed(jobId, new Error(msg));
        return;
    }

    const rootDir = job.snapshot.rootDir;
    const snapshotId = job.snapshotId;
    const coverageDir = path.join(rootDir, "coverage");

    // Khởi tạo output
    await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
    await updateJobProgress(jobId, 10);
    await addJobLog(jobId, "INFO", `Bắt đầu jest --coverage tại: ${rootDir}`);

    // ── SCRUM-107: Spawn jest --coverage ──────────────────────────────────
    const jestArgs = [
        "--coverage",
        "--coverageReporters=json-summary",
        "--coverageReporters=json",
        "--coverageReporters=lcov",
        "--forceExit",
        "--testTimeout=30000",
    ];

    // Nếu snapshot có jestConfigPath thì truyền vào
    if (job.snapshot.jestConfigPath) {
        jestArgs.push(`--config=${job.snapshot.jestConfigPath}`);
    }

    return new Promise((resolve) => {
        let timedOut = false;

        const child = spawn("npx", ["jest", ...jestArgs], {
            cwd: rootDir,
            shell: true,
            env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
        });

        // SCRUM-112: Timeout handler
        const timer = setTimeout(async () => {
            timedOut = true;
            child.kill("SIGKILL");
            const msg = `jest --coverage vượt quá timeout ${RUN_TESTS_TIMEOUT_MS / 1000}s`;
            console.error(`[CoverageRunner ${jobId}] ${msg}`);
            await addJobLog(jobId, "ERROR", msg);
            await markJobFailed(jobId, new Error(msg)).catch(() => { });
            resolve();
        }, RUN_TESTS_TIMEOUT_MS);

        // SCRUM-111: Capture stdout line-by-line
        child.stdout.on("data", async (chunk) => {
            const text = chunk.toString();
            process.stdout.write(`[Jest ${jobId}] ${text}`);
            await appendJobOutput(jobId, { stdout: text }).catch(() => { });
        });

        // SCRUM-111: Capture stderr
        child.stderr.on("data", async (chunk) => {
            const text = chunk.toString();
            process.stderr.write(`[Jest ${jobId}] ${text}`);
            await appendJobOutput(jobId, { stderr: text }).catch(() => { });
        });

        // Khi jest kết thúc
        child.on("close", async (code) => {
            clearTimeout(timer);
            if (timedOut) return;

            // Jest trả exit code 1 khi có test fail, nhưng vẫn sinh coverage
            // Chỉ coi là lỗi nếu exit code >= 2 (lỗi cấu hình/không chạy được)
            if (code !== null && code >= 2) {
                const msg = `jest kết thúc với exit code ${code} (lỗi nghiêm trọng)`;
                await addJobLog(jobId, "ERROR", msg);
                await markJobFailed(jobId, new Error(msg));
                console.error(`[CoverageRunner ${jobId}] ${msg}`);
                return resolve();
            }

            await updateJobProgress(jobId, 70);
            await addJobLog(jobId, "INFO", `jest kết thúc (exit ${code}), đang parse coverage...`);

            try {
                // SCRUM-85: Parse coverage-summary.json → DB (lines/branches/functions/statements)
                const { total, fileCount } = await parseCoverageSummary(coverageDir, snapshotId);
                await addJobLog(jobId, "INFO",
                    `Coverage parsed: lines=${total.lines.pct}%, branches=${total.branches.pct}%, ` +
                    `functions=${total.functions.pct}%, statements=${total.statements.pct}% | files=${fileCount}`
                );

                // Verify lcov.info
                const lcovPath = path.join(coverageDir, "lcov.info");
                const hasLcov = fs.existsSync(lcovPath);
                await addJobLog(jobId, "INFO", `lcov.info: ${hasLcov ? "có" : "không tìm thấy"}`);

                await updateJobProgress(jobId, 85);

                // SCRUM-84: Upload coverage files lên Firebase Storage
                let storageResult = {};
                try {
                    storageResult = await storeCoverageOutputs(
                        snapshotId,
                        job.projectId,
                        coverageDir
                    );
                    await addJobLog(jobId, "INFO", `Đã upload coverage files lên Firebase: ${storageResult.baseStoragePath}`);
                } catch (storageErr) {
                    console.warn(`[CoverageRunner ${jobId}] Cảnh báo: không thể upload coverage files:`, storageErr.message);
                    await addJobLog(jobId, "WARN", `Không thể upload coverage files: ${storageErr.message}`);
                }

                await updateJobProgress(jobId, 95);

                await markJobSuccess(jobId, {
                    jestExitCode: code,
                    coverage: {
                        lines: total.lines.pct,
                        branches: total.branches.pct,
                        functions: total.functions.pct,
                        statements: total.statements.pct,
                    },
                    fileCount,
                    hasLcov,
                    storageBasePath: storageResult.baseStoragePath ?? null,
                });

                console.log(`[CoverageRunner ${jobId}] Pipeline hoàn thành thành công.`);

            } catch (parseError) {
                console.error(`[CoverageRunner ${jobId}] Lỗi parse coverage:`, parseError);
                await addJobLog(jobId, "ERROR", `Lỗi parse coverage: ${parseError.message}`);
                await markJobFailed(jobId, parseError).catch(() => { });
            }

            resolve();
        });

        child.on("error", async (err) => {
            clearTimeout(timer);
            if (timedOut) return;
            console.error(`[CoverageRunner ${jobId}] Process error:`, err);
            await addJobLog(jobId, "ERROR", `Process error: ${err.message}`);
            await markJobFailed(jobId, err).catch(() => { });
            resolve();
        });
    });
};
