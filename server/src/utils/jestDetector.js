import fs from "fs";
import path from "path";

const JEST_CONFIG_FILES = [
    "jest.config.js",
    "jest.config.cjs",
    "jest.config.mjs",
    "jest.config.ts",
];

const readJsonFile = (filePath) => {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        return null;
    }
};

export function detectJest(rootDir) {
    const result = {
        hasJest: false,
        hasJestConfigFile: false,
        hasPackageJestConfig: false,
        hasJestScript: false,
        hasJestDependency: false,
        isMissingConfiguration: false,
        configPath: null,
        packageJsonConfig: null,
        scripts: {},
        jestCommand: null,
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

    for (const file of JEST_CONFIG_FILES) {
        const fullPath = path.join(rootDir, file);

        if (fs.existsSync(fullPath)) {
            result.configPath = fullPath;
            result.hasJestConfigFile = true;
            break;
        }
    }

    if (!fs.existsSync(packagePath)) {
        result.errors.push("package.json not found");
        result.hasJest = result.hasJestConfigFile;
        result.isMissingConfiguration = !result.hasJest;
        return result;
    }

    const packageJson = readJsonFile(packagePath);
    if (!packageJson) {
        result.errors.push("Unable to parse package.json");
        result.hasJest = result.hasJestConfigFile;
        result.isMissingConfiguration = !result.hasJest;
        return result;
    }

    result.packageJsonConfig = packageJson.jest || null;
    result.hasPackageJestConfig = !!result.packageJsonConfig;
    result.scripts = packageJson.scripts || {};

    const jestVersion =
        packageJson.dependencies?.jest ||
        packageJson.devDependencies?.jest ||
        packageJson.optionalDependencies?.jest ||
        packageJson.peerDependencies?.jest;

    result.version = jestVersion || null;
    result.hasJestDependency = !!jestVersion;

    const scriptEntries = Object.entries(result.scripts || {});
    const jestScripts = scriptEntries.filter(([, value]) =>
        typeof value === "string" && value.includes("jest")
    );

    result.hasJestScript = jestScripts.length > 0;
    result.jestCommand = jestScripts.length > 0 ? jestScripts[0][1] : null;

    result.hasJest =
        result.hasJestConfigFile ||
        result.hasPackageJestConfig ||
        result.hasJestScript ||
        result.hasJestDependency;

    result.isMissingConfiguration =
        result.hasJestDependency &&
        !result.hasJestConfigFile &&
        !result.hasPackageJestConfig &&
        !result.hasJestScript;

    return result;
}