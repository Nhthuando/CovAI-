import { authValid, loginValid } from "../validators/auth.validation.js";
import {
  register as registerService,
  login as loginService,
  issueSessionTokensForUser,
} from "../services/auth.service.js";
import prisma from "../config/prisma.js";
import crypto from "crypto";
import https from "node:https";
import { encrypt, decrypt } from "../utils/crypto.js";

const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const getRefreshCookieOptions = (req) => {
  const isSecure = Boolean(
    req?.secure ||
      req?.headers?.["x-forwarded-proto"] === "https" ||
      (/^https:/i.test(process.env.CLIENT_URL || "") &&
        process.env.NODE_ENV === "production"),
  );
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
};

export const setRefreshTokenCookie = (req, res, refreshToken) => {
  res.cookie("refreshToken", refreshToken, getRefreshCookieOptions(req));
};

export const register = async (req, res) => {
  try {
    const result = authValid.safeParse(req.body);
    if (!result.success)
      return res
        .status(400)
        .json({ error: result.error.flatten().fieldErrors });

    const { name, email, password } = result.data;
    const response = await registerService(name, email, password);
    setRefreshTokenCookie(req, res, response.refreshToken);
    return res.status(201).json({
      message: response.message,
      accessToken: response.accessToken,
      userName: response.userName,
      userEmail: response.userEmail,
    });
  } catch (error) {
    console.log(error);
    if (error.message === "Account already exists!") {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const login = async (req, res) => {
  try {
    const result = loginValid.safeParse(req.body);
    if (!result.success)
      return res
        .status(400)
        .json({ error: result.error.flatten().fieldErrors });

    const { email, password } = result.data;
    const response = await loginService(email, password);
    setRefreshTokenCookie(req, res, response.refreshToken);
    return res.status(200).json({
      message: response.message,
      accessToken: response.accessToken,
      name: response.name,
      email: response.email,
    });
  } catch (error) {
    console.log(error);
    if (
      error.message === "Account already exists!" ||
      error.message === "Incorrect email or password!"
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const getGithubRepositories = async (req, res) => {
  try {
    // Get user from DB to retrieve stored token (from previous OAuth flow)
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { githubAccessTokenEnc: true },
    });

    if (!user || !user.githubAccessTokenEnc) {
      return res.status(401).json({
        message: "User has not linked GitHub or token is invalid!",
      });
    }

    // Decrypt encrypted token
    let accessToken;
    try {
      accessToken = decrypt(user.githubAccessTokenEnc);
    } catch {
      // Fallback: legacy unencrypted token
      accessToken = user.githubAccessTokenEnc;
    }

    // Use decrypted token to fetch repos from GitHub API
    let repos = [];
    let page = 1;
    const perPage = 15;

    while (true) {
      const response = await fetch(
        `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=created&direction=desc`,
        {
          headers: {
            Authorization: `token ${accessToken}`,
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "CovAI-App",
          },
        },
      );

      if (!response.ok) {
        throw new Error("Unable to fetch repositories from GitHub!");
      }

      const pageRepos = await response.json();
      if (pageRepos.length === 0) break;

      repos = repos.concat(pageRepos);
      if (pageRepos.length < perPage) break;
      page++;
    }

    // Enrich repositories with all languages used (via GitHub languages API)
    // As long as the project uses JavaScript or TypeScript (or web frontend), it is supported.
    const enrichedRepos = await Promise.all(
      repos.map(async (repo) => {
        let languages = [];
        let hasJsOrTs = false;
        const primLang = repo.language || "";

        // 1. If GitHub already flags primary language as JS or TS
        if (primLang === "JavaScript" || primLang === "TypeScript") {
          hasJsOrTs = true;
          languages = [primLang];
        } else if (repo.languages_url) {
          // 2. If GitHub primary language is HTML, Python, etc., check languages breakdown
          try {
            const langRes = await fetch(repo.languages_url, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github.v3+json",
                "User-Agent": "CovAI-App",
              },
            });
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
            console.warn(
              `[getGithubRepositories] Could not fetch languages for ${repo.name}:`,
              err.message,
            );
          }
        }

        // 3. Web projects with primary language HTML/CSS/Vue commonly contain JavaScript
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
      }),
    );

    return res.status(200).json(enrichedRepos);
  } catch (error) {
    console.error(error);
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
      // If user declined, clear token
      await prisma.user.update({
        where: { id: req.user.id },
        data: { githubAccessTokenEnc: null },
      });
      return res
        .status(200)
        .json({ message: "You declined repository access permission!" });
    }

    // If approved, keep token (assumes saved during OAuth)
    return res
      .status(200)
      .json({ message: "Repository access granted successfully!" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error!" });
  }
};

const GITHUB_USER_AGENT = "CovAI-App";
const GITHUB_FETCH_TIMEOUT_MS = 15000;
const GITHUB_FETCH_MAX_ATTEMPTS = 3;
const TRANSIENT_NETWORK_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

class GithubNetworkError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "GithubNetworkError";
    this.statusCode = 504;
    this.cause = cause;
  }
}

export function isTransientGithubNetworkError(err) {
  if (!err) return false;
  const code = err?.code || err?.cause?.code;
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true;
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return true;
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("fetch failed") || msg.includes("timed out") || msg.includes("timeout");
}

function httpsJsonRequest(url, options = {}, timeoutMs = GITHUB_FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || "GET",
        headers: options.headers || {},
        family: 4,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 500;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => (raw ? JSON.parse(raw) : {}),
          });
        });
      },
    );
    req.on("timeout", () => {
      const err = new Error(`GitHub HTTPS request timed out after ${timeoutMs}ms`);
      err.code = "ETIMEDOUT";
      req.destroy(err);
    });
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export async function githubFetch(url, options = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const httpsImpl = deps.httpsImpl || httpsJsonRequest;
  const maxAttempts = deps.maxAttempts ?? GITHUB_FETCH_MAX_ATTEMPTS;
  const retryDelayMs = deps.retryDelayMs ?? 500;
  const timeoutMs = deps.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetchImpl(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch (fetchErr) {
      lastError = fetchErr;
      if (!isTransientGithubNetworkError(fetchErr)) {
        throw fetchErr;
      }
      // Fallback to explicit IPv4 node:https in case undici/IPv6 happy-eyeballs stalled
      try {
        return await httpsImpl(url, options, timeoutMs);
      } catch (httpsErr) {
        lastError = httpsErr;
        if (!isTransientGithubNetworkError(httpsErr) || attempt === maxAttempts) {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
  }

  throw new GithubNetworkError(
    "Unable to reach GitHub right now (connection timed out). Please try again in a moment.",
    lastError,
  );
}

function encryptGithubToken(accessToken) {
  try {
    return encrypt(accessToken);
  } catch {
    // Fallback if ENCRYPTION_KEY is not configured
    return accessToken;
  }
}

export async function exchangeGithubCodeForToken(code, deps = {}) {
  const tokenResponse = await githubFetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": GITHUB_USER_AGENT,
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    },
    deps,
  );
  const tokenData = await tokenResponse.json();
  if (!tokenData?.access_token) {
    console.error("GitHub access token exchange failed:", tokenData);
    return {
      accessToken: null,
      errorMessage:
        tokenData?.error_description ||
        tokenData?.error ||
        "Unable to retrieve access token!",
    };
  }
  return { accessToken: tokenData.access_token, errorMessage: null };
}

export const connectGithub = async (req, res) => {
  try {
    const code = req.body?.code || req.query?.code;
    if (!code) {
      return res
        .status(400)
        .json({ message: "Code parameter not found from GitHub!" });
    }

    const { accessToken, errorMessage } = await exchangeGithubCodeForToken(code);
    if (!accessToken) {
      return res.status(400).json({ message: errorMessage });
    }

    const userResponse = await githubFetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": GITHUB_USER_AGENT,
      },
    });
    const userData = await userResponse.json();

    if (!userResponse.ok || !userData?.id) {
      console.error("GitHub user profile fetch failed:", userData);
      return res
        .status(400)
        .json({ message: "Unable to retrieve GitHub user profile!" });
    }

    const githubUserId = String(userData.id);
    const existingOwner = await prisma.user.findUnique({
      where: { githubUserId },
      select: { id: true },
    });

    if (existingOwner && existingOwner.id !== req.user.id) {
      return res.status(409).json({
        message: "This GitHub account is already linked to another CovAI account.",
      });
    }

    const encryptedToken = encryptGithubToken(accessToken);
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        githubUserId,
        githubAccessTokenEnc: encryptedToken,
      },
      select: { id: true, githubUserId: true },
    });

    return res.status(200).json({
      message: "GitHub account connected successfully!",
      githubUserId: updatedUser.githubUserId,
      githubLogin: userData.login || null,
    });
  } catch (error) {
    console.error("[connectGithub]", error);
    if (error instanceof GithubNetworkError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const oAuthGithub = async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error === "access_denied") {
      return res.status(200).json({
        message:
          "You declined private repository access; system can only access public repositories!",
      });
    }

    if (!code)
      return res
        .status(400)
        .json({ message: "Code parameter not found from GitHub!" });

    const { accessToken, errorMessage } = await exchangeGithubCodeForToken(code);
    if (!accessToken) {
      return res.status(400).json({ message: errorMessage });
    }

    const [userDetail, emailResponse] = await Promise.all([
      githubFetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": GITHUB_USER_AGENT,
        },
      }),
      githubFetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": GITHUB_USER_AGENT,
        },
      }),
    ]);

    const userData = await userDetail.json();
    const emails = await emailResponse.json();

    const primaryEmail = Array.isArray(emails)
      ? emails.find((e) => e.primary)?.email ||
      emails[0]?.email ||
      userData.email
      : userData.email;

    if (!primaryEmail) {
      console.error(
        "Could not obtain primary email. GitHub user:",
        userData,
        "emails:",
        emails,
      );
      return res
        .status(400)
        .json({ message: "Unable to retrieve email from GitHub!" });
    }

    const githubUserId = String(userData.id);
    const encryptedToken = encryptGithubToken(accessToken);

    let user = await prisma.user.findUnique({
      where: { githubUserId },
    });
    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: primaryEmail },
      });
    }

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          githubUserId,
          name: user.name || userData.login,
          githubAccessTokenEnc: encryptedToken,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          githubUserId,
          name: userData.login,
          email: primaryEmail,
          githubAccessTokenEnc: encryptedToken,
        },
      });
    }
    const { accessToken: sessionAccessToken, refreshToken } =
      await issueSessionTokensForUser(user);
    setRefreshTokenCookie(req, res, refreshToken);
    return res.status(200).json({
      message: "GitHub login successful!",
      token: sessionAccessToken,
      accessToken: sessionAccessToken,
      userId: user.id,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    console.error("[oAuthGithub]", error);
    if (error instanceof GithubNetworkError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: "Internal server error!" });
  }
};
