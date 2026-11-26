import { createTwoFilesPatch, diffArrays } from "diff";
import {
  inferLanguageFromPath,
  parseUnifiedDiffHunks,
} from "./gitPorcelainParser.service.js";
import { detectBinaryBuffer } from "./gitPorcelainParser.service.js";
import {
  SNAPSHOT_CHANGE_STATUS,
  SNAPSHOT_VCS_LIMITS,
} from "../../../shared/snapshotVcsProtocol.js";

const STATUS_LABELS = Object.freeze({
  [SNAPSHOT_CHANGE_STATUS.ADDED]: "Added",
  [SNAPSHOT_CHANGE_STATUS.MODIFIED]: "Modified",
  [SNAPSHOT_CHANGE_STATUS.DELETED]: "Deleted",
  [SNAPSHOT_CHANGE_STATUS.RENAMED]: "Renamed",
  [SNAPSHOT_CHANGE_STATUS.UNCHANGED]: "Unchanged",
});

/**
 * Compares two manifests (`Map<path, { sha256, byteSize, isBinary }>`) and detects
 * Added, Modified, Deleted, Unchanged, and Renamed files (by matching SHA-256).
 */
export function diffManifests(baseMap, targetMap) {
  const addedPool = [];
  const deletedPool = [];
  const modified = [];
  const unchangedPaths = [];

  const allPaths = [...new Set([...baseMap.keys(), ...targetMap.keys()])].sort();

  for (const relPath of allPaths) {
    const baseEntry = baseMap.get(relPath);
    const targetEntry = targetMap.get(relPath);

    if (!baseEntry && targetEntry) {
      addedPool.push({ path: relPath, entry: targetEntry });
    } else if (baseEntry && !targetEntry) {
      deletedPool.push({ path: relPath, entry: baseEntry });
    } else if (baseEntry && targetEntry) {
      const baseSha = baseEntry.sha256 || baseEntry.blobSha256;
      const targetSha = targetEntry.sha256 || targetEntry.blobSha256;
      if (baseSha !== targetSha) {
        modified.push({
          path: relPath,
          status: SNAPSHOT_CHANGE_STATUS.MODIFIED,
          statusText: STATUS_LABELS[SNAPSHOT_CHANGE_STATUS.MODIFIED],
          sha256: targetSha,
          prevSha256: baseSha,
          byteSize: targetEntry.byteSize ?? 0,
          prevByteSize: baseEntry.byteSize ?? 0,
          isBinary: Boolean(baseEntry.isBinary || targetEntry.isBinary),
        });
      } else {
        unchangedPaths.push(relPath);
      }
    }
  }

  // Pair deleted and added entries sharing an identical SHA-256 as Renames
  const deletedBySha = new Map();
  for (const item of deletedPool) {
    const sha = item.entry.sha256 || item.entry.blobSha256;
    if (!deletedBySha.has(sha)) deletedBySha.set(sha, []);
    deletedBySha.get(sha).push(item);
  }

  const renamed = [];
  const matchedDeletedPaths = new Set();
  const matchedAddedPaths = new Set();

  for (const addedItem of addedPool) {
    const sha = addedItem.entry.sha256 || addedItem.entry.blobSha256;
    const candidates = deletedBySha.get(sha);
    if (candidates && candidates.length > 0) {
      const deletedMatch = candidates.shift();
      matchedDeletedPaths.add(deletedMatch.path);
      matchedAddedPaths.add(addedItem.path);
      renamed.push({
        path: addedItem.path,
        origPath: deletedMatch.path,
        status: SNAPSHOT_CHANGE_STATUS.RENAMED,
        statusText: STATUS_LABELS[SNAPSHOT_CHANGE_STATUS.RENAMED],
        sha256: sha,
        prevSha256: sha,
        byteSize: addedItem.entry.byteSize ?? 0,
        prevByteSize: deletedMatch.entry.byteSize ?? 0,
        isBinary: Boolean(addedItem.entry.isBinary || deletedMatch.entry.isBinary),
      });
    }
  }

  const added = addedPool
    .filter((item) => !matchedAddedPaths.has(item.path))
    .map((item) => ({
      path: item.path,
      status: SNAPSHOT_CHANGE_STATUS.ADDED,
      statusText: STATUS_LABELS[SNAPSHOT_CHANGE_STATUS.ADDED],
      sha256: item.entry.sha256 || item.entry.blobSha256,
      prevSha256: null,
      byteSize: item.entry.byteSize ?? 0,
      prevByteSize: 0,
      isBinary: Boolean(item.entry.isBinary),
    }));

  const deleted = deletedPool
    .filter((item) => !matchedDeletedPaths.has(item.path))
    .map((item) => ({
      path: item.path,
      status: SNAPSHOT_CHANGE_STATUS.DELETED,
      statusText: STATUS_LABELS[SNAPSHOT_CHANGE_STATUS.DELETED],
      sha256: null,
      prevSha256: item.entry.sha256 || item.entry.blobSha256,
      byteSize: 0,
      prevByteSize: item.entry.byteSize ?? 0,
      isBinary: Boolean(item.entry.isBinary),
    }));

  const changes = [...modified, ...added, ...renamed, ...deleted].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  return {
    changes,
    unchangedPaths,
    stats: {
      added: added.length,
      modified: modified.length,
      deleted: deleted.length,
      renamed: renamed.length,
      unchanged: unchangedPaths.length,
    },
  };
}

/**
 * Builds Monaco `DiffEditor`-ready content and unified hunks for a single file pair.
 */
export function buildDiffPairResult({
  filePath,
  origPath = null,
  originalBuf = Buffer.alloc(0),
  modifiedBuf = Buffer.alloc(0),
  originalLabel = "Base",
  modifiedLabel = "Target",
}) {
  const safeOrig = Buffer.isBuffer(originalBuf)
    ? originalBuf
    : Buffer.from(originalBuf || "");
  const safeMod = Buffer.isBuffer(modifiedBuf)
    ? modifiedBuf
    : Buffer.from(modifiedBuf || "");

  const isBinary = detectBinaryBuffer(safeOrig) || detectBinaryBuffer(safeMod);
  const isTooLarge =
    safeOrig.length > SNAPSHOT_VCS_LIMITS.MAX_DIFF_FILE_BYTES ||
    safeMod.length > SNAPSHOT_VCS_LIMITS.MAX_DIFF_FILE_BYTES;

  const originalContent = isBinary || isTooLarge ? "" : safeOrig.toString("utf8");
  const modifiedContent = isBinary || isTooLarge ? "" : safeMod.toString("utf8");

  let unifiedDiff = "";
  let parsed = { hunks: [], insertions: 0, deletions: 0 };

  if (!isBinary && !isTooLarge && originalContent !== modifiedContent) {
    unifiedDiff = createTwoFilesPatch(
      `a/${origPath || filePath}`,
      `b/${filePath}`,
      originalContent,
      modifiedContent,
      originalLabel,
      modifiedLabel,
      { context: 3 },
    );
    parsed = parseUnifiedDiffHunks(unifiedDiff);
  }

  return {
    filePath,
    origPath: origPath && origPath !== filePath ? origPath : null,
    language: inferLanguageFromPath(filePath),
    isBinary,
    isTooLarge,
    originalLabel,
    modifiedLabel,
    originalContent,
    modifiedContent,
    stats: {
      insertions: parsed.insertions,
      deletions: parsed.deletions,
    },
    hunks: parsed.hunks,
    unifiedDiff,
  };
}

/**
 * Finds the Lowest Common Ancestor (LCA) between two snapshots along `parentSnapshotId`.
 */
export function findLowestCommonAncestor(
  snapshotsById,
  oursSnapshotId,
  theirsSnapshotId,
) {
  if (!oursSnapshotId || !theirsSnapshotId) return null;
  if (oursSnapshotId === theirsSnapshotId) return oursSnapshotId;

  const oursAncestors = new Set();
  let cur = oursSnapshotId;
  while (cur && !oursAncestors.has(cur)) {
    oursAncestors.add(cur);
    cur = snapshotsById.get(cur)?.parentSnapshotId || null;
  }

  const visitedTheirs = new Set();
  cur = theirsSnapshotId;
  while (cur && !visitedTheirs.has(cur)) {
    if (oursAncestors.has(cur)) return cur;
    visitedTheirs.add(cur);
    cur = snapshotsById.get(cur)?.parentSnapshotId || null;
  }

  return null;
}

function splitLinesPreservingNewlines(text) {
  if (!text) return [];
  const normalized = String(text).replace(/\r\n/g, "\n");
  return normalized.split("\n");
}

function extractLineHunks(baseLines, targetLines) {
  const ops = diffArrays(baseLines, targetLines);
  const hunks = [];
  let baseCursor = 0;
  let active = null;

  const flush = () => {
    if (active) {
      hunks.push(active);
      active = null;
    }
  };

  for (const part of ops) {
    if (part.removed || part.added) {
      if (!active) {
        active = { start: baseCursor, end: baseCursor, lines: [] };
      }
      if (part.removed) {
        baseCursor += part.count;
        active.end = baseCursor;
      } else {
        active.lines.push(...part.value);
      }
    } else {
      flush();
      baseCursor += part.count;
    }
  }
  flush();
  return hunks;
}

function applyHunksInRange(baseLines, hunks, rangeStart, rangeEnd) {
  const out = [];
  let cursor = rangeStart;
  for (const h of hunks) {
    if (h.start > cursor) {
      out.push(...baseLines.slice(cursor, h.start));
    }
    out.push(...h.lines);
    cursor = h.end;
  }
  if (cursor < rangeEnd) {
    out.push(...baseLines.slice(cursor, rangeEnd));
  }
  return out;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Deterministic line-level 3-way merge. Auto-merges non-overlapping and identical
 * changes, and emits standard conflict markers on true overlapping edits.
 */
export function threeWayMergeText(
  baseText = "",
  oursText = "",
  theirsText = "",
  { oursLabel = "ours", theirsLabel = "theirs" } = {},
) {
  if (oursText === theirsText) {
    return { conflicted: false, mergedText: oursText };
  }
  if (oursText === baseText) {
    return { conflicted: false, mergedText: theirsText };
  }
  if (theirsText === baseText) {
    return { conflicted: false, mergedText: oursText };
  }

  const baseLines = splitLinesPreservingNewlines(baseText);
  const oursHunks = extractLineHunks(baseLines, splitLinesPreservingNewlines(oursText));
  const theirsHunks = extractLineHunks(
    baseLines,
    splitLinesPreservingNewlines(theirsText),
  );

  const output = [];
  let baseCursor = 0;
  let oi = 0;
  let ti = 0;
  let conflicted = false;

  const hunksOverlap = (a, b) => {
    if (a.start === a.end && b.start === b.end) {
      return a.start === b.start;
    }
    return a.start < b.end && b.start < a.end;
  };

  while (oi < oursHunks.length || ti < theirsHunks.length) {
    const o = oursHunks[oi];
    const t = theirsHunks[ti];

    if (!t || (o && o.end < t.start) || (o && t && o.end === t.start && o.start < t.start && o.end !== t.end)) {
      if (o.start > baseCursor) {
        output.push(...baseLines.slice(baseCursor, o.start));
      }
      output.push(...o.lines);
      baseCursor = o.end;
      oi += 1;
      continue;
    }

    if (!o || t.end < o.start || (t.end === o.start && t.start < o.start && o.end !== t.end)) {
      if (t.start > baseCursor) {
        output.push(...baseLines.slice(baseCursor, t.start));
      }
      output.push(...t.lines);
      baseCursor = t.end;
      ti += 1;
      continue;
    }

    // Collect full overlapping conflict cluster
    const clusterOurs = [o];
    const clusterTheirs = [t];
    let clusterStart = Math.min(o.start, t.start);
    let clusterEnd = Math.max(o.end, t.end);
    oi += 1;
    ti += 1;

    let expanded = true;
    while (expanded) {
      expanded = false;
      while (oi < oursHunks.length && hunksOverlap(oursHunks[oi], { start: clusterStart, end: clusterEnd })) {
        clusterEnd = Math.max(clusterEnd, oursHunks[oi].end);
        clusterOurs.push(oursHunks[oi]);
        oi += 1;
        expanded = true;
      }
      while (ti < theirsHunks.length && hunksOverlap(theirsHunks[ti], { start: clusterStart, end: clusterEnd })) {
        clusterEnd = Math.max(clusterEnd, theirsHunks[ti].end);
        clusterTheirs.push(theirsHunks[ti]);
        ti += 1;
        expanded = true;
      }
    }

    if (clusterStart > baseCursor) {
      output.push(...baseLines.slice(baseCursor, clusterStart));
    }

    const oursResult = applyHunksInRange(baseLines, clusterOurs, clusterStart, clusterEnd);
    const theirsResult = applyHunksInRange(baseLines, clusterTheirs, clusterStart, clusterEnd);

    if (arraysEqual(oursResult, theirsResult)) {
      output.push(...oursResult);
    } else {
      conflicted = true;
      output.push(`<<<<<<< ${oursLabel}`);
      output.push(...oursResult);
      output.push("=======");
      output.push(...theirsResult);
      output.push(`>>>>>>> ${theirsLabel}`);
    }

    baseCursor = clusterEnd;
  }

  if (baseCursor < baseLines.length) {
    output.push(...baseLines.slice(baseCursor));
  }

  return {
    conflicted,
    mergedText: output.join("\n"),
  };
}
