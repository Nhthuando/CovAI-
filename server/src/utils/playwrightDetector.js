import fs from "fs";
import path from "path";
import { detectTestingFrameworks } from "./testingFrameworkDetector.js";

function parsePlaywrightConfig(configPath) {
  let testDir = "tests"; // default Playwright directory
  let browsers = [];

  if (configPath && fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf8");

      // Extract testDir (e.g., testDir: './e2e')
      const testDirMatch = content.match(/testDir\s*:\s*['"]([^'"]+)['"]/);
      if (testDirMatch && testDirMatch[1]) {
        testDir = testDirMatch[1];
      }

      // Extract browser names from projects array (e.g., { name: 'chromium' })
      const nameRegex = /name\s*:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = nameRegex.exec(content)) !== null) {
        if (match[1] && !browsers.includes(match[1])) {
          browsers.push(match[1]);
        }
      }
    } catch (error) {
      // Ignore parse errors, fallback to default configuration
    }
  }

  return {
    testDir,
    browsers: browsers.length > 0 ? browsers.join(",") : null,
  };
}

export function detectPlaywright(rootDir) {
  const testingFrameworks = detectTestingFrameworks(rootDir);
  const playwright = testingFrameworks.frameworks.find(
    ({ name }) => name === "playwright",
  );

  let configPath = playwright?.configPaths[0] || null;
  if (!configPath) {
    const monorepoConfigs = [
      path.join(rootDir, "client", "playwright.config.ts"),
      path.join(rootDir, "client", "playwright.config.js"),
      path.join(rootDir, "frontend", "playwright.config.ts"),
      path.join(rootDir, "frontend", "playwright.config.js"),
    ];
    configPath = monorepoConfigs.find((cfg) => fs.existsSync(cfg)) || null;
  }

  const configMeta = parsePlaywrightConfig(configPath);

  // Filter test files that belong to the testDir or are explicitly imported from @playwright/test
  const allTestFiles = testingFrameworks.testFiles;
  const systemTestFiles = allTestFiles.filter((file) => {
    const filePath = typeof file === "string" ? file : file.path;
    if (/(?:^|\/)cypress\//i.test(filePath) || /\.cy\./i.test(filePath))
      return false;
    return (
      filePath.startsWith(configMeta.testDir) || file.framework === "playwright"
    );
  });

  const hasPlaywright = Boolean(
    playwright?.detected || configPath || systemTestFiles.length > 0,
  );
  const command =
    playwright?.scripts[0]?.command ||
    (hasPlaywright ? "npx playwright test" : null);

  return {
    hasPlaywright,
    configPath: configPath
      ? path.relative(rootDir, configPath).replace(/\\/g, "/")
      : null,
    playwrightCommand: command,
    testDir: configMeta.testDir,
    browsers: configMeta.browsers,
    packageVersion: playwright?.version || null,
    testFiles: systemTestFiles,
    rootDir: rootDir || null,
    errors: testingFrameworks.errors,
  };
}
