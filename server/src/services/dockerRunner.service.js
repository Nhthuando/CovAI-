import { spawn, spawnSync } from "child_process";
import { ServiceError } from "../utils/serviceError.js";
import { addJobLog } from "./job.service.js";
import { appendJobOutput } from "./jobOutput.service.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes default

/**
 * Auto-detect whether Docker CLI is available on this host.
 * Caches the result so we only check once at startup.
 */
const detectDockerAvailable = () => {
  if (process.env.DISABLE_DOCKER_RUNNER) return false;
  try {
    const result = spawnSync("docker", ["--version"], { timeout: 5000, stdio: "pipe" });
    return result.status === 0;
  } catch {
    return false;
  }
};

const DOCKER_AVAILABLE = detectDockerAvailable();
if (!DOCKER_AVAILABLE) {
  console.warn("[DockerRunner] Docker không khả dụng — sẽ chạy lệnh trực tiếp qua shell.");
}

/**
 * Docker Runner Service
 * Executes commands inside a transient Node.js Docker container.
 * Falls back to direct shell execution when Docker is not available.
 */
export const dockerRunner = {
  /**
   * @param {Object} params
   * @param {string} params.snapshotPath - Host path to source code
   * @param {string} params.command - Command to execute (e.g., "npm install")
   * @param {number} [params.timeoutMs] - Optional execution timeout
   * @param {string} [params.jobId] - Optional Job ID for real-time logging
   * @param {string} [params.image] - Optional Docker image; ignored by direct-shell fallback
   * @returns {Promise<{ success: boolean, exitCode: number, stdout: string, stderr: string }>}
   */
  run: async ({ snapshotPath, command, timeoutMs = DEFAULT_TIMEOUT_MS, jobId = null, image = "node:22" }) => {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      // Docker run command:
      // --rm: Remove container after exit
      // -v: Mount host path to /workspace
      // -w: Set working directory
      // node:22: Use stable Node.js image
      // sh -c: Wrap command to handle complex strings

      if (jobId) {
        const mode = DOCKER_AVAILABLE ? "Docker container" : "shell trực tiếp";
        addJobLog(jobId, "INFO", `[DockerRunner] Khởi động ${mode} với lệnh: ${command}`).catch(() => { });
      }

      let child;
      let timer;

      if (DOCKER_AVAILABLE) {
        const args = [
          "run",
          "--rm",
          "-v",
          `${snapshotPath}:/workspace`,
          "-w",
          "/workspace",
          image,
          "sh",
          "-c",
          command,
        ];
        child = spawn("docker", args);
      } else {
        child = spawn(command, { shell: true, cwd: snapshotPath });
      }

      timer = setTimeout(async () => {
        timedOut = true;
        child.kill("SIGKILL");
        if (jobId) {
          await addJobLog(jobId, "ERROR", `[DockerRunner] Quá thời gian thực thi (${timeoutMs}ms)`).catch(() => { });
        }
        reject(
          new ServiceError(
            `Execution timed out after ${timeoutMs}ms`,
            408,
          ),
        );
      }, timeoutMs);

      child.stdout.on("data", async (data) => {
        const text = data.toString();
        stdout += text;
        if (jobId) {
          await appendJobOutput(jobId, { stdout: text }).catch(() => { });
        }
      });

      child.stderr.on("data", async (data) => {
        const text = data.toString();
        stderr += text;
        if (jobId) {
          await appendJobOutput(jobId, { stderr: text }).catch(() => { });
        }
      });

      child.on("error", async (err) => {
        clearTimeout(timer);
        if (timedOut) return;
        const mode = DOCKER_AVAILABLE ? "Docker" : "shell";
        if (jobId) {
          await addJobLog(jobId, "ERROR", `[DockerRunner] Lỗi khởi tạo ${mode}: ${err.message}`).catch(() => { });
        }
        reject(new ServiceError(`Failed to spawn ${mode}: ${err.message}`, 500));
      });

      child.on("close", async (code) => {
        clearTimeout(timer);
        if (timedOut) return;

        if (jobId) {
          const status = code === 0 ? "INFO" : "ERROR";
          await addJobLog(jobId, status, `[DockerRunner] Container thoát với mã code ${code}`).catch(() => { });
        }

        resolve({
          success: code === 0,
          exitCode: code,
          stdout,
          stderr,
        });
      });
    });
  },
};
