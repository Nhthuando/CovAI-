import fs from "fs";
import path from "path";

/**
 * Service to detect all test frameworks used in a project.
 */
export async function detectFrameworks(rootDir) {
  const pkgPath = path.join(rootDir, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const detected = [];

  // Detect Playwright
  if (deps["@playwright/test"]) {
    const configPath = findPlaywrightConfig(rootDir);
    const testDir = findPlaywrightTestDir(rootDir);
    detected.push({
      framework: "playwright",
      type: "integration",
      configPath: configPath ? path.relative(rootDir, configPath) : null,
      testDirectory: testDir ? path.relative(rootDir, testDir) : null,
    });
  }

  // Detect Supertest
  if (deps["supertest"]) {
    detected.push({
      framework: "supertest",
      type: "integration",
    });
  }

  return detected;
}

function findPlaywrightConfig(dir) {
  const commonNames = [
    "playwright.config.js",
    "playwright.config.ts",
    "playwright.config.mjs",
    "playwright.config.cjs",
  ];
  for (const name of commonNames) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function findPlaywrightTestDir(dir) {
  const possibleDirs = ["tests", "e2e", "integration", "test"];
  for (const d of possibleDirs) {
    const dirPath = path.join(dir, d);
    if (fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory()) {
      return dirPath;
    }
  }
  return null;
}
