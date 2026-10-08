import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, afterEach } from "@jest/globals";
import {
  categorizeFailureReason,
  extractFailureStep,
  extractFailureCodeSnippet,
  extractDomSnapshot,
  analyzeFailureBreakpoint,
} from "../services/failureBreakpointAnalyzer.service.js";
import {
  readIstanbulCoverageArtifacts,
  calculateSystemCoverage,
} from "../services/systemCoverageEngine.service.js";
import {
  resolveCypressCommand,
  ensureCypressPrerequisites,
} from "../services/systemTestRunner.service.js";
import { parseSystemTestResult } from "../services/systemTestResultParser.service.js";

const tempDirs = [];
const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase3-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
});

describe("Phase 3: Execution & Coverage Engine", () => {
  describe("Task 3.1: Cypress Runner Prerequisites & Command Resolution", () => {
    it("creates default cypress.config.js when none exists", () => {
      const dir = createTempDir();
      ensureCypressPrerequisites(dir, 5173);

      const configPath = path.join(dir, "cypress.config.js");
      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, "utf8");
      expect(content).toContain("http://localhost:5173");
      expect(fs.existsSync(path.join(dir, "cypress/e2e"))).toBe(true);
    });

    it("resolves cypress command to local binary if present", () => {
      const dir = createTempDir();
      const cypressCli = path.join(dir, "node_modules", "cypress", "bin", "cypress");
      fs.mkdirSync(path.dirname(cypressCli), { recursive: true });
      fs.writeFileSync(cypressCli, "#!/usr/bin/env node");

      const resolved = resolveCypressCommand(dir, "npx cypress run");
      expect(resolved).toContain(cypressCli);

      // If CLI does not exist, leaves command intact
      const unmanaged = resolveCypressCommand(dir, "npx vitest run");
      expect(unmanaged).toBe("npx vitest run");
    });
  });

  describe("Task 3.3: Failure Breakpoint Engine", () => {
    it("categorizes failure causes accurately", () => {
      expect(categorizeFailureReason("Timeout 30000ms exceeded while waiting for selector")).toBe("TIMEOUT");
      expect(categorizeFailureReason("Element not found: button#submit")).toBe("ELEMENT_NOT_FOUND");
      expect(categorizeFailureReason("AssertionError: expected true to be false")).toBe("ASSERTION_FAILED");
      expect(categorizeFailureReason("Failed with status code 500 Internal Server Error")).toBe("SERVER_ERROR");
      expect(categorizeFailureReason("page.goto: net::ERR_CONNECTION_REFUSED")).toBe("SERVER_ERROR");
      expect(categorizeFailureReason("Navigation failed: invalid URL")).toBe("NAVIGATION_ERROR");
      expect(categorizeFailureReason("TypeError: Cannot read property 'map' of undefined")).toBe("SYNTAX_ERROR");
      expect(categorizeFailureReason("Custom business failure")).toBe("GENERAL_ERROR");
    });

    it("extracts failure step from snippet, call log, or message", () => {
      const pwSnippet = `
        24 | await page.goto('/login');
      > 25 | await page.click('button#checkout');
        26 | await expect(page.locator('.success')).toBeVisible();
      `;
      expect(extractFailureStep({ snippet: pwSnippet })).toBe("await page.click('button#checkout');");

      const callLogMsg = "Timed out waiting for locator('button.submit-btn')";
      expect(extractFailureStep({ message: callLogMsg })).toBe("waiting for locator('button.submit-btn')");

      const cyMsg = "Expected to find element: `button#pay-now`, but never found it.";
      expect(extractFailureStep({ message: cyMsg })).toBe("cy.get('button#pay-now')");
    });

    it("extracts failure code snippet from disk based on stack trace line number", () => {
      const dir = createTempDir();
      const testFile = "tests/e2e/login.spec.js";
      const fullPath = path.join(dir, testFile);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(
        fullPath,
        `import { test, expect } from '@playwright/test';
test('login', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#user', 'admin');
  await page.click('#submit-btn');
  await expect(page).toHaveURL('/dashboard');
});`
      );

      const stack = `Error: Timed out waiting for element
    at Object.<anonymous> (${fullPath}:5:15)`;

      const snippet = extractFailureCodeSnippet({ stack, testFile, rootDir: dir });
      expect(snippet).toContain("> 5 |   await page.click('#submit-btn');");
      expect(snippet).toContain("4 |   await page.fill('#user', 'admin');");
    });

    it("extracts DOM snapshot snippet from error text or page snapshot", () => {
      const errorMsg = 'Received: <div class="toast-error">Invalid Credentials</div>';
      const dom = extractDomSnapshot(errorMsg);
      expect(dom).toBe('<div class="toast-error">Invalid Credentials</div>');

      const pageSnapshot = '<html><body><h1>Dashboard</h1><button id="logout">Logout</button></body></html>';
      const fromPage = extractDomSnapshot("", pageSnapshot);
      expect(fromPage).toContain('<button id="logout">Logout</button>');
    });

    it("runs complete analyzeFailureBreakpoint and packages all diagnostics", () => {
      const result = analyzeFailureBreakpoint({
        message: "Timeout 5000ms exceeded waiting for locator('#checkout')\nReceived: <button disabled>Checkout</button>",
        stack: "at tests/e2e/cart.spec.js:18:22",
        snippet: "> 18 | await page.click('#checkout');",
      });

      expect(result.failureCategory).toBe("TIMEOUT");
      expect(result.failureStep).toBe("await page.click('#checkout');");
      expect(result.domSnapshot).toBe("<button disabled>Checkout</button>");
    });
  });

  describe("Task 3.2: System Code Coverage Engine", () => {
    it("reads real Istanbul coverage-summary.json if present", () => {
      const dir = createTempDir();
      const summaryFile = path.join(dir, "coverage-summary.json");
      fs.writeFileSync(
        summaryFile,
        JSON.stringify({
          total: {
            lines: { pct: 82.5 },
            branches: { pct: 75.0 },
            statements: { pct: 81.0 },
            functions: { pct: 90.0 },
          },
        })
      );

      const parsed = readIstanbulCoverageArtifacts(dir);
      expect(parsed).toEqual({
        linesPct: 82.5,
        branchesPct: 75.0,
        statementsPct: 81.0,
        functionsPct: 90.0,
        isIstanbulArtifact: true,
      });
    });

    it("computes synthetic route and component coverage when raw Istanbul artifacts are absent", () => {
      const scenarios = [
        { title: "Smoke Test: Loads root", suiteName: "App", status: "passed", durationMs: 400, testFile: "tests/e2e/app.spec.js" },
        { title: "Navigation: Navigates to /login", suiteName: "Auth", status: "passed", durationMs: 500, testFile: "tests/e2e/auth.spec.js" },
        { title: "Navigation: Navigates to /dashboard", suiteName: "Dashboard", status: "passed", durationMs: 600, testFile: "tests/e2e/app.spec.js" },
        { title: "Action: Submits checkout form on Cart", suiteName: "Cart", status: "failed", durationMs: 2000, testFile: "tests/e2e/cart.spec.js" },
      ];

      const harvestedContext = {
        routes: ["/", "/login", "/dashboard", "/cart", "/settings"],
        uiActions: [
          { component: "Cart.jsx", buttons: ["Checkout"], inputs: ["coupon"] },
          { component: "Login.jsx", buttons: ["Sign in"], inputs: ["email"] },
        ],
        clientApiCalls: ["/api/login", "/api/checkout"],
      };

      const coverage = calculateSystemCoverage({
        scenarios,
        harvestedContext,
      });

      expect(coverage.summary.totalRoutes).toBe(5);
      expect(coverage.summary.coveredRoutes).toBeGreaterThanOrEqual(3);
      expect(coverage.summary.routeCoveragePct).toBeGreaterThanOrEqual(60);
      expect(coverage.summary.linesPct).toBeGreaterThan(0);
      expect(coverage.summary.branchesPct).toBeGreaterThan(0);
      expect(coverage.summary.statementsPct).toBeGreaterThan(0);
      expect(coverage.summary.functionsPct).toBeGreaterThan(0);

      // Check scenario contributions
      expect(coverage.scenarioContributions["Smoke Test: Loads root"].linesPct).toBeGreaterThan(0);
      expect(coverage.scenarioContributions["Action: Submits checkout form on Cart"].linesPct).toBeGreaterThan(0);

      // Check test file breakdown
      expect(coverage.fileBreakdown.length).toBe(3);
      const appFile = coverage.fileBreakdown.find((f) => f.filePath === "tests/e2e/app.spec.js");
      expect(appFile).toBeDefined();
      expect(appFile.scenarioCount).toBe(2);
      expect(appFile.status).toBe("PASSED");
    });
  });

  describe("Task 3.4: Quality & Stability Metrics", () => {
    it("calculates stabilityScorePct and captures failure breakpoint in parseSystemTestResult", () => {
      const dir = createTempDir();
      const reportFile = path.join(dir, "cypress-report.json");
      fs.writeFileSync(
        reportFile,
        JSON.stringify({
          stats: { tests: 4, passes: 3, failures: 1, duration: 1500 },
          runs: [
            {
              spec: { relative: "cypress/e2e/auth.cy.js" },
              tests: [
                { title: ["Auth", "login valid"], state: "passed", duration: 300 },
                { title: ["Auth", "login invalid"], state: "passed", duration: 250 },
                { title: ["Auth", "forgot password"], state: "passed", duration: 350 },
                {
                  title: ["Auth", "sso login"],
                  state: "failed",
                  duration: 600,
                  displayError: "AssertionError: Timed out retrying: Expected to find element: `button#sso`\n    at Context.eval (cypress/e2e/auth.cy.js:40:10)",
                },
              ],
            },
          ],
        })
      );

      const parsed = parseSystemTestResult({
        runner: "cypress",
        resultPath: reportFile,
        startedAt: new Date("2026-10-07T00:00:00Z"),
        finishedAt: new Date("2026-10-07T00:00:02Z"),
        rootDir: dir,
      });

      expect(parsed.totalTests).toBe(4);
      expect(parsed.passedTests).toBe(3);
      expect(parsed.failedTests).toBe(1);
      expect(parsed.stabilityScorePct).toBe(75.0);

      const failedScenario = parsed.scenarios.find((s) => s.status === "failed");
      expect(failedScenario).toBeDefined();
      expect(failedScenario.failureCategory).toBe("TIMEOUT");
      expect(failedScenario.failureStep).toBe("cy.get('button#sso')");
    });
  });
});

