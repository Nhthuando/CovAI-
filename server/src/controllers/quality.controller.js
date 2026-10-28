import { startQualityAnalysis, getQualityReport } from "../services/qualityAnalysis.service.js";
import { addJobToQueue } from "../services/queue.service.js";
import { analysisJobResponse } from "../services/analysisResponse.service.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * POST /projects/:id/quality-analysis
 * Starts a quality analysis job for the project.
 */
export const runQualityAnalysis = async (req, res) => {
    try {
        const queuedJob = await startQualityAnalysis({
            projectId: req.params.id,
            snapshotId: req.body?.snapshotId,
            userId: req.user.id,
        });

        const reused = queuedJob.reused === true;
        const { reused: _reused, ...job } = queuedJob;
        const safeJob = analysisJobResponse(job);

        if (!reused) {
            addJobToQueue("QUALITY_ANALYSIS", job.id).catch((queueError) => {
                console.error("Could not queue quality analysis", queueError);
            });
        }

        return res.status(reused ? 200 : 201).json({
            success: true,
            reused,
            snapshotId: job.snapshotId,
            job: safeJob,
            data: { job: safeJob },
        });
    } catch (error) {
        if (error instanceof ServiceError) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        console.error("Quality analysis error:", error);
        return res.status(500).json({ success: false, message: "Failed to start quality analysis" });
    }
};

/**
 * GET /projects/:id/quality-report
 * Returns the latest quality report for the project.
 */
export const fetchQualityReport = async (req, res) => {
    try {
        const report = await getQualityReport({
            projectId: req.params.id,
            userId: req.user.id,
        });

        return res.json({
            success: true,
            data: report,
        });
    } catch (error) {
        if (error instanceof ServiceError) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        console.error("Fetch quality report error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch quality report" });
    }
};
