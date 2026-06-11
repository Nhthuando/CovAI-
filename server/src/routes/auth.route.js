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

const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.post("/forgotPassword", forgotPassword);
router.post("/resetPassword/:token", resetPassword);
router.get("/github/callback", oAuthGithub);
router.post("/github/access", authMiddleware, githubOAuthAccess);
router.get("/github/repositories", authMiddleware, getGithubRepositories);

export default router;
