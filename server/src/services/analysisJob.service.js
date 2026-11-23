import prisma from "../config/prisma.js";
import { currentProjectOperation,stagePreparedValue } from "./projectOperationWorkspace.service.js";
import {randomUUID} from "node:crypto";
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
import {
    registerJobAbortController,
    unregisterJobAbortController,
    isJobCanceled,
} from "./jobCancellation.service.js";

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

    const abortController = new AbortController();
    registerJobAbortController(jobId, abortController);

    try {
        if (isJobCanceled(jobId, abortController.signal)) return;

        try {
            await markJobRunning(jobId);
        } catch (error) {
            if (["Job not found", "Only queued jobs can start", "Only queued jobs can be started", "Cannot start a canceled job"].includes(error.message)) return;
            console.error(`[Job ${jobId}] Could not start architecture analysis`, error);
            return;
        }

        if (isJobCanceled(jobId, abortController.signal)) return;

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

        if (isJobCanceled(jobId, abortController.signal) || job.status === "CANCELED") {
            return;
        }

        await updateJobProgress(jobId, 15);
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'LOAD_SOURCE', label: "Scanning snapshot for source code files...", progress: 15 }));

        if (isJobCanceled(jobId, abortController.signal)) return;

        // In non-test runtime, yield once to the event loop to permit cancellation checks
        if (process.env.NODE_ENV !== "test") {
            await new Promise((resolve) => setImmediate(resolve));
        }

        if (isJobCanceled(jobId, abortController.signal)) {
            await addJobLog(jobId, "INFO", "Analysis job canceled during source scanning. Preserving prior analysis without overwriting.");
            return;
        }

        const result = analyzeProjectStructure(job.snapshot.rootDir, { snapshotId: job.snapshotId });

        if (isJobCanceled(jobId, abortController.signal)) {
            await addJobLog(jobId, "INFO", "Analysis job canceled. Preserving prior analysis without overwriting.");
            return;
        }

        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'DETECT_ENDPOINTS', label: `Analyzed ${result.summary?.totalFiles || 0} source files.`, progress: 75 }));
        await updateJobProgress(jobId, 75);

        // Safe check before persisting new results: MUST NOT overwrite existing analysis if canceled!
        if (isJobCanceled(jobId, abortController.signal)) {
            await addJobLog(jobId, "INFO", "Analysis job canceled before database commit. Preserving prior analysis.");
            return;
        }

        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'MAP_DEPENDENCIES', label: "Saving analysis results to database...", progress: 85 }));
        let existingRow = null;
        if (typeof prisma?.projectStructureAnalysis?.findUnique === "function") {
            existingRow = await prisma.projectStructureAnalysis.findUnique({
                where: { snapshotId: job.snapshotId },
                select: { id: true, resultJson: true },
            }).catch(() => null);
        }
        const plannedId = currentProjectOperation()?.preparedPublications ? existingRow?.id || randomUUID() : undefined;

        let mergedResult = result;
        if (existingRow?.resultJson) {
            try {
                const prev = typeof existingRow.resultJson === "string"
                    ? JSON.parse(existingRow.resultJson)
                    : existingRow.resultJson;
                if (prev && typeof prev === "object") {
                    const preserved = {};
                    if (prev.integrationScan !== undefined) preserved.integrationScan = prev.integrationScan;
                    if (prev.peakIntegrationReport !== undefined) preserved.peakIntegrationReport = prev.peakIntegrationReport;
                    if (prev.deletedIntegrationScenarios !== undefined) preserved.deletedIntegrationScenarios = prev.deletedIntegrationScenarios;
                    if (Object.keys(preserved).length > 0) {
                        mergedResult = { ...preserved, ...result };
                    }
                }
            } catch (parseErr) {
                console.warn(`[Job ${jobId}] Could not parse prior structure analysis JSON for metadata preservation:`, parseErr.message);
            }
        }
        const serializedResult = JSON.stringify(mergedResult);

        const analysis = await stagePreparedValue(tx => tx.projectStructureAnalysis.upsert({
            where: { snapshotId: job.snapshotId },
            create: {
                ...(plannedId ? {id:plannedId} : {}),
                snapshotId: job.snapshotId,
                schemaVersion: result.schemaVersion,
                resultJson: serializedResult,
            },
            update: {
                schemaVersion: result.schemaVersion,
                resultJson: serializedResult,
            },
        }),{id:plannedId});

        if (isJobCanceled(jobId, abortController.signal)) return;

        // Archive endpoint inventory version for reliable historical diffing
        try {
            const { loadSourceCode } = await import("./aiContextBuilder.service.js");
            const { extractValidEndpoints } = await import("./apiEndpointParser.service.js");
            const { archiveVersionArtifact } = await import("./integrationVersionHistory.service.js");
            const sourceCode = await loadSourceCode(job.snapshotId).catch(() => []);
            const endpoints = extractValidEndpoints(sourceCode);
            archiveVersionArtifact(job.snapshot.rootDir, jobId, "ANALYSIS", {
                summary: result.summary,
                analyzedAt: result.analyzedAt,
                endpoints
            });
        } catch (archiveErr) {
            console.warn(`[Job ${jobId}] Could not archive version artifact:`, archiveErr.message);
        }

        await updateJobProgress(jobId, 95);
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'COMPLETE', label: "Analysis completed successfully.", progress: 100 }));
        await markJobSuccess(jobId, {
            analysisId: analysis.id,
            snapshotId: job.snapshotId,
            summary: result.summary,
            analyzedAt: result.analyzedAt,
        });
    } catch (error) {
        if (isJobCanceled(jobId, abortController.signal)) {
            return;
        }
        console.error(`[Job ${jobId}] Architecture analysis failed`, error);
        try {
            await markJobFailed(jobId, error);
        } catch (markError) {
            console.error(`[Job ${jobId}] Could not mark architecture analysis as failed`, markError);
        }
    } finally {
        unregisterJobAbortController(jobId);
    }
};
