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
        const { coverageDir } = await runSupertest(jobId, rootDir, jestConfigPath, supertestInfo.supertestFiles);
        await updateJobProgress(jobId, 50);

        // 2. Parse coverage
        const summaryResult = await parseCoverageSummary(coverageDir, snapshotId);

        // Parse chi tiết (reuse logic từ runTestsJob)
        const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
        const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");

        const finalPath = path.join(coverageDir, "coverage-final.json");
        if (fs.existsSync(finalPath)) {
            const coverageReport = JSON.parse(fs.readFileSync(finalPath, "utf8"));
            await parseCoverageFilesForSnapshot({ projectId, snapshotId, coverageReport, userId });
            await parseCoverageFunctionsForSnapshot({ projectId, snapshotId, coverageReport, userId });
        }

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
            storageBasePath: storageResult.baseStoragePath,
        });

        await addJobLog(jobId, "INFO", "Supertest coverage pipeline hoàn thành.");
    } catch (error) {
        console.error(`[SupertestCoverageJob ${jobId}] Lỗi:`, error);
        await markJobFailed(jobId, error).catch(() => { });
    }
};
