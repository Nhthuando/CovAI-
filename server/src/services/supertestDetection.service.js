import fs from "fs";
import path from "path";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";

const TEST_FILE_RE = /(?:^|[._-])(test|spec)\.(?:[cm]?[jt]sx?)$/i;
const SUPERTEST_IMPORT_RE = /(?:from\s*["']supertest["']|require\(\s*["']supertest["']\s*\)|import\s*\(\s*["']supertest["']\s*\))/;
const IGNORED_DIRECTORIES = new Set(["node_modules", "coverage", "storage", ".git", ".next", "dist", "build"]);
const JEST_CONFIG_FILES = ["jest.config.js", "jest.config.cjs", "jest.config.mjs", "jest.config.ts", "jest.config.json"];

const readPackage = (rootDir, reasons) => {
    const packagePath = path.join(rootDir, "package.json");
    if (!fs.existsSync(packagePath)) {
        reasons.push("package.json not found");
        return { packagePath: null, pkg: null };
    }

    try {
        return { packagePath, pkg: JSON.parse(fs.readFileSync(packagePath, "utf8")) };
    } catch (error) {
        reasons.push(`Unable to read package.json: ${error.message}`);
        return { packagePath, pkg: null };
    }
};

const findJestConfig = (rootDir, pkg) => {
    const configName = JEST_CONFIG_FILES.find((name) => fs.existsSync(path.join(rootDir, name)));
    if (configName) return path.join(rootDir, configName);
    return pkg?.jest ? path.join(rootDir, "package.json") : null;
};

const isTestFile = (rootDir, filePath) => {
    if (TEST_FILE_RE.test(path.basename(filePath))) return true;
    const relativeParts = path.relative(rootDir, filePath).split(path.sep).map((part) => part.toLowerCase());
    return ["test", "tests", "__tests__"].some((directory) => relativeParts.includes(directory))
        && /\.[cm]?[jt]sx?$/i.test(filePath);
};

/**
 * Detect Supertest dependency, imports, test files and Jest configuration in a
 * snapshot. The result contains absolute paths so it can be handed directly to
 * the runner, while configFile is relative for API clients.
 */
export const detectSupertest = async (rootDir) => {
    const effectiveRootDir = resolveProjectRoot(rootDir);
    if (!effectiveRootDir || typeof effectiveRootDir !== "string" || !fs.existsSync(effectiveRootDir)) {
        return {
            detected: false, version: null, framework: null, testFiles: [], supertestFiles: [],
            configFile: null, configPath: null, testCommand: null,
            detectionReasons: ["Project root directory does not exist"],
        };
    }

    const detectionReasons = [];
    const { pkg } = readPackage(effectiveRootDir, detectionReasons);
    const dependencies = pkg ? { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies } : {};
    const version = dependencies.supertest ?? null;
    if (version) detectionReasons.push("Supertest dependency found in package.json");
    else detectionReasons.push("Supertest dependency not found in package.json");

    const testFiles = [];
    const supertestFiles = [];
    const scanDir = (directory) => {
        let entries = [];
        try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
        catch (error) { detectionReasons.push(`Unable to scan ${directory}: ${error.message}`); return; }

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name)) scanDir(fullPath);
                continue;
            }
            if (!entry.isFile() || !isTestFile(rootDir, fullPath)) continue;
            testFiles.push(fullPath);
            try {
                if (SUPERTEST_IMPORT_RE.test(fs.readFileSync(fullPath, "utf8"))) supertestFiles.push(fullPath);
            } catch (error) {
                detectionReasons.push(`Unable to read test file ${fullPath}: ${error.message}`);
            }
        }
    };
    scanDir(effectiveRootDir);

    if (supertestFiles.length) detectionReasons.push(`Found ${supertestFiles.length} test file(s) importing Supertest`);
    const configPath = findJestConfig(effectiveRootDir, pkg);
    if (configPath) detectionReasons.push(`Jest configuration found: ${path.relative(effectiveRootDir, configPath)}`);

    const hasJestDependency = Boolean(dependencies.jest || pkg?.jest);
    const hasJestConfig = Boolean(configPath);
    const framework = hasJestDependency || hasJestConfig || Boolean(version) || supertestFiles.length > 0 ? "jest" : null;

    return {
        detected: Boolean(version || supertestFiles.length),
        version,
        framework,
        testFiles,
        supertestFiles,
        configFile: configPath ? path.relative(effectiveRootDir, configPath).replace(/\\/g, "/") : null,
        configPath,
        testCommand: pkg?.scripts?.test ?? (hasJestDependency ? "npx --no-install jest" : null),
        detectionReasons,
    };
};
