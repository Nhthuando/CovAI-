import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";
import { normalizeDiskPath } from "../utils/snapshotWorkspace.js";
import { scanSystemTestFiles } from "../utils/testFileParser.js";

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
const PLAYWRIGHT_WORD = /playwright/i;
const CYPRESS_WORD = /cypress|\bcy:/i;
const RUNNER_SCRIPTS = {
  playwright: /\bplaywright\s+test(?=\s|$|[;&|])/i,
  cypress: /\bcypress\s+run(?=\s|$|[;&|])/i,
};

const quoteForShell = (value) => `"${String(value).replace(/"/g, '\\"')}"`;

const readPackageJson = (rootDir) => {
  const packagePath = path.join(rootDir, "package.json");
  if (!fs.existsSync(packagePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (error) {
    throw new ServiceError(`Unable to read package.json at ${packagePath}: ${error.message}`, 422);
  }
};

const findConfig = (rootDir, names) => {
  const name = names.find((candidate) => fs.existsSync(path.join(rootDir, candidate)));
  return name ? path.join(rootDir, name) : null;
};

const findExplicitScript = (scripts, runner) => {
  const preferredNames = SCRIPT_NAMES[runner];
  const [runnerWord, otherWord] = runner === "playwright"
    ? [PLAYWRIGHT_WORD, CYPRESS_WORD]
    : [CYPRESS_WORD, PLAYWRIGHT_WORD];
  const name = preferredNames.find(preferredName => {
    const script = scripts[preferredName];
    return typeof script === "string" && (!otherWord.test(script) || runnerWord.test(script));
  }) ?? Object.keys(scripts).find(scriptName => {
    const script = scripts[scriptName];
    return !preferredNames.includes(scriptName) && /^\w[\w:.-]*$/.test(scriptName) &&
      typeof script === "string" && RUNNER_SCRIPTS[runner].test(script);
  });
  if (name) {
    return { name, command: `npm run --silent ${name}` };
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

const detectCandidates = (rootDir, requestedRunner) => {
  const packageDirs = ["client", "frontend", "web", "server", "backend"]
    .filter(directory => fs.existsSync(path.join(rootDir, directory, "package.json")));
  const { playwrightFiles, cypressFiles } = scanSystemTestFiles(rootDir);
  const runners = [
    ["playwright", PLAYWRIGHT_CONFIGS, playwrightFiles],
    ["cypress", CYPRESS_CONFIGS, cypressFiles],
  ];
  const packages = ["", ...packageDirs].map(directory => {
    const candidateRoot = path.join(rootDir, directory);
    return { directory, candidateRoot, packageJson: readPackageJson(candidateRoot) };
  });
  const candidates = [];
  for (const { directory, candidateRoot, packageJson: { scripts } } of packages) {
    for (const [runner, configs, files] of runners) {
      if (candidates.some(item => item.runner === runner)) continue;
      const configPath = findConfig(candidateRoot, configs);
      const script = findExplicitScript(scripts || {}, runner);
      const hasFiles = files.some(file =>
        (packageDirs.find(dir => file.filePath.startsWith(dir + "/")) ?? "") === directory,
      );
      if (configPath || script || hasFiles) {
        candidates.push({ runner, command: script?.command || null, configPath, rootDir: candidateRoot });
      }
    }
  }
  if (candidates.length === 0 || (requestedRunner && !candidates.some(item => item.runner === requestedRunner))) {
    const dependencyRoots = new Map();
    for (const { candidateRoot, packageJson: { dependencies, devDependencies } } of packages) {
      const names = Object.keys({ ...dependencies, ...devDependencies });
      if (!dependencyRoots.has("playwright") && (names.includes("@playwright/test") || names.includes("playwright"))) {
        dependencyRoots.set("playwright", candidateRoot);
      }
      if (!dependencyRoots.has("cypress") && names.some(name => name === "cypress" || name.startsWith("@cypress/"))) {
        dependencyRoots.set("cypress", candidateRoot);
      }
    }

    const runner = requestedRunner ?? (dependencyRoots.size === 1 ? dependencyRoots.keys().next().value : null);
    if (dependencyRoots.has(runner)) {
      candidates.push({ runner, command: null, configPath: null, rootDir: dependencyRoots.get(runner) });
    }
  }
  return candidates;
};

export const resolveSystemTestExecution = ({ rootDir: rawRootDir, runner = null }) => {
  const rootDir = normalizeDiskPath(rawRootDir) || rawRootDir;
  if (!rootDir || typeof rootDir !== "string") {
    throw new ServiceError("Snapshot root directory is required", 422);
  }
  if (runner !== null && !["playwright", "cypress"].includes(runner)) {
    throw new ServiceError("runner must be playwright or cypress", 400);
  }

  const candidates = detectCandidates(rootDir, runner);
  let selected;
  if (runner) {
    selected = candidates.find((candidate) => candidate.runner === runner);
    if (!selected) {
      throw new ServiceError(
        `No executable ${runner} configuration was found. Configure an explicit E2E script or install ${runner}.`,
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

  const executionRoot = selected.rootDir || rootDir;
  const testDirectory = findTestDirectory(executionRoot, selected.runner);

  return {
    runner: selected.runner,
    rootDir: executionRoot,
    ...buildCommand({ ...selected, rootDir: executionRoot, testDirectory }),
  };
};
