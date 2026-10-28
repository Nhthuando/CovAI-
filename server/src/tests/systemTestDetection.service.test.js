import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { resolveSystemTestExecution } from "../services/systemTestDetection.service.js";

const roots = [];
const fixture = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-system-detect-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("resolveSystemTestExecution", () => {
  it("runs E2E from the client workspace of a monorepo", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({ scripts: { dev: "concurrently ..." } }),
      "client/package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }),
      "client/e2e/home.spec.js": "// E2E",
    });
    const execution = resolveSystemTestExecution({ rootDir });
    expect(execution.rootDir).toBe(path.join(rootDir, "client"));
    expect(execution.testDirectory).toBe("e2e");
  });

  it("does not mistake a unit test directory for Playwright", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({ devDependencies: { jest: "^29.0.0" } }),
      "tests/math.test.js": "test('adds', () => {});",
    });
    expect(() => resolveSystemTestExecution({ rootDir })).toThrow("No executable Playwright");
  });
  it("selects a nominated Playwright script and creates a JSON report command", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({
        devDependencies: { "@playwright/test": "^1.0.0" },
        scripts: { "test:e2e:playwright": "playwright test" },
      }),
    });
    const result = resolveSystemTestExecution({ rootDir });
    expect(result.runner).toBe("playwright");
    expect(result.command).toContain("npm run --silent test:e2e:playwright");
    expect(result.command).toContain("--reporter=json");
    expect(result.command).toContain("--retries=1");
  });

  it("detects Playwright without test:e2e script and falls back to npx playwright test (DoD 3)", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }),
    });
    const result = resolveSystemTestExecution({ rootDir });
    expect(result.runner).toBe("playwright");
    expect(result.command).toContain("npx playwright test");
    expect(result.command).toContain("--reporter=json");
    expect(result.command).toContain("--retries=1");
  });

  it("runs Playwright config with npx playwright test when config is present", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }),
      "playwright.config.js": "export default { webServer: { command: 'npm run start' } };",
    });
    const result = resolveSystemTestExecution({ rootDir, runner: "playwright" });
    expect(result.command).toContain("npx playwright test");
    expect(result.configPath).toBe("playwright.config.js");
  });

  it("falls back to npx cypress run when Cypress is present without explicit script", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({ devDependencies: { cypress: "^13.0.0" } }),
      "cypress.config.js": "export default { e2e: { baseUrl: 'http://localhost:3000' } };",
    });
    const result = resolveSystemTestExecution({ rootDir, runner: "cypress" });
    expect(result.runner).toBe("cypress");
    expect(result.command).toContain("npx cypress run");
    expect(result.command).toContain("--config-file \"cypress.config.js\"");
    expect(result.command).toContain("--reporter json");
  });

  it("requires explicit choice when both runners are executable", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({
        devDependencies: { "@playwright/test": "^1.0.0", cypress: "^13.0.0" },
        scripts: { "test:e2e:playwright": "playwright test", "test:e2e:cypress": "cypress run" },
      }),
    });
    expect(() => resolveSystemTestExecution({ rootDir }))
      .toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(resolveSystemTestExecution({ rootDir, runner: "cypress" }).runner).toBe("cypress");
  });

  it("detects common test directories such as tests/e2e", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }),
      "tests/e2e/sample.spec.js": "// test",
    });
    const result = resolveSystemTestExecution({ rootDir });
    expect(result.testDirectory).toBe("tests/e2e");
  });
});
