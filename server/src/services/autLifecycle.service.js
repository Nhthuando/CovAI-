import fs from "fs";
import path from "path";
import net from "net";
import http from "http";
import { spawn, spawnSync } from "child_process";
import treeKill from "tree-kill";
import { addJobLog } from "./job.service.js";

const safeAddJobLog = async (jobId, level, message) => {
  if (!jobId) return;
  try {
    await addJobLog(jobId, level, message);
  } catch {
    // Ignore logging failures
  }
};

/**
 * Checks whether a given TCP port is actively accepting connections.
 */
const checkSingleHost = (port, host, timeoutMs) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
};

/**
 * Checks whether a given TCP port is actively accepting connections.
 * Checks both localhost and 127.0.0.1 to handle dual-stack (IPv4 / IPv6) on modern Node.
 */
export const isPortInUse = async (port, host = "localhost", timeoutMs = 1000) => {
  if (host === "localhost" || host === "127.0.0.1") {
    const inUseLocal = await checkSingleHost(port, "localhost", timeoutMs);
    if (inUseLocal) return true;
    return await checkSingleHost(port, "127.0.0.1", timeoutMs);
  }
  return checkSingleHost(port, host, timeoutMs);
};

/**
 * Tầng 1: Socket Check.
 * Polls the port until it opens or times out.
 */
export const waitForPortOpen = async (port, timeoutMs = 45000, host = "localhost", intervalMs = 500, isExited = () => false) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isExited()) throw new Error('AUT process exited before opening its port');
    const inUse = await isPortInUse(port, host);
    if (inUse) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`[AUT Healthcheck] Port ${port} did not open within ${timeoutMs / 1000}s`);
};

/**
 * Tầng 2: HTTP Verification.
 * Sends a GET request to verify server responsiveness.
 */
export const verifyHttpHealth = (port, pathName = "/", host = "127.0.0.1", timeoutMs = 5000) => {
  return new Promise((resolve) => {
    let timer;
    const finish = result => { clearTimeout(timer); resolve(result); };
    const req = http.get(
      {
        host,
        port,
        path: pathName,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        const status = res.statusCode || 200;
        if (status >= 200 && status < 500) {
          finish({ healthy: true, status });
        } else {
          finish({ healthy: false, status, warning: true });
        }
      }
    );

    // Bound wall-clock time even if the socket stays active without response headers.
    timer = setTimeout(() => {
      finish({ healthy: false, status: 0, error: "HTTP probe timeout" });
      req.destroy();
    }, timeoutMs);
    req.once("timeout", () => {
      req.destroy();
      finish({ healthy: false, status: 0, error: "HTTP probe timeout" });
    });

    req.once("error", (err) => {
      finish({ healthy: false, status: 0, error: err.message });
    });
  });
};

/** Wait for HTTP readiness after the port opens (dev servers may still be compiling). */
export const waitForHttpHealthy = async ({
  port, healthPath = "/", timeoutMs = 45000, intervalMs = 500,
  probeTimeoutMs = 5000, isExited = () => false, onRetry = async () => {},
}) => {
  const deadline = Date.now() + timeoutMs;
  let result = { healthy: false, status: 0, error: "HTTP readiness timeout" };
  let attempts = 0;
  while (Date.now() < deadline) {
    if (isExited()) throw new Error(`AUT process exited before HTTP readiness at http://127.0.0.1:${port}${healthPath}`);
    result = await verifyHttpHealth(port, healthPath, "127.0.0.1", Math.max(1, Math.min(probeTimeoutMs, deadline - Date.now())));
    if (isExited()) throw new Error(`AUT process exited before HTTP readiness at http://127.0.0.1:${port}${healthPath}`);
    if (result.healthy && result.status < 400) return result;
    if (result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status)) break;
    if (attempts++ === 0) await onRetry(result);
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  throw new Error(`AUT healthcheck ${healthPath} at http://127.0.0.1:${port} failed with status ${result.status}${result.error ? ` (${result.error})` : ""} within ${timeoutMs}ms`);
};

/**
 * Automatically detects the port configured in playwright.config or cypress.config,
 * falling back to the default port (4173).
 */
export const detectAutPort = (snapshotDir, defaultPort = 4173) => {
  const candidateDirs = ["", "client", "frontend", "web", "ui", "app"];
  const playwrightConfigs = [
    "playwright.config.js",
    "playwright.config.ts",
    "playwright.config.mjs",
    "playwright.config.cjs",
  ];
  const cypressConfigs = [
    "cypress.config.js",
    "cypress.config.ts",
    "cypress.config.mjs",
    "cypress.config.cjs",
  ];

  for (const cand of candidateDirs) {
    const candidatePath = cand ? path.join(snapshotDir, cand) : snapshotDir;

    for (const cfg of playwrightConfigs) {
      const fullPath = path.join(candidatePath, cfg);
      if (fs.existsSync(fullPath)) {
        try {
          const text = fs.readFileSync(fullPath, "utf8");
          const portMatch = text.match(/port:\s*(\d{4,5})/);
          if (portMatch) return parseInt(portMatch[1], 10);
          const urlMatch = text.match(/baseURL:\s*['"]https?:\/\/[^:]+:(\d{4,5})/);
          if (urlMatch) return parseInt(urlMatch[1], 10);
        } catch {
          // Ignore read errors
        }
      }
    }

    for (const cfg of cypressConfigs) {
      const fullPath = path.join(candidatePath, cfg);
      if (fs.existsSync(fullPath)) {
        try {
          const text = fs.readFileSync(fullPath, "utf8");
          const urlMatch = text.match(/baseUrl:\s*['"]https?:\/\/[^:]+:(\d{4,5})/);
          if (urlMatch) return parseInt(urlMatch[1], 10);
        } catch {
          // Ignore read errors
        }
      }
    }

    const viteConfigs = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.cjs"];
    for (const vc of viteConfigs) {
      if (fs.existsSync(path.join(candidatePath, vc))) {
        return 5173;
      }
    }
  }

  return defaultPort;
};

/**
 * Finds an available TCP port starting from the detected or default port.
 * Avoids colliding with host processes (e.g. CovAI dev server on 5173).
 */
export const resolveAvailableAutPort = async (snapshotDir, defaultPort = 4173) => {
  let preferredPort = detectAutPort(snapshotDir, defaultPort);
  while (await isPortInUse(preferredPort)) {
    preferredPort += 1;
  }
  return preferredPort;
};

/**
 * Prepares a minimal mock .env file if none exists in snapshotDir.
 */
export const prepareAutEnvironment = async (snapshotDir, port = 4173, jobId = null) => {
  const envPath = path.join(snapshotDir, ".env");
  if (fs.existsSync(envPath)) {
    return { created: false, path: envPath };
  }

  const defaultVars = {
    PORT: String(port),
    NODE_ENV: "test",
    JWT_SECRET: "covai_test_mock_jwt_secret",
  };

  const candidateTemplates = [".env.example", ".env.test", ".env.sample"];
  const foundTemplate = candidateTemplates.find((name) =>
    fs.existsSync(path.join(snapshotDir, name))
  );

  const finalVars = { ...defaultVars };

  if (foundTemplate) {
    try {
      const content = fs.readFileSync(path.join(snapshotDir, foundTemplate), "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (match) {
          const key = match[1];
          const val = match[2].trim();
          if (!(key in finalVars)) {
            if (val && !val.includes("your-") && !val.includes("changeme") && !val.includes("xxx")) {
              finalVars[key] = val;
            } else if (key.includes("DB") || key.includes("DATABASE")) {
              finalVars[key] = "postgresql://postgres:postgres@localhost:5432/covai_mock_test";
            } else if (key.includes("URL")) {
              finalVars[key] = `http://localhost:${port}`;
            } else if (key.includes("PORT")) {
            } else if (key.includes("SECRET") || key.includes("KEY") || key.includes("TOKEN")) {
              finalVars[key] = "covai_mock_secret_key";
            } else {
              finalVars[key] = "mock_value";
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[AUT Environment] Failed to read template ${foundTemplate}:`, err.message);
    }
  }

  const fileLines = Object.entries(finalVars).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, fileLines.join("\n") + "\n", "utf8");

  await safeAddJobLog(jobId, "INFO", `[AUT Environment] Generated minimal mock .env for AUT on port ${port}`);

  return { created: true, path: envPath, vars: finalVars };
};

/**
 * Runs seed data script if defined in package.json (seed or db:seed).
 */
export const runSeedDataIfPresent = async ({ snapshotDir, jobId = null }) => {
  const candidateDirs = ["", "server", "backend", "api", "client", "frontend"];
  let chosenDir = null;
  let seedScript = null;

  for (const cand of candidateDirs) {
    const targetDir = cand ? path.join(snapshotDir, cand) : snapshotDir;
    const pkgPath = path.join(targetDir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts || {};
      const script = typeof scripts.seed === "string" ? "seed" : typeof scripts["db:seed"] === "string" ? "db:seed" : null;
      if (script) {
        chosenDir = targetDir;
        seedScript = script;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!seedScript || !chosenDir) return { executed: false };

  await safeAddJobLog(jobId, "INFO", `[AUT Seed] Found seed script '${seedScript}'. Executing seed data...`);

  try {
    const result = spawnSync(`npm run ${seedScript}`, {
      shell: true,
      cwd: chosenDir,
      timeout: 30000,
      env: { ...process.env, NODE_ENV: "test" },
    });

    if (result.status === 0) {
      await safeAddJobLog(jobId, "INFO", `[AUT Seed] Seed data completed successfully.`);
      return { executed: true, success: true, script: seedScript };
    } else {
      await safeAddJobLog(jobId, "WARN", `[AUT Seed] Seed script exited with code ${result.status}, continuing test run.`);
      return { executed: true, success: false, script: seedScript };
    }
  } catch (error) {
    await safeAddJobLog(jobId, "WARN", `[AUT Seed] Seed execution error: ${error.message}, continuing test run.`);
    return { executed: true, success: false, error: error.message };
  }
};

/**
 * Starts the application under test (AUT) web server and performs 2-tier healthcheck.
 */
export const startAutServer = async ({ snapshotDir, port = 4173, jobId = null, healthTimeoutMs = 45000, env = {}, healthPath = "/", requireHealthy = false, preferStart = false, signal }) => {
  if (signal?.aborted) throw new ServiceError('AUT startup canceled',409);
  const candidateDirs = ["", "client", "frontend", "web", "ui", "app"];
  let chosenDir = null;
  let command = null;

  for (const cand of candidateDirs) {
    const targetDir = cand ? path.join(snapshotDir, cand) : snapshotDir;
    const pkgPath = path.join(targetDir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      continue;
    }

    const scripts = pkg.scripts || {};
    let cmd = null;
    if (preferStart && typeof scripts.start === "string") cmd = "npm run start";
    else if (typeof scripts.dev === "string") cmd = "npm run dev";
    else if (typeof scripts.preview === "string") cmd = "npm run preview";
    else if (typeof scripts.start === "string") cmd = "npm run start";

    if (cmd) {
      chosenDir = targetDir;
      command = cmd;
      break;
    }
  }

  if (!command || !chosenDir) {
    await safeAddJobLog(jobId, "INFO", "[AUT Lifecycle] No web server script found in package.json (static/mock mode).");
    return { started: false, port };
  }

  // If running Vite, pass --port explicitly so Vite never defaults to 5173 when a custom port is given
  const isVite = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.cjs"].some((vc) =>
    fs.existsSync(path.join(chosenDir, vc))
  );
  if (isVite && !command.includes("--port")) {
    command = `${command} -- --port ${port} --strictPort --host 127.0.0.1`;
  }

  const dirLabel = chosenDir === snapshotDir ? "root" : path.relative(snapshotDir, chosenDir).replace(/\\/g, "/");

  // Ensure node_modules exists in chosenDir before executing server scripts (e.g. vite, express)
  const nodeModulesPath = path.join(chosenDir, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    await safeAddJobLog(jobId, "INFO", `[AUT Lifecycle] Installing dependencies in ${dirLabel} before starting AUT...`);
    try {
      spawnSync("npm install --prefer-offline --no-audit --no-fund", {
        shell: true,
        cwd: chosenDir,
        timeout: 90000,
        env: { ...process.env, NODE_ENV: "development" },
      });
    } catch (installErr) {
      await safeAddJobLog(jobId, "WARN", `[AUT Lifecycle] Failed to install dependencies in ${dirLabel}: ${installErr.message}`);
    }
  }

  await safeAddJobLog(jobId, "INFO", `[AUT Lifecycle] Starting AUT server (Command: "${command}" in ${dirLabel}) on port ${port}...`);

  const child = spawn(command, {
    shell: true,
    windowsHide: true,
    cwd: chosenDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const abortAut = () => { stopAutServer(child.pid,port,jobId).catch(()=>{}); };
  signal?.addEventListener('abort',abortAut,{once:true});
  child.once('close',()=>signal?.removeEventListener('abort',abortAut));
  if(signal?.aborted) abortAut();

  let stderrBuffer = "";
  let stdoutBuffer = "";
  child.stdout?.on("data", chunk => { stdoutBuffer = (stdoutBuffer + chunk.toString()).slice(-16000); });
  child.once("error", (error) => {
    stderrBuffer += error.message;
    serverExited = true;
  });
  child.stderr?.on("data", (chunk) => {
    stderrBuffer = (stderrBuffer + chunk.toString()).slice(-16000);
  });

  let serverExited = false;
  let exitCode = null;
  child.once("exit", (code) => {
    serverExited = true;
    exitCode = code;
  });

  // Tầng 1: Socket Check (polling waitForPortOpen)
  const readinessDeadline = Date.now() + healthTimeoutMs;
  try {
    await waitForPortOpen(port, healthTimeoutMs, "127.0.0.1", 500, () => serverExited);
  } catch (error) {
    await stopAutServer(child.pid, port, jobId);
    if (serverExited) {
      const details = formatAutStartupFailure(stderrBuffer || stdoutBuffer, env);
      const msg = `AUT server process exited prematurely with code ${exitCode}.${details ? ` Details: ${details}` : ""}`;
      await safeAddJobLog(jobId, "ERROR", `[AUT Lifecycle] ${msg}`);
      throw new Error(msg);
    }
    throw error;
  }

  // Tầng 2: HTTP Verification
  let httpResult;
  try {
    httpResult = requireHealthy
      ? await waitForHttpHealthy({
          port, healthPath, timeoutMs: Math.max(1, readinessDeadline - Date.now()),
          isExited: () => serverExited,
          onRetry: result => safeAddJobLog(jobId, "INFO", `[AUT Healthcheck] Port ${port} is open; waiting for HTTP readiness (${result.error || `HTTP ${result.status}`})...`),
        })
      : await verifyHttpHealth(port, healthPath, "127.0.0.1", 5000);
  } catch (error) {
    await stopAutServer(child.pid, port, jobId);
    await safeAddJobLog(jobId, "ERROR", `[AUT Healthcheck] ${error.message}`);
    throw error;
  }
  if (httpResult.healthy && httpResult.status >= 200 && httpResult.status < 500) {
    await safeAddJobLog(jobId, "INFO", `[AUT Healthcheck] Successfully connected to http://localhost:${port} with status ${httpResult.status}`);
  } else if (httpResult.status >= 500 && httpResult.status <= 504) {
    await safeAddJobLog(jobId, "WARN", `WARN: AUT server responded with HTTP ${httpResult.status}. Backend dependencies or database might be uninitialized.`);
  } else {
    await safeAddJobLog(jobId, "WARN", `[AUT Healthcheck] HTTP verification completed with status ${httpResult.status || httpResult.error || "unknown"}`);
  }

  return {
    started: true,
    process: child,
    pid: child.pid,
    port,
    command,
    httpStatus: httpResult.status,
  };
};

export const formatAutStartupFailure = (output, env = {}) => {
  let clean = output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  for (const [key, value] of Object.entries({...process.env, ...env})) {
    if (value && /PASSWORD|SECRET|TOKEN|KEY|URL/i.test(key)) clean = clean.replaceAll(value, '[redacted]');
  }
  clean = clean.replace(/(?:mysql|postgres(?:ql)?):\/\/[^\s'"`]+/gi, '[redacted database URL]');
  if (/Neither apiKey nor config.authenticator provided/.test(clean)) {
    return 'Stripe could not start because its test API key is missing. Set STRIPE_SECRET_KEY to a Stripe test key in the backend .env.test file and retry Full Stack. Choose Frontend Dev Server to test the UI without the payment service.';
  }
  const error = clean.search(/(?:^|\n)(?:Error|\w+Error)(?:\s*\[[^\]]+\])?:/);
  return (error >= 0 ? clean.slice(error).trim() : clean).slice(0, 2000);
};

/**
 * Shuts down the AUT web server process tree cleanly using tree-kill.
 */
export const stopAutServer = async (pid, port = null, jobId = null) => {
  if (!pid) return;

  await new Promise((resolve) => {
    treeKill(pid, "SIGKILL", (err) => {
      if (err) {
        console.warn(`[AUT Lifecycle] Process tree cleanup failed for PID ${pid}: ${err.message}`);
      }
      resolve();
    });
  });

  // Brief pause to allow OS socket cleanup
  await new Promise((resolve) => setTimeout(resolve, 500));

  await safeAddJobLog(jobId, "INFO", `[AUT Lifecycle] Stopped AUT server (PID ${pid}) on port ${port || "4173"}.`);
};
