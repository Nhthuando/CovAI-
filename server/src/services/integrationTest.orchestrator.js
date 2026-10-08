import { detectFrameworks } from "./testDetection.service.js";
import { runPlaywrightTests } from "./playwrightRunner.service.js";
import { runSupertestTests } from "./supertestRunner.service.js";
import { ServiceError } from "./project.service.js";

/**
 * Orchestrator cho Integration Test Pipeline
 * Orchestrate framework detection and execute corresponding runner
 */
export const runIntegrationTestPipeline = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  // 1. Detect active frameworks
  const frameworks = await detectFrameworks(projectId);

  if (!frameworks || frameworks.length === 0) {
    throw new ServiceError(
      "No supported Integration Test framework found.",
      404,
    );
  }

  const results = [];

  // 2. Run detected runners sequentially
  for (const item of frameworks) {
    const fw = item.framework;
    try {
      let result = null;
      if (fw === "playwright") {
        result = await runPlaywrightTests({ projectId, snapshotId, userId });
      } else if (fw === "supertest") {
        result = await runSupertestTests({ projectId, snapshotId, userId });
      }

      if (result) {
        results.push({ framework: fw, status: "SUCCESS", data: result });
      }
    } catch (err) {
      console.error(`Error running ${fw} runner:`, err);
      results.push({ framework: fw, status: "FAILED", error: err.message });
    }
  }

  // 3. Aggregate results (Can expand with DB persistence logic here)
  return {
    success: true,
    results,
  };
};
