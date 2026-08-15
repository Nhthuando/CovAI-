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
import { saveJobOutput } from "./jobOutput.service.js";
import { runSupertest } from "./supertestRunner.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { detectSupertest } from "./supertestDetection.service.js";
import { parseJestResults } from "./testResultParser.service.js";
import prisma from "../config/prisma.js";

/**
 * Pipeline cho Supertest Coverage:
 * 1. Chạy Supertest (runSupertest)
 * 2. Parse coverage (reuse existing parsers)
 * 3. Lưu kết quả vào DB & Firebase
 */
export const processSupertestCoverageJob = async (jobId) => {
    try {
        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        if (!job?.snapshot?.rootDir) {
            throw new ServiceError("Snapshot is not ready to run Supertest.", 409);
        }
        const { rootDir, jestConfigPath } = job.snapshot;
        const snapshotId = job.snapshotId;
        const projectId = job.projectId;
        const userId = job.userId;

        const supertestInfo = await detectSupertest(rootDir);
        if (!supertestInfo.detected || supertestInfo.supertestFiles.length === 0) {
            throw new ServiceError("No Supertest test files were found in this snapshot.", 422);
        }

        await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
        await updateJobProgress(jobId, 10);
        await addJobLog(jobId, "INFO", "Bắt đầu Supertest coverage pipeline...");

        // 1. Chạy Supertest
        const runResult = await runSupertest(
            jobId,
            rootDir,
            jestConfigPath ?? supertestInfo.configPath,
            supertestInfo.supertestFiles,
        );
        // DockerRunner streams output live. Saving the final buffers also covers
        // alternative runners and guarantees a complete output record.
        await saveJobOutput(jobId, {
            stdout: runResult.stdout ?? "",
            stderr: runResult.stderr ?? "",
        }).catch(() => { });
        const { coverageDir } = runResult;
        await updateJobProgress(jobId, 50);

        // 2. Parse coverage
        const summaryPath = path.join(coverageDir, "coverage-summary.json");
        const finalPath = path.join(coverageDir, "coverage-final.json");
        if (!fs.existsSync(summaryPath) || !fs.existsSync(finalPath)) {
            throw new ServiceError("Supertest completed without producing the required coverage JSON files.", 422);
        }
        const summaryResult = await parseCoverageSummary(coverageDir, snapshotId);

        // Parse test results
        const supertestResults = parseJestResults(coverageDir);
        // SCRUM-141: Persist Supertest test results
        if (supertestResults) {
            await prisma.testRun.create({
                data: {
                    snapshotId,
                    type: "SUPERTEST",
                    totalTests: supertestResults.totalTests,
                    passedTests: supertestResults.passedTests,
                    failedTests: supertestResults.failedTests,
                    skippedTests: supertestResults.skippedTests,
                    durationMs: supertestResults.durationMs,
                    status: supertestResults.status, // PASSED or FAILED
                    startedAt: new Date(), // TODO: Get actual start time
                    finishedAt: new Date() // TODO: Get actual finish time
                }
            });
            await addJobLog(jobId, "INFO", `[SCRUM-141] Đã lưu TestRun (SUPERTEST): ${supertestResults.totalTests} tests.`).catch(() => { });
        }

        // Parse chi tiết (reuse logic từ runTestsJob)
        const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
        const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");

        const coverageReport = JSON.parse(fs.readFileSync(finalPath, "utf8"));
        await parseCoverageFilesForSnapshot({ projectId, snapshotId, coverageReport, userId });
        await parseCoverageFunctionsForSnapshot({ projectId, snapshotId, coverageReport, userId });

        await updateJobProgress(jobId, 80);

        // 3. Lưu kết quả
        const storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);

        await markJobSuccess(jobId, {
            coverage: {
                lines: summaryResult.total.lines.pct,
                branches: summaryResult.total.branches.pct,
                functions: summaryResult.total.functions.pct,
                statements: summaryResult.total.statements.pct,
            },
            supertest: {
                version: supertestInfo.version,
                testFileCount: supertestInfo.supertestFiles.length,
                configFile: supertestInfo.configFile,
                exitCode: runResult.exitCode,
            },
            storageBasePath: storageResult.baseStoragePath,
        });

        await addJobLog(jobId, "INFO", "Supertest coverage pipeline hoàn thành.");
    } catch (error) {
        console.error(`[SupertestCoverageJob ${jobId}] Lỗi:`, error);
        await markJobFailed(jobId, error).catch(() => { });
    }
};
