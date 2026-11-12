import fs from "fs";
import { spawn, spawnSync } from "child_process";
import path from "path";
import { terminateProcessTree, trackProcessTree } from './processTree.service.js';
import { withRunnerSlot } from './collectionProcess.service.js';
import { measureUnitTestPhase, recordUnitTestWork } from './unitTestWork.service.js';
import { ServiceError } from "../utils/serviceError.js";
import { addJobLog } from "./job.service.js";
import { appendJobOutput } from "./jobOutput.service.js";
import { resolveSnapshotRootDir } from "../utils/projectRootResolver.js";
import { isolatedProcessEnvironment } from '../utils/isolatedProcessEnvironment.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes default
const MAX_CAPTURED_OUTPUT = 2 * 1024 * 1024;

let hasPsBinary = null;
export const isPsAvailable = () => {
  if (process.platform === "win32") return false;
  if (hasPsBinary !== null) return hasPsBinary;
  try {
    const res = spawnSync("ps", ["-o", "pid", "--no-headers", "-p", String(process.pid)], {
      timeout: 1000,
      stdio: "ignore",
    });
    hasPsBinary = Boolean(res && res.status === 0 && !res.error);
  } catch {
    hasPsBinary = false;
  }
  return hasPsBinary;
};

const ownedProcessGroups = new WeakSet();
const killProcessTree = child => terminateProcessTree(child, ownedProcessGroups.has(child));

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
  run: params => withRunnerSlot(() => measureUnitTestPhase('processExecution', () => executeCommand(params))),
};

const executeCommand = async ({ snapshotPath, command, hostCommand = command, timeoutMs = DEFAULT_TIMEOUT_MS, jobId = null, image = "node:22", env = {}, forceHost = false, signal, projectId = null, inheritEnv = true, loadEnvExamples = true, isolatedEnv = false }) => {
    if (signal?.aborted) throw new ServiceError('Execution canceled', 409);
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let canceled = false;
      let outputTruncated = false;

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

      const effectiveSnapshotPath = resolveSnapshotRootDir(snapshotPath) || snapshotPath;
      const nodeModulesBin = path.join(effectiveSnapshotPath, "node_modules", ".bin");
      const appModulesBin = "/app/node_modules/.bin";
      const currentPath = process.env.PATH || "";
      const delimiter = path.delimiter;
      const customPath = [nodeModulesBin, appModulesBin, currentPath].filter(Boolean).join(delimiter);

      const baseEnv = isolatedEnv
        ? isolatedProcessEnvironment()
        : (inheritEnv
            ? { ...process.env }
            : Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'COMSPEC', 'PATHEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]])));

      // REDACTION: Redact host production database credentials (e.g. Neon DB) so child processes never inherit them
      delete baseEnv.DATABASE_URL;
      delete baseEnv.DIRECT_URL;
      delete baseEnv.SHADOW_DATABASE_URL;
      delete baseEnv.NEON_DATABASE_URL;

      const mergedEnv = {
        ...baseEnv,
        CI: "true",
        VITE_CJS_IGNORE_WARNING: "true",
        PATH: customPath,
        NODE_OPTIONS: "--experimental-vm-modules",
        NODE_PATH: isolatedEnv ? '' : ["/app/node_modules", path.join(effectiveSnapshotPath, "node_modules"), process.env.NODE_PATH || ""].filter(Boolean).join(delimiter),
        ...env,
      };

      // Auto-load repo-level environment variables (.env.test, .env, .env.example) into mergedEnv
      // Note: Database connection strings from repo .env files are strictly blocked to enforce isolated virtual DB usage
      const isDatabaseKey = k => /^(DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|POSTGRES_URL|POSTGRESQL_URL|DB_URL|DB_URI|DB_CONNECTION_STRING|MONGODB_URI|MYSQL_URL)$/i.test(k) || /^DATABASE_/i.test(k);
      const repoEnvFiles = isolatedEnv ? [] : [".env.test", ".env", ...(loadEnvExamples ? [".env.example"] : [])];
      for (const envFile of repoEnvFiles) {
        const envFilePath = path.join(effectiveSnapshotPath, envFile);
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
                if (key && !isDatabaseKey(key) && !(key in mergedEnv)) {
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
          if (["NODE_OPTIONS", "CI", "NODE_ENV", "VITE_CJS_IGNORE_WARNING"].includes(k) || k in env) {
            envArgs.push("-e", `${k}=${v}`);
          }
        }
        const args = [
          "run",
          "--rm",
          "--label", "covai.purpose=test-runner",
          ...(projectId ? ["--label", `covai.projectId=${projectId}`] : []),
          ...(jobId ? ["--label", `covai.jobId=${jobId}`] : []),
          "--add-host=host.docker.internal:host-gateway",
          "--memory=2g",
          "--cpus=1.5",
          "--pids-limit=100",
          ...envArgs,
          "-v",
          `${effectiveSnapshotPath}:/workspace`,
          "-w",
          "/workspace",
          image,
          "sh",
          "-c",
          command,
        ];
        child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
      } else {
        child = spawn(hostCommand, { shell: true, cwd: effectiveSnapshotPath, env: mergedEnv, detached: process.platform !== 'win32', windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        if (process.platform !== 'win32') ownedProcessGroups.add(child);
      }
      trackProcessTree(child, ownedProcessGroups.has(child));
      if (child.pid) recordUnitTestWork('runnerStarts');
      try { child.stdin?.end(); } catch { }
      const abort = () => {
        canceled = true;
        timedOut = true;
        clearTimeout(timer);
        killProcessTree(child);
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();

      // Close child stdin immediately so non-interactive tools (like npx) never hang waiting for input
      try {
        if (child.stdin) child.stdin.end();
      } catch (_) { }

      let heartbeatTimer = null;
      if (jobId) {
        const execStartTime = Date.now();
        heartbeatTimer = setInterval(async () => {
          const elapsedSec = Math.round((Date.now() - execStartTime) / 1000);
          await addJobLog(jobId, "INFO", `[DockerRunner] Execution in progress (elapsed ${elapsedSec}s)...`).catch(() => { });
        }, 60000);
      }

      timer = setTimeout(async () => {
        timedOut = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
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
          }, 2000);
        }
      };

      child.stdout.on("data", (data) => {
        const text = data.toString();
        if(stdout.length+text.length>MAX_CAPTURED_OUTPUT)outputTruncated=true;
        stdout = (stdout + text).slice(-MAX_CAPTURED_OUTPUT);
        if (jobId) {
          pendingStdout = (pendingStdout + text).slice(-MAX_CAPTURED_OUTPUT);
          scheduleFlush();
        }
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        if(stderr.length+text.length>MAX_CAPTURED_OUTPUT)outputTruncated=true;
        stderr = (stderr + text).slice(-MAX_CAPTURED_OUTPUT);
        if (jobId) {
          pendingStderr = (pendingStderr + text).slice(-MAX_CAPTURED_OUTPUT);
          scheduleFlush();
        }
      });

      child.on("error", async (err) => {
        clearTimeout(timer);
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        await flushOutput();
        if(canceled) { reject(new ServiceError('Execution canceled or resource budget exceeded',409)); return; }
        if (timedOut) return;
        killProcessTree(child);
        const mode = DOCKER_AVAILABLE && !forceHost ? "Docker" : "shell";
        if (jobId) {
          await addJobLog(jobId, "ERROR", `[DockerRunner] Failed to spawn ${mode}: ${err.message}`).catch(() => { });
        }
        reject(new ServiceError(`Failed to spawn ${mode}: ${err.message}`, 500));
      });

      child.on("close", async (code) => {
        signal?.removeEventListener('abort', abort);
        clearTimeout(timer);
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        await flushOutput();
        if(canceled) { reject(new ServiceError('Execution canceled or resource budget exceeded',409)); return; }
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
          outputTruncated,
        });
      });
    });
};

/**
 * Stops and removes all Docker runner containers associated with a project.
 *
 * @param {string} projectId
 * @param {Function} [spawnFn=spawnSync]
 * @returns {Promise<{ success: boolean, removedCount: number, error?: string }>}
 */
export async function cleanupProjectRunnerContainers(projectId, spawnFn = spawnSync) {
  if (!projectId || typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId)) {
    return { success: true, removedCount: 0 };
  }
  try {
    const res = spawnFn("docker", [
      "ps", "-a",
      "--filter", `label=covai.projectId=${projectId}`,
      "--format", "{{.ID}}"
    ], { encoding: "utf8", timeout: 10000, shell: true });

    if (res && res.status === 0 && res.stdout) {
      const containerIds = res.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (const cid of containerIds) {
        try {
          spawnFn("docker", ["rm", "-f", cid], { timeout: 15000, shell: true });
        } catch (_) { }
      }
      return { success: true, removedCount: containerIds.length };
    }
    return { success: true, removedCount: 0 };
  } catch (err) {
    console.warn(`[cleanupProjectRunnerContainers] Warning pruning containers for ${projectId}:`, err.message);
    return { success: false, error: err.message, removedCount: 0 };
  }
}

dockerRunner.cleanupProjectRunnerContainers = cleanupProjectRunnerContainers;

