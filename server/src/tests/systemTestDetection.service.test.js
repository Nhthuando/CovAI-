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
  });

  it("runs Playwright config only when it declares webServer", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }),
      "playwright.config.js": "export default { webServer: { command: 'npm run start' } };",
    });
    const result = resolveSystemTestExecution({ rootDir, runner: "playwright" });
    expect(result.command).toContain("npx playwright test");
    expect(result.configPath).toBe("playwright.config.js");
  });

  it("requires an explicit Cypress script", () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({ devDependencies: { cypress: "^13.0.0" } }),
      "cypress.config.js": "export default { e2e: { baseUrl: 'http://localhost:3000' } };",
    });
    expect(() => resolveSystemTestExecution({ rootDir, runner: "cypress" }))
      .toThrow(expect.objectContaining({ statusCode: 422 }));
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
});
