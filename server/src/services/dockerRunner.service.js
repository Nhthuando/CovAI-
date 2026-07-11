import { spawn } from "child_process";
import { ServiceError } from "../utils/serviceError.js";
import { addJobLog } from "./job.service.js";
import { appendJobOutput } from "./jobOutput.service.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes default

/**
 * Docker Runner Service
 * Executes commands inside a transient Node.js Docker container.
 */
export const dockerRunner = {
  /**
   * @param {Object} params
   * @param {string} params.snapshotPath - Host path to source code
   * @param {string} params.command - Command to execute (e.g., "npm install")
   * @param {number} [params.timeoutMs] - Optional execution timeout
   * @param {string} [params.jobId] - Optional Job ID for real-time logging
   * @returns {Promise<{ success: boolean, exitCode: number, stdout: string, stderr: string }>}
   */
  run: async ({ snapshotPath, command, timeoutMs = DEFAULT_TIMEOUT_MS, jobId = null }) => {
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
        addJobLog(jobId, "INFO", `[DockerRunner] Khởi động container với lệnh: ${command}`).catch(() => { });
      }

      // Check if we should run directly instead of docker
      // In our docker-compose deployment, we don't have docker CLI installed inside the server container.
      const useDocker = !process.env.DISABLE_DOCKER_RUNNER;

      let child;
      let timer;

      if (useDocker) {
        const args = [
          "run",
          "--rm",
          "-v",
          `${snapshotPath}:/workspace`,
          "-w",
          "/workspace",
          "node:22",
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
        if (jobId) {
          await addJobLog(jobId, "ERROR", `[DockerRunner] Lỗi khởi tạo Docker: ${err.message}`).catch(() => { });
        }
        reject(new ServiceError(`Failed to spawn Docker: ${err.message}`, 500));
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
