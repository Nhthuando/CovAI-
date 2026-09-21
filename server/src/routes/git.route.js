import express from "express";
import {
  getStatus,
  stageFiles,
  unstageFiles,
  discardChanges,
  commitChanges,
  pushBranch,
  pullBranch,
  listBranches,
  checkoutBranch,
  getCommitLog,
  getFileDiff,
  initRepo,
  handleGitCommand,
  setRemoteUrl,
} from "../controllers/git.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/status", getStatus);
router.post("/stage", stageFiles);
router.post("/unstage", unstageFiles);
router.post("/discard", discardChanges);
router.post("/commit", commitChanges);
router.post("/push", pushBranch);
router.post("/pull", pullBranch);
router.get("/branches", listBranches);
router.post("/checkout", checkoutBranch);
router.get("/log", getCommitLog);
router.get("/diff", getFileDiff);
router.post("/init", initRepo);
router.post("/command", handleGitCommand);
router.post("/remote", setRemoteUrl);

export default router;
