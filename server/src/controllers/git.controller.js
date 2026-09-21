import { GitService } from "../services/git.service.js";
import { ServiceError } from "../utils/serviceError.js";

function handleError(res, error, defaultMsg = "Git operation failed") {
  console.error(`[GitController] ${defaultMsg}:`, error);
  if (error instanceof ServiceError) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.message,
    });
  }
  return res.status(500).json({
    success: false,
    error: error.message || defaultMsg,
  });
}

export const getStatus = async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    const status = await GitService.getStatus(projectId, req.user?.id);
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to get git status");
  }
};

export const stageFiles = async (req, res) => {
  try {
    const { projectId, files } = req.body;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    const status = await GitService.stageFiles(projectId, req.user?.id, files);
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to stage files");
  }
};

export const unstageFiles = async (req, res) => {
  try {
    const { projectId, files } = req.body;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    const status = await GitService.unstageFiles(
      projectId,
      req.user?.id,
      files,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to unstage files");
  }
};

export const discardChanges = async (req, res) => {
  try {
    const { projectId, filePath, isUntracked } = req.body;
    if (!projectId || !filePath) {
      return res
        .status(400)
        .json({ success: false, error: "projectId and filePath are required" });
    }
    const status = await GitService.discardChanges(
      projectId,
      req.user?.id,
      filePath,
      isUntracked,
    );
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to discard changes");
  }
};

export const commitChanges = async (req, res) => {
  try {
    const { projectId, message } = req.body;
    if (!projectId || !message) {
      return res
        .status(400)
        .json({ success: false, error: "projectId and message are required" });
    }
    const result = await GitService.commit(projectId, req.user?.id, message);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, "Failed to commit changes");
  }
};

export const pushBranch = async (req, res) => {
  try {
    const { projectId, branch } = req.body;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    const result = await GitService.push(projectId, req.user?.id, branch);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, "Failed to push to remote");
  }
};

export const pullBranch = async (req, res) => {
  try {
    const { projectId, branch } = req.body;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    const result = await GitService.pull(projectId, req.user?.id, branch);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error, "Failed to pull from remote");
  }
};

export const listBranches = async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    const data = await GitService.getBranches(projectId, req.user?.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to list branches");
  }
};

export const checkoutBranch = async (req, res) => {
  try {
    const { projectId, branch, createNew } = req.body;
    if (!projectId || !branch) {
      return res
        .status(400)
        .json({ success: false, error: "projectId and branch are required" });
    }
    const data = await GitService.checkout(
      projectId,
      req.user?.id,
      branch,
      createNew,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to checkout branch");
  }
};

export const getCommitLog = async (req, res) => {
  try {
    const { projectId, limit } = req.query;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    const data = await GitService.getLog(
      projectId,
      req.user?.id,
      limit ? parseInt(limit, 10) : 25,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error, "Failed to get commit log");
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

export const initRepo = async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, error: "projectId is required" });
    }
    await GitService.ensureGitRepo(projectId, req.user?.id);
    const status = await GitService.getStatus(projectId, req.user?.id);
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error, "Failed to initialize git repository");
  }
};

export const handleGitCommand = async (req, res) => {
  try {
    const { projectId, command, args } = req.body;
    if (!projectId || !command) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    const allowedCommands = [
      "add",
      "commit",
      "push",
      "status",
      "log",
      "pull",
      "diff",
      "branch",
      "checkout",
      "init",
    ];
    if (!allowedCommands.includes(command)) {
      return res
        .status(400)
        .json({ success: false, error: "Command not allowed" });
    }

    const result = await GitService.runGitCommand(
      projectId,
      command,
      args || [],
      req.user?.id,
    );
    return res.status(200).json({ success: true, result });
  } catch (error) {
    return handleError(res, error, "Failed to execute git command");
  }
};

export const setRemoteUrl = async (req, res) => {
  try {
    const { projectId, repoUrl } = req.body;
    if (!projectId || !repoUrl) {
      return res
        .status(400)
        .json({ success: false, error: "projectId and repoUrl are required" });
    }
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
