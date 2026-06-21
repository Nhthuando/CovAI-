import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Service to store generated CFG data.
 *
 * Responsibilities:
 * 1. Validate snapshot existence.
 * 2. Validate required fields.
 * 3. Serialize graphJson.
 * 4. Create CFG record.
 */
export const storeCfg = async ({
  snapshotId,
  filePath,
  functionName,
  startLine,
  endLine,
  graphJson,
}) => {
  // 1. Validate required fields
  if (!snapshotId || !filePath || !functionName || !graphJson) {
    throw new ServiceError(
      "snapshotId, filePath, functionName, and graphJson are required",
      400,
    );
  }

  // 2. Validate snapshot existence
  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
  });

  if (!snapshot) {
    throw new ServiceError(`Snapshot with id ${snapshotId} not found`, 404);
  }

  // 3. Validate graphJson (ensure it is a valid JSON string)
  let serializedGraph;
  try {
    serializedGraph =
      typeof graphJson === "string"
        ? JSON.stringify(JSON.parse(graphJson))
        : JSON.stringify(graphJson);
  } catch (error) {
    throw new ServiceError(
      "Invalid graph structure: graphJson must be a valid JSON object or string",
      400,
    );
  }

  // 4. Create CFG record
  try {
    const cfg = await prisma.cfg.create({
      data: {
        snapshotId,
        filePath,
        functionName,
        startLine: startLine || null,
        endLine: endLine || null,
        graphJson: serializedGraph,
      },
    });

    return cfg;
  } catch (error) {
    console.error("[CfgStorageService] Database error:", error);
    throw new ServiceError("Failed to store CFG data", 500);
  }
};
