import fs from "fs";
import os from "os";
import path from "path";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { resolveSystemTestExecution } from "../services/systemTestDetection.service.js";
import { detectSystemTestFrameworks } from "../services/systemTestFrameworkDetection.service.js";
import { parseSystemTestResult } from "../services/systemTestResultParser.service.js";
import { ServiceError } from "../utils/serviceError.js";

const tmpDirs = [];
const createTempDir = (files = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase7-comprehensive-"));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
});

describe("Phase 7.1 - Unit & Integration Tests: System Test Detection", () => {
  it("Scenario 1: Detects project with ONLY Playwright setup", async () => {
    const rootDir = createTempDir({
      "package.json": JSON.stringify({
        name: "pw-only-project",
        devDependencies: { "@playwright/test": "^1.40.0" },
        scripts: { "test:e2e": "playwright test" },
      }),
      "playwright.config.js": "export default { testDir: './tests' };",
      "tests/login.spec.js": `
        import { test, expect } from '@playwright/test';
        test('user can log in', async ({ page }) => {
          await page.goto('/login');
        });
      `,
    });

    const detection = await detectSystemTestFrameworks(rootDir);
    expect(detection.hasSystemTests).toBe(true);
    expect(detection.hasTestFiles).toBe(true);
    expect(detection.isZeroTestProject).toBe(false);
    expect(detection.frameworks.some((f) => f.name === "PLAYWRIGHT" && f.detected)).toBe(true);
    expect(detection.frameworks.some((f) => f.name === "CYPRESS" && f.detected)).toBe(false);

    const exec = resolveSystemTestExecution({ rootDir });
    expect(exec.runner).toBe("playwright");
    expect(exec.command).toContain("test:e2e");
  });

  it("Scenario 2: Detects project with ONLY Cypress setup", async () => {
    const rootDir = createTempDir({
      "package.json": JSON.stringify({
        name: "cypress-only-project",
        devDependencies: { cypress: "^13.0.0" },
        scripts: { "test:e2e": "cypress run" },
      }),
      "cypress.config.js": "export default { e2e: { baseUrl: 'http://localhost:3000' } };",
      "cypress/e2e/cart.cy.js": `
        describe('Shopping Cart', () => {
          it('adds item to cart', () => {
            cy.visit('/cart');
          });
        });
      `,
    });

    const detection = await detectSystemTestFrameworks(rootDir);
    expect(detection.hasSystemTests).toBe(true);
    expect(detection.hasTestFiles).toBe(true);
    expect(detection.isZeroTestProject).toBe(false);
    expect(detection.frameworks.some((f) => f.name === "CYPRESS" && f.detected)).toBe(true);
    expect(detection.frameworks.some((f) => f.name === "PLAYWRIGHT" && f.detected)).toBe(false);

    const exec = resolveSystemTestExecution({ rootDir, runner: "cypress" });
    expect(exec.runner).toBe("cypress");
    expect(exec.command).toContain("cypress");
  });

  it("Scenario 3: Handles project with BOTH Playwright AND Cypress installed", async () => {
    const rootDir = createTempDir({
      "package.json": JSON.stringify({
        name: "dual-framework-project",
        devDependencies: {
          "@playwright/test": "^1.40.0",
          cypress: "^13.0.0",
        },
        scripts: {
          "test:pw": "playwright test",
          "test:cy": "cypress run",
        },
      }),
      "playwright.config.js": "export default {};",
      "cypress.config.js": "export default {};",
      "tests/e2e/home.spec.js": "test('home', () => {});",
      "cypress/e2e/home.cy.js": "it('home', () => {});",
    });

    const detection = await detectSystemTestFrameworks(rootDir);
    expect(detection.hasSystemTests).toBe(true);
    expect(detection.hasTestFiles).toBe(true);
    expect(detection.isZeroTestProject).toBe(false);
    expect(detection.detectedCount).toBe(2);

    // When both are present and no runner chosen, resolveSystemTestExecution prompts/errors or requires specification
    expect(() => resolveSystemTestExecution({ rootDir })).toThrow();

    // Specifying runner resolves cleanly without conflict
    const execPw = resolveSystemTestExecution({ rootDir, runner: "playwright" });
    expect(execPw.runner).toBe("playwright");

    const execCy = resolveSystemTestExecution({ rootDir, runner: "cypress" });
    expect(execCy.runner).toBe("cypress");
  });

  it("Scenario 4: Handles PLAIN project with NO frameworks or tests (Zero-Test project)", async () => {
    const rootDir = createTempDir({
      "package.json": JSON.stringify({
        name: "plain-express-app",
        dependencies: { express: "^4.19.0" },
      }),
      "src/index.js": "console.log('App started');",
    });

    const detection = await detectSystemTestFrameworks(rootDir);
    expect(detection.hasSystemTests).toBe(false);
    expect(detection.hasTestFiles).toBe(false);
    expect(detection.isZeroTestProject).toBe(true);
    expect(detection.detectedCount).toBe(0);
    expect(detection.allTestFiles).toHaveLength(0);

    expect(() => resolveSystemTestExecution({ rootDir })).toThrow();
  });
});

describe("Phase 7.1 - Unit & Integration Tests: System Test Result Parser & Breakpoints", () => {
  const startedAt = new Date("2026-10-07T10:00:00Z");
  const finishedAt = new Date("2026-10-07T10:00:05Z");

  it("accurately extracts breakpoint failureStep, failureCategory, snippet and screenshot", () => {
    const rootDir = createTempDir({
      "tests/e2e/checkout.spec.js": [
        "import { test, expect } from '@playwright/test';",
        "test('checkout flow', async ({ page }) => {",
        "  await page.goto('/checkout');",
        "  await page.click('button#pay-now');",
        "  await expect(page.locator('.order-success')).toBeVisible();",
        "});",
      ].join("\n"),
    });

    const reportPath = path.join(rootDir, "playwright-report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        stats: { duration: 3200 },
        suites: [
          {
            title: "checkout.spec.js",
            file: "tests/e2e/checkout.spec.js",
            specs: [
              {
                title: "checkout flow",
                tests: [
                  {
                    status: "unexpected",
                    results: [
                      {
                        status: "timedOut",
                        duration: 3200,
                        error: {
                          message: "Timed out 5000ms waiting for locator('button#pay-now')",
                          stack:
                            "Error: Timed out 5000ms waiting for locator('button#pay-now')\n    at tests/e2e/checkout.spec.js:4:14",
                        },
                        attachments: [
                          {
                            name: "evidence",
                            contentType: "image/png",
                            path: path.join(rootDir, "evidence-screenshot.png"),
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })
    );

    const parsed = parseSystemTestResult({
      runner: "playwright",
      resultPath: reportPath,
      startedAt,
      finishedAt,
      rootDir,
    });

    expect(parsed.status).toBe("FAILED");
    expect(parsed.totalTests).toBe(1);
    expect(parsed.failedTests).toBe(1);
    expect(parsed.passedTests).toBe(0);
    expect(parsed.stabilityScorePct).toBe(0);

    const scenario = parsed.scenarios[0];
    expect(scenario.title).toBe("checkout flow");
    expect(scenario.status).toBe("failed");
    expect(scenario.failureCategory).toBe("TIMEOUT");
    expect(scenario.failureStep).toContain("button#pay-now");
    expect(scenario.failureCodeSnippet).toContain("await page.click('button#pay-now')");
    expect(scenario.screenshotSource).toContain("evidence-screenshot.png");
  });

  it("calculates stabilityScorePct accurately with passing and flaky tests", () => {
    const rootDir = createTempDir();
    const reportPath = path.join(rootDir, "pw-flaky-results.json");

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        stats: { duration: 4500 },
        suites: [
          {
            title: "suite.spec.js",
            file: "suite.spec.js",
            specs: [
              {
                title: "stable test 1",
                tests: [{ status: "expected", results: [{ status: "passed", duration: 500 }] }],
              },
              {
                title: "stable test 2",
                tests: [{ status: "expected", results: [{ status: "passed", duration: 600 }] }],
              },
              {
                title: "flaky test 3",
                tests: [
                  {
                    status: "flaky",
                    results: [
                      { status: "failed", duration: 800, error: { message: "network timeout" } },
                      { status: "passed", duration: 700 },
                    ],
                  },
                ],
              },
              {
                title: "failed test 4",
                tests: [
                  {
                    status: "unexpected",
                    results: [{ status: "failed", duration: 900, error: { message: "assertion error" } }],
                  },
                ],
              },
            ],
          },
        ],
      })
    );

    const parsed = parseSystemTestResult({
      runner: "playwright",
      resultPath: reportPath,
      startedAt,
      finishedAt,
      rootDir,
    });

    expect(parsed.totalTests).toBe(4);
    expect(parsed.passedTests).toBe(2);
    expect(parsed.flakyTests).toBe(1);
    expect(parsed.failedTests).toBe(1);
    // 2 passed out of 4 total => 50%
    expect(parsed.stabilityScorePct).toBe(50);
  });

  it("normalizes Cypress JSON with test errors, duration, and stability score", () => {
    const rootDir = createTempDir({
      "cypress/e2e/payment.cy.js": [
        "describe('Payment', () => {",
        "  it('processes credit card', () => {",
        "    cy.get('input#card').type('4242');",
        "    cy.get('#submit-payment').click();",
        "  });",
        "});",
      ].join("\n"),
    });

    const reportPath = path.join(rootDir, "cypress-output.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        stats: { tests: 3, passes: 2, failures: 1, pending: 0, duration: 2400 },
        runs: [
          {
            spec: { relative: "cypress/e2e/payment.cy.js" },
            tests: [
              { title: ["Payment", "processes credit card"], state: "failed", displayError: "Timed out waiting for #submit-payment" },
              { title: ["Payment", "validates card number"], state: "passed" },
              { title: ["Payment", "shows security badge"], state: "passed" },
            ],
          },
        ],
      })
    );

    const parsed = parseSystemTestResult({
      runner: "cypress",
      resultPath: reportPath,
      startedAt,
      finishedAt,
      rootDir,
    });

    expect(parsed.totalTests).toBe(3);
    expect(parsed.passedTests).toBe(2);
    expect(parsed.failedTests).toBe(1);
    expect(parsed.status).toBe("FAILED");
    expect(parsed.stabilityScorePct).toBe(66.7);
    expect(parsed.scenarios).toHaveLength(3);

    const failingScenario = parsed.scenarios[0];
    expect(failingScenario.failureCategory).toBe("TIMEOUT");
    expect(failingScenario.failureStep).toContain("#submit-payment");
  });
});

