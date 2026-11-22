import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSystemTestExecution } from "../services/systemTestDetection.service.js";
import { detectSystemTestFrameworks } from "../services/systemTestFrameworkDetection.service.js";
import { ensureSystemTestConfig } from "../services/verifiedSystemGeneration.service.js";
import { classifySystemTestContent } from "../utils/testFileParser.js";

const tempRoots = [];
const playwrightSpec = "import { test } from '@playwright/test'; test('opens', () => {});";
const cypressSpec = "it('opens', () => cy.visit('/'));";
const jestSpec = "test('adds', () => expect(1).toBe(1));";

function makeProject(files = {}, pkg = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "system-frameworks-"));
  tempRoots.push(rootDir);
  fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify(pkg));
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return rootDir;
}

async function detectFiles(rootDir) {
  const { frameworks } = await detectSystemTestFrameworks(rootDir);
  const filesFor = (name) => frameworks.find(framework => framework.name === name)
    ?.testFiles.map(file => file.filePath) ?? [];
  return { PLAYWRIGHT: filesFor("PLAYWRIGHT"), CYPRESS: filesFor("CYPRESS") };
}

afterEach(() => {
  for (const rootDir of tempRoots.splice(0)) {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

describe("mixed system test projects", () => {
  test("C1: assigns each conventional spec to its framework", async () => {
    const rootDir = makeProject({
      "tests/e2e/login.spec.ts": playwrightSpec,
      "cypress/e2e/home.cy.js": cypressSpec,
    });
    expect(await detectFiles(rootDir)).toEqual({
      PLAYWRIGHT: ["tests/e2e/login.spec.ts"],
      CYPRESS: ["cypress/e2e/home.cy.js"],
    });
  });

  test("counts a Playwright test in the configured testDir", async () => {
    const rootDir = makeProject({
      "playwright.config.js": "export default { testDir: 'specs' };",
      "specs/home.ts": playwrightSpec,
    });
    const { frameworks } = await detectSystemTestFrameworks(rootDir);
    expect(frameworks.find(framework => framework.name === "PLAYWRIGHT")).toMatchObject({
      testFileCount: 1,
      testFiles: [expect.objectContaining({ filePath: "specs/home.ts" })],
    });
  });

  test("C2: a Playwright dependency does not claim a Cypress spec", async () => {
    const rootDir = makeProject(
      { "cypress/e2e/a.cy.js": cypressSpec },
      { devDependencies: { "@playwright/test": "1.0.0" } },
    );
    expect(await detectFiles(rootDir)).toEqual({
      PLAYWRIGHT: [],
      CYPRESS: ["cypress/e2e/a.cy.js"],
    });
  });

  test("C3: a Cypress dependency does not claim a Playwright spec", async () => {
    const rootDir = makeProject(
      { "tests/e2e/a.spec.js": playwrightSpec },
      { devDependencies: { cypress: "1.0.0" } },
    );
    expect(await detectFiles(rootDir)).toEqual({
      PLAYWRIGHT: ["tests/e2e/a.spec.js"],
      CYPRESS: [],
    });
  });

  test("C5a: Cypress content wins in tests/e2e", async () => {
    const rootDir = makeProject({ "tests/e2e/x.spec.js": cypressSpec });
    expect(await detectFiles(rootDir)).toEqual({
      PLAYWRIGHT: [],
      CYPRESS: ["tests/e2e/x.spec.js"],
    });
  });

  test("C5b: Playwright content wins in a Cypress path", async () => {
    const rootDir = makeProject({ "cypress/e2e/y.cy.js": playwrightSpec });
    expect(await detectFiles(rootDir)).toEqual({
      PLAYWRIGHT: ["cypress/e2e/y.cy.js"],
      CYPRESS: [],
    });
  });

  test("excludes a Jest unit test from both frameworks", async () => {
    const rootDir = makeProject({ "tests/math.test.js": jestSpec });
    expect(await detectFiles(rootDir)).toEqual({ PLAYWRIGHT: [], CYPRESS: [] });
  });

  test.each([
    [playwrightSpec, "PLAYWRIGHT"],
    ["const { chromium } = require('playwright');", "PLAYWRIGHT"],
    [`${playwrightSpec}\n${cypressSpec}`, "PLAYWRIGHT"],
    [cypressSpec, "CYPRESS"],
    ['/// <reference types="cypress" />', "CYPRESS"],
    ["import { defineConfig } from 'cypress';", "CYPRESS"],
    [jestSpec, null],
    ["cy.visitor();", null],
  ])("classifies framework signals in %s", (content, framework) => {
    expect(classifySystemTestContent(content)).toBe(framework);
  });

  test("creates cypress.config.cjs in a module package", () => {
    const rootDir = makeProject({}, { type: "module" });
    expect(ensureSystemTestConfig({ rootDir, framework: "cypress" })).toEqual({
      configCreated: true,
      configPath: "cypress.config.cjs",
    });
    expect(fs.existsSync(path.join(rootDir, "cypress.config.cjs"))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "cypress.config.js"))).toBe(false);
  });

  test("selects Cypress when the Playwright test directory is empty", () => {
    const rootDir = makeProject({ "cypress/e2e/a.cy.js": cypressSpec });
    fs.mkdirSync(path.join(rootDir, "tests", "e2e"), { recursive: true });
    expect(resolveSystemTestExecution({ rootDir }).runner).toBe("cypress");
  });
});
