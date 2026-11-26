import express from "express";
import { AUTH_PROVIDERS } from "../../../shared/versionControlMode.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { requireAuthProvider } from "../middlewares/requireAuthProvider.middleware.js";
import { enforceProjectEndpointPolicy } from "../middlewares/projectEndpointPolicy.js";
import { aiLimiter } from "../middlewares/rateLimit.middleware.js";
import {
  captureCheckpoint,
  checkoutBranch,
  compareCheckpoints,
  createBranch,
  createTag,
  deleteBranch,
  deleteCheckpoint,
  deleteTag,
  discardChanges,
  exportCheckpointZip,
  generateAiSummary,
  getCheckpointFile,
  getCheckpointTree,
  getDiffPair,
  getStatus,
  listBranches,
  listCheckpoints,
  listTags,
  mergeBranch,
  restoreCheckpoint,
  restoreSingleFile,
  runGarbageCollection,
  stageFiles,
  unstageFiles,
  updateBranch,
  updateCheckpoint,
} from "../controllers/snapshotVcs.controller.js";

const router = express.Router({ mergeParams: true });

// Strictly enforce Email session provider + RBAC project policy on all Snapshot VCS endpoints.
router.use(
  authMiddleware,
  requireAuthProvider(AUTH_PROVIDERS.EMAIL),
  enforceProjectEndpointPolicy("snapshot-vcs"),
);

// Working Tree Status, Staging & Diff
router.get("/status", getStatus);
router.post("/stage", stageFiles);
router.post("/unstage", unstageFiles);
router.post("/discard", discardChanges);
router.get("/diff-pair", getDiffPair);
router.get("/compare", compareCheckpoints);

// Checkpoints (Commits)
router.get("/checkpoints", listCheckpoints);
router.post("/checkpoints", captureCheckpoint);
router.patch("/checkpoints/:snapshotId", updateCheckpoint);
router.delete("/checkpoints/:snapshotId", deleteCheckpoint);
router.post("/ai-summary", aiLimiter, generateAiSummary);

// Time-Travel, Single File Restore, Full Rollback & ZIP Export
router.get("/checkpoints/:snapshotId/tree", getCheckpointTree);
router.get("/checkpoints/:snapshotId/file", getCheckpointFile);
router.post("/checkpoints/:snapshotId/restore-file", restoreSingleFile);
router.post("/checkpoints/:snapshotId/restore", restoreCheckpoint);
router.get("/checkpoints/:snapshotId/export-zip", exportCheckpointZip);

// Local Branches & 3-Way Merge
router.get("/branches", listBranches);
router.post("/branches", createBranch);
router.post("/branches/:branchId/checkout", checkoutBranch);
router.patch("/branches/:branchId", updateBranch);
router.delete("/branches/:branchId", deleteBranch);
router.post("/branches/merge", mergeBranch);
router.post("/branches/merge/resolve", mergeBranch);

// Tags & CAS Garbage Collection
router.get("/tags", listTags);
router.post("/checkpoints/:snapshotId/tags", createTag);
router.delete("/tags/:tagId", deleteTag);
router.post("/gc", runGarbageCollection);

export default router;
