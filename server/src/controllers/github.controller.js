import fs from "fs";
import path from "path";
import { GitHubCloneService } from "../services/githubClone.service.js";
import { GitHubRepositoryAccessService } from "../services/github.service.js";
import prisma from "../config/prisma.js";
import { detectJest } from "../utils/jestDetector.js";
import { buildCfgForSnapshot } from "../services/buildCfg.service.js";
import { detectLanguageFromDirectory } from "../utils/languageDetector.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { clearProjectTreeCache } from "../services/project.service.js";
import * as projectAccessModule from "../services/projectAccess.service.js";
import { clearPortfolioCache } from "../services/portfolioDashboard.service.js";

async function finalizeGitHubImportSnapshot({ projectId, ownerId, cloneResult, repoUrl }) {
  const existing = await prisma.projectSnapshot.findFirst({
    where: { projectId, commitSha: cloneResult.commitSha },
    select: {
      id: true,
      testingFrameworksJson: true,
      rootDir: true,
      storagePath: true,
    },
  });

  if (existing && existing.rootDir && fs.existsSync(existing.rootDir)) {
    try {
      fs.rmSync(path.dirname(cloneResult.localPath), { recursive: true, force: true });
    } catch (_) {}

    await prisma.project.update({
      where: { id: projectId },
      data: {
        repoUrl,
        defaultBranch: cloneResult.defaultBranch || "main",
        activeSnapshotId: existing.id,
        workspaceRevision: { increment: 1 },
      },
    }).catch((err) => console.error("Error activating existing GitHub snapshot:", err));

    projectAccessModule.invalidateProjectAccessCache?.(projectId);
    clearProjectTreeCache();
    if (ownerId) clearPortfolioCache(ownerId);

    let testingFrameworks = [];
    try {
      testingFrameworks = JSON.parse(existing.testingFrameworksJson || "[]");
    } catch (_) {}

    return { snapshot: existing, testingFrameworks, reused: true };
  }

  const resolvedRootDir = resolveProjectRoot(cloneResult.localPath) || cloneResult.localPath;
  const detection = detectJest(resolvedRootDir);

  const snapshot = existing
    ? await prisma.projectSnapshot.update({
        where: { id: existing.id },
        data: {
          storagePath: cloneResult.localPath,
          rootDir: resolvedRootDir,
          hasJest: detection.hasJest,
          jestConfigPath: detection.configPath,
          jestCommand: detection.jestCommand,
          testingFrameworksJson: JSON.stringify(detection.testingFrameworks),
        },
      })
    : await prisma.projectSnapshot.create({
        data: {
          projectId,
          source: "GITHUB",
          commitSha: cloneResult.commitSha,
          storagePath: cloneResult.localPath,
          rootDir: resolvedRootDir,
          hasJest: detection.hasJest,
          jestConfigPath: detection.configPath,
          jestCommand: detection.jestCommand,
          testingFrameworksJson: JSON.stringify(detection.testingFrameworks),
        },
      });

  await prisma.project
    .update({
      where: { id: projectId },
      data: {
        repoUrl,
        defaultBranch: cloneResult.defaultBranch || "main",
        activeSnapshotId: snapshot.id,
        workspaceRevision: { increment: 1 },
      },
    })
    .catch((err) => console.error("Error updating project repoUrl:", err));

  projectAccessModule.invalidateProjectAccessCache?.(projectId);
  clearProjectTreeCache();
  if (ownerId) clearPortfolioCache(ownerId);

  return { snapshot, testingFrameworks: detection.testingFrameworks, reused: false };
}

export const cloneGitHubRepositoryByUrl = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        message: "Invalid repository URL provided.",
      });
    }

    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      return res.status(400).json({ message: "Invalid GitHub URL format." });
    }

    const owner = match[1];
    const repo = match[2].replace(".git", "");

    // For GitHub sessions only, probe private repo status using acting user's token
    if (req.user?.id && req.user?.authProvider === "github") {
      try {
        const userToken = await GitHubRepositoryAccessService.getGitHubToken(
          req.user.id,
        );
        if (userToken) {
          const apiRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}`,
            {
              headers: {
                Authorization: `Bearer ${userToken}`,
                Accept: "application/vnd.github.v3+json",
                "User-Agent": "CovAI-App",
              },
            },
          );
          if (apiRes.ok) {
            const repoData = await apiRes.json();
            if (repoData.private) {
              return res
                .status(400)
                .json({ message: "This Repository is private" });
            }
          }
        }
      } catch (_) {}
    }

    // Cloning by URL is public
    const cloneResult = await GitHubCloneService.cloneRepository(
      null,
      projectId,
      owner,
      repo,
      false,
    );

    // Validate project language (must be JavaScript or TypeScript)
    const langCheck = detectLanguageFromDirectory(cloneResult.localPath);
    if (!langCheck.isSupported) {
      console.warn(
        `[GitHub Import URL] Rejected non-JS/TS repo: ${langCheck.reason}`,
      );
      try {
        fs.rmSync(cloneResult.localPath, { recursive: true, force: true });
      } catch (_) {}
      return res.status(400).json({
        message: langCheck.reason,
        detectedLanguage: langCheck.primaryLanguage,
      });
    }

    const { snapshot, testingFrameworks, reused } = await finalizeGitHubImportSnapshot({
      projectId,
      ownerId: req.user?.id,
      cloneResult,
      repoUrl: url,
    });

    if (!reused && req.user?.authProvider === "email") {
      try {
        const { ensureProjectCasBaseline } = await import("../services/snapshotCas.service.js");
        await ensureProjectCasBaseline({
          projectId,
          snapshotId: snapshot.id,
          userId: req.user?.id,
          rootDir: cloneResult.localPath,
        });
      } catch (casErr) {
        console.warn("[GitHub Import URL] CAS baseline warning:", casErr?.message || casErr);
      }
    }

    if (!reused) {
      // Build CFG in background
      buildCfgForSnapshot(snapshot.id).catch((err) => {
        console.error("Error building CFG for GitHub URL import:", err);
      });
    }

    res.status(200).json({
      ...cloneResult,
      snapshotId: snapshot.id,
      testingFrameworks,
    });
  } catch (error) {
    console.error("Error cloning GitHub repository by URL:", error);
    const errMsg = error.message || "";
    if (
      errMsg.includes("This Repository is private") ||
      errMsg.includes("Authentication failed") ||
      errMsg.includes("could not read Username") ||
      errMsg.includes("terminal prompts disabled") ||
      errMsg.includes("Access denied") ||
      errMsg.includes("Repository not found") ||
      error.statusCode === 400 ||
      error.statusCode === 403 ||
      error.statusCode === 404
    ) {
      return res.status(400).json({ message: "This Repository is private" });
    }
    const statusCode = error.statusCode || 500;
    const message = error.message || "Error during repository cloning.";
    res.status(statusCode).json({ message });
  }
};

export const importGitHubRepository = async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;
    const { owner, repo } = req.body;

    if (!owner || !repo) {
      return res.status(400).json({
        message:
          "Invalid repository information provided. Please provide owner and repo.",
      });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId, ownerId: userId },
    });

    if (!project) {
      return res
        .status(404)
        .json({ message: "Project not found or not accessible." });
    }

    const cloneResult = await GitHubCloneService.cloneRepository(
      userId,
      projectId,
      owner,
      repo,
      true,
    );

    // Validate project language (must be JavaScript or TypeScript)
    const langCheck = detectLanguageFromDirectory(cloneResult.localPath);
    if (!langCheck.isSupported) {
      console.warn(
        `[GitHub Import Repo] Rejected non-JS/TS repo: ${langCheck.reason}`,
      );
      try {
        fs.rmSync(cloneResult.localPath, { recursive: true, force: true });
      } catch (_) {}
      return res.status(400).json({
        message: langCheck.reason,
        detectedLanguage: langCheck.primaryLanguage,
      });
    }

    const repoUrl = `https://github.com/${owner}/${repo}`;
    const { snapshot, testingFrameworks, reused } = await finalizeGitHubImportSnapshot({
      projectId,
      ownerId: userId,
      cloneResult,
      repoUrl,
    });

    if (!reused) {
      // Build CFG in background
      buildCfgForSnapshot(snapshot.id).catch((err) => {
        console.error("Error building CFG for GitHub Repo import:", err);
      });
    }

    res.status(200).json({
      ...cloneResult,
      snapshotId: snapshot.id,
      testingFrameworks,
    });
  } catch (error) {
    console.error("Error importing GitHub repository:", error);

    if (error.message === "Repository not found") {
      return res.status(404).json({ message: "Repository not found." });
    } else if (error.message === "Access denied") {
      return res.status(403).json({
        message:
          "Access denied. Invalid credentials or insufficient permissions.",
      });
    } else if (error.message === "Invalid repository") {
      return res.status(400).json({ message: "Invalid repository format." });
    } else if (error.message === "Missing GitHub token") {
      return res.status(400).json({
        message:
          "GitHub authentication token is missing. Please connect your GitHub account.",
      });
    } else if (error.message.includes("clone failure")) {
      return res.status(500).json({
        message: "Failed to clone repository due to an internal error.",
      });
    } else if (error.message.includes("Network failure")) {
      return res
        .status(503)
        .json({ message: "Network error during clone operation." });
    } else {
      return res.status(500).json({
        message: "An unexpected error occurred during repository cloning.",
      });
    }
  }
};
