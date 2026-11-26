import { GitService } from "../services/git.service.js";
import { dispatchGitConsoleCommand } from "../services/gitCommandDispatcher.service.js";
import { redactGitOutput } from "../services/gitCredentialHelper.service.js";
import { ServiceError } from "../utils/serviceError.js";
import {
  gitAiCommitSchema,
  gitCheckoutSchema,
  gitCommandSchema,
  gitCommitActionSchema,
  gitCommitSchema,
  gitCreatePrSchema,
  gitCreateTagSchema,
  gitDeleteBranchSchema,
  gitDeleteTagSchema,
  gitDiffPairQuerySchema,
  gitDiscardSchema,
  gitFileAtRefQuerySchema,
  gitHunkActionSchema,
  gitIgnoreSchema,
  gitInitSchema,
  gitLogQuerySchema,
  gitMergeSchema,
  gitProjectOnlySchema,
  gitPublishGithubSchema,
  gitRebaseSchema,
  gitRemoteSchema,
  gitRemoteSyncSchema,
  gitRenameBranchSchema,
  gitResetSchema,
  gitResolveConflictSchema,
  gitStageSchema,
  gitStashPushSchema,
  gitStatusQuerySchema,
  gitUndoCommitSchema,
} from "../validators/git.validation.js";

function parseInput(schema, rawInput) {
  const parsed = schema.safeParse(rawInput || {});
  if (!parsed.success) {
    const firstIssue = parsed.error.issues?.[0];
    throw new ServiceError(
      firstIssue?.message || "Invalid request payload",
      400,
      "VALIDATION_ERROR",
      parsed.error.flatten().fieldErrors,
    );
  }
  return parsed.data;
}

function handleError(res, error, defaultMsg = "Git operation failed") {
  const safeMsg = redactGitOutput(error?.message || defaultMsg);
  console.error(`[GitController] ${defaultMsg}:`, safeMsg);
  if (error instanceof ServiceError) {
    return res.status(error.statusCode).json({
      success: false,
      error: safeMsg,
      message: safeMsg,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }
  return res.status(500).json({
    success: false,
    error: safeMsg,
    message: safeMsg,
  });
}

export const getStatus = async (req, res) => {
  try {
    const { projectId, includeTracked } = parseInput(
      gitStatusQuerySchema,
      req.query,
    );
    const status = await GitService.getStatus(projectId, req.user?.id, {
      includeTracked: includeTracked === "true",
    });
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    if (error instanceof ServiceError && error.statusCode === 404) {
      return res.status(200).json({
        success: true,
        data: {
          isGitHubProject: false,
          hasGit: false,
          isReady: false,
          branch: null,
          tracking: null,
          ahead: 0,
          behind: 0,
          staged: [],
          unstaged: [],
          untracked: [],
          conflicts: [],
          unchangedCount: 0,
          clean: true,
          repoUrl: null,
          message: error.message || "Project not found or not ready.",
        },
      });
    }
    return handleError(res, error, "Failed to get git status");
  }
};

export const initRepo = async (req, res) => {
  try {
    const {
      projectId,
      defaultBranch,
      createInitialCommit,
      createGitignore,
    } = parseInput(gitInitSchema, req.body);
    const data = await GitService.initRepo(projectId, req.user?.id, {
      defaultBranch,
      createInitialCommit,
      createGitignore,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to initialize git repository");
  }
};

export const publishGithubRepo = async (req, res) => {
  try {
    const input = parseInput(gitPublishGithubSchema, req.body);
    if (input.async) {
      const { enqueueGitRemoteJob } = await import("../services/gitJob.service.js");
      const queued = await enqueueGitRemoteJob({
        type: "GIT_PUBLISH_REPO",
        projectId: input.projectId,
        userId: req.user?.id,
        payload: input,
      });
      return res.status(202).json({ success: true, data: queued });
    }
    const data = await GitService.publishToGitHub(
      input.projectId,
      req.user?.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to publish repository to GitHub");
  }
};

export const setRemoteUrl = async (req, res) => {
  try {
    const { projectId, repoUrl } = parseInput(gitRemoteSchema, req.body);
    const status = await GitService.setRemoteUrl(
      projectId,
      req.user?.id,
      repoUrl,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to set remote URL");
  }
};

export const stageFiles = async (req, res) => {
  try {
    const { projectId, files, folder } = parseInput(gitStageSchema, req.body);
    const status = await GitService.stageFiles(
      projectId,
      req.user?.id,
      files,
      folder,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to stage files");
  }
};

export const unstageFiles = async (req, res) => {
  try {
    const { projectId, files, folder } = parseInput(gitStageSchema, req.body);
    const status = await GitService.unstageFiles(
      projectId,
      req.user?.id,
      files,
      folder,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to unstage files");
  }
};

export const stageHunk = async (req, res) => {
  try {
    const { projectId, filePath, hunkIndex } = parseInput(
      gitHunkActionSchema,
      req.body,
    );
    const status = await GitService.stageHunk(
      projectId,
      req.user?.id,
      filePath,
      hunkIndex,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to stage hunk");
  }
};

export const unstageHunk = async (req, res) => {
  try {
    const { projectId, filePath, hunkIndex } = parseInput(
      gitHunkActionSchema,
      req.body,
    );
    const status = await GitService.unstageHunk(
      projectId,
      req.user?.id,
      filePath,
      hunkIndex,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to unstage hunk");
  }
};

export const revertHunk = async (req, res) => {
  try {
    const { projectId, filePath, hunkIndex } = parseInput(
      gitHunkActionSchema,
      req.body,
    );
    const status = await GitService.revertHunk(
      projectId,
      req.user?.id,
      filePath,
      hunkIndex,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to revert hunk");
  }
};

export const discardChanges = async (req, res) => {
  try {
    const input = parseInput(gitDiscardSchema, req.body);
    if (!input.filePath && !input.files) {
      throw new ServiceError("filePath or files is required", 400);
    }
    const arg = input.files
      ? { files: input.files, includeUntracked: Boolean(input.includeUntracked) }
      : input.filePath;
    const status = await GitService.discardChanges(
      input.projectId,
      req.user?.id,
      arg,
      input.files ? undefined : Boolean(input.isUntracked),
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to discard changes");
  }
};

export const addGitignorePattern = async (req, res) => {
  try {
    const { projectId, pattern } = parseInput(gitIgnoreSchema, req.body);
    const status = await GitService.addGitignorePattern(
      projectId,
      req.user?.id,
      pattern,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to update .gitignore");
  }
};

export const commitChanges = async (req, res) => {
  try {
    const input = parseInput(gitCommitSchema, req.body);
    const result = await GitService.commit(input.projectId, req.user?.id, input);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, "Failed to commit changes");
  }
};

export const undoCommit = async (req, res) => {
  try {
    const { projectId, allowPushed } = parseInput(gitUndoCommitSchema, req.body);
    const status = await GitService.undoCommit(projectId, req.user?.id, {
      allowPushed,
    });
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to undo commit");
  }
};

export const generateAiCommitMessage = async (req, res) => {
  try {
    const { projectId, model } = parseInput(gitAiCommitSchema, req.body);
    const data = await GitService.generateAiCommitMessage(
      projectId,
      req.user?.id,
      { model },
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to generate commit message");
  }
};

export const fetchRemote = async (req, res) => {
  try {
    const input = parseInput(gitRemoteSyncSchema, req.body);
    if (input.async) {
      const { enqueueGitRemoteJob } = await import("../services/gitJob.service.js");
      const queued = await enqueueGitRemoteJob({
        type: "GIT_FETCH",
        projectId: input.projectId,
        userId: req.user?.id,
        payload: input,
      });
      return res.status(202).json({ success: true, data: queued });
    }
    const data = await GitService.fetch(input.projectId, req.user?.id, input);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to fetch from remote");
  }
};

export const pushBranch = async (req, res) => {
  try {
    const input = parseInput(gitRemoteSyncSchema, req.body);
    if (input.async) {
      const { enqueueGitRemoteJob } = await import("../services/gitJob.service.js");
      const queued = await enqueueGitRemoteJob({
        type: "GIT_PUSH",
        projectId: input.projectId,
        userId: req.user?.id,
        payload: input,
      });
      return res.status(202).json({ success: true, data: queued });
    }
    const result = await GitService.push(input.projectId, req.user?.id, input);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, "Failed to push to remote");
  }
};

export const pullBranch = async (req, res) => {
  try {
    const input = parseInput(gitRemoteSyncSchema, req.body);
    if (input.async) {
      const { enqueueGitRemoteJob } = await import("../services/gitJob.service.js");
      const queued = await enqueueGitRemoteJob({
        type: "GIT_PULL",
        projectId: input.projectId,
        userId: req.user?.id,
        payload: input,
      });
      return res.status(202).json({ success: true, data: queued });
    }
    const result = await GitService.pull(input.projectId, req.user?.id, input);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, "Failed to pull from remote");
  }
};

export const syncRemote = async (req, res) => {
  try {
    const input = parseInput(gitRemoteSyncSchema, req.body);
    const data = await GitService.sync(input.projectId, req.user?.id, input);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to sync with remote");
  }
};

export const listBranches = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.query);
    const data = await GitService.getBranches(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list branches");
  }
};

export const checkoutBranch = async (req, res) => {
  try {
    const input = parseInput(gitCheckoutSchema, req.body);
    const data = await GitService.checkout(input.projectId, req.user?.id, input);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to checkout branch");
  }
};

export const renameBranch = async (req, res) => {
  try {
    const { projectId, oldName, newName } = parseInput(
      gitRenameBranchSchema,
      req.body,
    );
    const data = await GitService.renameBranch(
      projectId,
      req.user?.id,
      oldName,
      newName,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to rename branch");
  }
};

export const deleteBranch = async (req, res) => {
  try {
    const { projectId, force, deleteRemote } = parseInput(
      gitDeleteBranchSchema,
      { ...req.query, ...req.body },
    );
    const name = req.params.name;
    const data = await GitService.deleteBranch(projectId, req.user?.id, name, {
      force,
      deleteRemote,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to delete branch");
  }
};

export const mergeBranch = async (req, res) => {
  try {
    const { projectId, sourceBranch, mode } = parseInput(
      gitMergeSchema,
      req.body,
    );
    const data = await GitService.merge(
      projectId,
      req.user?.id,
      sourceBranch,
      { mode },
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to merge branch");
  }
};

export const mergeAbort = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.mergeAbort(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to abort merge");
  }
};

export const mergeContinue = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.mergeContinue(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to complete merge");
  }
};

export const rebaseBranch = async (req, res) => {
  try {
    const { projectId, targetBranch } = parseInput(gitRebaseSchema, req.body);
    const data = await GitService.rebase(projectId, req.user?.id, targetBranch);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to rebase branch");
  }
};

export const rebaseAbort = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.rebaseAbort(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to abort rebase");
  }
};

export const rebaseContinue = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.rebaseContinue(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to continue rebase");
  }
};

export const abortGitOperation = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.abortOperation(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to abort Git operation");
  }
};

export const continueGitOperation = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.continueOperation(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to continue Git operation");
  }
};

export const getConflicts = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.query);
    const data = await GitService.getConflicts(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to inspect conflicts");
  }
};

export const resolveConflict = async (req, res) => {
  try {
    const input = parseInput(gitResolveConflictSchema, req.body);
    const data = await GitService.resolveConflict(
      input.projectId,
      req.user?.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to resolve conflict");
  }
};

export const getCommitLog = async (req, res) => {
  try {
    const input = parseInput(gitLogQuerySchema, req.query);
    const commits = await GitService.getLog(input.projectId, req.user?.id, {
      ...input,
      limit: input.limit + 1,
    });
    const hasMore = commits.length > input.limit;
    const trimmed = hasMore ? commits.slice(0, input.limit) : commits;
    return res.status(200).json({ success: true, data: trimmed, hasMore });
  } catch (error) {
    return handleError(res, error, "Failed to get commit log");
  }
};

export const getCommitDetail = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.query);
    const data = await GitService.getCommitDetail(
      projectId,
      req.user?.id,
      req.params.hash,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to inspect commit");
  }
};

export const revertCommit = async (req, res) => {
  try {
    const { projectId } = parseInput(gitCommitActionSchema, req.body);
    const data = await GitService.revertCommit(
      projectId,
      req.user?.id,
      req.params.hash,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to revert commit");
  }
};

export const cherryPickCommit = async (req, res) => {
  try {
    const { projectId } = parseInput(gitCommitActionSchema, req.body);
    const data = await GitService.cherryPickCommit(
      projectId,
      req.user?.id,
      req.params.hash,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to cherry-pick commit");
  }
};

export const resetRepo = async (req, res) => {
  try {
    const { projectId, targetRef, mode } = parseInput(gitResetSchema, req.body);
    const data = await GitService.reset(projectId, req.user?.id, {
      targetRef,
      mode,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to reset repository");
  }
};

export const getFileDiff = async (req, res) => {
  try {
    const { projectId, filePath, staged } = req.query;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    const diff = await GitService.getDiff(
      projectId,
      req.user?.id,
      filePath,
      staged === "true",
    );
    return res.status(200).json({ success: true, data: { diff } });
  } catch (error) {
    return handleError(res, error, "Failed to get diff");
  }
};

export const getFileDiffPair = async (req, res) => {
  try {
    const input = parseInput(gitDiffPairQuerySchema, req.query);
    const data = await GitService.getDiffPair(
      input.projectId,
      req.user?.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to compute diff pair");
  }
};

export const getFileAtRef = async (req, res) => {
  try {
    const input = parseInput(gitFileAtRefQuerySchema, req.query);
    const data = await GitService.getFileAtRef(
      input.projectId,
      req.user?.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to load file at ref");
  }
};

export const listStashes = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.query);
    const data = await GitService.listStashes(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list stashes");
  }
};

export const createStash = async (req, res) => {
  try {
    const input = parseInput(gitStashPushSchema, req.body);
    const data = await GitService.stashPush(
      input.projectId,
      req.user?.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to create stash");
  }
};

export const getStashDiff = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.query);
    const data = await GitService.getStashDiff(
      projectId,
      req.user?.id,
      req.params.index,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to inspect stash");
  }
};

export const applyStash = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.stashApply(
      projectId,
      req.user?.id,
      req.params.index,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to apply stash");
  }
};

export const popStash = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.stashPop(
      projectId,
      req.user?.id,
      req.params.index,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to pop stash");
  }
};

export const dropStash = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, {
      ...req.query,
      ...req.body,
    });
    const data = await GitService.stashDrop(
      projectId,
      req.user?.id,
      req.params.index,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to drop stash");
  }
};

export const listTags = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.query);
    const data = await GitService.listTags(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list tags");
  }
};

export const createTag = async (req, res) => {
  try {
    const input = parseInput(gitCreateTagSchema, req.body);
    const data = await GitService.createTag(
      input.projectId,
      req.user?.id,
      input,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to create tag");
  }
};

export const pushTag = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.body);
    const data = await GitService.pushTag(
      projectId,
      req.user?.id,
      req.params.name,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to push tag");
  }
};

export const deleteTag = async (req, res) => {
  try {
    const { projectId, deleteRemote } = parseInput(gitDeleteTagSchema, {
      ...req.query,
      ...req.body,
    });
    const data = await GitService.deleteTag(
      projectId,
      req.user?.id,
      req.params.name,
      { deleteRemote },
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to delete tag");
  }
};

export const listPullRequests = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.query);
    const state = req.query.state || "open";
    const data = await GitService.listPullRequests(projectId, req.user?.id, {
      state,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to load Pull Requests");
  }
};

export const createPullRequest = async (req, res) => {
  try {
    const input = parseInput(gitCreatePrSchema, req.body);
    const data = await GitService.createPullRequest(
      input.projectId,
      req.user?.id,
      input,
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to create Pull Request");
  }
};

export const getCommitChecks = async (req, res) => {
  try {
    const { projectId } = parseInput(gitProjectOnlySchema, req.query);
    const ref = req.query.ref || "HEAD";
    const data = await GitService.getCommitChecks(projectId, req.user?.id, ref);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to fetch commit CI checks");
  }
};

export const handleGitCommand = async (req, res) => {
  try {
    const { projectId, input, command, args } = parseInput(
      gitCommandSchema,
      req.body,
    );
    const data = await dispatchGitConsoleCommand({
      projectId,
      userId: req.user?.id,
      input,
      command,
      args,
    });
    return res.status(200).json({
      success: true,
      result: data.output,
      data,
    });
  } catch (error) {
    return handleError(res, error, "Failed to execute git command");
  }
};
