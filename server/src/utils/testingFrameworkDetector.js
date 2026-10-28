import fs from "fs";
import path from "path";

const FRAMEWORKS = [
    {
        name: "jest",
        configFiles: ["jest.config.js", "jest.config.cjs", "jest.config.mjs", "jest.config.ts", "jest.config.json"],
        packageKey: "jest",
    },
    {
        name: "vitest",
        configFiles: ["vitest.config.js", "vitest.config.cjs", "vitest.config.mjs", "vitest.config.ts", "vitest.config.mts"],
        packageKey: "vitest",
    },
    {
        name: "playwright",
        configFiles: ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs", "playwright.config.cjs"],
        packageKey: "@playwright/test",
    },
];

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "coverage", "dist", "build", ".next", ".vite", ".vitest"]);
const TEST_FILE_PATTERN = /(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/i;

const readPackageJson = (packagePath, errors) => {
    if (!fs.existsSync(packagePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(packagePath, "utf8"));
    } catch {
        errors.push("Unable to parse package.json");
        return null;
    }
};

const HELPER_FILE_PATTERN = /^(setup|global-?setup|setup-?tests|teardown|helpers?|mocks?|fixtures?|config|utils?)\.[cm]?[jt]sx?$/i;

export const classifyTestFile = (content, filePath = "", detectedUnitFrameworks = []) => {
    const lowerContent = (content || "").toLowerCase();
    const lowerPath = (filePath || "").toLowerCase();

    if (lowerPath.includes("supertest") || lowerContent.includes("supertest") || lowerContent.includes("request(app)")) return "supertest";
    if (lowerPath.includes("playwright") || lowerContent.includes("@playwright/test") || lowerContent.includes("page.goto")) return "playwright";
    if (lowerPath.includes("cypress") || lowerContent.includes("cypress")) return "cypress";

    // Vitest detection
    const isVitest = lowerPath.includes(".vitest.") ||
        lowerPath.includes("vitest") ||
        lowerContent.includes("from 'vitest'") ||
        lowerContent.includes('from "vitest"') ||
        lowerContent.includes("require('vitest')") ||
        lowerContent.includes('require("vitest")') ||
        /\bvi\s*\./.test(content);

    // Jest detection
    const isJest = lowerPath.includes(".jest.") ||
        lowerPath.includes("jest") ||
        lowerContent.includes("@jest/") ||
        lowerContent.includes("from 'jest'") ||
        lowerContent.includes('from "jest"') ||
        /\bjest\s*\./.test(content) ||
        lowerContent.includes("// jest") ||
        lowerContent.includes("/* jest");

    if (isVitest && !isJest) return "vitest";
    if (isJest && !isVitest) return "jest";
    if (isVitest) return "vitest";
    if (isJest) return "jest";

    // Fallback: If test file doesn't import vitest or use vi., but uses describe/test/expect
    if (!lowerContent.includes("vitest") && !/\bvi\s*\./.test(content)) {
        return "jest";
    }

    // Default unit test framework classification if test file uses standard BDD globals (describe/test/it/expect)
    if (detectedUnitFrameworks.includes("vitest")) return "vitest";
    if (detectedUnitFrameworks.includes("jest")) return "jest";
    return "vitest";
};

const discoverTestFiles = (rootDir, errors, detectedUnitFrameworks = []) => {
    const files = [];
    const visit = (directory, isTestDirectory = false) => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            errors.push(`Unable to read directory: ${path.relative(rootDir, directory) || "."}`);
            return;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const inTestDir = isTestDirectory || /^(tests?|__tests__|specs?|unit)$/i.test(entry.name);
                if (!IGNORED_DIRECTORIES.has(entry.name)) visit(path.join(directory, entry.name), inTestDir);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!/\.[cm]?[jt]sx?$/i.test(entry.name)) continue;
            if (HELPER_FILE_PATTERN.test(entry.name)) continue;

            const isTestFileName = TEST_FILE_PATTERN.test(entry.name);
            const isTestFile = isTestDirectory || isTestFileName;
            if (!isTestFile) continue;

            const filePath = path.join(directory, entry.name);
            const relPath = path.relative(rootDir, filePath).split(path.sep).join("/");
            const lowerRel = relPath.toLowerCase();

            // Exclude fixture, mock, test-data folders and naming conventions unless it is an explicit test file name
            const isHelperDir = !isTestFileName && /(^|\/)(test-data|test_data|fixtures?|helpers?|mocks?|__mocks__|utils?|support)\//i.test(lowerRel);
            if (isHelperDir) continue;

            let content = "";
            try {
                content = fs.readFileSync(filePath, "utf8");
            } catch {
                errors.push(`Unable to read test file: ${path.relative(rootDir, filePath)}`);
            }

            // Exclude non-test files without test blocks (e.g. fixtures/mocks placed in tests/)
            const hasAnyTest = /\b(test|it|describe|scenario|suite)\s*\(/i.test(content);
            if (!hasAnyTest && !isTestFileName) continue;

            files.push({ path: relPath, framework: classifyTestFile(content, relPath, detectedUnitFrameworks) });
        }
    };
    visit(rootDir);
    return files.sort((left, right) => left.path.localeCompare(right.path));
};

export function detectTestingFrameworks(rootDir) {
    const errors = [];
    if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
        errors.push("Project rootDir does not exist");
        return { frameworks: [], detectedFrameworks: [], primaryFramework: null, frameworkType: "none", hasMultipleFrameworks: false, testFiles: [], testFileCount: 0, errors };
    }

    const packageJson = readPackageJson(path.join(rootDir, "package.json"), errors) || {};
    const scripts = packageJson.scripts || {};

    // Check subpackage package.json files (e.g. backend/package.json, packages/*/package.json)
    const subPackages = [];
    try {
        for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
            if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
                const subPkgPath = path.join(rootDir, entry.name, "package.json");
                if (fs.existsSync(subPkgPath)) {
                    subPackages.push({ dir: entry.name, pkg: readPackageJson(subPkgPath, errors) || {} });
                }
            }
        }
    } catch { }

    const frameworks = FRAMEWORKS.map(({ name, configFiles, packageKey }) => {
        const configPaths = configFiles
            .map((file) => path.join(rootDir, file))
            .filter((file) => fs.existsSync(file));

        // Also check config files in subdirectories (e.g. backend/vitest.config.js, examples/vitest/vitest.config.mts)
        for (const sub of subPackages) {
            for (const file of configFiles) {
                const subCfg = path.join(rootDir, sub.dir, file);
                if (fs.existsSync(subCfg) && !configPaths.includes(subCfg)) {
                    configPaths.push(subCfg);
                }
            }
        }

        const allPkgs = [packageJson, ...subPackages.map(s => s.pkg)];
        const dependencyTypes = DEPENDENCY_SECTIONS.filter((section) => allPkgs.some(p => Boolean(p[section]?.[packageKey])));
        const frameworkScripts = Object.entries(scripts)
            .filter(([, command]) => typeof command === "string" && new RegExp(`\\b${packageKey}\\b`, "i").test(command))
            .map(([name, command]) => ({ name, command }));
        const hasPackageConfig = allPkgs.some(p => Boolean(p[packageKey]));
        return { name, detected: Boolean(configPaths.length || dependencyTypes.length || frameworkScripts.length || hasPackageConfig), version: dependencyTypes.map((section) => packageJson[section]?.[packageKey])[0] || null, configPaths, hasPackageConfig, scripts: frameworkScripts, dependencyTypes };
    });

    const detectedUnitFrameworks = frameworks.filter(f => f.detected && (f.name === "vitest" || f.name === "jest")).map(f => f.name);
    const testFiles = discoverTestFiles(rootDir, errors, detectedUnitFrameworks);
    const testFileFrameworks = new Set(testFiles.map(f => f.framework).filter(f => f && f !== "unknown"));

    frameworks.forEach(f => {
        if (testFileFrameworks.has(f.name)) {
            f.detected = true;
        }
    });

    let detectedFrameworks = frameworks.filter(({ detected }) => detected).map(({ name }) => name);

    // If no config/package.json framework detected but test files found, populate from test files
    if (detectedFrameworks.length === 0 && testFiles.length > 0) {
        if (testFileFrameworks.has("vitest")) {
            detectedFrameworks.push("vitest");
        } else if (testFileFrameworks.has("jest")) {
            detectedFrameworks.push("jest");
        } else {
            detectedFrameworks.push("vitest", "jest");
        }
    }

    const unit = detectedFrameworks.filter(f => f === "vitest" || f === "jest");

    return {
        frameworks,
        detectedFrameworks,
        unit,
        primaryFramework: detectedFrameworks[0] || null,
        frameworkType: detectedFrameworks.length > 1 ? "multiple" : detectedFrameworks.length === 1 ? "single" : "none",
        hasMultipleFrameworks: detectedFrameworks.length > 1,
        testFiles,
        testFileCount: testFiles.length,
        errors,
    };
}

export function getJestCompatibilityMetadata(detection) {
    const jest = detection.frameworks.find(({ name }) => name === "jest");
    return {
        hasJest: Boolean(jest?.detected),
        configPath: jest?.configPaths[0] || null,
        jestCommand: jest?.scripts[0]?.command || null,
    };
}
