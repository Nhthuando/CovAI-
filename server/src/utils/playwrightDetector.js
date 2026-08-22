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
    const playwright = testingFrameworks.frameworks.find(({ name }) => name === "playwright");

    const configPath = playwright?.configPaths[0] || null;
    const configMeta = parsePlaywrightConfig(configPath);

    // Filter test files that belong to the testDir or are explicitly imported from @playwright/test
    const allTestFiles = testingFrameworks.testFiles;
    const systemTestFiles = allTestFiles.filter(file => {
        return file.path.startsWith(configMeta.testDir) || file.framework === "playwright";
    });

    return {
        hasPlaywright: Boolean(playwright?.detected),
        configPath: configPath ? path.relative(rootDir, configPath).replace(/\\/g, "/") : null,
        playwrightCommand: playwright?.scripts[0]?.command || null,
        testDir: configMeta.testDir,
        browsers: configMeta.browsers,
        testFiles: systemTestFiles,
        rootDir: rootDir || null,
        errors: testingFrameworks.errors,
    };
}
