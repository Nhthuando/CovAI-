import { exec } from "child_process";
import fs from "fs";
import path from "path";
import util from "util";
import { GitHubRepositoryAccessService } from "./github.service.js";
import { ServiceError } from "../utils/serviceError.js";

const execAsync = util.promisify(exec);

/**
 * Service to handle cloning GitHub repositories into local storage.
 */
export class GitHubCloneService {
  /**
   * Clones a GitHub repository to the local storage directory.
   *
   * @param {string} userId - The ID of the user requesting the clone.
   * @param {string} projectId - The ID of the project for storage organization.
   * @param {string} owner - GitHub repository owner.
   * @param {string} repo - GitHub repository name.
   * @returns {Promise<{localPath: string, commitSha: string}>}
   */
  static async cloneRepository(userId, projectId, owner, repo, useAuth = true) {
    let accessToken = null;
    if (useAuth) {
      accessToken = await GitHubRepositoryAccessService.getGitHubToken(userId);
    }

    // Define storage path: storage/projects/{projectId}/github/{timestamp}
    const timestamp = Date.now();
    const baseDir = path.join(
      process.cwd(),
      "storage",
      "projects",
      projectId,
      "github",
      timestamp.toString(),
    );

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const cloneUrl = accessToken
      ? `https://x-access-token:${accessToken}@github.com/${owner}/${repo}.git`
      : `https://github.com/${owner}/${repo}.git`;

    try {
      // 1. Clone repository into a 'repo' subfolder to avoid messing with current directory
      const repoDir = path.join(baseDir, "repo");
      fs.mkdirSync(repoDir, { recursive: true });
      await execAsync(`git clone ${cloneUrl} .`, { cwd: repoDir });

      // 2. Get latest commit SHA from the repo folder
      const { stdout: commitSha } = await execAsync(`git rev-parse HEAD`, {
        cwd: repoDir,
      });

      // Optionally remove .git if you only want source files
      // fs.rmSync(path.join(repoDir, ".git"), { recursive: true, force: true });

      return {
        localPath: repoDir,
        commitSha: commitSha.trim(),
      };
    } catch (error) {
      // Cleanup on failure
      if (fs.existsSync(baseDir)) {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }

      if (error.message.includes("Repository not found")) {
        throw new ServiceError("Repository not found", 404);
      }
      if (error.message.includes("Authentication failed")) {
        throw new ServiceError("Access denied to repository", 403);
      }

      throw new ServiceError(`Clone failed: ${error.message}`, 500);
    }
  }
}
