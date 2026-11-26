import { VC_MODES } from "../../../shared/versionControlMode.js";
import { GIT_REPO_OPERATION_STATE } from "../../../shared/gitProtocol.js";
import { roleAllows } from "../../../shared/projectAccess.js";

const STATUS_META = Object.freeze({
  M: {
    char: "M",
    label: "Modified",
    textClass: "text-[var(--color-warning)]",
    badgeClass:
      "bg-[var(--color-warning)]/12 text-[var(--color-warning)] border border-[var(--color-warning)]/30",
  },
  A: {
    char: "A",
    label: "Added",
    textClass: "text-[var(--color-success)]",
    badgeClass:
      "bg-[var(--color-success)]/12 text-[var(--color-success)] border border-[var(--color-success)]/30",
  },
  U: {
    char: "U",
    label: "Untracked",
    textClass: "text-[var(--color-success)]",
    badgeClass:
      "bg-[var(--color-success)]/12 text-[var(--color-success)] border border-[var(--color-success)]/30",
  },
  D: {
    char: "D",
    label: "Deleted",
    textClass: "text-[var(--color-danger)]",
    badgeClass:
      "bg-[var(--color-danger)]/12 text-[var(--color-danger)] border border-[var(--color-danger)]/30",
  },
  R: {
    char: "R",
    label: "Renamed",
    textClass: "text-[var(--color-secondary)]",
    badgeClass:
      "bg-[var(--color-secondary)]/12 text-[var(--color-secondary)] border border-[var(--color-secondary)]/30",
  },
  C: {
    char: "C",
    label: "Copied",
    textClass: "text-[var(--color-secondary)]",
    badgeClass:
      "bg-[var(--color-secondary)]/12 text-[var(--color-secondary)] border border-[var(--color-secondary)]/30",
  },
  "!": {
    char: "!",
    label: "Conflict",
    textClass: "text-[var(--color-danger)]",
    badgeClass:
      "bg-[var(--color-danger)]/15 text-[var(--color-danger)] border border-[var(--color-danger)]/35",
  },
  " ": {
    char: " ",
    label: "Unchanged",
    textClass: "text-[var(--color-text-muted)]",
    badgeClass:
      "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]",
  },
});

const CONVENTIONAL_SUBJECT_PREFIX_RE = /^[a-z]+(?:\([^)]+\))?!?:\s+/i;
const GITHUB_HTTPS_REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i;

export function formatAiCommitSubject(data) {
  if (!data || typeof data.subject !== "string") return "";
  const rawSubject = data.subject.trim();
  if (!rawSubject) return "";
  if (CONVENTIONAL_SUBJECT_PREFIX_RE.test(rawSubject)) {
    return rawSubject;
  }
  const type = String(data.type || "feat").trim() || "feat";
  const scope = typeof data.scope === "string" ? data.scope.trim() : "";
  return scope ? `${type}(${scope}): ${rawSubject}` : `${type}: ${rawSubject}`;
}

export function isValidGithubRepoUrl(rawUrl) {
  return GITHUB_HTTPS_REPO_RE.test(String(rawUrl || "").trim());
}

export function getVcsStatusMeta(status) {
  const key = String(status || " ").trim().toUpperCase() || " ";
  return STATUS_META[key] || STATUS_META.M;
}

export function resolveVcsModeMeta(vcMode) {
  const isGit = vcMode === VC_MODES.GIT_GITHUB;
  if (isGit) {
    return {
      mode: VC_MODES.GIT_GITHUB,
      badgeLabel: "GIT & GITHUB",
      title: "Git & GitHub Repository",
      subtitle:
        "VS Code-grade staging, commits, branches, 3-way conflict resolution, pull requests, and GitHub sync",
      activityLabel: "Git & GitHub",
      isGit: true,
      isSnapshot: false,
    };
  }
  return {
    mode: VC_MODES.SNAPSHOT_VCS,
    badgeLabel: "SNAPSHOT VCS",
    title: "Snapshots & Checkpoints",
    subtitle:
      "Immutable Content-Addressable version control with local branches, 3-way merge, time-travel, and rollback",
    activityLabel: "Snapshots & Checkpoints",
    isGit: false,
    isSnapshot: true,
  };
}

function addAncestorFolders(folderSet, relativePath) {
  const clean = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  const parts = clean.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i += 1) {
    folderSet.add(parts.slice(0, i).join("/"));
  }
}

export function buildVcsSummary(vcMode, rawStatus) {
  const normalizedMode =
    vcMode === VC_MODES.GIT_GITHUB
      ? VC_MODES.GIT_GITHUB
      : VC_MODES.SNAPSHOT_VCS;
  const fileStatusMap = new Map();
  const folderHasChanges = new Set();

  if (!rawStatus) {
    return {
      mode: normalizedMode,
      isReady: false,
      isInitialized: false,
      branchLabel: normalizedMode === VC_MODES.GIT_GITHUB ? "No Repo" : "main",
      versionBadge: normalizedMode === VC_MODES.GIT_GITHUB ? "" : "#v0",
      ahead: 0,
      behind: 0,
      dirtyCount: 0,
      stagedCount: 0,
      unstagedCount: 0,
      conflictCount: 0,
      operationState: GIT_REPO_OPERATION_STATE.IDLE,
      fileStatusMap,
      folderHasChanges,
      activeSnapshotId: null,
      clean: true,
      rawStatus: null,
    };
  }

  if (normalizedMode === VC_MODES.GIT_GITHUB) {
    const staged = Array.isArray(rawStatus.staged) ? rawStatus.staged : [];
    const unstaged = Array.isArray(rawStatus.unstaged) ? rawStatus.unstaged : [];
    const untracked = Array.isArray(rawStatus.untracked)
      ? rawStatus.untracked
      : [];
    const conflicts = Array.isArray(rawStatus.conflicts)
      ? rawStatus.conflicts
      : [];

    for (const item of staged) {
      if (!item?.path) continue;
      fileStatusMap.set(item.path, item.status || "M");
      addAncestorFolders(folderHasChanges, item.path);
    }
    for (const item of unstaged) {
      if (!item?.path) continue;
      fileStatusMap.set(item.path, item.status || "M");
      addAncestorFolders(folderHasChanges, item.path);
    }
    for (const item of untracked) {
      if (!item?.path) continue;
      fileStatusMap.set(item.path, item.status || "U");
      addAncestorFolders(folderHasChanges, item.path);
    }
    for (const item of conflicts) {
      if (!item?.path) continue;
      fileStatusMap.set(item.path, "!");
      addAncestorFolders(folderHasChanges, item.path);
    }

    const ahead = Number(rawStatus.ahead || 0);
    const behind = Number(rawStatus.behind || 0);
    const dirtyCount = fileStatusMap.size;
    const isInitialized = Boolean(rawStatus.hasGit);
    const syncParts = [];
    if (behind > 0) syncParts.push(`↓${behind}`);
    if (ahead > 0) syncParts.push(`↑${ahead}`);

    return {
      mode: normalizedMode,
      isReady: Boolean(rawStatus.isReady ?? true),
      isInitialized,
      branchLabel: isInitialized
        ? rawStatus.detached
          ? `detached@${rawStatus.headOid?.slice(0, 7) || "HEAD"}`
          : rawStatus.branch || "main"
        : "Not Initialized",
      versionBadge: syncParts.join(" "),
      ahead,
      behind,
      dirtyCount,
      stagedCount: staged.length,
      unstagedCount: unstaged.length + untracked.length,
      conflictCount: conflicts.length,
      operationState: rawStatus.operationState || GIT_REPO_OPERATION_STATE.IDLE,
      fileStatusMap,
      folderHasChanges,
      activeSnapshotId: rawStatus.activeSnapshotId || null,
      clean: dirtyCount === 0,
      rawStatus,
    };
  }

  // Snapshot VCS mode
  const staged = Array.isArray(rawStatus.staged) ? rawStatus.staged : [];
  const unstaged = Array.isArray(rawStatus.unstaged) ? rawStatus.unstaged : [];

  for (const item of staged) {
    if (!item?.path) continue;
    fileStatusMap.set(item.path, item.status || "M");
    addAncestorFolders(folderHasChanges, item.path);
  }
  for (const item of unstaged) {
    if (!item?.path) continue;
    fileStatusMap.set(item.path, item.status || "M");
    addAncestorFolders(folderHasChanges, item.path);
  }

  const branchName = rawStatus.activeBranch?.name || "main";
  const versionNumber = rawStatus.headCheckpoint?.versionNumber;
  const versionBadge = versionNumber ? `#v${versionNumber}` : "#v1";
  const dirtyCount = fileStatusMap.size;

  return {
    mode: normalizedMode,
    isReady: Boolean(rawStatus.initialized ?? true),
    isInitialized: Boolean(rawStatus.initialized ?? true),
    branchLabel: branchName,
    versionBadge,
    ahead: 0,
    behind: 0,
    dirtyCount,
    stagedCount: staged.length,
    unstagedCount: unstaged.length,
    conflictCount: 0,
    operationState: GIT_REPO_OPERATION_STATE.IDLE,
    fileStatusMap,
    folderHasChanges,
    activeSnapshotId: rawStatus.activeSnapshotId || null,
    clean: dirtyCount === 0,
    rawStatus,
  };
}

export function buildVcsPermissions(access, vcMode) {
  const role = access?.role || null;
  const can = (cap) => {
    if (typeof access?.can === "function") {
      return Boolean(access.can(cap));
    }
    return Boolean(role && roleAllows(role, cap));
  };

  const canRead = can("project.read");
  const canLocalWrite = can("vcs.local");
  const canRemoteWrite = can("integrations.write");
  const canRestoreAndAdmin = can("snapshot.restore");
  const canExport = can("project.export");
  const canAi = can("ai.use");
  const isGit = vcMode === VC_MODES.GIT_GITHUB;

  const disabledReason = (actionKey) => {
    if (!role) return "Loading workspace permissions...";
    switch (actionKey) {
      case "local":
        return canLocalWrite
          ? ""
          : `Role "${role}" is read-only. Requires OWNER or EDITOR.`;
      case "ai":
        return canAi
          ? ""
          : `Role "${role}" cannot run AI drafting. Requires OWNER or EDITOR.`;
      case "remote":
        return canRemoteWrite
          ? ""
          : isGit
            ? `Only Project OWNER can run remote or branch-level Git actions (your role: ${role}).`
            : `Only Project OWNER can run administrative actions (your role: ${role}).`;
      case "restore":
        return canRestoreAndAdmin
          ? ""
          : `Only Project OWNER can rollback snapshots, checkout branches, merge, delete, or run GC (your role: ${role}).`;
      case "export":
        return canExport
          ? ""
          : `Role "${role}" cannot export archives.`;
      default:
        return "";
    }
  };

  return {
    role,
    isOwner: role === "OWNER",
    isEditor: role === "EDITOR",
    isViewer: role === "VIEWER",
    canRead,
    canLocalWrite,
    canRemoteWrite,
    canRestoreAndAdmin,
    canExport,
    canAi,
    disabledReason,
  };
}

/**
 * Converts a flat list of changed items (`{ path, status, ... }`) into a sorted folder/file tree.
 */
export function buildChangesFileTree(items = []) {
  const root = { type: "folder", name: "", path: "", childrenMap: new Map(), items: [] };

  for (const item of items) {
    if (!item?.path) continue;
    const cleanPath = String(item.path).replace(/\\/g, "/").replace(/^\.\/+/, "");
    const parts = cleanPath.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i];
      const folderPath = parts.slice(0, i + 1).join("/");
      if (!cursor.childrenMap.has(seg)) {
        cursor.childrenMap.set(seg, {
          type: "folder",
          name: seg,
          path: folderPath,
          childrenMap: new Map(),
          items: [],
        });
      }
      cursor = cursor.childrenMap.get(seg);
    }

    cursor.items.push({
      type: "file",
      name: parts[parts.length - 1],
      path: cleanPath,
      item,
    });
  }

  const finalize = (node) => {
    const folders = [...node.childrenMap.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(finalize);
    const files = [...node.items].sort((a, b) => a.name.localeCompare(b.name));
    return {
      type: "folder",
      name: node.name,
      path: node.path,
      children: [...folders, ...files],
    };
  };

  return finalize(root).children;
}

const GRAPH_LANE_COLORS = [
  "#7ba3c9",
  "#6fa38b",
  "#8d93b8",
  "#b89b6a",
  "#739c99",
  "#ba7279",
];

/**
 * Computes deterministic multi-lane SVG commit/checkpoint graph coordinates.
 */
export function computeCommitGraphLayout(items = []) {
  const rowHeight = 44;
  if (!Array.isArray(items) || items.length === 0) {
    return { nodes: [], edges: [], laneCount: 1, rowHeight };
  }

  const idOf = (entry) => entry?.hash || entry?.id;
  const parentsOf = (entry) => {
    if (Array.isArray(entry?.parents)) return entry.parents.filter(Boolean);
    if (entry?.parentSnapshotId) return [entry.parentSnapshotId];
    return [];
  };

  const activeLanes = [];
  const rowIndexById = new Map();
  items.forEach((item, idx) => {
    const id = idOf(item);
    if (id) rowIndexById.set(id, idx);
  });

  const nodes = [];
  const edges = [];
  let maxLane = 0;

  for (let row = 0; row < items.length; row += 1) {
    const item = items[row];
    const id = idOf(item);
    const parents = parentsOf(item);

    let lane = activeLanes.indexOf(id);
    if (lane === -1) {
      lane = activeLanes.indexOf(null);
      if (lane === -1) {
        lane = activeLanes.length;
        activeLanes.push(id);
      } else {
        activeLanes[lane] = id;
      }
    }

    // Clear extra duplicate lanes converging on this commit
    for (let i = 0; i < activeLanes.length; i += 1) {
      if (i !== lane && activeLanes[i] === id) {
        activeLanes[i] = null;
      }
    }

    maxLane = Math.max(maxLane, lane);
    const color = GRAPH_LANE_COLORS[lane % GRAPH_LANE_COLORS.length];

    // Advance primary lane to first parent, allocate secondary lanes for merge parents
    const primaryParent = parents[0] || null;
    activeLanes[lane] =
      primaryParent && rowIndexById.has(primaryParent) ? primaryParent : null;

    const parentTargets = [];
    if (primaryParent && rowIndexById.has(primaryParent)) {
      parentTargets.push({ parentId: primaryParent, toLane: lane, color });
    }

    for (let p = 1; p < parents.length; p += 1) {
      const pid = parents[p];
      if (!pid || !rowIndexById.has(pid)) continue;
      let existingLane = activeLanes.indexOf(pid);
      if (existingLane === -1) {
        existingLane = activeLanes.indexOf(null);
        if (existingLane === -1) {
          existingLane = activeLanes.length;
          activeLanes.push(pid);
        } else {
          activeLanes[existingLane] = pid;
        }
      }
      maxLane = Math.max(maxLane, existingLane);
      parentTargets.push({
        parentId: pid,
        toLane: existingLane,
        color: GRAPH_LANE_COLORS[existingLane % GRAPH_LANE_COLORS.length],
      });
    }

    // Trim trailing null lanes cleanly
    while (
      activeLanes.length > 0 &&
      activeLanes[activeLanes.length - 1] === null
    ) {
      activeLanes.pop();
    }

    nodes.push({
      id,
      row,
      lane,
      color,
      isMerge: parents.length > 1,
      item,
    });

    for (const target of parentTargets) {
      const toRow = rowIndexById.get(target.parentId);
      if (typeof toRow === "number" && toRow > row) {
        edges.push({
          fromRow: row,
          fromLane: lane,
          toRow,
          toLane: target.toLane,
          color: target.color,
        });
      }
    }
  }

  return {
    nodes,
    edges,
    laneCount: Math.max(1, maxLane + 1),
    rowHeight,
  };
}

export function formatRelativeTime(dateInput) {
  if (!dateInput) return "";
  const ms = Date.now() - new Date(dateInput).getTime();
  if (!Number.isFinite(ms)) return "";
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateInput).toLocaleDateString();
}

/**
 * Extracts authoritative status payload returned directly inside a VCS mutation response
 * so callers can update React Query cache without triggering a redundant GET /status.
 */
export function extractVcsStatusFromResponse(vcMode, response) {
  const payload = response?.data;
  if (!payload || typeof payload !== "object") return null;

  const candidate =
    payload.status && typeof payload.status === "object" ? payload.status : payload;

  if (vcMode === VC_MODES.GIT_GITHUB) {
    return typeof candidate.hasGit === "boolean" ? candidate : null;
  }
  return typeof candidate.initialized === "boolean" ? candidate : null;
}

function matchesTargetPath(itemPath, { files, folder } = {}) {
  const cleanPath = String(itemPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  if (folder) {
    const cleanFolder = String(folder)
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+$/, "");
    return cleanPath === cleanFolder || cleanPath.startsWith(`${cleanFolder}/`);
  }
  if (files === "all" || files === undefined || files === null) {
    return true;
  }
  const targetSet = new Set(Array.isArray(files) ? files : [files]);
  return targetSet.has(itemPath) || targetSet.has(cleanPath);
}

function mergeByPathSorted(existing = [], added = []) {
  const map = new Map();
  for (const item of existing) {
    if (item?.path) map.set(item.path, item);
  }
  for (const item of added) {
    if (item?.path) map.set(item.path, item);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Optimistically moves matching unstaged/untracked items into Staged Changes
 * immediately on click before the server round-trip completes.
 */
export function applyOptimisticStage(vcMode, rawStatus, { files, folder } = {}) {
  if (!rawStatus || typeof rawStatus !== "object") return rawStatus;
  const target = { files, folder };

  if (vcMode === VC_MODES.GIT_GITHUB) {
    const prevStaged = Array.isArray(rawStatus.staged) ? rawStatus.staged : [];
    const prevUnstaged = Array.isArray(rawStatus.unstaged) ? rawStatus.unstaged : [];
    const prevUntracked = Array.isArray(rawStatus.untracked) ? rawStatus.untracked : [];

    const movedFromUnstaged = [];
    const nextUnstaged = [];
    for (const item of prevUnstaged) {
      if (matchesTargetPath(item.path, target)) movedFromUnstaged.push(item);
      else nextUnstaged.push(item);
    }

    const movedFromUntracked = [];
    const nextUntracked = [];
    for (const item of prevUntracked) {
      if (matchesTargetPath(item.path, target)) {
        const rest = { ...item };
        delete rest.isUntracked;
        movedFromUntracked.push({
          ...rest,
          status: item.status === "U" || !item.status ? "A" : item.status,
          statusText: "Added",
        });
      } else {
        nextUntracked.push(item);
      }
    }

    const nextStaged = mergeByPathSorted(prevStaged, [
      ...movedFromUnstaged,
      ...movedFromUntracked,
    ]);
    return {
      ...rawStatus,
      staged: nextStaged,
      unstaged: nextUnstaged,
      untracked: nextUntracked,
      clean:
        nextStaged.length === 0 &&
        nextUnstaged.length === 0 &&
        nextUntracked.length === 0 &&
        (rawStatus.conflicts?.length || 0) === 0,
    };
  }

  const prevStaged = Array.isArray(rawStatus.staged) ? rawStatus.staged : [];
  const prevUnstaged = Array.isArray(rawStatus.unstaged) ? rawStatus.unstaged : [];
  const moved = [];
  const nextUnstaged = [];
  for (const item of prevUnstaged) {
    if (matchesTargetPath(item.path, target)) moved.push(item);
    else nextUnstaged.push(item);
  }
  const nextStaged = mergeByPathSorted(prevStaged, moved);
  return {
    ...rawStatus,
    staged: nextStaged,
    unstaged: nextUnstaged,
  };
}

/**
 * Optimistically moves matching staged items back to Changes before unstage finishes.
 */
export function applyOptimisticUnstage(vcMode, rawStatus, { files, folder } = {}) {
  if (!rawStatus || typeof rawStatus !== "object") return rawStatus;
  const target = { files, folder };

  if (vcMode === VC_MODES.GIT_GITHUB) {
    const prevStaged = Array.isArray(rawStatus.staged) ? rawStatus.staged : [];
    const prevUnstaged = Array.isArray(rawStatus.unstaged) ? rawStatus.unstaged : [];
    const prevUntracked = Array.isArray(rawStatus.untracked) ? rawStatus.untracked : [];

    const nextStaged = [];
    const returnedToUnstaged = [];
    const returnedToUntracked = [];
    for (const item of prevStaged) {
      if (!matchesTargetPath(item.path, target)) {
        nextStaged.push(item);
      } else if (item.status === "A") {
        returnedToUntracked.push({
          ...item,
          status: "U",
          statusText: "Untracked",
          isUntracked: true,
        });
      } else {
        returnedToUnstaged.push(item);
      }
    }

    const nextUnstaged = mergeByPathSorted(prevUnstaged, returnedToUnstaged);
    const nextUntracked = mergeByPathSorted(prevUntracked, returnedToUntracked);
    return {
      ...rawStatus,
      staged: nextStaged,
      unstaged: nextUnstaged,
      untracked: nextUntracked,
      clean:
        nextStaged.length === 0 &&
        nextUnstaged.length === 0 &&
        nextUntracked.length === 0 &&
        (rawStatus.conflicts?.length || 0) === 0,
    };
  }

  const prevStaged = Array.isArray(rawStatus.staged) ? rawStatus.staged : [];
  const prevUnstaged = Array.isArray(rawStatus.unstaged) ? rawStatus.unstaged : [];
  const nextStaged = [];
  const returned = [];
  for (const item of prevStaged) {
    if (matchesTargetPath(item.path, target)) returned.push(item);
    else nextStaged.push(item);
  }
  const nextUnstaged = mergeByPathSorted(prevUnstaged, returned);
  return {
    ...rawStatus,
    staged: nextStaged,
    unstaged: nextUnstaged,
  };
}
