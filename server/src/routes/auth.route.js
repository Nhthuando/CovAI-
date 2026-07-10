import express from "express";
import {
  login,
  register,
  oAuthGithub,
  githubOAuthAccess,
  getGithubRepositories,
} from "../controllers/auth.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  forgotPassword,
  resetPassword,
} from "../controllers/forgotPassword.controller.js";
import { authLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/login", authLimiter, login);
router.post("/register", authLimiter, register);
router.post("/logout", authMiddleware, (req, res) => {
  // Stateless JWT — client chỉ cần xóa token phía client
  return res.status(200).json({ message: "Đăng xuất thành công!" });
});
router.post("/forgotPassword", authLimiter, forgotPassword);
router.post("/resetPassword/:token", authLimiter, resetPassword);
router.get("/github/callback", oAuthGithub);
router.post("/github/access", authMiddleware, githubOAuthAccess);
router.get("/github/repositories", authMiddleware, getGithubRepositories);

export default router;

