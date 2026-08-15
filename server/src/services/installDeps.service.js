import { spawn } from "child_process";
import fs from "fs";
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
import { resolveProjectRoot } from "../utils/projectRootResolver.js";

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
    console.log(`[InstallDeps ${jobId}] Bắt đầu xử lý install deps`);

    try {
        const currentJob = await getJobById(jobId);
        console.log(`[InstallDeps ${jobId}] Prisma status before execution: ${currentJob?.status ?? "UNKNOWN"}`);
        if (currentJob.status === "RUNNING") {
            console.log(`[InstallDeps ${jobId}] Job đang RUNNING, bỏ qua xử lý trùng lặp.`);
            return;
        }
        if (["SUCCESS", "FAILED", "CANCELED"].includes(currentJob.status)) {
            console.log(`[InstallDeps ${jobId}] Job đã ở trạng thái ${currentJob.status}, không chạy lại.`);
            return;
        }
    } catch (error) {
        console.warn(`[InstallDeps ${jobId}] Không thể đọc trạng thái job trước khi chạy:`, error.message || error);
    }

    // ── Chuyển sang RUNNING ───────────────────────────────────────────────
    try {
        console.log(`[InstallDeps ${jobId}] markJobRunning`);
        await markJobRunning(jobId);
        console.log(`[InstallDeps ${jobId}] Đã chuyển trạng thái sang RUNNING`);
    } catch (error) {
        const message = error?.message || "";
        const ignorable = [
            "Job not found",
            "Only queued jobs can start",
            "Only queued jobs can be started",
            "Cannot start a canceled job",
        ].includes(message);

        if (ignorable) {
            console.log(`[InstallDeps ${jobId}] Bỏ qua chuyển RUNNING: ${message}`);
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
    const resolvedRootDir = resolveProjectRoot(rootDir);
    console.log(`[InstallDeps ${jobId}] rootDir=${rootDir}`);
    console.log(`[InstallDeps ${jobId}] resolvedRootDir=${resolvedRootDir}`);

    if (!fs.existsSync(resolvedRootDir) || !fs.statSync(resolvedRootDir).isDirectory()) {
        const msg = `Snapshot rootDir is invalid or missing: ${resolvedRootDir}`;
        console.error(`[InstallDeps ${jobId}] ${msg}`);
        await markJobFailed(jobId, new Error(msg));
        return;
    }

    const packageJsonPath = path.join(resolvedRootDir, "package.json");
    const packageJsonExists = fs.existsSync(packageJsonPath);
    console.log(`[InstallDeps ${jobId}] packageJson=${packageJsonPath}`);
    console.log(`[InstallDeps ${jobId}] package.json exists=${packageJsonExists}`);
    if (!packageJsonExists) {
        const msg = `Snapshot rootDir does not contain package.json: ${packageJsonPath}`;
        console.error(`[InstallDeps ${jobId}] ${msg}`);
        await markJobFailed(jobId, new Error(msg));
        return;
    }

    if (resolvedRootDir !== rootDir) {
        await prisma.projectSnapshot.update({
            where: { id: job.snapshotId },
            data: { rootDir: resolvedRootDir },
        }).catch(() => { });
    }

    // ── Khởi tạo output ───────────────────────────────────────────────────
    await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
    await updateJobProgress(jobId, 10);
    await addJobLog(jobId, "INFO", `Bắt đầu npm install tại: ${resolvedRootDir}`);

    // ── Spawn npm install ─────────────────────────────────────────────────
    return new Promise((resolve) => {
        let stdoutBuf = "";
        let stderrBuf = "";
        let timedOut = false;
        let settled = false;

        const command = process.platform === "win32" ? "npm.cmd" : "npm";
        const args = ["install", "--prefer-offline"];
        console.log(`[InstallDeps ${jobId}] Chạy command: ${command} ${args.join(" ")} tại ${resolvedRootDir}`);

        const child = spawn(command, args, {
            cwd: resolvedRootDir,
            shell: false,
            env: { ...process.env, CI: "true" },
            stdio: ["ignore", "pipe", "pipe"],
        });

        console.log(`[InstallDeps ${jobId}] npm install started: command=${command} ${args.join(" ")}, cwd=${resolvedRootDir}, pid=${child.pid}`);

        const finalize = async (kind, payload) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            try {
                if (kind === "success") {
                    await updateJobProgress(jobId, 100);
                    await addJobLog(jobId, "INFO", "npm install hoàn thành thành công.");
                    await markJobSuccess(jobId, { installExitCode: 0, ...payload });
                    console.log(`[InstallDeps ${jobId}] markJobSuccess: npm install completed. exitCode=0`);
                } else {
                    await addJobLog(jobId, "ERROR", payload.message || payload.error || "npm install failed");
                    await markJobFailed(jobId, payload.error || new Error(payload.message));
                    console.error(`[InstallDeps ${jobId}] markJobFailed: ${payload.message}`);
                }
            } catch (error) {
                console.error(`[InstallDeps ${jobId}] Failed to finalize install status:`, error);
                console.error(`[InstallDeps ${jobId}] Finalization context kind=${kind}, payload=`, payload);
            }
            resolve();
        };

        const timer = setTimeout(async () => {
            timedOut = true;
            try {
                if (child.exitCode === null && child.pid) {
                    child.kill("SIGKILL");
                }
            } catch (killErr) {
                console.error(`[InstallDeps ${jobId}] Unable to kill hung npm install:`, killErr);
            }

            const msg = `npm install vượt quá timeout ${INSTALL_TIMEOUT_MS / 1000}s`;
            console.error(`[InstallDeps ${jobId}] TIMEOUT: ${msg}`);
            console.error(`[InstallDeps ${jobId}] stdout tail: ${stdoutBuf.slice(-2000)}`);
            console.error(`[InstallDeps ${jobId}] stderr tail: ${stderrBuf.slice(-2000)}`);
            await finalize("failure", { message: msg, error: new Error(msg) });
        }, INSTALL_TIMEOUT_MS);

        child.stdout.on("data", async (chunk) => {
            const text = chunk.toString();
            stdoutBuf += text;
            console.log(`[InstallDeps ${jobId}] [stdout] ${text.trim()}`);
            await appendJobOutput(jobId, { stdout: text }).catch(() => { });
        });

        child.stderr.on("data", async (chunk) => {
            const text = chunk.toString();
            stderrBuf += text;
            console.log(`[InstallDeps ${jobId}] [stderr] ${text.trim()}`);
            await appendJobOutput(jobId, { stderr: text }).catch(() => { });
        });

        child.on("close", async (code, signal) => {
            console.log(`[InstallDeps ${jobId}] npm process close: code=${code}, signal=${signal}`);
            if (timedOut) return;

            if (code === 0) {
                await finalize("success", { installExitCode: 0 });
            } else {
                const msg = `npm install thất bại với exit code ${code ?? "unknown"}`;
                console.error(`[InstallDeps ${jobId}] FAIL: ${msg}`);
                console.error(`[InstallDeps ${jobId}] stdout tail: ${stdoutBuf.slice(-2000)}`);
                console.error(`[InstallDeps ${jobId}] stderr tail: ${stderrBuf.slice(-2000)}`);
                await finalize("failure", { message: msg, error: new Error(msg) });
            }
        });

        child.on("error", async (err) => {
            console.error(`[InstallDeps ${jobId}] npm process error:`, err);
            if (timedOut) return;
            await finalize("failure", { message: err.message || "npm install process error", error: err });
        });
    });
};
