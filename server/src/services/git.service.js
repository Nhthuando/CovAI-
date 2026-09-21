import { exec } from "child_process";
import util from "util";
import path from "path";
import fs from "fs";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { GitHubRepositoryAccessService } from "./github.service.js";

const execAsync = util.promisify(exec);

export class GitService {
  /**
   * Resolves the actual project root directory from the latest snapshot
   */
  static async getRepoPath(projectId, userId) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...(userId ? { ownerId: userId } : {}),
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!project) {
      throw new ServiceError(
        "Project not found or you don't have permission",
        404,
      );
    }

    const snapshot = await prisma.projectSnapshot.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!snapshot || !snapshot.rootDir) {
      throw new ServiceError(
        "Project snapshot not ready or not extracted yet",
        404,
      );
    }

    const isGitHubProject = snapshot.source === "GITHUB" || !!project.repoUrl;

    const rootDir = path.resolve(snapshot.rootDir);
    if (!fs.existsSync(rootDir)) {
      throw new ServiceError(
        `Project directory not found on disk: ${rootDir}`,
        404,
      );
    }

    return { rootDir, project, snapshot, isGitHubProject };
  }

  /**
   * Helper to execute git command in the project directory
   */
  static async runCommand(rootDir, commandStr, envExtra = {}) {
    try {
      const { stdout, stderr } = await execAsync(commandStr, {
        cwd: rootDir,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          ...envExtra,
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      const errMsg = error.stderr || error.stdout || error.message;
      throw new ServiceError(errMsg.trim(), 500);
    }
  }

  /**
   * Ensures a .git directory exists and is properly configured
   */
  static async ensureGitRepo(projectId, userId) {
    const { rootDir, project, snapshot, isGitHubProject } =
      await this.getRepoPath(projectId, userId);

    if (!isGitHubProject) {
      throw new ServiceError(
        "Git operations are only available for repositories imported from GitHub. This project was uploaded from a compressed file.",
        403,
      );
    }

    const gitDir = path.join(rootDir, ".git");

    const user = project.owner;
    const authorName = user?.name || "GitHub Developer";
    const authorEmail = user?.email || "developer@github.com";

    const defaultBranch = project.defaultBranch || "main";

    if (!fs.existsSync(gitDir)) {
      // Initialize fresh git repo
      await this.runCommand(rootDir, `git init -b "${defaultBranch}"`).catch(
        async () => {
          await this.runCommand(rootDir, "git init");
        },
      );
      await this.runCommand(rootDir, `git config user.name "${authorName}"`);
      await this.runCommand(rootDir, `git config user.email "${authorEmail}"`);
      await this.runCommand(rootDir, "git config commit.gpgsign false");

      // If project has a repoUrl or was imported from GitHub, link origin and fetch
      if (project.repoUrl) {
        let remoteUrl = project.repoUrl;
        try {
          const token =
            await GitHubRepositoryAccessService.getGitHubToken(userId);
          if (token && remoteUrl.includes("github.com")) {
            const match = remoteUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (match) {
              const owner = match[1];
              const repo = match[2].replace(/\.git$/, "");
              remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
            }
          }
        } catch (_) {}

        try {
          await this.runCommand(
            rootDir,
            `git remote add origin "${remoteUrl}"`,
          );
          await this.runCommand(rootDir, "git fetch origin").catch(() => {});
          await this.runCommand(
            rootDir,
            `git branch -M "${defaultBranch}"`,
          ).catch(() => {});
          await this.runCommand(
            rootDir,
            `git reset origin/"${defaultBranch}"`,
          ).catch(() => {});
          await this.runCommand(
            rootDir,
            `git branch --set-upstream-to=origin/"${defaultBranch}" "${defaultBranch}"`,
          ).catch(() => {});
        } catch (_) {}
      }
    } else {
      // Ensure config exists
      await this.runCommand(
        rootDir,
        `git config user.name "${authorName}"`,
      ).catch(() => {});
      await this.runCommand(
        rootDir,
        `git config user.email "${authorEmail}"`,
      ).catch(() => {});
      await this.runCommand(rootDir, "git config commit.gpgsign false").catch(
        () => {},
      );

      // If project has no repoUrl in DB, check if .git has an origin remote
      if (!project.repoUrl) {
        try {
          const { stdout: originUrl } = await this.runCommand(
            rootDir,
            "git remote get-url origin",
          );
          if (originUrl && originUrl.includes("github.com")) {
            const cleanUrl = originUrl.replace(
              /https:\/\/[^@]+@github\.com\//,
              "https://github.com/",
            );
            await prisma.project
              .update({
                where: { id: projectId },
                data: { repoUrl: cleanUrl },
              })
              .catch(() => {});
            project.repoUrl = cleanUrl;
          }
        } catch (_) {}
      }

      // Set up / update remote origin if project has a repoUrl
      if (project.repoUrl) {
        let remoteUrl = project.repoUrl;
        try {
          const token =
            await GitHubRepositoryAccessService.getGitHubToken(userId);
          if (token && remoteUrl.includes("github.com")) {
            const match = remoteUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (match) {
              const owner = match[1];
              const repo = match[2].replace(/\.git$/, "");
              remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
            }
          }
        } catch (_) {
          // User may not have GitHub linked
        }

        try {
          const { stdout: existingRemote } = await this.runCommand(
            rootDir,
            "git remote",
          );
          if (
            existingRemote
              .split("\n")
              .map((r) => r.trim())
              .includes("origin")
          ) {
            await this.runCommand(
              rootDir,
              `git remote set-url origin "${remoteUrl}"`,
            );
          } else {
            await this.runCommand(
              rootDir,
              `git remote add origin "${remoteUrl}"`,
            );
          }
        } catch (_) {}
      }
    }

    return { rootDir, project };
  }

  /**
   * GET Git status (staged, unstaged, untracked, branch)
   */
  static async getStatus(projectId, userId) {
    const { rootDir, project, snapshot, isGitHubProject } =
      await this.getRepoPath(projectId, userId);

    if (!isGitHubProject) {
      return {
        isGitHubProject: false,
        hasGit: false,
        branch: null,
        tracking: null,
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
        untracked: [],
        clean: true,
        repoUrl: null,
        message:
          "Git operations are only available for repositories imported from GitHub.",
      };
    }

    const gitDir = path.join(rootDir, ".git");

    if (!fs.existsSync(gitDir)) {
      return {
        isGitHubProject: true,
        hasGit: false,
        branch: null,
        tracking: null,
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
        untracked: [],
        clean: true,
        repoUrl: project.repoUrl || null,
      };
    }

    // If project.repoUrl is missing, check if remote origin is configured in git or infer
    let activeRepoUrl = project.repoUrl || null;
    if (!activeRepoUrl) {
      try {
        const { stdout: originUrl } = await this.runCommand(
          rootDir,
          "git remote get-url origin",
        );
        if (originUrl && originUrl.includes("github.com")) {
          activeRepoUrl = originUrl.replace(
            /https:\/\/[^@]+@github\.com\//,
            "https://github.com/",
          );
          await prisma.project
            .update({
              where: { id: projectId },
              data: { repoUrl: activeRepoUrl },
            })
            .catch(() => {});
        }
      } catch (_) {}

      if (!activeRepoUrl && project.owner?.name) {
        activeRepoUrl = `https://github.com/${project.owner.name}/${project.name}`;
        await prisma.project
          .update({
            where: { id: projectId },
            data: { repoUrl: activeRepoUrl },
          })
          .catch(() => {});
        project.repoUrl = activeRepoUrl;
      }
    }

    // Run git status porcelain with branch info
    const { stdout: statusOutput } = await this.runCommand(
      rootDir,
      "git status --porcelain=v1 -b -uall",
    );

    let branch = "main";
    let tracking = null;
    let ahead = 0;
    let behind = 0;

    const staged = [];
    const unstaged = [];
    const untracked = [];

    const lines = statusOutput.split("\n").filter((l) => l.length > 0);

    for (const line of lines) {
      // Branch header line: ## main...origin/main [ahead 1, behind 2]
      if (line.startsWith("##")) {
        const branchPart = line.slice(3).trim();
        if (
          branchPart.includes("No commits yet on") ||
          branchPart.includes("Initial commit on")
        ) {
          branch = branchPart.split(" ").pop();
        } else if (branchPart.includes("...")) {
          const [local, remoteWithStats] = branchPart.split("...");
          branch = local;
          if (remoteWithStats) {
            const parts = remoteWithStats.split(" ");
            tracking = parts[0];
            if (remoteWithStats.includes("ahead")) {
              const m = remoteWithStats.match(/ahead (\d+)/);
              if (m) ahead = parseInt(m[1], 10);
            }
            if (remoteWithStats.includes("behind")) {
              const m = remoteWithStats.match(/behind (\d+)/);
              if (m) behind = parseInt(m[1], 10);
            }
          }
        } else {
          branch = branchPart.split(" ")[0];
        }
        continue;
      }

      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.slice(3).trim().replace(/^"|"$/g, "");

      // Untracked files
      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked.push({
          path: filePath,
          status: "U",
          statusText: "Untracked",
        });
        continue;
      }

      // Staged changes
      if (indexStatus !== " " && indexStatus !== "?") {
        let statusText = "Modified";
        if (indexStatus === "A") statusText = "Added";
        else if (indexStatus === "D") statusText = "Deleted";
        else if (indexStatus === "R") statusText = "Renamed";

        staged.push({
          path: filePath,
          status: indexStatus,
          statusText,
        });
      }

      // Unstaged changes in working tree
      if (workTreeStatus !== " " && workTreeStatus !== "?") {
        let statusText = "Modified";
        if (workTreeStatus === "D") statusText = "Deleted";
        else if (workTreeStatus === "M") statusText = "Modified";

        unstaged.push({
          path: filePath,
          status: workTreeStatus,
          statusText,
        });
      }
    }

    return {
      hasGit: true,
      branch,
      tracking,
      ahead,
      behind,
      staged,
      unstaged,
      untracked,
      clean:
        staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
      repoUrl: activeRepoUrl,
    };
  }

  /**
   * Stage files (git add)
   */
  static async stageFiles(projectId, userId, files) {
    const { rootDir } = await this.ensureGitRepo(projectId, userId);

    if (
      files === "all" ||
      !files ||
      (Array.isArray(files) && files.length === 0)
    ) {
      await this.runCommand(rootDir, "git add -A");
    } else if (Array.isArray(files)) {
      const quoted = files.map((f) => `"${f}"`).join(" ");
      await this.runCommand(rootDir, `git add -- ${quoted}`);
    } else if (typeof files === "string") {
      await this.runCommand(rootDir, `git add -- "${files}"`);
    }

    return this.getStatus(projectId, userId);
  }

  /**
   * Unstage files (git restore --staged or git reset)
   */
  static async unstageFiles(projectId, userId, files) {
    const { rootDir } = await this.ensureGitRepo(projectId, userId);

    if (
      files === "all" ||
      !files ||
      (Array.isArray(files) && files.length === 0)
    ) {
      await this.runCommand(rootDir, "git reset HEAD -- .").catch(async () => {
        await this.runCommand(rootDir, "git restore --staged .").catch(
          () => {},
        );
      });
    } else if (Array.isArray(files)) {
      const quoted = files.map((f) => `"${f}"`).join(" ");
      await this.runCommand(rootDir, `git restore --staged -- ${quoted}`).catch(
        async () => {
          await this.runCommand(rootDir, `git reset HEAD -- ${quoted}`);
        },
      );
    } else if (typeof files === "string") {
      await this.runCommand(
        rootDir,
        `git restore --staged -- "${files}"`,
      ).catch(async () => {
        await this.runCommand(rootDir, `git reset HEAD -- "${files}"`);
      });
    }

    return this.getStatus(projectId, userId);
  }

  /**
   * Discard changes in files
   */
  static async discardChanges(
    projectId,
    userId,
    filePath,
    isUntracked = false,
  ) {
    const { rootDir } = await this.ensureGitRepo(projectId, userId);

    if (isUntracked) {
      const targetPath = path.join(rootDir, filePath);
      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
          fs.rmSync(targetPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(targetPath);
        }
      }
    } else {
      await this.runCommand(rootDir, `git restore -- "${filePath}"`).catch(
        async () => {
          await this.runCommand(rootDir, `git checkout -- "${filePath}"`);
        },
      );
    }

    return this.getStatus(projectId, userId);
  }

  /**
   * Commit staged changes (auto-stages all if nothing staged)
   */
  static async commit(projectId, userId, message) {
    if (!message || message.trim().length === 0) {
      throw new ServiceError("Commit message cannot be empty", 400);
    }

    const { rootDir, project } = await this.ensureGitRepo(projectId, userId);

    // If nothing is staged, auto-stage all changes so commit succeeds
    try {
      const { stdout: diffCached } = await this.runCommand(
        rootDir,
        "git diff --cached --name-only",
      );
      if (!diffCached || diffCached.trim().length === 0) {
        await this.runCommand(rootDir, "git add -A");
      }
    } catch (_) {}

    const user = project.owner;
    const authorName = user?.name || "GitHub Developer";
    const authorEmail = user?.email || "developer@github.com";

    const escapedMsg = message.replace(/"/g, '\\"');
    const { stdout } = await this.runCommand(
      rootDir,
      `git commit --author="${authorName} <${authorEmail}>" -m "${escapedMsg}"`,
    );

    return {
      success: true,
      message: stdout,
      status: await this.getStatus(projectId, userId),
    };
  }

  /**
   * Push branch to remote (authenticated with user's GitHub session)
   */
  static async push(projectId, userId, branch) {
    const { rootDir, project } = await this.ensureGitRepo(projectId, userId);

    // Ensure origin has the latest decrypted GitHub access token
    if (project.repoUrl) {
      try {
        const token =
          await GitHubRepositoryAccessService.getGitHubToken(userId);
        if (token && project.repoUrl.includes("github.com")) {
          const match = project.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
          if (match) {
            const owner = match[1];
            const repo = match[2].replace(/\.git$/, "");
            const authRemoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
            await this.runCommand(
              rootDir,
              `git remote set-url origin "${authRemoteUrl}"`,
            ).catch(async () => {
              await this.runCommand(
                rootDir,
                `git remote add origin "${authRemoteUrl}"`,
              );
            });
          }
        }
      } catch (err) {
        throw new ServiceError(
          "GitHub access token missing or expired. Please re-login with your GitHub account.",
          401,
        );
      }
    }

    let targetBranch = branch;
    if (!targetBranch) {
      const { stdout } = await this.runCommand(
        rootDir,
        "git rev-parse --abbrev-ref HEAD",
      );
      targetBranch = stdout || "main";
    }

    try {
      const { stdout, stderr } = await this.runCommand(
        rootDir,
        `git push -u origin "${targetBranch}"`,
      );

      return {
        success: true,
        output: stdout || stderr || "Push completed successfully",
        status: await this.getStatus(projectId, userId),
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
          "GitHub authentication failed. Please verify that your GitHub account has write access to this repository.",
          403,
        );
      }
      throw error;
    }
  }

  /**
   * Pull changes from remote (authenticated with user's GitHub session)
   */
  static async pull(projectId, userId, branch) {
    const { rootDir, project } = await this.ensureGitRepo(projectId, userId);

    if (project.repoUrl) {
      try {
        const token =
          await GitHubRepositoryAccessService.getGitHubToken(userId);
        if (token && project.repoUrl.includes("github.com")) {
          const match = project.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
          if (match) {
            const owner = match[1];
            const repo = match[2].replace(/\.git$/, "");
            const authRemoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
            await this.runCommand(
              rootDir,
              `git remote set-url origin "${authRemoteUrl}"`,
            ).catch(async () => {
              await this.runCommand(
                rootDir,
                `git remote add origin "${authRemoteUrl}"`,
              );
            });
          }
        }
      } catch (_) {}
    }

    let targetBranch = branch;
    if (!targetBranch) {
      const { stdout } = await this.runCommand(
        rootDir,
        "git rev-parse --abbrev-ref HEAD",
      );
      targetBranch = stdout || "main";
    }

    try {
      const { stdout, stderr } = await this.runCommand(
        rootDir,
        `git pull origin "${targetBranch}"`,
      );

      return {
        success: true,
        output: stdout || stderr || "Pull completed successfully",
        status: await this.getStatus(projectId, userId),
      };
    } catch (error) {
      const msg = error.message || "";
      if (
        msg.includes("Authentication failed") ||
        msg.includes("403") ||
        msg.includes("could not read Username")
      ) {
        throw new ServiceError(
          "GitHub authentication failed. Please verify that your GitHub account has access to this repository.",
          403,
        );
      }
      throw error;
    }
  }

  /**
   * Get list of branches
   */
  static async getBranches(projectId, userId) {
    const { rootDir } = await this.ensureGitRepo(projectId, userId);

    let current = "main";
    try {
      const { stdout } = await this.runCommand(
        rootDir,
        "git rev-parse --abbrev-ref HEAD",
      );
      current = stdout || "main";
    } catch (_) {}

    const { stdout: branchOutput } = await this.runCommand(
      rootDir,
      "git branch -a",
    );
    const local = [];
    const remote = [];

    const lines = branchOutput
      .split("\n")
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

    if (local.length === 0) {
      local.push(current);
    }

    return { current, local, remote };
  }

  /**
   * Checkout or create branch
   */
  static async checkout(projectId, userId, branch, createNew = false) {
    if (!branch || branch.trim().length === 0) {
      throw new ServiceError("Branch name is required", 400);
    }

    const { rootDir } = await this.ensureGitRepo(projectId, userId);
    const cleanBranch = branch.trim();

    if (createNew) {
      await this.runCommand(rootDir, `git checkout -b "${cleanBranch}"`);
    } else {
      try {
        await this.runCommand(rootDir, `git checkout "${cleanBranch}"`);
      } catch (err) {
        // If local branch doesn't exist, try tracking remote branch
        const remoteRef = cleanBranch.startsWith("origin/")
          ? cleanBranch
          : `origin/${cleanBranch}`;
        const localName = cleanBranch.replace(/^origin\//, "");
        await this.runCommand(
          rootDir,
          `git checkout -b "${localName}" --track "${remoteRef}"`,
        ).catch(async () => {
          await this.runCommand(rootDir, `git checkout "${localName}"`);
        });
      }
    }

    return this.getBranches(projectId, userId);
  }

  /**
   * Set or update remote repository URL (e.g. link to GitHub)
   */
  static async setRemoteUrl(projectId, userId, repoUrl) {
    if (!repoUrl || typeof repoUrl !== "string") {
      throw new ServiceError("repoUrl is required", 400);
    }
    const cleanUrl = repoUrl.trim();
    if (!cleanUrl.startsWith("https://github.com/")) {
      throw new ServiceError(
        "Only GitHub URLs (https://github.com/...) are supported",
        400,
      );
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { repoUrl: cleanUrl },
    });

    await this.ensureGitRepo(projectId, userId);
    return this.getStatus(projectId, userId);
  }

  /**
   * Get commit history (log)
   */
  static async getLog(projectId, userId, limit = 25) {
    const { rootDir } = await this.ensureGitRepo(projectId, userId);

    try {
      const { stdout } = await this.runCommand(
        rootDir,
        `git log -n ${limit} --pretty=format:"%H|%h|%an|%ae|%ad|%s" --date=relative`,
      );

      if (!stdout) return [];

      return stdout.split("\n").map((line) => {
        const [hash, shortHash, author, email, date, ...msgParts] =
          line.split("|");
        return {
          hash,
          shortHash,
          author,
          email,
          date,
          message: msgParts.join("|"),
        };
      });
    } catch (e) {
      // Likely no commits yet
      return [];
    }
  }

  /**
   * Get file diff
   */
  static async getDiff(projectId, userId, filePath, staged = false) {
    const { rootDir } = await this.ensureGitRepo(projectId, userId);

    const targetFlag = staged ? "--cached" : "";
    const fileArg = filePath ? `-- "${filePath}"` : "";

    const { stdout } = await this.runCommand(
      rootDir,
      `git diff ${targetFlag} ${fileArg}`,
    );

    return stdout || "";
  }

  /**
   * Generic git command runner (fallback)
   */
  static async runGitCommand(projectId, command, args = [], userId) {
    const { rootDir } = await this.ensureGitRepo(projectId, userId);
    const cmd = `git ${command} ${(args || []).join(" ")}`;
    const { stdout, stderr } = await this.runCommand(rootDir, cmd);
    return stdout || stderr || "";
  }
}
