import { spawn } from "child_process";
import { ServiceError } from "../utils/serviceError.js";

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
   * @returns {Promise<{ success: boolean, exitCode: number, stdout: string, stderr: string }>}
   */
  run: async ({ snapshotPath, command, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
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

      const child = spawn("docker", args);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
        reject(
          new ServiceError(
            `Docker execution timed out after ${timeoutMs}ms`,
            408,
          ),
        );
      }, timeoutMs);

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (timedOut) return;
        reject(new ServiceError(`Failed to spawn Docker: ${err.message}`, 500));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return;

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
