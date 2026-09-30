import rateLimit from "express-rate-limit";

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
  max: 10,
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
