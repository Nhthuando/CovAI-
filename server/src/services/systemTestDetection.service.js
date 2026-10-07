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
  const candidates = [
    path.join(rootDir, "package.json"),
    path.join(rootDir, "client", "package.json"),
    path.join(rootDir, "server", "package.json"),
    path.join(rootDir, "frontend", "package.json"),
    path.join(rootDir, "backend", "package.json"),
  ];

  for (const packagePath of candidates) {
    if (fs.existsSync(packagePath)) {
      try {
        return JSON.parse(fs.readFileSync(packagePath, "utf8"));
      } catch (error) {
        throw new ServiceError(`Unable to read package.json at ${packagePath}: ${error.message}`, 422);
      }
    }
  }

  throw new ServiceError("System tests require a package.json file", 422);
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

const COMMON_TEST_DIRS = {
  playwright: ["tests/e2e", "e2e", "tests/system", "tests"],
  cypress: ["cypress/e2e", "cypress"],
};

export const findTestDirectory = (rootDir, runner = "playwright") => {
  const preferred = COMMON_TEST_DIRS[runner] || COMMON_TEST_DIRS.playwright;
  for (const candidate of preferred) {
    const fullPath = path.join(rootDir, candidate);
    if (fs.existsSync(fullPath)) {
      try {
        if (fs.statSync(fullPath).isDirectory()) {
          return candidate;
        }
      } catch {
        // ignore access errors
      }
    }
  }
  return null;
};

const hasPlaywrightWebServer = (configPath) =>
  Boolean(configPath && /\bwebServer\b/.test(fs.readFileSync(configPath, "utf8")));

const buildCommand = ({ runner, command, configPath, rootDir, testDirectory }) => {
  const reportDirectory = path.join(rootDir, ".covai-system-test");
  const reportPath = path.join(reportDirectory, `${runner}-results.json`);
  const relativeReportPath = path.relative(rootDir, reportPath).replace(/\\/g, "/");
  const retryArg = runner === "playwright" && !(command || "").includes("--retries") ? " --retries=1" : "";
  const reporterArgs = runner === "playwright" ? `--reporter=json${retryArg}` : "--reporter json";

  let base;
  if (command) {
    base = `${command} -- ${reporterArgs}`;
  } else if (runner === "playwright") {
    const configArg = configPath
      ? ` --config ${quoteForShell(path.relative(rootDir, configPath).replace(/\\/g, "/"))}`
      : "";
    base = `npx playwright test${configArg} ${reporterArgs}`;
  } else {
    const configArg = configPath
      ? ` --config-file ${quoteForShell(path.relative(rootDir, configPath).replace(/\\/g, "/"))}`
      : "";
    base = `npx cypress run${configArg} ${reporterArgs}`;
  }

  return {
    command: `${base} > ${quoteForShell(relativeReportPath)}`,
    configPath: configPath ? path.relative(rootDir, configPath).replace(/\\/g, "/") : null,
    testDirectory: testDirectory || null,
    reportPath,
    reportDirectory,
    coverageDir: path.join(rootDir, "coverage"),
  };
};

const detectAtRoot = (rootDir) => {
  const pkg = readPackageJson(rootDir);
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};
  const candidates = [];

  const hasPlaywrightPkg = Boolean(dependencies["@playwright/test"] || dependencies.playwright);
  const playwrightConfig = findConfig(rootDir, PLAYWRIGHT_CONFIGS);
  const playwrightTestDir = findTestDirectory(rootDir, "playwright");
  const hasPlaywrightFiles = Boolean(
    playwrightTestDir &&
      fs.existsSync(path.join(rootDir, playwrightTestDir)) &&
      playwrightTestDir !== "tests"
  );

  if (hasPlaywrightPkg || playwrightConfig || hasPlaywrightFiles) {
    const script = findExplicitScript(scripts, "playwright");
    candidates.push({
      runner: "playwright",
      command: script?.command || null,
      configPath: playwrightConfig,
    });
  }

  const hasCypressPkg = Boolean(dependencies.cypress);
  const cypressConfig = findConfig(rootDir, CYPRESS_CONFIGS);
  const cypressTestDir = findTestDirectory(rootDir, "cypress");
  const hasCypressFiles = Boolean(
    cypressTestDir &&
      fs.existsSync(path.join(rootDir, cypressTestDir)) &&
      fs.readdirSync(path.join(rootDir, cypressTestDir)).some((f) => /\.(cy|spec|test)\.(js|ts)$/.test(f))
  );

  if (hasCypressPkg || cypressConfig || hasCypressFiles) {
    const script = findExplicitScript(scripts, "cypress");
    candidates.push({
      runner: "cypress",
      command: script?.command || null,
      configPath: cypressConfig,
    });
  }

  return candidates;
};

const detectCandidates = (rootDir) => {
  const roots = ["", "client", "frontend", "web", "server", "backend"];
  const candidates = [];
  for (const directory of roots) {
    const candidateRoot = path.join(rootDir, directory);
    if (!fs.existsSync(path.join(candidateRoot, "package.json"))) continue;
    for (const candidate of detectAtRoot(candidateRoot)) {
      if (!candidates.some((item) => item.runner === candidate.runner)) {
        candidates.push({ ...candidate, rootDir: candidateRoot });
      }
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
      const testDir = findTestDirectory(rootDir, runner);
      if (testDir && testDir !== "tests") {
        selected = { runner, command: null, configPath: null };
      } else {
        throw new ServiceError(
          `No executable ${runner} configuration was found. Configure an explicit E2E script or install ${runner}.`,
          422,
        );
      }
    }
  } else if (candidates.length === 1) {
    [selected] = candidates;
  } else if (candidates.length === 0) {
    const testDir = findTestDirectory(rootDir, "playwright");
    if (testDir && testDir !== "tests") {
      selected = { runner: "playwright", command: null, configPath: null };
    } else {
      throw new ServiceError(
        "No executable Playwright or Cypress configuration was found. CovAI will not guess an application start command.",
        422,
      );
    }
  } else {
    throw new ServiceError(
      "Multiple E2E runners are configured. Select playwright or cypress explicitly.",
      409,
    );
  }

  const executionRoot = selected.rootDir || rootDir;
  const testDirectory = findTestDirectory(executionRoot, selected.runner);

  return {
    runner: selected.runner,
    rootDir: executionRoot,
    ...buildCommand({ ...selected, rootDir: executionRoot, testDirectory }),
  };
};
