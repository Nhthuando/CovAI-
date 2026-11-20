import prisma from "../config/prisma.js";
import { detectFrameworks } from "./testDetection.service.js";
import { detectSupertest } from "./supertestDetection.service.js";
import { runPlaywrightTests } from "./playwrightRunner.service.js";
import { runSupertestTests } from "./supertestRunner.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";

/**
 * Orchestrator cho Integration Test Pipeline
 * Resolves the snapshot workspace and invokes detected runners with valid arguments.
 */
export const runIntegrationTestPipeline = async ({
  projectId,
  snapshotId,
}) => {
  const snapshot = await prisma.projectSnapshot.findFirst({
    where: {
      ...(snapshotId ? { id: snapshotId } : {}),
      projectId,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, rootDir: true, jestConfigPath: true },
  });

  if (!snapshot?.rootDir) {
    throw new ServiceError("Snapshot workspace is not ready for integration testing.", 404);
  }

  const rootDir = resolveProjectRoot(snapshot.rootDir) || snapshot.rootDir;
  const frameworks = await detectFrameworks(projectId);

  if (!frameworks || frameworks.length === 0) {
    throw new ServiceError(
      "No supported Integration Test framework found.",
      404,
    );
  }

  const results = [];

  for (const item of frameworks) {
    const fw = item.framework;
    try {
      let result = null;
      if (fw === "playwright") {
        result = await runPlaywrightTests(null, rootDir);
      } else if (fw === "supertest") {
        const supertestInfo = await detectSupertest(rootDir);
        const testFiles = supertestInfo?.supertestFiles?.length
          ? supertestInfo.supertestFiles
          : (supertestInfo?.testFiles || []);
        result = await runSupertestTests(
          null,
          rootDir,
          snapshot.jestConfigPath ?? supertestInfo?.configPath ?? null,
          testFiles,
        );
      }

      if (result) {
        results.push({ framework: fw, status: "SUCCESS", data: result });
      }
    } catch (err) {
      console.error(`Error running ${fw} runner:`, err);
      results.push({ framework: fw, status: "FAILED", error: err.message });
    }
  }

  return {
    success: true,
    results,
  };
};
