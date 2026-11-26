import { enforceProjectEndpointPolicy } from '../middlewares/projectEndpointPolicy.js';
import express from "express";
import {
  cloneGitHubRepositoryByUrl,
  importGitHubRepository,
} from "../controllers/github.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { requireAuthProvider } from "../middlewares/requireAuthProvider.middleware.js";
import { AUTH_PROVIDERS } from "../../../shared/versionControlMode.js";

const router = express.Router();
router.use(authMiddleware, enforceProjectEndpointPolicy('github'));

router.post(
  "/projects/:projectId/import-github-url",
  cloneGitHubRepositoryByUrl,
);

router.post(
  "/projects/:projectId/import-github-repo",
  requireAuthProvider(AUTH_PROVIDERS.GITHUB),
  importGitHubRepository,
);

export default router;
