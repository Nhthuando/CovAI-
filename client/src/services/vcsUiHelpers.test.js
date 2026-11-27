import test from "node:test";
import assert from "node:assert/strict";
import {
  isVcsSecretFileName,
  VC_MODES,
} from "../../../shared/versionControlMode.js";
import { GIT_REPO_OPERATION_STATE } from "../../../shared/gitProtocol.js";
import {
  applyOptimisticStage,
  applyOptimisticUnstage,
  buildChangesFileTree,
  buildRemoteSyncBannerState,
  buildVcsPermissions,
  buildVcsSummary,
  computeCommitGraphLayout,
  extractVcsStatusFromResponse,
  formatAiCommitSubject,
  formatRemoteCheckedAgo,
  getVcsStatusMeta,
  isValidGithubRepoUrl,
  resolveVcsModeMeta,
} from "./vcsUiHelpers.js";
import { gitService } from "./git.service.js";
import { snapshotVcsService } from "./snapshotVcs.service.js";

function setupMockBrowserStorage() {
  const store = new Map();
  const prevStorage = globalThis.localStorage;
  const prevWindow = globalThis.window;

  globalThis.localStorage = {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
  };
  globalThis.localStorage.setItem("token", "test-jwt-token");
  globalThis.window = {
    dispatchEvent() {},
    location: { pathname: "/main-editor", href: "http://localhost:5173/main-editor" },
  };

  return () => {
    globalThis.localStorage = prevStorage;
    globalThis.window = prevWindow;
  };
}

test("resolveVcsModeMeta separates GitHub vs Email modes without UNIFIED label", () => {
  const gitMeta = resolveVcsModeMeta(VC_MODES.GIT_GITHUB);
  assert.equal(gitMeta.badgeLabel, "GIT & GITHUB");
  assert.equal(gitMeta.activityLabel, "Git & GitHub");
  assert.equal(gitMeta.isGit, true);
  assert.equal(gitMeta.isSnapshot, false);

  const snapMeta = resolveVcsModeMeta(VC_MODES.SNAPSHOT_VCS);
  assert.equal(snapMeta.badgeLabel, "SNAPSHOT VCS");
  assert.equal(snapMeta.activityLabel, "Snapshots & Checkpoints");
  assert.equal(snapMeta.isGit, false);
  assert.equal(snapMeta.isSnapshot, true);
});

test("buildVcsSummary computes counts, badges, and ancestor folder indicators for both modes", () => {
  const gitSummary = buildVcsSummary(VC_MODES.GIT_GITHUB, {
    hasGit: true,
    isReady: true,
    branch: "feat/vcs-ui",
    tracking: "origin/feat/vcs-ui",
    ahead: 2,
    behind: 1,
    operationState: GIT_REPO_OPERATION_STATE.MERGING,
    staged: [{ path: "client/src/App.jsx", status: "M" }],
    unstaged: [{ path: "server/src/index.js", status: "D" }],
    untracked: [{ path: "notes/todo.md", status: "U" }],
    conflicts: [{ path: "shared/config.js", xy: "UU" }],
  });

  assert.equal(gitSummary.branchLabel, "feat/vcs-ui");
  assert.equal(gitSummary.versionBadge, "↓1 ↑2");
  assert.equal(gitSummary.dirtyCount, 4);
  assert.equal(gitSummary.conflictCount, 1);
  assert.equal(gitSummary.fileStatusMap.get("shared/config.js"), "!");
  assert.equal(gitSummary.folderHasChanges.has("client/src"), true);
  assert.equal(gitSummary.folderHasChanges.has("client"), true);

  const snapSummary = buildVcsSummary(VC_MODES.SNAPSHOT_VCS, {
    initialized: true,
    activeSnapshotId: "snap_5",
    activeBranch: { id: "br_1", name: "experiment" },
    headCheckpoint: { id: "snap_5", versionNumber: 5, label: "WIP checkpoint" },
    staged: [{ path: "src/a.js", status: "A" }],
    unstaged: [{ path: "src/nested/b.js", status: "R", origPath: "src/b.js" }],
  });

  assert.equal(snapSummary.branchLabel, "experiment");
  assert.equal(snapSummary.versionBadge, "#v5");
  assert.equal(snapSummary.dirtyCount, 2);
  assert.equal(snapSummary.stagedCount, 1);
  assert.equal(snapSummary.unstagedCount, 1);
  assert.equal(snapSummary.folderHasChanges.has("src/nested"), true);
  assert.equal(getVcsStatusMeta("R").char, "R");
});

test("buildVcsPermissions enforces OWNER, EDITOR, VIEWER UI capability matrix", () => {
  const ownerPerms = buildVcsPermissions({ role: "OWNER" }, VC_MODES.GIT_GITHUB);
  assert.equal(ownerPerms.canLocalWrite, true);
  assert.equal(ownerPerms.canRemoteWrite, true);
  assert.equal(ownerPerms.canRestoreAndAdmin, true);
  assert.equal(ownerPerms.disabledReason("remote"), "");

  const editorGitPerms = buildVcsPermissions({ role: "EDITOR" }, VC_MODES.GIT_GITHUB);
  assert.equal(editorGitPerms.canLocalWrite, true);
  assert.equal(editorGitPerms.canRemoteWrite, false);
  assert.match(editorGitPerms.disabledReason("remote"), /OWNER/i);

  const editorSnapPerms = buildVcsPermissions({ role: "EDITOR" }, VC_MODES.SNAPSHOT_VCS);
  assert.equal(editorSnapPerms.canLocalWrite, true);
  assert.equal(editorSnapPerms.canRestoreAndAdmin, false);
  assert.match(editorSnapPerms.disabledReason("restore"), /OWNER/i);

  const viewerPerms = buildVcsPermissions({ role: "VIEWER" }, VC_MODES.SNAPSHOT_VCS);
  assert.equal(viewerPerms.canRead, true);
  assert.equal(viewerPerms.canLocalWrite, false);
  assert.equal(viewerPerms.canAi, false);
  assert.match(viewerPerms.disabledReason("local"), /read-only/i);
});

test("buildChangesFileTree and computeCommitGraphLayout construct deterministic trees and DAG lanes", () => {
  const tree = buildChangesFileTree([
    { path: "src/utils/math.js", status: "M" },
    { path: "package.json", status: "M" },
    { path: "src/app.js", status: "A" },
  ]);
  assert.equal(tree[0].type, "folder");
  assert.equal(tree[0].name, "src");
  assert.equal(tree[1].type, "file");
  assert.equal(tree[1].name, "package.json");

  const graph = computeCommitGraphLayout([
    { hash: "c3", parents: ["c2", "c1"], subject: "Merge feat" },
    { hash: "c2", parents: ["c0"], subject: "Feat commit" },
    { hash: "c1", parents: ["c0"], subject: "Main commit" },
    { hash: "c0", parents: [], subject: "Initial" },
  ]);
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.nodes[0].isMerge, true);
  assert.ok(graph.laneCount >= 2);
  assert.ok(graph.edges.length >= 4);
});

test("gitService & snapshotVcsService isolate routes and preserve structured error codes/details", async () => {
  const restoreEnv = setupMockBrowserStorage();
  const calls = [];
  const prevFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body });
    if (String(url).includes("/snapshot-vcs/branches/br_1/checkout")) {
      return {
        ok: false,
        status: 409,
        async json() {
          return {
            success: false,
            code: "DIRTY_WORKSPACE",
            message: "Working tree has uncommitted changes.",
            details: { dirtyCount: 2 },
          };
        },
      };
    }
    if (String(url).includes("/git/status")) {
      return {
        ok: false,
        status: 403,
        async json() {
          return {
            success: false,
            code: "AUTH_PROVIDER_MISMATCH",
            message: "Git & GitHub requires GitHub auth.",
          };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { success: true, data: { ok: true } };
      },
    };
  };

  try {
    await gitService.commit("proj_1", { message: "feat: add tests", pushAfter: true });
    assert.ok(calls[0].url.endsWith("/api/git/commit"));
    assert.equal(JSON.parse(calls[0].body).pushAfter, true);

    await assert.rejects(
      () => gitService.getStatus("proj_1"),
      (err) => err.status === 403 && err.code === "AUTH_PROVIDER_MISMATCH",
    );

    await snapshotVcsService.captureCheckpoint("proj_1", {
      label: "Milestone 1",
      stageAll: true,
    });
    assert.ok(calls[2].url.endsWith("/api/projects/proj_1/snapshot-vcs/checkpoints"));

    await assert.rejects(
      () => snapshotVcsService.checkoutBranch("proj_1", "br_1", { dirtyPolicy: "FAIL_IF_DIRTY" }),
      (err) =>
        err.status === 409 &&
        err.code === "DIRTY_WORKSPACE" &&
        err.details?.dirtyCount === 2,
    );
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

test("isVcsSecretFileName allows env templates and source files while blocking real secrets", () => {
  assert.equal(isVcsSecretFileName(".env.example"), false);
  assert.equal(isVcsSecretFileName(".env.sample"), false);
  assert.equal(isVcsSecretFileName(".env.template"), false);
  assert.equal(isVcsSecretFileName("gitCredentialHelper.service.js"), false);
  assert.equal(isVcsSecretFileName("secretManager.ts"), false);

  assert.equal(isVcsSecretFileName(".env"), true);
  assert.equal(isVcsSecretFileName(".env.production"), true);
  assert.equal(isVcsSecretFileName("server.key"), true);
  assert.equal(isVcsSecretFileName("cert.pem"), true);
  assert.equal(isVcsSecretFileName("service-account.json"), true);
});

test("formatAiCommitSubject prevents double conventional-commit prefixes and isValidGithubRepoUrl validates URLs strictly", () => {
  assert.equal(
    formatAiCommitSubject({
      type: "feat",
      scope: "cart",
      subject: "feat(cart): add quantity validation",
    }),
    "feat(cart): add quantity validation",
  );
  assert.equal(
    formatAiCommitSubject({
      type: "fix",
      scope: "auth",
      subject: "handle expired refresh token",
    }),
    "fix(auth): handle expired refresh token",
  );
  assert.equal(
    formatAiCommitSubject({
      type: "chore",
      subject: "update dependencies",
    }),
    "chore: update dependencies",
  );

  assert.equal(isValidGithubRepoUrl("https://github.com/acme/covai-repo"), true);
  assert.equal(isValidGithubRepoUrl("  https://github.com/acme/covai.repo.git/  "), true);
  assert.equal(isValidGithubRepoUrl("https://github.com/acme/repo/tree/main"), false);
  assert.equal(isValidGithubRepoUrl("https://gitlab.com/acme/repo"), false);
  assert.equal(isValidGithubRepoUrl("https://github.com/only-owner"), false);
});

test("optimistic stage/unstage helpers update both Git and Snapshot states cleanly and extractVcsStatusFromResponse parses inline status", () => {
  const gitBase = {
    hasGit: true,
    staged: [],
    unstaged: [{ path: "src/app.js", status: "M" }],
    untracked: [{ path: "src/new.js", status: "U", isUntracked: true }],
    conflicts: [],
    clean: false,
  };

  const gitStaged = applyOptimisticStage(VC_MODES.GIT_GITHUB, gitBase, {
    files: ["src/new.js"],
  });
  assert.equal(gitStaged.untracked.length, 0);
  assert.deepEqual(
    gitStaged.staged.map((f) => `${f.status}:${f.path}`),
    ["A:src/new.js"],
  );

  const gitUnstaged = applyOptimisticUnstage(VC_MODES.GIT_GITHUB, gitStaged, {
    files: "all",
  });
  assert.equal(gitUnstaged.staged.length, 0);
  assert.deepEqual(
    gitUnstaged.untracked.map((f) => `${f.status}:${f.path}`),
    ["U:src/new.js"],
  );

  const snapBase = {
    initialized: true,
    staged: [],
    unstaged: [
      { path: "src/a.js", status: "M" },
      { path: "src/b.js", status: "A" },
    ],
  };
  const snapFolderStaged = applyOptimisticStage(VC_MODES.SNAPSHOT_VCS, snapBase, {
    folder: "src",
  });
  assert.equal(snapFolderStaged.staged.length, 2);
  assert.equal(snapFolderStaged.unstaged.length, 0);

  assert.equal(
    extractVcsStatusFromResponse(VC_MODES.GIT_GITHUB, { data: { status: gitBase } }),
    gitBase,
  );
  assert.equal(
    extractVcsStatusFromResponse(VC_MODES.SNAPSHOT_VCS, { data: snapBase }),
    snapBase,
  );
});

test("gitService.runCommand sends single CLI input string when called without legacy args", async () => {
  const restoreEnv = setupMockBrowserStorage();
  const captured = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      async json() {
        return { success: true, result: "Pulled", data: { mutated: true } };
      },
    };
  };

  try {
    await gitService.runCommand("proj_9", "git pull origin main");
    assert.ok(captured[0].url.endsWith("/api/git/command"));
    assert.deepEqual(captured[0].body, {
      projectId: "proj_9",
      input: "git pull origin main",
    });
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

test("buildRemoteSyncBannerState builds fast-forward, diverged, and fallback tracking descriptors", () => {
  assert.equal(buildRemoteSyncBannerState(null), null);
  assert.equal(
    buildRemoteSyncBannerState({ hasGit: true, branch: "develop", ahead: 2, behind: 0 }),
    null,
  );
  assert.equal(
    buildRemoteSyncBannerState({
      hasGit: true,
      detached: true,
      ahead: 0,
      behind: 3,
    }),
    null,
  );

  const behindOne = buildRemoteSyncBannerState({
    hasGit: true,
    branch: "develop",
    tracking: null,
    ahead: 0,
    behind: 1,
  });
  assert.deepEqual(
    {
      kind: behindOne.kind,
      remoteRef: behindOne.remoteRef,
      title: behindOne.title,
      primaryAction: behindOne.primaryAction,
      primaryLabel: behindOne.primaryLabel,
    },
    {
      kind: "behind",
      remoteRef: "origin/develop",
      title: "Your branch 'develop' is behind 'origin/develop' by 1 commit",
      primaryAction: "pull",
      primaryLabel: "Pull (↓1)",
    },
  );
  assert.match(behindOne.cliHint, /by 1 commit, and can be fast-forwarded/);

  const diverged = buildRemoteSyncBannerState({
    hasGit: true,
    branch: "main",
    tracking: "origin/main",
    ahead: 2,
    behind: 4,
  });
  assert.equal(diverged.kind, "diverged");
  assert.equal(diverged.primaryAction, "sync");
  assert.equal(diverged.primaryLabel, "Sync (↓4 ↑2)");
  assert.match(diverged.title, /2 ahead, 4 behind/);
});

test("formatRemoteCheckedAgo formats relative timestamps cleanly", () => {
  const base = Date.parse("2026-11-27T12:00:00.000Z");
  assert.equal(formatRemoteCheckedAgo(null, base), null);
  assert.equal(formatRemoteCheckedAgo("invalid-date", base), null);
  assert.equal(formatRemoteCheckedAgo("2026-11-27T11:59:55.000Z", base), "just now");
  assert.equal(formatRemoteCheckedAgo("2026-11-27T11:59:20.000Z", base), "40s ago");
  assert.equal(formatRemoteCheckedAgo("2026-11-27T11:55:00.000Z", base), "5m ago");
  assert.equal(formatRemoteCheckedAgo("2026-11-27T09:00:00.000Z", base), "3h ago");
});
