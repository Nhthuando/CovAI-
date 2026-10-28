import fs from "fs";
import path from "path";

// Common configuration files used by Vitest
const VITEST_CONFIG_FILES = [
    "vitest.config.js",
    "vitest.config.ts",
    "vitest.config.mjs",
    "vitest.config.cjs",
    "vite.config.js",
    "vite.config.ts"
];

/**
 * Safety reads and parses a JSON file.
 * @param {string} filePath - The absolute path to the JSON file.
 * @return {object|null} - The parsed JSON object, or null if it fails.
 */
const readJsonFile = (filePath) => {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        return null;
    }
};

/**
 * Scans the project directory to detect Vitest configurations and dependencies.
 * @param {string} rootDir - The root directory of the extracted project.
 * @return {object} - An object containing the detection results.
 */
export function detectVitest(rootDir) {
    const result = {
        hasVitest: false,
        hasVitestConfigFile: false,
        hasVitestScript: false,
        hasVitestDependency: false,
        isMissingConfiguration: false,
        configPath: null,
        scripts: {},
        vitestCommand: null,
        version: null,
        rootDir: rootDir || null,
        packageJsonPath: null,
        errors: [],
    };

    if (!rootDir) {
        result.errors.push("Project rootDir is not defined");
        result.isMissingConfiguration = true;
        return result;
    }

    const packagePath = path.join(rootDir, "package.json");
    result.packageJsonPath = packagePath;

    // Check for the presence of any known Vitest/Vite config files
    for (const file of VITEST_CONFIG_FILES) {
        const fullPath = path.join(rootDir, file);
        if (fs.existsSync(fullPath)) {
            result.configPath = fullPath;
            result.hasVitestConfigFile = true;
            break;
        }
    }

    if (!fs.existsSync(packagePath)) {
        result.errors.push("package.json not found");
        result.hasVitest = result.hasVitestConfigFile;
        result.isMissingConfiguration = !result.hasVitest;
        return result;
    }

    const packageJson = readJsonFile(packagePath);
    if (!packageJson) {
        result.errors.push("Unable to parse package.json");
        result.hasVitest = result.hasVitestConfigFile;
        result.isMissingConfiguration = !result.hasVitest;
        return result;
    }

    result.scripts = packageJson.scripts || {};

    // Look for Vitest in the dependencies
    const vitestVersion =
        packageJson.dependencies?.vitest ||
        packageJson.devDependencies?.vitest ||
        packageJson.optionalDependencies?.vitest ||
        packageJson.peerDependencies?.vitest;

    result.version = vitestVersion || null;
    result.hasVitestDependency = !!vitestVersion;

    // Find any script that executes Vitest
    const scriptEntries = Object.entries(result.scripts || {});
    const vitestScripts = scriptEntries.filter(([, value]) =>
        typeof value === "string" && value.includes("vitest")
    );

    result.hasVitestScript = vitestScripts.length > 0;
    // Prioritize the first found script command
    result.vitestCommand = vitestScripts.length > 0 ? vitestScripts[0][1] : null;

    // The project is considered to have Vitest if any of these conditions are met
    result.hasVitest =
        result.hasVitestConfigFile ||
        result.hasVitestScript ||
        result.hasVitestDependency;

    // If user's installed the dependency but forgot to configure or add scripts
    result.isMissingConfiguration =
        result.hasVitestDependency &&
        !result.hasVitestConfigFile &&
        !result.hasVitestScript;

    return result;
}
