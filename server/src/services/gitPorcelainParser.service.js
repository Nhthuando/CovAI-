import fs from "node:fs";
import path from "node:path";
import {
  GIT_CONFLICT_CODES,
  GIT_FILE_STATUS,
  GIT_REPO_OPERATION_STATE,
  isGitConflictXY,
} from "../../../shared/gitProtocol.js";

const STATUS_LABELS = Object.freeze({
  [GIT_FILE_STATUS.MODIFIED]: "Modified",
  [GIT_FILE_STATUS.ADDED]: "Added",
  [GIT_FILE_STATUS.DELETED]: "Deleted",
  [GIT_FILE_STATUS.RENAMED]: "Renamed",
  [GIT_FILE_STATUS.COPIED]: "Copied",
  [GIT_FILE_STATUS.UNTRACKED]: "Untracked",
  [GIT_FILE_STATUS.CONFLICTED]: "Conflicted",
  [GIT_FILE_STATUS.IGNORED]: "Ignored",
});

const CONFLICT_TEXT = Object.freeze({
  DD: "Both Deleted",
  AU: "Added by Us",
  UD: "Deleted by Them",
  UA: "Added by Them",
  DU: "Deleted by Us",
  AA: "Both Added",
  UU: "Both Modified",
});

const EXT_LANGUAGE_MAP = Object.freeze({
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".md": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sql": "sql",
  ".sh": "shell",
  ".py": "python",
  ".prisma": "prisma",
  ".txt": "plaintext",
});

export function normalizePosixPath(filePath) {
  if (typeof filePath !== "string") return "";
  return filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function detectBinaryBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  const sample = buffer.subarray(0, 8192);
  return sample.includes(0);
}

export function inferLanguageFromPath(filePath) {
  const ext = path.posix.extname(normalizePosixPath(filePath).toLowerCase());
  return EXT_LANGUAGE_MAP[ext] || "plaintext";
}

/**
 * Inspects `.git/` control files to determine whether a merge, rebase,
 * cherry-pick, or revert is currently in progress.
 */
export function detectRepoOperationState(rootDir) {
  const gitDir = path.join(rootDir, ".git");
  if (!fs.existsSync(gitDir)) return GIT_REPO_OPERATION_STATE.IDLE;
  if (fs.existsSync(path.join(gitDir, "MERGE_HEAD"))) {
    return GIT_REPO_OPERATION_STATE.MERGING;
  }
  if (
    fs.existsSync(path.join(gitDir, "rebase-merge")) ||
    fs.existsSync(path.join(gitDir, "rebase-apply"))
  ) {
    return GIT_REPO_OPERATION_STATE.REBASING;
  }
  if (fs.existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"))) {
    return GIT_REPO_OPERATION_STATE.CHERRY_PICKING;
  }
  if (fs.existsSync(path.join(gitDir, "REVERT_HEAD"))) {
    return GIT_REPO_OPERATION_STATE.REVERTING;
  }
  return GIT_REPO_OPERATION_STATE.IDLE;
}

/**
 * Parses `git status --porcelain=v2 --branch --untracked-files=all -z` output.
 * Handles spaces, quotes, Unicode filenames, renames, copies, conflicts,
 * detached HEAD, and unborn initial branches reliably.
 */
export function parsePorcelainV2Z(rawOutput = "") {
  const tokens = String(rawOutput || "").split("\0");
  let branch = null;
  let headOid = null;
  let detached = false;
  let isUnborn = false;
  let tracking = null;
  let ahead = 0;
  let behind = 0;

  const staged = [];
  const unstaged = [];
  const untracked = [];
  const conflicts = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    if (token.startsWith("# ")) {
      if (token.startsWith("# branch.oid ")) {
        const oid = token.slice("# branch.oid ".length).trim();
        if (oid === "(initial)") {
          isUnborn = true;
          headOid = null;
        } else {
          headOid = oid;
        }
      } else if (token.startsWith("# branch.head ")) {
        const headName = token.slice("# branch.head ".length).trim();
        if (headName === "(detached)") {
          detached = true;
          branch = headOid ? headOid.slice(0, 7) : "HEAD";
        } else {
          detached = false;
          branch = headName;
        }
      } else if (token.startsWith("# branch.upstream ")) {
        tracking = token.slice("# branch.upstream ".length).trim() || null;
      } else if (token.startsWith("# branch.ab ")) {
        const abPart = token.slice("# branch.ab ".length).trim();
        const match = abPart.match(/^\+(\d+)\s+-(\d+)$/);
        if (match) {
          ahead = Number.parseInt(match[1], 10);
          behind = Number.parseInt(match[2], 10);
        }
      }
      continue;
    }

    if (token.startsWith("? ")) {
      const filePath = normalizePosixPath(token.slice(2));
      if (filePath) {
        untracked.push({
          path: filePath,
          status: GIT_FILE_STATUS.UNTRACKED,
          statusText: STATUS_LABELS[GIT_FILE_STATUS.UNTRACKED],
        });
      }
      continue;
    }

    if (token.startsWith("! ")) {
      continue;
    }

    // Ordinary changed entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    if (token.startsWith("1 ")) {
      const match = token.match(
        /^1\s+([^\s]{2})\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/,
      );
      if (!match) continue;
      const xy = match[1];
      const filePath = normalizePosixPath(match[2]);
      pushChangedEntry(xy, filePath, null, null, { staged, unstaged, conflicts });
      continue;
    }

    // Rename or copy entry: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\0<origPath>
    if (token.startsWith("2 ")) {
      const match = token.match(
        /^2\s+([^\s]{2})\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/,
      );
      if (!match) continue;
      const xy = match[1];
      const filePath = normalizePosixPath(match[2]);
      const origPath = normalizePosixPath(tokens[i + 1] || "");
      i += 1; // Consume original path NUL token
      pushChangedEntry(xy, filePath, origPath, null, {
        staged,
        unstaged,
        conflicts,
      });
      continue;
    }

    // Unmerged entry: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
    if (token.startsWith("u ")) {
      const match = token.match(
        /^u\s+([^\s]{2})\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/,
      );
      if (!match) continue;
      const xy = match[1].toUpperCase();
      const filePath = normalizePosixPath(match[2]);
      conflicts.push({
        path: filePath,
        xy,
        status: GIT_FILE_STATUS.CONFLICTED,
        statusText: CONFLICT_TEXT[xy] || "Merge Conflict",
      });
    }
  }

  return {
    branch,
    headOid,
    detached,
    isUnborn,
    tracking,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    conflicts,
    clean:
      staged.length === 0 &&
      unstaged.length === 0 &&
      untracked.length === 0 &&
      conflicts.length === 0,
  };
}

function pushChangedEntry(xy, filePath, origPath, _unused, { staged, unstaged, conflicts }) {
  if (!filePath || !xy || xy.length < 2) return;
  if (isGitConflictXY(xy)) {
    const upper = xy.toUpperCase();
    conflicts.push({
      path: filePath,
      xy: upper,
      status: GIT_FILE_STATUS.CONFLICTED,
      statusText: CONFLICT_TEXT[upper] || "Merge Conflict",
    });
    return;
  }

  const indexCode = xy[0];
  const workTreeCode = xy[1];

  if (indexCode && indexCode !== ".") {
    staged.push({
      path: filePath,
      ...(origPath ? { origPath } : {}),
      status: indexCode,
      statusText: STATUS_LABELS[indexCode] || "Modified",
    });
  }

  if (workTreeCode && workTreeCode !== ".") {
    unstaged.push({
      path: filePath,
      status: workTreeCode,
      statusText: STATUS_LABELS[workTreeCode] || "Modified",
    });
  }
}

/**
 * Parses unified diff text into structured hunk descriptors + insertion/deletion counts.
 */
export function parseUnifiedDiffHunks(unifiedDiff = "") {
  if (typeof unifiedDiff !== "string" || !unifiedDiff.trim()) {
    return { headerLines: [], hunks: [], insertions: 0, deletions: 0 };
  }

  const normalizedText = unifiedDiff.replace(/\r\n/g, "\n");
  const lines = normalizedText.split("\n");
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const headerLines = [];
  const hunks = [];
  let currentHunk = null;
  let insertions = 0;
  let deletions = 0;

  for (const line of lines) {
    const hunkMatch = line.match(
      /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/,
    );
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        index: hunks.length,
        header: line,
        oldStart: Number.parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] !== undefined ? Number.parseInt(hunkMatch[2], 10) : 1,
        newStart: Number.parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] !== undefined ? Number.parseInt(hunkMatch[4], 10) : 1,
        lines: [],
        patch: "",
      };
      continue;
    }

    if (!currentHunk) {
      headerLines.push(line);
      continue;
    }

    currentHunk.lines.push(line);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      insertions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }

  if (currentHunk) hunks.push(currentHunk);

  for (const hunk of hunks) {
    hunk.patch = [hunk.header, ...hunk.lines].join("\n") + "\n";
  }

  return {
    headerLines,
    hunks,
    insertions,
    deletions,
  };
}

/**
 * Parses `git log --format=%x1e%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%ar%x1f%D%x1f%s%x1f%b`
 */
export function parseGitLogRecords(rawOutput = "") {
  if (typeof rawOutput !== "string" || !rawOutput.trim()) return [];
  const records = rawOutput.split("\x1e").filter((rec) => rec.trim().length > 0);

  return records.map((record) => {
    const fields = record.split("\x1f");
    const [
      hash = "",
      shortHash = "",
      parentsRaw = "",
      author = "",
      email = "",
      dateIso = "",
      relativeDate = "",
      refsRaw = "",
      subject = "",
      ...bodyRest
    ] = fields;

    const cleanHash = hash.trim();
    const cleanSubject = subject.trim();
    const cleanBody = bodyRest.join("\x1f").trim();
    const parents = parentsRaw
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const refs = refsRaw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      hash: cleanHash,
      shortHash: shortHash.trim() || cleanHash.slice(0, 7),
      parents,
      author: author.trim(),
      email: email.trim(),
      dateIso: dateIso.trim(),
      relativeDate: relativeDate.trim(),
      date: relativeDate.trim(),
      refs,
      subject: cleanSubject,
      body: cleanBody,
      message: cleanSubject,
    };
  });
}

export { GIT_CONFLICT_CODES };
