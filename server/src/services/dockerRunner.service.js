import { spawn, spawnSync } from "child_process";
import treeKill from "tree-kill";
import { ServiceError } from "../utils/serviceError.js";
import { addJobLog } from "./job.service.js";
import { appendJobOutput } from "./jobOutput.service.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes default

const killProcessTree = (proc) => {
  if (!proc || !proc.pid) return;
  try {
    treeKill(proc.pid, "SIGKILL", (err) => {
      if (err) {
        try { proc.kill("SIGKILL"); } catch (_) { }
      }
    });
  } catch {
    try { proc.kill("SIGKILL"); } catch (_) { }
  }
};

/**
 * Auto-detect whether Docker CLI is available on this host.
 * Caches the result so we only check once at startup.
 */
const detectDockerAvailable = () => {
  if (process.env.DISABLE_DOCKER_RUNNER === "true" || process.env.DISABLE_DOCKER_RUNNER === "1") return false;
  try {
    const result = spawnSync("docker", ["--version"], { timeout: 5000, stdio: "pipe", shell: true });
    return result.status === 0;
  } catch {
    return false;
  }
};

const DOCKER_AVAILABLE = detectDockerAvailable();
if (!DOCKER_AVAILABLE) {
  console.warn("[DockerRunner] Docker unavailable or disabled by DISABLE_DOCKER_RUNNER — executing commands directly via host shell.");
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
  run: async ({ snapshotPath, command, timeoutMs = DEFAULT_TIMEOUT_MS, jobId = null, image = "node:22", env = {}, forceHost = false }) => {
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
        const mode = DOCKER_AVAILABLE && !forceHost ? "Docker container" : "host shell";
        addJobLog(jobId, "INFO", `[DockerRunner] Starting ${mode} with command: ${command}`).catch(() => { });
      }

      let child;
      let timer;

      const mergedEnv = {
        ...process.env,
        NODE_OPTIONS: "--experimental-vm-modules",
        ...env,
      };

      if (DOCKER_AVAILABLE && !forceHost) {
        const envArgs = [];
        const baseUrl = mergedEnv.PLAYWRIGHT_BASE_URL || "http://host.docker.internal:4173";
        envArgs.push("-e", `PLAYWRIGHT_BASE_URL=${baseUrl}`);

        for (const [k, v] of Object.entries(mergedEnv)) {
          if (["NODE_OPTIONS", "CI", "NODE_ENV"].includes(k) || k in env) {
            envArgs.push("-e", `${k}=${v}`);
          }
        }
        const args = [
          "run",
          "--rm",
          "--add-host=host.docker.internal:host-gateway",
          "--memory=2g",
          "--cpus=1.5",
          "--pids-limit=100",
          ...envArgs,
          "-v",
          `${snapshotPath}:/workspace`,
          "-w",
          "/workspace",
          image,
          "sh",
          "-c",
          command,
        ];
        child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
      } else {
        child = spawn(command, { shell: true, cwd: snapshotPath, env: mergedEnv, stdio: ["pipe", "pipe", "pipe"] });
      }

      // Close child stdin immediately so non-interactive tools (like npx) never hang waiting for input
      try {
        if (child.stdin) child.stdin.end();
      } catch (_) { }

      timer = setTimeout(async () => {
        timedOut = true;
        killProcessTree(child);
        if (jobId) {
          await addJobLog(jobId, "ERROR", `[DockerRunner] Execution timed out (${timeoutMs}ms)`).catch(() => { });
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
        killProcessTree(child);
        const mode = DOCKER_AVAILABLE && !forceHost ? "Docker" : "shell";
        if (jobId) {
          await addJobLog(jobId, "ERROR", `[DockerRunner] Failed to spawn ${mode}: ${err.message}`).catch(() => { });
        }
        reject(new ServiceError(`Failed to spawn ${mode}: ${err.message}`, 500));
      });

      child.on("close", async (code) => {
        clearTimeout(timer);
        if (timedOut) return;

        if (jobId) {
          const status = code === 0 ? "INFO" : "WARN";
          await addJobLog(jobId, status, `[DockerRunner] Process exited with code ${code}`).catch(() => { });
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
