import fs from "fs";
import path from "path";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { dockerRunner } from "./dockerRunner.service.js";

/**
 * Integration Testing Detection & 4 Permutations Engine (CovAI)
 * 
 * Supports both Supertest (Express + Jest/Mocha/Vitest) and Playwright API Testing.
 * Evaluates the 4 permutations of test files vs installed dependencies:
 * - Permutation A: Has Test Files + Has Dependencies (Ready for Execution)
 * - Permutation B: No Test Files + No Dependencies (Zero-Test Project -> Framework Selection)
 * - Permutation C: Has Dependencies + No Test Files (Cold-Start Target Auto-Selected)
 * - Permutation D: Has Test Files + Missing Dependencies (Infers Framework & Prompts Installation)
 */

const TEST_FILE_RE = /(?:^|[._-])(test|spec)\.(?:[cm]?[jt]sx?)$/i;
const SUPERTEST_IMPORT_RE = /(?:from\s*["']supertest["']|require\(\s*["']supertest["']\s*\)|import\s*\(\s*["']supertest["']\s*\))/;
const SUPERTEST_USAGE_RE = /(?:request\s*\(\s*(?:app|server|expressApp|baseURL|api)\s*\)\s*\.(?:get|post|put|delete|patch|head|options)|supertest\s*\(\s*(?:app|server)\s*\))/i;

const PLAYWRIGHT_IMPORT_RE = /(?:from\s*["']@playwright\/test["']|require\(\s*["']@playwright\/test["']\s*\)|from\s*["']playwright["']|require\(\s*["']playwright["']\s*\))/;
const PLAYWRIGHT_API_USAGE_RE = /(?:test\s*\(\s*['"`].*?['"`]\s*,\s*async\s*\(\s*\{\s*request\s*\}\s*\)|request\s*\.\s*(?:get|post|put|delete|patch|head|fetch)\s*\(|playwright\.request\.newContext)/;

const IGNORED_DIRECTORIES = new Set(["node_modules", "coverage", "storage", ".git", ".next", "dist", "build"]);
const JEST_CONFIG_FILES = ["jest.config.js", "jest.config.cjs", "jest.config.mjs", "jest.config.ts", "jest.config.json"];
const PLAYWRIGHT_CONFIG_FILES = ["playwright.config.js", "playwright.config.ts", "playwright.config.mjs", "playwright.config.cjs"];
const VITEST_CONFIG_FILES = ["vitest.config.js", "vitest.config.ts", "vitest.config.mjs"];

/**
 * Reads and parses package.json from directory.
 */
export const readPackageJson = (rootDir, reasons = []) => {
    const packagePath = path.join(rootDir, "package.json");
    if (!fs.existsSync(packagePath)) {
        reasons.push("package.json not found");
        return { packagePath: null, pkg: null, dependencies: {} };
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        const dependencies = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {}),
            ...(pkg.optionalDependencies || {}),
        };
        return { packagePath, pkg, dependencies };
    } catch (error) {
        reasons.push(`Unable to read package.json: ${error.message}`);
        return { packagePath, pkg: null, dependencies: {} };
    }
};

/**
 * Finds configuration file path if present.
 */
const findConfigFile = (rootDir, configFiles = []) => {
    for (const name of configFiles) {
        const full = path.join(rootDir, name);
        if (fs.existsSync(full)) return full;
    }
    return null;
};

/**
 * Checks whether a given file path is a test file.
 */
export const isTestFilePath = (rootDir, filePath) => {
    if (TEST_FILE_RE.test(path.basename(filePath))) return true;
    const relParts = path.relative(rootDir, filePath).split(path.sep).map((p) => p.toLowerCase());
    return ["test", "tests", "__tests__"].some((dir) => relParts.includes(dir)) && /\.[cm]?[jt]sx?$/i.test(filePath);
};

/**
 * Analyzes the content of a test file to determine if it uses Supertest or Playwright API testing.
 *
 * @param {string} fileContent - Source content of test file
 * @returns {{"isSupertest": boolean, "isPlaywrightApi": boolean}}
 */
export const analyzeTestFileContent = (fileContent = "") => {
    if (!fileContent || typeof fileContent !== "string") {
        return { isSupertest: false, isPlaywrightApi: false };
    }

    const hasSupertestImport = SUPERTEST_IMPORT_RE.test(fileContent);
    const hasSupertestUsage = SUPERTEST_USAGE_RE.test(fileContent);
    const isSupertest = hasSupertestImport || hasSupertestUsage;

    const hasPlaywrightImport = PLAYWRIGHT_IMPORT_RE.test(fileContent);
    const hasPlaywrightApiUsage = PLAYWRIGHT_API_USAGE_RE.test(fileContent);
    const isPlaywrightApi = hasPlaywrightImport && hasPlaywrightApiUsage;

    return { isSupertest, isPlaywrightApi };
};

/**
 * Scans a project directory to discover integration testing frameworks,
 * config files, and test files for both Supertest and Playwright API.
 *
 * @param {string} rootDir - Root directory of the project
 * @returns {Promise<Object>} Comprehensive detection result
 */
export const detectIntegrationFrameworks = async (rootDir) => {
    const effectiveRootDir = resolveProjectRoot(rootDir);
    if (!effectiveRootDir || typeof effectiveRootDir !== "string" || !fs.existsSync(effectiveRootDir)) {
        return {
            detected: false,
            primaryFramework: null,
            hasDependencies: false,
            hasTestFiles: false,
            supertest: { detected: false, version: null, files: [] },
            playwrightApi: { detected: false, version: null, files: [] },
            runner: null,
            testFiles: [],
            supertestFiles: [],
            playwrightApiFiles: [],
            configFile: null,
            configPath: null,
            testCommand: null,
            detectionReasons: ["Project root directory does not exist"],
            permutation: "ZERO_TESTS_NO_DEPS",
            permutationDetails: null,
        };
    }

    const detectionReasons = [];
    const { pkg, dependencies } = readPackageJson(effectiveRootDir, detectionReasons);

    // 1. Dependency checks
    const supertestVersion = dependencies.supertest ?? null;
    const playwrightVersion = dependencies["@playwright/test"] ?? dependencies.playwright ?? null;
    const jestVersion = dependencies.jest ?? (pkg?.jest ? "configured" : null);
    const vitestVersion = dependencies.vitest ?? null;
    const mochaVersion = dependencies.mocha ?? null;

    if (supertestVersion) detectionReasons.push(`Supertest found in package.json (${supertestVersion})`);
    if (playwrightVersion) detectionReasons.push(`Playwright found in package.json (${playwrightVersion})`);

    // 2. Config file checks
    const jestConfigPath = findConfigFile(effectiveRootDir, JEST_CONFIG_FILES) || (pkg?.jest ? path.join(effectiveRootDir, "package.json") : null);
    const playwrightConfigPath = findConfigFile(effectiveRootDir, PLAYWRIGHT_CONFIG_FILES);
    const vitestConfigPath = findConfigFile(effectiveRootDir, VITEST_CONFIG_FILES);

    // 3. Scan test files
    const allTestFiles = [];
    const supertestFiles = [];
    const playwrightApiFiles = [];
    const otherTestFiles = [];

    const scanDirectory = (currentDir) => {
        let entries = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (err) {
            detectionReasons.push(`Unable to scan directory ${currentDir}: ${err.message}`);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name)) {
                    scanDirectory(fullPath);
                }
                continue;
            }

            if (!entry.isFile() || !isTestFilePath(effectiveRootDir, fullPath)) continue;

            allTestFiles.push(fullPath);

            try {
                const content = fs.readFileSync(fullPath, "utf8");
                const { isSupertest, isPlaywrightApi } = analyzeTestFileContent(content);

                if (isSupertest) {
                    supertestFiles.push(fullPath);
                } else if (isPlaywrightApi) {
                    playwrightApiFiles.push(fullPath);
                } else {
                    otherTestFiles.push(fullPath);
                }
            } catch (err) {
                detectionReasons.push(`Unable to read test file ${fullPath}: ${err.message}`);
            }
        }
    };

    scanDirectory(effectiveRootDir);

    if (supertestFiles.length > 0) detectionReasons.push(`Found ${supertestFiles.length} file(s) using Supertest`);
    if (playwrightApiFiles.length > 0) detectionReasons.push(`Found ${playwrightApiFiles.length} file(s) using Playwright API`);

    // 4. Runner Resolution
    let runner = null;
    let configPath = null;
    let configFile = null;

    if (playwrightApiFiles.length > 0 || (playwrightVersion && supertestFiles.length === 0)) {
        runner = "playwright";
        configPath = playwrightConfigPath;
    } else if (vitestVersion && vitestConfigPath) {
        runner = "vitest";
        configPath = vitestConfigPath;
    } else if (jestVersion || jestConfigPath || supertestVersion || supertestFiles.length > 0) {
        runner = "jest";
        configPath = jestConfigPath;
    } else if (mochaVersion) {
        runner = "mocha";
    }

    if (configPath) {
        configFile = path.relative(effectiveRootDir, configPath).replace(/\\/g, "/");
    }

    // 5. Test command resolution
    let testCommand = pkg?.scripts?.test ?? null;
    if (!testCommand) {
        if (runner === "playwright") testCommand = "npx playwright test";
        else if (runner === "jest") testCommand = "npx jest";
        else if (runner === "vitest") testCommand = "npx vitest run";
    }

    const hasSupertestDep = Boolean(supertestVersion);
    const hasPlaywrightDep = Boolean(playwrightVersion);
    const hasDependencies = hasSupertestDep || hasPlaywrightDep;
    const hasTestFiles = supertestFiles.length > 0 || playwrightApiFiles.length > 0;

    let primaryFramework = null;
    if (playwrightApiFiles.length > 0 && supertestFiles.length === 0) {
        primaryFramework = "playwright";
    } else if (supertestFiles.length > 0) {
        primaryFramework = "supertest";
    } else if (hasPlaywrightDep && !hasSupertestDep) {
        primaryFramework = "playwright";
    } else if (hasSupertestDep) {
        primaryFramework = "supertest";
    }

    const rawResult = {
        detected: hasDependencies || hasTestFiles,
        primaryFramework,
        hasDependencies,
        hasTestFiles,
        supertest: {
            detected: hasSupertestDep || supertestFiles.length > 0,
            version: supertestVersion,
            files: supertestFiles,
            hasDep: hasSupertestDep,
        },
        playwrightApi: {
            detected: hasPlaywrightDep || playwrightApiFiles.length > 0,
            version: playwrightVersion,
            files: playwrightApiFiles,
            hasDep: hasPlaywrightDep,
        },
        runner,
        testFiles: allTestFiles,
        supertestFiles,
        playwrightApiFiles,
        otherTestFiles,
        configFile,
        configPath,
        testCommand,
        detectionReasons,
        rootDir: effectiveRootDir,
    };

    // 6. Permutation Classification
    const permutationDetails = classifyIntegrationPermutation(rawResult);

    return {
        ...rawResult,
        framework: primaryFramework || permutationDetails.targetFramework || permutationDetails.inferredFramework || (hasTestFiles ? "supertest" : null),
        version: supertestVersion || playwrightVersion,
        pathway: hasTestFiles ? "BROWNFIELD" : "GREENFIELD",
        permutation: permutationDetails.permutation,
        isZeroTestProject: Boolean(permutationDetails.isZeroTestProject),
        needsDependencyInstall: Boolean(permutationDetails.needsInstall),
        targetFramework: permutationDetails.targetFramework || primaryFramework || null,
        suggestedFrameworks: permutationDetails.proposedFrameworks ? permutationDetails.proposedFrameworks.map((p) => p.id) : ["supertest", "playwright"],
        permutationDetails,
    };
};

/**
 * 4 Permutations Engine: Classifies the project state according to test files and installed libraries.
 *
 * @param {Object} detection - Output from detectIntegrationFrameworks
 * @returns {Object} Permutation metadata, execution readiness, and UI action triggers
 */
export const classifyIntegrationPermutation = (detection) => {
    const { hasTestFiles, hasDependencies, supertest, playwrightApi } = detection;

    const proposedFrameworks = [
        {
            id: "supertest",
            name: "Supertest (Express + Jest)",
            description: "Kiểm thử API trực tiếp trong tiến trình Node.js không cần bật HTTP server cổng ngoài.",
            isRecommended: true,
            defaultPackages: ["supertest@^7.0.0", "jest@^29.7.0"],
        },
        {
            id: "playwright",
            name: "Playwright API Testing",
            description: "Kiểm thử API độc lập bằng HTTP client chuẩn của Playwright Runner.",
            isRecommended: false,
            defaultPackages: ["@playwright/test@^1.40.0"],
        },
    ];

    // Permutation A: Có test + Có thư viện
    if (hasTestFiles && hasDependencies) {
        const activeFramework =
            supertest.files.length > 0 && supertest.hasDep
                ? "supertest"
                : playwrightApi.files.length > 0 && playwrightApi.hasDep
                ? "playwright"
                : supertest.hasDep
                ? "supertest"
                : "playwright";

        return {
            permutation: "HAS_TESTS_AND_DEPS",
            code: "A",
            readyForExecution: true,
            isZeroTestProject: false,
            needsUserSelection: false,
            needsInstall: false,
            targetFramework: activeFramework,
            inferredFramework: activeFramework,
            message: "Dự án đã có kịch bản test API và đã cài đặt đầy đủ thư viện. Sẵn sàng thực thi và phân tích độ bao phủ.",
            actions: ["RUN_TESTS", "ANALYZE_COVERAGE"],
        };
    }

    // Permutation B: Không có test + Không có thư viện (Zero-Test Project)
    if (!hasTestFiles && !hasDependencies) {
        return {
            permutation: "ZERO_TESTS_NO_DEPS",
            code: "B",
            readyForExecution: false,
            isZeroTestProject: true,
            needsUserSelection: true,
            needsInstall: false,
            targetFramework: null,
            proposedFrameworks,
            message: "Dự án chưa có kịch bản test API và chưa cài đặt thư viện kiểm thử. Vui lòng chọn framework để AI sinh test tự động.",
            actions: ["SELECT_FRAMEWORK", "GENERATE_COLD_START_TESTS"],
        };
    }

    // Permutation C: Có thư viện + Không có test
    if (!hasTestFiles && hasDependencies) {
        const targetFramework = supertest.hasDep ? "supertest" : "playwright";
        return {
            permutation: "HAS_DEPS_NO_TESTS",
            code: "C",
            readyForExecution: false,
            isZeroTestProject: true,
            needsUserSelection: false,
            needsInstall: false,
            targetFramework,
            inferredFramework: targetFramework,
            message: `Dự án đã cài đặt thư viện ${targetFramework.toUpperCase()} nhưng chưa có file test API. Hệ thống sẽ tự động dùng thư viện này để sinh test.`,
            actions: ["GENERATE_COLD_START_TESTS"],
        };
    }

    // Permutation D: Có test + Chưa cài thư viện trong package.json
    const inferredFramework =
        supertest.files.length > 0
            ? "supertest"
            : playwrightApi.files.length > 0
            ? "playwright"
            : "supertest";

    const missingPackages =
        inferredFramework === "playwright"
            ? ["@playwright/test"]
            : ["supertest", "jest"];

    const installCommand = `npm install --save-dev ${missingPackages.join(" ")}`;

    return {
        permutation: "HAS_TESTS_NO_DEPS",
        code: "D",
        readyForExecution: false,
        isZeroTestProject: false,
        needsUserSelection: false,
        needsInstall: true,
        targetFramework: inferredFramework,
        inferredFramework,
        missingPackages,
        installCommand,
        warningMessage: `Dự án đã có file test API (${inferredFramework}) nhưng chưa cài đặt gói ${missingPackages.join(", ")} trong package.json.`,
        confirmActionText: "Cài đặt thư viện phát hiện & Chạy tiếp",
        actions: ["PROMPT_INSTALL_DEPENDENCIES"],
    };
};

/**
 * Installs required integration testing packages (e.g., supertest, jest, @playwright/test)
 * into the target project workspace.
 *
 * @param {Object} params
 * @param {string} params.rootDir - Root directory of the project
 * @param {Array<string>} [params.packages] - Specific packages to install
 * @param {string} [params.framework] - "supertest" or "playwright"
 * @param {string} [params.jobId] - Optional Job ID for progress logs
 * @returns {Promise<{ success: boolean, stdout: string, packages: Array<string> }>}
 */
export const installIntegrationDependencies = async ({
    rootDir,
    packages = [],
    framework = "supertest",
    jobId = null,
} = {}) => {
    const effectiveRootDir = resolveProjectRoot(rootDir);
    if (!effectiveRootDir || !fs.existsSync(effectiveRootDir)) {
        throw new Error(`Invalid project directory for installation: ${rootDir}`);
    }

    let installList = [...packages];
    if (installList.length === 0) {
        if (framework === "playwright") {
            installList = ["@playwright/test"];
        } else {
            installList = ["supertest", "jest"];
        }
    }

    const allowedPackages = new Set(['supertest','jest','@playwright/test']);
    if (!Array.isArray(packages) || installList.some(name => !allowedPackages.has(name))) throw new Error('Unsupported integration test dependency');
    const pkgCmd = installList.join(" ");
    const command = `npm install --save-dev ${pkgCmd} --legacy-peer-deps --no-audit --no-fund`;

    // 1. Execute install via dockerRunner (which falls back to direct execution if Docker unavailable)
    const execResult = await dockerRunner.run({
        snapshotPath: effectiveRootDir,
        command,
        timeoutMs: 5 * 60 * 1000,
        jobId,
    });

    // 2. Guarantee package.json has entries even if npm ran in restricted sandbox
    const packagePath = path.join(effectiveRootDir, "package.json");
    if (fs.existsSync(packagePath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
            pkg.devDependencies = pkg.devDependencies || {};
            for (const p of installList) {
                const cleanName = p.replace(/@\^?[0-9.]+$/, "");
                if (!pkg.devDependencies[cleanName] && (!pkg.dependencies || !pkg.dependencies[cleanName])) {
                    pkg.devDependencies[cleanName] = "^" + (cleanName === "@playwright/test" ? "1.40.0" : "7.0.0");
                }
            }
            fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2), "utf8");
        } catch (_) {}
    }

    return {
        success: execResult.success || execResult.exitCode === 0,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        packages: installList,
    };
};

