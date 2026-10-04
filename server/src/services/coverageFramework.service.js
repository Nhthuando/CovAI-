import fs from "fs";
import path from "path";

export const COVERAGE_FRAMEWORKS = Object.freeze({
  unit: ["jest", "vitest"],
  integration: ["supertest"],
  system: ["playwright", "cypress"],
});

const PACKAGE_NAMES = Object.freeze({
  jest: ["jest"],
  vitest: ["vitest"],
  playwright: ["@playwright/test", "playwright"],
  supertest: ["supertest"],
  cypress: ["cypress"],
  mocha: ["mocha"],
  jasmine: ["jasmine", "jasmine-core"],
  ava: ["ava"],
  tap: ["tap", "tape"],
  webdriverio: ["webdriverio", "@wdio/cli"],
  puppeteer: ["puppeteer"],
});

const CONFIG_FILES = Object.freeze({
  jest: ["jest.config.js", "jest.config.cjs", "jest.config.mjs", "jest.config.ts"],
  vitest: ["vitest.config.js", "vitest.config.mjs", "vitest.config.ts"],
  playwright: ["playwright.config.js", "playwright.config.cjs", "playwright.config.mjs", "playwright.config.ts"],
  cypress: ["cypress.config.js", "cypress.config.cjs", "cypress.config.mjs", "cypress.config.ts"],
});

export function detectCoverageFrameworks(rootDir) {
  const candidateDirs = ["", "client", "server", "frontend", "backend", "web", "api", "app", "ui"];
  let foundAnyPkg = false;
  const dependencies = {};
  let scripts = "";
  let testScriptFramework = null;

  for (const cand of candidateDirs) {
    const dir = cand ? path.join(rootDir, cand) : rootDir;
    const packagePath = path.join(dir, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        foundAnyPkg = true;
        Object.assign(dependencies, pkg.dependencies || {}, pkg.devDependencies || {});
        scripts += " " + Object.values(pkg.scripts || {}).join(" ").toLowerCase();
        const testScript = (pkg.scripts?.test || "").toLowerCase();
        if (/\bvitest\b/.test(testScript)) {
          testScriptFramework = "vitest";
        } else if (/\bjest\b/.test(testScript)) {
          testScriptFramework = "jest";
        }
      } catch (cause) {
        if (!cand) {
          const error = new Error(`The uploaded project's package.json is invalid: ${cause.message}`);
          error.statusCode = 422;
          throw error;
        }
      }
    }
  }

  if (!foundAnyPkg) {
    const error = new Error("Invalid Node.js project: package.json was not found in the uploaded project.");
    error.statusCode = 422;
    throw error;
  }

  const all = [];

  for (const [framework, packageNames] of Object.entries(PACKAGE_NAMES)) {
    const installed = packageNames.some((name) => Object.prototype.hasOwnProperty.call(dependencies, name));
    const configured = (CONFIG_FILES[framework] || []).some((name) => {
      if (fs.existsSync(path.join(rootDir, name))) return true;
      return candidateDirs.some((cand) => cand && fs.existsSync(path.join(rootDir, cand, name)));
    });
    const scripted = new RegExp(`(^|[^a-z])${framework}([^a-z]|$)`).test(scripts);
    if (installed || configured || scripted) all.push(framework);
  }

  // Detect Playwright / Cypress from standard test file locations (e.g. AI-generated tests)
  const hasPlaywrightTestFiles = ["tests/e2e", "e2e", "tests/system"].some((dir) => {
    const fullDir = path.join(rootDir, dir);
    if (!fs.existsSync(fullDir)) return false;
    try {
      return fs.readdirSync(fullDir).some((f) => /\.(spec|test)\.(js|ts|mjs|cjs)$/.test(f));
    } catch {
      return false;
    }
  });
  if (hasPlaywrightTestFiles && !all.includes("playwright")) {
    all.push("playwright");
  }

  const hasCypressTestFiles = ["cypress/e2e", "cypress"].some((dir) => {
    const fullDir = path.join(rootDir, dir);
    if (!fs.existsSync(fullDir)) return false;
    try {
      return fs.readdirSync(fullDir).some((f) => /\.(cy|spec|test)\.(js|ts)$/.test(f));
    } catch {
      return false;
    }
  });
  if (hasCypressTestFiles && !all.includes("cypress")) {
    all.push("cypress");
  }

  const supported = Object.fromEntries(
    Object.entries(COVERAGE_FRAMEWORKS).map(([type, names]) => [type, names.filter((name) => all.includes(name))]),
  );
  return { all, supported, unsupported: all.filter((name) => !Object.values(COVERAGE_FRAMEWORKS).flat().includes(name)), testScriptFramework };
}

export function selectCoverageFramework(detection, type, requestedFramework = null) {
  const allowed = COVERAGE_FRAMEWORKS[type];
  if (!allowed) {
    const error = new Error("coverageType must be unit, integration, or system.");
    error.statusCode = 400;
    throw error;
  }

  const supported = detection.supported[type] || [];

  // 1. If a specific framework was requested and is supported, use it
  if (requestedFramework && supported.includes(requestedFramework.toLowerCase())) {
    return requestedFramework.toLowerCase();
  }

  // 2. If package.json explicitly defines a framework in "test" script, prioritize it for unit tests
  if (type === "unit" && detection.testScriptFramework && supported.includes(detection.testScriptFramework)) {
    return detection.testScriptFramework;
  }

  // 3. Fallback to first supported framework
  const framework = supported[0];
  if (framework) return framework;

  // 4. For system coverage: if requested or no framework in package.json, default to playwright
  // (CovAI provides zero-config Playwright runner for AI-generated and saved E2E tests)
  if (type === "system") {
    if (requestedFramework && ["playwright", "cypress"].includes(requestedFramework.toLowerCase())) {
      return requestedFramework.toLowerCase();
    }
    return "playwright";
  }

  const detectedText = detection.all.length ? detection.all.join(", ") : "none";
  const error = new Error(
    `Unsupported framework for ${type} coverage. Supported: ${allowed.join(", ")}. Detected: ${detectedText}.`,
  );
  error.statusCode = 422;
  error.code = "UNSUPPORTED_TEST_FRAMEWORK";
  error.details = { coverageType: type, supported: allowed, detected: detection.all };
  throw error;
}
