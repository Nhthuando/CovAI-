import { GitHubCloneService } from "../services/githubClone.service.js";
import prisma from "../config/prisma.js";
import { detectJest } from "../utils/jestDetector.js";
import { buildCfgForSnapshot } from "../services/buildCfg.service.js";

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

    // Cloning by URL is public
    const cloneResult = await GitHubCloneService.cloneRepository(
      null,
      projectId,
      owner,
      repo,
      false,
    );

    const detection = detectJest(cloneResult.localPath);

    const snapshot = await prisma.projectSnapshot.create({
      data: {
        projectId,
        source: "GITHUB",
        commitSha: cloneResult.commitSha,
        storagePath: cloneResult.localPath,
        rootDir: cloneResult.localPath,
        hasJest: detection.hasJest,
        jestConfigPath: detection.configPath,
        jestCommand: detection.jestCommand,
        testingFrameworksJson: JSON.stringify(detection.testingFrameworks),
      }
    });

    // Build CFG in background
    buildCfgForSnapshot(snapshot.id).catch((err) => {
      console.error("Error building CFG for GitHub URL import:", err);
    });

    res.status(200).json({ ...cloneResult, snapshotId: snapshot.id, testingFrameworks: detection.testingFrameworks });
  } catch (error) {
    console.error("Error cloning GitHub repository by URL:", error);
    res.status(500).json({ message: "Error during repository cloning." });
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

    const detection = detectJest(cloneResult.localPath);

    const snapshot = await prisma.projectSnapshot.create({
      data: {
        projectId,
        source: "GITHUB",
        commitSha: cloneResult.commitSha,
        storagePath: cloneResult.localPath,
        rootDir: cloneResult.localPath,
        hasJest: detection.hasJest,
        jestConfigPath: detection.configPath,
        jestCommand: detection.jestCommand,
        testingFrameworksJson: JSON.stringify(detection.testingFrameworks),
      }
    });

    // Build CFG in background
    buildCfgForSnapshot(snapshot.id).catch((err) => {
      console.error("Error building CFG for GitHub Repo import:", err);
    });

    res.status(200).json({ ...cloneResult, snapshotId: snapshot.id, testingFrameworks: detection.testingFrameworks });
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
