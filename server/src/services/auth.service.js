import prisma from "../config/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { ServiceError } from "../utils/serviceError.js";
import { logAuthSecurityEvent } from "../utils/authSecurityLogger.js";
import {
  AUTH_ERROR_CODES,
  AUTH_LIMITS,
  AUTH_MESSAGES,
  formatLockoutMessage,
  normalizeEmail,
} from "../../../shared/authValidation.js";

const JWT_TTL = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const REFRESH_TTL = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

// Constant-time timing guard used when login email does not exist.
const DUMMY_BCRYPT_HASH =
  "$2b$10$CwTycUXWue0Thq9StjUM0uJ8lG1WQe6K0V7V9rB0Y4cE6y3m6w9K.";

export const issueSessionTokensForUser = async (user, extraUserUpdates = {}) => {
  const accessToken = jwt.sign(
    { userId: user.id, userEmail: user.email, userName: user.name },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL },
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: REFRESH_TTL },
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken, ...extraUserUpdates },
    select: { id: true },
  });

  return { accessToken, refreshToken };
};

/**
 * Atomically increment failed password attempts and lock account for 15 minutes
 * once threshold (5 consecutive failures) is reached.
 */
export const recordFailedPasswordAttempt = async (
  user,
  { now = () => new Date(), ip = null, context = "login" } = {},
) => {
  const currentTime = now();

  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });

    if (!fresh) {
      return null;
    }

    if (fresh.lockedUntil && fresh.lockedUntil > currentTime) {
      return {
        locked: true,
        alreadyLocked: true,
        failedLoginAttempts: fresh.failedLoginAttempts,
        lockedUntil: fresh.lockedUntil,
        email: fresh.email,
      };
    }

    const wasExpiredLock = Boolean(
      fresh.lockedUntil && fresh.lockedUntil <= currentTime,
    );
    const nextAttempts = wasExpiredLock
      ? 1
      : (fresh.failedLoginAttempts || 0) + 1;
    const shouldLock = nextAttempts >= AUTH_LIMITS.MAX_FAILED_LOGIN_ATTEMPTS;
    const nextLockedUntil = shouldLock
      ? new Date(currentTime.getTime() + AUTH_LIMITS.ACCOUNT_LOCKOUT_MS)
      : null;

    const saved = await tx.user.update({
      where: { id: fresh.id },
      data: {
        failedLoginAttempts: nextAttempts,
        lockedUntil: nextLockedUntil,
      },
      select: {
        id: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });

    return {
      locked: shouldLock,
      alreadyLocked: false,
      failedLoginAttempts: saved.failedLoginAttempts,
      lockedUntil: saved.lockedUntil,
      email: fresh.email,
    };
  });

  if (!updated) {
    return { locked: false, failedLoginAttempts: 0, lockedUntil: null };
  }

  logAuthSecurityEvent(
    updated.locked ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
    {
      userId: user.id,
      email: updated.email,
      ip,
      context,
      failedLoginAttempts: updated.failedLoginAttempts,
      lockedUntil: updated.lockedUntil,
    },
    "warn",
  );

  return updated;
};

export const register = async (name, email, password) => {
  const normalizedEmail = normalizeEmail(email);
  const existEmail = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existEmail) {
    throw new ServiceError(
      "Account already exists!",
      400,
      AUTH_ERROR_CODES.ACCOUNT_EXISTS,
    );
  }

  const hashedPass = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash: hashedPass, name },
    select: { id: true, email: true, name: true },
  });

  const { accessToken, refreshToken } = await issueSessionTokensForUser(user);

  return {
    message: "Registration successful!",
    accessToken,
    refreshToken,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  };
};

export const login = async (
  email,
  password,
  { now = () => new Date(), ip = null } = {},
) => {
  const normalizedEmail = normalizeEmail(email);
  const currentTime = now();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      githubUserId: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    logAuthSecurityEvent("LOGIN_FAILED", {
      email: normalizedEmail,
      ip,
      reason: "user_not_found",
    });
    throw new ServiceError(
      AUTH_MESSAGES.INVALID_CREDENTIALS,
      401,
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  if (user.lockedUntil && user.lockedUntil > currentTime) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((user.lockedUntil.getTime() - currentTime.getTime()) / 1000),
    );
    logAuthSecurityEvent("LOGIN_BLOCKED_LOCKED", {
      userId: user.id,
      email: user.email,
      ip,
      lockedUntil: user.lockedUntil,
      failedLoginAttempts: user.failedLoginAttempts,
    });
    throw new ServiceError(
      formatLockoutMessage(retryAfterSeconds),
      423,
      AUTH_ERROR_CODES.ACCOUNT_LOCKED,
      {
        lockedUntil: user.lockedUntil.toISOString(),
        retryAfterSeconds,
      },
    );
  }

  // TC_LOG_18: GitHub-only user (passwordHash is null) must never crash with 500.
  if (!user.passwordHash) {
    logAuthSecurityEvent("LOGIN_OAUTH_ONLY_REJECTED", {
      userId: user.id,
      email: user.email,
      ip,
      provider: user.githubUserId ? "github" : "oauth",
    });
    throw new ServiceError(
      AUTH_MESSAGES.OAUTH_ONLY_ACCOUNT,
      400,
      AUTH_ERROR_CODES.OAUTH_ONLY_ACCOUNT,
      { provider: "github" },
    );
  }

  const checkPass = await bcrypt.compare(password, user.passwordHash);
  if (!checkPass) {
    const outcome = await recordFailedPasswordAttempt(user, {
      now,
      ip,
      context: "login",
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
      AUTH_MESSAGES.INVALID_CREDENTIALS,
      401,
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  // Reset lockout counters atomically alongside refresh token persistence.
  const { accessToken, refreshToken } = await issueSessionTokensForUser(user, {
    failedLoginAttempts: 0,
    lockedUntil: null,
  });

  return {
    message: "Login successful!",
    accessToken,
    refreshToken,
    userId: user.id,
    name: user.name,
    email: user.email,
  };
};
