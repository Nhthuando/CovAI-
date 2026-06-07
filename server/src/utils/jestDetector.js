import fs from "fs";
import path from "path";

const JEST_CONFIG_FILES = [
    "jest.config.js",
    "jest.config.cjs",
    "jest.config.mjs",
    "jest.config.ts",
];

export function detectJest(rootDir) {
    const result = {
        hasJest: false,
        configPath: null,
        packageJsonConfig: null,
        scripts: {},
        jestCommand: null,
        version: null,
    };

    if (!rootDir) return result;

    const packagePath = path.join(rootDir, "package.json");

    for (const file of JEST_CONFIG_FILES) {
        const fullPath = path.join(rootDir, file);

        if (fs.existsSync(fullPath)) {
            result.configPath = fullPath;
            break;
        }
    }

    if (!fs.existsSync(packagePath)) {
        result.hasJest = !!result.configPath;
        return result;
    }

    const packageJson = JSON.parse(
        fs.readFileSync(packagePath, "utf8")
    );

    result.packageJsonConfig = packageJson.jest || null;
    result.scripts = packageJson.scripts || {};

    const jestVersion =
        packageJson.dependencies?.jest ||
        packageJson.devDependencies?.jest;

    result.version = jestVersion || null;

    const scripts = Object.values(result.scripts);

    result.jestCommand =
        scripts.find(script =>
            typeof script === "string" &&
            script.includes("jest")
        ) || null;

    result.hasJest =
        !!jestVersion ||
        !!result.configPath ||
        !!result.packageJsonConfig ||
        !!result.jestCommand;

    return result;
}