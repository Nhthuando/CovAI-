import fs from "fs";
import path from "path";
import { detectTestingFrameworks, getJestCompatibilityMetadata } from "./testingFrameworkDetector.js";

export function detectJest(rootDir) {
    const testingFrameworks = detectTestingFrameworks(rootDir);
    const metadata = getJestCompatibilityMetadata(testingFrameworks);
    const jest = testingFrameworks.frameworks.find(({ name }) => name === "jest");
    const packageJsonPath = rootDir ? path.join(rootDir, "package.json") : null;
    let packageJson = null;
    if (packageJsonPath && fs.existsSync(packageJsonPath)) {
        try {
            packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        } catch {
            packageJson = null;
        }
    }

    return {
        hasJest: metadata.hasJest,
        hasJestConfigFile: Boolean(jest?.configPaths.length),
        hasPackageJestConfig: Boolean(jest?.hasPackageConfig),
        hasJestScript: Boolean(jest?.scripts.length),
        hasJestDependency: Boolean(jest?.dependencyTypes.length),
        isMissingConfiguration: metadata.hasJest && !jest?.configPaths.length && !jest?.hasPackageConfig && !jest?.scripts.length,
        configPath: metadata.configPath,
        packageJsonConfig: packageJson?.jest || null,
        scripts: packageJson?.scripts || {},
        jestCommand: metadata.jestCommand,
        version: jest?.version || null,
        rootDir: rootDir || null,
        packageJsonPath,
        errors: testingFrameworks.errors,
        testingFrameworks,
    };
}
