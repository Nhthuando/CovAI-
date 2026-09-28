import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import {
    markJobRunning,
    markJobSuccess,
    markJobFailed,
    updateJobProgress,
    getJobById,
    addJobLog,
} from "./job.service.js";
import { saveJobOutput, appendJobOutput } from "./jobOutput.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { dockerRunner } from "./dockerRunner.service.js";
import { parseJestResults, parseVitestResults, formatScenariosForPrisma } from "./testResultParser.service.js";
import { detectTestingFrameworks, classifyTestFile } from "../utils/testingFrameworkDetector.js";
import prisma from "../config/prisma.js";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 phút
const JEST_TIMEOUT_MS = 2.5 * 60 * 1000;   // 2.5 phút

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

export const coverageResultFromSummary = (summaryResult) => {
    if (!summaryResult?.summary) return null;
    const { linesPct, branchesPct, funcsPct, stmtsPct } = summaryResult.summary;
    return {
        lines: linesPct,
        branches: branchesPct,
        functions: funcsPct,
        statements: stmtsPct,
    };
};

/**
 * Scan repository for unit test files.
 * Strictly ignores frontend directories (client, frontend, ui, web) and .jsx/.tsx files.
 * Strictly ignores integration/E2E files (supertest, playwright, cypress).
 * Separates files into jestFiles and vitestFiles.
 *
 * @param {string} rootDir
 * @returns {{ jestFiles: string[], vitestFiles: string[], skippedFiles: string[] }}
 */
export const findUnitFiles = (rootDir) => {
    const jestFiles = [];
    const vitestFiles = [];
    const skippedFiles = [];

    const frameworkDetection = detectTestingFrameworks(rootDir);
    const detectedUnit = frameworkDetection?.unit || [];

    const IGNORED_DIRS = new Set([
        "node_modules", ".git", "coverage", "dist", "build",
        ".next", ".vite", ".vitest", ".cache", "storage",
        "client", "frontend", "ui", "web", "test-data", "test_data",
        "fixtures", "mocks", "__mocks__"
    ]);

    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
            const lowerRel = relPath.toLowerCase();

            if (entry.isDirectory()) {
                if (IGNORED_DIRS.has(entry.name) || lowerRel.includes("/client/") || lowerRel.includes("/frontend/")) {
                    continue;
                }
                walk(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;

            const isHelperDir = /(^|\/)(test-data|test_data|fixtures?|helpers?|mocks?|__mocks__|utils?|support)\//i.test(lowerRel);
            if (isHelperDir) continue;

            // Exclude helper/setup files
            if (/^(setup|global-?setup|setup-?tests|teardown|helpers?|mocks?|fixtures?|config|utils?)\.[a-z0-9]+$/i.test(entry.name)) {
                continue;
            }

            // Strictly exclude .jsx and .tsx (unit tests only apply to backend logic)
            if (!/\.[cm]?[jt]s$/i.test(entry.name)) {
                continue;
            }

            // Test file detection: either by name pattern or within standard test directory
            const isTest = (
                /\.(test|spec|testcase|steps?)\.[cm]?[jt]s$/i.test(entry.name) ||
                (/(^|\/)(tests?|__tests__|unit)\//i.test(lowerRel) && !/\.(d\.ts|json|md|txt)$/i.test(entry.name))
            );

            if (!isTest) {
                continue;
            }

            // Read test file content to inspect framework imports
            let content = "";
            try {
                const buf = Buffer.alloc(8192);
                const fd = fs.openSync(fullPath, "r");
                const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
                fs.closeSync(fd);
                content = buf.toString("utf8", 0, bytesRead);
            } catch {
                continue;
            }

            const lowerContent = content.toLowerCase();

            // Exclude integration / E2E files (supertest, playwright, cypress)
            if (
                lowerRel.includes("supertest") ||
                lowerContent.includes("supertest") ||
                lowerContent.includes("request(app)") ||
                lowerContent.includes("request(server)") ||
                lowerRel.includes("playwright") ||
                lowerContent.includes("@playwright/test") ||
                lowerContent.includes("page.goto") ||
                lowerRel.includes("cypress") ||
                lowerContent.includes("cypress")
            ) {
                skippedFiles.push(relPath);
                continue;
            }

            // Framework classification using classifyTestFile
            const fw = classifyTestFile(content, relPath, detectedUnit);
            const isVitest = fw === "vitest" ||
                lowerRel.includes("tests/unit") ||
                lowerRel.includes(".vitest.") ||
                lowerContent.includes("from 'vitest'") ||
                lowerContent.includes('from "vitest"') ||
                /\bvi\s*\./.test(content);

            const isJest = fw === "jest" ||
                lowerRel.includes("/jest/") ||
                lowerRel.includes(".jest.") ||
                lowerContent.includes("@jest/") ||
                lowerContent.includes("from 'jest'") ||
                lowerContent.includes('from "jest"') ||
                /\bjest\s*\./.test(content);

            if (isVitest && !isJest) {
                vitestFiles.push(relPath);
            } else if (isJest && !isVitest) {
                jestFiles.push(relPath);
            } else if (isJest) {
                jestFiles.push(relPath);
            } else if (isVitest) {
                vitestFiles.push(relPath);
            } else {
                if (detectedUnit.includes("jest") || lowerRel.includes("jest")) {
                    jestFiles.push(relPath);
                } else if (detectedUnit.includes("vitest")) {
                    vitestFiles.push(relPath);
                } else {
                    jestFiles.push(relPath);
                }
            }
        }
    };

    walk(rootDir);
    return { jestFiles, vitestFiles, skippedFiles };
};

/**
 * SCRUM-139: Chạy npm install trong rootDir thông qua Docker nếu thiếu dependencies.
 * @returns {Promise<void>}
 */
const runNpmInstall = async (jobId, rootDir) => {
    const rootPkg = path.join(rootDir, "package.json");
    const hasRootPkg = fs.existsSync(rootPkg);
    const nodeModulesDir = path.join(rootDir, "node_modules");
    const backendModulesDir = path.join(rootDir, "backend", "node_modules");
    const backendPkg = path.join(rootDir, "backend", "package.json");

    const rootHasDeps = !hasRootPkg || (fs.existsSync(nodeModulesDir) && fs.readdirSync(nodeModulesDir).length > 3);
    const backendHasDeps = !fs.existsSync(backendPkg) || (fs.existsSync(backendModulesDir) && fs.readdirSync(backendModulesDir).length > 3);

    // If dependencies already exist, skip npm install for high performance
    if (rootHasDeps && backendHasDeps) {
        await addJobLog(jobId, "INFO", "[SCRUM-139] node_modules đã tồn tại đầy đủ, bỏ qua npm install để tăng tốc độ chạy.").catch(() => { });
        return;
    }

    if (hasRootPkg && !rootHasDeps) {
        await addJobLog(jobId, "INFO", `[SCRUM-139] Bắt đầu npm install tại: ${rootDir}`).catch(() => { });

        const result = await dockerRunner.run({
            snapshotPath: rootDir,
            command: "npm install --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false",
            timeoutMs: INSTALL_TIMEOUT_MS,
            jobId
        });

        if (result.success) {
            await addJobLog(jobId, "INFO", "[SCRUM-139] npm install hoàn thành thành công.").catch(() => { });
        } else {
            if (fs.existsSync(nodeModulesDir) && fs.readdirSync(nodeModulesDir).length > 2) {
                await addJobLog(jobId, "WARN", `[SCRUM-139] npm install có cảnh báo (exit code ${result.exitCode}), tiếp tục chạy tests...`).catch(() => { });
            } else {
                const errorDetail = result.stderr?.trim() || result.stdout?.trim() || "";
                const msg = `[SCRUM-139] npm install thất bại với exit code ${result.exitCode}${errorDetail ? `: ${errorDetail.slice(0, 200)}` : ""}`;
                await addJobLog(jobId, "ERROR", msg).catch(() => { });
                throw new Error(msg);
            }
        }
    }

    // Check if backend, examples, packages or other subdirectories have package.json without node_modules
    try {
        const findSubPackages = (dir, depth = 1) => {
            const list = [];
            if (depth > 2) return list;
            try {
                for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (item.isDirectory() && !["node_modules", ".git", "coverage", "dist", "build", "storage", "client", "frontend"].includes(item.name)) {
                        const subDir = path.join(dir, item.name);
                        const subPkg = path.join(subDir, "package.json");
                        if (fs.existsSync(subPkg)) {
                            list.push(subDir);
                        }
                        if (depth < 2) {
                            list.push(...findSubPackages(subDir, depth + 1));
                        }
                    }
                }
            } catch { }
            return list;
        };

        const subPackages = findSubPackages(rootDir, 1);
        for (const subDir of subPackages) {
            const relSub = path.relative(rootDir, subDir).replace(/\\/g, "/");
            const subModules = path.join(subDir, "node_modules");
            if (!fs.existsSync(subModules) || fs.readdirSync(subModules).length <= 2) {
                await addJobLog(jobId, "INFO", `[SCRUM-139] Cài đặt dependencies cho ${relSub}...`).catch(() => { });
                await dockerRunner.run({
                    snapshotPath: rootDir,
                    command: `npm install --prefix ${relSub} --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false`,
                    timeoutMs: INSTALL_TIMEOUT_MS,
                    jobId
                });
            }
        }
    } catch (_) { }

    // Run build step if available (e.g. tsc to generate dist/ for packages that depend on it)
    try {
        const rootPkg = path.join(rootDir, "package.json");
        if (fs.existsSync(rootPkg)) {
            const pkg = JSON.parse(fs.readFileSync(rootPkg, "utf8"));
            if (pkg.scripts && (pkg.scripts.build || pkg.scripts["build:ts"] || pkg.scripts.compile)) {
                await addJobLog(jobId, "INFO", `[SCRUM-139] Thực hiện build cho project...`).catch(() => { });
                await dockerRunner.run({
                    snapshotPath: rootDir,
                    command: "npm run build --if-present",
                    timeoutMs: 60000,
                    jobId
                });
            }
        }
    } catch (_) { }
};

/**
 * SCRUM-140: Chạy jest --coverage trong rootDir thông qua Docker.
 * @param {string} jobId
 * @param {string} rootDir
 * @param {string|null} jestConfigPath
 * @param {string[]} specificFiles - Specific Jest test files to execute
 * @returns {Promise<{ exitCode: number }>}
 */
/**
 * Helper: Find closest ancestor directory containing package.json (relative to rootDir)
 */
const getPackageForFile = (relFile, root) => {
    let currentDir = path.dirname(relFile.replace(/\\/g, "/"));
    while (currentDir && currentDir !== "." && currentDir !== "/") {
        const pkgPath = path.join(root, currentDir, "package.json");
        if (fs.existsSync(pkgPath)) {
            return currentDir.replace(/\\/g, "/");
        }
        const parent = path.dirname(currentDir);
        if (parent === currentDir) break;
        currentDir = parent;
    }
    return "";
};

export const runJestCoverage = async (jobId, rootDir, jestConfigPath, specificFiles = []) => {
    const covDir = path.join(rootDir, "coverage");
    if (!fs.existsSync(covDir)) {
        try { fs.mkdirSync(covDir, { recursive: true }); } catch { }
    }

    // Partition test files by package
    let filesToRun = specificFiles;
    if (!Array.isArray(filesToRun) || filesToRun.length === 0) {
        try {
            const classified = classifyTestFiles(rootDir);
            if (classified.jestFiles && classified.jestFiles.length > 0) {
                filesToRun = classified.jestFiles;
            }
        } catch { }
    }

    const packageGroups = new Map();
    if (Array.isArray(filesToRun) && filesToRun.length > 0) {
        for (const file of filesToRun) {
            const pkgDir = getPackageForFile(file, rootDir);
            if (!packageGroups.has(pkgDir)) packageGroups.set(pkgDir, []);
            packageGroups.get(pkgDir).push(file);
        }
    }

    const rootFiles = packageGroups.has("") ? packageGroups.get("") : (packageGroups.size === 0 ? (specificFiles || []) : []);
    const shouldRunRoot = packageGroups.size === 0 || rootFiles.length > 0;
    let overallExitCode = 0;

    let jestCmd = 'npx --yes jest --coverage --passWithNoTests --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --json --outputFile=coverage/jest-results.json --forceExit --testTimeout=30000 --maxWorkers=2';

    let tempConfigCreated = false;
    const tempConfigName = "covai-jest-runner.json";
    const tempConfigPath = path.join(rootDir, tempConfigName);

    // ── Smart transform detection ─────────────────────────────────────────────
    // Scan root and sub-packages to detect babel-jest / ts-jest availability
    const detectTransforms = (repoRoot) => {
        const hasBabelJest = (pkgJson) => {
            const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
            return !!(deps["babel-jest"] || deps["@babel/core"]);
        };
        const hasTsJest = (pkgJson) => {
            const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
            return !!(deps["ts-jest"]);
        };
        const hasTypeScript = (pkgJson) => {
            const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
            return !!(deps["typescript"] || deps["ts-jest"]);
        };

        let foundBabelJest = false;
        let foundTsJest = false;
        let foundTypeScript = false;

        // Check all package.json files (root + first-level subdirs + 2nd-level subdirs)
        const pkgPaths = [path.join(repoRoot, "package.json")];
        try {
            for (const d1 of fs.readdirSync(repoRoot, { withFileTypes: true })) {
                if (d1.isDirectory() && d1.name !== "node_modules" && d1.name !== ".git") {
                    const p1 = path.join(repoRoot, d1.name, "package.json");
                    if (fs.existsSync(p1)) pkgPaths.push(p1);
                    // 2nd level (e.g. examples/ecmascript/package.json)
                    try {
                        for (const d2 of fs.readdirSync(path.join(repoRoot, d1.name), { withFileTypes: true })) {
                            if (d2.isDirectory() && d2.name !== "node_modules") {
                                const p2 = path.join(repoRoot, d1.name, d2.name, "package.json");
                                if (fs.existsSync(p2)) pkgPaths.push(p2);
                            }
                        }
                    } catch { }
                }
            }
        } catch { }

        for (const pkgPath of pkgPaths) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                if (hasBabelJest(pkg)) foundBabelJest = true;
                if (hasTsJest(pkg)) foundTsJest = true;
                if (hasTypeScript(pkg)) foundTypeScript = true;
            } catch { }
        }

        // Also detect TypeScript by tsconfig presence
        if (!foundTypeScript && fs.existsSync(path.join(repoRoot, "tsconfig.json"))) {
            foundTypeScript = true;
        }

        const transform = {};
        if (foundTsJest || foundTypeScript) {
            transform["^.+\\.tsx?$"] = "ts-jest";
        }
        if (foundBabelJest) {
            transform["^.+\\.jsx?$"] = [
                "babel-jest",
                {
                    rootMode: "upward-optional",
                    babelrcRoots: [".", "./examples/*", "./packages/*"]
                }
            ];
        }
        return Object.keys(transform).length > 0 ? transform : null;
    };

    // Read project's existing jest config from package.json
    const readProjectJestConfig = (repoRoot) => {
        const pkgPath = path.join(repoRoot, "package.json");
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                if (pkg.jest && typeof pkg.jest === "object") return pkg.jest;
            } catch { }
        }
        return {};
    };

    const projectJestConfig = readProjectJestConfig(rootDir);

    const rootPkgPath = path.join(rootDir, "package.json");
    let rootPkgName = "";
    try {
        if (fs.existsSync(rootPkgPath)) {
            const p = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
            if (p.name) rootPkgName = p.name;
        }
    } catch { }

    const defaultModuleNameMapper = {
        ...(rootPkgName ? {
            [`^${rootPkgName}$`]: "<rootDir>/dist/src",
            [`^${rootPkgName}/(.*)$`]: "<rootDir>/dist/src/$1",
        } : {}),
        "^jest-cucumber$": "<rootDir>/dist/src",
        "^jest-cucumber/(.*)$": "<rootDir>/dist/src/$1",
        ".*dist/src$": "<rootDir>/dist/src",
        ".*dist/src/(.*)": "<rootDir>/dist/src/$1",
        ...(projectJestConfig?.moduleNameMapper || {})
    };

    const coveragePathIgnorePatterns = [
        "/node_modules/",
        "/client/",
        "/frontend/",
        "/routes/",
        "/controllers/",
        "/endpoints/",
        "/api/",
        "app\\.[cm]?[jt]s$",
        "server\\.[cm]?[jt]s$"
    ];

    const detectedTransform = detectTransforms(rootDir);

    const mergedTransform = {
        ...(detectedTransform || {}),
        ...(projectJestConfig?.transform || {})
    };

    const tempSetupName = "covai-jest-setup.mjs";
    const tempSetupPath = path.join(rootDir, tempSetupName);
    try {
        fs.writeFileSync(
            tempSetupPath,
            `try { const { jest } = await import('@jest/globals'); if (typeof globalThis.jest === 'undefined' && jest) { globalThis.jest = jest; } } catch { }\n` +
            `try {\n` +
            `  if (typeof expect !== 'undefined' && expect.extend) {\n` +
            `    expect.extend({\n` +
            `      toBeTrue(received) { return { pass: received === true, message: () => 'expected ' + received + ' to be true' }; },\n` +
            `      toBeFalse(received) { return { pass: received === false, message: () => 'expected ' + received + ' to be false' }; }\n` +
            `    });\n` +
            `  }\n` +
            `} catch { }\n`,
            "utf8"
        );
    } catch { }

    if (shouldRunRoot) {
        if (Array.isArray(rootFiles) && rootFiles.length > 0) {
            try {
                const testMatchPatterns = rootFiles.map(f => `<rootDir>/${f.replace(/\\/g, "/")}`);
                const tempConfig = {
                    ...projectJestConfig,
                    testMatch: testMatchPatterns,
                    testTimeout: 30000,
                    testPathIgnorePatterns: [
                        "/node_modules/", "/client/", "/frontend/",
                        ...(Array.isArray(projectJestConfig?.testPathIgnorePatterns)
                            ? projectJestConfig.testPathIgnorePatterns.filter(p => !p.includes("node_modules"))
                            : [])
                    ],
                    setupFilesAfterEnv: [
                        ...(Array.isArray(projectJestConfig?.setupFilesAfterEnv) ? projectJestConfig.setupFilesAfterEnv : []),
                        `<rootDir>/${tempSetupName}`
                    ],
                    coveragePathIgnorePatterns,
                    moduleNameMapper: defaultModuleNameMapper,
                    ...(Object.keys(mergedTransform).length > 0 ? { transform: mergedTransform } : {}),
                    moduleFileExtensions: projectJestConfig?.moduleFileExtensions || ["js", "ts", "tsx", "json"]
                };
                fs.writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2), "utf8");
                tempConfigCreated = true;
                jestCmd += ` --config=${tempConfigName}`;
            } catch {
                const fileArgs = rootFiles.slice(0, 100).map(f => `"${f.replace(/\\/g, "/")}"`).join(" ");
                jestCmd += ` ${fileArgs}`;
            }
        } else {
            try {
                const baseTestMatch = Array.isArray(projectJestConfig?.testMatch) && projectJestConfig.testMatch.length > 0
                    ? projectJestConfig.testMatch
                    : [
                        "<rootDir>/**/__tests__/**/*.[jt]s?(x)",
                        "<rootDir>/**/?(*.)+(spec|test|testcase|steps?).[jt]s?(x)",
                        "<rootDir>/**/step-definitions/**/*.[jt]s?(x)",
                        "<rootDir>/tests/**/*.[jt]s?(x)"
                    ];
                const tempConfig = {
                    ...projectJestConfig,
                    testMatch: baseTestMatch,
                    testTimeout: 30000,
                    testPathIgnorePatterns: [
                        "/node_modules/", "/client/", "/frontend/", "playwright", "cypress", "supertest", "vitest",
                        ...(Array.isArray(projectJestConfig?.testPathIgnorePatterns)
                            ? projectJestConfig.testPathIgnorePatterns.filter(p => !p.includes("node_modules"))
                            : [])
                    ],
                    setupFilesAfterEnv: [
                        ...(Array.isArray(projectJestConfig?.setupFilesAfterEnv) ? projectJestConfig.setupFilesAfterEnv : []),
                        `<rootDir>/${tempSetupName}`
                    ],
                    coveragePathIgnorePatterns,
                    moduleNameMapper: defaultModuleNameMapper,
                    ...(Object.keys(mergedTransform).length > 0 ? { transform: mergedTransform } : {}),
                    moduleFileExtensions: projectJestConfig?.moduleFileExtensions || ["js", "ts", "tsx", "json"]
                };
                fs.writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2), "utf8");
                tempConfigCreated = true;
                jestCmd += ` --config=${tempConfigName}`;
            } catch {
                if (jestConfigPath) {
                    const relativeConfig = path.relative(rootDir, jestConfigPath).replace(/\\/g, '/');
                    jestCmd += ` --config=${relativeConfig}`;
                }
                jestCmd += ' --testPathIgnorePatterns="playwright|cypress|supertest|vitest|client|frontend"';
            }
        }


        const fileCount = Array.isArray(rootFiles) && rootFiles.length > 0 ? rootFiles.length : 50;
        const effectiveTimeout = Math.min(4 * 60 * 1000, Math.max(JEST_TIMEOUT_MS, fileCount * 4 * 1000));

        await addJobLog(jobId, "INFO", `[SCRUM-140] Bắt đầu jest --coverage (${rootFiles.length > 0 ? rootFiles.length + ' file' : 'toàn bộ'}) tại Docker container (timeout: ${Math.round(effectiveTimeout / 60000)}m)`).catch(() => { });

        let result;
        try {
            result = await dockerRunner.run({
                snapshotPath: rootDir,
                command: jestCmd,
                timeoutMs: effectiveTimeout,
                jobId,
                env: {
                    NODE_OPTIONS: "--experimental-vm-modules"
                }
            });
            if (result.exitCode !== 0 && result.exitCode !== null) {
                overallExitCode = result.exitCode;
            }
        } finally {
            if (tempConfigCreated && fs.existsSync(tempConfigPath)) {
                try { fs.unlinkSync(tempConfigPath); } catch { }
            }
            if (fs.existsSync(tempSetupPath)) {
                try { fs.unlinkSync(tempSetupPath); } catch { }
            }
        }

        // Ensure jest-results.json is copied or synced if generated in root
        const rootTestResults = path.join(rootDir, "test-results.json");
        const jestResultsPath = path.join(covDir, "jest-results.json");
        if (fs.existsSync(rootTestResults) && !fs.existsSync(jestResultsPath)) {
            try { fs.copyFileSync(rootTestResults, jestResultsPath); } catch { }
        }
    }

    // ── Execute subpackages ──────────────────────────────────────────────────
    for (const [pkgDir, subFiles] of packageGroups.entries()) {
        if (!pkgDir || !Array.isArray(subFiles) || subFiles.length === 0) continue;

        const subSlug = pkgDir.replace(/[^a-zA-Z0-9_-]/g, "_");
        const subResultsName = `jest-results-${subSlug}.json`;
        const subResultsPath = path.join(covDir, subResultsName);
        const targetDir = path.join(rootDir, pkgDir);
        const subResultsRel = path.relative(targetDir, subResultsPath).replace(/\\/g, "/");

        const relativeSubFiles = subFiles.map(f => path.relative(pkgDir, f).replace(/\\/g, "/"));
        const fileArgs = relativeSubFiles.map(f => `"${f}"`).join(" ");

        const subTimeout = Math.min(4 * 60 * 1000, Math.max(JEST_TIMEOUT_MS, relativeSubFiles.length * 4 * 1000));
        await addJobLog(jobId, "INFO", `[SCRUM-140] Đang chạy Jest cho subpackage ${pkgDir} (${relativeSubFiles.length} file)...`).catch(() => { });

        const subJestCmd = `cd "${pkgDir}" && npx --yes jest ${fileArgs} --coverage --passWithNoTests --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --json --outputFile="${subResultsRel}" --forceExit --testTimeout=30000 --maxWorkers=2`;

        const subResult = await dockerRunner.run({
            snapshotPath: rootDir,
            command: subJestCmd,
            timeoutMs: subTimeout,
            jobId,
            env: {
                NODE_OPTIONS: "--experimental-vm-modules"
            }
        });

        if (subResult.exitCode !== 0 && subResult.exitCode !== null) {
            overallExitCode = subResult.exitCode;
        }

        // Merge subResults into main jest-results.json
        const rootJestResultsPath = path.join(covDir, "jest-results.json");
        if (fs.existsSync(subResultsPath)) {
            try {
                const subResultsData = JSON.parse(fs.readFileSync(subResultsPath, "utf8"));
                if (fs.existsSync(rootJestResultsPath)) {
                    const rootResultsData = JSON.parse(fs.readFileSync(rootJestResultsPath, "utf8"));
                    const mergedResults = mergeTestResults(rootResultsData, subResultsData);
                    fs.writeFileSync(rootJestResultsPath, JSON.stringify(mergedResults, null, 2), "utf8");
                } else {
                    fs.copyFileSync(subResultsPath, rootJestResultsPath);
                }
            } catch (err) {
                console.warn(`[runJestCoverage] Lỗi merge test results từ ${pkgDir}:`, err.message);
            }
        }

        // Merge coverage-final.json
        const subCovFinal = path.join(targetDir, "coverage", "coverage-final.json");
        const rootCovFinal = path.join(covDir, "coverage-final.json");
        if (fs.existsSync(subCovFinal)) {
            try {
                const subFinalData = JSON.parse(fs.readFileSync(subCovFinal, "utf8"));
                let rootFinalData = {};
                if (fs.existsSync(rootCovFinal)) {
                    try { rootFinalData = JSON.parse(fs.readFileSync(rootCovFinal, "utf8")); } catch { }
                }
                const mergedFinal = mergeCoverageFinal(rootFinalData, subFinalData);
                fs.writeFileSync(rootCovFinal, JSON.stringify(mergedFinal, null, 2), "utf8");
            } catch (err) {
                console.warn(`[runJestCoverage] Lỗi merge coverage-final từ ${pkgDir}:`, err.message);
            }
        }

        // Merge coverage-summary.json
        const subCovSummary = path.join(targetDir, "coverage", "coverage-summary.json");
        const rootCovSummary = path.join(covDir, "coverage-summary.json");
        if (fs.existsSync(subCovSummary)) {
            try {
                const subSummaryData = JSON.parse(fs.readFileSync(subCovSummary, "utf8"));
                let rootSummaryData = {};
                if (fs.existsSync(rootCovSummary)) {
                    try { rootSummaryData = JSON.parse(fs.readFileSync(rootCovSummary, "utf8")); } catch { }
                }
                const mergedSummary = mergeCoverageSummaries(rootSummaryData, subSummaryData);
                fs.writeFileSync(rootCovSummary, JSON.stringify(mergedSummary, null, 2), "utf8");
            } catch (err) {
                console.warn(`[runJestCoverage] Lỗi merge coverage-summary từ ${pkgDir}:`, err.message);
            }
        }

        // Merge lcov.info
        const subLcov = path.join(targetDir, "coverage", "lcov.info");
        const rootLcov = path.join(covDir, "lcov.info");
        if (fs.existsSync(subLcov)) {
            try {
                const subLcovContent = fs.readFileSync(subLcov, "utf8");
                fs.appendFileSync(rootLcov, "\n" + subLcovContent, "utf8");
            } catch { }
        }
    }

    // Backup Jest coverage outputs
    const covFinal = path.join(covDir, "coverage-final.json");
    const covSummary = path.join(covDir, "coverage-summary.json");
    if (fs.existsSync(covFinal)) {
        try { fs.copyFileSync(covFinal, path.join(covDir, "jest-coverage-final.json")); } catch { }
    }
    if (fs.existsSync(covSummary)) {
        try { fs.copyFileSync(covSummary, path.join(covDir, "jest-coverage-summary.json")); } catch { }
    }

    // Exit code checking
    const summaryFile = path.join(covDir, "coverage-summary.json");
    const mainResultsPath = path.join(covDir, "jest-results.json");
    if (overallExitCode >= 2 && !fs.existsSync(summaryFile) && !fs.existsSync(mainResultsPath)) {
        const msg = `[SCRUM-140] jest kết thúc với exit code ${overallExitCode} và không sinh coverage`;
        await addJobLog(jobId, "ERROR", msg).catch(() => { });
        throw new Error(msg);
    }

    await addJobLog(jobId, "INFO", `[SCRUM-140] jest hoàn thành (exit ${overallExitCode}).`).catch(() => { });
    return { exitCode: overallExitCode };
};

/**
 * SCRUM-141: Parse coverage-final.json để lấy per-file coverage data.
 */
const readCoverageFinal = (coverageDir) => {
    const finalPath = path.join(coverageDir, "coverage-final.json");
    if (!fs.existsSync(finalPath)) {
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(finalPath, "utf8"));
        const summaryPath = path.join(coverageDir, "coverage-summary.json");
        if (fs.existsSync(summaryPath)) {
            try {
                const summaryRaw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
                for (const [key, entry] of Object.entries(raw)) {
                    if (!entry || typeof entry !== "object") continue;
                    const normKey = key.replace(/\\/g, "/");
                    const summaryEntry = summaryRaw[key] || summaryRaw[normKey] || Object.entries(summaryRaw).find(([sk]) => sk.replace(/\\/g, "/") === normKey)?.[1];
                    if (summaryEntry && typeof summaryEntry === "object") {
                        if (summaryEntry.lines) entry.lines = summaryEntry.lines;
                        if (summaryEntry.branches) entry.branches = summaryEntry.branches;
                        if (summaryEntry.functions) entry.functions = summaryEntry.functions;
                        if (summaryEntry.statements) entry.statements = summaryEntry.statements;
                    }
                }
            } catch { }
        }
        return raw;
    } catch {
        return null;
    }
};

/**
 * SCRUM-141: Parse per-file coverage từ coverage-final.json và lưu CoverageFile vào DB.
 */
const parseFinalCoverageFiles = async (jobId, snapshotId, projectId, userId, coverageDir) => {
    const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
    const coverageReport = readCoverageFinal(coverageDir);

    if (!coverageReport) {
        await addJobLog(jobId, "WARN", "[SCRUM-141] coverage-final.json không tồn tại, bỏ qua parse CoverageFile.").catch(() => { });
        return;
    }

    try {
        const result = await parseCoverageFilesForSnapshot({
            projectId,
            snapshotId,
            coverageReport,
            userId,
        });
        await addJobLog(
            jobId,
            "INFO",
            `[SCRUM-141] Đã parse ${result.totalFiles} CoverageFile records.`
        ).catch(() => { });
    } catch (err) {
        await addJobLog(jobId, "WARN", `[SCRUM-141] Lỗi parse CoverageFile: ${err.message}`).catch(() => { });
    }
};

/**
 * SCRUM-141: Parse per-function coverage từ coverage-final.json và lưu CoverageFunction vào DB.
 */
const parseFinalCoverageFunctions = async (jobId, snapshotId, projectId, userId, coverageDir) => {
    const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");
    const coverageReport = readCoverageFinal(coverageDir);

    if (!coverageReport) {
        await addJobLog(jobId, "WARN", "[SCRUM-141] coverage-final.json không tồn tại, bỏ qua parse CoverageFunction.").catch(() => { });
        return;
    }

    try {
        const result = await parseCoverageFunctionsForSnapshot({
            projectId,
            snapshotId,
            coverageReport,
            userId,
        });
        await addJobLog(
            jobId,
            "INFO",
            `[SCRUM-141] Đã parse ${result.totalFunctions} CoverageFunction records.`
        ).catch(() => { });
    } catch (err) {
        await addJobLog(jobId, "WARN", `[SCRUM-141] Lỗi parse CoverageFunction: ${err.message}`).catch(() => { });
    }
};

/**
 * Merge two Istanbul coverage-final objects
 */
export const mergeCoverageFinal = (final1 = {}, final2 = {}) => {
    const merged = { ...final1 };
    for (const [filePath, fileCov2] of Object.entries(final2 || {})) {
        if (!merged[filePath]) {
            merged[filePath] = fileCov2;
        } else {
            const fileCov1 = merged[filePath];
            const combined = { ...fileCov1 };
            // Combine statement hits
            if (fileCov1.s && fileCov2.s) {
                combined.s = { ...fileCov1.s };
                for (const [k, v] of Object.entries(fileCov2.s)) {
                    combined.s[k] = (combined.s[k] || 0) + (v || 0);
                }
            }
            // Combine function hits
            if (fileCov1.f && fileCov2.f) {
                combined.f = { ...fileCov1.f };
                for (const [k, v] of Object.entries(fileCov2.f)) {
                    combined.f[k] = (combined.f[k] || 0) + (v || 0);
                }
            }
            // Combine branch hits
            if (fileCov1.b && fileCov2.b) {
                combined.b = { ...fileCov1.b };
                for (const [k, v] of Object.entries(fileCov2.b)) {
                    if (Array.isArray(v)) {
                        combined.b[k] = Array.isArray(combined.b[k])
                            ? combined.b[k].map((val, idx) => (val || 0) + (v[idx] || 0))
                            : v;
                    }
                }
            }
            merged[filePath] = combined;
        }
    }
    return merged;
};

/**
 * Merge two Istanbul coverage-summary objects and recompute totals
 */
export const mergeCoverageSummaries = (sum1 = {}, sum2 = {}) => {
    const merged = { ...sum1, ...sum2 };
    const total = {
        lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
        statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
        functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
        branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
    };
    for (const [key, item] of Object.entries(merged)) {
        if (key === "total" || !item || typeof item !== "object") continue;
        const normKey = key.replace(/\\/g, "/").toLowerCase();
        // Exclude API files and frontend files from unit coverage totals
        if (
            /(^|\/)(routes?|controllers?|endpoints?|api)(\/|\.|$)/i.test(normKey) ||
            /\.(route|routes|controller|controllers)\.[cm]?[jt]sx?$/i.test(normKey) ||
            /(^|\/)(app|server)\.[cm]?[jt]sx?$/i.test(normKey) ||
            /^(src\/)?(index|main)\.[cm]?[jt]sx?$/i.test(normKey.replace(/^\.?\//, "")) ||
            /(^|\/)(client|frontend|pages|components|ui|web)\//i.test(normKey) ||
            /\.[jt]sx$/i.test(normKey)
        ) {
            continue;
        }
        for (const metric of ["lines", "statements", "functions", "branches"]) {
            if (item[metric]) {
                total[metric].total += item[metric].total || 0;
                total[metric].covered += item[metric].covered || 0;
                total[metric].skipped += item[metric].skipped || 0;
            }
        }
    }
    for (const metric of ["lines", "statements", "functions", "branches"]) {
        total[metric].pct = total[metric].total > 0
            ? Number(((total[metric].covered / total[metric].total) * 100).toFixed(1))
            : 100;
    }
    merged.total = total;
    return merged;
};

/**
 * Merge Jest and Vitest test-results JSON format
 */
export const mergeTestResults = (...results) => {
    const flatResults = results.flat().filter(Boolean);
    const list = [];
    const seenSuites = new Set();
    let numTotalTests = 0;
    let numPassedTests = 0;
    let numFailedTests = 0;
    let numPendingTests = 0;
    let startTime = Infinity;
    let endTime = 0;

    const getSuiteKey = (name) => {
        if (!name) return "";
        const norm = name.replace(/\\/g, "/");
        const m = norm.match(/(?:\/|^)(?:workspace|repo)\/(.+)$/i);
        return m ? m[1] : norm;
    };

    for (const res of flatResults) {
        if (!res) continue;
        if (Array.isArray(res.testResults)) {
            for (const suite of res.testResults) {
                const key = getSuiteKey(suite?.name);
                if (key) {
                    if (seenSuites.has(key)) {
                        const idx = list.findIndex(s => getSuiteKey(s?.name) === key);
                        if (idx !== -1) {
                            list[idx] = suite;
                        }
                    } else {
                        seenSuites.add(key);
                        list.push(suite);
                    }
                } else {
                    list.push(suite);
                }
            }
        }
        numTotalTests += res.numTotalTests || 0;
        numPassedTests += res.numPassedTests || 0;
        numFailedTests += res.numFailedTests || 0;
        numPendingTests += res.numPendingTests || 0;
        if (res.startTime && res.startTime < startTime) startTime = res.startTime;
        if (res.endTime && res.endTime > endTime) endTime = res.endTime;
    }
    return {
        numTotalTests,
        numPassedTests,
        numFailedTests,
        numPendingTests,
        testResults: list,
        startTime: startTime === Infinity ? Date.now() : startTime,
        endTime: endTime === 0 ? Date.now() : endTime,
        success: numFailedTests === 0
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SCRUM-88: Full Coverage Analysis Pipeline cho RUN_TESTS job.
 * Runs both Jest and Vitest unit tests in a single unified workflow,
 * supporting projects with thousands of test cases.
 *
 * @param {string} jobId  - ID của Job có type="RUN_TESTS"
 */
export const processRunTestsJob = async (jobId) => {
    assertStringField(jobId, "jobId");

    // ── SCRUM-143: Chuyển sang RUNNING ───────────────────────────────────────
    try {
        await markJobRunning(jobId);
    } catch (error) {
        if (
            error.message === "Job not found" ||
            error.message === "Only queued jobs can start" ||
            error.message === "Cannot start a canceled job"
        ) {
            console.log(`[RunTestsJob ${jobId}] Bỏ qua: ${error.message}`);
            return;
        }
        console.error(`[RunTestsJob ${jobId}] Lỗi khi chuyển RUNNING:`, error);
        return;
    }

    // ── Lấy thông tin Job + Snapshot ─────────────────────────────────────────
    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[RunTestsJob ${jobId}] Không lấy được Job:`, error);
        return;
    }

    // Validate snapshot có rootDir
    if (!job.snapshot?.rootDir) {
        const msg = "Snapshot chưa có rootDir — INGEST job chưa hoàn thành.";
        console.error(`[RunTestsJob ${jobId}] ${msg}`);
        await markJobFailed(jobId, new Error(msg)).catch(() => { });
        return;
    }

    const rootDir = job.snapshot.rootDir;
    const snapshotId = job.snapshotId;
    const projectId = job.projectId;
    const userId = job.userId;
    const jestConfigPath = job.snapshot.jestConfigPath ?? null;
    const coverageDir = path.join(rootDir, "coverage");

    // Khởi tạo output record
    await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });

    // ── SCRUM-144: Progress 10% — bắt đầu ───────────────────────────────────
    await updateJobProgress(jobId, 10).catch(() => { });
    await addJobLog(jobId, "INFO", "Pipeline RUN_TESTS bắt đầu.").catch(() => { });

    try {
        // ── SCRUM-139: Install dependencies (Fast check) ─────────────────────
        await addJobLog(jobId, "INFO", "Bước 1/4: Kiểm tra & cài đặt dependencies...").catch(() => { });
        await runNpmInstall(jobId, rootDir);

        // ── SCRUM-144: Progress 25% — sau install ─────────────────────────────
        await updateJobProgress(jobId, 25).catch(() => { });

        // ── SCRUM-140: Discover and classify unit test files ──────────────────
        await addJobLog(jobId, "INFO", "Bước 2/4: Quét và phân loại test files (Jest & Vitest)...").catch(() => { });

        const { jestFiles, vitestFiles, skippedFiles } = findUnitFiles(rootDir);
        const hasVitest = vitestFiles.length > 0;
        const hasJest = jestFiles.length > 0;
        const runBoth = hasVitest && hasJest;

        await addJobLog(
            jobId,
            "INFO",
            `[FRAMEWORK] Phát hiện: Jest (${jestFiles.length} file), Vitest (${vitestFiles.length} file) | Đã loại trừ ${skippedFiles.length} file integration/frontend.`
        ).catch(() => { });

        let runnerResult = { exitCode: 0 };

        if (runBoth) {
            // Step 2a: Run Vitest first
            await updateJobProgress(jobId, 40).catch(() => { });
            await addJobLog(jobId, "INFO", `[VITEST] 1/2: Đang chạy ${vitestFiles.length} file Vitest...`).catch(() => { });
            try {
                const { runVitestCoverage } = await import("./vitestRunner.service.js");
                await runVitestCoverage(jobId, rootDir, job.snapshot?.vitestCommand, vitestFiles);
            } catch (vitestErr) {
                await addJobLog(jobId, "WARN", `[VITEST] Cảnh báo chạy Vitest: ${vitestErr.message}`).catch(() => { });
            }

            // Step 2b: Run Jest
            await updateJobProgress(jobId, 60).catch(() => { });
            await addJobLog(jobId, "INFO", `[JEST] 2/2: Đang chạy ${jestFiles.length} file Jest...`).catch(() => { });
            try {
                runnerResult = await runJestCoverage(jobId, rootDir, jestConfigPath, jestFiles);
            } catch (jestErr) {
                await addJobLog(jobId, "WARN", `[JEST] Cảnh báo chạy Jest: ${jestErr.message}`).catch(() => { });
            }

            // Step 2c: Merge coverage & test results
            await updateJobProgress(jobId, 75).catch(() => { });
            await addJobLog(jobId, "INFO", "Bước 3/4: Hợp nhất kết quả coverage từ Jest & Vitest...").catch(() => { });

            const jestFinalPath = path.join(coverageDir, "jest-coverage-final.json");
            const vitestFinalPath = path.join(coverageDir, "vitest-coverage-final.json");
            const jestSummaryPath = path.join(coverageDir, "jest-coverage-summary.json");
            const vitestSummaryPath = path.join(coverageDir, "vitest-coverage-summary.json");

            // Merge coverage-final.json
            if (fs.existsSync(jestFinalPath) || fs.existsSync(vitestFinalPath)) {
                let jf = {};
                let vf = {};
                try { if (fs.existsSync(jestFinalPath)) jf = JSON.parse(fs.readFileSync(jestFinalPath, "utf8")); } catch { }
                try { if (fs.existsSync(vitestFinalPath)) vf = JSON.parse(fs.readFileSync(vitestFinalPath, "utf8")); } catch { }
                const mergedFinal = mergeCoverageFinal(jf, vf);
                fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify(mergedFinal, null, 2), "utf8");
            }

            // Merge coverage-summary.json
            if (fs.existsSync(jestSummaryPath) || fs.existsSync(vitestSummaryPath)) {
                let js = {};
                let vs = {};
                try { if (fs.existsSync(jestSummaryPath)) js = JSON.parse(fs.readFileSync(jestSummaryPath, "utf8")); } catch { }
                try { if (fs.existsSync(vitestSummaryPath)) vs = JSON.parse(fs.readFileSync(vitestSummaryPath, "utf8")); } catch { }
                const mergedSummary = mergeCoverageSummaries(js, vs);
                fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(mergedSummary, null, 2), "utf8");
            }

            // Merge test-results.json
            const jestResultsFile = path.join(coverageDir, "jest-results.json");
            const vitestResultsFile = path.join(coverageDir, "vitest-results.json");
            let parsedJest = null;
            let parsedVitest = null;
            try { if (fs.existsSync(jestResultsFile)) parsedJest = JSON.parse(fs.readFileSync(jestResultsFile, "utf8")); } catch { }
            try { if (fs.existsSync(vitestResultsFile)) parsedVitest = JSON.parse(fs.readFileSync(vitestResultsFile, "utf8")); } catch { }
            if (parsedJest || parsedVitest) {
                const mergedResults = mergeTestResults(parsedJest, parsedVitest);
                fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify(mergedResults, null, 2), "utf8");
            }

            // Merge lcov.info if available
            const jestLcov = path.join(coverageDir, "jest-lcov.info");
            const vitestLcov = path.join(coverageDir, "vitest-lcov.info");
            const rootLcov = path.join(coverageDir, "lcov.info");
            let mergedLcovText = "";
            if (fs.existsSync(jestLcov)) {
                try { mergedLcovText += fs.readFileSync(jestLcov, "utf8") + "\n"; } catch { }
            }
            if (fs.existsSync(vitestLcov)) {
                try { mergedLcovText += fs.readFileSync(vitestLcov, "utf8") + "\n"; } catch { }
            }
            if (mergedLcovText && (!fs.existsSync(rootLcov) || fs.statSync(rootLcov).size < 100)) {
                try { fs.writeFileSync(rootLcov, mergedLcovText, "utf8"); } catch { }
            }

            // Save TestRun for JEST
            try {
                const jestRunData = parseJestResults(coverageDir);
                if (jestRunData) {
                    const { scenarios, ...runProps } = jestRunData;
                    const formattedScenarios = formatScenariosForPrisma(scenarios);
                    const dataPayload = {
                        snapshotId,
                        type: "JEST",
                        ...runProps,
                        startedAt: new Date(),
                        finishedAt: new Date()
                    };
                    if (formattedScenarios) dataPayload.scenarios = formattedScenarios;
                    await prisma.testRun.create({ data: dataPayload });
                    await addJobLog(jobId, "INFO", `[SCRUM-141] Đã lưu TestRun (JEST): ${jestRunData.totalTests} tests (${jestRunData.passedTests} passed).`).catch(() => { });
                }
            } catch (e) {
                console.warn("[processRunTestsJob] Lỗi parse jest TestRun:", e.message);
            }

            // Save TestRun for VITEST
            try {
                const vitestRunData = parseVitestResults(coverageDir);
                if (vitestRunData) {
                    const { scenarios, ...runProps } = vitestRunData;
                    const formattedScenarios = formatScenariosForPrisma(scenarios);
                    const dataPayload = {
                        snapshotId,
                        type: "VITEST",
                        ...runProps,
                        startedAt: new Date(),
                        finishedAt: new Date()
                    };
                    if (formattedScenarios) dataPayload.scenarios = formattedScenarios;
                    await prisma.testRun.create({ data: dataPayload });
                    await addJobLog(jobId, "INFO", `[SCRUM-141] Đã lưu TestRun (VITEST): ${vitestRunData.totalTests} tests (${vitestRunData.passedTests} passed).`).catch(() => { });
                }
            } catch (e) {
                console.warn("[processRunTestsJob] Lỗi parse vitest TestRun:", e.message);
            }

        } else if (hasVitest) {
            await updateJobProgress(jobId, 50).catch(() => { });
            await addJobLog(jobId, "INFO", `[VITEST] Chạy ${vitestFiles.length} file Vitest...`).catch(() => { });
            const { runVitestCoverage } = await import("./vitestRunner.service.js");
            runnerResult = await runVitestCoverage(jobId, rootDir, job.snapshot?.vitestCommand, vitestFiles);
            await updateJobProgress(jobId, 70).catch(() => { });

            const testResults = parseVitestResults(coverageDir) || parseJestResults(coverageDir);
            if (testResults) {
                const { scenarios, ...testRunData } = testResults;
                const formattedScenarios = formatScenariosForPrisma(scenarios);
                const dataPayload = {
                    snapshotId,
                    type: "VITEST",
                    ...testRunData,
                    startedAt: new Date(),
                    finishedAt: new Date()
                };
                if (formattedScenarios) dataPayload.scenarios = formattedScenarios;
                await prisma.testRun.create({ data: dataPayload });
                await addJobLog(jobId, "INFO", `[SCRUM-141] Đã lưu TestRun (VITEST): ${testResults.totalTests} tests.`).catch(() => { });
            }
        } else if (hasJest) {
            await updateJobProgress(jobId, 50).catch(() => { });
            await addJobLog(jobId, "INFO", `[JEST] Chạy ${jestFiles.length} file Jest...`).catch(() => { });
            runnerResult = await runJestCoverage(jobId, rootDir, jestConfigPath, jestFiles);
            await updateJobProgress(jobId, 70).catch(() => { });

            const testResults = parseJestResults(coverageDir) || parseVitestResults(coverageDir);
            if (testResults) {
                const { scenarios, ...testRunData } = testResults;
                const formattedScenarios = formatScenariosForPrisma(scenarios);
                const dataPayload = {
                    snapshotId,
                    type: "JEST",
                    ...testRunData,
                    startedAt: new Date(),
                    finishedAt: new Date()
                };
                if (formattedScenarios) dataPayload.scenarios = formattedScenarios;
                await prisma.testRun.create({ data: dataPayload });
                await addJobLog(jobId, "INFO", `[SCRUM-141] Đã lưu TestRun (JEST): ${testResults.totalTests} tests.`).catch(() => { });
            }
        } else {
            // Fallback if no files matched strict unit filter
            await addJobLog(jobId, "INFO", "[RUN_TESTS] Chạy fallback runner...").catch(() => { });
            runnerResult = await runJestCoverage(jobId, rootDir, jestConfigPath);
            await updateJobProgress(jobId, 70).catch(() => { });
        }

        // Re-compute and normalize coverage-summary.json totals to exclude API and frontend files
        const summaryFile = path.join(coverageDir, "coverage-summary.json");
        if (fs.existsSync(summaryFile)) {
            try {
                const currentSum = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
                const cleanedSum = mergeCoverageSummaries(currentSum, {});
                fs.writeFileSync(summaryFile, JSON.stringify(cleanedSum, null, 2), "utf8");
            } catch { }
        }

        // Parse coverage-summary.json → CoverageSummary + CoverageFile (from summary)
        let summaryResult = null;
        try {
            summaryResult = await parseCoverageSummary(coverageDir, snapshotId);
            await addJobLog(
                jobId,
                "INFO",
                `[SCRUM-141] Summary: lines=${summaryResult.total.lines.pct}%, ` +
                `branches=${summaryResult.total.branches.pct}%, ` +
                `functions=${summaryResult.total.functions.pct}%, ` +
                `statements=${summaryResult.total.statements.pct}% | files=${summaryResult.fileCount}`
            ).catch(() => { });
        } catch (parseErr) {
            await addJobLog(jobId, "WARN", `[SCRUM-141] Lỗi parse coverage-summary: ${parseErr.message}`).catch(() => { });
        }

        // Parse coverage-final.json → CoverageFile (per-file detail)
        await parseFinalCoverageFiles(jobId, snapshotId, projectId, userId, coverageDir);

        // Parse coverage-final.json → CoverageFunction (per-function detail)
        await parseFinalCoverageFunctions(jobId, snapshotId, projectId, userId, coverageDir);

        // Verify lcov.info
        const lcovPath = path.join(coverageDir, "lcov.info");
        const hasLcov = fs.existsSync(lcovPath);
        await addJobLog(jobId, "INFO", `lcov.info: ${hasLcov ? "có" : "không tìm thấy"}`).catch(() => { });

        // ── SCRUM-144: Progress 85% — sau parse ──────────────────────────────
        await updateJobProgress(jobId, 85).catch(() => { });

        // ── SCRUM-142: Store results lên Firebase ─────────────────────────────
        await addJobLog(jobId, "INFO", "Bước 4/4: Lưu coverage files lên Firebase...").catch(() => { });
        let storageResult = {};
        try {
            storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);
            await addJobLog(
                jobId,
                "INFO",
                `[SCRUM-142] Đã lưu ${storageResult.uploadedCount} files lên Firebase.`
            ).catch(() => { });
        } catch (storageErr) {
            await addJobLog(jobId, "WARN", `[SCRUM-142] Lỗi lưu Firebase: ${storageErr.message}`).catch(() => { });
        }

        // ── SCRUM-144: Progress 100% — hoàn thành ────────────────────────────
        await updateJobProgress(jobId, 100).catch(() => { });

        // ── SCRUM-143: Chuyển sang SUCCESS ───────────────────────────────────
        const coverageResult = coverageResultFromSummary(summaryResult);
        await markJobSuccess(jobId, { coverageResult });
        await addJobLog(jobId, "INFO", "Pipeline RUN_TESTS hoàn thành thành công.").catch(() => { });

        console.log(`[RunTestsJob ${jobId}] Pipeline hoàn thành thành công.`);

        // Chain to BUILD_CFG
        try {
            const { default: prisma } = await import("../config/prisma.js");
            const buildCfgJob = await prisma.job.findFirst({
                where: { snapshotId, type: "BUILD_CFG", status: "QUEUED" },
                orderBy: { createdAt: "desc" }
            });
            if (buildCfgJob) {
                const { addJobToQueue } = await import("./queue.service.js");
                await addJobToQueue("BUILD_CFG", buildCfgJob.id);
                console.log(`[RunTestsJob ${jobId}] Đã tự động trigger BUILD_CFG job: ${buildCfgJob.id}`);
            }
        } catch (chainErr) {
            console.error(`[RunTestsJob ${jobId}] Lỗi khi trigger BUILD_CFG:`, chainErr);
        }
    } catch (error) {
        console.error(`[RunTestsJob ${jobId}] Thất bại:`, error);
        await addJobLog(jobId, "ERROR", `Pipeline thất bại: ${error.message}`).catch(() => { });
        await markJobFailed(jobId, error).catch(() => { });

        // Fail pending BUILD_CFG if this fails
        try {
            const job = await getJobById(jobId);
            const { default: prisma } = await import("../config/prisma.js");
            const buildCfgJob = await prisma.job.findFirst({
                where: { snapshotId: job.snapshotId, type: "BUILD_CFG", status: "QUEUED" },
                orderBy: { createdAt: "desc" }
            });
            if (buildCfgJob) {
                await markJobFailed(buildCfgJob.id, new Error(`Failed because RUN_TESTS pipeline failed: ${error.message}`));
                console.log(`[RunTestsJob ${jobId}] Đã đánh dấu failed cho BUILD_CFG job: ${buildCfgJob.id}`);
            }
        } catch (failChainErr) {
            console.error(`[RunTestsJob ${jobId}] Lỗi khi fail BUILD_CFG:`, failChainErr);
        }
    }
};
