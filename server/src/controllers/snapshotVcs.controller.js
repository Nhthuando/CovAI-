import { SnapshotVcsService } from "../services/snapshotVcs.service.js";
import { ServiceError } from "../utils/serviceError.js";
import {
  snapshotAiSummarySchema,
  snapshotCaptureSchema,
  snapshotCheckoutBranchSchema,
  snapshotCompareQuerySchema,
  snapshotCreateBranchSchema,
  snapshotCreateTagSchema,
  snapshotDiffPairQuerySchema,
  snapshotDiscardSchema,
  snapshotFileQuerySchema,
  snapshotGcSchema,
  snapshotListQuerySchema,
  snapshotMergeBranchSchema,
  snapshotRestoreFileSchema,
  snapshotRestoreSchema,
  snapshotStageSchema,
  snapshotStatusQuerySchema,
  snapshotUpdateBranchSchema,
  snapshotUpdateSchema,
} from "../validators/snapshotVcs.validation.js";

function parseInput(schema, rawInput) {
  const parsed = schema.safeParse(rawInput || {});
  if (!parsed.success) {
    const firstIssue = parsed.error.issues?.[0];
    throw new ServiceError(
      firstIssue?.message || "Invalid Snapshot VCS request",
      400,
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  return parsed.data;
}

function handleError(res, error, defaultMsg = "Snapshot VCS operation failed") {
  console.error(`[SnapshotVcsController] ${defaultMsg}:`, error?.message || error);
  if (error instanceof ServiceError) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.message,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }
  return res.status(500).json({
    success: false,
    error: error?.message || defaultMsg,
    message: error?.message || defaultMsg,
  });
}

export const getStatus = async (req, res) => {
  try {
    const { includeUnchanged } = parseInput(snapshotStatusQuerySchema, req.query);
    const data = await SnapshotVcsService.getStatus(
      req.params.projectId,
      req.user.id,
      { includeUnchanged: includeUnchanged === "true" },
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to get snapshot VCS status");
  }
};

export const stageFiles = async (req, res) => {
  try {
    const input = parseInput(snapshotStageSchema, req.body);
    const data = await SnapshotVcsService.stageFiles(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to stage files");
  }
};

export const unstageFiles = async (req, res) => {
  try {
    const input = parseInput(snapshotStageSchema, req.body);
    const data = await SnapshotVcsService.unstageFiles(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to unstage files");
  }
};

export const discardChanges = async (req, res) => {
  try {
    const input = parseInput(snapshotDiscardSchema, req.body);
    const data = await SnapshotVcsService.discardChanges(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to discard workspace changes");
  }
};

export const getDiffPair = async (req, res) => {
  try {
    const input = parseInput(snapshotDiffPairQuerySchema, req.query);
    const data = await SnapshotVcsService.getDiffPair(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to compute checkpoint diff");
  }
};

export const compareCheckpoints = async (req, res) => {
  try {
    const input = parseInput(snapshotCompareQuerySchema, req.query);
    const data = await SnapshotVcsService.compareCheckpoints(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to compare checkpoints");
  }
};

export const listCheckpoints = async (req, res) => {
  try {
    const input = parseInput(snapshotListQuerySchema, req.query);
    const data = await SnapshotVcsService.listCheckpoints(
      req.params.projectId,
      req.user.id,
      {
        ...input,
        pinnedOnly: input.pinnedOnly === "true",
      },
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list checkpoints");
  }
};

export const captureCheckpoint = async (req, res) => {
  try {
    const input = parseInput(snapshotCaptureSchema, req.body);
    const data = await SnapshotVcsService.captureCheckpoint(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to capture checkpoint");
  }
};

export const updateCheckpoint = async (req, res) => {
  try {
    const input = parseInput(snapshotUpdateSchema, req.body);
    const data = await SnapshotVcsService.updateCheckpoint(
      req.params.projectId,
      req.user.id,
      req.params.snapshotId,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to update checkpoint");
  }
};

export const deleteCheckpoint = async (req, res) => {
  try {
    const data = await SnapshotVcsService.deleteCheckpoint(
      req.params.projectId,
      req.user.id,
      req.params.snapshotId,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to delete checkpoint");
  }
};

export const getCheckpointTree = async (req, res) => {
  try {
    const data = await SnapshotVcsService.getCheckpointTree(
      req.params.projectId,
      req.user.id,
      req.params.snapshotId,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to read checkpoint file tree");
  }
};

export const getCheckpointFile = async (req, res) => {
  try {
    const { path } = parseInput(snapshotFileQuerySchema, req.query);
    const data = await SnapshotVcsService.getCheckpointFile(
      req.params.projectId,
      req.user.id,
      req.params.snapshotId,
      path,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to read historical file");
  }
};

export const restoreSingleFile = async (req, res) => {
  try {
    const input = parseInput(snapshotRestoreFileSchema, req.body);
    const data = await SnapshotVcsService.restoreSingleFile(
      req.params.projectId,
      req.user.id,
      req.params.snapshotId,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to restore single file");
  }
};

export const restoreCheckpoint = async (req, res) => {
  try {
    const input = parseInput(snapshotRestoreSchema, req.body);
    const data = await SnapshotVcsService.restoreCheckpoint(
      req.params.projectId,
      req.user.id,
      req.params.snapshotId,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to rollback workspace to checkpoint");
  }
};

export const exportCheckpointZip = async (req, res) => {
  try {
    const { buffer, filename } = await SnapshotVcsService.exportCheckpointZip(
      req.params.projectId,
      req.user.id,
      req.params.snapshotId,
    );
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  } catch (error) {
    return handleError(res, error, "Failed to export checkpoint ZIP");
  }
};

export const listBranches = async (req, res) => {
  try {
    const data = await SnapshotVcsService.listBranches(
      req.params.projectId,
      req.user.id,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list snapshot branches");
  }
};

export const createBranch = async (req, res) => {
  try {
    const input = parseInput(snapshotCreateBranchSchema, req.body);
    const data = await SnapshotVcsService.createBranch(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to create snapshot branch");
  }
};

export const checkoutBranch = async (req, res) => {
  try {
    const input = parseInput(snapshotCheckoutBranchSchema, req.body);
    const data = await SnapshotVcsService.checkoutBranch(
      req.params.projectId,
      req.user.id,
      req.params.branchId,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to checkout snapshot branch");
  }
};

export const updateBranch = async (req, res) => {
  try {
    const input = parseInput(snapshotUpdateBranchSchema, req.body);
    const data = await SnapshotVcsService.updateBranch(
      req.params.projectId,
      req.user.id,
      req.params.branchId,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to update snapshot branch");
  }
};

export const deleteBranch = async (req, res) => {
  try {
    const data = await SnapshotVcsService.deleteBranch(
      req.params.projectId,
      req.user.id,
      req.params.branchId,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to delete snapshot branch");
  }
};

export const mergeBranch = async (req, res) => {
  try {
    const input = parseInput(snapshotMergeBranchSchema, req.body);
    const data = await SnapshotVcsService.mergeBranch(
      req.params.projectId,
      req.user.id,
      {
        ...input,
        dirtyPolicy: input.dirtyPolicy || input.dirtyStrategy,
      },
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to merge snapshot branches");
  }
};

export const listTags = async (req, res) => {
  try {
    const data = await SnapshotVcsService.listTags(
      req.params.projectId,
      req.user.id,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list snapshot tags");
  }
};

export const createTag = async (req, res) => {
  try {
    const input = parseInput(snapshotCreateTagSchema, req.body);
    const data = await SnapshotVcsService.createTag(
      req.params.projectId,
      req.user.id,
      req.params.snapshotId,
      input,
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to create checkpoint tag");
  }
};

export const deleteTag = async (req, res) => {
  try {
    const data = await SnapshotVcsService.deleteTag(
      req.params.projectId,
      req.user.id,
      req.params.tagId,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to delete tag");
  }
};

export const generateAiSummary = async (req, res) => {
  try {
    const input = parseInput(snapshotAiSummarySchema, req.body);
    const data = await SnapshotVcsService.generateAiSummary(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to generate AI checkpoint summary");
  }
};

export const runGarbageCollection = async (req, res) => {
  try {
    const input = parseInput(snapshotGcSchema, req.body);
    const data = await SnapshotVcsService.runGarbageCollection(
      req.params.projectId,
      req.user.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to run CAS garbage collection");
  }
};
