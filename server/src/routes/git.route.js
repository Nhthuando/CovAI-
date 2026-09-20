import express from "express";
import { handleGitCommand } from "../controllers/git.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/command", authMiddleware, handleGitCommand);

export default router;
