import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const SERVER_DIR = path.join(ROOT_DIR, "server");
const CLIENT_DIR = path.join(ROOT_DIR, "client");

const API_ORIGIN = "http://127.0.0.1:55110";
const API_BASE = `${API_ORIGIN}/api`;
const CLIENT_URL = "http://127.0.0.1:55283";

let apiProc;
let viteProc;

async function waitForHttp(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function loginAsGithubUser(page) {
  await page.route("https://github.com/login/oauth/authorize*", async (route) => {
    const reqUrl = new URL(route.request().url());
    const state = reqUrl.searchParams.get("state");
    await route.fulfill({
      status: 302,
      headers: {
        Location: `${CLIENT_URL}/auth/github/callback?code=e2e-gh-vcs&state=${encodeURIComponent(state || "")}`,
      },
    });
  });

  await page.goto("/login");
  await page.locator("#auth-github-btn").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function loginAsEmailUser(page) {
  await page.goto("/login");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/login");
  await page.locator("#auth-email").fill("email-vcs@covai.test");
  await page.locator("#auth-password").fill("ValidPass123!");
  await page.locator("#auth-submit-btn").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function writeWorkspaceFileFromBrowser(page, projectId, filePath, content) {
  const res = await page.evaluate(
    async ({ apiBase, pid, fPath, text }) => {
      const token = localStorage.getItem("token");
      const r = await fetch(`${apiBase}/projects/${pid}/file-content`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ path: fPath, content: text }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        window.dispatchEvent(
          new CustomEvent("covai:workspace-saved", {
            detail: { projectId: pid, path: fPath },
          }),
        );
      }
      return { ok: r.ok, status: r.status, data };
    },
    { apiBase: API_BASE, pid: projectId, fPath: filePath, text: content },
  );
  expect(res.ok).toBe(true);
}

async function expectExplorerModified(page, fileName) {
  await page.locator("#activity-explorer").click();
  const modifiedBadge = page.getByTitle(`${fileName} (Modified)`);
  if (!(await modifiedBadge.isVisible().catch(() => false))) {
    const srcFolder = page.getByText("src", { exact: true }).first();
    if (await srcFolder.isVisible().catch(() => false)) {
      await srcFolder.click();
    }
  }
  await expect(modifiedBadge).toBeVisible();
  await page.locator("#activity-version-control").click();
}

test.beforeAll(async () => {
  apiProc = spawn(process.execPath, ["e2e/version-control-server.mjs"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      COVAI_WORKER_ENABLED: "false",
      E2E_API_PORT: "55110",
      CLIENT_URL,
    },
    stdio: "pipe",
    windowsHide: true,
  });

  viteProc = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "55283",
      "--strictPort",
    ],
    {
      cwd: CLIENT_DIR,
      env: {
        ...process.env,
        VITE_BACKEND_DOCKER_URL: API_ORIGIN,
        VITE_API_URL: API_BASE,
        VITE_SOCKET_URL: API_ORIGIN,
        VITE_GITHUB_CLIENT_ID: "e2e-github-client-id",
      },
      stdio: "pipe",
      windowsHide: true,
    },
  );

  await Promise.all([
    waitForHttp(`${API_BASE}/health`),
    waitForHttp(CLIENT_URL),
  ]);
});

test.afterAll(async ({ request }) => {
  await request.post(`${API_BASE}/__test/reset`).catch(() => {});
  for (const proc of [viteProc, apiProc]) {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
    }
  }
});

test("1. Strict Mode Separation (GitHub vs Email UI, 0 cross-mode requests, ImportLayout & 403 guards)", async ({
  page,
  request,
}) => {
  const seedRes = await request.post(`${API_BASE}/__test/seed-vcs`);
  expect(seedRes.ok()).toBe(true);
  const seeded = await seedRes.json();

  const consoleErrors = [];
  const pageErrors = [];
  const apiRequests = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("request", (req) => {
    const reqUrl = req.url();
    if (reqUrl.includes("/api/")) {
      apiRequests.push(reqUrl);
    }
  });

  // A. GitHub Session -> Only GIT & GITHUB UI, real `develop` status bar, 0 /snapshot-vcs calls
  await loginAsGithubUser(page);
  apiRequests.length = 0;

  await page.goto(
    `/main-editor?projectId=${seeded.gitProject.id}&snapshotId=${seeded.gitProject.snapshotId}&tab=version-control`,
  );

  await expect(page.getByTestId("vcs-mode-badge")).toHaveText("GIT & GITHUB");
  await expect(
    page.getByPlaceholder(/Message \(Ctrl\+Enter to commit/),
  ).toBeVisible();
  await expect(page.getByText("Capture Checkpoint")).toHaveCount(0);
  await expect(page.getByText("Snapshot Timeline")).toHaveCount(0);
  await expect(page.getByText("UNIFIED", { exact: true })).toHaveCount(0);

  // Real branch `develop` appears in status bar (not hardcoded `main`)
  await expect(page.getByTitle("Git Branch: develop")).toBeVisible();
  await page.waitForTimeout(400);

  const leakedSnapshotRequests = apiRequests.filter(
    (u) => u.includes("/snapshot-vcs") || u.includes("/vcs/snapshots"),
  );
  expect(leakedSnapshotRequests).toEqual([]);

  // Direct cross-mode API guard with GitHub JWT -> 403 AUTH_PROVIDER_MISMATCH
  const ghCrossCheck = await page.evaluate(
    async ({ apiBase, snapPid }) => {
      const token = localStorage.getItem("token");
      const r = await fetch(`${apiBase}/projects/${snapPid}/snapshot-vcs/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, body: await r.json() };
    },
    { apiBase: API_BASE, snapPid: seeded.snapshotProject.id },
  );
  expect(ghCrossCheck.status).toBe(403);
  expect(ghCrossCheck.body.code).toBe("AUTH_PROVIDER_MISMATCH");

  // B. Email Session -> Import hides OAuth/Repo Picker, Version Control shows only SNAPSHOT VCS, 0 /api/git calls
  await loginAsEmailUser(page);

  // Check ImportLayout hides GitHub OAuth / Repo Picker while offering ZIP + Public Git URL Snapshot note
  await page.getByRole("button", { name: "Project" }).first().click();
  await expect(
    page.getByText(
      "Upload a project archive or import a one-time Snapshot from a public Git URL",
    ),
  ).toBeVisible();
  await expect(page.getByText(/Connect GitHub/i)).toHaveCount(0);
  await page.locator("#import-cancel-btn").click();

  apiRequests.length = 0;
  await page.goto(
    `/main-editor?projectId=${seeded.snapshotProject.id}&snapshotId=${seeded.snapshotProject.snapshotId}&tab=version-control`,
  );

  await expect(page.getByTestId("vcs-mode-badge")).toHaveText("SNAPSHOT VCS");
  await expect(page.getByText("Capture Checkpoint")).toBeVisible();
  await expect(page.getByText("Publish to GitHub")).toHaveCount(0);
  await expect(page.getByText("UNIFIED", { exact: true })).toHaveCount(0);
  await expect(page.getByTitle(/Snapshot Branch: main/)).toBeVisible();
  await page.waitForTimeout(400);

  const leakedGitRequests = apiRequests.filter(
    (u) => u.includes("/api/git") || u.includes("/git/"),
  );
  expect(leakedGitRequests).toEqual([]);

  // Direct cross-mode API guard with Email JWT -> 403 AUTH_PROVIDER_MISMATCH
  const emailCrossCheck = await page.evaluate(
    async ({ apiBase, gitPid }) => {
      const token = localStorage.getItem("token");
      const r = await fetch(`${apiBase}/git/status?projectId=${gitPid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, body: await r.json() };
    },
    { apiBase: API_BASE, gitPid: seeded.gitProject.id },
  );
  expect(emailCrossCheck.status).toBe(403);
  expect(emailCrossCheck.body.code).toBe("AUTH_PROVIDER_MISMATCH");
  expect(pageErrors.filter((e) => !/WebSocket closed without opened/i.test(e))).toEqual([]);
  expect(
    consoleErrors.filter((e) => !e.includes("403") && !/WebSocket/i.test(e)),
  ).toEqual([]);
});

test("2. VS Code Git & GitHub Workflow E2E (Explorer badges, DiffEditor, Stage/Commit/Push without plaintext token, Conflict Resolver)", async ({
  page,
  request,
}) => {
  const seedRes = await request.post(`${API_BASE}/__test/seed-vcs`);
  expect(seedRes.ok()).toBe(true);
  const seeded = await seedRes.json();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await loginAsGithubUser(page);
  await page.goto(
    `/main-editor?projectId=${seeded.gitProject.id}&snapshotId=${seeded.gitProject.snapshotId}&tab=version-control`,
  );
  await expect(page.getByTestId("vcs-mode-badge")).toHaveText("GIT & GITHUB");

  // 1. Modify 2 files -> verify live ActivityBar badge (`2`) & Explorer `M` decoration
  await writeWorkspaceFileFromBrowser(
    page,
    seeded.gitProject.id,
    "src/app.js",
    "export const version = 'v2-base';\nexport function greet() {\n  return 'hello base';\n}\n",
  );
  await writeWorkspaceFileFromBrowser(
    page,
    seeded.gitProject.id,
    "src/utils.js",
    "export const add = (a, b) => Number(a) + Number(b);\n",
  );

  await expect(page.getByTestId("vcs-activity-badge")).toHaveText("2");
  await expectExplorerModified(page, "app.js");

  // 2. Open Monaco DiffEditor across multiple files + Inline/Split toggle cleanly
  await page.getByText("app.js", { exact: true }).first().click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();
  await page.getByRole("button", { name: "Inline" }).click();
  await page.getByRole("button", { name: "Split" }).click();
  await page.getByText("utils.js", { exact: true }).first().click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();

  // 3. Stage & Commit -> Push to local bare remote -> verify no plaintext token in .git/config
  const commitInput = page.getByPlaceholder(/Message \(Ctrl\+Enter to commit/);
  await commitInput.fill("feat: e2e verified commit");
  await page.getByRole("button", { name: /Stage All & Commit/i }).click();
  await expect(page.getByText(/Working tree clean/i)).toBeVisible();

  await page.getByRole("button", { name: "Push", exact: true }).click();
  await expect(page.getByText(/Pushed commits to GitHub/i)).toBeVisible();

  const inspectGit = await (
    await request.get(`${API_BASE}/__test/inspect-git`)
  ).json();
  expect(inspectGit.remoteLog).toContain("feat: e2e verified commit");
  expect(inspectGit.gitConfig).not.toContain("gho_");
  expect(inspectGit.gitConfig).not.toContain("x-access-token");
  expect(inspectGit.gitConfig).not.toContain("extraheader");

  // 4. Create `feat/conflict-e2e`, commit conflicting change, switch to `develop`, commit & Merge -> Resolve in VcsConflictResolver
  await page.getByRole("button", { name: "Branches", exact: true }).click();
  await page.getByPlaceholder("feat/new-branch").fill("feat/conflict-e2e");
  await page.getByRole("button", { name: "Create Branch" }).click();
  await expect(page.getByTitle("Git Branch: feat/conflict-e2e")).toBeVisible();

  await writeWorkspaceFileFromBrowser(
    page,
    seeded.gitProject.id,
    "src/app.js",
    "export const version = 'v3-feature';\nexport function greet() {\n  return 'hello from feature';\n}\n",
  );
  await expect(page.getByTestId("vcs-activity-badge")).toHaveText("1");
  await commitInput.fill("feat: conflicting branch change");
  await page.getByRole("button", { name: /Stage All & Commit/i }).click();
  await expect(page.getByText(/Working tree clean/i)).toBeVisible();

  // Switch back to `develop`
  await page.getByRole("button", { name: "Branches", exact: true }).click();
  await page
    .locator("div")
    .filter({ has: page.getByText("develop", { exact: true }) })
    .getByRole("button", { name: "Checkout" })
    .first()
    .click();
  await expect(page.getByTitle("Git Branch: develop")).toBeVisible();

  await writeWorkspaceFileFromBrowser(
    page,
    seeded.gitProject.id,
    "src/app.js",
    "export const version = 'v3-develop';\nexport function greet() {\n  return 'hello from develop';\n}\n",
  );
  await expect(page.getByTestId("vcs-activity-badge")).toHaveText("1");
  await commitInput.fill("feat: conflicting develop change");
  await page.getByRole("button", { name: /Stage All & Commit/i }).click();
  await expect(page.getByText(/Working tree clean/i)).toBeVisible();

  // Merge `feat/conflict-e2e` into `develop` -> triggers conflict resolver!
  await page.getByRole("button", { name: "Branches", exact: true }).click();
  await page.getByRole("button", { name: "Merge Into develop" }).first().click();

  await expect(page.getByText(/Git MERGING Conflicts/i)).toBeVisible();
  await page.getByRole("button", { name: "Accept Both" }).click();
  await page.getByRole("button", { name: "Complete Operation" }).click();
  await expect(
    page.getByText(/Merge \/ Rebase completed successfully/i),
  ).toBeVisible();

  expect(pageErrors.filter((e) => !/WebSocket closed without opened/i.test(e))).toEqual([]);
  expect(
    consoleErrors.filter(
      (e) => !/WebSocket/i.test(e) && !/409 \(Conflict\)/i.test(e),
    ),
  ).toEqual([]);
});

test("3. Mini-GitHub Snapshot & Checkpoints Workflow E2E (Diff, Partial Capture, C2 Immutability, Dirty Switch Auto-Backup, Compare, Single-File Restore & C3 Rollback + node_modules intact)", async ({
  page,
  request,
}) => {
  const seedRes = await request.post(`${API_BASE}/__test/seed-vcs`);
  expect(seedRes.ok()).toBe(true);
  const seeded = await seedRes.json();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await loginAsEmailUser(page);
  await page.goto(
    `/main-editor?projectId=${seeded.snapshotProject.id}&snapshotId=${seeded.snapshotProject.snapshotId}&tab=version-control`,
  );
  await expect(page.getByTestId("vcs-mode-badge")).toHaveText("SNAPSHOT VCS");

  // 1. Modify 2 files -> live ActivityBar badge (`2`) & Explorer `M` decoration
  await writeWorkspaceFileFromBrowser(
    page,
    seeded.snapshotProject.id,
    "src/index.js",
    "export const appName = 'CovAI-Snapshot-v2';\nexport const port = 4000;\n",
  );
  await writeWorkspaceFileFromBrowser(
    page,
    seeded.snapshotProject.id,
    "src/math.js",
    "export const multiply = (a, b) => Number(a) * Number(b);\n",
  );

  await expect(page.getByTestId("vcs-activity-badge")).toHaveText("2");
  await expectExplorerModified(page, "index.js");

  // 2. Open DiffEditor cleanly on modified file
  await page.getByText("index.js", { exact: true }).first().click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();

  // 3. Partial stage ONLY `src/index.js` & Capture Checkpoint #v2
  await page.getByTitle("Stage changes").first().click();
  await expect(page.getByRole("button", { name: "Capture Staged (1)" })).toBeVisible();

  await page
    .getByPlaceholder("Checkpoint label (Ctrl+Enter to capture)")
    .fill("v2 partial index update");
  await page.getByRole("button", { name: "Capture Staged (1)" }).click();
  await expect(page.getByText(/v2 partial index update/i).first()).toBeVisible();
  await expect(page.getByText("#v2").first()).toBeVisible();

  // `src/math.js` remains dirty (`1`)
  await expect(page.getByTestId("vcs-activity-badge")).toHaveText("1");

  // 4. Bug C2 check: Initial Ingest (#v1) still preserves original v1 content
  await page.getByRole("button", { name: "Browse Files" }).click();
  const browseSelect = page.locator("select").first();
  await browseSelect.selectOption(seeded.snapshotProject.snapshotId);
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  await expect(page.locator(".monaco-editor").first()).toContainText(
    "CovAI-Snapshot-v1",
  );

  // 5. Dirty workspace branch checkout modal -> `Auto-Backup & Switch`
  await page.getByRole("button", { name: "Branches & Merge" }).click();
  await page.getByPlaceholder("experiment/refactor").fill("exp-branch");
  await page.getByRole("button", { name: "Create Branch" }).click();
  await expect(page.getByText("exp-branch")).toBeVisible();

  await page.getByRole("button", { name: "Checkout" }).first().click();
  await expect(page.getByText("Uncommitted Changes Detected")).toBeVisible();
  await page.getByRole("button", { name: "Auto-Backup & Switch" }).click();
  await expect(page.getByText(/Switched to branch 'exp-branch'/i)).toBeVisible();
  await expect(page.getByTitle(/Snapshot Branch: exp-branch/)).toBeVisible();

  // 6. Compare tab (#v1 vs #v2)
  await page.getByRole("button", { name: "Compare" }).click();
  await page.locator("select").nth(0).selectOption(seeded.snapshotProject.snapshotId);
  const v2OptionVal = await page
    .locator("select")
    .nth(1)
    .locator("option", { hasText: /v2 partial index update/i })
    .getAttribute("value");
  await page.locator("select").nth(1).selectOption(v2OptionVal);
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();

  // 7. Single-File Restore from #v1
  await page.getByRole("button", { name: "Browse Files" }).click();
  await page.locator("select").first().selectOption(seeded.snapshotProject.snapshotId);
  await page.getByRole("button", { name: /src\/index\.js/i }).first().click();
  await page.getByRole("button", { name: "Restore This File" }).click();
  await page.getByRole("button", { name: "Restore File", exact: true }).click();
  await expect(page.getByText(/Restored 'src\/index\.js' into live working tree/i)).toBeVisible();

  // 8. Full Rollback to #v1 (`Initial Ingest`) with Auto-Backup -> verify Bug C3 URL/DB sync + `node_modules` intact
  await page.getByRole("button", { name: "Timeline & Graph" }).click();
  await page.getByText("Initial Ingest").first().click();
  await page.getByRole("button", { name: "Full Rollback" }).click();
  await page.getByRole("button", { name: "Confirm Full Rollback" }).click();
  await expect(page.getByText(/Workspace rolled back to #v1/i)).toBeVisible();

  const inspectSnap = await (
    await request.get(`${API_BASE}/__test/inspect-snapshot`)
  ).json();
  expect(inspectSnap.activeSnapshotId).toBeTruthy();
  expect(page.url()).toContain(`snapshotId=${inspectSnap.activeSnapshotId}`);
  expect(inspectSnap.indexContent).toContain("CovAI-Snapshot-v1");
  expect(inspectSnap.nodeModulesExists).toBe(true);
  expect(inspectSnap.nodeModulesContent).toContain("intact: true");

  expect(pageErrors.filter((e) => !/WebSocket closed without opened/i.test(e))).toEqual([]);
  expect(
    consoleErrors.filter(
      (e) => !/WebSocket/i.test(e) && !/409 \(Conflict\)/i.test(e),
    ),
  ).toEqual([]);
});
