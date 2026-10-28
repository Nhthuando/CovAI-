import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { detectSystemTestFrameworks } from "../services/systemTestFrameworkDetection.service.js";
import { extractSuitesAndScenarios, parseTestFileDetails } from "../utils/testFileParser.js";

const roots = [];
const fixture = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-fw-detect-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
};

afterEach(() =>
  roots.splice(0).forEach((root) =>
    fs.rmSync(root, { recursive: true, force: true }),
  ),
);

describe("extractSuitesAndScenarios & parseTestFileDetails", () => {
  it("extracts suites and scenarios from Playwright code with quotes and backticks", () => {
    const code = `
      import { test, expect } from '@playwright/test';

      test.describe("Auth Suite", () => {
        test('user can log in', async ({ page }) => {
          await page.goto('/login');
        });

        test(\`user can reset password\`, async ({ page }) => {
          await page.goto('/reset');
        });
      });

      test('standalone smoke test', async ({ page }) => {
        await page.goto('/');
      });
    `;

    const { suites, scenarios } = extractSuitesAndScenarios(code, "PLAYWRIGHT");
    expect(suites).toContain("Auth Suite");
    expect(scenarios).toEqual([
      "user can log in",
      "user can reset password",
      "standalone smoke test",
    ]);
  });

  it("extracts suites and scenarios from Cypress code", () => {
    const code = `
      describe('Cart Management', () => {
        context('when empty', () => {
          it('displays empty cart message', () => {
            cy.visit('/cart');
          });
        });

        it('allows adding items', () => {
          cy.get('#add').click();
        });
      });
    `;

    const { suites, scenarios } = extractSuitesAndScenarios(code, "CYPRESS");
    expect(suites).toContain("Cart Management");
    expect(suites).toContain("when empty");
    expect(scenarios).toContain("displays empty cart message");
    expect(scenarios).toContain("allows adding items");
  });
});

describe("detectSystemTestFrameworks", () => {
  it("detects Playwright project and extracts test file details, suites, and scenarios", async () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({
        name: "playwright-app",
        devDependencies: { "@playwright/test": "^1.52.0" },
      }),
      "playwright.config.ts": "export default { testDir: './tests/e2e' };",
      "tests/e2e/auth.spec.js": `
        import { test, expect } from '@playwright/test';
        test.describe('Login flow', () => {
          test('valid login', async ({ page }) => {});
          test('invalid login', async ({ page }) => {});
        });
      `,
    });

    const result = await detectSystemTestFrameworks(rootDir);

    expect(result.hasSystemTests).toBe(true);
    expect(result.hasTestFiles).toBe(true);
    expect(result.isZeroTestProject).toBe(false);
    expect(result.totalFilesCount).toBe(1);
    expect(result.totalScenariosCount).toBe(2);

    const playwrightFw = result.frameworks.find((f) => f.name === "PLAYWRIGHT");
    expect(playwrightFw).toBeDefined();
    expect(playwrightFw.detected).toBe(true);
    expect(playwrightFw.testFileCount).toBe(1);
    expect(playwrightFw.scenarioCount).toBe(2);

    const file = playwrightFw.testFiles[0];
    expect(file.fileName).toBe("auth.spec.js");
    expect(file.suiteCount).toBe(1);
    expect(file.scenarioCount).toBe(2);
    expect(file.suites).toContain("Login flow");
    expect(file.scenarios).toContain("valid login");
  });

  it("detects Cypress project and parses cypress/e2e test files", async () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({
        name: "cypress-app",
        devDependencies: { cypress: "^13.6.0" },
      }),
      "cypress.config.js": "export default { e2e: {} };",
      "cypress/e2e/checkout.cy.js": `
        describe('Checkout process', () => {
          it('places an order', () => {
            cy.visit('/checkout');
          });
        });
      `,
    });

    const result = await detectSystemTestFrameworks(rootDir);

    expect(result.hasSystemTests).toBe(true);
    expect(result.hasTestFiles).toBe(true);
    expect(result.isZeroTestProject).toBe(false);
    expect(result.totalFilesCount).toBe(1);
    expect(result.totalScenariosCount).toBe(1);

    const cypressFw = result.frameworks.find((f) => f.name === "CYPRESS");
    expect(cypressFw).toBeDefined();
    expect(cypressFw.detected).toBe(true);
    expect(cypressFw.testFileCount).toBe(1);
    expect(cypressFw.scenarioCount).toBe(1);
  });

  it("detects Zero-Test Project when framework is installed but 0 test files exist", async () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({
        name: "zero-test-app",
        devDependencies: { "@playwright/test": "^1.50.0" },
      }),
      "src/App.jsx": "export default function App() { return <h1>Hello</h1>; }",
    });

    const result = await detectSystemTestFrameworks(rootDir);

    expect(result.hasSystemTests).toBe(true);
    expect(result.hasTestFiles).toBe(false);
    expect(result.isZeroTestProject).toBe(true);
    expect(result.totalFilesCount).toBe(0);
    expect(result.totalScenariosCount).toBe(0);
    expect(result.allTestFiles).toEqual([]);
  });

  it("returns isZeroTestProject and hasSystemTests=false for plain project without any test setup", async () => {
    const rootDir = fixture({
      "package.json": JSON.stringify({
        name: "plain-app",
        dependencies: { express: "^4.18.0" },
      }),
      "src/index.js": "console.log('running');",
    });

    const result = await detectSystemTestFrameworks(rootDir);

    expect(result.hasSystemTests).toBe(false);
    expect(result.hasTestFiles).toBe(false);
    expect(result.isZeroTestProject).toBe(true);
    expect(result.detectedCount).toBe(0);
    expect(result.allTestFiles).toHaveLength(0);
  });
});

