import express from "express";
import {
  login,
  register,
  getGithubOAuthUrlController,
  oAuthGithub,
  confirmGithubLink,
  cancelGithubLink,
  connectGithub,
  githubOAuthAccess,
  getGithubRepositories,
  getGithubCapabilities,
  getRefreshCookieOptions,
} from "../controllers/auth.controller.js";
import prisma from "../config/prisma.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  forgotPassword,
  resetPassword,
} from "../controllers/forgotPassword.controller.js";
import {
  authLimiter,
  loginIpLimiter,
  oauthLimiter,
} from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/login", loginIpLimiter, login);
router.post("/register", authLimiter, register);
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    await prisma.user.updateMany({
      where: { id: req.user.id },
      data: { refreshToken: null },
    });
  } catch (err) {
    console.warn("[logout] Failed to clear refresh token in DB:", err?.message || err);
  }
  const { maxAge: _maxAge, ...clearOpts } = getRefreshCookieOptions(req);
  res.clearCookie("refreshToken", clearOpts);
  return res.status(200).json({ message: "Logout successful!" });
});
router.post("/forgotPassword", authLimiter, forgotPassword);
router.post("/resetPassword/:token", authLimiter, resetPassword);
router.get("/github/url", oauthLimiter, getGithubOAuthUrlController);
router.get("/github/callback", oauthLimiter, oAuthGithub);
router.post("/github/confirm-link", loginIpLimiter, confirmGithubLink);
router.post("/github/cancel-link", oauthLimiter, cancelGithubLink);
router.post("/github/connect", authMiddleware, oauthLimiter, connectGithub);
router.post("/github/access", authMiddleware, githubOAuthAccess);
router.get("/github/repositories", authMiddleware, getGithubRepositories);
router.get("/github/capabilities", authMiddleware, getGithubCapabilities);

export default router;
