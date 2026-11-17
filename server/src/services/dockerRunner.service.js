import fs from "fs";
import os from "os";
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

export const DOCKER_STATUS_CODES = {
  RUNNER_AVAILABLE: "RUNNER_AVAILABLE",
  RUNNER_DISABLED: "RUNNER_DISABLED",
  DOCKER_CLI_MISSING: "DOCKER_CLI_MISSING",
  DOCKER_SOCKET_MISSING: "DOCKER_SOCKET_MISSING",
  DOCKER_PERMISSION_DENIED: "DOCKER_PERMISSION_DENIED",
  DOCKER_DAEMON_UNAVAILABLE: "DOCKER_DAEMON_UNAVAILABLE",
  DOCKER_API_ERROR: "DOCKER_API_ERROR",
  RUNNER_UNAVAILABLE: "RUNNER_UNAVAILABLE",
};

/**
 * Inspects Docker runner availability with detailed diagnostic classification.
 * Supports dependency injection for deterministic unit testing.
 */
export const inspectDockerAvailability = ({
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  spawnSyncImpl = spawnSync,
} = {}) => {
  const disableFlag = env.DISABLE_DOCKER_RUNNER;
  if (
    disableFlag !== undefined &&
    disableFlag !== "" &&
    disableFlag !== "false" &&
    disableFlag !== "0"
  ) {
    return {
      available: false,
      code: DOCKER_STATUS_CODES.RUNNER_DISABLED,
      reason: `Docker runner is disabled by DISABLE_DOCKER_RUNNER=${disableFlag}.`,
      details: { disableFlag },
    };
  }

  // On Windows host, dependencies are installed on host by npm.cmd.
  // Mounting Windows node_modules into a Linux Docker container causes binary mismatches,
  // napi-postinstall hangs, and permission locks. Fall back to direct shell execution.
  if (platform === "win32" && !env.FORCE_DOCKER_RUNNER) {
    return {
      available: false,
      code: DOCKER_STATUS_CODES.RUNNER_DISABLED,
      reason: "Docker runner is disabled on native Windows host unless FORCE_DOCKER_RUNNER is set.",
      details: { platform },
    };
  }

  const dockerHost = env.DOCKER_HOST || "";
  const isTcpHost = /^(?:tcp|http|https|ssh):\/\//i.test(dockerHost);
  const socketPath = !isTcpHost
    ? (env.DOCKER_SOCKET || (dockerHost.startsWith("unix://") ? dockerHost.slice(7) : (platform !== "win32" ? "/var/run/docker.sock" : null)))
    : null;

  if (socketPath) {
    if (!fsImpl.existsSync(socketPath)) {
      return {
        available: false,
        code: DOCKER_STATUS_CODES.DOCKER_SOCKET_MISSING,
        reason: `Docker socket not found at ${socketPath}. Ensure the Docker socket is mounted into the container.`,
        details: { socketPath },
      };
    }
    try {
      const rwMode = (fsImpl.constants?.R_OK ?? 4) | (fsImpl.constants?.W_OK ?? 2);
      fsImpl.accessSync(socketPath, rwMode);
    } catch (err) {
      return {
        available: false,
        code: DOCKER_STATUS_CODES.DOCKER_PERMISSION_DENIED,
        reason: `Permission denied accessing Docker socket ${socketPath}: ${err.message}`,
        details: { socketPath, errnoCode: err.code },
      };
    }
  }

  try {
    const cliRes = spawnSyncImpl("docker", ["--version"], {
      timeout: 5000,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (cliRes?.error?.code === "ENOENT" || cliRes?.status === 127) {
      return {
        available: false,
        code: DOCKER_STATUS_CODES.DOCKER_CLI_MISSING,
        reason: "Docker CLI binary ('docker') is missing or not in PATH.",
        details: { error: cliRes?.error?.message },
      };
    }
    if (!cliRes || cliRes.status !== 0) {
      const cliOut = `${cliRes?.stderr || ""} ${cliRes?.stdout || ""}`.trim();
      return {
        available: false,
        code: DOCKER_STATUS_CODES.RUNNER_UNAVAILABLE,
        reason: `Docker CLI check failed: ${cliOut || cliRes?.error?.message || "unknown error"}`,
        details: { status: cliRes?.status },
      };
    }

    const pingRes = spawnSyncImpl("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 5000,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (pingRes && pingRes.status === 0) {
      const serverVersion = String(pingRes.stdout || "").trim();
      return {
        available: true,
        code: DOCKER_STATUS_CODES.RUNNER_AVAILABLE,
        reason: `Docker daemon reachable${serverVersion ? ` (Engine ${serverVersion})` : ""}.`,
        details: { serverVersion, socketPath, dockerHost: dockerHost || undefined },
      };
    }

    const errText = `${pingRes?.stderr || ""} ${pingRes?.stdout || ""} ${pingRes?.error?.message || ""}`.trim();
    if (/permission denied/i.test(errText)) {
      return {
        available: false,
        code: DOCKER_STATUS_CODES.DOCKER_PERMISSION_DENIED,
        reason: `Permission denied communicating with Docker daemon: ${errText}`,
        details: { socketPath },
      };
    }
    if (/no such file or directory|cannot find the file specified/i.test(errText) && /docker\.sock|pipe/i.test(errText)) {
      return {
        available: false,
        code: DOCKER_STATUS_CODES.DOCKER_SOCKET_MISSING,
        reason: `Docker socket missing during daemon check: ${errText}`,
        details: { socketPath },
      };
    }
    if (/cannot connect to the docker daemon|is the docker daemon running|connection refused|error during connect/i.test(errText)) {
      return {
        available: false,
        code: DOCKER_STATUS_CODES.DOCKER_DAEMON_UNAVAILABLE,
        reason: `Docker daemon is unreachable: ${errText}`,
        details: { socketPath, dockerHost: dockerHost || undefined },
      };
    }
    if (/client version|api version|error response from daemon|server returned/i.test(errText)) {
      return {
        available: false,
        code: DOCKER_STATUS_CODES.DOCKER_API_ERROR,
        reason: `Docker API error: ${errText}`,
        details: { status: pingRes?.status },
      };
    }

    return {
      available: false,
      code: DOCKER_STATUS_CODES.RUNNER_UNAVAILABLE,
      reason: `Docker runner unavailable: ${errText || "unknown error"}`,
      details: { status: pingRes?.status },
    };
  } catch (err) {
    return {
      available: false,
      code: DOCKER_STATUS_CODES.RUNNER_UNAVAILABLE,
      reason: `Docker availability check threw an error: ${err.message}`,
      details: {},
    };
  }
};

let cachedContainerContext = null;
const resolveContainerExecutionContext = () => {
  if (cachedContainerContext !== null) return cachedContainerContext;
  const inContainer = fs.existsSync("/.dockerenv");
  if (!inContainer) {
    cachedContainerContext = { inContainer: false };
    return cachedContainerContext;
  }
  try {
    const selfId = os.hostname();
    const res = spawnSync("docker", ["inspect", selfId], {
      timeout: 5000,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (res.status === 0 && res.stdout) {
      const info = JSON.parse(res.stdout)?.[0];
      const mounts = Array.isArray(info?.Mounts) ? info.Mounts : [];
      const appMount = mounts.find(m => m.Destination === "/app");
      const nodeModulesMount = mounts.find(m => m.Destination === "/app/node_modules");
      const networkMode = info?.HostConfig?.NetworkMode || "";
      const selfImage = info?.Config?.Image || "";
      cachedContainerContext = {
        inContainer: true,
        appSource: appMount?.Source || null,
        nodeModulesVolume: nodeModulesMount?.Name || null,
        networkMode,
        selfImage,
      };
      return cachedContainerContext;
    }
  } catch (_) { }
  cachedContainerContext = { inContainer: true };
  return cachedContainerContext;
};

const hasLocalDockerImage = (imageName) => {
  try {
    const res = spawnSync("docker", ["image", "inspect", imageName], {
      timeout: 3000,
      stdio: "ignore",
    });
    return res.status === 0;
  } catch {
    return false;
  }
};

const initialAvailability = inspectDockerAvailability();
const DOCKER_AVAILABLE = initialAvailability.available;
if (!DOCKER_AVAILABLE) {
  console.warn(`[DockerRunner] ${initialAvailability.code}: ${initialAvailability.reason} — executing commands directly via host shell when Docker is optional.`);
}

/**
 * Docker Runner Service
 * Executes commands inside a transient Node.js Docker container.
 * Falls back to direct shell execution when Docker is not available.
 */
export const dockerRunner = {
  containerEnabled: DOCKER_AVAILABLE,
  lastDiagnostics: initialAvailability,
  checkAvailability: () => {
    const diag = inspectDockerAvailability();
    dockerRunner.containerEnabled = diag.available;
    dockerRunner.lastDiagnostics = diag;
    return diag;
  },
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

      const useDocker = Boolean(dockerRunner.containerEnabled && !forceHost);

      if (jobId) {
        const mode = useDocker ? "Docker container" : "host shell";
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

      if (useDocker) {
        const containerCtx = resolveContainerExecutionContext();
        let hostWorkspacePath = effectiveSnapshotPath;
        const extraVolumeArgs = [];
        const extraNetworkArgs = [];

        if (containerCtx.inContainer && containerCtx.appSource) {
          const normSnap = effectiveSnapshotPath.replace(/\\/g, "/");
          if (normSnap === "/app" || normSnap.startsWith("/app/")) {
            const relSub = normSnap === "/app" ? "" : normSnap.slice(5);
            const cleanBase = containerCtx.appSource.replace(/[\\/]+$/, "");
            hostWorkspacePath = relSub ? `${cleanBase}/${relSub}` : cleanBase;
          }
          if (containerCtx.nodeModulesVolume) {
            extraVolumeArgs.push("-v", `${containerCtx.nodeModulesVolume}:/app/node_modules:ro`);
          }
          if (
            containerCtx.networkMode &&
            !["default", "bridge", "none", "host"].includes(containerCtx.networkMode) &&
            !containerCtx.networkMode.startsWith("container:")
          ) {
            extraNetworkArgs.push("--network", containerCtx.networkMode);
          }
        }

        const resolvedImage =
          process.env.DOCKER_RUNNER_IMAGE ||
          (image === "node:22" && !hasLocalDockerImage("node:22") && containerCtx.selfImage
            ? containerCtx.selfImage
            : image);

        const envArgs = [];
        const baseUrl = mergedEnv.PLAYWRIGHT_BASE_URL || "http://host.docker.internal:4173";
        envArgs.push("-e", `PLAYWRIGHT_BASE_URL=${baseUrl}`);
        envArgs.push("-e", "PATH=/workspace/node_modules/.bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
        if (!isolatedEnv) {
          envArgs.push("-e", "NODE_PATH=/workspace/node_modules:/app/node_modules");
        }

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
          ...extraNetworkArgs,
          "--memory=2g",
          "--cpus=1.5",
          "--pids-limit=100",
          ...envArgs,
          "-v",
          `${hostWorkspacePath}:/workspace`,
          ...extraVolumeArgs,
          "-w",
          "/workspace",
          resolvedImage,
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
        const mode = useDocker ? "Docker" : "shell";
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

