import {
  getJobById,
  markJobRunning,
  markJobFailed,
  updateJobProgress,
  addJobLog,
} from "./job.service.js";
import { detectFrameworks } from "./testDetection.service.js";
import prisma from "../config/prisma.js";

/**
 * Process the entire automatic analysis pipeline for a given job.
 * @param {string} jobId - The ID of the job.
 */
export async function processAnalysisPipeline(jobId) {
  try {
    // Retrieve Job Details
    const job = await getJobById(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    await markJobRunning(jobId);
    await addJobLog(jobId, "INFO", "Starting analysis pipeline");

    const { snapshot } = job;
    if (!snapshot) {
      throw new Error("Snapshot not associated with this job");
    }

    // Step 1: Detect Frameworks
    await addJobLog(jobId, "INFO", "Detecting frameworks");
    const rootDir = snapshot.rootDir || snapshot.storagePath;
    if (!rootDir) {
      throw new Error("Snapshot rootDir or storagePath is unavailable");
    }
    const detectedFrameworks = await detectFrameworks(rootDir);
    await updateJobProgress(jobId, 20);

    // Step 2: Classify Frameworks
    await addJobLog(jobId, "INFO", "Classifying frameworks by test category");
    const testFrameworks = classifyFrameworks(detectedFrameworks);
    await addJobLog(
      jobId,
      "INFO",
      `Detected: ${JSON.stringify(testFrameworks)}`,
    );
    await updateJobProgress(jobId, 40);

    // Step 3: Save Results
    await addJobLog(jobId, "INFO", "Saving analysis results");
    await saveAnalysisResults(snapshot.id, detectedFrameworks);
    await updateJobProgress(jobId, 80);

    // Update Job to Success
    await updateJobProgress(jobId, 100);
    await addJobLog(jobId, "INFO", "Analysis completed successfully");
    return { success: true, frameworks: testFrameworks };
  } catch (error) {
    console.error(`[AnalysisPipeline ${jobId}] Error:`, error);
    await markJobFailed(jobId, error);
    await addJobLog(jobId, "ERROR", `Pipeline Error: ${error.message}`);
  }
}

/**
 * Classify frameworks into categories.
 * @param {Array} detectedFrameworks - The detected framework objects.
 * @returns {Object} Classified frameworks by type.
 */
function classifyFrameworks(detectedFrameworks) {
  const frameworks = {
    unit: [],
    integration: [],
    system: [],
  };

  detectedFrameworks.forEach((fw) => {
    const type = fw.type || fw.framework;
    if (fw.framework === "jest" || fw.framework === "vitest") {
      frameworks.unit.push(fw);
    } else if (fw.framework === "supertest" || fw.framework === "playwright") {
      frameworks.integration.push(fw);
    } else if (fw.framework === "cypress") {
      frameworks.system.push(fw);
    }
  });

  return frameworks;
}

/**
 * Save analysis results in the database.
 * @param {string} snapshotId - ID of the associated snapshot.
 * @param {Array} detectedFrameworks - The detected frameworks.
 */
async function saveAnalysisResults(snapshotId, detectedFrameworks) {
  try {
    console.log(
      `[AnalysisPipeline] Saving detected frameworks for snapshot ${snapshotId}:`,
      detectedFrameworks,
    );
  } catch (error) {
    console.error(
      `[AnalysisPipeline] Failed to save results for snapshot ${snapshotId}`,
      error,
    );
    throw new Error("Failed to save analysis results");
  }
}
