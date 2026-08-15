import prisma from "../config/prisma.js";

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

    // In a real production app, githubAccessTokenEnc should be decrypted here.
    return user.githubAccessTokenEnc;
  }

  /**
   * Retrieves repositories for the authenticated user.
   */
  static async getUserRepositories(userId) {
    const accessToken = await this.getGitHubToken(userId);
    let repos = [];
    let page = 1;
    const perPage = 15;

    while (true) {
      const response = await fetch(
        `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=created&direction=desc`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
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

    return repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      htmlUrl: repo.html_url,
    }));
  }
}
