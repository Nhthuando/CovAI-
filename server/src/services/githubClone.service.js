import fs from "node:fs";
import path from "node:path";
import { ServiceError } from "../utils/serviceError.js";
import { purgeDisallowedSecretFiles } from "../middlewares/upload.middleware.js";
import {
  ensureCovaiGitExcludes,
  execGit,
  normalizeCleanGithubUrl,
  redactGitOutput,
  resolveActingUserGithubToken,
  resolveGitAuthorIdentity,
  sanitizeGitRef,
} from "./gitCredentialHelper.service.js";

/**
 * Service to handle cloning GitHub repositories into local storage
 * using strictly transient HTTP credentials (zero token persistence in `.git/config`).
 */
export class GitHubCloneService {
  /**
   * Clones a GitHub repository to the local storage directory.
   *
   * @param {string|null} userId - The ID of the user requesting the clone.
   * @param {string} projectId - The ID of the project for storage organization.
   * @param {string} owner - GitHub repository owner.
   * @param {string} repo - GitHub repository name.
   * @param {boolean} useAuth - Whether to inject transient GitHub OAuth credentials.
   * @returns {Promise<{localPath: string, commitSha: string, defaultBranch: string, repoUrl: string}>}
   */
  static async cloneRepository(userId, projectId, owner, repo, useAuth = true) {
    const cleanOwner = sanitizeGitRef(owner, "repository owner");
    const cleanRepo = sanitizeGitRef(String(repo || "").replace(/\.git$/i, ""), "repository name");
    const { cleanUrl, webUrl } = normalizeCleanGithubUrl(
      `https://github.com/${cleanOwner}/${cleanRepo}`,
    );

    let accessToken = null;
    if (useAuth) {
      const tokenInfo = await resolveActingUserGithubToken(userId, {
        requireRepoScope: false,
      });
      accessToken = tokenInfo.token;
    }

    const timestamp = Date.now();
    const baseDir = path.join(
      process.cwd(),
      "storage",
      "projects",
      projectId,
      "github",
      timestamp.toString(),
    );
    const repoDir = path.join(baseDir, "repo");
    fs.mkdirSync(repoDir, { recursive: true });

    try {
      await execGit(repoDir, ["clone", cleanUrl, "."], {
        githubToken: accessToken,
        isNetwork: true,
      });

      const { stdout: commitSha } = await execGit(repoDir, ["rev-parse", "HEAD"]);

      let defaultBranch = "main";
      try {
        const { stdout: branchOut } = await execGit(repoDir, [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ]);
        if (branchOut && branchOut.trim() && branchOut.trim() !== "HEAD") {
          defaultBranch = branchOut.trim();
        }
      } catch {
        // Default to main on unborn repositories
      }

      const author = await resolveGitAuthorIdentity(userId, {
        authorName: cleanOwner,
        authorEmail: `${cleanOwner}@users.noreply.github.com`,
      });
      await execGit(repoDir, ["config", "user.name", author.name]).catch(() => {});
      await execGit(repoDir, ["config", "user.email", author.email]).catch(() => {});
      await execGit(repoDir, ["config", "commit.gpgsign", "false"]).catch(() => {});
      await execGit(repoDir, ["config", "core.autocrlf", "false"]).catch(() => {});
      await execGit(repoDir, ["config", "core.quotepath", "false"]).catch(() => {});

      ensureCovaiGitExcludes(repoDir);

      fs.rmSync(path.join(repoDir, "node_modules"), {
        recursive: true,
        force: true,
      });
      purgeDisallowedSecretFiles(repoDir);

      return {
        localPath: repoDir,
        commitSha: commitSha.trim(),
        defaultBranch,
        repoUrl: webUrl,
      };
    } catch (error) {
      if (fs.existsSync(baseDir)) {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }

      if (error instanceof ServiceError && [401, 403].includes(error.statusCode)) {
        throw error;
      }

      const errMsg = redactGitOutput(error?.message || "");
      if (
        errMsg.includes("Authentication failed") ||
        errMsg.includes("could not read Username") ||
        errMsg.includes("terminal prompts disabled") ||
        errMsg.includes("Password authentication is not supported") ||
        errMsg.includes("Invalid username or token") ||
        errMsg.includes("Access denied") ||
        errMsg.includes("Repository not found") ||
        errMsg.includes("not found")
      ) {
        throw new ServiceError("This Repository is private", 400);
      }

      throw new ServiceError(`Clone failed: ${errMsg}`, 500);
    }
  }
}
