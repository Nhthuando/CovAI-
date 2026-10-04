import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

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
import { resolveProjectRoot, hasSourceCodeFiles, ensureMinimalPackageJson } from "../utils/projectRootResolver.js";
import { extractFunctions } from "./cyclomaticFunctionExtractor.service.js";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const JEST_TIMEOUT_MS = 2.5 * 60 * 1000;   // 2.5 minutes

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
 * Read project's existing jest config from explicit file, jest.config.*, or package.json
 * @param {string} repoRoot
 * @param {string|null} [explicitConfigPath]
 * @returns {Promise<Object>}
 */
export const readProjectJestConfig = async (repoRoot, explicitConfigPath = null) => {
    // 1. Try explicit path if passed
    if (explicitConfigPath) {
        const resolvedPath = path.isAbsolute(explicitConfigPath)
            ? explicitConfigPath
            : path.join(repoRoot, explicitConfigPath);
        if (fs.existsSync(resolvedPath)) {
            try {
                if (resolvedPath.endsWith(".json")) {
                    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
                }
                const fileUrl = pathToFileURL(resolvedPath).href;
                const mod = await import(`${fileUrl}?t=${Date.now()}`);
                return mod.default || mod;
            } catch (e) {
                console.warn(`[readProjectJestConfig] Error loading explicit config ${resolvedPath}:`, e.message);
            }
        }
    }

    // 2. Check jest.config.js, jest.config.mjs, jest.config.cjs, jest.config.json
    const configNames = [
        "jest.config.js",
        "jest.config.mjs",
        "jest.config.cjs",
        "jest.config.json"
    ];
    for (const name of configNames) {
        const p = path.join(repoRoot, name);
        if (fs.existsSync(p)) {
            try {
                if (name.endsWith(".json")) {
                    return JSON.parse(fs.readFileSync(p, "utf8"));
                }
                const fileUrl = pathToFileURL(p).href;
                const mod = await import(`${fileUrl}?t=${Date.now()}`);
                return mod.default || mod;
            } catch (e) {
                console.warn(`[readProjectJestConfig] Error loading ${p}:`, e.message);
            }
        }
    }

    // 3. Fallback to package.json "jest" field
    const pkgPath = path.join(repoRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            if (pkg.jest && typeof pkg.jest === "object") return pkg.jest;
        } catch { }
    }
    return {};
};

/**
 * Determine if a project repository uses ESM (Node ES modules or ts-jest ESM preset)
 * @param {string} repoRoot
 * @param {Object} [projectJestConfig]
 * @returns {boolean}
 */
export const isEsmProjectForRepo = (repoRoot, projectJestConfig = {}) => {
    try {
        const rootPkgPath = path.join(repoRoot, "package.json");
        if (fs.existsSync(rootPkgPath)) {
            const p = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
            if (p.type === "module") return true;
        }
    } catch { }
    if (projectJestConfig?.preset && typeof projectJestConfig.preset === "string" && projectJestConfig.preset.includes("esm")) return true;
    if (Array.isArray(projectJestConfig?.extensionsToTreatAsEsm) && projectJestConfig.extensionsToTreatAsEsm.length > 0) return true;
    if (projectJestConfig?.transform && typeof projectJestConfig.transform === "object") {
        for (const v of Object.values(projectJestConfig.transform)) {
            if (Array.isArray(v) && v[1]?.useESM) return true;
        }
    }
    return false;
};


/**
 * Dynamically build Jest moduleNameMapper without hardcoding static paths.
 * Resolves package name and directory paths based on actual disk structure.
 *
 * @param {string} rootDir
 * @param {Object} projectJestConfig
 * @param {string} rootPkgName
 * @returns {Object}
 */
export const buildJestModuleNameMapper = (rootDir, projectJestConfig = {}, rootPkgName = "") => {
    const baseMapper = {
        "^(\\.{1,2}/.*)\\.js$": "$1",
        "^(\\.{1,2}/.*)\\.jsx$": "$1",
        "^(\\.{1,2}/.*)\\.mjs$": "$1",
        "^(\\.{1,2}/.*)\\.cjs$": "$1",
    };

    // Only map dist/src alias if dist/src exists or if project / subproject config has dist/src references
    const hasDistSrc = fs.existsSync(path.join(rootDir, "dist", "src"));
    let hasDistSrcReferences = false;
    try {
        const babelrcPath = path.join(rootDir, ".babelrc");
        if (fs.existsSync(babelrcPath)) {
            const babelContent = fs.readFileSync(babelrcPath, "utf8");
            if (babelContent.includes("dist/src")) hasDistSrcReferences = true;
        }
        if (!hasDistSrcReferences && fs.existsSync(rootDir)) {
            const subEntries = fs.readdirSync(rootDir, { withFileTypes: true });
            for (const entry of subEntries) {
                if (entry.isDirectory() && !["node_modules", ".git", "storage"].includes(entry.name)) {
                    const subBabel = path.join(rootDir, entry.name, ".babelrc");
                    if (fs.existsSync(subBabel)) {
                        const content = fs.readFileSync(subBabel, "utf8");
                        if (content.includes("dist/src")) {
                            hasDistSrcReferences = true;
                            break;
                        }
                    }
                }
            }
        }
    } catch { }

    if (hasDistSrc || hasDistSrcReferences) {
        const distSrcTarget = hasDistSrc
            ? "<rootDir>/dist/src"
            : (fs.existsSync(path.join(rootDir, "src")) ? "<rootDir>/src" : null);
        if (distSrcTarget) {
            baseMapper["^(?:\\.{1,2}/)+dist/src$"] = distSrcTarget;
            baseMapper["^(?:\\.{1,2}/)+dist/src/(.*)$"] = `${distSrcTarget}/$1`;
            baseMapper[".*dist/src$"] = distSrcTarget;
            baseMapper[".*dist/src/(.*)"] = `${distSrcTarget}/$1`;
        }
    }

    if (rootPkgName) {
        // Resolve package self-reference dynamically based on actual directory structure
        let selfTarget = null;
        if (fs.existsSync(path.join(rootDir, "dist", "src"))) {
            selfTarget = "<rootDir>/dist/src";
        } else if (fs.existsSync(path.join(rootDir, "src"))) {
            selfTarget = "<rootDir>/src";
        } else if (fs.existsSync(path.join(rootDir, "dist"))) {
            selfTarget = "<rootDir>/dist";
        } else if (fs.existsSync(path.join(rootDir, "lib"))) {
            selfTarget = "<rootDir>/lib";
        }

        if (selfTarget) {
            baseMapper[`^${rootPkgName}$`] = selfTarget;
            baseMapper[`^${rootPkgName}/(.*)$`] = `${selfTarget}/$1`;
        }
    }

    return {
        ...baseMapper,
        ...(projectJestConfig?.moduleNameMapper || {})
    };
};

/**
 * Detect if project requires building (e.g. tsc / babel / build script) before running tests,
 * and execute build inside container if necessary.
 *
 * @param {string} jobId
 * @param {string} rootDir
 * @returns {Promise<boolean>}
 */
export const detectAndRunBuild = async (jobId, rootDir) => {
    const pkgPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(pkgPath)) return false;

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const scripts = pkg.scripts || {};
        const main = pkg.main || "";
        const typings = pkg.typings || pkg.types || "";

        const distExists = fs.existsSync(path.join(rootDir, "dist"));
        const buildDirExists = fs.existsSync(path.join(rootDir, "build"));

        const hasBuildScript = Boolean(scripts.build);
        const referencesDist = (
            main.startsWith("dist") ||
            main.startsWith("./dist") ||
            main.startsWith("build") ||
            main.startsWith("./build") ||
            typings.startsWith("dist") ||
            typings.startsWith("./dist") ||
            typings.startsWith("build") ||
            typings.startsWith("./build")
        );
        const hasTsConfig = fs.existsSync(path.join(rootDir, "tsconfig.json"));

        const needsBuild = (hasBuildScript && (!distExists && !buildDirExists)) ||
            (referencesDist && (!distExists && !buildDirExists));

        if (needsBuild) {
            const buildCmd = hasBuildScript ? "npm run build" : (hasTsConfig ? "npx tsc --skipLibCheck" : null);
            if (buildCmd) {
                if (jobId) {
                    await addJobLog(jobId, "INFO", `[BUILD] Detected project requires build before testing (${buildCmd}). Building...`).catch(() => { });
                }
                const buildRes = await dockerRunner.run({
                    snapshotPath: rootDir,
                    command: buildCmd,
                    timeoutMs: 180000,
                    jobId: jobId || "build-pre-test"
                });
                if (buildRes.success || buildRes.exitCode === 0) {
                    if (jobId) {
                        await addJobLog(jobId, "INFO", `[BUILD] Project built successfully.`).catch(() => { });
                    }
                    return true;
                } else {
                    if (jobId) {
                        await addJobLog(jobId, "WARN", `[BUILD] Build finished with exit code ${buildRes.exitCode}: ${(buildRes.stderr || buildRes.stdout || "").slice(0, 300)}`).catch(() => { });
                    }
                    return false;
                }
            }
        }
    } catch (err) {
        if (jobId) {
            await addJobLog(jobId, "WARN", `[BUILD] Error checking/executing build: ${err.message}`).catch(() => { });
        }
    }
    return false;
};

/**
 * Parses module resolution errors from test runner output.
 * Returns detailed structured diagnostic information.
 *
 * @param {string} errorOutput
 * @param {string} rootDir
 * @returns {Object|null}
 */
export const parseModuleResolutionError = (errorOutput, rootDir = "") => {
    if (!errorOutput || typeof errorOutput !== "string") return null;

    const cannotFindMatch = errorOutput.match(/Cannot find module ['"]([^'"]+)['"]\s+from\s+['"]([^'"]+)['"]/i);
    if (cannotFindMatch) {
        const missingModule = cannotFindMatch[1];
        const testFile = cannotFindMatch[2];
        let expectedSourcePath = null;
        try {
            if (missingModule.startsWith(".")) {
                expectedSourcePath = path.resolve(rootDir, path.dirname(testFile), missingModule);
            } else {
                expectedSourcePath = path.resolve(rootDir, "node_modules", missingModule);
            }
        } catch { }

        return {
            type: "MODULE_RESOLUTION_ERROR",
            missingModule,
            testFile,
            pathResolving: missingModule,
            workingDirectory: rootDir,
            expectedSourcePath,
            actualError: cannotFindMatch[0],
            rawOutput: errorOutput.slice(0, 1000)
        };
    }
    return null;
};

/**
 * Resolves imports in a test file to verify they exist before test execution.
 * Checks relative imports, detects needed dist/src or build artifacts,
 * and returns diagnostic information.
 *
 * @param {string} testFile - Path to test file
 * @param {string} rootDir - Root directory of the repository
 * @returns {{ valid: boolean, errors: Object[] }}
 */
export const checkTestFileImports = (testFile, rootDir) => {
    const fullTestPath = path.isAbsolute(testFile) ? testFile : path.join(rootDir, testFile);
    if (!fs.existsSync(fullTestPath)) {
        return { valid: false, errors: [{ type: "FILE_NOT_FOUND", testFile, path: fullTestPath }] };
    }

    const errors = [];
    try {
        const content = fs.readFileSync(fullTestPath, "utf8");
        const importRegex = /(?:import\s+(?:.*?from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
        let match;
        const testDir = path.dirname(fullTestPath);

        while ((match = importRegex.exec(content)) !== null) {
            const importPath = match[1];
            if (importPath.startsWith(".")) {
                const resolvedTarget = path.resolve(testDir, importPath);
                const candidates = [
                    resolvedTarget,
                    resolvedTarget + ".js",
                    resolvedTarget + ".jsx",
                    resolvedTarget + ".ts",
                    resolvedTarget + ".tsx",
                    resolvedTarget + ".mjs",
                    resolvedTarget + ".cjs",
                    path.join(resolvedTarget, "index.js"),
                    path.join(resolvedTarget, "index.ts"),
                    path.join(resolvedTarget, "index.mjs")
                ];

                const exists = candidates.some(c => fs.existsSync(c));
                if (!exists) {
                    errors.push({
                        type: "MODULE_RESOLUTION_ERROR",
                        testFile,
                        missingModule: importPath,
                        pathResolving: importPath,
                        resolvedPath: resolvedTarget,
                        expectedSourcePath: candidates[1],
                        actualFileSystemPath: "Not found",
                        workingDirectory: rootDir
                    });
                }
            }
        }
    } catch { }

    return { valid: errors.length === 0, errors };
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

            // If it's a test file (ends with .test.ts, .spec.ts, etc.), do NOT skip it just because it's in a helper/util folder!
            const isTestFileName = /\.(test|spec|testcase|steps?)\.[cm]?[jt]s$/i.test(entry.name);
            const isHelperDir = !isTestFileName && /(^|\/)(test-data|test_data|fixtures?|helpers?|mocks?|__mocks__|utils?|support)\//i.test(lowerRel);
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
 * Detect all code logic files (non-test, non-config, non-frontend) in the project.
 * Used when a project does not have Jest or Vitest test files yet so that
 * analysis can still run and display the code logic files for AI test suggestions.
 */
export const findLogicSourceFiles = (rootDir) => {
    const logicFiles = [];
    if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
        return logicFiles;
    }

    const IGNORED_DIRS = new Set([
        "node_modules", ".git", "coverage", "dist", "build",
        ".next", ".vite", ".vitest", ".cache", "storage",
        "client", "frontend", "ui", "web", "test-data", "test_data",
        "fixtures", "mocks", "__mocks__", "public", "assets", "static"
    ]);

    const walk = (dir) => {
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
                if (
                    IGNORED_DIRS.has(entry.name) ||
                    lowerRel.includes("/client/") ||
                    lowerRel.includes("/frontend/") ||
                    lowerRel.includes("/tests/") ||
                    lowerRel.includes("/__tests__/") ||
                    lowerRel.includes("/specs/")
                ) {
                    continue;
                }
                walk(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;

            // Only inspect JavaScript / TypeScript files
            if (!/\.[cm]?[jt]s$/i.test(entry.name)) {
                continue;
            }

            // Exclude TypeScript type definitions
            if (/\.d\.ts$/i.test(entry.name)) {
                continue;
            }

            // Exclude test files
            const isTest = (
                /\.(test|spec|testcase|steps?)\.[cm]?[jt]s$/i.test(entry.name) ||
                /(^|\/)(tests?|__tests__|specs?|unit)\//i.test(lowerRel)
            );
            if (isTest) continue;

            // Exclude helper/setup/config files
            if (/^(setup|global-?setup|setup-?tests|teardown|helpers?|fixtures?)\.[a-z0-9]+$/i.test(entry.name)) {
                continue;
            }
            if (/^(jest|vitest|babel|webpack|vite|rollup|eslint|prettier|tailwind|postcss)\.config\.[a-z0-9]+$/i.test(entry.name)) {
                continue;
            }

            logicFiles.push({
                absolutePath: fullPath,
                relativePath: relPath,
                fileName: entry.name
            });
        }
    };

    walk(rootDir);
    return logicFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

/**
 * Generate 0% baseline coverage artifacts (coverage-summary.json and coverage-final.json)
 * for logic files in projects that have no test files yet.
 */
export const generateBaselineCoverage = (rootDir, logicFiles, coverageDir) => {
    if (!fs.existsSync(coverageDir)) {
        try { fs.mkdirSync(coverageDir, { recursive: true }); } catch { }
    }

    const summaryData = {
        total: {
            lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
            statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
            functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
            branches: { total: 0, covered: 0, skipped: 0, pct: 100 }
        }
    };
    const coverageFinal = {};

    for (const file of logicFiles) {
        let content = "";
        try {
            content = fs.readFileSync(file.absolutePath, "utf8");
        } catch {
            continue;
        }

        const codeLines = content.split("\n");
        const totalLines = Math.max(1, codeLines.length);

        let funcs = [];
        try {
            funcs = extractFunctions(content) || [];
        } catch {
            funcs = [];
        }

        if (funcs.length === 0) {
            const fnRegex = /(?:function\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*function)/g;
            let match;
            let idx = 0;
            while ((match = fnRegex.exec(content)) !== null) {
                const fnName = match[1] || match[2] || match[3] || `fn_${idx}`;
                const line = content.slice(0, match.index).split("\n").length;
                funcs.push({ functionName: fnName, startLine: line, endLine: line + 5 });
                idx++;
            }
        }

        const totalFuncs = funcs.length;
        const totalStmts = totalLines;

        summaryData.total.lines.total += totalLines;
        summaryData.total.statements.total += totalStmts;
        summaryData.total.functions.total += totalFuncs;

        const fileSummary = {
            lines: { total: totalLines, covered: 0, skipped: 0, pct: 0 },
            statements: { total: totalStmts, covered: 0, skipped: 0, pct: 0 },
            functions: { total: totalFuncs, covered: 0, skipped: 0, pct: 0 },
            branches: { total: 0, covered: 0, skipped: 0, pct: 100 }
        };

        summaryData[file.absolutePath] = fileSummary;
        summaryData[file.relativePath] = fileSummary;

        const statementMap = {};
        const fnMap = {};
        const branchMap = {};
        const s = {};
        const f = {};
        const b = {};

        codeLines.forEach((line, i) => {
            const lineNo = i + 1;
            statementMap[String(i)] = {
                start: { line: lineNo, column: 0 },
                end: { line: lineNo, column: line.length }
            };
            s[String(i)] = 0;
        });

        funcs.forEach((fn, i) => {
            const sLine = fn.startLine || 1;
            const eLine = fn.endLine || sLine;
            fnMap[String(i)] = {
                name: fn.functionName || `anonymous_${i}`,
                decl: { start: { line: sLine, column: 0 }, end: { line: eLine, column: 0 } },
                loc: { start: { line: sLine, column: 0 }, end: { line: eLine, column: 0 } },
                line: sLine
            };
            f[String(i)] = 0;
        });

        const fileFinalEntry = {
            path: file.relativePath,
            statementMap,
            fnMap,
            branchMap,
            s,
            f,
            b
        };
        coverageFinal[file.relativePath] = fileFinalEntry;
        coverageFinal[file.absolutePath] = fileFinalEntry;
    }

    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(summaryData, null, 2), "utf8");
    fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify(coverageFinal, null, 2), "utf8");

    return { summaryData, coverageFinal };
};

/**
 * Automatically scans and heals any test files whose imports contain leaked
 * storage prefixes (e.g. '../storage/projects/.../repo/src/foo') and restores
 * clean relative import paths based on the test file's location.
 */
export const healAllTestFiles = (rootDir, specificFiles = []) => {
    if (!rootDir || !fs.existsSync(rootDir)) return;

    const filesToHeal = [];
    if (specificFiles && specificFiles.length > 0) {
        for (const f of specificFiles) {
            const fullP = path.isAbsolute(f) ? f : path.join(rootDir, f);
            if (fs.existsSync(fullP)) {
                filesToHeal.push({ fullP, relP: path.relative(rootDir, fullP).replace(/\\/g, "/") });
            }
        }
    } else {
        const walk = (dir) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullP = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!["node_modules", ".git", "coverage", "dist", "build", "storage"].includes(entry.name)) {
                        walk(fullP);
                    }
                } else if (entry.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
                    filesToHeal.push({ fullP, relP: path.relative(rootDir, fullP).replace(/\\/g, "/") });
                }
            }
        };
        walk(rootDir);
    }

    for (const { fullP, relP } of filesToHeal) {
        try {
            const content = fs.readFileSync(fullP, "utf8");
            const testDir = path.dirname(relP);

            const healed = content.replace(
                /((?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*)['"])([^'"]+)(['"]\s*\)?)/g,
                (match, prefix, importTarget, suffix) => {
                    if (/storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i.test(importTarget) || /(?:^|\/)\.\.\/.*repo\//i.test(importTarget)) {
                        const cleanSubpath = importTarget
                            .replace(/^.*\/repo\//i, "")
                            .replace(/^\.?\//, "");

                        let rel = path.relative(testDir, cleanSubpath).replace(/\\/g, "/");
                        if (!rel.startsWith(".")) {
                            rel = "./" + rel;
                        }
                        const cleanImport = rel.replace(/\.[cm]?[jt]sx?$/, "");
                        return `${prefix}${cleanImport}${suffix}`;
                    }
                    return match;
                }
            );

            if (healed !== content) {
                fs.writeFileSync(fullP, healed, "utf8");
                console.log(`[healAllTestFiles] Automatically healed broken import paths in: ${relP}`);
            }
        } catch (err) {
            console.warn(`[healAllTestFiles] Could not heal test file ${relP}: ${err.message}`);
        }
    }
};

/**
 * SCRUM-139: Run npm install in rootDir via Docker if dependencies missing.
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

    if (rootHasDeps && backendHasDeps) {
        await addJobLog(jobId, "INFO", "[SCRUM-139] node_modules exists at root.").catch(() => { });
    } else if (hasRootPkg && !rootHasDeps) {
        await addJobLog(jobId, "INFO", `[SCRUM-139] Starting npm install at: ${rootDir}`).catch(() => { });

        const result = await dockerRunner.run({
            snapshotPath: rootDir,
            command: "npm install --include=dev --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false",
            timeoutMs: INSTALL_TIMEOUT_MS,
            jobId
        });

        if (result.success) {
            await addJobLog(jobId, "INFO", "[SCRUM-139] npm install completed successfully.").catch(() => { });
        } else {
            if (fs.existsSync(nodeModulesDir) && fs.readdirSync(nodeModulesDir).length > 2) {
                await addJobLog(jobId, "WARN", `[SCRUM-139] npm install warning (exit code ${result.exitCode}), continuing test execution...`).catch(() => { });
            } else {
                const errorDetail = result.stderr?.trim() || result.stdout?.trim() || "";
                const msg = `[SCRUM-139] npm install failed with exit code ${result.exitCode}${errorDetail ? `: ${errorDetail.slice(0, 200)}` : ""}`;
                await addJobLog(jobId, "ERROR", msg).catch(() => { });
                throw new Error(msg);
            }
        }
    }

    // Check if backend, examples, packages or other subdirectories have package.json without node_modules
    try {
        const findSubPackages = (dir, depth = 1) => {
            const list = [];
            if (depth > 3) return list;
            try {
                for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (item.isDirectory() && !["node_modules", ".git", "coverage", "dist", "build", "storage", "client", "frontend"].includes(item.name)) {
                        const subDir = path.join(dir, item.name);
                        const subPkg = path.join(subDir, "package.json");
                        if (fs.existsSync(subPkg)) {
                            list.push(subDir);
                        }
                        if (depth < 3) {
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
                await addJobLog(jobId, "INFO", `[SCRUM-139] Installing dependencies for ${relSub}...`).catch(() => { });
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
                await addJobLog(jobId, "INFO", `[SCRUM-139] Building project...`).catch(() => { });
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
 * SCRUM-140: Run jest --coverage in rootDir via Docker.
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

const resolveJestBin = (dir) => {
    const localBin = path.join(dir, "node_modules", ".bin", "jest");
    if (fs.existsSync(localBin)) return "./node_modules/.bin/jest";
    const parentBin = path.join(dir, "..", "node_modules", ".bin", "jest");
    if (fs.existsSync(parentBin)) return "../node_modules/.bin/jest";
    if (fs.existsSync("/app/node_modules/.bin/jest")) return "/app/node_modules/.bin/jest";
    return "npx jest";
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
            const classified = findUnitFiles(rootDir);
            if (classified.jestFiles && classified.jestFiles.length > 0) {
                filesToRun = classified.jestFiles;
            }
        } catch { }
    }

    // Ensure project is compiled (e.g. tsc -> dist/src) before running any tests
    await detectAndRunBuild(jobId, rootDir);

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

    const rootJestBin = resolveJestBin(rootDir);
    let jestCmd = `${rootJestBin} --coverage --passWithNoTests --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --json --outputFile=coverage/jest-results.json --forceExit --testTimeout=30000 --maxWorkers=50% --cache`;

    let tempConfigCreated = false;
    const tempConfigName = "covai-jest-runner.json";
    const tempConfigPath = path.join(rootDir, tempConfigName);

    const projectJestConfig = await readProjectJestConfig(rootDir, jestConfigPath);
    const isEsmProject = isEsmProjectForRepo(rootDir, projectJestConfig);

    const rootPkgPath = path.join(rootDir, "package.json");
    let rootPkgName = "";
    try {
        if (fs.existsSync(rootPkgPath)) {
            const p = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
            if (p.name) rootPkgName = p.name;
        }
    } catch { }

    const defaultModuleNameMapper = buildJestModuleNameMapper(rootDir, projectJestConfig, rootPkgName);

    const coveragePathIgnorePatterns = [
        "/node_modules/",
        "/client/",
        "/frontend/",
        "/routes/",
        "/endpoints/",
        "/api/",
        "app\\.[cm]?[jt]s$",
        "server\\.[cm]?[jt]s$"
    ];

    const tsJestSafeConfig = {
        isolatedModules: true,
        diagnostics: false,
        ...(isEsmProject ? { useESM: true } : {}),
        tsconfig: {
            isolatedModules: true,
            allowJs: true,
            esModuleInterop: true,
            skipLibCheck: true,
            ...(isEsmProject ? { module: "esnext" } : { module: "commonjs" }),
            target: "es2020",
            noImplicitAny: false,
            strict: false
        }
    };

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
            transform["^.+\\.tsx?$"] = ["ts-jest", tsJestSafeConfig];
            if (!foundBabelJest && !isEsmProject) {
                transform["^.+\\.[cm]?jsx?$"] = ["ts-jest", tsJestSafeConfig];
            }
        }
        if (foundBabelJest) {
            transform["^.+\\.[cm]?jsx?$"] = [
                "babel-jest",
                {
                    rootMode: "upward-optional",
                    babelrcRoots: [".", "./examples/*", "./packages/*"]
                }
            ];
        }
        return Object.keys(transform).length > 0 ? transform : null;
    };

    const normalizeTransform = (t) => {
        if (!t || typeof t !== "object") return {};
        const result = {};
        for (const [pattern, transformer] of Object.entries(t)) {
            if (transformer === "ts-jest") {
                result[pattern] = ["ts-jest", tsJestSafeConfig];
            } else if (Array.isArray(transformer) && transformer[0] === "ts-jest") {
                const existingOpts = transformer[1] || {};
                const existingTsconfig = existingOpts.tsconfig;
                result[pattern] = [
                    "ts-jest",
                    {
                        ...existingOpts,
                        isolatedModules: true,
                        diagnostics: false,
                        ...(isEsmProject ? { useESM: true } : {}),
                        tsconfig: typeof existingTsconfig === "string"
                            ? existingTsconfig
                            : {
                                ...(typeof existingTsconfig === "object" ? existingTsconfig : {}),
                                isolatedModules: true,
                                allowJs: true,
                                esModuleInterop: true,
                                skipLibCheck: true,
                                ...(isEsmProject ? { module: "esnext" } : { module: "commonjs" }),
                                target: "es2020",
                                noImplicitAny: false,
                                strict: false
                            }
                    }
                ];
            } else {
                result[pattern] = transformer;
            }
        }
        return result;
    };

    const detectedTransform = detectTransforms(rootDir);

    const mergedTransform = {
        ...(detectedTransform || {}),
        ...normalizeTransform(projectJestConfig?.transform)
    };

    const hasJsTransform = Object.keys(mergedTransform).some(k => k.includes("js") || k.includes("jsx"));
    const hasTsJest = Object.values(mergedTransform).some(v => (typeof v === "string" && v.includes("ts-jest")) || (Array.isArray(v) && v[0]?.includes("ts-jest")));
    if (hasTsJest && !hasJsTransform && !isEsmProject) {
        mergedTransform["^.+\\.[cm]?jsx?$"] = ["ts-jest", tsJestSafeConfig];
    }

    const resolvedModuleFileExtensions = Array.from(new Set([
        ...(Array.isArray(projectJestConfig?.moduleFileExtensions) ? projectJestConfig.moduleFileExtensions : []),
        "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "node"
    ]));

    // Omit strict coverage thresholds from runner config so test execution does not fail pass/fail gates prematurely
    const { coverageThreshold: _ignoredThreshold, ...cleanProjectJestConfig } = projectJestConfig || {};
    const effectiveRoots = (cleanProjectJestConfig?.roots && Array.isArray(cleanProjectJestConfig.roots) && cleanProjectJestConfig.roots.length > 0)
        ? cleanProjectJestConfig.roots
        : ["<rootDir>"];
    const extensionsToTreatAsEsm = (isEsmProject && cleanProjectJestConfig?.extensionsToTreatAsEsm)
        ? cleanProjectJestConfig.extensionsToTreatAsEsm
        : (isEsmProject ? [".ts", ".tsx"] : undefined);

    const existingConfigNames = [
        jestConfigPath,
        "jest.config.js",
        "jest.config.mjs",
        "jest.config.cjs",
        "jest.config.ts",
        "jest.config.json"
    ].filter(Boolean);

    let activeProjectConfigFile = null;
    for (const name of existingConfigNames) {
        const full = path.isAbsolute(name) ? name : path.join(rootDir, name);
        if (fs.existsSync(full)) {
            activeProjectConfigFile = path.relative(rootDir, full).replace(/\\/g, "/");
            break;
        }
    }

    const tempSetupName = "covai-jest-setup.mjs";
    const tempSetupPath = path.join(rootDir, tempSetupName);
    try {
        fs.writeFileSync(
            tempSetupPath,
            `try { const { jest } = await import('@jest/globals'); if (typeof globalThis.jest === 'undefined' && jest) { globalThis.jest = jest; } } catch { }\n` +
            `try {\n` +
            `  const matchers = {\n` +
            `    toBeTrue(received) { return { pass: received === true, message: () => 'expected ' + received + ' to be true' }; },\n` +
            `    toBeFalse(received) { return { pass: received === false, message: () => 'expected ' + received + ' to be false' }; }\n` +
            `  };\n` +
            `  if (typeof expect !== 'undefined' && expect && expect.extend) expect.extend(matchers);\n` +
            `  if (typeof global !== 'undefined' && global.expect && global.expect.extend) global.expect.extend(matchers);\n` +
            `  if (typeof globalThis !== 'undefined' && globalThis.expect && globalThis.expect.extend) globalThis.expect.extend(matchers);\n` +
            `} catch { }\n`,
            "utf8"
        );
    } catch { }

    if (shouldRunRoot) {
        if (activeProjectConfigFile) {
            jestCmd += ` --config=${activeProjectConfigFile}`;
            if (Array.isArray(rootFiles) && rootFiles.length > 0 && Array.isArray(specificFiles) && specificFiles.length > 0 && specificFiles.length < rootFiles.length) {
                const fileArgs = rootFiles.slice(0, 100).map(f => `"${f.replace(/\\/g, "/")}"`).join(" ");
                jestCmd += ` ${fileArgs}`;
            }
        } else if (Array.isArray(rootFiles) && rootFiles.length > 0) {
            try {
                const testMatchPatterns = rootFiles.map(f => `<rootDir>/${f.replace(/\\/g, "/")}`);
                const tempConfig = {
                    ...cleanProjectJestConfig,
                    roots: effectiveRoots,
                    testMatch: testMatchPatterns,
                    testTimeout: 30000,
                    testPathIgnorePatterns: [
                        "/node_modules/", "/client/", "/frontend/",
                        ...(Array.isArray(cleanProjectJestConfig?.testPathIgnorePatterns)
                            ? cleanProjectJestConfig.testPathIgnorePatterns.filter(p => !p.includes("node_modules"))
                            : [])
                    ],
                    setupFilesAfterEnv: [
                        ...(Array.isArray(cleanProjectJestConfig?.setupFilesAfterEnv) ? cleanProjectJestConfig.setupFilesAfterEnv : []),
                        `<rootDir>/${tempSetupName}`
                    ],
                    coveragePathIgnorePatterns,
                    moduleNameMapper: defaultModuleNameMapper,
                    ...(Object.keys(mergedTransform).length > 0 ? { transform: mergedTransform } : {}),
                    moduleFileExtensions: resolvedModuleFileExtensions,
                    ...(extensionsToTreatAsEsm ? { extensionsToTreatAsEsm } : {})
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
                const baseTestMatch = Array.isArray(cleanProjectJestConfig?.testMatch) && cleanProjectJestConfig.testMatch.length > 0
                    ? cleanProjectJestConfig.testMatch
                    : [
                        "<rootDir>/**/__tests__/**/*.[jt]s?(x)",
                        "<rootDir>/**/?(*.)+(spec|test|testcase|steps?).[jt]s?(x)",
                        "<rootDir>/**/step-definitions/**/*.[jt]s?(x)",
                        "<rootDir>/tests/**/*.[jt]s?(x)"
                    ];
                const tempConfig = {
                    ...cleanProjectJestConfig,
                    roots: effectiveRoots,
                    testMatch: baseTestMatch,
                    testTimeout: 30000,
                    testPathIgnorePatterns: [
                        "/node_modules/", "/client/", "/frontend/", "/dist/", "playwright", "cypress", "supertest", "vitest",
                        ...(Array.isArray(cleanProjectJestConfig?.testPathIgnorePatterns)
                            ? cleanProjectJestConfig.testPathIgnorePatterns.filter(p => !p.includes("node_modules"))
                            : [])
                    ],
                    setupFilesAfterEnv: [
                        ...(Array.isArray(cleanProjectJestConfig?.setupFilesAfterEnv) ? cleanProjectJestConfig.setupFilesAfterEnv : []),
                        `<rootDir>/${tempSetupName}`
                    ],
                    coveragePathIgnorePatterns,
                    moduleNameMapper: defaultModuleNameMapper,
                    ...(Object.keys(mergedTransform).length > 0 ? { transform: mergedTransform } : {}),
                    moduleFileExtensions: resolvedModuleFileExtensions,
                    ...(extensionsToTreatAsEsm ? { extensionsToTreatAsEsm } : {})
                };
                fs.writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2), "utf8");
                tempConfigCreated = true;
                jestCmd += ` --config=${tempConfigName}`;
            } catch {
                if (jestConfigPath) {
                    const relativeConfig = path.relative(rootDir, jestConfigPath).replace(/\\/g, '/');
                    jestCmd += ` --config=${relativeConfig}`;
                }
                jestCmd += ' --testPathIgnorePatterns="playwright|cypress|supertest|vitest|client|frontend|dist"';
            }
        }


        const fileCount = Array.isArray(rootFiles) && rootFiles.length > 0 ? rootFiles.length : 50;
        const effectiveTimeout = Math.min(4 * 60 * 1000, Math.max(JEST_TIMEOUT_MS, fileCount * 4 * 1000));

        await addJobLog(jobId, "INFO", `[SCRUM-140] Starting jest --coverage (${rootFiles.length > 0 ? rootFiles.length + ' files' : 'all'}) in Docker container (timeout: ${Math.round(effectiveTimeout / 60000)}m)`).catch(() => { });

        let rootPkgModified = false;
        let originalRootPkgContent = null;
        try {
            const rootPkgPath = path.join(rootDir, "package.json");
            if (fs.existsSync(rootPkgPath)) {
                originalRootPkgContent = fs.readFileSync(rootPkgPath, "utf8");
                const rootPkg = JSON.parse(originalRootPkgContent);
                if (!rootPkg.type || rootPkg.type !== "module") {
                    const hasEsmFiles = (rootFiles || []).some(f => {
                        try {
                            const c = fs.readFileSync(path.join(rootDir, f), "utf8");
                            return /\bimport\s+/.test(c) || /\bexport\s+/.test(c);
                        } catch { return false; }
                    });
                    const backendPkgPath = path.join(rootDir, "backend", "package.json");
                    let backendIsModule = false;
                    try {
                        backendIsModule = fs.existsSync(backendPkgPath) && JSON.parse(fs.readFileSync(backendPkgPath, "utf8"))?.type === "module";
                    } catch { }
                    const hasTsConfig = fs.existsSync(path.join(rootDir, "tsconfig.json"));
                    const hasTsFiles = (rootFiles || []).some(f => /\.[cm]?tsx?$/.test(f));
                    const isTsProject = hasTsConfig || hasTsFiles;
                    if (!isTsProject && (hasEsmFiles || backendIsModule)) {
                        rootPkg.type = "module";
                        fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2), "utf8");
                        rootPkgModified = true;
                    }
                }
            }
        } catch { }

        let result;
        try {
            result = await dockerRunner.run({
                snapshotPath: rootDir,
                command: jestCmd,
                timeoutMs: effectiveTimeout,
                jobId,
                env: {
                    NODE_OPTIONS: "--experimental-vm-modules",
                    NODE_PATH: "/app/node_modules:/usr/local/lib/node_modules:./node_modules",
                }
            });
            if (result.exitCode !== 0 && result.exitCode !== null) {
                overallExitCode = result.exitCode;
            }
            if (!result.success || (result.exitCode !== 0 && result.exitCode !== null)) {
                const outputText = (result.stderr || "") + "\n" + (result.stdout || "");
                const modResError = parseModuleResolutionError(outputText, rootDir);
                if (modResError) {
                    await addJobLog(jobId, "ERROR", `[MODULE_RESOLUTION] Test file: "${modResError.testFile}", missing module: "${modResError.missingModule}", resolved path: "${modResError.expectedSourcePath || modResError.pathResolving}", workingDirectory: "${modResError.workingDirectory}"`).catch(() => { });
                }
            }
        } finally {
            if (rootPkgModified && originalRootPkgContent) {
                try {
                    fs.writeFileSync(path.join(rootDir, "package.json"), originalRootPkgContent, "utf8");
                } catch { }
            }
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
        await addJobLog(jobId, "INFO", `[SCRUM-140] Running Jest for subpackage ${pkgDir} (${relativeSubFiles.length} files)...`).catch(() => { });

        // Generate isolated setup and jest config for subpackage
        const tempSubSetupName = `covai-setup-${subSlug}.js`;
        const tempSubSetupPath = path.join(targetDir, tempSubSetupName);
        try {
            fs.writeFileSync(
                tempSubSetupPath,
                `try {\n` +
                `  const matchers = {\n` +
                `    toBeTrue(received) { return { pass: received === true, message: () => 'expected ' + received + ' to be true' }; },\n` +
                `    toBeFalse(received) { return { pass: received === false, message: () => 'expected ' + received + ' to be false' }; }\n` +
                `  };\n` +
                `  if (typeof expect !== 'undefined' && expect && expect.extend) expect.extend(matchers);\n` +
                `  if (typeof global !== 'undefined' && global.expect && global.expect.extend) global.expect.extend(matchers);\n` +
                `  if (typeof globalThis !== 'undefined' && globalThis.expect && globalThis.expect.extend) globalThis.expect.extend(matchers);\n` +
                `} catch { }\n`,
                "utf8"
            );
        } catch { }

        const relRootFromSub = path.relative(targetDir, rootDir).replace(/\\/g, "/") || "..";
        const hasDistSrc = fs.existsSync(path.join(rootDir, "dist", "src"));
        const targetDistSrc = hasDistSrc
            ? `<rootDir>/${relRootFromSub}/dist/src/index.js`
            : (fs.existsSync(path.join(rootDir, "src")) ? `<rootDir>/${relRootFromSub}/src/index.ts` : `<rootDir>/${relRootFromSub}/src`);

        const subModuleNameMapper = {
            "^(?:\\.\\./)+dist/src$": targetDistSrc,
            "^(?:\\.\\./)+dist/src/(.*)$": hasDistSrc ? `<rootDir>/${relRootFromSub}/dist/src/$1` : `<rootDir>/${relRootFromSub}/src/$1`,
            ".*dist/src$": targetDistSrc,
            ".*dist/src/(.*)": hasDistSrc ? `<rootDir>/${relRootFromSub}/dist/src/$1` : `<rootDir>/${relRootFromSub}/src/$1`,
            "^jest-cucumber$": targetDistSrc,
            "^jest-cucumber/(.*)$": hasDistSrc ? `<rootDir>/${relRootFromSub}/dist/src/$1` : `<rootDir>/${relRootFromSub}/src/$1`,
        };

        const pkgJestConfig = await readProjectJestConfig(targetDir);
        const { coverageThreshold: _subThreshold, roots: _subRoots, ...cleanPkgJestConfig } = pkgJestConfig || {};
        const isSubEsm = isEsmProjectForRepo(targetDir, pkgJestConfig);
        const tempSubConfigName = `covai-jest-${subSlug}.json`;
        const tempSubConfigPath = path.join(targetDir, tempSubConfigName);
        let tempSubConfigCreated = false;
        try {
            const subConfig = {
                ...cleanPkgJestConfig,
                roots: ["<rootDir>"],
                setupFilesAfterEnv: [
                    ...(Array.isArray(cleanPkgJestConfig?.setupFilesAfterEnv) ? cleanPkgJestConfig.setupFilesAfterEnv : []),
                    `<rootDir>/${tempSubSetupName}`
                ],
                moduleNameMapper: {
                    ...subModuleNameMapper,
                    ...(cleanPkgJestConfig?.moduleNameMapper || {})
                },
                moduleFileExtensions: Array.from(new Set([
                    ...(Array.isArray(cleanPkgJestConfig?.moduleFileExtensions) ? cleanPkgJestConfig.moduleFileExtensions : []),
                    "js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "node"
                ])),
                ...(isSubEsm && cleanPkgJestConfig?.extensionsToTreatAsEsm
                    ? { extensionsToTreatAsEsm: cleanPkgJestConfig.extensionsToTreatAsEsm }
                    : (isSubEsm ? { extensionsToTreatAsEsm: [".ts", ".tsx"] } : {})
                )
            };
            fs.writeFileSync(tempSubConfigPath, JSON.stringify(subConfig, null, 2), "utf8");
            tempSubConfigCreated = true;
        } catch { }

        const configFlag = tempSubConfigCreated ? ` --config="${tempSubConfigName}"` : "";
        const subJestBin = resolveJestBin(targetDir);
        const subJestCmd = `cd "${pkgDir}" && ${subJestBin} ${fileArgs}${configFlag} --coverage --passWithNoTests --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --json --outputFile="${subResultsRel}" --forceExit --testTimeout=30000 --maxWorkers=50% --cache`;

        let subResult;
        try {
            subResult = await dockerRunner.run({
                snapshotPath: rootDir,
                command: subJestCmd,
                timeoutMs: subTimeout,
                jobId,
                env: {
                    NODE_OPTIONS: "--experimental-vm-modules",
                    NODE_PATH: "/app/node_modules:/usr/local/lib/node_modules:./node_modules:../node_modules",
                }
            });
        } finally {
            if (tempSubConfigCreated && fs.existsSync(tempSubConfigPath)) {
                try { fs.unlinkSync(tempSubConfigPath); } catch { }
            }
            if (fs.existsSync(tempSubSetupPath)) {
                try { fs.unlinkSync(tempSubSetupPath); } catch { }
            }
        }

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
                console.warn(`[runJestCoverage] Error merging test results from ${pkgDir}:`, err.message);
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
                console.warn(`[runJestCoverage] Error merging coverage-final from ${pkgDir}:`, err.message);
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
                console.warn(`[runJestCoverage] Error merging coverage-summary from ${pkgDir}:`, err.message);
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
        const msg = `[SCRUM-140] jest exited with exit code ${overallExitCode} without generating coverage`;
        await addJobLog(jobId, "ERROR", msg).catch(() => { });
        throw new Error(msg);
    }

    await addJobLog(jobId, "INFO", `[SCRUM-140] jest completed (exit ${overallExitCode}).`).catch(() => { });
    return { exitCode: overallExitCode };
};

/**
 * SCRUM-141: Parse coverage-final.json for per-file coverage data.
 */
export const readCoverageFinal = (coverageDir) => {
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
                        for (const m of ["lines", "branches", "functions", "statements"]) {
                            if (summaryEntry[m]) {
                                if (!entry[m] || (summaryEntry[m].covered || 0) >= (entry[m].covered || 0)) {
                                    entry[m] = summaryEntry[m];
                                }
                            }
                        }
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
 * SCRUM-141: Parse per-file coverage from coverage-final.json and persist CoverageFile.
 */
export const parseFinalCoverageFiles = async (jobId, snapshotId, projectId, userId, coverageDir) => {
    const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
    const coverageReport = readCoverageFinal(coverageDir);

    if (!coverageReport) {
        await addJobLog(jobId, "WARN", "[SCRUM-141] coverage-final.json does not exist, skipping CoverageFile parsing.").catch(() => { });
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
            `[SCRUM-141] Parsed ${result.totalFiles} CoverageFile records.`
        ).catch(() => { });
    } catch (err) {
        await addJobLog(jobId, "WARN", `[SCRUM-141] Error parsing CoverageFile: ${err.message}`).catch(() => { });
    }
};

/**
 * SCRUM-141: Parse per-function coverage from coverage-final.json and persist CoverageFunction.
 */
export const parseFinalCoverageFunctions = async (jobId, snapshotId, projectId, userId, coverageDir) => {
    const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");
    const coverageReport = readCoverageFinal(coverageDir);

    if (!coverageReport) {
        await addJobLog(jobId, "WARN", "[SCRUM-141] coverage-final.json does not exist, skipping CoverageFunction parsing.").catch(() => { });
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
            `[SCRUM-141] Parsed ${result.totalFunctions} CoverageFunction records.`
        ).catch(() => { });
    } catch (err) {
        await addJobLog(jobId, "WARN", `[SCRUM-141] Error parsing CoverageFunction: ${err.message}`).catch(() => { });
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
export const mergeCoverageSummaries = (sum1 = {}, sum2 = {}, options = {}) => {
    const merged = {};
    const allKeys = new Set([...Object.keys(sum1 || {}), ...Object.keys(sum2 || {})]);

    for (const key of allKeys) {
        if (key === "total") continue;
        const e1 = sum1?.[key];
        const e2 = sum2?.[key];

        if (!e1 && !e2) continue;
        if (!e1) {
            merged[key] = e2;
            continue;
        }
        if (!e2) {
            merged[key] = e1;
            continue;
        }

        // Intelligently combine metrics from both summaries taking maximum covered counts
        const combined = {};
        for (const metric of ["lines", "statements", "functions", "branches"]) {
            const m1 = e1[metric] || {};
            const m2 = e2[metric] || {};
            const covered = Math.max(m1.covered || 0, m2.covered || 0);
            const total = Math.max(m1.total || 0, m2.total || 0);
            const skipped = Math.max(m1.skipped || 0, m2.skipped || 0);
            const pct = total > 0 ? Number(((covered / total) * 100).toFixed(1)) : 100;
            combined[metric] = { total, covered, skipped, pct };
        }
        merged[key] = combined;
    }

    const total = {
        lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
        statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
        functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
        branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
    };

    // Extract path-matched threshold exceptions from Jest's coverageThreshold (if any)
    // In Jest, files matching these specific path thresholds are subtracted from the global threshold group
    const thresholdExceptions = new Set();
    const coverageThreshold = options?.projectJestConfig?.coverageThreshold;
    if (coverageThreshold && typeof coverageThreshold === "object") {
        for (const pattern of Object.keys(coverageThreshold)) {
            if (pattern === "global") continue;
            // Normalize path (e.g. "./src/clients/quickbooks-client.ts" -> "src/clients/quickbooks-client.ts")
            const normPattern = pattern.replace(/^\.\//, "").replace(/\\/g, "/").toLowerCase();
            thresholdExceptions.add(normPattern);
        }
    }

    for (const [key, item] of Object.entries(merged)) {
        if (key === "total" || !item || typeof item !== "object") continue;
        const normKey = key.replace(/\\/g, "/").toLowerCase();
        // Exclude coverage reports, test fixtures, test files, route files, endpoints, entry files, and frontend files from unit coverage totals
        if (
            /(^|\/)(coverage|dist|build|out|\.next|\.nuxt)\//i.test(normKey) ||
            /(^|\/)(tests?|specs?|__tests__|__mocks__|test-data|test_data|fixtures?|mocks?|e2e|cypress)(\/|$)/i.test(normKey) ||
            /\.(test|spec|testcase|steps?)\./i.test(normKey) ||
            /(^|\/)(routes?|endpoints?)(\/|\.|$)/i.test(normKey) ||
            /\.(route|routes)\.[cm]?[jt]sx?$/i.test(normKey) ||
            /(^|\/)(app|server)\.[cm]?[jt]sx?$/i.test(normKey) ||
            /^(src\/)?(index|main)\.[cm]?[jt]sx?$/i.test(normKey.replace(/^\.?\//, "")) ||
            /(^|\/)(client|frontend|pages|components|ui|web)\//i.test(normKey) ||
            /\.[jt]sx$/i.test(normKey)
        ) {
            continue;
        }

        // Exclude files with explicit path-level thresholds defined in coverageThreshold
        // (Jest subtracts these from the global threshold group)
        const isThresholdException = Array.from(thresholdExceptions).some(exc => normKey.endsWith(exc));
        if (isThresholdException) {
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
 * @param {string} jobId  - ID of Job with type="RUN_TESTS"
 */
export const processRunTestsJob = async (jobId) => {
    assertStringField(jobId, "jobId");

    // ── SCRUM-143: Transition to RUNNING ──────────────────────────────────────
    try {
        await markJobRunning(jobId);
    } catch (error) {
        if (
            error.message === "Job not found" ||
            error.message === "Only queued jobs can start" ||
            error.message === "Cannot start a canceled job"
        ) {
            console.log(`[RunTestsJob ${jobId}] Skipped: ${error.message}`);
            return;
        }
        console.error(`[RunTestsJob ${jobId}] Error transitioning to RUNNING:`, error);
        return;
    }

    // ── Fetch Job + Snapshot info ──────────────────────────────────────────
    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[RunTestsJob ${jobId}] Unable to fetch Job:`, error);
        return;
    }

    // Validate snapshot has rootDir
    if (!job.snapshot?.rootDir) {
        const msg = "Snapshot does not have rootDir — INGEST job pending.";
        console.error(`[RunTestsJob ${jobId}] ${msg}`);
        await markJobFailed(jobId, new Error(msg)).catch(() => { });
        return;
    }

    let rootDir = resolveProjectRoot(job.snapshot.rootDir) || job.snapshot.rootDir;
    ensureMinimalPackageJson(rootDir);
    if (rootDir !== job.snapshot.rootDir && fs.existsSync(path.join(rootDir, "package.json"))) {
        if (typeof prisma?.projectSnapshot?.update === "function") {
            prisma.projectSnapshot.update({
                where: { id: job.snapshotId },
                data: { rootDir }
            }).catch(() => { });
        }
    }
    const snapshotId = job.snapshotId;
    const projectId = job.projectId;
    const userId = job.userId;
    const jestConfigPath = job.snapshot.jestConfigPath ?? null;
    const projectJestConfig = await readProjectJestConfig(rootDir, jestConfigPath);
    const coverageDir = path.join(rootDir, "coverage");

    // Initialize output record
    await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });

    // Invalidate stale coverage files from any previous run to ensure fresh and real metrics
    if (!fs.existsSync(coverageDir)) {
        try { fs.mkdirSync(coverageDir, { recursive: true }); } catch { }
    }
    const staleCoverageFiles = [
        path.join(coverageDir, "coverage-summary.json"),
        path.join(coverageDir, "coverage-final.json"),
        path.join(coverageDir, "jest-results.json"),
        path.join(coverageDir, "vitest-results.json"),
        path.join(coverageDir, "test-results.json"),
        path.join(coverageDir, "lcov.info")
    ];
    for (const sf of staleCoverageFiles) {
        if (fs.existsSync(sf)) {
            try { fs.unlinkSync(sf); } catch { }
        }
    }

    // ── SCRUM-144: Progress 10% — started ───────────────────────────────────
    await updateJobProgress(jobId, 10).catch(() => { });
    await addJobLog(jobId, "INFO", "RUN_TESTS pipeline started.").catch(() => { });

    try {
        // ── SCRUM-139: Install dependencies (Fast check) ─────────────────────
        await addJobLog(jobId, "INFO", "Step 1/4: Checking & installing dependencies...").catch(() => { });
        await runNpmInstall(jobId, rootDir);
        await detectAndRunBuild(jobId, rootDir);

        // ── SCRUM-144: Progress 25% — sau install ─────────────────────────────
        await updateJobProgress(jobId, 25).catch(() => { });

        // ── SCRUM-140: Discover and classify unit test files ──────────────────
        await addJobLog(jobId, "INFO", "Step 2/4: Scanning and classifying test files (Jest & Vitest)...").catch(() => { });

        const { jestFiles, vitestFiles, skippedFiles } = findUnitFiles(rootDir);
        const hasVitest = vitestFiles.length > 0;
        const hasJest = jestFiles.length > 0;
        const runBoth = hasVitest && hasJest;

        // Auto-heal any broken import paths in test files (e.g. leaked storage/projects prefixes)
        healAllTestFiles(rootDir, [...jestFiles, ...vitestFiles]);

        await addJobLog(
            jobId,
            "INFO",
            `[FRAMEWORK] Detected: Jest (${jestFiles.length} files), Vitest (${vitestFiles.length} files) | Excluded ${skippedFiles.length} integration/frontend files.`
        ).catch(() => { });

        let runnerResult = { exitCode: 0 };

        if (runBoth) {
            // Step 2a: Run Vitest first
            await updateJobProgress(jobId, 40).catch(() => { });
            await addJobLog(jobId, "INFO", `[VITEST] 1/2: Running ${vitestFiles.length} Vitest files...`).catch(() => { });
            try {
                const { runVitestCoverage } = await import("./vitestRunner.service.js");
                await runVitestCoverage(jobId, rootDir, job.snapshot?.vitestCommand, vitestFiles);
            } catch (vitestErr) {
                await addJobLog(jobId, "WARN", `[VITEST] Vitest execution warning: ${vitestErr.message}`).catch(() => { });
            }

            // Step 2b: Run Jest
            await updateJobProgress(jobId, 60).catch(() => { });
            await addJobLog(jobId, "INFO", `[JEST] 2/2: Running ${jestFiles.length} Jest files...`).catch(() => { });
            try {
                runnerResult = await runJestCoverage(jobId, rootDir, jestConfigPath, jestFiles);
            } catch (jestErr) {
                await addJobLog(jobId, "WARN", `[JEST] Jest execution warning: ${jestErr.message}`).catch(() => { });
            }

            // Step 2c: Merge coverage & test results
            await updateJobProgress(jobId, 75).catch(() => { });
            await addJobLog(jobId, "INFO", "Step 3/4: Merging coverage results from Jest & Vitest...").catch(() => { });

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
                const mergedSummary = mergeCoverageSummaries(js, vs, { projectJestConfig, rootDir });
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
                    await addJobLog(jobId, "INFO", `[SCRUM-141] Saved TestRun (JEST): ${jestRunData.totalTests} tests (${jestRunData.passedTests} passed).`).catch(() => { });
                }
            } catch (e) {
                console.warn("[processRunTestsJob] Error parsing Jest TestRun:", e.message);
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
                    await addJobLog(jobId, "INFO", `[SCRUM-141] Saved TestRun (VITEST): ${vitestRunData.totalTests} tests (${vitestRunData.passedTests} passed).`).catch(() => { });
                }
            } catch (e) {
                console.warn("[processRunTestsJob] Error parsing Vitest TestRun:", e.message);
            }

        } else if (hasVitest) {
            await updateJobProgress(jobId, 50).catch(() => { });
            await addJobLog(jobId, "INFO", `[VITEST] Running ${vitestFiles.length} Vitest files...`).catch(() => { });
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
                await addJobLog(jobId, "INFO", `[SCRUM-141] Saved TestRun (VITEST): ${testResults.totalTests} tests.`).catch(() => { });
            }
        } else if (hasJest) {
            await updateJobProgress(jobId, 50).catch(() => { });
            await addJobLog(jobId, "INFO", `[JEST] Running ${jestFiles.length} Jest files...`).catch(() => { });
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
                await addJobLog(jobId, "INFO", `[SCRUM-141] Saved TestRun (JEST): ${testResults.totalTests} tests.`).catch(() => { });
            }
        } else {
            // Case: No unit test files detected (0 Jest & 0 Vitest test files)
            // Instead of running a failing test runner on 0 files, detect logic source files
            // and initialize baseline (0%) coverage so the user can suggest unit tests.
            await addJobLog(jobId, "INFO", "[RUN_TESTS] No existing unit test files (Jest/Vitest) found. Scanning logic source files...").catch(() => { });

            const logicFiles = findLogicSourceFiles(rootDir);

            if (logicFiles.length > 0) {
                await addJobLog(
                    jobId,
                    "INFO",
                    `[RUN_TESTS] Found ${logicFiles.length} code logic files. Generating baseline 0% coverage...`
                ).catch(() => { });

                generateBaselineCoverage(rootDir, logicFiles, coverageDir);

                // Create a baseline TestRun with 0 tests
                try {
                    await prisma.testRun.create({
                        data: {
                            snapshotId,
                            type: "JEST",
                            totalTests: 0,
                            passedTests: 0,
                            failedTests: 0,
                            skippedTests: 0,
                            durationMs: 0,
                            status: "PASSED",
                            startedAt: new Date(),
                            finishedAt: new Date(),
                        }
                    });
                    await addJobLog(jobId, "INFO", `[RUN_TESTS] Baseline TestRun saved. Ready for unit test suggestions.`).catch(() => { });
                } catch (trErr) {
                    console.warn("[RUN_TESTS] Warning saving baseline TestRun:", trErr.message);
                }

                runnerResult = { exitCode: 0 };
            } else {
                // If really no logic files either, try fallback runner
                await addJobLog(jobId, "INFO", "[RUN_TESTS] Running fallback runner...").catch(() => { });
                runnerResult = await runJestCoverage(jobId, rootDir, jestConfigPath);
            }
            await updateJobProgress(jobId, 70).catch(() => { });
        }

        // ── SCRUM-140/Problem 1 & 3: Check test execution result ─────────────
        const summaryFile = path.join(coverageDir, "coverage-summary.json");
        const hasCoverageSummary = fs.existsSync(summaryFile);
        let hasValidCoverage = false;
        if (hasCoverageSummary) {
            try {
                const sum = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
                const totalLines = sum?.total?.lines?.total || 0;
                const totalStmts = sum?.total?.statements?.total || 0;
                const totalFiles = Object.keys(sum || {}).filter(k => k !== "total").length;
                if (totalLines > 0 || totalStmts > 0 || totalFiles > 0) {
                    hasValidCoverage = true;
                }
            } catch { }
        }

        if (runnerResult && runnerResult.exitCode !== 0 && runnerResult.exitCode !== null) {
            const jobOutputModule = await import("./jobOutput.service.js").catch(() => ({}));
            const jobFetcher = jobOutputModule.getJobOutput || jobOutputModule.getOutputByJob;
            const jobOutput = typeof jobFetcher === "function" ? await jobFetcher(jobId).catch(() => null) : null;
            const fullOutput = (jobOutput?.stderr || "") + "\n" + (jobOutput?.stdout || "");
            const modResError = parseModuleResolutionError(fullOutput, rootDir);

            // Case 1: Fatal crash / Module resolution failure / Runner failed before generating valid coverage
            if (modResError || !hasValidCoverage) {
                const existingSummary = await prisma.coverageSummary.findUnique({ where: { snapshotId } });
                const previousCoverage = existingSummary ? {
                    statements: existingSummary.stmtsPct,
                    branches: existingSummary.branchesPct,
                    functions: existingSummary.funcsPct,
                    lines: existingSummary.linesPct
                } : null;

                let failMessage = modResError
                    ? `Test suite failed to run: Cannot find module '${modResError.missingModule}' from '${modResError.testFile}'`
                    : `Test execution failed with exit code ${runnerResult.exitCode}`;

                if (!modResError) {
                    const syntaxMatch = fullOutput.match(/(?:SyntaxError|ReferenceError|TypeError|Error):[^\n\r]+/);
                    if (syntaxMatch) {
                        failMessage = `Test execution failed: ${syntaxMatch[0]}`;
                    }
                }

                await addJobLog(jobId, "ERROR", `[RUN_TESTS] ${failMessage}`).catch(() => { });

                // Persist failed test run in DB for accurate history
                try {
                    await prisma.testRun.create({
                        data: {
                            snapshotId,
                            type: hasVitest && !hasJest ? "VITEST" : "JEST",
                            totalTests: 0,
                            passedTests: 0,
                            failedTests: 1,
                            skippedTests: 0,
                            durationMs: 0,
                            status: "FAILED",
                            startedAt: new Date(),
                            finishedAt: new Date(),
                            scenarios: {
                                create: [{
                                    title: modResError ? `Module resolution: ${modResError.missingModule}` : "Test execution failed",
                                    status: "failed",
                                    failureMessages: [failMessage, fullOutput.slice(0, 1000)].filter(Boolean),
                                    testFile: modResError?.testFile || null
                                }]
                            }
                        }
                    });
                } catch { }

                const failErr = new Error(failMessage);
                failErr.moduleResolutionError = modResError;
                failErr.previousCoverage = previousCoverage;
                await markJobFailed(jobId, failErr).catch(() => { });
                return;
            }

            // Case 2: Tests executed and valid coverage was produced, but some assertions failed (e.g. exit code 1)
            await addJobLog(
                jobId,
                "WARN",
                `[RUN_TESTS] Runner completed with warning: some test assertions failed (exit code ${runnerResult.exitCode}). Collecting actual coverage results from executed tests...`
            ).catch(() => { });
        }

        // Re-compute and normalize coverage-summary.json totals to exclude API and frontend files
        if (fs.existsSync(summaryFile)) {
            try {
                const currentSum = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
                const cleanedSum = mergeCoverageSummaries(currentSum, {}, { projectJestConfig, rootDir });
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
            await addJobLog(jobId, "WARN", `[SCRUM-141] Error parsing coverage-summary: ${parseErr.message}`).catch(() => { });
        }

        // Parse coverage-final.json → CoverageFile (per-file detail)
        await parseFinalCoverageFiles(jobId, snapshotId, projectId, userId, coverageDir);

        // Parse coverage-final.json → CoverageFunction (per-function detail)
        await parseFinalCoverageFunctions(jobId, snapshotId, projectId, userId, coverageDir);

        // Verify lcov.info
        const lcovPath = path.join(coverageDir, "lcov.info");
        const hasLcov = fs.existsSync(lcovPath);
        await addJobLog(jobId, "INFO", `lcov.info: ${hasLcov ? "found" : "not found"}`).catch(() => { });

        // ── SCRUM-144: Progress 85% — sau parse ──────────────────────────────
        await updateJobProgress(jobId, 85).catch(() => { });

        // ── SCRUM-142: Store results to Firebase ──────────────────────────────
        await addJobLog(jobId, "INFO", "Step 4/4: Saving coverage files to Firebase...").catch(() => { });
        let storageResult = {};
        try {
            storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);
            await addJobLog(
                jobId,
                "INFO",
                `[SCRUM-142] Saved ${storageResult.uploadedCount} files to Firebase.`
            ).catch(() => { });
        } catch (storageErr) {
            await addJobLog(jobId, "WARN", `[SCRUM-142] Firebase save error: ${storageErr.message}`).catch(() => { });
        }

        // ── SCRUM-144: Progress 100% — completed ──────────────────────────────
        await updateJobProgress(jobId, 100).catch(() => { });

        // ── SCRUM-143: Transition to SUCCESS ──────────────────────────────────
        const coverageResult = coverageResultFromSummary(summaryResult);
        await markJobSuccess(jobId, {
            coverageResult,
            hasTestFailures: runnerResult && runnerResult.exitCode !== 0,
            exitCode: runnerResult?.exitCode ?? 0
        });
        await addJobLog(jobId, "INFO", "RUN_TESTS pipeline completed successfully.").catch(() => { });

        // Invalidate in-memory coverage & testSuites cache
        try {
            const { invalidateCoverageCache } = await import("../controllers/coverage.controller.js");
            invalidateCoverageCache(snapshotId);
        } catch (_) { }

        console.log(`[RunTestsJob ${jobId}] Pipeline completed successfully.`);

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
                console.log(`[RunTestsJob ${jobId}] Automatically triggered BUILD_CFG job: ${buildCfgJob.id}`);
            }
        } catch (chainErr) {
            console.error(`[RunTestsJob ${jobId}] Error triggering BUILD_CFG:`, chainErr);
        }
    } catch (error) {
        console.error(`[RunTestsJob ${jobId}] Failed:`, error);
        await addJobLog(jobId, "ERROR", `Pipeline failed: ${error.message}`).catch(() => { });
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
                console.log(`[RunTestsJob ${jobId}] Marked BUILD_CFG job as failed: ${buildCfgJob.id}`);
            }
        } catch (failChainErr) {
            console.error(`[RunTestsJob ${jobId}] Error failing BUILD_CFG:`, failChainErr);
        }
    }
};
