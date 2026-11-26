import express from "express";
import { AUTH_PROVIDERS } from "../../../shared/versionControlMode.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { requireAuthProvider } from "../middlewares/requireAuthProvider.middleware.js";
import { enforceProjectEndpointPolicy } from "../middlewares/projectEndpointPolicy.js";
import { aiLimiter, gitRemoteLimiter } from "../middlewares/rateLimit.middleware.js";
import {
  addGitignorePattern,
  applyStash,
  checkoutBranch,
  cherryPickCommit,
  commitChanges,
  createPullRequest,
  createStash,
  createTag,
  deleteBranch,
  deleteTag,
  discardChanges,
  dropStash,
  fetchRemote,
  generateAiCommitMessage,
  getCommitChecks,
  getCommitDetail,
  getCommitLog,
  getConflicts,
  getFileAtRef,
  getFileDiff,
  getFileDiffPair,
  getStashDiff,
  getStatus,
  handleGitCommand,
  initRepo,
  listBranches,
  listPullRequests,
  listStashes,
  listTags,
  mergeAbort,
  mergeBranch,
  mergeContinue,
  popStash,
  publishGithubRepo,
  pullBranch,
  pushBranch,
  pushTag,
  rebaseAbort,
  rebaseBranch,
  rebaseContinue,
  abortGitOperation,
  continueGitOperation,
  renameBranch,
  resetRepo,
  resolveConflict,
  revertCommit,
  revertHunk,
  setRemoteUrl,
  stageFiles,
  stageHunk,
  syncRemote,
  undoCommit,
  unstageFiles,
  unstageHunk,
} from "../controllers/git.controller.js";

const router = express.Router();

// Strictly enforce GitHub authentication provider + RBAC project policy on all Git endpoints.
router.use(
  authMiddleware,
  requireAuthProvider(AUTH_PROVIDERS.GITHUB),
  enforceProjectEndpointPolicy("git"),
);

// Status & Repository Initialization
router.get("/status", getStatus);
router.post("/init", initRepo);
router.post("/publish-github", gitRemoteLimiter, publishGithubRepo);
router.post("/remote", setRemoteUrl);

// Staging, Hunk Patches & Working Tree Actions
router.post("/stage", stageFiles);
router.post("/unstage", unstageFiles);
router.post("/stage-hunk", stageHunk);
router.post("/unstage-hunk", unstageHunk);
router.post("/revert-hunk", revertHunk);
router.post("/discard", discardChanges);
router.post("/gitignore", addGitignorePattern);

// Diffs & Blobs
router.get("/diff", getFileDiff);
router.get("/diff-pair", getFileDiffPair);
router.get("/file-at-ref", getFileAtRef);

// Commits & AI Commit Drafting
router.post("/commit", commitChanges);
router.post("/undo-commit", undoCommit);
router.post("/ai-commit-message", aiLimiter, generateAiCommitMessage);

// History, Inspect, Revert, Cherry-pick & Reset
router.get("/log", getCommitLog);
router.get("/commits/:hash", getCommitDetail);
router.post("/commits/:hash/revert", revertCommit);
router.post("/commits/:hash/cherry-pick", cherryPickCommit);
router.post("/reset", resetRepo);

// Branches
router.get("/branches", listBranches);
router.post("/checkout", checkoutBranch);
router.post("/branches/rename", renameBranch);
router.delete("/branches/:name", deleteBranch);

// Merge, Rebase & 3-Way Conflicts
router.post("/merge", mergeBranch);
router.post("/merge/abort", mergeAbort);
router.post("/merge/continue", mergeContinue);
router.post("/rebase", rebaseBranch);
router.post("/rebase/abort", rebaseAbort);
router.post("/rebase/continue", rebaseContinue);
router.post("/operation/abort", abortGitOperation);
router.post("/operation/continue", continueGitOperation);
router.get("/conflicts", getConflicts);
router.post("/conflicts/resolve", resolveConflict);

// Remote Network Operations
router.post("/fetch", gitRemoteLimiter, fetchRemote);
router.post("/pull", gitRemoteLimiter, pullBranch);
router.post("/push", gitRemoteLimiter, pushBranch);
router.post("/sync", gitRemoteLimiter, syncRemote);

// Stash
router.get("/stashes", listStashes);
router.post("/stashes", createStash);
router.get("/stashes/:index", getStashDiff);
router.post("/stashes/:index/apply", applyStash);
router.post("/stashes/:index/pop", popStash);
router.delete("/stashes/:index", dropStash);

// Tags
router.get("/tags", listTags);
router.post("/tags", createTag);
router.post("/tags/:name/push", gitRemoteLimiter, pushTag);
router.delete("/tags/:name", deleteTag);

// GitHub Platform Integration (PRs & CI Checks)
router.get("/github/pulls", gitRemoteLimiter, listPullRequests);
router.post("/github/pulls", gitRemoteLimiter, createPullRequest);
router.get("/github/checks", gitRemoteLimiter, getCommitChecks);

// Restricted Read-only Diagnostic Command Runner
router.post("/command", handleGitCommand);

export default router;
