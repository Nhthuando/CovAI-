import fs from "fs";
import path from "path";
import { resolveProjectRoot, hasSourceCodeFiles, ensureMinimalPackageJson } from "../utils/projectRootResolver.js";

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
  let effectiveDir = rootDir;
  let packagePath = path.join(effectiveDir, "package.json");
  if (!fs.existsSync(packagePath)) {
    const resolved = resolveProjectRoot(rootDir);
    if (resolved && fs.existsSync(path.join(resolved, "package.json"))) {
      effectiveDir = resolved;
    }
  }

  const candidateDirs = ["", "client", "server", "frontend", "backend", "web", "api", "app", "ui"];
  let foundAnyPkg = false;
  const dependencies = {};
  let scripts = "";
  let testScriptFramework = null;

  for (const cand of candidateDirs) {
    const dir = cand ? path.join(rootDir, cand) : effectiveDir;
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
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
    if (hasSourceCodeFiles(effectiveDir) || hasSourceCodeFiles(rootDir)) {
      ensureMinimalPackageJson(effectiveDir);
      foundAnyPkg = true;
    } else {
      const error = new Error("Invalid Node.js project: package.json was not found in the uploaded project.");
      error.statusCode = 422;
      throw error;
    }
  }

  const all = [];
  const installedUnitLibs = [];
  const configUnitLibs = [];
  const unitSyntaxLibs = [];
  let unitTestFilesFound = 0;

  for (const [framework, packageNames] of Object.entries(PACKAGE_NAMES)) {
    const installed = packageNames.some((name) => Object.prototype.hasOwnProperty.call(dependencies, name));
    const configured = (CONFIG_FILES[framework] || []).some((name) => {
      if (fs.existsSync(path.join(rootDir, name))) return true;
      if (effectiveDir && fs.existsSync(path.join(effectiveDir, name))) return true;
      return candidateDirs.some((cand) => cand && fs.existsSync(path.join(rootDir, cand, name)));
    });
    const scripted = new RegExp(`(^|[^a-z])${framework}([^a-z]|$)`).test(scripts);
    if (installed || scripted) {
      if (framework === "jest" || framework === "vitest") {
        if (!installedUnitLibs.includes(framework)) installedUnitLibs.push(framework);
      }
    }
    if (configured && (framework === "jest" || framework === "vitest")) {
      if (!configUnitLibs.includes(framework)) configUnitLibs.push(framework);
    }
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
            const buf = Buffer.alloc(2048);
            const fd = fs.openSync(full, "r");
            const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
            fs.closeSync(fd);
            content = buf.toString("utf8", 0, bytesRead).toLowerCase();
          } catch (_) { }

          const isVitestSyntax = relPath.includes("vitest") || content.includes("vitest") || /\bvi\./.test(content);
          const isJestSyntax = relPath.includes("jest") || content.includes("@jest/") || /\bjest\./.test(content);
          const isSupertestSyntax = relPath.includes("supertest") || content.includes("supertest") || content.includes("request(app)");
          const isPlaywrightSyntax = relPath.includes("playwright") || content.includes("@playwright/test") || content.includes("page.goto");
          const isCypressSyntax = relPath.includes("cypress") || content.includes("cypress") || /\bcy\./.test(content);

          if (isVitestSyntax) {
            if (!all.includes("vitest")) all.push("vitest");
            if (!unitSyntaxLibs.includes("vitest")) unitSyntaxLibs.push("vitest");
          }
          if (isJestSyntax) {
            if (!all.includes("jest")) all.push("jest");
            if (!unitSyntaxLibs.includes("jest")) unitSyntaxLibs.push("jest");
          }
          if (isSupertestSyntax) {
            if (!all.includes("supertest")) all.push("supertest");
          }
          if (isPlaywrightSyntax) {
            if (!all.includes("playwright")) all.push("playwright");
          }
          if (isCypressSyntax) {
            if (!all.includes("cypress")) all.push("cypress");
          }

          // Default unit fallback for test files: if it's a test file and not exclusively e2e/system/integration,
          // count it as an existing unit test file so syntax-based detection does not ask user to pick a library.
          const isE2EOrIntegrationOnly =
            (relPath.includes("playwright") || relPath.includes("cypress") || isPlaywrightSyntax || isCypressSyntax || isSupertestSyntax) &&
            !relPath.includes("unit");
          if (!isE2EOrIntegrationOnly) {
            unitTestFilesFound += 1;
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

  scanTestFiles(effectiveDir);
  if (effectiveDir !== rootDir) {
    scanTestFiles(rootDir);
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

  const declaredUnitLibs = Array.from(new Set([...installedUnitLibs, ...configUnitLibs]));
  const hasUnitDeps = declaredUnitLibs.length > 0;
  const hasUnitTests = unitTestFilesFound > 0;

  let unitPermutation;
  if (hasUnitDeps) {
    const resolved =
      testScriptFramework && declaredUnitLibs.includes(testScriptFramework)
        ? testScriptFramework
        : declaredUnitLibs.includes("vitest") && !declaredUnitLibs.includes("jest")
          ? "vitest"
          : declaredUnitLibs.includes("jest") && !declaredUnitLibs.includes("vitest")
            ? "jest"
            : declaredUnitLibs[0];
    unitPermutation = {
      permutation: hasUnitTests ? "HAS_TESTS_AND_DEPS" : "HAS_DEPS_NO_TESTS",
      needsUserSelection: false,
      detectionSource: installedUnitLibs.length > 0 ? "package_json" : "config",
      installedFrameworks: installedUnitLibs,
      configuredFrameworks: configUnitLibs,
      inferredFramework: resolved,
      resolvedFramework: resolved,
      proposedFrameworks: ["jest", "vitest"],
    };
  } else if (hasUnitTests) {
    const inferred = unitSyntaxLibs[0] || testScriptFramework || "jest";
    unitPermutation = {
      permutation: "HAS_TESTS_NO_DEPS",
      needsUserSelection: false,
      detectionSource: "test_syntax",
      installedFrameworks: [],
      configuredFrameworks: [],
      inferredFrameworks: unitSyntaxLibs,
      inferredFramework: inferred,
      resolvedFramework: inferred,
      proposedFrameworks: ["jest", "vitest"],
    };
  } else {
    unitPermutation = {
      permutation: "ZERO_TESTS_NO_DEPS",
      needsUserSelection: true,
      detectionSource: "user_selection_required",
      installedFrameworks: [],
      configuredFrameworks: [],
      inferredFramework: null,
      resolvedFramework: null,
      proposedFrameworks: ["jest", "vitest"],
    };
  }

  // Default unit test fallback: if no unit test framework was detected,
  // allow unit test analysis (defaulting to "jest") so that projects without
  // tests yet can run analysis, view logic files, and suggest unit tests.
  if (!all.includes("jest") && !all.includes("vitest")) {
    if (testScriptFramework) {
      all.push(testScriptFramework);
    } else if (all.length === 0) {
      all.push("jest");
    }
  }

  const supported = Object.fromEntries(
    Object.entries(COVERAGE_FRAMEWORKS).map(([type, names]) => [type, names.filter((name) => all.includes(name))]),
  );

  if ((!supported.unit || supported.unit.length === 0) && all.length === 0) {
    supported.unit = ["jest"];
  }

  return {
    all,
    supported,
    unsupported: all.filter((name) => !Object.values(COVERAGE_FRAMEWORKS).flat().includes(name)),
    testScriptFramework,
    recommended: unitPermutation.resolvedFramework,
    unitPermutation,
  };
}

function inspectPackageUnitFramework(pkgDir) {
  const pkgPath = path.join(pkgDir, "package.json");
  let deps = {};
  let scripts = "";
  let testScript = "";
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
      scripts = Object.values(pkg.scripts || {}).join(" ").toLowerCase();
      testScript = (pkg.scripts?.test || "").toLowerCase();
    } catch (_) {}
  }

  const hasVitestDep = Object.prototype.hasOwnProperty.call(deps, "vitest") || /\bvitest\b/.test(testScript);
  const hasJestDep = Object.prototype.hasOwnProperty.call(deps, "jest") || /\bjest\b/.test(testScript);
  const hasVitestCfg = (CONFIG_FILES.vitest || []).some((n) => fs.existsSync(path.join(pkgDir, n)));
  const hasJestCfg = (CONFIG_FILES.jest || []).some((n) => fs.existsSync(path.join(pkgDir, n)));

  if (hasVitestDep && !hasJestDep) return "vitest";
  if (hasJestDep && !hasVitestDep) return "jest";
  if (hasVitestDep && hasJestDep) return /\bvitest\b/.test(scripts) && !/\bjest\b/.test(scripts) ? "vitest" : "jest";
  if (hasVitestCfg && !hasJestCfg) return "vitest";
  if (hasJestCfg && !hasVitestCfg) return "jest";
  return null;
}

/**
 * Resolve the appropriate Unit Test framework ("jest" | "vitest") for a specific
 * source file following CovAI's 3-rule framework selection contract:
 *  1. Installed test library in owning subpackage or project package.json
 *  2. Inferred from existing unit test syntax in owning subpackage or linked tests
 *  3. User selection / deterministic fallback when zero libs and zero tests exist
 */
export function resolveUnitFrameworkForFile(
  rootDir,
  filePath,
  { userSelectedFramework = null, fallbackFramework = "jest" } = {},
) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return userSelectedFramework || fallbackFramework || "jest";
  }

  // Walk from target file's directory up toward (but stopping at) rootDir so
  // owning monorepo subpackages (e.g. client/ vs server/) resolve independently first.
  const normRoot = path.resolve(rootDir);
  if (filePath) {
    let cursor = path.dirname(path.resolve(normRoot, String(filePath)));
    const visited = new Set();
    while (cursor && cursor.startsWith(normRoot) && !visited.has(cursor)) {
      visited.add(cursor);
      const isRoot = cursor === normRoot;
      if (!isRoot && fs.existsSync(path.join(cursor, "package.json"))) {
        const subFw = inspectPackageUnitFramework(cursor);
        if (subFw) return subFw;
        break;
      }
      if (isRoot) break;
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  try {
    const projectDetection = detectCoverageFrameworks(normRoot);
    const perm = projectDetection?.unitPermutation;
    if (perm && !perm.needsUserSelection && perm.resolvedFramework) {
      return perm.resolvedFramework;
    }
    if (userSelectedFramework && ["jest", "vitest"].includes(String(userSelectedFramework).toLowerCase())) {
      return String(userSelectedFramework).toLowerCase();
    }
    return perm?.resolvedFramework || fallbackFramework || "jest";
  } catch (_) {
    return userSelectedFramework || fallbackFramework || "jest";
  }
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

  // 4. Default to jest for unit coverage if no explicit unsupported framework was detected
  if (type === "unit" && (!detection.all || detection.all.length === 0)) {
    return "jest";
  }

  // 5. For system coverage: if requested or no framework in package.json, default to playwright
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
