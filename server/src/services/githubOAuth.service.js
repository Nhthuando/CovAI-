import crypto from "crypto";
import https from "node:https";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import { encrypt } from "../utils/crypto.js";
import { ServiceError } from "../utils/serviceError.js";
import { logAuthSecurityEvent } from "../utils/authSecurityLogger.js";
import {
  issueSessionTokensForUser,
  recordFailedPasswordAttempt,
} from "./auth.service.js";
import {
  AUTH_ERROR_CODES,
  AUTH_LIMITS,
  AUTH_MESSAGES,
  formatLockoutMessage,
  normalizeEmail,
} from "../../../shared/authValidation.js";

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

export class GithubNetworkError extends Error {
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
  return (
    msg.includes("fetch failed") ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  );
}

function httpsJsonRequest(
  url,
  options = {},
  timeoutMs = GITHUB_FETCH_TIMEOUT_MS,
) {
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
      try {
        return await httpsImpl(url, options, timeoutMs);
      } catch (httpsErr) {
        lastError = httpsErr;
        if (
          !isTransientGithubNetworkError(httpsErr) ||
          attempt === maxAttempts
        ) {
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

export function encryptGithubTokenStrict(accessToken) {
  try {
    return encrypt(accessToken);
  } catch (err) {
    logAuthSecurityEvent(
      "ENCRYPTION_CONFIG_ERROR",
      { reason: err?.message || "Encryption failed" },
      "error",
    );
    throw new ServiceError(
      "Server encryption configuration error.",
      500,
      AUTH_ERROR_CODES.ENCRYPTION_CONFIG_ERROR,
    );
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
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData?.access_token) {
    logAuthSecurityEvent("OAUTH_TOKEN_EXCHANGE_FAILED", {
      providerError: tokenData?.error || `HTTP_${tokenResponse.status}`,
    });
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

export function createGithubOAuthState(mode = "login") {
  const safeMode = mode === "connect" ? "connect" : "login";
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new ServiceError(
      "GitHub OAuth is not configured.",
      500,
      AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR,
    );
  }

  const nonce = crypto.randomBytes(32).toString("hex");
  const state = `${safeMode}.${nonce}`;
  const clientUrl = (process.env.CLIENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
  const redirectUri = `${clientUrl}/auth/github/callback`;
  // BR02.2: minimal scopes for login; connect adds repo access for private repository import
  const scope = safeMode === "connect" ? "repo read:user user:email" : "read:user user:email";

  const params = new URLSearchParams({
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
    state,
  });

  return {
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    state,
    cookieValue: state,
    maxAgeMs: AUTH_LIMITS.OAUTH_STATE_TTL_MS,
  };
}

export function verifyGithubOAuthState(queryState, cookieState, expectedMode) {
  if (
    typeof queryState !== "string" ||
    typeof cookieState !== "string" ||
    !queryState ||
    !cookieState
  ) {
    return false;
  }
  if (expectedMode && !queryState.startsWith(`${expectedMode}.`)) {
    return false;
  }
  const queryBuf = Buffer.from(queryState, "utf8");
  const cookieBuf = Buffer.from(cookieState, "utf8");
  if (queryBuf.length !== cookieBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(queryBuf, cookieBuf);
}

export function extractVerifiedGithubEmail(emails) {
  if (!Array.isArray(emails)) return null;
  const primaryVerified = emails.find(
    (e) => e?.verified === true && e?.primary === true && typeof e?.email === "string",
  );
  if (primaryVerified?.email) {
    return normalizeEmail(primaryVerified.email);
  }
  const anyVerified = emails.find(
    (e) => e?.verified === true && typeof e?.email === "string",
  );
  return anyVerified?.email ? normalizeEmail(anyVerified.email) : null;
}

function hashLinkToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export async function handleGithubLoginCallback({
  code,
  now = () => new Date(),
  ip = null,
  deps = {},
}) {
  const currentTime = now();
  const { accessToken, errorMessage } = await exchangeGithubCodeForToken(code, deps);
  if (!accessToken) {
    throw new ServiceError(
      errorMessage,
      400,
      AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR,
    );
  }

  const [userDetail, emailResponse] = await Promise.all([
    githubFetch(
      "https://api.github.com/user",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": GITHUB_USER_AGENT,
        },
      },
      deps,
    ),
    githubFetch(
      "https://api.github.com/user/emails",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": GITHUB_USER_AGENT,
        },
      },
      deps,
    ),
  ]);

  const userData = await userDetail.json().catch(() => ({}));
  if (!userDetail.ok || !userData?.id) {
    throw new ServiceError(
      "Unable to retrieve GitHub user profile!",
      502,
      AUTH_ERROR_CODES.GITHUB_PROFILE_FAILED,
    );
  }

  const emails = emailResponse.ok ? await emailResponse.json().catch(() => []) : [];
  const verifiedEmail = extractVerifiedGithubEmail(emails);
  const githubUserId = String(userData.id);
  const githubDisplayName = userData.name || userData.login || null;
  const githubAvatarUrl = userData.avatar_url || null;
  const encryptedToken = encryptGithubTokenStrict(accessToken);

  // Branch 1 (TC_LOG_15): Already linked by githubUserId -> authenticate directly
  const linkedUser = await prisma.user.findUnique({
    where: { githubUserId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      githubUserId: true,
    },
  });

  if (linkedUser) {
    const updatedUser = await prisma.user.update({
      where: { id: linkedUser.id },
      data: {
        githubAccessTokenEnc: encryptedToken,
        name: linkedUser.name || githubDisplayName,
        avatarUrl: linkedUser.avatarUrl || githubAvatarUrl,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        githubUserId: true,
      },
    });
    const { accessToken: sessionAccessToken, refreshToken } =
      await issueSessionTokensForUser(updatedUser);
    return {
      status: "AUTHENTICATED",
      user: updatedUser,
      accessToken: sessionAccessToken,
      refreshToken,
    };
  }

  if (!verifiedEmail) {
    logAuthSecurityEvent("OAUTH_EMAIL_UNVERIFIED", {
      ip,
      githubUserId,
    });
    throw new ServiceError(
      AUTH_MESSAGES.GITHUB_EMAIL_UNVERIFIED,
      400,
      AUTH_ERROR_CODES.GITHUB_EMAIL_UNVERIFIED,
    );
  }

  // Branch 2: Check whether an existing account owns this verified email
  const existingUser = await prisma.user.findUnique({
    where: { email: verifiedEmail },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      githubUserId: true,
      passwordHash: true,
    },
  });

  // TC_LOG_16: First-time GitHub user -> auto-register with verified email & avatar
  if (!existingUser) {
    const createdUser = await prisma.user.create({
      data: {
        githubUserId,
        email: verifiedEmail,
        name: githubDisplayName,
        avatarUrl: githubAvatarUrl,
        githubAccessTokenEnc: encryptedToken,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        githubUserId: true,
      },
    });

    const { accessToken: sessionAccessToken, refreshToken } =
      await issueSessionTokensForUser(createdUser);
    return {
      status: "AUTHENTICATED",
      user: createdUser,
      accessToken: sessionAccessToken,
      refreshToken,
    };
  }

  // Conflict: email already belongs to a different GitHub identity
  if (existingUser.githubUserId && existingUser.githubUserId !== githubUserId) {
    logAuthSecurityEvent("GITHUB_LINK_CONFLICT", {
      userId: existingUser.id,
      email: existingUser.email,
      ip,
    });
    throw new ServiceError(
      AUTH_MESSAGES.EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB,
      409,
      AUTH_ERROR_CODES.EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB,
    );
  }

  // TC_LOG_17 (BR02.1 Option B): Existing local account -> create single-use pending link, require explicit confirmation + local password
  const linkToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashLinkToken(linkToken);
  const expiresAt = new Date(
    currentTime.getTime() + AUTH_LIMITS.GITHUB_PENDING_LINK_TTL_MS,
  );

  await prisma.$transaction([
    prisma.githubPendingLink.deleteMany({
      where: {
        userId: existingUser.id,
        OR: [{ expiresAt: { lte: currentTime } }, { consumedAt: { not: null } }],
      },
    }),
    prisma.githubPendingLink.create({
      data: {
        tokenHash,
        userId: existingUser.id,
        email: existingUser.email,
        githubUserId,
        githubLogin: userData.login || null,
        githubName: githubDisplayName,
        githubAvatarUrl,
        githubAccessTokenEnc: encryptedToken,
        expiresAt,
      },
      select: { id: true },
    }),
  ]);

  logAuthSecurityEvent(
    "GITHUB_LINK_PROMPTED",
    {
      userId: existingUser.id,
      email: existingUser.email,
      ip,
      githubUserId,
    },
    "info",
  );

  return {
    status: "LINK_REQUIRED",
    code: AUTH_ERROR_CODES.GITHUB_LINK_CONFIRMATION_REQUIRED,
    linkToken,
    expiresAt: expiresAt.toISOString(),
    requiresPassword: true,
    existingAccount: {
      email: existingUser.email,
      name: existingUser.name,
    },
    githubAccount: {
      login: userData.login || null,
      name: githubDisplayName,
      avatarUrl: githubAvatarUrl,
      email: verifiedEmail,
    },
  };
}

export async function confirmGithubAccountLink({
  linkToken,
  password,
  now = () => new Date(),
  ip = null,
}) {
  const currentTime = now();
  const tokenHash = hashLinkToken(linkToken);

  const pending = await prisma.githubPendingLink.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      email: true,
      githubUserId: true,
      githubLogin: true,
      githubName: true,
      githubAvatarUrl: true,
      githubAccessTokenEnc: true,
      expiresAt: true,
      consumedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          passwordHash: true,
          githubUserId: true,
          failedLoginAttempts: true,
          lockedUntil: true,
        },
      },
    },
  });

  if (!pending || pending.consumedAt || pending.expiresAt <= currentTime) {
    throw new ServiceError(
      AUTH_MESSAGES.INVALID_LINK_TOKEN,
      400,
      AUTH_ERROR_CODES.INVALID_LINK_TOKEN,
    );
  }

  const targetUser = pending.user;
  if (!targetUser) {
    throw new ServiceError(
      AUTH_MESSAGES.INVALID_LINK_TOKEN,
      400,
      AUTH_ERROR_CODES.INVALID_LINK_TOKEN,
    );
  }

  if (targetUser.lockedUntil && targetUser.lockedUntil > currentTime) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((targetUser.lockedUntil.getTime() - currentTime.getTime()) / 1000),
    );
    logAuthSecurityEvent("LOGIN_BLOCKED_LOCKED", {
      userId: targetUser.id,
      email: targetUser.email,
      ip,
      context: "github_link_confirm",
      lockedUntil: targetUser.lockedUntil,
    });
    throw new ServiceError(
      formatLockoutMessage(retryAfterSeconds),
      423,
      AUTH_ERROR_CODES.ACCOUNT_LOCKED,
      {
        lockedUntil: targetUser.lockedUntil.toISOString(),
        retryAfterSeconds,
      },
    );
  }

  if (
    targetUser.githubUserId &&
    targetUser.githubUserId !== pending.githubUserId
  ) {
    throw new ServiceError(
      AUTH_MESSAGES.EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB,
      409,
      AUTH_ERROR_CODES.EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB,
    );
  }

  const existingGithubOwner = await prisma.user.findUnique({
    where: { githubUserId: pending.githubUserId },
    select: { id: true },
  });
  if (existingGithubOwner && existingGithubOwner.id !== targetUser.id) {
    throw new ServiceError(
      "This GitHub account is already linked to another CovAI account.",
      409,
      AUTH_ERROR_CODES.EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB,
    );
  }

  if (
    !targetUser.passwordHash ||
    !(await bcrypt.compare(password, targetUser.passwordHash))
  ) {
    const outcome = await recordFailedPasswordAttempt(targetUser, {
      now,
      ip,
      context: "github_link_confirm",
    });
    if (outcome.locked && outcome.lockedUntil) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((outcome.lockedUntil.getTime() - currentTime.getTime()) / 1000),
      );
      throw new ServiceError(
        formatLockoutMessage(retryAfterSeconds),
        423,
        AUTH_ERROR_CODES.ACCOUNT_LOCKED,
        {
          lockedUntil: outcome.lockedUntil.toISOString(),
          retryAfterSeconds,
        },
      );
    }
    throw new ServiceError(
      AUTH_MESSAGES.INVALID_LINK_PASSWORD,
      401,
      AUTH_ERROR_CODES.INVALID_LINK_PASSWORD,
    );
  }

  const linkedUser = await prisma.$transaction(async (tx) => {
    const consumed = await tx.githubPendingLink.updateMany({
      where: {
        id: pending.id,
        consumedAt: null,
        expiresAt: { gt: currentTime },
      },
      data: { consumedAt: currentTime },
    });

    if (consumed.count !== 1) {
      throw new ServiceError(
        AUTH_MESSAGES.INVALID_LINK_TOKEN,
        400,
        AUTH_ERROR_CODES.INVALID_LINK_TOKEN,
      );
    }

    return tx.user.update({
      where: { id: targetUser.id },
      data: {
        githubUserId: pending.githubUserId,
        githubAccessTokenEnc: pending.githubAccessTokenEnc,
        name: targetUser.name || pending.githubName || pending.githubLogin,
        avatarUrl: targetUser.avatarUrl || pending.githubAvatarUrl,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        githubUserId: true,
      },
    });
  });

  const { accessToken, refreshToken } =
    await issueSessionTokensForUser(linkedUser);

  logAuthSecurityEvent(
    "GITHUB_LINK_CONFIRMED",
    {
      userId: linkedUser.id,
      email: linkedUser.email,
      ip,
      githubUserId: linkedUser.githubUserId,
    },
    "info",
  );

  return {
    status: "AUTHENTICATED",
    user: linkedUser,
    accessToken,
    refreshToken,
  };
}

export async function cancelGithubAccountLink({ linkToken, ip = null }) {
  const tokenHash = hashLinkToken(linkToken);
  const deleted = await prisma.githubPendingLink.deleteMany({
    where: { tokenHash },
  });
  logAuthSecurityEvent(
    "GITHUB_LINK_CANCELLED",
    { ip, cancelledCount: deleted.count },
    "info",
  );
  return { message: "GitHub account linking cancelled." };
}

export async function connectGithubForUser({ userId, code, deps = {} }) {
  const { accessToken, errorMessage } = await exchangeGithubCodeForToken(
    code,
    deps,
  );
  if (!accessToken) {
    throw new ServiceError(
      errorMessage,
      400,
      AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR,
    );
  }

  const userResponse = await githubFetch(
    "https://api.github.com/user",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": GITHUB_USER_AGENT,
      },
    },
    deps,
  );
  const userData = await userResponse.json().catch(() => ({}));

  if (!userResponse.ok || !userData?.id) {
    throw new ServiceError(
      "Unable to retrieve GitHub user profile!",
      400,
      AUTH_ERROR_CODES.GITHUB_PROFILE_FAILED,
    );
  }

  const githubUserId = String(userData.id);
  const existingOwner = await prisma.user.findUnique({
    where: { githubUserId },
    select: { id: true },
  });

  if (existingOwner && existingOwner.id !== userId) {
    throw new ServiceError(
      "This GitHub account is already linked to another CovAI account.",
      409,
      AUTH_ERROR_CODES.EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB,
    );
  }

  const encryptedToken = encryptGithubTokenStrict(accessToken);
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      githubUserId,
      githubAccessTokenEnc: encryptedToken,
    },
    select: { id: true, githubUserId: true },
  });

  return {
    message: "GitHub account connected successfully!",
    githubUserId: updatedUser.githubUserId,
    githubLogin: userData.login || null,
  };
}
