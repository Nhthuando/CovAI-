import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createTwoFilesPatch } from "diff";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { snapshotWorkspaceRoot } from "../utils/snapshotWorkspace.js";
import { resolveProjectAccess, membershipWhere } from "./projectAccess.service.js";
import { resolveActiveProjectSnapshot } from "./projectFileVersion.service.js";
import { withPreparedProjectWorkspace } from "./projectWorkspacePreparation.service.js";
import {
  deferPreparedCommit,
  stagePreparedPublication,
} from "./projectOperationWorkspace.service.js";
import { deliverScopedProjectTransport } from "./projectSubscription.service.js";
import { clearProjectTreeCache } from "./project.service.js";
import { checkStaleGitIndexLock, withProjectVcsLock } from "./vcsLock.service.js";
import {
  ensureCovaiGitExcludes,
  execGit,
  normalizeCleanGithubUrl,
  redactGitOutput,
  resolveActingUserGithubToken,
  resolveGitAuthorIdentity,
  sanitizeGitFilePath,
  sanitizeGitRef,
} from "./gitCredentialHelper.service.js";
import {
  detectBinaryBuffer,
  detectRepoOperationState,
  inferLanguageFromPath,
  normalizePosixPath,
  parseGitLogRecords,
  parsePorcelainV2Z,
  parseUnifiedDiffHunks,
} from "./gitPorcelainParser.service.js";
import { applyHunkAction } from "./gitHunkPatch.service.js";
import { GitHubPlatformService } from "./githubPlatform.service.js";
import { generateGitCommitMessage } from "./gitAiCommit.service.js";
import {
  GIT_LIMITS,
  GIT_REPO_OPERATION_STATE,
  GIT_SOCKET_EVENTS,
  validateGitBranchName,
  validateGitTagName,
} from "../../../shared/gitProtocol.js";
import { isVcsIgnoredRelativePath } from "../../../shared/versionControlMode.js";

const EMPTY_TREE_OID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EXEC_OPTION_KEYS = new Set([
  "githubToken",
  "author",
  "isNetwork",
  "allowLocalTransport",
  "input",
  "rawOutput",
  "timeoutMs",
  "maxBuffer",
  "encoding",
  "env",
]);

export const gitCommandArguments = (command) => {
  if (Array.isArray(command)) return command;
  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === "\\" && quote === '"' && ['"', "\\"].includes(command[i + 1])) {
      current += command[++i];
      started = true;
    } else if (quote) {
      if (ch === quote) quote = null;
      else {
        current += ch;
        started = true;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) throw new ServiceError("Unterminated Git argument", 400);
  if (started) tokens.push(current);
  if (tokens.shift() !== "git") {
    throw new ServiceError("Only Git commands are supported", 400);
  }
  return tokens;
};

const branchName = (value) => {
  if (value !== undefined && !validateGitBranchName(value)) {
    throw new ServiceError("Invalid branch name", 400, "INVALID_BRANCH_NAME");
  }
  return value;
};

const tagName = (value) => {
  if (value !== undefined && !validateGitTagName(value)) {
    throw new ServiceError("Invalid tag name", 400, "INVALID_TAG_NAME");
  }
  return value;
};

const fileName = (value) => sanitizeGitFilePath(value);

const preparedGit = new AsyncLocalStorage();

function emitGitTransport(projectId, event, payload) {
  if (!projectId) return;
  void deliverScopedProjectTransport({ projectId, event, payload }).catch(() => {});
}

function isLocalFilesystemRemote(url) {
  if (process.env.NODE_ENV !== "test" || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return false;
  const fsPath = trimmed.startsWith("file://")
    ? trimmed.replace(/^file:\/\//i, "")
    : trimmed;
  return fs.existsSync(fsPath);
}

function resolveContainedDiskFile(rootDir, relativePath) {
  const safeRel = sanitizeGitFilePath(relativePath);
  const realRoot = fs.realpathSync(rootDir);
  const target = path.resolve(realRoot, safeRel);
  const check = path.relative(realRoot, target);
  if (!check || check.startsWith("..") || path.isAbsolute(check)) {
    throw new ServiceError("Use a project-relative file path", 400, "INVALID_FILE_PATH");
  }
  const parentDir = path.dirname(target);
  if (fs.existsSync(parentDir)) {
    const realParent = fs.realpathSync(parentDir);
    const parentRel = path.relative(realRoot, realParent);
    if (parentRel.startsWith("..") || path.isAbsolute(parentRel)) {
      throw new ServiceError("Use a project-relative file path", 400, "INVALID_FILE_PATH");
    }
  }
  return { safeRel, realRoot, target };
}

function summarizeHeadChange(statusSummary) {
  return {
    branch: statusSummary?.branch || null,
    headOid: statusSummary?.headOid || null,
    clean: Boolean(statusSummary?.clean),
    dirtyCount:
      (statusSummary?.staged?.length || 0) +
      (statusSummary?.unstaged?.length || 0) +
      (statusSummary?.untracked?.length || 0) +
      (statusSummary?.conflicts?.length || 0),
    conflictCount: statusSummary?.conflicts?.length || 0,
  };
}

export class GitService {
  /**
   * Resolves the repository root directory from the project's active snapshot.
   */
  static async getRepoPath(projectId, userId) {
    const active = preparedGit.getStore();
    if (active?.projectId === projectId && active.userId === userId) {
      return active.repo;
    }

    await resolveProjectAccess({ projectId, userId, capability: "project.read" });
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...membershipWhere(userId),
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        repoUrl: true,
        defaultBranch: true,
        activeSnapshotId: true,
        workspaceRevision: true,
        owner: {
          select: { id: true, name: true, email: true, githubLogin: true },
        },
      },
    });

    if (!project) {
      throw new ServiceError(
        "Project not found or you don't have permission",
        404,
      );
    }

    const snapshot = await resolveActiveProjectSnapshot(prisma, projectId);
    if (!snapshot || !snapshot.rootDir) {
      throw new ServiceError(
        "Project snapshot not ready or not extracted yet",
        404,
      );
    }

    const isGitHubProject = snapshot.source === "GITHUB" || Boolean(project.repoUrl);
    const rootDir = snapshotWorkspaceRoot(snapshot);
    if (!rootDir || !fs.existsSync(rootDir)) {
      throw new ServiceError(
        `Project directory not found on disk: ${rootDir}`,
        404,
      );
    }

    return { rootDir, project, snapshot, isGitHubProject };
  }

  /**
   * Safely executes a Git CLI command in `rootDir` without invoking a shell.
   */
  static async runCommand(rootDir, commandOrArgs, envOrOptions = {}) {
    const args = gitCommandArguments(commandOrArgs);
    const execOptions = {};
    const extraEnv = {};

    if (envOrOptions && typeof envOrOptions === "object") {
      for (const [k, v] of Object.entries(envOrOptions)) {
        if (EXEC_OPTION_KEYS.has(k)) {
          execOptions[k] = v;
        } else {
          extraEnv[k] = v;
        }
      }
    }

    if (Object.keys(extraEnv).length > 0) {
      execOptions.env = { ...(execOptions.env || {}), ...extraEnv };
    }

    return execGit(rootDir, args, execOptions);
  }

  static async _hasHeadCommit(rootDir) {
    try {
      const { stdout } = await this.runCommand(rootDir, ["rev-parse", "--verify", "HEAD"]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Ensures `origin` in `.git/config` uses a credential-free HTTPS URL
   * (or preserves an isolated local bare remote in test environments).
   */
  static async _resolveRemoteExecution(rootDir, project, userId, { requireRepoScope = false } = {}) {
    let existingOrigin = "";
    try {
      const { stdout } = await this.runCommand(rootDir, ["remote", "get-url", "origin"]);
      existingOrigin = stdout.trim();
    } catch {
      existingOrigin = "";
    }

    if (isLocalFilesystemRemote(existingOrigin)) {
      return {
        remoteUrl: existingOrigin,
        isLocalTestRemote: true,
        execOptions: { isNetwork: true, allowLocalTransport: true },
      };
    }

    const rawUrl = project?.repoUrl || existingOrigin;
    if (!rawUrl) {
      throw new ServiceError(
        "Remote repository URL is not configured. Link or publish a GitHub repository first.",
        400,
        "GIT_REMOTE_MISSING",
      );
    }

    const { cleanUrl, webUrl } = normalizeCleanGithubUrl(rawUrl);

    if (existingOrigin !== cleanUrl) {
      if (existingOrigin) {
        await this.runCommand(rootDir, ["remote", "set-url", "origin", cleanUrl]);
      } else {
        await this.runCommand(rootDir, ["remote", "add", "origin", cleanUrl]);
      }
    }

    const { token } = await resolveActingUserGithubToken(userId, {
      requireRepoScope,
    });

    return {
      remoteUrl: cleanUrl,
      webUrl,
      isLocalTestRemote: false,
      execOptions: { githubToken: token, isNetwork: true },
    };
  }

  static async _recordSnapshotHeadSync(rootDir, projectId, snapshotId, statusData) {
    if (!preparedGit.getStore()) return;
    const headOid = await this._hasHeadCommit(rootDir);

    await stagePreparedPublication(async (tx) => {
      if (headOid && snapshotId) {
        await tx.projectSnapshot.update({
          where: { id: snapshotId },
          data: { commitSha: headOid },
        });
      }
      clearProjectTreeCache();
    });

    deferPreparedCommit(async () => {
      await deliverScopedProjectTransport({
        projectId,
        event: GIT_SOCKET_EVENTS.STATUS_UPDATED,
        payload: { projectId, ...summarizeHeadChange(statusData) },
      });
    });
  }

  /**
   * Ensures a `.git` repository exists on disk with clean config and CovAI excludes.
   */
  static async ensureGitRepo(projectId, userId, options = {}) {
    const { rootDir, project, snapshot } = await this.getRepoPath(projectId, userId);
    const gitDir = path.join(rootDir, ".git");
    const defaultBranch = branchName(options.defaultBranch || project.defaultBranch || "main");
    const author = await resolveGitAuthorIdentity(userId);

    if (!fs.existsSync(gitDir)) {
      try {
        await this.runCommand(rootDir, ["init", "-b", defaultBranch]);
      } catch {
        await this.runCommand(rootDir, ["init"]);
      }

      await this.runCommand(rootDir, ["config", "user.name", author.name]);
      await this.runCommand(rootDir, ["config", "user.email", author.email]);
      await this.runCommand(rootDir, ["config", "commit.gpgsign", "false"]);
      await this.runCommand(rootDir, ["config", "core.autocrlf", "false"]);
      await this.runCommand(rootDir, ["config", "core.quotepath", "false"]);

      if (project.repoUrl) {
        try {
          const { cleanUrl } = normalizeCleanGithubUrl(project.repoUrl);
          await this.runCommand(rootDir, ["remote", "add", "origin", cleanUrl]);
        } catch {
          // Non-fatal if repoUrl is malformed
        }
      }
    } else {
      await this.runCommand(rootDir, ["config", "user.name", author.name]).catch(() => {});
      await this.runCommand(rootDir, ["config", "user.email", author.email]).catch(() => {});
      await this.runCommand(rootDir, ["config", "commit.gpgsign", "false"]).catch(() => {});
      await this.runCommand(rootDir, ["config", "core.autocrlf", "false"]).catch(() => {});
      await this.runCommand(rootDir, ["config", "core.quotepath", "false"]).catch(() => {});

      try {
        const { stdout: existingOrigin } = await this.runCommand(rootDir, [
          "remote",
          "get-url",
          "origin",
        ]);
        if (existingOrigin && existingOrigin.includes("github.com")) {
          const { cleanUrl, webUrl } = normalizeCleanGithubUrl(existingOrigin);
          if (existingOrigin.trim() !== cleanUrl) {
            await this.runCommand(rootDir, ["remote", "set-url", "origin", cleanUrl]);
          }
          if (!project.repoUrl) {
            project.repoUrl = webUrl;
            await stagePreparedPublication((tx) =>
              tx.project.update({
                where: { id: projectId },
                data: { repoUrl: webUrl },
              }),
            );
          }
        }
      } catch {
        if (project.repoUrl) {
          try {
            const { cleanUrl } = normalizeCleanGithubUrl(project.repoUrl);
            await this.runCommand(rootDir, ["remote", "add", "origin", cleanUrl]);
          } catch {
            // Ignore remote setup failure on local-only initialization
          }
        }
      }
    }

    ensureCovaiGitExcludes(rootDir);

    if (options.createGitignore) {
      const gitignorePath = path.join(rootDir, ".gitignore");
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(
          gitignorePath,
          [
            "node_modules/",
            ".env",
            ".env.*",
            "coverage/",
            "dist/",
            "build/",
            ".DS_Store",
            "",
          ].join("\n"),
          "utf8",
        );
      }
    }

    if (options.createInitialCommit) {
      const head = await this._hasHeadCommit(rootDir);
      if (!head) {
        await this.runCommand(rootDir, ["add", "-A"]);
        await this.runCommand(
          rootDir,
          ["commit", "-m", options.initialCommitMessage || "chore: initial commit"],
          { author },
        ).catch(() => {});
      }
    }

    return { rootDir, project, snapshot };
  }

  /**
   * Explicitly initializes a Git repository (works for ZIP projects opened by GitHub users).
   */
  static async initRepo(projectId, userId, options = {}) {
    const { project, rootDir, snapshot } = await this.ensureGitRepo(
      projectId,
      userId,
      {
        defaultBranch: options.defaultBranch || "main",
        createInitialCommit: Boolean(options.createInitialCommit),
        createGitignore: options.createGitignore !== false,
      },
    );

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return {
      ...status,
      defaultBranch: project.defaultBranch || options.defaultBranch || "main",
    };
  }

  /**
   * Publishes a local or ZIP project directly to a new GitHub repository.
   */
  static async publishToGitHub(projectId, userId, options = {}) {
    const {
      name,
      description = "",
      isPrivate = true,
      defaultBranch = "main",
      initialCommitMessage = "feat: initial commit from CovAI",
    } = options;

    emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_PROGRESS, {
      projectId,
      operation: "publish",
      phase: "creating_repo",
      message: `Creating GitHub repository ${name}...`,
    });

    const createdRepo = await GitHubPlatformService.createRepository(userId, {
      name,
      description,
      isPrivate,
    });

    const targetBranch = branchName(defaultBranch || createdRepo.defaultBranch || "main");
    const repoWebUrl = createdRepo.htmlUrl;
    const { cleanUrl } = normalizeCleanGithubUrl(repoWebUrl);

    const { rootDir, project, snapshot } = await this.ensureGitRepo(projectId, userId, {
      defaultBranch: targetBranch,
      createGitignore: true,
    });
    project.repoUrl = repoWebUrl;
    project.defaultBranch = targetBranch;

    await this.runCommand(rootDir, ["remote", "set-url", "origin", cleanUrl]).catch(
      async () => {
        await this.runCommand(rootDir, ["remote", "add", "origin", cleanUrl]);
      },
    );

    const head = await this._hasHeadCommit(rootDir);
    if (!head) {
      await this.runCommand(rootDir, ["add", "-A"]);
      const author = await resolveGitAuthorIdentity(userId);
      await this.runCommand(rootDir, ["commit", "-m", initialCommitMessage], {
        author,
      });
    }

    await this.runCommand(rootDir, ["branch", "-M", targetBranch]);

    emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_PROGRESS, {
      projectId,
      operation: "publish",
      phase: "pushing",
      message: `Pushing ${targetBranch} to GitHub...`,
    });

    const { token } = await resolveActingUserGithubToken(userId, {
      requireRepoScope: true,
    });
    await this.runCommand(rootDir, ["push", "-u", "origin", targetBranch], {
      githubToken: token,
      isNetwork: true,
    });

    await stagePreparedPublication((tx) =>
      tx.project.update({
        where: { id: projectId },
        data: { repoUrl: repoWebUrl, defaultBranch: targetBranch },
      }),
    );

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);

    emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_COMPLETED, {
      projectId,
      operation: "publish",
      repoUrl: repoWebUrl,
      branch: targetBranch,
    });

    return {
      repository: createdRepo,
      repoUrl: repoWebUrl,
      branch: targetBranch,
      status,
    };
  }

  /**
   * Returns complete VS Code-grade repository status.
   */
  static async getStatus(projectId, userId, { includeTracked = false } = {}) {
    let repoInfo;
    try {
      repoInfo = await this.getRepoPath(projectId, userId);
    } catch (err) {
      if (err instanceof ServiceError && err.statusCode === 404) {
        return {
          isGitHubProject: false,
          hasGit: false,
          canInitialize: false,
          isReady: false,
          branch: null,
          headOid: null,
          detached: false,
          tracking: null,
          ahead: 0,
          behind: 0,
          operationState: GIT_REPO_OPERATION_STATE.IDLE,
          staged: [],
          unstaged: [],
          untracked: [],
          conflicts: [],
          unchangedCount: 0,
          stashCount: 0,
          clean: true,
          repoUrl: null,
          message: err.message || "Project snapshot not ready or not found.",
        };
      }
      throw err;
    }

    const { rootDir, project, snapshot, isGitHubProject } = repoInfo;
    const gitDir = path.join(rootDir, ".git");

    if (!fs.existsSync(gitDir) && isGitHubProject && !preparedGit.getStore()) {
      try {
        const snapshots = await prisma.projectSnapshot.findMany({
          where: { projectId },
          orderBy: { createdAt: "desc" },
          select: { id: true, rootDir: true, storagePath: true, source: true },
        });
        for (const prev of snapshots) {
          const prevWorkspace = snapshotWorkspaceRoot(prev);
          if (prevWorkspace && prevWorkspace !== rootDir) {
            const prevGit = path.join(prevWorkspace, ".git");
            if (fs.existsSync(prevGit)) {
              fs.cpSync(prevGit, gitDir, { recursive: true });
              break;
            }
          }
        }
      } catch (err) {
        console.warn("[git.service] Could not restore .git from sibling snapshot:", err?.message);
      }
    }

    if (!fs.existsSync(gitDir)) {
      return {
        isGitHubProject,
        isGitHubLinked: Boolean(project.repoUrl),
        hasGit: false,
        canInitialize: true,
        isReady: true,
        branch: null,
        headOid: null,
        detached: false,
        tracking: null,
        ahead: 0,
        behind: 0,
        operationState: GIT_REPO_OPERATION_STATE.IDLE,
        staged: [],
        unstaged: [],
        untracked: [],
        conflicts: [],
        unchangedCount: 0,
        stashCount: 0,
        clean: true,
        repoUrl: project.repoUrl || null,
        defaultBranch: project.defaultBranch || "main",
        activeSnapshotId: snapshot.id,
        workspaceRevision: project.workspaceRevision,
      };
    }

    ensureCovaiGitExcludes(rootDir);

    let activeRepoUrl = project.repoUrl || null;
    if (!activeRepoUrl) {
      try {
        const { stdout: originUrl } = await this.runCommand(rootDir, [
          "remote",
          "get-url",
          "origin",
        ]);
        if (originUrl && originUrl.includes("github.com")) {
          activeRepoUrl = normalizeCleanGithubUrl(originUrl).webUrl;
        } else if (originUrl) {
          activeRepoUrl = redactGitOutput(originUrl);
        }
      } catch {
        // Local-only git repo
      }
    }

    const { stdout: statusOutput } = await this.runCommand(
      rootDir,
      ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"],
      { rawOutput: true },
    );

    const parsed = parsePorcelainV2Z(statusOutput);
    const untracked = parsed.untracked.filter(
      (item) => !isVcsIgnoredRelativePath(item.path),
    );
    const clean =
      parsed.staged.length === 0 &&
      parsed.unstaged.length === 0 &&
      untracked.length === 0 &&
      parsed.conflicts.length === 0;

    let stashCount = 0;
    try {
      const { stdout: stashOut } = await this.runCommand(rootDir, [
        "stash",
        "list",
        "--oneline",
      ]);
      stashCount = stashOut
        ? stashOut.split(/\r?\n/).filter((line) => line.trim().length > 0).length
        : 0;
    } catch {
      stashCount = 0;
    }

    let trackedFiles = [];
    let unchangedFiles = [];
    let unchangedCount = 0;
    try {
      const { stdout: lsOut } = await this.runCommand(
        rootDir,
        ["ls-files", "-z"],
        { rawOutput: true },
      );
      const changedPaths = new Set([
        ...parsed.staged.map((f) => f.path),
        ...parsed.unstaged.map((f) => f.path),
        ...parsed.conflicts.map((f) => f.path),
      ]);
      const allTracked = String(lsOut || "")
        .split("\0")
        .map(normalizePosixPath)
        .filter((p) => p && !isVcsIgnoredRelativePath(p));
      const unchangedList = allTracked.filter((p) => !changedPaths.has(p));
      unchangedCount = unchangedList.length;
      if (includeTracked) {
        trackedFiles = allTracked;
        unchangedFiles = unchangedList.map((p) => ({
          path: p,
          status: " ",
          statusText: "Unchanged",
        }));
      }
    } catch {
      unchangedCount = 0;
    }

    return {
      isGitHubProject: Boolean(isGitHubProject || activeRepoUrl),
      isGitHubLinked: Boolean(activeRepoUrl && activeRepoUrl.includes("github.com")),
      hasGit: true,
      canInitialize: false,
      isReady: true,
      branch: parsed.branch || project.defaultBranch || "main",
      headOid: parsed.headOid,
      detached: parsed.detached,
      isUnborn: parsed.isUnborn,
      tracking: parsed.tracking,
      ahead: parsed.ahead,
      behind: parsed.behind,
      operationState: detectRepoOperationState(rootDir),
      staged: parsed.staged,
      unstaged: parsed.unstaged,
      untracked,
      conflicts: parsed.conflicts,
      unchangedCount,
      ...(includeTracked ? { trackedFiles, unchangedFiles } : {}),
      stashCount,
      clean,
      repoUrl: activeRepoUrl,
      defaultBranch: project.defaultBranch || "main",
      activeSnapshotId: snapshot.id,
      workspaceRevision: project.workspaceRevision,
    };
  }

  /**
   * Stages selected files, a folder, or the entire working tree.
   */
  static async stageFiles(projectId, userId, files, folder) {
    if (folder) fileName(folder);
    if (files && files !== "all") {
      (Array.isArray(files) ? files : [files]).forEach(fileName);
    }

    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);

    if (folder) {
      await this.runCommand(rootDir, ["add", "-A", "--", sanitizeGitFilePath(folder)]);
    } else if (
      files === "all" ||
      !files ||
      (Array.isArray(files) && files.length === 0)
    ) {
      await this.runCommand(rootDir, ["add", "-A"]);
    } else {
      const targetList = (Array.isArray(files) ? files : [files]).map(fileName);
      await this.runCommand(rootDir, ["add", "-A", "--", ...targetList]);
    }

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  /**
   * Unstages selected files, folder, or all staged entries (including unborn HEAD).
   */
  static async unstageFiles(projectId, userId, files, folder) {
    if (folder) fileName(folder);
    if (files && files !== "all") {
      (Array.isArray(files) ? files : [files]).forEach(fileName);
    }

    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const hasHead = Boolean(await this._hasHeadCommit(rootDir));

    if (!hasHead) {
      if (folder) {
        await this.runCommand(rootDir, [
          "rm",
          "--cached",
          "-r",
          "-f",
          "--",
          sanitizeGitFilePath(folder),
        ]).catch(() => {});
      } else if (
        files === "all" ||
        !files ||
        (Array.isArray(files) && files.length === 0)
      ) {
        await this.runCommand(rootDir, ["rm", "--cached", "-r", "-f", "."]).catch(
          () => {},
        );
      } else {
        const targetList = (Array.isArray(files) ? files : [files]).map(fileName);
        await this.runCommand(rootDir, [
          "rm",
          "--cached",
          "-f",
          "--",
          ...targetList,
        ]).catch(() => {});
      }
    } else if (folder) {
      const safeFolder = sanitizeGitFilePath(folder);
      await this.runCommand(rootDir, ["restore", "--staged", "--", safeFolder]).catch(
        async () => {
          await this.runCommand(rootDir, ["reset", "HEAD", "--", safeFolder]);
        },
      );
    } else if (
      files === "all" ||
      !files ||
      (Array.isArray(files) && files.length === 0)
    ) {
      await this.runCommand(rootDir, ["reset", "HEAD", "--", "."]).catch(async () => {
        await this.runCommand(rootDir, ["restore", "--staged", "."]).catch(() => {});
      });
    } else {
      const targetList = (Array.isArray(files) ? files : [files]).map(fileName);
      await this.runCommand(rootDir, [
        "restore",
        "--staged",
        "--",
        ...targetList,
      ]).catch(async () => {
        await this.runCommand(rootDir, ["reset", "HEAD", "--", ...targetList]);
      });
    }

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  static async stageHunk(projectId, userId, filePath, hunkIndex) {
    fileName(filePath);
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await applyHunkAction(rootDir, { filePath, hunkIndex, action: "stage" });
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  static async unstageHunk(projectId, userId, filePath, hunkIndex) {
    fileName(filePath);
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await applyHunkAction(rootDir, { filePath, hunkIndex, action: "unstage" });
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  static async revertHunk(projectId, userId, filePath, hunkIndex) {
    fileName(filePath);
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await applyHunkAction(rootDir, { filePath, hunkIndex, action: "revert" });
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  /**
   * Discards working-tree edits or removes untracked files safely.
   * Supports both `(filePath, isUntracked)` and batch `{ files, includeUntracked }`.
   */
  static async discardChanges(
    projectId,
    userId,
    filePathOrOptions,
    isUntracked = false,
  ) {
    let entries = [];
    let includeUntracked = Boolean(isUntracked);
    let discardAll = false;

    if (typeof filePathOrOptions === "string" && filePathOrOptions !== "all") {
      entries = [{ path: fileName(filePathOrOptions), isUntracked: Boolean(isUntracked) }];
    } else if (filePathOrOptions === "all") {
      discardAll = true;
      if (isUntracked && typeof isUntracked === "object") {
        includeUntracked = Boolean(isUntracked.includeUntracked);
      }
    } else if (filePathOrOptions && typeof filePathOrOptions === "object") {
      includeUntracked = Boolean(filePathOrOptions.includeUntracked);
      if (filePathOrOptions.files === "all") {
        discardAll = true;
      } else if (Array.isArray(filePathOrOptions.files)) {
        entries = filePathOrOptions.files.map((item) =>
          typeof item === "string"
            ? { path: fileName(item), isUntracked: includeUntracked }
            : { path: fileName(item.path), isUntracked: Boolean(item.isUntracked) },
        );
      } else if (filePathOrOptions.filePath) {
        entries = [
          {
            path: fileName(filePathOrOptions.filePath),
            isUntracked: Boolean(filePathOrOptions.isUntracked),
          },
        ];
      }
    }

    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);

    if (discardAll) {
      const currentStatus = await this.getStatus(projectId, userId);
      if (currentStatus.unstaged.length > 0) {
        const trackedTargets = currentStatus.unstaged.map((f) => f.path);
        await this.runCommand(rootDir, [
          "restore",
          "--worktree",
          "--",
          ...trackedTargets,
        ]).catch(async () => {
          await this.runCommand(rootDir, ["checkout", "--", ...trackedTargets]);
        });
      }
      if (includeUntracked) {
        for (const u of currentStatus.untracked) {
          const { target } = resolveContainedDiskFile(rootDir, u.path);
          if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
          }
        }
      }
    } else {
      const trackedList = [];
      for (const entry of entries) {
        if (entry.isUntracked) {
          const { target } = resolveContainedDiskFile(rootDir, entry.path);
          if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
          }
        } else {
          trackedList.push(entry.path);
        }
      }
      if (trackedList.length > 0) {
        await this.runCommand(rootDir, [
          "restore",
          "--worktree",
          "--",
          ...trackedList,
        ]).catch(async () => {
          await this.runCommand(rootDir, ["checkout", "--", ...trackedList]);
        });
      }
    }

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  /**
   * Appends a safe ignore pattern to the repository's `.gitignore` without duplicates.
   */
  static async addGitignorePattern(projectId, userId, pattern) {
    if (typeof pattern !== "string" || !pattern.trim()) {
      throw new ServiceError("Ignore pattern is required", 400, "INVALID_GITIGNORE");
    }
    const cleanPattern = pattern.trim().replaceAll("\\", "/").replace(/[\r\n\0]/g, "");
    if (!cleanPattern) {
      throw new ServiceError("Invalid ignore pattern", 400, "INVALID_GITIGNORE");
    }

    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const gitignorePath = path.join(rootDir, ".gitignore");
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, "utf8")
      : "";
    const lines = existing.split(/\r?\n/).map((l) => l.trim());
    if (!lines.includes(cleanPattern)) {
      const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
      fs.appendFileSync(gitignorePath, `${prefix}${cleanPattern}\n`, "utf8");
    }

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  /**
   * Commits changes with acting user's author identity (supporting amend, stageAll, pushAfter, syncAfter).
   */
  static async commit(projectId, userId, messageOrOptions) {
    const opts =
      typeof messageOrOptions === "string"
        ? { message: messageOrOptions }
        : messageOrOptions || {};

    const baseMsg = typeof opts.message === "string" ? opts.message.trim() : "";
    const bodyMsg =
      typeof opts.description === "string" ? opts.description.trim() : "";
    if (!baseMsg) {
      throw new ServiceError("Commit message cannot be empty", 400);
    }
    const fullMessage = bodyMsg ? `${baseMsg}\n\n${bodyMsg}` : baseMsg;

    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const amend = Boolean(opts.amend);

    let hasStaged = false;
    try {
      const { stdout: diffCached } = await this.runCommand(rootDir, [
        "diff",
        "--cached",
        "--name-only",
      ]);
      hasStaged = Boolean(diffCached && diffCached.trim().length > 0);
    } catch {
      hasStaged = false;
    }

    if (opts.stageAll === true || (opts.stageAll !== false && !hasStaged && !amend)) {
      await this.runCommand(rootDir, ["add", "-A"]);
      hasStaged = true;
    } else if (!hasStaged && !amend) {
      throw new ServiceError(
        "No staged changes to commit. Stage files or enable stageAll.",
        400,
        "NOTHING_STAGED",
      );
    }

    const author = await resolveGitAuthorIdentity(userId, {
      authorName: opts.authorName,
      authorEmail: opts.authorEmail,
    });

    const args = ["commit"];
    if (amend) args.push("--amend");
    args.push("--author", `${author.name} <${author.email}>`, "-m", fullMessage);

    let stdout = "";
    try {
      const res = await this.runCommand(rootDir, args, { author });
      stdout = res.stdout;
    } catch (err) {
      if (
        err.message &&
        (err.message.includes("nothing to commit") ||
          err.message.includes("working tree clean"))
      ) {
        stdout = "Nothing to commit, working tree clean";
      } else {
        throw err;
      }
    }

    const statusAfterCommit = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(
      rootDir,
      projectId,
      snapshot.id,
      statusAfterCommit,
    );

    let pushResult = null;
    if (opts.syncAfter) {
      return this.sync(projectId, userId);
    }
    if (opts.pushAfter) {
      pushResult = await this.push(projectId, userId);
      return {
        success: true,
        message: stdout,
        commitSha: pushResult.status?.headOid || statusAfterCommit.headOid,
        pushResult,
        status: pushResult.status,
      };
    }

    return {
      success: true,
      message: stdout,
      commitSha: statusAfterCommit.headOid,
      status: statusAfterCommit,
    };
  }

  /**
   * Soft-resets the last commit so changes return to the Staging area.
   */
  static async undoCommit(projectId, userId, { allowPushed = false } = {}) {
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const currentStatus = await this.getStatus(projectId, userId);
    if (!currentStatus.headOid) {
      throw new ServiceError("Repository has no commits to undo", 400, "NO_COMMITS");
    }

    if (currentStatus.tracking && currentStatus.ahead === 0 && !allowPushed) {
      throw new ServiceError(
        "The latest commit is already pushed to remote. Confirm undo with allowPushed=true if you want to rewrite local history.",
        409,
        "COMMIT_ALREADY_PUSHED",
      );
    }

    const hasParent = await this.runCommand(rootDir, [
      "rev-parse",
      "--verify",
      "HEAD~1",
    ])
      .then(() => true)
      .catch(() => false);

    if (hasParent) {
      await this.runCommand(rootDir, ["reset", "--soft", "HEAD~1"]);
    } else {
      await this.runCommand(rootDir, ["update-ref", "-d", "HEAD"]);
    }

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  /**
   * Uses Gemini AI + user quota to draft a Conventional Commit message.
   */
  static async generateAiCommitMessage(projectId, userId, { model } = {}) {
    await resolveProjectAccess({ projectId, userId, capability: "ai.use" });
    const { rootDir } = await this.getRepoPath(projectId, userId);
    if (!fs.existsSync(path.join(rootDir, ".git"))) {
      throw new ServiceError(
        "Initialize Git before generating an AI commit message",
        400,
        "GIT_NOT_INITIALIZED",
      );
    }
    return generateGitCommitMessage({ projectId, userId, rootDir, model });
  }

  /**
   * Fetches updates from remote without modifying the working tree.
   */
  static async fetch(projectId, userId, { prune = true, tags = true } = {}) {
    const { rootDir, project, snapshot } = await this.ensureGitRepo(projectId, userId);
    const { execOptions } = await this._resolveRemoteExecution(
      rootDir,
      project,
      userId,
      { requireRepoScope: false },
    );

    emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_PROGRESS, {
      projectId,
      operation: "fetch",
      phase: "fetching",
      message: "Fetching from origin...",
    });

    const args = ["fetch", "origin"];
    if (prune) args.push("--prune");
    if (tags) args.push("--tags");

    const { stdout, stderr } = await this.runCommand(rootDir, args, execOptions);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);

    emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_COMPLETED, {
      projectId,
      operation: "fetch",
      ahead: status.ahead,
      behind: status.behind,
    });

    return {
      success: true,
      output: stdout || stderr || "Fetch completed",
      status,
    };
  }

  /**
   * Pushes local commits to remote using strictly transient acting-user credentials.
   */
  static async push(projectId, userId, branchOrOptions, extraOptions = {}) {
    const opts =
      typeof branchOrOptions === "string"
        ? { branch: branchOrOptions, ...extraOptions }
        : { ...(branchOrOptions || {}), ...extraOptions };

    if (opts.branch) branchName(opts.branch);

    const { rootDir, project, snapshot } = await this.ensureGitRepo(projectId, userId);
    const { execOptions } = await this._resolveRemoteExecution(
      rootDir,
      project,
      userId,
      { requireRepoScope: true },
    );

    let targetBranch = opts.branch;
    if (!targetBranch) {
      const { stdout } = await this.runCommand(rootDir, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      targetBranch = stdout.trim() || project.defaultBranch || "main";
    }
    branchName(targetBranch);

    emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_PROGRESS, {
      projectId,
      operation: "push",
      phase: "pushing",
      message: `Pushing ${targetBranch} to origin...`,
    });

    const args = ["push"];
    if (opts.setUpstream !== false) args.push("-u");
    if (opts.forceWithLease) args.push("--force-with-lease");
    args.push("origin", targetBranch);
    if (opts.tags) args.push("--tags");

    try {
      const { stdout, stderr } = await this.runCommand(rootDir, args, execOptions);
      const status = await this.getStatus(projectId, userId);
      await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);

      emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_COMPLETED, {
        projectId,
        operation: "push",
        branch: targetBranch,
      });

      return {
        success: true,
        output: stdout || stderr || "Push completed successfully",
        status,
      };
    } catch (error) {
      const msg = error.message || "";
      if (
        msg.includes("Authentication failed") ||
        msg.includes("403") ||
        msg.includes("could not read Username") ||
        msg.includes("Permission to")
      ) {
        throw new ServiceError(
          "GitHub authentication failed. Please verify your GitHub account has write access to this repository.",
          403,
          "GIT_AUTH_FAILED",
        );
      }
      if (msg.includes("non-fast-forward") || msg.includes("fetch first")) {
        throw new ServiceError(
          "Push rejected because remote contains newer commits. Pull or Sync before pushing.",
          409,
          "GIT_PUSH_REJECTED",
        );
      }
      throw error;
    }
  }

  /**
   * Pulls changes from remote and enters Conflict state cleanly if conflicts occur.
   */
  static async pull(projectId, userId, branchOrOptions, extraOptions = {}) {
    const opts =
      typeof branchOrOptions === "string"
        ? { branch: branchOrOptions, ...extraOptions }
        : { ...(branchOrOptions || {}), ...extraOptions };

    if (opts.branch) branchName(opts.branch);

    const { rootDir, project, snapshot } = await this.ensureGitRepo(projectId, userId);
    const { execOptions } = await this._resolveRemoteExecution(
      rootDir,
      project,
      userId,
      { requireRepoScope: false },
    );

    let targetBranch = opts.branch;
    if (!targetBranch) {
      const { stdout } = await this.runCommand(rootDir, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      targetBranch = stdout.trim() || project.defaultBranch || "main";
    }
    branchName(targetBranch);

    emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_PROGRESS, {
      projectId,
      operation: "pull",
      phase: "pulling",
      message: `Pulling origin/${targetBranch}...`,
    });

    const args = ["pull"];
    if (opts.rebase) args.push("--rebase");
    args.push("origin", targetBranch);

    try {
      const { stdout, stderr } = await this.runCommand(rootDir, args, execOptions);
      const status = await this.getStatus(projectId, userId);
      await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);

      emitGitTransport(projectId, GIT_SOCKET_EVENTS.OPERATION_COMPLETED, {
        projectId,
        operation: "pull",
        branch: targetBranch,
      });

      return {
        success: true,
        conflicted: false,
        output: stdout || stderr || "Pull completed successfully",
        status,
      };
    } catch (error) {
      const msg = error.message || "";
      if (
        msg.includes("Authentication failed") ||
        msg.includes("403") ||
        msg.includes("could not read Username")
      ) {
        throw new ServiceError(
          "GitHub authentication failed. Please verify your GitHub access to this repository.",
          403,
          "GIT_AUTH_FAILED",
        );
      }

      const conflictStatus = await this.getStatus(projectId, userId).catch(() => null);
      if (
        conflictStatus &&
        (conflictStatus.conflicts.length > 0 ||
          conflictStatus.operationState !== GIT_REPO_OPERATION_STATE.IDLE ||
          /CONFLICT|Automatic merge failed|fix conflicts/i.test(msg))
      ) {
        await this._recordSnapshotHeadSync(
          rootDir,
          projectId,
          snapshot.id,
          conflictStatus,
        );
        return {
          success: false,
          conflicted: true,
          operationState: conflictStatus.operationState,
          conflicts: conflictStatus.conflicts,
          output: msg,
          status: conflictStatus,
        };
      }
      throw error;
    }
  }

  /**
   * VS Code Sync Changes: fetch --prune -> pull (if behind) -> push -u (if ahead or unpushed).
   */
  static async sync(projectId, userId, { rebase = false } = {}) {
    const fetched = await this.fetch(projectId, userId, { prune: true, tags: true });
    let status = fetched.status;
    let pullResult = null;
    let pushResult = null;

    if (status.behind > 0 || status.tracking) {
      pullResult = await this.pull(projectId, userId, { branch: status.branch, rebase });
      if (pullResult.conflicted) {
        return {
          success: false,
          conflicted: true,
          conflicts: pullResult.conflicts,
          pullResult,
          pushResult: null,
          status: pullResult.status,
        };
      }
      status = pullResult.status;
    }

    if (status.ahead > 0 || !status.tracking) {
      pushResult = await this.push(projectId, userId, {
        branch: status.branch,
        setUpstream: true,
      });
      status = pushResult.status;
    }

    return {
      success: true,
      conflicted: false,
      pullResult,
      pushResult,
      status,
    };
  }

  /**
   * Lists local and remote branches with upstream tracking, ahead/behind counts,
   * and last commit summary, while keeping flat `local[]` / `remote[]` string lists.
   */
  static async getBranches(projectId, userId) {
    const { rootDir, project } = await this.getRepoPath(projectId, userId);

    let current = "main";
    try {
      const { stdout } = await this.runCommand(rootDir, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      if (stdout) current = stdout.trim();
    } catch {
      current = project?.defaultBranch || "main";
    }

    const { stdout: branchOutput } = await this.runCommand(rootDir, [
      "branch",
      "-a",
    ]);

    const local = [];
    const remote = [];
    const lines = String(branchOutput || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const cleanName = line.replace(/^\*\s*/, "").trim();
      if (cleanName.startsWith("remotes/origin/")) {
        const remoteName = cleanName.replace(/^remotes\/origin\//, "");
        if (!remoteName.includes("HEAD ->") && !remote.includes(remoteName)) {
          remote.push(remoteName);
        }
      } else if (
        !cleanName.includes("HEAD detached") &&
        !local.includes(cleanName)
      ) {
        local.push(cleanName);
      }
    }

    if (local.length === 0 && current && current !== "HEAD") {
      local.push(current);
    }

    const localBranches = [];
    const remoteBranches = [];
    try {
      const fmt =
        "%(refname)%09%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:iso-strict)%09%(subject)";
      const { stdout: richOut } = await this.runCommand(rootDir, [
        "for-each-ref",
        `--format=${fmt}`,
        "refs/heads",
        "refs/remotes",
      ]);
      for (const row of String(richOut || "").split(/\r?\n/).filter(Boolean)) {
        const [fullRef, shortName, oid, upstream, track, dateIso, ...subjectParts] =
          row.split("\t");
        if (fullRef.startsWith("refs/heads/")) {
          const aheadMatch = track?.match(/ahead (\d+)/);
          const behindMatch = track?.match(/behind (\d+)/);
          localBranches.push({
            name: shortName,
            oid,
            upstream: upstream || null,
            ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0,
            behind: behindMatch ? Number.parseInt(behindMatch[1], 10) : 0,
            lastCommitDate: dateIso || null,
            lastCommitSubject: subjectParts.join("\t"),
            isCurrent: shortName === current,
          });
        } else if (
          fullRef.startsWith("refs/remotes/origin/") &&
          !fullRef.endsWith("/HEAD")
        ) {
          remoteBranches.push({
            name: shortName.replace(/^origin\//, ""),
            fullName: shortName,
            oid,
            lastCommitDate: dateIso || null,
            lastCommitSubject: subjectParts.join("\t"),
          });
        }
      }
    } catch {
      // Fallback gracefully when repo has no refs yet
    }

    return {
      current,
      detached: current === "HEAD",
      defaultBranch: project?.defaultBranch || "main",
      local,
      remote,
      localBranches,
      remoteBranches,
    };
  }

  /**
   * Checks out an existing branch or creates a new branch (with optional auto-stash).
   */
  static async checkout(
    projectId,
    userId,
    branchOrOptions,
    createNewLegacy = false,
  ) {
    const opts =
      typeof branchOrOptions === "string"
        ? { branch: branchOrOptions, createNew: Boolean(createNewLegacy) }
        : branchOrOptions || {};

    const cleanBranch = branchName(opts.branch)?.trim();
    if (!cleanBranch) {
      throw new ServiceError("Branch name is required", 400);
    }
    if (opts.fromRef) sanitizeGitRef(opts.fromRef, "base ref");

    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);

    let stashed = false;
    if (opts.stashDirty) {
      const pre = await this.getStatus(projectId, userId);
      if (!pre.clean) {
        await this.runCommand(rootDir, [
          "stash",
          "push",
          "--include-untracked",
          "-m",
          `covai-auto-stash before checkout ${cleanBranch}`,
        ]);
        stashed = true;
      }
    }

    if (opts.createNew) {
      const args = ["checkout", "-b", cleanBranch];
      if (opts.fromRef) args.push(opts.fromRef.trim());
      await this.runCommand(rootDir, args);
    } else {
      try {
        await this.runCommand(rootDir, ["checkout", cleanBranch]);
      } catch {
        const remoteRef = cleanBranch.startsWith("origin/")
          ? cleanBranch
          : `origin/${cleanBranch}`;
        const localName = cleanBranch.replace(/^origin\//, "");
        await this.runCommand(rootDir, [
          "checkout",
          "-b",
          localName,
          "--track",
          remoteRef,
        ]).catch(async () => {
          await this.runCommand(rootDir, ["checkout", localName]);
        });
      }
    }

    const branches = await this.getBranches(projectId, userId);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return { ...branches, stashed, status };
  }

  static async renameBranch(projectId, userId, oldName, newName) {
    const cleanOld = branchName(oldName)?.trim();
    const cleanNew = branchName(newName)?.trim();
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["branch", "-m", cleanOld, cleanNew]);
    const branches = await this.getBranches(projectId, userId);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return branches;
  }

  static async deleteBranch(
    projectId,
    userId,
    name,
    { force = false, deleteRemote = false } = {},
  ) {
    const target = branchName(name)?.trim();
    const { rootDir, project, snapshot } = await this.ensureGitRepo(projectId, userId);
    const branches = await this.getBranches(projectId, userId);

    if (target === branches.current) {
      throw new ServiceError(
        "Cannot delete the currently checked out branch",
        400,
        "CANNOT_DELETE_CURRENT_BRANCH",
      );
    }
    const protectedNames = new Set([
      project.defaultBranch || "main",
      "main",
      "master",
    ]);
    if (protectedNames.has(target) && !force) {
      throw new ServiceError(
        `Cannot delete protected default branch '${target}' without force=true`,
        409,
        "PROTECTED_BRANCH",
      );
    }

    await this.runCommand(rootDir, ["branch", force ? "-D" : "-d", target]);

    if (deleteRemote) {
      const { execOptions } = await this._resolveRemoteExecution(
        rootDir,
        project,
        userId,
        { requireRepoScope: true },
      );
      await this.runCommand(rootDir, ["push", "origin", "--delete", target], execOptions);
    }

    const updated = await this.getBranches(projectId, userId);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return updated;
  }

  /**
   * Merges `sourceBranch` into current branch, returning conflicts cleanly instead of 500.
   */
  static async merge(projectId, userId, sourceBranch, { mode = "merge" } = {}) {
    const cleanSource = branchName(sourceBranch)?.trim();
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const author = await resolveGitAuthorIdentity(userId);

    const args = ["merge"];
    if (mode === "no-ff") args.push("--no-ff", "--no-edit");
    else if (mode === "squash") args.push("--squash");
    else args.push("--no-edit");
    args.push(cleanSource);

    try {
      const { stdout, stderr } = await this.runCommand(rootDir, args, { author });
      const status = await this.getStatus(projectId, userId);
      await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
      return {
        merged: true,
        conflicted: false,
        squashStaged: mode === "squash",
        output: stdout || stderr || "Merge completed",
        conflicts: [],
        status,
      };
    } catch (error) {
      const conflictStatus = await this.getStatus(projectId, userId).catch(() => null);
      if (
        conflictStatus &&
        (conflictStatus.conflicts.length > 0 ||
          conflictStatus.operationState === GIT_REPO_OPERATION_STATE.MERGING)
      ) {
        await this._recordSnapshotHeadSync(
          rootDir,
          projectId,
          snapshot.id,
          conflictStatus,
        );
        return {
          merged: false,
          conflicted: true,
          operationState: conflictStatus.operationState,
          conflicts: conflictStatus.conflicts,
          output: error.message,
          status: conflictStatus,
        };
      }
      throw error;
    }
  }

  static async mergeAbort(projectId, userId) {
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["merge", "--abort"]);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  static async mergeContinue(projectId, userId) {
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const author = await resolveGitAuthorIdentity(userId);
    const pre = await this.getStatus(projectId, userId);
    if (pre.conflicts.length > 0) {
      throw new ServiceError(
        "Resolve all remaining merge conflicts before completing merge",
        409,
        "GIT_CONFLICT",
        { conflicts: pre.conflicts },
      );
    }
    await this.runCommand(rootDir, ["commit", "--no-edit"], { author });
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  static async rebase(projectId, userId, targetBranch) {
    const cleanTarget = branchName(targetBranch)?.trim();
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const author = await resolveGitAuthorIdentity(userId);
    try {
      const { stdout, stderr } = await this.runCommand(
        rootDir,
        ["rebase", cleanTarget],
        { author },
      );
      const status = await this.getStatus(projectId, userId);
      await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
      return {
        rebased: true,
        conflicted: false,
        output: stdout || stderr || "Rebase completed",
        conflicts: [],
        status,
      };
    } catch (error) {
      const conflictStatus = await this.getStatus(projectId, userId).catch(() => null);
      if (
        conflictStatus &&
        (conflictStatus.conflicts.length > 0 ||
          conflictStatus.operationState === GIT_REPO_OPERATION_STATE.REBASING)
      ) {
        await this._recordSnapshotHeadSync(
          rootDir,
          projectId,
          snapshot.id,
          conflictStatus,
        );
        return {
          rebased: false,
          conflicted: true,
          operationState: conflictStatus.operationState,
          conflicts: conflictStatus.conflicts,
          output: error.message,
          status: conflictStatus,
        };
      }
      throw error;
    }
  }

  static async rebaseAbort(projectId, userId) {
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["rebase", "--abort"]);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  static async rebaseContinue(projectId, userId) {
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const author = await resolveGitAuthorIdentity(userId);
    const { stdout, stderr } = await this.runCommand(
      rootDir,
      ["rebase", "--continue"],
      { author, env: { GIT_EDITOR: "true" } },
    );
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return { output: stdout || stderr, status };
  }

  /**
   * Returns 3-way conflict details (`base`, `ours`, `theirs`, `working`) for conflicted files.
   */
  static async getConflicts(projectId, userId) {
    const status = await this.getStatus(projectId, userId);
    if (!status.hasGit || status.conflicts.length === 0) {
      return { operationState: status.operationState, conflicts: [] };
    }

    const { rootDir } = await this.getRepoPath(projectId, userId);
    const readStage = async (stageNum, filePath) => {
      try {
        const { stdout } = await this.runCommand(
          rootDir,
          ["show", `:${stageNum}:${filePath}`],
          { rawOutput: true },
        );
        return stdout;
      } catch {
        return null;
      }
    };

    const detailed = [];
    for (const conflict of status.conflicts) {
      const { target } = resolveContainedDiskFile(rootDir, conflict.path);
      const working = fs.existsSync(target)
        ? fs.readFileSync(target, "utf8")
        : "";
      const [base, ours, theirs] = await Promise.all([
        readStage(1, conflict.path),
        readStage(2, conflict.path),
        readStage(3, conflict.path),
      ]);

      detailed.push({
        ...conflict,
        language: inferLanguageFromPath(conflict.path),
        base,
        ours,
        theirs,
        working,
      });
    }

    return {
      operationState: status.operationState,
      conflicts: detailed,
    };
  }

  /**
   * Resolves a merge/rebase conflict (`ours`, `theirs`, `both`, `manual`) and stages the result.
   */
  static async resolveConflict(
    projectId,
    userId,
    { filePath, resolution, manualContent },
  ) {
    const safePath = fileName(filePath);
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const { target } = resolveContainedDiskFile(rootDir, safePath);

    const readStage = async (stageNum) => {
      try {
        const { stdout } = await this.runCommand(
          rootDir,
          ["show", `:${stageNum}:${safePath}`],
          { rawOutput: true },
        );
        return stdout;
      } catch {
        return null;
      }
    };

    if (resolution === "manual") {
      if (typeof manualContent !== "string") {
        throw new ServiceError(
          "manualContent must be provided for manual conflict resolution",
          400,
          "INVALID_CONFLICT_CONTENT",
        );
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, manualContent, "utf8");
      await this.runCommand(rootDir, ["add", "--", safePath]);
    } else if (resolution === "ours" || resolution === "theirs") {
      const content = await readStage(resolution === "ours" ? 2 : 3);
      if (content === null) {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
        await this.runCommand(rootDir, ["rm", "-f", "--", safePath]).catch(() => {});
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf8");
        await this.runCommand(rootDir, ["add", "--", safePath]);
      }
    } else if (resolution === "both") {
      const ours = await readStage(2);
      const theirs = await readStage(3);
      const combined =
        ours !== null && theirs !== null
          ? ours === theirs
            ? ours
            : `${ours}${ours.endsWith("\n") ? "" : "\n"}${theirs}`
          : ours ?? theirs ?? "";
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, combined, "utf8");
      await this.runCommand(rootDir, ["add", "--", safePath]);
    } else {
      throw new ServiceError("Unsupported conflict resolution mode", 400);
    }

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  /**
   * Sets clean HTTPS GitHub remote URL on `origin`.
   */
  static async setRemoteUrl(projectId, userId, repoUrl) {
    const { cleanUrl, webUrl } = normalizeCleanGithubUrl(repoUrl);

    const active = preparedGit.getStore();
    if (active) active.repo.project.repoUrl = webUrl;

    await stagePreparedPublication((tx) =>
      tx.project.update({
        where: { id: projectId },
        data: { repoUrl: webUrl },
      }),
    );

    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["remote", "set-url", "origin", cleanUrl]).catch(
      async () => {
        await this.runCommand(rootDir, ["remote", "add", "origin", cleanUrl]);
      },
    );

    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  /**
   * Returns rich commit log with parent SHAs and refs for SVG Commit Graph rendering.
   */
  static async getLog(projectId, userId, limitOrOptions = 25) {
    const opts =
      typeof limitOrOptions === "number"
        ? { limit: limitOrOptions }
        : limitOrOptions || {};

    const limit = Number(opts.limit ?? 25);
    const skip = Number(opts.skip ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > GIT_LIMITS.MAX_LOG_LIMIT) {
      throw new ServiceError(`Log limit must be 1-${GIT_LIMITS.MAX_LOG_LIMIT}`, 400);
    }
    if (!Number.isInteger(skip) || skip < 0) {
      throw new ServiceError("Log skip must be non-negative", 400);
    }

    const { rootDir } = await this.getRepoPath(projectId, userId);
    if (!fs.existsSync(path.join(rootDir, ".git"))) {
      return [];
    }

    const args = [
      "log",
      `--max-count=${limit}`,
      `--skip=${skip}`,
      "--date=relative",
      "--format=%x1e%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%ar%x1f%D%x1f%s%x1f%b",
    ];
    if (opts.branch) args.push(branchName(opts.branch));
    if (opts.search) args.push(`--grep=${String(opts.search).trim()}`, "-i");
    if (opts.author) args.push(`--author=${String(opts.author).trim()}`);
    if (opts.filePath) {
      const safeFile = fileName(opts.filePath);
      args.push("--follow", "--", safeFile);
    }

    try {
      const { stdout } = await this.runCommand(rootDir, args, { rawOutput: true });
      return parseGitLogRecords(stdout);
    } catch {
      return [];
    }
  }

  /**
   * Returns metadata and changed files for a specific commit.
   */
  static async getCommitDetail(projectId, userId, hash) {
    const cleanHash = sanitizeGitRef(hash, "commit hash");
    const { rootDir } = await this.getRepoPath(projectId, userId);

    const { stdout: metaRaw } = await this.runCommand(
      rootDir,
      [
        "show",
        "-s",
        "--date=relative",
        "--format=%x1e%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%ar%x1f%D%x1f%s%x1f%b",
        cleanHash,
      ],
      { rawOutput: true },
    );
    const meta = parseGitLogRecords(metaRaw)[0];
    if (!meta) {
      throw new ServiceError("Commit not found", 404, "COMMIT_NOT_FOUND");
    }

    const { stdout: statusRaw } = await this.runCommand(
      rootDir,
      ["diff-tree", "--no-commit-id", "--name-status", "--root", "-r", "-M", cleanHash],
      { rawOutput: true },
    );
    const { stdout: numstatRaw } = await this.runCommand(
      rootDir,
      ["diff-tree", "--no-commit-id", "--numstat", "--root", "-r", "-M", cleanHash],
      { rawOutput: true },
    );

    const numstats = new Map();
    for (const line of String(numstatRaw || "").split(/\r?\n/).filter(Boolean)) {
      const [ins, del, ...rest] = line.split("\t");
      const filePart = normalizePosixPath(rest.pop() || "");
      numstats.set(filePart, {
        isBinary: ins === "-" || del === "-",
        insertions: ins === "-" ? 0 : Number.parseInt(ins, 10) || 0,
        deletions: del === "-" ? 0 : Number.parseInt(del, 10) || 0,
      });
    }

    const files = [];
    for (const line of String(statusRaw || "").split(/\r?\n/).filter(Boolean)) {
      const parts = line.split("\t");
      const code = parts[0]?.[0] || "M";
      if (code === "R" || code === "C") {
        const origPath = normalizePosixPath(parts[1]);
        const nextPath = normalizePosixPath(parts[2]);
        const stat = numstats.get(nextPath) || {
          isBinary: false,
          insertions: 0,
          deletions: 0,
        };
        files.push({ path: nextPath, origPath, status: code, ...stat });
      } else {
        const filePath = normalizePosixPath(parts[1]);
        const stat = numstats.get(filePath) || {
          isBinary: false,
          insertions: 0,
          deletions: 0,
        };
        files.push({ path: filePath, status: code, ...stat });
      }
    }

    return { ...meta, files };
  }

  static async revertCommit(projectId, userId, hash) {
    const cleanHash = sanitizeGitRef(hash, "commit hash");
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const author = await resolveGitAuthorIdentity(userId);
    try {
      const { stdout, stderr } = await this.runCommand(
        rootDir,
        ["revert", "--no-edit", cleanHash],
        { author },
      );
      const status = await this.getStatus(projectId, userId);
      await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
      return { success: true, conflicted: false, output: stdout || stderr, status };
    } catch (error) {
      const conflictStatus = await this.getStatus(projectId, userId).catch(() => null);
      if (
        conflictStatus &&
        (conflictStatus.conflicts.length > 0 ||
          conflictStatus.operationState === GIT_REPO_OPERATION_STATE.REVERTING)
      ) {
        await this._recordSnapshotHeadSync(
          rootDir,
          projectId,
          snapshot.id,
          conflictStatus,
        );
        return {
          success: false,
          conflicted: true,
          conflicts: conflictStatus.conflicts,
          status: conflictStatus,
        };
      }
      throw error;
    }
  }

  static async cherryPickCommit(projectId, userId, hash) {
    const cleanHash = sanitizeGitRef(hash, "commit hash");
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const author = await resolveGitAuthorIdentity(userId);
    try {
      const { stdout, stderr } = await this.runCommand(
        rootDir,
        ["cherry-pick", cleanHash],
        { author },
      );
      const status = await this.getStatus(projectId, userId);
      await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
      return { success: true, conflicted: false, output: stdout || stderr, status };
    } catch (error) {
      const conflictStatus = await this.getStatus(projectId, userId).catch(() => null);
      if (
        conflictStatus &&
        (conflictStatus.conflicts.length > 0 ||
          conflictStatus.operationState === GIT_REPO_OPERATION_STATE.CHERRY_PICKING)
      ) {
        await this._recordSnapshotHeadSync(
          rootDir,
          projectId,
          snapshot.id,
          conflictStatus,
        );
        return {
          success: false,
          conflicted: true,
          conflicts: conflictStatus.conflicts,
          status: conflictStatus,
        };
      }
      throw error;
    }
  }

  static async reset(projectId, userId, { targetRef = "HEAD", mode = "mixed" } = {}) {
    const cleanRef = sanitizeGitRef(targetRef, "target reference");
    if (!["soft", "mixed", "hard"].includes(mode)) {
      throw new ServiceError("Invalid reset mode", 400);
    }
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["reset", `--${mode}`, cleanRef]);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return status;
  }

  /**
   * Reads a file buffer at any Git ref/index spec (returns `{ exists, isBinary, isTooLarge, text }`).
   */
  static async getFileAtRef(projectId, userId, { filePath, ref = "HEAD" }) {
    const safePath = fileName(filePath);
    const safeRef = sanitizeGitRef(ref, "git reference");
    const { rootDir } = await this.getRepoPath(projectId, userId);
    const spec = safeRef.endsWith(":") ? `${safeRef}${safePath}` : `${safeRef}:${safePath}`;

    try {
      const { stdout } = await this.runCommand(rootDir, ["show", spec], {
        encoding: "buffer",
        rawOutput: true,
      });
      const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || "");
      const isTooLarge = buf.length > GIT_LIMITS.MAX_DIFF_BYTES;
      const isBinary = detectBinaryBuffer(buf);
      return {
        exists: true,
        isBinary,
        isTooLarge,
        byteSize: buf.length,
        content: isBinary || isTooLarge ? "" : buf.toString("utf8"),
      };
    } catch {
      return {
        exists: false,
        isBinary: false,
        isTooLarge: false,
        byteSize: 0,
        content: "",
      };
    }
  }

  /**
   * Returns before/after pair + unified diff hunks for Monaco DiffEditor
   * (supports working tree, untracked files, staged index, and historical commits).
   */
  static async getDiffPair(
    projectId,
    userId,
    { filePath, mode = "working", commitHash, parentHash, origPath } = {},
  ) {
    const safePath = fileName(filePath);
    const safeOrigPath = origPath ? fileName(origPath) : safePath;
    const { rootDir } = await this.getRepoPath(projectId, userId);
    const language = inferLanguageFromPath(safePath);

    const readBlob = async (refSpec) => {
      try {
        const { stdout } = await this.runCommand(rootDir, ["show", refSpec], {
          encoding: "buffer",
          rawOutput: true,
        });
        const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || "");
        return { exists: true, buf };
      } catch {
        return { exists: false, buf: Buffer.alloc(0) };
      }
    };

    const readWorkingDisk = (relPath) => {
      const { target } = resolveContainedDiskFile(rootDir, relPath);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return { exists: false, buf: Buffer.alloc(0) };
      }
      return { exists: true, buf: fs.readFileSync(target) };
    };

    let originalBlob = { exists: false, buf: Buffer.alloc(0) };
    let modifiedBlob = { exists: false, buf: Buffer.alloc(0) };
    let originalLabel = "Original";
    let modifiedLabel = "Modified";
    let unifiedDiff = "";

    if (mode === "working") {
      const isTracked = await this.runCommand(rootDir, [
        "ls-files",
        "--error-unmatch",
        "--",
        safePath,
      ])
        .then(() => true)
        .catch(() => false);

      modifiedBlob = readWorkingDisk(safePath);
      modifiedLabel = "Working Tree";

      if (isTracked) {
        const inIndex = await readBlob(`:0:${safePath}`);
        originalBlob = inIndex.exists ? inIndex : await readBlob(`HEAD:${safePath}`);
        originalLabel = inIndex.exists ? "Staged Index" : "HEAD";
        const { stdout } = await this.runCommand(
          rootDir,
          ["diff", "--no-color", "-U3", "--", safePath],
          { rawOutput: true },
        ).catch(() => ({ stdout: "" }));
        unifiedDiff = stdout || "";
      } else {
        originalLabel = "New File (Untracked)";
      }
    } else if (mode === "staged") {
      originalBlob = await readBlob(`HEAD:${safeOrigPath}`);
      modifiedBlob = await readBlob(`:0:${safePath}`);
      originalLabel = originalBlob.exists ? "HEAD" : "Empty";
      modifiedLabel = modifiedBlob.exists ? "Staged Index" : "Deleted";

      const hasHead = Boolean(await this._hasHeadCommit(rootDir));
      const { stdout } = await this.runCommand(
        rootDir,
        hasHead
          ? ["diff", "--cached", "--no-color", "-U3", "--", safePath]
          : ["diff", "--no-color", "-U3", EMPTY_TREE_OID, "--cached", "--", safePath],
        { rawOutput: true },
      ).catch(() => ({ stdout: "" }));
      unifiedDiff = stdout || "";
    } else if (mode === "commit") {
      const targetCommit = sanitizeGitRef(commitHash, "commit hash");
      const resolvedParent = parentHash
        ? sanitizeGitRef(parentHash, "parent hash")
        : await this.runCommand(rootDir, ["rev-parse", "--verify", `${targetCommit}^`])
            .then((r) => r.stdout.trim())
            .catch(() => EMPTY_TREE_OID);

      originalBlob =
        resolvedParent === EMPTY_TREE_OID
          ? { exists: false, buf: Buffer.alloc(0) }
          : await readBlob(`${resolvedParent}:${safeOrigPath}`);
      modifiedBlob = await readBlob(`${targetCommit}:${safePath}`);
      originalLabel =
        resolvedParent === EMPTY_TREE_OID
          ? "Initial Commit"
          : resolvedParent.slice(0, 7);
      modifiedLabel = targetCommit.slice(0, 7);

      const { stdout } = await this.runCommand(
        rootDir,
        ["diff", "--no-color", "-U3", resolvedParent, targetCommit, "--", safePath],
        { rawOutput: true },
      ).catch(() => ({ stdout: "" }));
      unifiedDiff = stdout || "";
    } else {
      throw new ServiceError("Unsupported diff mode", 400);
    }

    const isBinary =
      detectBinaryBuffer(originalBlob.buf) || detectBinaryBuffer(modifiedBlob.buf);
    const isTooLarge =
      originalBlob.buf.length > GIT_LIMITS.MAX_DIFF_BYTES ||
      modifiedBlob.buf.length > GIT_LIMITS.MAX_DIFF_BYTES;

    const originalContent =
      isBinary || isTooLarge ? "" : originalBlob.buf.toString("utf8");
    const modifiedContent =
      isBinary || isTooLarge ? "" : modifiedBlob.buf.toString("utf8");

    if (!unifiedDiff && !isBinary && !isTooLarge && originalContent !== modifiedContent) {
      unifiedDiff = createTwoFilesPatch(
        `a/${safeOrigPath}`,
        `b/${safePath}`,
        originalContent,
        modifiedContent,
        "",
        "",
        { context: 3 },
      );
    }

    const parsedHunks = isBinary || isTooLarge
      ? { hunks: [], insertions: 0, deletions: 0 }
      : parseUnifiedDiffHunks(unifiedDiff);

    return {
      filePath: safePath,
      origPath: safeOrigPath !== safePath ? safeOrigPath : null,
      mode,
      language,
      isBinary,
      isTooLarge,
      originalLabel,
      modifiedLabel,
      originalContent,
      modifiedContent,
      stats: {
        insertions: parsedHunks.insertions,
        deletions: parsedHunks.deletions,
      },
      hunks: parsedHunks.hunks,
      unifiedDiff: isBinary || isTooLarge ? "" : unifiedDiff,
    };
  }

  /**
   * Returns unified diff text (with untracked file fallback for compatibility).
   */
  static async getDiff(projectId, userId, filePath, staged = false) {
    if (filePath) fileName(filePath);
    const { rootDir } = await this.getRepoPath(projectId, userId);

    if (filePath && !staged) {
      const tracked = await this.runCommand(rootDir, [
        "ls-files",
        "--error-unmatch",
        "--",
        fileName(filePath),
      ])
        .then(() => true)
        .catch(() => false);
      if (!tracked) {
        const pair = await this.getDiffPair(projectId, userId, {
          filePath,
          mode: "working",
        });
        return pair.unifiedDiff;
      }
    }

    const args = ["diff", "--no-color"];
    if (staged) args.push("--cached");
    if (filePath) args.push("--", fileName(filePath));

    const { stdout } = await this.runCommand(rootDir, args);
    return stdout || "";
  }

  // ---- Stash lifecycle ----

  static async listStashes(projectId, userId) {
    const { rootDir } = await this.getRepoPath(projectId, userId);
    if (!fs.existsSync(path.join(rootDir, ".git"))) return [];

    try {
      const { stdout } = await this.runCommand(
        rootDir,
        ["stash", "list", "--date=relative", "--format=%gd%x1f%H%x1f%ar%x1f%gs"],
        { rawOutput: true },
      );
      return String(stdout || "")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line, idx) => {
          const [selector = `stash@{${idx}}`, hash = "", relativeDate = "", message = ""] =
            line.split("\x1f");
          return {
            index: idx,
            selector: selector.trim(),
            hash: hash.trim(),
            relativeDate: relativeDate.trim(),
            message: message.trim(),
          };
        });
    } catch {
      return [];
    }
  }

  static async stashPush(
    projectId,
    userId,
    { message, includeUntracked = true, stagedOnly = false } = {},
  ) {
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    const args = ["stash", "push"];
    if (stagedOnly) args.push("--staged");
    else if (includeUntracked) args.push("--include-untracked");
    if (message && message.trim()) {
      args.push("-m", message.trim());
    }
    const { stdout } = await this.runCommand(rootDir, args);
    const status = await this.getStatus(projectId, userId);
    const stashes = await this.listStashes(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return { output: stdout, stashes, status };
  }

  static async getStashDiff(projectId, userId, index) {
    const idx = Number.parseInt(index, 10);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new ServiceError("Invalid stash index", 400);
    }
    const { rootDir } = await this.getRepoPath(projectId, userId);
    const { stdout } = await this.runCommand(rootDir, [
      "stash",
      "show",
      "-p",
      "--include-untracked",
      `stash@{${idx}}`,
    ]);
    return { index: idx, diff: stdout || "" };
  }

  static async stashApply(projectId, userId, index) {
    const idx = Number.parseInt(index, 10);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new ServiceError("Invalid stash index", 400);
    }
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["stash", "apply", `stash@{${idx}}`]);
    const status = await this.getStatus(projectId, userId);
    const stashes = await this.listStashes(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return { stashes, status };
  }

  static async stashPop(projectId, userId, index) {
    const idx = Number.parseInt(index, 10);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new ServiceError("Invalid stash index", 400);
    }
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["stash", "pop", `stash@{${idx}}`]);
    const status = await this.getStatus(projectId, userId);
    const stashes = await this.listStashes(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return { stashes, status };
  }

  static async stashDrop(projectId, userId, index) {
    const idx = Number.parseInt(index, 10);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new ServiceError("Invalid stash index", 400);
    }
    const { rootDir, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["stash", "drop", `stash@{${idx}}`]);
    const status = await this.getStatus(projectId, userId);
    const stashes = await this.listStashes(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return { stashes, status };
  }

  // ---- Tags lifecycle ----

  static async listTags(projectId, userId) {
    const { rootDir } = await this.getRepoPath(projectId, userId);
    if (!fs.existsSync(path.join(rootDir, ".git"))) return [];

    try {
      const { stdout } = await this.runCommand(rootDir, [
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname:short)%09%(objectname:short)%09%(creatordate:iso-strict)%09%(subject)",
        "refs/tags",
      ]);
      return String(stdout || "")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [name = "", oid = "", createdAt = "", ...msg] = line.split("\t");
          return {
            name: name.trim(),
            oid: oid.trim(),
            createdAt: createdAt.trim() || null,
            message: msg.join("\t").trim(),
          };
        });
    } catch {
      return [];
    }
  }

  static async createTag(
    projectId,
    userId,
    { name, targetRef = "HEAD", message, pushAfter = false },
  ) {
    const cleanTag = tagName(name)?.trim();
    const cleanRef = sanitizeGitRef(targetRef || "HEAD", "target ref");
    const { rootDir, project, snapshot } = await this.ensureGitRepo(projectId, userId);
    const author = await resolveGitAuthorIdentity(userId);

    const args = ["tag"];
    if (message && message.trim()) {
      args.push("-a", cleanTag, "-m", message.trim(), cleanRef);
    } else {
      args.push(cleanTag, cleanRef);
    }
    await this.runCommand(rootDir, args, { author });

    if (pushAfter) {
      const { execOptions } = await this._resolveRemoteExecution(
        rootDir,
        project,
        userId,
        { requireRepoScope: true },
      );
      await this.runCommand(rootDir, ["push", "origin", cleanTag], execOptions);
    }

    const tags = await this.listTags(projectId, userId);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return { tag: tags.find((t) => t.name === cleanTag) || { name: cleanTag }, tags };
  }

  static async pushTag(projectId, userId, name) {
    const cleanTag = tagName(name)?.trim();
    const { rootDir, project } = await this.ensureGitRepo(projectId, userId);
    const { execOptions } = await this._resolveRemoteExecution(
      rootDir,
      project,
      userId,
      { requireRepoScope: true },
    );
    await this.runCommand(rootDir, ["push", "origin", cleanTag], execOptions);
    return { pushed: true, name: cleanTag };
  }

  static async deleteTag(projectId, userId, name, { deleteRemote = false } = {}) {
    const cleanTag = tagName(name)?.trim();
    const { rootDir, project, snapshot } = await this.ensureGitRepo(projectId, userId);
    await this.runCommand(rootDir, ["tag", "-d", cleanTag]);

    if (deleteRemote) {
      const { execOptions } = await this._resolveRemoteExecution(
        rootDir,
        project,
        userId,
        { requireRepoScope: true },
      );
      await this.runCommand(
        rootDir,
        ["push", "origin", `:refs/tags/${cleanTag}`],
        execOptions,
      );
    }

    const tags = await this.listTags(projectId, userId);
    const status = await this.getStatus(projectId, userId);
    await this._recordSnapshotHeadSync(rootDir, projectId, snapshot.id, status);
    return { tags, status };
  }

  // ---- GitHub Pull Requests & CI Checks ----

  static async listPullRequests(projectId, userId, { state = "open" } = {}) {
    const { project } = await this.getRepoPath(projectId, userId);
    if (!project.repoUrl) {
      throw new ServiceError("Repository is not linked to GitHub", 400, "GIT_REMOTE_MISSING");
    }
    return GitHubPlatformService.listPullRequests(userId, project.repoUrl, { state });
  }

  static async createPullRequest(projectId, userId, payload) {
    await resolveProjectAccess({ projectId, userId, capability: "integrations.write" });
    const { project } = await this.getRepoPath(projectId, userId);
    if (!project.repoUrl) {
      throw new ServiceError("Repository is not linked to GitHub", 400, "GIT_REMOTE_MISSING");
    }
    return GitHubPlatformService.createPullRequest(userId, project.repoUrl, payload);
  }

  static async getCommitChecks(projectId, userId, ref = "HEAD") {
    const { project, rootDir } = await this.getRepoPath(projectId, userId);
    if (!project.repoUrl) {
      throw new ServiceError("Repository is not linked to GitHub", 400, "GIT_REMOTE_MISSING");
    }
    let resolvedRef = ref;
    if (!resolvedRef || resolvedRef === "HEAD") {
      resolvedRef = (await this._hasHeadCommit(rootDir)) || project.defaultBranch || "main";
    }
    return GitHubPlatformService.getCommitChecks(userId, project.repoUrl, resolvedRef);
  }

  /**
   * Read-only diagnostic git command runner (strictly allowlisted).
   */
  static async runGitCommand(projectId, command, args = [], userId) {
    const safeCommands = new Set(["status", "log", "diff", "branch"]);
    if (
      !safeCommands.has(command) ||
      !Array.isArray(args) ||
      args.length > 20 ||
      args.some(
        (arg) =>
          typeof arg !== "string" ||
          !/^[\w./:=@ -]{1,200}$/.test(arg) ||
          /^(?:-c|--config|--exec|--output|--ext-diff|--textconv|--no-index)/.test(arg),
      )
    ) {
      throw new ServiceError("Use the dedicated Git action for this command", 400);
    }
    if (command === "branch") {
      const readFlags = new Set([
        "--show-current",
        "--list",
        "-a",
        "--all",
        "-r",
        "--remotes",
        "-v",
        "-vv",
        "--verbose",
        "--no-color",
      ]);
      if (!args.every((arg) => readFlags.has(arg))) {
        throw new ServiceError(
          "Use the dedicated checkout action to create or change a branch",
          400,
        );
      }
    }
    const { rootDir } = await this.getRepoPath(projectId, userId);
    const { stdout, stderr } = await this.runCommand(rootDir, [command, ...args]);
    return stdout || stderr || "";
  }
}

// Mutating operations split strictly by capability (`vcs.local` for OWNER+EDITOR
// safe local operations vs `integrations.write` for OWNER remote/workspace operations)
// and serialized per project through `withProjectVcsLock` + `withPreparedProjectWorkspace`.
const LOCAL_VCS_MUTATIONS = [
  "stageFiles",
  "unstageFiles",
  "stageHunk",
  "unstageHunk",
  "revertHunk",
  "discardChanges",
  "commit",
  "undoCommit",
  "addGitignorePattern",
  "resolveConflict",
  "stashPush",
  "stashApply",
  "stashPop",
  "stashDrop",
];

const INTEGRATION_VCS_MUTATIONS = [
  "ensureGitRepo",
  "initRepo",
  "setRemoteUrl",
  "publishToGitHub",
  "fetch",
  "pull",
  "push",
  "sync",
  "checkout",
  "renameBranch",
  "deleteBranch",
  "merge",
  "mergeAbort",
  "mergeContinue",
  "rebase",
  "rebaseAbort",
  "rebaseContinue",
  "revertCommit",
  "cherryPickCommit",
  "reset",
  "createTag",
  "pushTag",
  "deleteTag",
];

for (const [capability, methods] of [
  ["vcs.local", LOCAL_VCS_MUTATIONS],
  ["integrations.write", INTEGRATION_VCS_MUTATIONS],
]) {
  for (const method of methods) {
    const original = GitService[method];
    GitService[method] = async function (projectId, userId, ...args) {
      if (method === "discardChanges") {
        if (typeof args[0] === "string" && args[0] !== "all") fileName(args[0]);
      } else if (["stageHunk", "unstageHunk", "revertHunk"].includes(method)) {
        fileName(args[0]);
      } else if (method === "resolveConflict") {
        if (args[0]?.filePath) fileName(args[0].filePath);
      } else if (["checkout", "pull", "push"].includes(method)) {
        const b = typeof args[0] === "string" ? args[0] : args[0]?.branch;
        if (b !== undefined) branchName(b);
      } else if (method === "renameBranch") {
        branchName(args[0]);
        branchName(args[1]);
      } else if (method === "deleteBranch") {
        branchName(args[0]);
      } else if (method === "merge") {
        branchName(args[0]);
      } else if (method === "rebase") {
        branchName(args[0]);
      } else if (["createTag", "pushTag", "deleteTag"].includes(method)) {
        const t = typeof args[0] === "string" ? args[0] : args[0]?.name;
        if (t !== undefined) tagName(t);
      }

      if (preparedGit.getStore()) {
        return original.call(this, projectId, userId, ...args);
      }

      const effectiveCapability =
        method === "commit" && (args[0]?.pushAfter || args[0]?.syncAfter)
          ? "integrations.write"
          : capability;

      const repo = await this.getRepoPath(projectId, userId);
      await resolveProjectAccess({
        projectId,
        userId,
        capability: effectiveCapability,
      });

      const dotGit = path.join(repo.rootDir, ".git");
      if (
        fs.existsSync(dotGit) &&
        (!fs.lstatSync(dotGit).isDirectory() || fs.lstatSync(dotGit).isSymbolicLink())
      ) {
        throw new ServiceError(
          "Linked Git worktrees are not supported for project source publication",
          409,
          "UNSUPPORTED_GIT_WORKTREE",
        );
      }

      return withProjectVcsLock(projectId, async () => {
        checkStaleGitIndexLock(repo.rootDir, { removeStale: true });
        return withPreparedProjectWorkspace(
          {
            projectId,
            snapshotId: repo.snapshot.id,
            userId,
            capability: effectiveCapability,
            expectedWorkspaceRevision: repo.project.workspaceRevision,
            type: `GIT_${method.toUpperCase()}`,
            input: { method },
            includeGitMetadata: true,
          },
          (context) =>
            preparedGit.run(
              {
                projectId,
                userId,
                repo: {
                  ...repo,
                  rootDir: context.rootDir,
                  snapshot: {
                    ...repo.snapshot,
                    rootDir: path.join(context.rootDir, context.analysisRelative),
                    storagePath: context.rootDir,
                  },
                },
              },
              () => original.call(this, projectId, userId, ...args),
            ),
        );
      });
    };
  }
}
