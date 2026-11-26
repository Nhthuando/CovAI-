import {
  authValid,
  loginValid,
  confirmGithubLinkValid,
  cancelGithubLinkValid,
} from "../validators/auth.validation.js";
import {
  register as registerService,
  login as loginService,
} from "../services/auth.service.js";
import {
  GithubNetworkError,
  isTransientGithubNetworkError,
  githubFetch,
  exchangeGithubCodeForToken,
  createGithubOAuthState,
  verifyGithubOAuthState,
  handleGithubLoginCallback,
  confirmGithubAccountLink,
  cancelGithubAccountLink,
  connectGithubForUser,
} from "../services/githubOAuth.service.js";
import prisma from "../config/prisma.js";
import { decrypt } from "../utils/crypto.js";
import { ServiceError } from "../utils/serviceError.js";
import logger from "../utils/logger.js";
import { logAuthSecurityEvent } from "../utils/authSecurityLogger.js";
import {
  AUTH_ERROR_CODES,
  AUTH_LIMITS,
  AUTH_MESSAGES,
} from "../../../shared/authValidation.js";

export {
  isTransientGithubNetworkError,
  githubFetch,
  exchangeGithubCodeForToken,
};

const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_COOKIE_NAME = "covai_oauth_state";

function isSecureCookieRequest(req) {
  return Boolean(
    req?.secure ||
      req?.headers?.["x-forwarded-proto"] === "https" ||
      (/^https:/i.test(process.env.CLIENT_URL || "") &&
        process.env.NODE_ENV === "production"),
  );
}

function resolveCookieSameSite(req, secure) {
  if (!secure) return "lax";
  const origin = req?.headers?.origin;
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost && originHost !== host) {
        return "none";
      }
    } catch {
      return "lax";
    }
  }
  return "lax";
}

export const getRefreshCookieOptions = (req) => {
  const secure = isSecureCookieRequest(req);
  return {
    httpOnly: true,
    secure,
    sameSite: resolveCookieSameSite(req, secure),
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
};

export const setRefreshTokenCookie = (req, res, refreshToken) => {
  res.cookie("refreshToken", refreshToken, getRefreshCookieOptions(req));
};

function getOAuthStateCookieOptions(req, maxAge = AUTH_LIMITS.OAUTH_STATE_TTL_MS) {
  const secure = isSecureCookieRequest(req);
  return {
    httpOnly: true,
    secure,
    sameSite: resolveCookieSameSite(req, secure),
    path: "/",
    maxAge,
  };
}

function clearOAuthStateCookie(req, res) {
  const { maxAge: _maxAge, ...clearOpts } = getOAuthStateCookieOptions(req);
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, clearOpts);
}

function extractClientIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req?.ip || req?.socket?.remoteAddress || null;
}

export const register = async (req, res) => {
  try {
    const result = authValid.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        code: AUTH_ERROR_CODES.VALIDATION_ERROR,
        error: result.error.flatten().fieldErrors,
      });
    }

    const { name, email, password } = result.data;
    const response = await registerService(name, email, password);
    setRefreshTokenCookie(req, res, response.refreshToken);
    return res.status(201).json({
      success: true,
      message: response.message,
      accessToken: response.accessToken,
      userId: response.userId,
      userName: response.userName,
      userEmail: response.userEmail,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[register] Unexpected error:", error?.message || "Unknown error");
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const login = async (req, res) => {
  try {
    const result = loginValid.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        code: AUTH_ERROR_CODES.VALIDATION_ERROR,
        error: result.error.flatten().fieldErrors,
      });
    }

    const { email, password } = result.data;
    const response = await loginService(email, password, {
      ip: extractClientIp(req),
    });
    setRefreshTokenCookie(req, res, response.refreshToken);
    return res.status(200).json({
      success: true,
      message: response.message,
      accessToken: response.accessToken,
      userId: response.userId,
      name: response.name,
      email: response.email,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      if (error.statusCode === 423 && error.details?.retryAfterSeconds) {
        res.set("Retry-After", String(error.details.retryAfterSeconds));
      }
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
        ...(error.details || {}),
      });
    }
    logger.error("[login] Unexpected error:", error?.message || "Unknown error");
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const getGithubOAuthUrlController = (req, res) => {
  try {
    const mode = req.query?.mode === "connect" ? "connect" : "login";
    const { url, cookieValue, maxAgeMs } = createGithubOAuthState(mode);
    res.cookie(
      OAUTH_STATE_COOKIE_NAME,
      cookieValue,
      getOAuthStateCookieOptions(req, maxAgeMs),
    );
    return res.status(200).json({ success: true, url });
  } catch (error) {
    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error(
      "[getGithubOAuthUrl] Unexpected error:",
      error?.message || "Unknown error",
    );
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const getGithubRepositories = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { githubAccessTokenEnc: true },
    });

    if (!user || !user.githubAccessTokenEnc) {
      return res.status(400).json({
        success: false,
        code: "GITHUB_NOT_CONNECTED",
        message: "User has not linked GitHub or token is invalid!",
      });
    }

    let accessToken;
    try {
      accessToken = decrypt(user.githubAccessTokenEnc);
    } catch {
      accessToken = user.githubAccessTokenEnc;
    }

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
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "CovAI-App",
          },
        },
      );

      if (response.status === 401) {
        return res.status(422).json({
          success: false,
          code: "GITHUB_TOKEN_INVALID",
          message:
            "GitHub authorization expired or was revoked. Please reconnect your GitHub account.",
        });
      }

      if (!response.ok) {
        throw new ServiceError(
          "Unable to fetch repositories from GitHub!",
          502,
          AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR,
        );
      }

      const pageRepos = await response.json();
      if (!Array.isArray(pageRepos) || pageRepos.length === 0) break;

      repos = repos.concat(pageRepos);
      if (pageRepos.length < perPage) break;
      page++;
    }

    repos.sort((a, b) => {
      const timeB = new Date(b.pushed_at || b.updated_at || 0).getTime();
      const timeA = new Date(a.pushed_at || a.updated_at || 0).getTime();
      return timeB - timeA;
    });

    const enrichRepo = async (repo) => {
      let languages = [];
      let hasJsOrTs = false;
      const primLang = repo.language || "";

      if (primLang === "JavaScript" || primLang === "TypeScript") {
        hasJsOrTs = true;
        languages = [primLang];
      } else if (repo.languages_url) {
        try {
          const langRes = await githubFetch(
            repo.languages_url,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github.v3+json",
                "User-Agent": "CovAI-App",
              },
            },
            { maxAttempts: 1, timeoutMs: 8000 },
          );
          if (langRes.ok) {
            const langData = await langRes.json();
            languages = Object.keys(langData || {});
            hasJsOrTs = languages.some(
              (l) =>
                l.toLowerCase() === "javascript" ||
                l.toLowerCase() === "typescript",
            );
          }
        } catch (err) {
          logger.warn(
            `[getGithubRepositories] Could not fetch languages for ${repo.name}:`,
            err.message,
          );
        }
      }

      if (
        !hasJsOrTs &&
        (!primLang || ["HTML", "CSS", "Vue"].includes(primLang))
      ) {
        hasJsOrTs = true;
      }

      return {
        ...repo,
        languages,
        hasJsOrTs,
      };
    };

    const enrichedRepos = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < repos.length; i += CONCURRENCY) {
      const batch = repos.slice(i, i + CONCURRENCY);
      const batchResult = await Promise.all(batch.map(enrichRepo));
      enrichedRepos.push(...batchResult);
    }

    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json(enrichedRepos);
  } catch (error) {
    if (error instanceof GithubNetworkError || error instanceof ServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[getGithubRepositories] Error:", error?.message || error);
    return res.status(500).json({ message: error.message });
  }
};

export const githubOAuthAccess = async (req, res) => {
  try {
    const { allowAccess } = req.body;

    if (allowAccess === undefined) {
      return res
        .status(400)
        .json({ message: "Missing permission parameter!" });
    }

    if (!allowAccess) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { githubAccessTokenEnc: null },
        select: { id: true },
      });
      return res
        .status(200)
        .json({ message: "You declined repository access permission!" });
    }

    return res
      .status(200)
      .json({ message: "Repository access granted successfully!" });
  } catch (error) {
    logger.error("[githubOAuthAccess] Error:", error?.message || error);
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const connectGithub = async (req, res) => {
  const ip = extractClientIp(req);
  const cookieState = req.cookies?.[OAUTH_STATE_COOKIE_NAME];
  clearOAuthStateCookie(req, res);

  try {
    const state = req.body?.state || req.query?.state;
    if (!verifyGithubOAuthState(state, cookieState, "connect")) {
      logAuthSecurityEvent("OAUTH_STATE_INVALID", {
        userId: req.user?.id,
        ip,
        mode: "connect",
      });
      return res.status(400).json({
        success: false,
        code: AUTH_ERROR_CODES.INVALID_OAUTH_STATE,
        message: AUTH_MESSAGES.INVALID_OAUTH_STATE,
      });
    }

    const code = req.body?.code || req.query?.code;
    if (!code) {
      return res
        .status(400)
        .json({ message: "Code parameter not found from GitHub!" });
    }

    const data = await connectGithubForUser({
      userId: req.user.id,
      code,
    });
    return res.status(200).json(data);
  } catch (error) {
    if (error instanceof GithubNetworkError || error instanceof ServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[connectGithub] Unexpected error:", error?.message || error);
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const oAuthGithub = async (req, res) => {
  const ip = extractClientIp(req);
  const cookieState = req.cookies?.[OAUTH_STATE_COOKIE_NAME];
  clearOAuthStateCookie(req, res);

  try {
    const { code, error, error_description: errorDescription, state } = req.query;

    if (error) {
      if (error === "access_denied") {
        logAuthSecurityEvent("OAUTH_ACCESS_DENIED", { ip, mode: "login" });
        return res.status(400).json({
          success: false,
          code: AUTH_ERROR_CODES.OAUTH_ACCESS_DENIED,
          message: AUTH_MESSAGES.OAUTH_ACCESS_DENIED,
        });
      }
      logAuthSecurityEvent("OAUTH_PROVIDER_ERROR", {
        ip,
        mode: "login",
        providerError: String(error),
      });
      return res.status(400).json({
        success: false,
        code: AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR,
        message:
          errorDescription || "GitHub authentication failed. Please try again.",
      });
    }

    if (!verifyGithubOAuthState(state, cookieState, "login")) {
      logAuthSecurityEvent("OAUTH_STATE_INVALID", { ip, mode: "login" });
      return res.status(400).json({
        success: false,
        code: AUTH_ERROR_CODES.INVALID_OAUTH_STATE,
        message: AUTH_MESSAGES.INVALID_OAUTH_STATE,
      });
    }

    if (!code) {
      return res
        .status(400)
        .json({ message: "Code parameter not found from GitHub!" });
    }

    const result = await handleGithubLoginCallback({
      code: String(code),
      ip,
    });

    if (result.status === "LINK_REQUIRED") {
      return res.status(200).json({
        success: true,
        ...result,
      });
    }

    setRefreshTokenCookie(req, res, result.refreshToken);
    return res.status(200).json({
      success: true,
      status: "AUTHENTICATED",
      message: "GitHub login successful!",
      token: result.accessToken,
      accessToken: result.accessToken,
      userId: result.user.id,
      name: result.user.name,
      email: result.user.email,
      avatarUrl: result.user.avatarUrl,
    });
  } catch (error) {
    if (error instanceof GithubNetworkError || error instanceof ServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    logger.error("[oAuthGithub] Unexpected error:", error?.message || error);
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const confirmGithubLink = async (req, res) => {
  try {
    const parsed = confirmGithubLinkValid.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      const firstMessage =
        flat.linkToken?.[0] || flat.password?.[0] || "Invalid link confirmation payload.";
      const code = flat.linkToken
        ? AUTH_ERROR_CODES.INVALID_LINK_TOKEN
        : AUTH_ERROR_CODES.VALIDATION_ERROR;
      return res.status(400).json({
        success: false,
        code,
        message: firstMessage,
        error: flat,
      });
    }

    const result = await confirmGithubAccountLink({
      linkToken: parsed.data.linkToken,
      password: parsed.data.password,
      ip: extractClientIp(req),
    });

    setRefreshTokenCookie(req, res, result.refreshToken);
    return res.status(200).json({
      success: true,
      status: "AUTHENTICATED",
      message: "GitHub account linked and signed in successfully!",
      token: result.accessToken,
      accessToken: result.accessToken,
      userId: result.user.id,
      name: result.user.name,
      email: result.user.email,
      avatarUrl: result.user.avatarUrl,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      if (error.statusCode === 423 && error.details?.retryAfterSeconds) {
        res.set("Retry-After", String(error.details.retryAfterSeconds));
      }
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
        ...(error.details || {}),
      });
    }
    logger.error(
      "[confirmGithubLink] Unexpected error:",
      error?.message || "Unknown error",
    );
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const cancelGithubLink = async (req, res) => {
  try {
    const parsed = cancelGithubLinkValid.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: AUTH_ERROR_CODES.INVALID_LINK_TOKEN,
        message: AUTH_MESSAGES.INVALID_LINK_TOKEN,
      });
    }
    const result = await cancelGithubAccountLink({
      linkToken: parsed.data.linkToken,
      ip: extractClientIp(req),
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error(
      "[cancelGithubLink] Unexpected error:",
      error?.message || "Unknown error",
    );
    return res.status(500).json({ message: "Internal server error!" });
  }
};
