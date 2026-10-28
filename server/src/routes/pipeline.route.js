import { enforceProjectEndpointPolicy } from '../middlewares/projectEndpointPolicy.js';
import express from "express";
import { createAnalysisJob } from "../services/job.service.js";
import { addJobToQueue } from "../services/queue.service.js";
import { resolveSnapshotAccess } from "../services/projectAccess.service.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getProjectById } from "../services/project.service.js";

const router = express.Router();
router.use(authMiddleware, enforceProjectEndpointPolicy('pipeline'));

/**
 * POST /pipeline/:projectId/run-analysis
 * Kicks off an analysis pipeline asynchronously for the given project.
 */
router.post("/:projectId/run-analysis", authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Confirm project ownership
    const project = await getProjectById(projectId, req.user.id);
    if (!project) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized or project not found.",
      });
    }

    // Create and start pipeline (non-blocking)
    const { testType, snapshotId } = req.body;
    const { snapshot } = await resolveSnapshotAccess({ projectId, snapshotId, userId: req.user.id, capability: "tests.run" });
    const job = await createAnalysisJob({ projectId, snapshotId: snapshot.id, userId: req.user.id });
    if (!job.reused && !job.existing) await addJobToQueue("ANALYSIS", job.id);
    const jobId = job.id;
    return res.status(202).json({
      success: true,
      message: `Analysis job for ${testType || "all"} queued successfully.`,
      jobId,
    });
  } catch (error) {
    console.error("[Pipeline Route] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: "An error occurred while starting the analysis.",
    });
  }
});

export default router;
