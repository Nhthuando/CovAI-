import express from "express";
import { processAnalysisPipeline } from "../services/analysisPipeline.service.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getProjectById } from "../services/project.service.js";

const router = express.Router();

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
    const jobId = await processAnalysisPipeline(projectId);
    return res.status(202).json({
      success: true,
      message: "Analysis job queued successfully.",
      jobId,
    });
  } catch (error) {
    console.error("[Pipeline Route] Error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while starting the analysis.",
    });
  }
});

export default router;
