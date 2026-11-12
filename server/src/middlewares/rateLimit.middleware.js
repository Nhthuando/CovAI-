import rateLimit from "express-rate-limit";
import { isCollaborationLocalTest } from '../config/collaborationLocal.js';

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
 * Auth rate limiter — cho login, register, forgot password.
 * 10 requests / 15 minutes / IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isCollaborationLocalTest() ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts, please try again in 15 minutes.",
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
 * Admin Console rate limiter — applies to all /api/admin/* routes.
 * 600 requests / 15 minutes / IP to accommodate data grids & telemetry.
 */
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isCollaborationLocalTest() ? 5000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many admin requests from this IP. Please slow down.",
    code: "ADMIN_RATE_LIMITED",
  },
});
