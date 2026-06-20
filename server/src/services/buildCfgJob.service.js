import fs from "fs/promises";
import path from "path";
import * as parser from "@babel/parser";
import { buildCFG } from "./cfgBuilder.service.js";
import { saveCFG } from "./cfgStorage.service.js";
import {
  markJobRunning,
  updateJobProgress,
  markJobSuccess,
  markJobFailed,
  getJobById,
  addJobLog,
} from "./job.service.js";
import { ServiceError } from "../utils/serviceError.js";

const getAllFiles = async (dir) => {
  let files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files = files.concat(await getAllFiles(fullPath));
    } else if (
      item.name.endsWith(".js") ||
      item.name.endsWith(".jsx") ||
      item.name.endsWith(".ts") ||
      item.name.endsWith(".tsx")
    ) {
      files.push(fullPath);
    }
  }
  return files;
};

const calculateCyclomaticComplexity = (nodes) => {
  // Basic Cyclomatic Complexity = Number of decision nodes + 1
  const decisionNodes = nodes.filter((n) => n.type === "condition").length;
  return decisionNodes + 1;
};

export const processBuildCfgJob = async (jobId) => {
  try {
    await markJobRunning(jobId);
    const job = await getJobById(jobId);

    await updateJobProgress(jobId, 10);
    await addJobLog(jobId, "INFO", "Snapshot Loaded");

    const sourceDir = job.snapshot.storagePath; // Assuming this is the path to the extracted files
    const files = await getAllFiles(sourceDir);

    if (files.length === 0) {
      throw new ServiceError("No source files found", 404);
    }

    await updateJobProgress(jobId, 30);
    await addJobLog(jobId, "INFO", "Files Parsed");

    let totalComplexity = 0;
    let processedCount = 0;

    for (const file of files) {
      const code = await fs.readFile(file, "utf-8");
      const ast = parser.parse(code, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      });

      const cfg = buildCFG(ast);
      await saveCFG(job.snapshotId, file, cfg.graphJson);

      totalComplexity += calculateCyclomaticComplexity(cfg.graphJson.nodes);
      processedCount++;

      if (processedCount % 10 === 0) {
        await updateJobProgress(
          jobId,
          30 + Math.min(30, (processedCount / files.length) * 30),
        );
      }
    }

    await updateJobProgress(jobId, 60);
    await addJobLog(jobId, "INFO", "CFG Generated");

    await updateJobProgress(jobId, 90);
    await addJobLog(jobId, "INFO", "Complexity Calculated: " + totalComplexity);

    await markJobSuccess(jobId, {
      totalFiles: files.length,
      totalComplexity,
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error);
    await markJobFailed(jobId, error);
  }
};
