import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { analyzeProjectStructure } from "./projectStructureAnalyzer.service.js";
import {
    getJobById,
    markJobFailed,
    markJobRunning,
    markJobSuccess,
    updateJobProgress,
    addJobLog,
} from "./job.service.js";

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

/**
 * Runs static project-structure analysis for one already-authorized snapshot.
 * It never executes repository code. The prior completed result is untouched
 * unless a fresh, fully serializable result has been built successfully.
 */
export const processAnalysisJob = async (jobId) => {
    assertStringField(jobId, "jobId");

    try {
        await markJobRunning(jobId);
    } catch (error) {
        if (["Job not found", "Only queued jobs can start", "Cannot start a canceled job"].includes(error.message)) return;
        console.error(`[Job ${jobId}] Could not start architecture analysis`, error);
        return;
    }

    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[Job ${jobId}] Could not load architecture analysis job`, error);
        return;
    }

    if (!job.snapshot?.rootDir) {
        await markJobFailed(jobId, new ServiceError("Project snapshot is not ready for analysis", 409));
        return;
    }

    try {
        await updateJobProgress(jobId, 15);
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'LOAD_SOURCE', label: "Scanning snapshot for source code files...", progress: 15 }));
        const result = analyzeProjectStructure(job.snapshot.rootDir, { snapshotId: job.snapshotId });
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'DETECT_ENDPOINTS', label: `Analyzed ${result.summary?.totalFiles || 0} source files.`, progress: 75 }));
        await updateJobProgress(jobId, 75);

        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'MAP_DEPENDENCIES', label: "Saving analysis results to database...", progress: 85 }));
        const analysis = await prisma.projectStructureAnalysis.upsert({
            where: { snapshotId: job.snapshotId },
            create: {
                snapshotId: job.snapshotId,
                schemaVersion: result.schemaVersion,
                resultJson: JSON.stringify(result),
            },
            update: {
                schemaVersion: result.schemaVersion,
                resultJson: JSON.stringify(result),
            },
        });
        await updateJobProgress(jobId, 95);
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'COMPLETE', label: "Analysis completed successfully.", progress: 100 }));
        await markJobSuccess(jobId, {
            analysisId: analysis.id,
            snapshotId: job.snapshotId,
            summary: result.summary,
            analyzedAt: result.analyzedAt,
        });
    } catch (error) {
        console.error(`[Job ${jobId}] Architecture analysis failed`, error);
        try {
            await markJobFailed(jobId, error);
        } catch (markError) {
            console.error(`[Job ${jobId}] Could not mark architecture analysis as failed`, markError);
        }
    }
};
