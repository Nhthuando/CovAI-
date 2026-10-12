import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { dockerRunner } from "./dockerRunner.service.js";
import crypto from "node:crypto";
import { startFullSystem } from "./fullSystemLifecycle.service.js";
import { prepareSystemPlaywright } from "./systemTestEvidence.service.js";
import { ServiceError } from "../utils/serviceError.js";
import {
  prepareAutEnvironment,
  runSeedDataIfPresent,
  detectAutPort,
  resolveAvailableAutPort,
  startAutServer,
  stopAutServer,
} from "./autLifecycle.service.js";

const SYSTEM_TEST_TIMEOUT_MS = 10 * 60 * 1000;
const RUNNER_IMAGES = Object.freeze({
  playwright: process.env.PLAYWRIGHT_DOCKER_IMAGE || "mcr.microsoft.com/playwright:v1.52.0-jammy",
  cypress: process.env.CYPRESS_DOCKER_IMAGE || "cypress/browsers:node-22.14.0-chrome-131.0.6778.264-1-ff-133.0.3-edge-131.0.2903.86-1",
});

export const resolvePlaywrightCommand = (rootDir, command) => {
  const cli = path.join(rootDir, "node_modules", "playwright", "cli.js");
  if (!fs.existsSync(cli)) return command;
  return command.replace(/\bnpx(?: --yes)? playwright\b/g, `"${process.execPath}" "${cli}"`);
};

export const ensurePlaywrightPrerequisites = (rootDir, autPort) => {
  // 1. Ensure playwright config exists so page.goto('/') and baseURL work out of the box
  const configCandidates = [
    "playwright.config.js",
    "playwright.config.ts",
    "playwright.config.mjs",
    "playwright.config.cjs",
  ];
  const hasConfig = configCandidates.some((cfg) => fs.existsSync(path.join(rootDir, cfg)));
  if (!hasConfig) {
    const fallbackConfig = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/e2e/**/*.spec.*', '**/e2e/**/*.test.*', '**/system/**/*.spec.*', '**/system/**/*.test.*'],
  timeout: 30000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:${autPort}',
    headless: true,
  },
});
`;
    try {
      fs.writeFileSync(path.join(rootDir, "playwright.config.mjs"), fallbackConfig, "utf8");
    } catch (err) {
      console.warn(`[SystemTestRunner] Could not write fallback playwright.config.js: ${err.message}`);
    }
  }

  // 2. Ensure @playwright/test and playwright can be resolved in rootDir/node_modules
  const rootNodeModules = path.join(rootDir, "node_modules");
  const serverNodeModules = fileURLToPath(new URL("../../node_modules/", import.meta.url));

  const packagesToLink = ["@playwright/test", "playwright", "playwright-core"];
  for (const pkg of packagesToLink) {
    const targetInServer = path.join(serverNodeModules, pkg);
    const destInRoot = path.join(rootNodeModules, pkg);

    if (fs.existsSync(targetInServer) && !fs.existsSync(destInRoot)) {
      try {
        fs.mkdirSync(path.dirname(destInRoot), { recursive: true });
        fs.symlinkSync(targetInServer, destInRoot, "junction");
      } catch {
        // Fallback or ignore if already exists/linked
      }
    }
  }
};

export const resolveCypressCommand = (rootDir, command) => {
  const cli = path.join(rootDir, "node_modules", "cypress", "bin", "cypress");
  if (!fs.existsSync(cli)) return command;
  return command.replace(/\bnpx(?: --yes)? cypress\b/g, `"${process.execPath}" "${cli}"`);
};

export const ensureCypressPrerequisites = (rootDir, autPort) => {
  const configCandidates = [
    "cypress.config.js",
    "cypress.config.ts",
    "cypress.config.mjs",
    "cypress.config.cjs",
  ];
  const hasConfig = configCandidates.some((cfg) => fs.existsSync(path.join(rootDir, cfg)));
  if (!hasConfig) {
    const fallbackConfig = `const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:${autPort}',
    specPattern: 'cypress/e2e/**/*.{cy,spec}.{js,jsx,ts,tsx}',
    supportFile: false,
    video: false,
    screenshotOnRunFailure: true,
  },
});
`;
    try {
      fs.writeFileSync(path.join(rootDir, "cypress.config.js"), fallbackConfig, "utf8");
      fs.mkdirSync(path.join(rootDir, "cypress", "e2e"), { recursive: true });
    } catch (err) {
      console.warn(`[SystemTestRunner] Could not write fallback cypress.config.js: ${err.message}`);
    }
  }

  const rootNodeModules = path.join(rootDir, "node_modules");
  const serverNodeModules = fileURLToPath(new URL("../../node_modules/", import.meta.url));
  const packagesToLink = ["cypress"];
  for (const pkg of packagesToLink) {
    const targetInServer = path.join(serverNodeModules, pkg);
    const destInRoot = path.join(rootNodeModules, pkg);

    if (fs.existsSync(targetInServer) && !fs.existsSync(destInRoot)) {
      try {
        fs.mkdirSync(path.dirname(destInRoot), { recursive: true });
        fs.symlinkSync(targetInServer, destInRoot, "junction");
      } catch {
        // Fallback or ignore
      }
    }
  }
};

export const resolveFrontendAutDirectory = (rootDir) => {
  const candidates = ["client", "frontend", "web"].map((name) => path.join(rootDir, name));
  // Some imported monorepos select the backend package as their snapshot root.
  const parent = path.dirname(rootDir);
  if (["server", "backend", "api"].includes(path.basename(rootDir)) && fs.existsSync(path.join(parent, ".git"))) {
    candidates.push(...["client", "frontend", "web"].map((name) => path.join(parent, name)));
  }
  for (const directory of candidates) {
    const file = path.join(directory, "package.json");
    if (!fs.existsSync(file)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      const scripts = Object.values(pkg.scripts || {}).filter((value) => typeof value === "string").join(" ");
      if (/\b(vite|next|react-scripts|vue-cli-service|astro|nuxt)\b/.test(scripts)) {
        const real = fs.realpathSync(directory);
        const boundary = fs.realpathSync(directory.startsWith(rootDir + path.sep) ? rootDir : parent);
        const relative = path.relative(boundary, real);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new ServiceError("Frontend directory must remain inside the imported repository", 422);
        }
        return directory;
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      // Ignore malformed package metadata while searching other app directories.
    }
  }
  return rootDir;
};

export const runSystemTests = async ({ jobId, rootDir, execution, onReady, onPreparing, executionMode = "frontend" }) => {
  if (executionMode === "full") {
    if (execution.runner === "playwright") {
      const stack = await startFullSystem({rootDir,jobId,onProgress:onPreparing});
      try {
        const runnerRoot=execution.rootDir || rootDir;
        ensurePlaywrightPrerequisites(runnerRoot,stack.frontendPort);
        const managed=prepareSystemPlaywright({rootDir:runnerRoot,execution,executionMode,backendUrl:stack.backendUrl,frontendPort:stack.frontendPort,runKey:crypto.randomUUID(),testFile:execution.testFile});
        await onReady?.();
        const result=await dockerRunner.run({snapshotPath:runnerRoot,command:resolvePlaywrightCommand(runnerRoot,managed.command),timeoutMs:SYSTEM_TEST_TIMEOUT_MS,jobId,forceHost:true,env:{PLAYWRIGHT_BASE_URL:`http://127.0.0.1:${stack.frontendPort}`}});
        return {...result,reportPath:managed.reportPath,autPort:stack.frontendPort,executionMode};
      } finally {await stack.cleanup();}
    } else if (execution.runner === "cypress") {
      const stack = await startFullSystem({rootDir,jobId});
      try {
        const runnerRoot = execution.rootDir || rootDir;
        ensureCypressPrerequisites(runnerRoot, stack.frontendPort);
        await onReady?.();
        const cmd = execution.command;
        const result = await dockerRunner.run({
          snapshotPath: runnerRoot,
          command: resolveCypressCommand(runnerRoot, cmd),
          timeoutMs: SYSTEM_TEST_TIMEOUT_MS,
          jobId,
          image: RUNNER_IMAGES.cypress,
          forceHost: true,
          env: {
            CYPRESS_BASE_URL: `http://127.0.0.1:${stack.frontendPort}`,
          },
        });
        return { ...result, reportPath: execution.reportPath, autPort: stack.frontendPort, executionMode };
      } finally { await stack.cleanup(); }
    } else {
      throw new Error(`Unsupported full-system runner: ${execution.runner}`);
    }
  }
  rootDir = execution.rootDir || rootDir;
  fs.mkdirSync(execution.reportDirectory, { recursive: true });
  if (execution.reportPath && fs.existsSync(execution.reportPath)) {
    fs.unlinkSync(execution.reportPath);
  }

  const configFile = execution.configPath ? path.join(rootDir, execution.configPath) : null;
  const ownsWebServer = execution.runner === "playwright" && configFile && /\bwebServer\s*:/.test(fs.readFileSync(configFile, "utf8"));
  const autRoot = resolveFrontendAutDirectory(rootDir);
  const autPort = ownsWebServer ? detectAutPort(autRoot, 4173) : await resolveAvailableAutPort(autRoot, 4173);

  // 1. Prepare minimal mock .env if needed
  await prepareAutEnvironment(autRoot, autPort, jobId);

  // 2. Execute seed data if configured
  await runSeedDataIfPresent({ snapshotDir: autRoot, jobId });

  // 4. Start AUT server & 2-tier healthcheck
  let autHandle = null;
  try {
    if (!ownsWebServer) {
      autHandle = await startAutServer({ snapshotDir: autRoot, port: autPort, jobId, requireHealthy: true });
      if (!autHandle?.started) throw new ServiceError("Frontend server could not be started for system tests", 422);
    }

    if (execution.runner === "playwright") {
      ensurePlaywrightPrerequisites(rootDir, autPort);
    } else if (execution.runner === "cypress") {
      ensureCypressPrerequisites(rootDir, autPort);
    }

    let command = execution.command;
    if (configFile && autHandle?.started && execution.runner === "playwright") {
      const wrapperPath = path.join(execution.reportDirectory, "playwright.config.mjs");
      const baseURL = `http://localhost:${autPort}`;
      fs.writeFileSync(wrapperPath, `import config from ${JSON.stringify(pathToFileURL(configFile).href)};
import path from 'node:path';
const root = ${JSON.stringify(path.dirname(configFile))};
const use = {...config.use, baseURL: ${JSON.stringify(baseURL)}};
export default {...config, testDir: path.resolve(root, config.testDir || '.'), webServer: undefined, use,
  projects: config.projects?.map(project => ({...project, testDir: path.resolve(root, project.testDir || config.testDir || '.'), use: {...use, ...project.use, baseURL: ${JSON.stringify(baseURL)}}}))};`, "utf8");
      command = command.replace(/ --config(?:=|\s+)(?:"[^"]*"|\S+)/g, "");
      const redirection = command.indexOf(" > ");
      const configArg = ` --config="${path.relative(rootDir, wrapperPath).replace(/\\/g, "/")}"`;
      command = redirection < 0 ? command + configArg : command.slice(0, redirection) + configArg + command.slice(redirection);
    }

    const serverNodeModules = fileURLToPath(new URL("../../node_modules/", import.meta.url));
    const nodePath = [
      serverNodeModules,
      path.join(rootDir, "node_modules"),
      path.join(rootDir, "client", "node_modules"),
      path.join(rootDir, "server", "node_modules"),
    ].filter((p) => fs.existsSync(p)).join(path.delimiter);

    await onReady?.();

    let managed = null;
    if (execution.runner === "playwright" && execution.testDirectory && autHandle?.started) {
      managed = prepareSystemPlaywright({rootDir,execution,executionMode,frontendPort:autPort,runKey:crypto.randomUUID(),testFile:execution.testFile});
      command = managed.command;
    }

    const finalCommand = execution.runner === "playwright"
      ? resolvePlaywrightCommand(rootDir, command)
      : resolveCypressCommand(rootDir, command);

    const result = await dockerRunner.run({
      snapshotPath: rootDir,
      command: finalCommand,
      timeoutMs: SYSTEM_TEST_TIMEOUT_MS,
      jobId,
      image: RUNNER_IMAGES[execution.runner],
      forceHost: true,
      env: {
        NODE_PATH: nodePath,
        PLAYWRIGHT_BASE_URL: `http://localhost:${autPort}`,
        CYPRESS_BASE_URL: `http://localhost:${autPort}`,
      },
    });
    return { ...result, autPort, ...(managed ? {reportPath:managed.reportPath} : {}), executionMode };
  } finally {
    // 4. Safely terminate AUT server and release port
    if (autHandle?.started && autHandle?.pid) {
      await stopAutServer(autHandle.pid, autHandle.port, jobId);
    }
  }
};
