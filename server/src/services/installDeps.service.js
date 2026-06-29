import { spawn } from "child_process";
import path from "path";
import prisma from "../config/prisma.js";
import {
    markJobRunning,
    markJobSuccess,
    markJobFailed,
    updateJobProgress,
    getJobById,
    addJobLog,
} from "./job.service.js";
import { saveJobOutput, appendJobOutput } from "./jobOutput.service.js";
import { ServiceError } from "../utils/serviceError.js";

const INSTALL_TIMEOUT_MS = 3 * 60 * 1000; // 3 phút

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

/**
 * INSTALL_DEPS pipeline:
 *  - Chạy `npm install --prefer-offline` trong rootDir của snapshot
 *  - Capture stdout/stderr vào JobOutput
 *  - Timeout 3 phút
 */
export const processInstallDepsJob = async (jobId) => {
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
            console.log(`[InstallDeps ${jobId}] Bỏ qua: ${error.message}`);
            return;
        }
        console.error(`[InstallDeps ${jobId}] Lỗi khi chuyển RUNNING:`, error);
        return;
    }

    // ── Lấy thông tin Job và Snapshot ────────────────────────────────────
    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[InstallDeps ${jobId}] Không lấy được Job:`, error);
        return;
    }

    if (!job.snapshot?.rootDir) {
        const msg = "Snapshot chưa có rootDir — INGEST job chưa hoàn thành.";
        console.error(`[InstallDeps ${jobId}] ${msg}`);
        await markJobFailed(jobId, new Error(msg));
        return;
    }

    const rootDir = job.snapshot.rootDir;

    // ── Khởi tạo output ───────────────────────────────────────────────────
    await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
    await updateJobProgress(jobId, 10);
    await addJobLog(jobId, "INFO", `Bắt đầu npm install tại: ${rootDir}`);

    // ── Spawn npm install ─────────────────────────────────────────────────
    return new Promise((resolve) => {
        let stdoutBuf = "";
        let stderrBuf = "";
        let timedOut = false;

        const child = spawn("npm", ["install", "--prefer-offline"], {
            cwd: rootDir,
            shell: true, // Windows cần shell:true để chạy npm
            env: { ...process.env, CI: "true" },
        });

        // Timeout handler
        const timer = setTimeout(async () => {
            timedOut = true;
            child.kill("SIGKILL");
            const msg = `npm install vượt quá timeout ${INSTALL_TIMEOUT_MS / 1000}s`;
            console.error(`[InstallDeps ${jobId}] ${msg}`);
            await markJobFailed(jobId, new Error(msg)).catch(() => { });
            resolve();
        }, INSTALL_TIMEOUT_MS);

        // Capture stdout
        child.stdout.on("data", async (chunk) => {
            const text = chunk.toString();
            stdoutBuf += text;
            await appendJobOutput(jobId, { stdout: text }).catch(() => { });
        });

        // Capture stderr
        child.stderr.on("data", async (chunk) => {
            const text = chunk.toString();
            stderrBuf += text;
            await appendJobOutput(jobId, { stderr: text }).catch(() => { });
        });

        // Khi process kết thúc
        child.on("close", async (code) => {
            clearTimeout(timer);
            if (timedOut) return;

            if (code === 0) {
                await updateJobProgress(jobId, 100);
                await addJobLog(jobId, "INFO", "npm install hoàn thành thành công.");
                await markJobSuccess(jobId, { installExitCode: 0 });
                console.log(`[InstallDeps ${jobId}] Thành công.`);
            } else {
                const msg = `npm install thất bại với exit code ${code}`;
                await addJobLog(jobId, "ERROR", msg);
                await markJobFailed(jobId, new Error(msg));
                console.error(`[InstallDeps ${jobId}] ${msg}`);
            }
            resolve();
        });

        child.on("error", async (err) => {
            clearTimeout(timer);
            if (timedOut) return;
            console.error(`[InstallDeps ${jobId}] Process error:`, err);
            await markJobFailed(jobId, err).catch(() => { });
            resolve();
        });
    });
};
