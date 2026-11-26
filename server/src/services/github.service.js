import prisma from "../config/prisma.js";
import { decrypt } from "../utils/crypto.js";
import { githubFetch } from "./githubOAuth.service.js";

/**
 * Service to interact with GitHub APIs using the authenticated user's access token.
 */
export class GitHubRepositoryAccessService {
  /**
   * Retrieves the GitHub access token for a given user.
   */
  static async getGitHubToken(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { githubAccessTokenEnc: true },
    });

    if (!user || !user.githubAccessTokenEnc) {
      throw new Error("Missing GitHub token");
    }

    try {
      return decrypt(user.githubAccessTokenEnc);
    } catch {
      return user.githubAccessTokenEnc;
    }
  }

  /**
   * Retrieves repositories for the authenticated user.
   */
  static async getUserRepositories(userId) {
    const accessToken = await this.getGitHubToken(userId);
    let repos = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await githubFetch(
        `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "User-Agent": "CovAI-App",
          },
        },
      );

      if (response.status === 401) {
        throw new Error("Unauthorized GitHub account");
      }

      if (response.status === 403) {
        throw new Error("GitHub API rate limit");
      }

      if (!response.ok) {
        throw new Error("GitHub API unavailable");
      }

      const pageRepos = await response.json();
      if (pageRepos.length === 0) break;

      repos = repos.concat(pageRepos);
      if (pageRepos.length < perPage) break;
      page++;
    }

    repos.sort((a, b) => {
      const timeB = new Date(b.pushed_at || b.updated_at || 0).getTime();
      const timeA = new Date(a.pushed_at || a.updated_at || 0).getTime();
      return timeB - timeA;
    });

    return repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      htmlUrl: repo.html_url,
      pushedAt: repo.pushed_at || null,
      updatedAt: repo.updated_at || null,
    }));
  }
}
