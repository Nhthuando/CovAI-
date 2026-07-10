import rateLimit from "express-rate-limit";

/**
 * Global rate limiter — áp dụng cho tất cả requests.
 * 3000 requests / 15 phút / IP.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Quá nhiều requests, vui lòng thử lại sau 15 phút.",
  },
});

/**
 * Auth rate limiter — cho login, register, forgot password.
 * 10 requests / 15 phút / IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Quá nhiều lần thử, vui lòng thử lại sau 15 phút.",
  },
});

/**
 * AI rate limiter — cho các endpoint AI (chat, suggest, tests).
 * 100 requests / 15 phút / IP.
 */
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Quá nhiều yêu cầu AI, vui lòng thử lại sau.",
  },
});
