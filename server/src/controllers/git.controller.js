import { GitService } from "../services/git.service.js";

/**
 * Handle Git operations (add, commit, push)
 * POST /git/command
 */
export const handleGitCommand = async (req, res) => {
  try {
    const { projectId, command, args } = req.body;
    const userId = req.user?.id;

    console.log("[GIT API] Body received:", req.body, "User ID:", userId);
    if (!userId || !projectId || !command) {
      console.error("[GIT API] 400: Missing params", {
        userId,
        projectId,
        command,
      });
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Basic security check: Only allow specific commands
    const allowedCommands = ["add", "commit", "push", "status", "log", "pull"];
    if (!allowedCommands.includes(command)) {
      return res.status(400).json({ error: "Command not allowed" });
    }

    // Handle specific logic for commands
    let result;
    try {
      if (command === "pull") {
        await GitService.runGitCommand(projectId, "fetch", ["origin"]);
        result = await GitService.runGitCommand(projectId, "reset", [
          "--hard",
          "origin/main",
        ]);
      } else {
        result = await GitService.runGitCommand(projectId, command, args || []);
      }
      return res.status(200).json({ success: true, result });
    } catch (err) {
      console.error("[GIT API] Service error details:", err);
      return res.status(502).json({
        error: err.message || "Failed to execute git command",
        meta: {
          kind: err?.constructor?.name,
          stack: err?.stack,
        },
      });
    }
  } catch (error) {
    console.error("[GitController] Error executing git command:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to execute git command" });
  }
};
