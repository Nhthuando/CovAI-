import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";

const PLAYWRIGHT_CONFIGS = [
  "playwright.config.js",
  "playwright.config.ts",
  "playwright.config.mjs",
  "playwright.config.cjs",
];
const CYPRESS_CONFIGS = [
  "cypress.config.js",
  "cypress.config.ts",
  "cypress.config.mjs",
  "cypress.config.cjs",
];
const SCRIPT_NAMES = {
  playwright: ["test:e2e:playwright", "test:e2e"],
  cypress: ["test:e2e:cypress", "test:e2e"],
};

const quoteForShell = (value) => `"${String(value).replace(/"/g, '\\"')}"`;

const readPackageJson = (rootDir) => {
  const packagePath = path.join(rootDir, "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new ServiceError("System tests require a package.json file", 422);
  }

  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (error) {
    throw new ServiceError(`Unable to read package.json: ${error.message}`, 422);
  }
};

const findConfig = (rootDir, names) => {
  const name = names.find((candidate) => fs.existsSync(path.join(rootDir, candidate)));
  return name ? path.join(rootDir, name) : null;
};

const findExplicitScript = (scripts, runner) => {
  for (const name of SCRIPT_NAMES[runner]) {
    if (typeof scripts?.[name] === "string" && scripts[name].trim()) {
      return { name, command: `npm run --silent ${name}` };
    }
  }
  return null;
};

const hasPlaywrightWebServer = (configPath) =>
  Boolean(configPath && /\bwebServer\b/.test(fs.readFileSync(configPath, "utf8")));

const buildCommand = ({ runner, command, configPath, rootDir }) => {
  const reportDirectory = path.join(rootDir, ".covai-system-test");
  const reportPath = path.join(reportDirectory, `${runner}-results.json`);
  const relativeReportPath = path.relative(rootDir, reportPath).replace(/\\/g, "/");
  const reporterArgs = runner === "playwright" ? "--reporter=json" : "--reporter json";
  const base = command
    ? `${command} -- ${reporterArgs}`
    : `npx playwright test --config ${quoteForShell(path.relative(rootDir, configPath))} ${reporterArgs}`;

  return {
    command: `${base} > ${quoteForShell(relativeReportPath)}`,
    configPath: configPath ? path.relative(rootDir, configPath).replace(/\\/g, "/") : null,
    reportPath,
    reportDirectory,
    coverageDir: path.join(rootDir, "coverage"),
  };
};

const detectCandidates = (rootDir) => {
  const pkg = readPackageJson(rootDir);
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};
  const candidates = [];

  if (dependencies["@playwright/test"]) {
    const configPath = findConfig(rootDir, PLAYWRIGHT_CONFIGS);
    const script = findExplicitScript(scripts, "playwright");
    if (script || hasPlaywrightWebServer(configPath)) {
      candidates.push({
        runner: "playwright",
        command: script?.command || null,
        configPath,
      });
    }
  }

  // Cypress has no configuration field that starts the application. To avoid
  // guessing a server command, it is executable only through a nominated script.
  if (dependencies.cypress) {
    const configPath = findConfig(rootDir, CYPRESS_CONFIGS);
    const script = findExplicitScript(scripts, "cypress");
    if (script) {
      candidates.push({ runner: "cypress", command: script.command, configPath });
    }
  }

  return candidates;
};

export const resolveSystemTestExecution = ({ rootDir, runner = null }) => {
  if (!rootDir || typeof rootDir !== "string") {
    throw new ServiceError("Snapshot root directory is required", 422);
  }
  if (runner !== null && !["playwright", "cypress"].includes(runner)) {
    throw new ServiceError("runner must be playwright or cypress", 400);
  }

  const candidates = detectCandidates(rootDir);
  let selected;
  if (runner) {
    selected = candidates.find((candidate) => candidate.runner === runner);
    if (!selected) {
      throw new ServiceError(
        `No executable ${runner} configuration was found. Configure an explicit E2E script or Playwright webServer.`,
        422,
      );
    }
  } else if (candidates.length === 1) {
    [selected] = candidates;
  } else if (candidates.length === 0) {
    throw new ServiceError(
      "No executable Playwright or Cypress configuration was found. CovAI will not guess an application start command.",
      422,
    );
  } else {
    throw new ServiceError(
      "Multiple E2E runners are configured. Select playwright or cypress explicitly.",
      409,
    );
  }

  return {
    runner: selected.runner,
    ...buildCommand({ ...selected, rootDir }),
  };
};
