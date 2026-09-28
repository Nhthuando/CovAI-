import fs from "fs";
import path from "path";
import { addJobLog } from "./job.service.js";
import { dockerRunner } from "./dockerRunner.service.js";
import { classifyTestFile } from "../utils/testingFrameworkDetector.js";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for npm install
const VITEST_TIMEOUT_MS = 2.5 * 60 * 1000; // 2.5 minutes for testing

/**
 * Install dependencies
 */
export const installVitestDeps = async (jobId, rootDir) => {
    await addJobLog(
        jobId,
        "INFO",
        "Start installing dependencies (Vitest)...",
    ).catch(() => { });

    const result = await dockerRunner.run({
        snapshotPath: rootDir,
        command: "npm install --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false",
        timeoutMs: INSTALL_TIMEOUT_MS,
        jobId,
    });

    if (!result.success) {
        await addJobLog(jobId, "WARN", `Install dependencies warning: ${result.stderr}`).catch(() => { });
    }
};

/**
 * Run Vitest test
 */
export const runVitestTests = async (jobId, rootDir, vitestCommand) => {
    const testCmd = vitestCommand ? vitestCommand : "npx --yes vitest run --passWithNoTests";

    await addJobLog(jobId, "INFO", `Run command: ${testCmd}`).catch(() => { });

    const result = await dockerRunner.run({
        snapshotPath: rootDir,
        command: testCmd,
        timeoutMs: VITEST_TIMEOUT_MS,
        jobId,
    });

    return result;
};

/**
 * Run Vitest with Coverage
 */
export const runVitestCoverage = async (jobId, rootDir, vitestCommand, specificFiles = []) => {
    const rootCoverageDir = path.join(rootDir, "coverage");
    if (!fs.existsSync(rootCoverageDir)) {
        try { fs.mkdirSync(rootCoverageDir, { recursive: true }); } catch { }
    }

    // 1. Dependency check: check both root and backend node_modules
    const rootHasVitest = fs.existsSync(path.join(rootDir, "node_modules", "vitest")) &&
        fs.existsSync(path.join(rootDir, "node_modules", "@vitest", "coverage-v8"));
    const backendHasVitest = fs.existsSync(path.join(rootDir, "backend", "node_modules", "vitest")) &&
        fs.existsSync(path.join(rootDir, "backend", "node_modules", "@vitest", "coverage-v8"));

    if (!rootHasVitest && !backendHasVitest) {
        await addJobLog(jobId, "INFO", `Cài đặt vitest và coverage provider...`).catch(() => { });
        await dockerRunner.run({
            snapshotPath: rootDir,
            command: "npm install -D vitest @vitest/coverage-v8 --no-package-lock --legacy-peer-deps --progress=false",
            timeoutMs: INSTALL_TIMEOUT_MS,
            jobId,
        });
    }

    const fileCount = Array.isArray(specificFiles) && specificFiles.length > 0 ? specificFiles.length : 50;
    const effectiveTimeout = Math.min(4 * 60 * 1000, Math.max(VITEST_TIMEOUT_MS, fileCount * 4 * 1000));

    // 2. Determine execution mode:
    // If backend/ has vitest.config.* or package.json, run directly in backend/
    const backendDir = path.join(rootDir, "backend");
    const hasBackendDir = fs.existsSync(backendDir) &&
        (fs.existsSync(path.join(backendDir, "package.json")) || fs.existsSync(path.join(backendDir, "vitest.config.js")));

    let result;
    if (hasBackendDir) {
        // Fast-path: Execute inside backend targeting unit tests
        let targetArg = "tests/unit";
        if (Array.isArray(specificFiles) && specificFiles.length > 0) {
            const backendSpecific = specificFiles
                .filter(f => f.startsWith("backend/") || !f.includes("/"))
                .map(f => f.replace(/^backend\//, ""));
            if (backendSpecific.length > 0) {
                targetArg = backendSpecific.join(" ");
            }
        }

        const vitestCmd = `cd backend && npx vitest run ${targetArg} --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcov --reporter=json --outputFile=../coverage/vitest-results.json --passWithNoTests`;

        await addJobLog(jobId, "INFO", `[VITEST] Chạy Vitest tại backend/ với lệnh: ${vitestCmd} (timeout: ${Math.round(effectiveTimeout / 60000)}m)`).catch(() => { });

        result = await dockerRunner.run({
            snapshotPath: rootDir,
            command: vitestCmd,
            timeoutMs: effectiveTimeout,
            jobId,
            env: {
                NODE_OPTIONS: "--experimental-vm-modules",
            },
        });

        // Copy backend coverage files into root coverage dir
        const backendCov = path.join(backendDir, "coverage");
        if (fs.existsSync(backendCov)) {
            const bFinal = path.join(backendCov, "coverage-final.json");
            const bSummary = path.join(backendCov, "coverage-summary.json");
            const bLcov = path.join(backendCov, "lcov.info");
            const bResults = path.join(backendCov, "vitest-results.json");

            if (fs.existsSync(bFinal)) {
                try { fs.copyFileSync(bFinal, path.join(rootCoverageDir, "vitest-coverage-final.json")); } catch { }
            }
            if (fs.existsSync(bSummary)) {
                try { fs.copyFileSync(bSummary, path.join(rootCoverageDir, "vitest-coverage-summary.json")); } catch { }
            }
            if (fs.existsSync(bLcov)) {
                try { fs.copyFileSync(bLcov, path.join(rootCoverageDir, "vitest-lcov.info")); } catch { }
            }
            if (fs.existsSync(bResults) && !fs.existsSync(path.join(rootCoverageDir, "vitest-results.json"))) {
                try { fs.copyFileSync(bResults, path.join(rootCoverageDir, "vitest-results.json")); } catch { }
            }
        }
    } else {
        // Root project execution
        let targetArg = "";
        if (Array.isArray(specificFiles) && specificFiles.length > 0) {
            targetArg = specificFiles.join(" ");
        }

        // Detect vitest config in project
        let configArg = "";
        const possibleConfigs = [
            "vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs",
            "examples/vitest/vitest.config.mts", "examples/vitest/vitest.config.ts"
        ];
        for (const cfg of possibleConfigs) {
            if (fs.existsSync(path.join(rootDir, cfg))) {
                configArg = `--config ${cfg}`;
                break;
            }
        }

        const hasLocalVitest = fs.existsSync(path.join(rootDir, "node_modules", "vitest"));
        const baseCmd = vitestCommand
            ? vitestCommand
            : (hasLocalVitest ? "npx vitest run" : "npx --yes vitest run");

        const coverageCmd = `${baseCmd} ${configArg} ${targetArg} --passWithNoTests --globals --coverage.enabled=true --coverage.provider=v8 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcov --reporter=json --outputFile=coverage/vitest-results.json`.replace(/\s+/g, " ").trim();

        await addJobLog(jobId, "INFO", `[VITEST] Chạy Vitest tại rootDir: ${coverageCmd} (timeout: ${Math.round(effectiveTimeout / 60000)}m)`).catch(() => { });

        result = await dockerRunner.run({
            snapshotPath: rootDir,
            command: coverageCmd,
            timeoutMs: effectiveTimeout,
            jobId,
            env: {
                NODE_OPTIONS: "--experimental-vm-modules",
            },
        });

        const vitestResultsPathCheck = path.join(rootCoverageDir, "vitest-results.json");
        // If coverage failed (e.g. coverage provider mismatch), retry running vitest without coverage so test case results are still captured
        if ((!result.success || !fs.existsSync(vitestResultsPathCheck)) && result.exitCode !== null) {
            await addJobLog(jobId, "WARN", `[VITEST] Vitest coverage gặp lỗi (exit ${result.exitCode}), thử lại chế độ kiểm thử cơ bản để lấy kết quả test...`).catch(() => { });
            const fallbackCmd = `${baseCmd} ${configArg} ${targetArg} --passWithNoTests --reporter=json --outputFile=coverage/vitest-results.json`.replace(/\s+/g, " ").trim();
            const fallbackResult = await dockerRunner.run({
                snapshotPath: rootDir,
                command: fallbackCmd,
                timeoutMs: effectiveTimeout,
                jobId,
                env: {
                    NODE_OPTIONS: "--experimental-vm-modules",
                },
            });
            if (fallbackResult.success || fs.existsSync(vitestResultsPathCheck)) {
                result = fallbackResult;
            }
        }

        // Backup to vitest-*
        const covFinal = path.join(rootCoverageDir, "coverage-final.json");
        const covSummary = path.join(rootCoverageDir, "coverage-summary.json");
        if (fs.existsSync(covFinal)) {
            try { fs.copyFileSync(covFinal, path.join(rootCoverageDir, "vitest-coverage-final.json")); } catch { }
        }
        if (fs.existsSync(covSummary)) {
            try { fs.copyFileSync(covSummary, path.join(rootCoverageDir, "vitest-coverage-summary.json")); } catch { }
        }
    }

    // Ensure vitest-results.json exists in coverage dir
    const vitestResultsPath = path.join(rootCoverageDir, "vitest-results.json");
    const hasResults = fs.existsSync(vitestResultsPath);

    await addJobLog(jobId, "INFO", `[VITEST] Hoàn thành vitest (exit ${result.exitCode}, kết quả: ${hasResults ? "có" : "không tìm thấy"}).`).catch(() => { });

    return {
        ...result,
        coverageDir: rootCoverageDir,
    };
};
