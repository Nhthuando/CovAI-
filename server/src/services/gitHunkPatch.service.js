import { ServiceError } from "../utils/serviceError.js";
import { execGit, sanitizeGitFilePath } from "./gitCredentialHelper.service.js";
import { parseUnifiedDiffHunks } from "./gitPorcelainParser.service.js";

/**
 * Builds a standalone unified patch containing ONLY the specified hunk index
 * together with its file diff header so `git apply` can stage, unstage, or revert it.
 */
export function buildSingleHunkPatch(unifiedDiff, hunkIndex) {
  if (!Number.isInteger(hunkIndex) || hunkIndex < 0) {
    throw new ServiceError("Invalid hunk index", 400, "INVALID_HUNK_INDEX");
  }
  if (typeof unifiedDiff !== "string" || !unifiedDiff.trim()) {
    throw new ServiceError("No diff available for selected hunk", 400, "INVALID_HUNK_INDEX");
  }

  const { headerLines, hunks } = parseUnifiedDiffHunks(unifiedDiff);
  if (!hunks.length || hunkIndex >= hunks.length) {
    throw new ServiceError(
      `Hunk index ${hunkIndex} is out of range`,
      400,
      "INVALID_HUNK_INDEX",
    );
  }

  const targetHunk = hunks[hunkIndex];
  const filteredHeader = headerLines.filter(
    (line) =>
      line.startsWith("diff --git ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("index "),
  );

  if (!filteredHeader.some((line) => line.startsWith("--- ")) ||
      !filteredHeader.some((line) => line.startsWith("+++ "))) {
    throw new ServiceError(
      "Diff header is incomplete for hunk patch application",
      400,
      "INVALID_HUNK_PATCH",
    );
  }

  return `${[...filteredHeader, targetHunk.header, ...targetHunk.lines].join("\n")}\n`;
}

/**
 * Applies a single-hunk operation ("stage", "unstage", or "revert") against a
 * repository working tree or Git index.
 */
export async function applyHunkAction(rootDir, { filePath, hunkIndex, action }) {
  const safePath = sanitizeGitFilePath(filePath);
  if (!["stage", "unstage", "revert"].includes(action)) {
    throw new ServiceError("Invalid hunk action", 400, "INVALID_HUNK_ACTION");
  }

  const diffArgs =
    action === "unstage"
      ? ["diff", "--cached", "--no-color", "-U3", "--", safePath]
      : ["diff", "--no-color", "-U3", "--", safePath];

  const { stdout: unifiedDiff } = await execGit(rootDir, diffArgs, {
    rawOutput: true,
  });

  const patch = buildSingleHunkPatch(unifiedDiff, hunkIndex);

  const applyArgs =
    action === "stage"
      ? ["apply", "--cached", "--recount", "-"]
      : action === "unstage"
        ? ["apply", "--cached", "--reverse", "--recount", "-"]
        : ["apply", "--reverse", "--recount", "-"];

  await execGit(rootDir, applyArgs, { input: patch });
  return { filePath: safePath, hunkIndex, action };
}
