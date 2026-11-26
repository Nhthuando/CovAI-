import { githubFetch } from "./githubOAuth.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { validateGithubRepoName } from "../../../shared/gitProtocol.js";
import {
  normalizeCleanGithubUrl,
  resolveActingUserGithubToken,
} from "./gitCredentialHelper.service.js";

const GITHUB_ACCEPT = "application/vnd.github.v3+json";
const GITHUB_USER_AGENT = "CovAI-App";

function buildGithubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: GITHUB_ACCEPT,
    "User-Agent": GITHUB_USER_AGENT,
    "Content-Type": "application/json",
  };
}

function parseRepoOwnerAndName(repoUrl) {
  const { owner, repo, cleanUrl, webUrl } = normalizeCleanGithubUrl(repoUrl);
  return { owner, repo, cleanUrl, webUrl };
}

async function handleGithubApiError(response, fallbackMsg) {
  const body = await response.json().catch(() => ({}));
  const detail = body?.message || fallbackMsg;
  if (response.status === 401) {
    throw new ServiceError(
      "GitHub token expired or was revoked. Please re-authenticate with GitHub.",
      401,
      "GITHUB_TOKEN_REVOKED",
    );
  }
  if (response.status === 403 || response.status === 404 || response.status === 422) {
    throw new ServiceError(detail, response.status, "GITHUB_API_ERROR");
  }
  throw new ServiceError(detail, 502, "GITHUB_API_ERROR");
}

export class GitHubPlatformService {
  /**
   * Creates a new GitHub repository under the acting user's account.
   */
  static async createRepository(
    userId,
    { name, description = "", isPrivate = true } = {},
    deps = {},
  ) {
    if (!validateGithubRepoName(name)) {
      throw new ServiceError(
        "Repository name must match GitHub naming rules (letters, numbers, ., _, -).",
        400,
        "INVALID_REPO_NAME",
      );
    }

    const { token } = await resolveActingUserGithubToken(userId, {
      requireRepoScope: true,
    });

    const response = await githubFetch(
      "https://api.github.com/user/repos",
      {
        method: "POST",
        headers: buildGithubHeaders(token),
        body: JSON.stringify({
          name: name.trim(),
          description: typeof description === "string" ? description.trim() : "",
          private: Boolean(isPrivate),
          auto_init: false,
        }),
      },
      deps,
    );

    if (!response.ok) {
      await handleGithubApiError(response, "Failed to create GitHub repository");
    }

    const data = await response.json();
    return {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      private: Boolean(data.private),
      defaultBranch: data.default_branch || "main",
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
    };
  }

  /**
   * Lists Pull Requests for the linked GitHub repository.
   */
  static async listPullRequests(
    userId,
    repoUrl,
    { state = "open", perPage = 30 } = {},
    deps = {},
  ) {
    const { owner, repo } = parseRepoOwnerAndName(repoUrl);
    const { token } = await resolveActingUserGithubToken(userId);
    const safeState = ["open", "closed", "all"].includes(state) ? state : "open";
    const safePerPage = Math.min(Math.max(Number(perPage) || 30, 1), 100);

    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=${safeState}&per_page=${safePerPage}&sort=updated&direction=desc`,
      {
        headers: buildGithubHeaders(token),
      },
      deps,
    );

    if (!response.ok) {
      await handleGithubApiError(response, "Failed to load Pull Requests from GitHub");
    }

    const list = await response.json();
    return (Array.isArray(list) ? list : []).map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: Boolean(pr.draft),
      htmlUrl: pr.html_url,
      headRef: pr.head?.ref || "",
      baseRef: pr.base?.ref || "",
      author: pr.user?.login || null,
      authorAvatar: pr.user?.avatar_url || null,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at || null,
    }));
  }

  /**
   * Creates a Pull Request on GitHub using ONLY the acting user's token.
   */
  static async createPullRequest(
    userId,
    repoUrl,
    { title, body = "", head, base = "main", draft = false } = {},
    deps = {},
  ) {
    const { owner, repo } = parseRepoOwnerAndName(repoUrl);
    const { token } = await resolveActingUserGithubToken(userId, {
      requireRepoScope: true,
    });

    if (!title?.trim() || !head?.trim() || !base?.trim()) {
      throw new ServiceError(
        "Pull Request title, head branch, and base branch are required",
        400,
        "INVALID_PR_PAYLOAD",
      );
    }

    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: "POST",
        headers: buildGithubHeaders(token),
        body: JSON.stringify({
          title: title.trim(),
          body: typeof body === "string" ? body : "",
          head: head.trim(),
          base: base.trim(),
          draft: Boolean(draft),
        }),
      },
      deps,
    );

    if (!response.ok) {
      await handleGithubApiError(response, "Failed to create Pull Request");
    }

    const pr = await response.json();
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: Boolean(pr.draft),
      htmlUrl: pr.html_url,
      headRef: pr.head?.ref || head.trim(),
      baseRef: pr.base?.ref || base.trim(),
      createdAt: pr.created_at,
    };
  }

  /**
   * Fetches combined commit status & GitHub Actions check-runs for a commit/ref.
   */
  static async getCommitChecks(userId, repoUrl, ref = "HEAD", deps = {}) {
    const { owner, repo } = parseRepoOwnerAndName(repoUrl);
    const { token } = await resolveActingUserGithubToken(userId);
    const encodedRef = encodeURIComponent(ref);

    const [statusRes, checksRes] = await Promise.all([
      githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${encodedRef}/status`,
        { headers: buildGithubHeaders(token) },
        deps,
      ),
      githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${encodedRef}/check-runs`,
        { headers: buildGithubHeaders(token) },
        deps,
      ).catch(() => null),
    ]);

    if (!statusRes.ok && (!checksRes || !checksRes.ok)) {
      await handleGithubApiError(statusRes, "Failed to fetch commit CI checks");
    }

    const statusData = statusRes.ok ? await statusRes.json().catch(() => ({})) : {};
    const checksData =
      checksRes && checksRes.ok ? await checksRes.json().catch(() => ({})) : {};

    const checkRuns = Array.isArray(checksData?.check_runs)
      ? checksData.check_runs.map((run) => ({
          id: run.id,
          name: run.name,
          status: run.status,
          conclusion: run.conclusion,
          htmlUrl: run.html_url,
          startedAt: run.started_at,
          completedAt: run.completed_at,
        }))
      : [];

    const statuses = Array.isArray(statusData?.statuses)
      ? statusData.statuses.map((st) => ({
          context: st.context,
          state: st.state,
          description: st.description,
          targetUrl: st.target_url,
        }))
      : [];

    let overallState = statusData?.state || "neutral";
    if (checkRuns.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out")) {
      overallState = "failure";
    } else if (checkRuns.some((r) => r.status !== "completed")) {
      overallState = "pending";
    } else if (
      checkRuns.length > 0 &&
      checkRuns.every((r) => r.conclusion === "success" || r.conclusion === "skipped")
    ) {
      overallState = "success";
    }

    return {
      ref,
      overallState,
      totalChecks: checkRuns.length + statuses.length,
      checkRuns,
      statuses,
    };
  }

  /**
   * Inspects whether the acting user holds push permissions on a GitHub repository.
   */
  static async getRepositoryPermissions(userId, repoUrl, deps = {}) {
    const { owner, repo } = parseRepoOwnerAndName(repoUrl);
    const { token } = await resolveActingUserGithubToken(userId);
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: buildGithubHeaders(token) },
      deps,
    );
    if (!response.ok) {
      await handleGithubApiError(response, "Failed to inspect GitHub repository permissions");
    }
    const data = await response.json();
    return {
      fullName: data.full_name,
      private: Boolean(data.private),
      defaultBranch: data.default_branch || "main",
      permissions: {
        admin: Boolean(data.permissions?.admin),
        push: Boolean(data.permissions?.push),
        pull: Boolean(data.permissions?.pull),
      },
    };
  }
}
