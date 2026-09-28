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
  const packagePath = path.join(rootDir, "package.json");
  if (!fs.existsSync(packagePath)) {
    const error = new Error("Invalid Node.js project: package.json was not found in the uploaded project.");
    error.statusCode = 422;
    throw error;
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (cause) {
    const error = new Error(`The uploaded project's package.json is invalid: ${cause.message}`);
    error.statusCode = 422;
    throw error;
  }

  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = Object.values(pkg.scripts || {}).join(" ").toLowerCase();
  const testScript = (pkg.scripts?.test || "").toLowerCase();
  let testScriptFramework = null;
  if (/\bvitest\b/.test(testScript)) {
    testScriptFramework = "vitest";
  } else if (/\bjest\b/.test(testScript)) {
    testScriptFramework = "jest";
  }

  const all = [];

  for (const [framework, packageNames] of Object.entries(PACKAGE_NAMES)) {
    const installed = packageNames.some((name) => Object.prototype.hasOwnProperty.call(dependencies, name));
    const configured = (CONFIG_FILES[framework] || []).some((name) => fs.existsSync(path.join(rootDir, name)));
    const scripted = new RegExp(`(^|[^a-z])${framework}([^a-z]|$)`).test(scripts);
    if (installed || configured || scripted) all.push(framework);
  }

  // Scan test files for framework indicators as well
  const scanTestFiles = (dir) => {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const normPath = full.replace(/\\/g, "/").toLowerCase();
        const relPath = path.relative(rootDir, full).replace(/\\/g, "/").toLowerCase();

        if (entry.isDirectory()) {
          if (!["node_modules", ".git", "coverage", "dist", "build", ".next", ".vite", ".vitest"].includes(entry.name)) {
            scanTestFiles(full);
          }
        } else if (entry.isFile()) {
          const isSetupOrHelper = /^(setup|global-?setup|setup-?tests|teardown|helpers?|mocks?|fixtures?|config|utils?)\.[a-z0-9]+$/i.test(entry.name);
          const isTestFile = !isSetupOrHelper && (
            /\.(test|spec|testcase)\.[a-z0-9]+$/i.test(entry.name) ||
            /(?:^|\/)(tests?|__tests__|specs?|unit)\//i.test(relPath)
          ) && /\.[cm]?[jt]sx?$/i.test(entry.name);

          if (!isTestFile) continue;

          let content = "";
          try {
            const buf = Buffer.alloc(1024);
            const fd = fs.openSync(full, "r");
            const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
            fs.closeSync(fd);
            content = buf.toString("utf8", 0, bytesRead).toLowerCase();
          } catch (_) { }

          if (relPath.includes("vitest") || content.includes("vitest") || content.includes("vi.")) {
            if (!all.includes("vitest")) all.push("vitest");
          }
          if (relPath.includes("jest") || content.includes("@jest/") || content.includes("jest.")) {
            if (!all.includes("jest")) all.push("jest");
          }
          if (relPath.includes("supertest") || content.includes("supertest") || content.includes("request(app)")) {
            if (!all.includes("supertest")) all.push("supertest");
          }
          if (relPath.includes("playwright") || content.includes("@playwright/test") || content.includes("page.goto")) {
            if (!all.includes("playwright")) all.push("playwright");
          }
          if (relPath.includes("cypress") || content.includes("cypress")) {
            if (!all.includes("cypress")) all.push("cypress");
          }

          // Default unit fallback for test files: if it's a test file and not exclusively e2e/system (playwright/cypress),
          // ensure unit test frameworks (vitest, jest) are included if neither is present.
          const isE2EOnly = (relPath.includes("playwright") || relPath.includes("cypress")) && !relPath.includes("unit");
          if (!isE2EOnly) {
            if (!all.includes("vitest") && !all.includes("jest")) {
              if (testScriptFramework) {
                all.push(testScriptFramework);
              } else {
                all.push("vitest", "jest");
              }
            }
          }
        }
      }
    } catch (_) { }
  };

  scanTestFiles(rootDir);

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

  const detectedText = detection.all.length ? detection.all.join(", ") : "none";
  const error = new Error(
    `Unsupported framework for ${type} coverage. Supported: ${allowed.join(", ")}. Detected: ${detectedText}.`,
  );
  error.statusCode = 422;
  error.code = "UNSUPPORTED_TEST_FRAMEWORK";
  error.details = { coverageType: type, supported: allowed, detected: detection.all };
  throw error;
}
