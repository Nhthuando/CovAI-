import express from "express";
import {
  cloneGitHubRepositoryByUrl,
  importGitHubRepository,
} from "../controllers/github.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post(
  "/projects/:projectId/import-github-url",
  authMiddleware,
  cloneGitHubRepositoryByUrl,
);

router.post(
  "/projects/:projectId/import-github-repo",
  authMiddleware,
  importGitHubRepository,
);

export default router;
