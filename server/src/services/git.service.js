import { exec } from "child_process";
import util from "util";
import path from "path";
import fs from "fs";
import { ServiceError } from "../utils/serviceError.js";

const execAsync = util.promisify(exec);

export class GitService {
  static getRepoPath(projectId) {
    return path.join(
      process.cwd(),
      "storage",
      "projects",
      projectId,
      "persistent_git",
    );
  }

  static async runGitCommand(projectId, command, args = []) {
    const repoDir = this.getRepoPath(projectId);
    if (!fs.existsSync(repoDir)) {
      console.error(
        `[GitService] Repository directory does not exist: ${repoDir}`,
      );
      throw new ServiceError(
        `Repository not initialized (projectId: ${projectId} | repoDir: ${repoDir})`,
        404,
      );
    }
    try {
      const stat = fs.statSync(repoDir);
      console.log(
        `[GitService] repoDir exists: ${repoDir}, permissions:`,
        stat,
      );
      // Add non-interactive flag to prevent git from hanging on auth prompts
      const cmd = `git ${command} ${args.join(" ")}`;
      console.log(`[GitService] Running command: ${cmd} in ${repoDir}`);
      const { stdout } = await execAsync(cmd, {
        cwd: repoDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      return stdout;
    } catch (error) {
      console.error(
        `[GitService] Command failed: git ${command}`,
        error,
        `cwd=${repoDir}`,
        `projectId=${projectId}`,
      );
      throw new ServiceError(
        `Git command failed: ${error.stderr || error.message} | repoDir: ${repoDir}`,
        500,
      );
    }
  }

  static async initializeRepo(projectId, cloneUrl) {
    const repoDir = this.getRepoPath(projectId);
    if (fs.existsSync(repoDir)) {
      return repoDir;
    }
    fs.mkdirSync(repoDir, { recursive: true });
    await execAsync(`git clone ${cloneUrl} .`, { cwd: repoDir });
    return repoDir;
  }
}
