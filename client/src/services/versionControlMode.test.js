import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_PROVIDERS,
  VC_MODES,
  isVcsSecretFileName,
  isVcsIgnoredRelativePath,
  normalizeAuthProvider,
  resolveVersionControlMode,
  isGitHubAuthSession,
  parseGithubScopes,
  hasGithubRepoWriteScope,
} from "../../../shared/versionControlMode.js";
import {
  GIT_FILE_STATUS,
  GIT_REPO_OPERATION_STATE,
  isGitConflictXY,
  validateGitBranchName,
  validateGitTagName,
  validateGithubRepoName,
} from "../../../shared/gitProtocol.js";
import {
  SNAPSHOT_CHANGE_STATUS,
  SNAPSHOT_RESTORE_POLICIES,
  validateSnapshotBranchName,
  validateSnapshotTagName,
} from "../../../shared/snapshotVcsProtocol.js";
import {
  getAccessTokenAuthProvider,
  setStoredAccessToken,
} from "../lib/authSession.js";

function createFakeStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function toBase64Url(jsonText) {
  return btoa(jsonText)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeFakeJwt(payloadObj) {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify(payloadObj));
  return `${header}.${payload}.sig`;
}

test("normalizeAuthProvider & resolveVersionControlMode strictly separate GitHub vs Email", () => {
  assert.equal(normalizeAuthProvider("github"), AUTH_PROVIDERS.GITHUB);
  assert.equal(normalizeAuthProvider(" GitHub "), AUTH_PROVIDERS.GITHUB);
  assert.equal(normalizeAuthProvider("email"), AUTH_PROVIDERS.EMAIL);
  assert.equal(normalizeAuthProvider("local"), AUTH_PROVIDERS.EMAIL);
  assert.equal(normalizeAuthProvider("unknown"), null);
  assert.equal(normalizeAuthProvider(null), null);

  assert.equal(resolveVersionControlMode("github"), VC_MODES.GIT_GITHUB);
  assert.equal(resolveVersionControlMode("email"), VC_MODES.SNAPSHOT_VCS);
  assert.equal(resolveVersionControlMode(null), VC_MODES.SNAPSHOT_VCS);
  assert.equal(isGitHubAuthSession("github"), true);
  assert.equal(isGitHubAuthSession("email"), false);
});

test("parseGithubScopes & hasGithubRepoWriteScope handle string and array forms", () => {
  assert.deepEqual(
    parseGithubScopes("repo, read:user user:email REPO"),
    ["repo", "read:user", "user:email"],
  );
  assert.equal(hasGithubRepoWriteScope("repo read:user user:email"), true);
  assert.equal(hasGithubRepoWriteScope(["read:user", "user:email"]), false);
  assert.equal(hasGithubRepoWriteScope(""), false);
});

test("isVcsIgnoredRelativePath filters test runner artifacts, VCS internals, and secrets", () => {
  assert.equal(isVcsIgnoredRelativePath("node_modules/pkg/index.js"), true);
  assert.equal(isVcsIgnoredRelativePath("./coverage/lcov.info"), true);
  assert.equal(isVcsIgnoredRelativePath("test-results/output.json"), true);
  assert.equal(isVcsIgnoredRelativePath("playwright-report/index.html"), true);
  assert.equal(isVcsIgnoredRelativePath(".covai-temp/tmp-1.js"), true);
  assert.equal(isVcsIgnoredRelativePath("cypress/videos/login.mp4"), true);
  assert.equal(isVcsIgnoredRelativePath(".env"), true);
  assert.equal(isVcsIgnoredRelativePath(".env.production"), true);
  assert.equal(isVcsIgnoredRelativePath("certs/private.pem"), true);
  assert.equal(isVcsSecretFileName("service-account.json"), true);
  assert.equal(isVcsIgnoredRelativePath("src/controllers/auth.controller.js"), false);
  assert.equal(isVcsIgnoredRelativePath("tests/unit/auth.test.js"), false);
});

test("gitProtocol validates branch, tag, repo names and conflict XY codes", () => {
  assert.equal(GIT_FILE_STATUS.MODIFIED, "M");
  assert.equal(GIT_REPO_OPERATION_STATE.IDLE, "IDLE");
  assert.equal(isGitConflictXY("UU"), true);
  assert.equal(isGitConflictXY("aa"), true);
  assert.equal(isGitConflictXY(" M"), false);

  assert.equal(validateGitBranchName("feat/vcs-upgrade"), true);
  assert.equal(validateGitBranchName("../evil"), false);
  assert.equal(validateGitBranchName("main.lock"), false);
  assert.equal(validateGitBranchName("-bad"), false);

  assert.equal(validateGitTagName("v1.2.0"), true);
  assert.equal(validateGitTagName("bad//tag"), false);

  assert.equal(validateGithubRepoName("covai-app"), true);
  assert.equal(validateGithubRepoName(".."), false);
});

test("snapshotVcsProtocol validates branch names and tag names", () => {
  assert.equal(SNAPSHOT_CHANGE_STATUS.ADDED, "A");
  assert.equal(SNAPSHOT_RESTORE_POLICIES.AUTO_BACKUP, "AUTO_BACKUP");
  assert.equal(validateSnapshotBranchName("experiment/v2"), true);
  assert.equal(validateSnapshotBranchName("bad..branch"), false);
  assert.equal(validateSnapshotTagName("release-1.0"), true);
  assert.equal(validateSnapshotTagName("bad/tag"), false);
});

test("authSession getAccessTokenAuthProvider & setStoredAccessToken sync authProvider and vcMode", () => {
  const storage = createFakeStorage();
  const dispatched = [];
  const prevStorage = globalThis.localStorage;
  const prevWindow = globalThis.window;

  globalThis.localStorage = storage;
  globalThis.window = {
    dispatchEvent(evt) {
      dispatched.push(evt);
    },
  };

  try {
    const githubJwt = makeFakeJwt({ userId: "u1", authProvider: "github" });
    storage.setItem(
      "user",
      JSON.stringify({ id: "u1", name: "Octo", email: "octo@example.com", token: "old" }),
    );
    setStoredAccessToken(githubJwt);

    assert.equal(getAccessTokenAuthProvider(), AUTH_PROVIDERS.GITHUB);
    const updatedUser = JSON.parse(storage.getItem("user"));
    assert.equal(updatedUser.token, githubJwt);
    assert.equal(updatedUser.authProvider, AUTH_PROVIDERS.GITHUB);
    assert.equal(updatedUser.vcMode, VC_MODES.GIT_GITHUB);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].detail.authProvider, AUTH_PROVIDERS.GITHUB);

    const emailJwt = makeFakeJwt({ userId: "u1", authProvider: "email" });
    setStoredAccessToken(emailJwt);
    assert.equal(getAccessTokenAuthProvider(), AUTH_PROVIDERS.EMAIL);
    const switchedUser = JSON.parse(storage.getItem("user"));
    assert.equal(switchedUser.authProvider, AUTH_PROVIDERS.EMAIL);
    assert.equal(switchedUser.vcMode, VC_MODES.SNAPSHOT_VCS);
  } finally {
    globalThis.localStorage = prevStorage;
    globalThis.window = prevWindow;
  }
});
