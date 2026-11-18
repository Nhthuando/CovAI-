import express from "express";
import {
  login,
  register,
  oAuthGithub,
  connectGithub,
  githubOAuthAccess,
  getGithubRepositories,
  getRefreshCookieOptions,
} from "../controllers/auth.controller.js";
import prisma from "../config/prisma.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  forgotPassword,
  resetPassword,
} from "../controllers/forgotPassword.controller.js";
import { authLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/login", authLimiter, login);
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
router.get("/github/callback", oAuthGithub);
router.post("/github/connect", authMiddleware, connectGithub);
router.post("/github/access", authMiddleware, githubOAuthAccess);
router.get("/github/repositories", authMiddleware, getGithubRepositories);

export default router;

