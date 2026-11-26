import rateLimit from "express-rate-limit";
import { isCollaborationLocalTest } from "../config/collaborationLocal.js";
import { AUTH_ERROR_CODES } from "../../../shared/authValidation.js";

/**
 * Global rate limiter — applies to all requests.
 * 3000 requests / 15 minutes / IP.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again in 15 minutes.",
  },
});

/**
 * High-threshold IP DDoS guard for local login & link-password verification.
 * Separated from per-account 5-attempt lockout (BR01.1) so locking Account 1
 * never blocks Account 2 from the same IP.
 */
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isCollaborationLocalTest()
    ? 1000
    : Number(process.env.LOGIN_IP_RATE_LIMIT_MAX || 100),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED,
    message: "Too many login requests from this IP, please try again later.",
  },
});

/**
 * Auth rate limiter — for register, forgot password, and reset password.
 * 10 requests / 15 minutes / IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isCollaborationLocalTest() ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED,
    message: "Too many attempts, please try again in 15 minutes.",
  },
});

/**
 * GitHub OAuth endpoint rate limiter.
 * 60 requests / 15 minutes / IP.
 */
export const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isCollaborationLocalTest() ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED,
    message: "Too many OAuth attempts, please try again in a few minutes.",
  },
});

/**
 * AI rate limiter — for AI endpoints (chat, suggest, tests).
 * 100 requests / 15 minutes / IP.
 */
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many AI requests, please try again later.",
  },
});

/**
 * Git remote / GitHub API rate limiter — protects network endpoints (push, pull, fetch, PRs, publish).
 */
export const gitRemoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:
    isCollaborationLocalTest() || process.env.NODE_ENV === "test"
      ? 1000
      : Number(process.env.GIT_REMOTE_RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED,
    message: "Too many remote Git operations, please wait a moment and try again.",
  },
});
