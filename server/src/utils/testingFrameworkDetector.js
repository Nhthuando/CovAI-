import fs from "fs";
import path from "path";

const FRAMEWORKS = [
    {
        name: "jest",
        configFiles: ["jest.config.js", "jest.config.cjs", "jest.config.mjs", "jest.config.ts"],
        packageKey: "jest",
    },
    {
        name: "vitest",
        configFiles: ["vitest.config.js", "vitest.config.cjs", "vitest.config.mjs", "vitest.config.ts"],
        packageKey: "vitest",
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

const classifyTestFile = (content) => {
    if (/@jest\/globals|\bjest\s*\./.test(content)) return "jest";
    if (/from\s+["']vitest["']|\bvi\s*\./.test(content)) return "vitest";
    return "unknown";
};

const discoverTestFiles = (rootDir, errors) => {
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
                if (!IGNORED_DIRECTORIES.has(entry.name)) visit(path.join(directory, entry.name), isTestDirectory || entry.name === "__tests__");
                continue;
            }
            if (!entry.isFile() || !(isTestDirectory || TEST_FILE_PATTERN.test(entry.name))) continue;
            if (!/\.[cm]?[jt]sx?$/i.test(entry.name)) continue;

            const filePath = path.join(directory, entry.name);
            let content = "";
            try {
                content = fs.readFileSync(filePath, "utf8");
            } catch {
                errors.push(`Unable to read test file: ${path.relative(rootDir, filePath)}`);
            }
            files.push({ path: path.relative(rootDir, filePath).split(path.sep).join("/"), framework: classifyTestFile(content) });
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
    const frameworks = FRAMEWORKS.map(({ name, configFiles, packageKey }) => {
        const configPaths = configFiles
            .map((file) => path.join(rootDir, file))
            .filter((file) => fs.existsSync(file));
        const dependencyTypes = DEPENDENCY_SECTIONS.filter((section) => Boolean(packageJson[section]?.[packageKey]));
        const frameworkScripts = Object.entries(scripts)
            .filter(([, command]) => typeof command === "string" && new RegExp(`\\b${packageKey}\\b`, "i").test(command))
            .map(([name, command]) => ({ name, command }));
        const hasPackageConfig = Boolean(packageJson[packageKey]);
        return { name, detected: Boolean(configPaths.length || dependencyTypes.length || frameworkScripts.length || hasPackageConfig), version: dependencyTypes.map((section) => packageJson[section][packageKey])[0] || null, configPaths, hasPackageConfig, scripts: frameworkScripts, dependencyTypes };
    });
    const detectedFrameworks = frameworks.filter(({ detected }) => detected).map(({ name }) => name);
    const testFiles = discoverTestFiles(rootDir, errors);
    return {
        frameworks,
        detectedFrameworks,
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
