import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import prisma from "../config/prisma.js";
import { decrypt, isEncryptedFormat } from "../utils/crypto.js";
import { ServiceError } from "../utils/serviceError.js";
import { AUTH_ERROR_CODES, AUTH_MESSAGES } from "../../../shared/authValidation.js";
import { GIT_DEFAULT_IGNORE_ENTRIES } from "../../../shared/gitProtocol.js";
import {
  hasGithubRepoWriteScope,
  parseGithubScopes,
} from "../../../shared/versionControlMode.js";

const DEFAULT_LOCAL_TIMEOUT_MS = 15_000;
const DEFAULT_NETWORK_TIMEOUT_MS = 120_000;
const COVAI_EXCLUDE_HEADER = "# CovAI managed runtime/test-runner ignores";
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * Scrubs any GitHub tokens, basic authorization headers, and embedded URL
 * credentials from git stdout/stderr/errors before logging or returning to clients.
 */
export function redactGitOutput(text, extraSecrets = []) {
  if (typeof text !== "string" || !text) return "";
  let scrubbed = text
    .replace(/https:\/\/[^@\s]+@github\.com/gi, "https://github.com")
    .replace(
      /AUTHORIZATION:\s*basic\s+[A-Za-z0-9+/=]+/gi,
      "AUTHORIZATION: basic [REDACTED]",
    )
    .replace(/\b(?:gho|ghp|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g, "[REDACTED_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_TOKEN]");

  for (const secret of extraSecrets) {
    if (typeof secret === "string" && secret.length >= 6) {
      scrubbed = scrubbed.split(secret).join("[REDACTED]");
    }
  }
  return scrubbed;
}

/**
 * Normalizes a GitHub repository URL into credential-free canonical HTTPS forms.
 */
export function normalizeCleanGithubUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new ServiceError("GitHub repository URL is required", 400, "INVALID_REPO_URL");
  }
  const trimmed = rawUrl.trim();
  if (/[\0\r\n\s]/.test(trimmed)) {
    throw new ServiceError("Invalid GitHub repository URL", 400, "INVALID_REPO_URL");
  }
  const stripped = trimmed.replace(/https:\/\/[^@\s]+@github\.com\//gi, "https://github.com/");
  const match = stripped.match(/^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i);
  if (!match) {
    throw new ServiceError(
      "Only HTTPS GitHub URLs (https://github.com/owner/repo) are supported",
      400,
      "INVALID_REPO_URL",
    );
  }
  const owner = match[1];
  const repo = match[2];
  return {
    owner,
    repo,
    cleanUrl: `https://github.com/${owner}/${repo}.git`,
    webUrl: `https://github.com/${owner}/${repo}`,
  };
}

/**
 * Ensures CovAI test-runner and internal artifacts are ignored via `.git/info/exclude`
 * without ever modifying the repository's tracked `.gitignore`.
 */
export function ensureCovaiGitExcludes(rootDir) {
  if (!rootDir) return false;
  const gitDir = path.join(rootDir, ".git");
  if (!fs.existsSync(gitDir)) return false;

  const infoDir = path.join(gitDir, "info");
  const excludePath = path.join(infoDir, "exclude");
  fs.mkdirSync(infoDir, { recursive: true });

  const existingText = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf8")
    : "";
  const existingLines = new Set(
    existingText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const missingEntries = GIT_DEFAULT_IGNORE_ENTRIES.filter(
    (entry) => !existingLines.has(entry),
  );
  if (missingEntries.length === 0) return false;

  const chunks = [];
  if (existingText && !existingText.endsWith("\n")) chunks.push("");
  if (!existingText.includes(COVAI_EXCLUDE_HEADER)) {
    chunks.push(COVAI_EXCLUDE_HEADER);
  }
  chunks.push(...missingEntries, "");

  fs.appendFileSync(excludePath, chunks.join("\n"), "utf8");
  return true;
}

/**
 * Validates and normalizes a project-relative file path passed to Git CLI.
 */
export function sanitizeGitFilePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ServiceError("Use a project-relative file path", 400, "INVALID_FILE_PATH");
  }
  if (/[\0\r\n"]/.test(value) || /^[a-z]:/i.test(value) || value.startsWith("\\")) {
    throw new ServiceError("Use a project-relative file path", 400, "INVALID_FILE_PATH");
  }
  const posix = value.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!posix || path.isAbsolute(posix) || path.posix.isAbsolute(posix)) {
    throw new ServiceError("Use a project-relative file path", 400, "INVALID_FILE_PATH");
  }
  const parts = posix.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        part === "." ||
        part === ".." ||
        part.toLowerCase() === ".git" ||
        WINDOWS_RESERVED_NAME_RE.test(part),
    )
  ) {
    throw new ServiceError("Use a project-relative file path", 400, "INVALID_FILE_PATH");
  }
  return parts.join("/");
}

/**
 * Validates a branch, tag, remote, or commit-ish ref and prevents option injection (`-`).
 */
export function sanitizeGitRef(value, label = "reference") {
  if (typeof value !== "string") {
    throw new ServiceError(`Invalid ${label}`, 400, "INVALID_GIT_REF");
  }
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.endsWith(".") ||
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    trimmed.includes("@{") ||
    trimmed.includes("\\") ||
    trimmed.endsWith(".lock") ||
    !/^[A-Za-z0-9._/:~^@-]{1,200}$/.test(trimmed)
  ) {
    throw new ServiceError(`Invalid ${label}`, 400, "INVALID_GIT_REF");
  }
  return trimmed;
}

/**
 * Resolves Git commit author identity from the acting user (never the project owner
 * unless the owner is the one committing).
 */
export async function resolveGitAuthorIdentity(userId, override = {}, db = prisma) {
  let user = null;
  if (userId && db?.user?.findUnique) {
    user = await db.user
      .findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, githubLogin: true },
      })
      .catch(() => null);
  }

  const cleanField = (raw) =>
    typeof raw === "string" ? raw.replace(/[\r\n\0<>]/g, "").trim() : "";

  const name =
    cleanField(override.authorName) ||
    cleanField(user?.name) ||
    cleanField(user?.githubLogin) ||
    "CovAI Developer";

  const fallbackEmail = cleanField(user?.githubLogin)
    ? `${cleanField(user.githubLogin)}@users.noreply.github.com`
    : "developer@covai.dev";

  const email =
    cleanField(override.authorEmail) ||
    cleanField(user?.email) ||
    fallbackEmail;

  return { name, email };
}

/**
 * Retrieves the GitHub OAuth access token strictly for the acting user.
 * Never borrows or falls back to the project owner's token for an EDITOR.
 */
export async function resolveActingUserGithubToken(
  userId,
  { requireRepoScope = false, db = prisma } = {},
) {
  if (!userId) {
    throw new ServiceError(
      AUTH_MESSAGES.GITHUB_TOKEN_REVOKED,
      401,
      AUTH_ERROR_CODES.GITHUB_TOKEN_REVOKED,
    );
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      githubAccessTokenEnc: true,
      githubOAuthScopes: true,
      githubLogin: true,
    },
  });

  if (!user?.githubAccessTokenEnc) {
    throw new ServiceError(
      AUTH_MESSAGES.GITHUB_TOKEN_REVOKED,
      401,
      AUTH_ERROR_CODES.GITHUB_TOKEN_REVOKED,
    );
  }

  let token = user.githubAccessTokenEnc;
  if (isEncryptedFormat(token)) {
    try {
      token = decrypt(token);
    } catch {
      throw new ServiceError(
        AUTH_MESSAGES.GITHUB_TOKEN_REVOKED,
        401,
        AUTH_ERROR_CODES.GITHUB_TOKEN_REVOKED,
      );
    }
  }

  const scopes = parseGithubScopes(user.githubOAuthScopes);
  if (
    requireRepoScope &&
    user.githubOAuthScopes &&
    !hasGithubRepoWriteScope(scopes)
  ) {
    throw new ServiceError(
      AUTH_MESSAGES.GITHUB_REPO_SCOPE_REQUIRED,
      403,
      AUTH_ERROR_CODES.GITHUB_REPO_SCOPE_REQUIRED,
    );
  }

  return {
    token,
    login: user.githubLogin || null,
    scopes,
  };
}

/**
 * Safely executes `git` without a shell, using transient HTTP header auth,
 * safe config overrides, cross-platform timeout handling, and secret scrubbing.
 */
export function execGit(rootDir, args = [], options = {}) {
  const safeArgs = Array.isArray(args) ? [...args] : [];
  const prefixArgs = [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "credential.helper=",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.quotepath=false",
    "-c",
    "safe.directory=*",
  ];

  const allowLocal =
    options.allowLocalTransport === true && process.env.NODE_ENV === "test";
  if (!allowLocal) {
    prefixArgs.push("-c", "protocol.file.allow=never");
  }

  const secretsToRedact = [];
  if (options.githubToken) {
    const basicB64 = Buffer.from(
      `x-access-token:${options.githubToken}`,
      "utf8",
    ).toString("base64");
    prefixArgs.push(
      "-c",
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basicB64}`,
    );
    secretsToRedact.push(options.githubToken, basicB64);
  }

  const authorEnv = {};
  if (options.author?.name || options.author?.email) {
    const authorName = options.author.name || "CovAI Developer";
    const authorEmail = options.author.email || "developer@covai.dev";
    prefixArgs.push(
      "-c",
      `user.name=${authorName}`,
      "-c",
      `user.email=${authorEmail}`,
      "-c",
      "commit.gpgsign=false",
    );
    authorEnv.GIT_AUTHOR_NAME = authorName;
    authorEnv.GIT_AUTHOR_EMAIL = authorEmail;
    authorEnv.GIT_COMMITTER_NAME = authorName;
    authorEnv.GIT_COMMITTER_EMAIL = authorEmail;
  }

  const fullArgs = [...prefixArgs, ...safeArgs];
  const timeoutMs =
    options.timeoutMs ??
    (options.isNetwork
      ? Number(process.env.GIT_NETWORK_TIMEOUT_MS || DEFAULT_NETWORK_TIMEOUT_MS)
      : Number(process.env.GIT_LOCAL_TIMEOUT_MS || DEFAULT_LOCAL_TIMEOUT_MS));

  const redactedCommand = redactGitOutput(
    `git ${safeArgs.join(" ")}`,
    secretsToRedact,
  );

  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      fullArgs,
      {
        cwd: rootDir,
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
        encoding: options.encoding ?? "utf8",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
          ...authorEnv,
          ...(options.env || {}),
        },
      },
      (error, stdout = "", stderr = "") => {
        const cleanStderr = redactGitOutput(String(stderr || ""), secretsToRedact);
        const cleanStdout = redactGitOutput(String(stdout || ""), secretsToRedact);

        if (error) {
          const isTimeout = Boolean(error.killed || error.code === "ETIMEDOUT");
          const rawErr = cleanStderr || cleanStdout || error.message || "Git command failed";
          const cleanErrMsg = redactGitOutput(rawErr, secretsToRedact).trim();
          const serviceError = new ServiceError(
            cleanErrMsg || "Git operation failed",
            isTimeout ? 504 : 500,
            isTimeout ? "GIT_TIMEOUT" : "GIT_COMMAND_FAILED",
            {
              exitCode: typeof error.code === "number" ? error.code : null,
              stderr: cleanStderr.trim(),
              stdout: cleanStdout.trim(),
              command: redactedCommand,
            },
          );
          reject(serviceError);
          return;
        }

        resolve({
          stdout:
            options.encoding === "buffer"
              ? Buffer.isBuffer(stdout)
                ? stdout
                : Buffer.from(stdout || "")
              : options.rawOutput
                ? cleanStdout
                : cleanStdout.trim(),
          stderr: options.rawOutput ? cleanStderr : cleanStderr.trim(),
          redactedCommand,
        });
      },
    );

    if (options.input !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
  });
}
