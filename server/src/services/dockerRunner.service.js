import fs from "fs";
import { spawn, spawnSync } from "child_process";
import path from "path";
import treeKill from "tree-kill";
import { ServiceError } from "../utils/serviceError.js";
import { addJobLog } from "./job.service.js";
import { appendJobOutput } from "./jobOutput.service.js";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes default

const killProcessTree = (proc) => {
  if (!proc || !proc.pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
      return;
    } catch (_) { }
  }
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
  if (process.env.DISABLE_DOCKER_RUNNER === "true" || process.env.DISABLE_DOCKER_RUNNER === "1" || process.env.DISABLE_DOCKER_RUNNER) return false;
  // On Windows host, dependencies are installed on host by npm.cmd.
  // Mounting Windows node_modules into a Linux Docker container causes binary mismatches,
  // napi-postinstall hangs, and permission locks. Fall back to direct shell execution.
  if (process.platform === "win32" && !process.env.FORCE_DOCKER_RUNNER) {
    return false;
  }
  try {
    const result = spawnSync("docker", ["--version"], { timeout: 5000, stdio: "pipe", shell: true });
    return result.status === 0;
  } catch {
    return false;
  }
};

const DOCKER_AVAILABLE = detectDockerAvailable();
if (!DOCKER_AVAILABLE) {
  console.warn("[DockerRunner] Docker unavailable or disabled — executing commands directly via host shell.");
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

      const nodeModulesBin = path.join(snapshotPath, "node_modules", ".bin");
      const appModulesBin = "/app/node_modules/.bin";
      const currentPath = process.env.PATH || "";
      const customPath = `${nodeModulesBin}:${appModulesBin}:${currentPath}`;

      const mergedEnv = {
        ...process.env,
        CI: "true",
        PATH: customPath,
        NODE_OPTIONS: "--experimental-vm-modules",
        NODE_PATH: `/app/node_modules:${path.join(snapshotPath, "node_modules")}:${process.env.NODE_PATH || ""}`,
        ...env,
      };

      // Auto-load repo-level environment variables (.env.test, .env.example, .env) into mergedEnv
      const repoEnvFiles = [".env.test", ".env.example", ".env"];
      for (const envFile of repoEnvFiles) {
        const envFilePath = path.join(snapshotPath, envFile);
        if (fs.existsSync(envFilePath)) {
          try {
            const content = fs.readFileSync(envFilePath, "utf8");
            for (const line of content.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith("#")) continue;
              const eqIdx = trimmed.indexOf("=");
              if (eqIdx !== -1) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                  val = val.slice(1, -1);
                }
                if (key && !(key in mergedEnv)) {
                  mergedEnv[key] = val;
                }
              }
            }
          } catch { }
        }
      }

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
      try { child.stdin?.end(); } catch { }

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

      let pendingStdout = "";
      let pendingStderr = "";
      let flushTimer = null;

      const flushOutput = async () => {
        if (!jobId) return;
        const out = pendingStdout;
        const err = pendingStderr;
        if (!out && !err) return;
        pendingStdout = "";
        pendingStderr = "";
        await appendJobOutput(jobId, {
          stdout: out || undefined,
          stderr: err || undefined,
        }).catch(() => { });
      };

      const scheduleFlush = () => {
        if (!flushTimer) {
          flushTimer = setTimeout(async () => {
            flushTimer = null;
            await flushOutput();
          }, 800);
        }
      };

      child.stdout.on("data", (data) => {
        const text = data.toString();
        stdout += text;
        if (jobId) {
          pendingStdout += text;
          scheduleFlush();
        }
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        if (jobId) {
          pendingStderr += text;
          scheduleFlush();
        }
      });

      child.on("error", async (err) => {
        clearTimeout(timer);
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        await flushOutput();
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
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        await flushOutput();
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
