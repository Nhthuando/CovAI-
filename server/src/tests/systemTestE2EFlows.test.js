import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, afterEach } from "@jest/globals";
import { detectSystemTestFrameworks } from "../services/systemTestFrameworkDetection.service.js";
import { resolveSystemTestExecution } from "../services/systemTestDetection.service.js";
import { parseSystemTestResult } from "../services/systemTestResultParser.service.js";
import { calculateSystemCoverage } from "../services/systemCoverageEngine.service.js";
import {
  generateColdStartSystemTests,
  ensureSystemTestConfig,
} from "../services/verifiedSystemGeneration.service.js";
import { optimizeSystemTest } from "../services/systemTestBooster.service.js";
import { validateGeneratedTestCode } from "../validators/aiTestCode.validator.js";

const tmpDirs = [];
const createTempDir = (files = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase7-e2e-"));
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

describe("Phase 7.2 - E2E Scenario A: Project With Existing Tests (Detection, Run & Breakpoints)", () => {
  it("detects existing Playwright tests, executes, detects breakpoint failure on broken test, and calculates coverage", async () => {
    const rootDir = createTempDir({
      "package.json": JSON.stringify({
        name: "online-food-store",
        scripts: { "test:e2e": "playwright test" },
        devDependencies: { "@playwright/test": "^1.40.0" },
      }),
      "playwright.config.js": "export default { testDir: './tests/e2e' };",
      "src/components/Cart.jsx": `
        export default function Cart({ items }) {
          if (!items.length) return <p>Empty Cart</p>;
          return <button id="checkout-btn">Checkout</button>;
        }
      `,
      "tests/e2e/cart.spec.js": [
        "import { test, expect } from '@playwright/test';",
        "test.describe('Cart Flow', () => {",
        "  test('displays empty cart', async ({ page }) => {",
        "    await page.goto('/cart');",
        "    await expect(page.locator('text=Empty Cart')).toBeVisible();",
        "  });",
        "  test('proceeds to checkout', async ({ page }) => {",
        "    await page.goto('/cart');",
        "    await page.click('#checkout-btn');",
        "  });",
        "});",
      ].join("\n"),
    });

    // 1. Detection Phase
    const detection = await detectSystemTestFrameworks(rootDir);
    expect(detection.hasSystemTests).toBe(true);
    expect(detection.hasTestFiles).toBe(true);
    expect(detection.isZeroTestProject).toBe(false);
    expect(detection.totalFilesCount).toBe(1);
    expect(detection.totalScenariosCount).toBe(2);

    const exec = resolveSystemTestExecution({ rootDir });
    expect(exec.runner).toBe("playwright");
    expect(exec.command).toContain("test:e2e");

    // 2. Simulated runner output with 1 pass and 1 intentional broken test (breakpoint)
    const reportPath = path.join(rootDir, "playwright-report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        stats: { duration: 2500 },
        suites: [
          {
            title: "cart.spec.js",
            file: "tests/e2e/cart.spec.js",
            specs: [
              {
                title: "displays empty cart",
                tests: [{ status: "expected", results: [{ status: "passed", duration: 800 }] }],
              },
              {
                title: "proceeds to checkout",
                tests: [
                  {
                    status: "unexpected",
                    results: [
                      {
                        status: "timedOut",
                        duration: 1700,
                        error: {
                          message: "Timed out 5000ms waiting for locator('#checkout-btn')",
                          stack:
                            "Error: Timed out 5000ms waiting for locator('#checkout-btn')\n    at tests/e2e/cart.spec.js:9:16",
                        },
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

    // 3. Result parsing & Breakpoint detection
    const parsed = parseSystemTestResult({
      runner: "playwright",
      resultPath: reportPath,
      startedAt: new Date(),
      finishedAt: new Date(),
      rootDir,
    });

    expect(parsed.totalTests).toBe(2);
    expect(parsed.passedTests).toBe(1);
    expect(parsed.failedTests).toBe(1);
    expect(parsed.status).toBe("FAILED");

    const failedScenario = parsed.scenarios.find((s) => s.status === "failed");
    expect(failedScenario).toBeDefined();
    expect(failedScenario.failureCategory).toBe("TIMEOUT");
    expect(failedScenario.failureStep).toContain("#checkout-btn");
    expect(failedScenario.failureCodeSnippet).toContain("await page.click('#checkout-btn')");

    // 4. Coverage Engine calculation
    const coverageDir = path.join(rootDir, "coverage");
    const covResult = await calculateSystemCoverage({
      snapshotRootDir: rootDir,
      coverageDir,
      scenarios: parsed.scenarios,
    });

    expect(covResult.summary).toBeDefined();
    expect(covResult.summary.linesPct).toBeGreaterThanOrEqual(0);
    expect(covResult.fileBreakdown).toHaveLength(1);
    expect(Object.keys(covResult.scenarioContributions)).toHaveLength(2);
  });
});

describe("Phase 7.2 - E2E Scenario B: Clean Project Without Tests (Zero-Test & AI Cold-Start Flow)", () => {
  it("detects zero-test state, auto-generates cold start test suite, validates AST, and produces initial test file", async () => {
    const rootDir = createTempDir({
      "package.json": JSON.stringify({
        name: "clean-react-project",
        dependencies: { react: "^18.2.0" },
      }),
      "src/pages/HomePage.jsx": `
        export default function HomePage() {
          return <div>Welcome to Clean App</div>;
        }
      `,
      "src/pages/LoginPage.jsx": `
        export default function LoginPage() {
          return (
            <form>
              <input name="email" type="email" placeholder="Email" />
              <input name="password" type="password" />
              <button type="submit">Sign In</button>
            </form>
          );
        }
      `,
    });

    // 1. Initial detection detects zero-test state
    const detectionBefore = await detectSystemTestFrameworks(rootDir);
    expect(detectionBefore.hasTestFiles).toBe(false);
    expect(detectionBefore.isZeroTestProject).toBe(true);
    expect(detectionBefore.totalFilesCount).toBe(0);

    // 2. Ensure test configuration and generate cold-start test suite
    await ensureSystemTestConfig({ rootDir, framework: "playwright" });
    const configCreated =
      fs.existsSync(path.join(rootDir, "playwright.config.mjs")) ||
      fs.existsSync(path.join(rootDir, "playwright.config.js"));
    expect(configCreated).toBe(true);

    const generated = await generateColdStartSystemTests({
      rootDir,
      framework: "playwright",
      targetRoutes: ["/", "/login"],
    });

    expect(generated.filePath).toBeDefined();
    expect(generated.code).toBeDefined();
    expect(generated.scenarioCount).toBeGreaterThanOrEqual(1);

    // 3. Verify file exists on disk
    const absoluteTestPath = path.join(rootDir, generated.filePath);
    expect(fs.existsSync(absoluteTestPath)).toBe(true);

    // 4. Verify AST syntax and safety
    const codeContent = fs.readFileSync(absoluteTestPath, "utf8");
    const astValidation = validateGeneratedTestCode(codeContent);
    expect(astValidation.valid).toBe(true);
    expect(astValidation.ast).toBeDefined();

    // 5. Subsequent detection discovers newly generated test suite
    const detectionAfter = await detectSystemTestFrameworks(rootDir);
    expect(detectionAfter.hasSystemTests).toBe(true);
    expect(detectionAfter.hasTestFiles).toBe(true);
    expect(detectionAfter.isZeroTestProject).toBe(false);
    expect(detectionAfter.totalFilesCount).toBe(1);
  });
});

describe("Phase 7.2 - E2E Scenario C: Test Editor & AI Booster Flow (Coverage Boost & Breakpoint Fix)", () => {
  it("boosts coverage with edge cases, fixes broken locator, and enforces AST safety", async () => {
    const rootDir = createTempDir({
      "package.json": JSON.stringify({
        name: "test-editor-project",
        devDependencies: { "@playwright/test": "^1.40.0" },
      }),
      "src/pages/Contact.jsx": `
        export default function Contact() {
          return (
            <form id="contact-form">
              <input name="name" required />
              <input name="email" type="email" required />
              <button type="submit" id="submit-btn">Send</button>
            </form>
          );
        }
      `,
      "tests/e2e/contact.spec.js": [
        "import { test, expect } from '@playwright/test';",
        "test.describe('Contact Us', () => {",
        "  test('submits valid message', async ({ page }) => {",
        "    await page.goto('/contact');",
        "    await page.fill('input[name=\"name\"]', 'Alice');",
        "    await page.fill('input[name=\"email\"]', 'alice@example.com');",
        "    await page.click('#submit-btn');",
        "  });",
        "});",
      ].join("\n"),
    });

    const testRelPath = "tests/e2e/contact.spec.js";

    // 1. AI BOOST_COVERAGE mode: generates boundary/validation test cases
    const boosted = await optimizeSystemTest({
      rootDir,
      filePath: testRelPath,
      mode: "BOOST_COVERAGE",
      instruction: "Add validation test for empty fields",
    });

    expect(boosted.success).toBe(true);
    expect(boosted.optimizedCode).toContain("validation");
    // Verify AST safety of boosted code
    expect(validateGeneratedTestCode(boosted.optimizedCode).valid).toBe(true);

    // 2. AI FIX_BREAKPOINT mode: repairs broken locator
    const fixed = await optimizeSystemTest({
      rootDir,
      filePath: testRelPath,
      scenarioData: {
        failureCategory: "TIMEOUT",
        failureStep: "await page.click('#broken-button-id')",
        failureCodeSnippet: "await page.click('#broken-button-id');",
        errorMessage: "Timed out 5000ms waiting for locator('#broken-button-id')",
      },
      mode: "FIX_BREAKPOINT",
      instruction: "Use text query instead of broken id",
    });

    expect(fixed.success).toBe(true);
    expect(fixed.optimizedCode).toBeDefined();
    expect(validateGeneratedTestCode(fixed.optimizedCode).valid).toBe(true);

    // 3. Persist optimized code back to disk
    const targetFile = path.join(rootDir, testRelPath);
    fs.writeFileSync(targetFile, fixed.optimizedCode, "utf8");

    // 4. Verify test framework detection detects updated scenarios
    const updatedDetection = await detectSystemTestFrameworks(rootDir);
    expect(updatedDetection.hasTestFiles).toBe(true);
    expect(updatedDetection.totalFilesCount).toBe(1);
    expect(updatedDetection.totalScenariosCount).toBeGreaterThanOrEqual(1);
  });
});

