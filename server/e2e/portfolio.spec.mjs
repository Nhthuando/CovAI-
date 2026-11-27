import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const SERVER_DIR = path.join(ROOT_DIR, "server");
const CLIENT_DIR = path.join(ROOT_DIR, "client");

const API_ORIGIN = "http://127.0.0.1:55120";
const API_BASE = `${API_ORIGIN}/api`;
const CLIENT_URL = "http://127.0.0.1:55293";

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

async function dismissSpotlightIfOpen(page) {
  const skipBtn = page.getByRole("button", { name: "Skip", exact: true });
  if (await skipBtn.isVisible({ timeout: 1200 }).catch(() => false)) {
    await skipBtn.click();
    await skipBtn.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}

async function markAllToursSeen(page, extraUserId = null) {
  await page.evaluate((uidArg) => {
    const seenAll = JSON.stringify({
      portfolio: true,
      explorer: true,
      overview: true,
      unit: true,
      integration: true,
      system: true,
      trustworthiness: true,
      architecture: true,
      "logic-analysis": true,
      "version-control": true,
      jobs: true,
      settings: true,
    });
    const keys = new Set(["covai_tour_seen_v1_anon"]);
    if (uidArg) keys.add(`covai_tour_seen_v1_${uidArg}`);
    try {
      const token = localStorage.getItem("token");
      if (token && token.includes(".")) {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const uid = payload?.userId || payload?.id || payload?.sub;
        if (uid) keys.add(`covai_tour_seen_v1_${uid}`);
      }
      const userRaw = localStorage.getItem("user");
      if (userRaw) {
        const u = JSON.parse(userRaw);
        if (u?.id) keys.add(`covai_tour_seen_v1_${u.id}`);
      }
    } catch {
      // ignore
    }
    for (const k of keys) {
      localStorage.setItem(k, seenAll);
    }
  }, extraUserId);
}

async function loginByEmail(page, email, userId = null) {
  await page.context().clearCookies();
  if (page.url().startsWith(CLIENT_URL)) {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }
  await page.goto("/login");
  await markAllToursSeen(page, userId);
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("ValidPass123!");
  await page.locator("#auth-submit-btn").click();
  await expect(page).toHaveURL(/\/projects$/);
  await markAllToursSeen(page, userId);
  await dismissSpotlightIfOpen(page);
  await expect(page.locator("#portfolio-command-header")).toBeVisible();
}

async function apiLoginToken(request, email) {
  const res = await request.post(`${API_BASE}/auth/login`, {
    data: { email, password: "ValidPass123!" },
  });
  expect(res.ok()).toBe(true);
  const data = await res.json();
  return data.token || data.accessToken || data?.data?.token;
}

const VITE_HMR_WS_NOISE_RE =
  /(?:@vite\/client|127\.0\.0\.1:5173|failed to connect to websocket|Failed to send error to Vite server|WebSocket.*closed|WebSocket connection to 'ws:\/\/127\.0\.0\.1:5173)/i;

function assertNoUnexpectedBrowserErrors({ pageErrors, consoleErrors }) {
  expect(pageErrors.filter((msg) => !VITE_HMR_WS_NOISE_RE.test(msg))).toEqual([]);
  expect(consoleErrors.filter((msg) => !VITE_HMR_WS_NOISE_RE.test(msg))).toEqual([]);
}

test.beforeAll(async () => {
  apiProc = spawn(process.execPath, ["e2e/portfolio-server.mjs"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      COVAI_WORKER_ENABLED: "false",
      DISABLE_DOCKER_RUNNER: "true",
      E2E_API_PORT: "55120",
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
      "55293",
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

test("1. Hybrid Lifecycle Governance (no duplicate dropdowns), Strict D2 KPI Isolation & D3 RBAC/409", async ({
  page,
  request,
}) => {
  const seedRes = await request.post(`${API_BASE}/__test/seed-portfolio`);
  expect(seedRes.ok()).toBe(true);
  const seeded = await seedRes.json();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await loginByEmail(page, seeded.users.owner.email, seeded.users.owner.id);

  const header = page.locator("#portfolio-command-header");
  const kpiRow = page.locator("#portfolio-executive-kpi-row");
  const directory = page.locator("#project-directory-workspace-zone");

  // 1. Verify D1: Zero inline dropdowns inside Grid Cards, only static badges + 2 doing / 4 total
  await expect(header).toContainText("2 doing (in KPI) · 4 total projects");
  await expect(kpiRow).toContainText("26"); // 20 Unit + 6 API from activeVcs only (NOT +50 from COMPLETED!)
  await expect(directory.locator("article select")).toHaveCount(0);

  // Switch to Table View and confirm zero dropdowns in table rows too
  await directory.getByRole("button", { name: "Table View" }).click();
  await expect(directory.locator("table select")).toHaveCount(0);
  await directory.getByRole("button", { name: "Grid View" }).click();

  // 2. Verify D2 Strict KPI Isolation: changing directory lifecycle filter NEVER leaks COMPLETED (50 tests) into KPIs
  const lifecycleSelect = directory.getByLabel("Filter by lifecycle state");
  await expect(lifecycleSelect).toContainText("Open (Doing & Not Started)");
  for (const tabValue of ["all", "COMPLETED", "PAUSED", "NOT_STARTED", "open"]) {
    await lifecycleSelect.selectOption(tabValue);
    await expect(kpiRow).toContainText("26");
    await expect(header).toContainText("2 doing (in KPI) · 4 total projects");
  }

  // 3. OWNER edits backlog project via ⋮ -> Project settings (QuickProjectSettingsModal): NOT_STARTED -> DOING -> PAUSED
  const backlogCard = page.locator(`#project-card-${seeded.projects.backlog.id}`);
  await backlogCard.getByRole("button", { name: "Project actions" }).click();
  await backlogCard.getByRole("button", { name: "Project settings" }).click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("radio", { name: /^Doing\b/i }).click();
  await modal.getByRole("button", { name: "Save changes" }).click();
  await expect(modal).toBeHidden();
  await expect(header).toContainText("3 doing (in KPI) · 4 total projects");

  // Transition back to Paused -> immediate KPI isolation
  await backlogCard.getByRole("button", { name: "Project actions" }).click();
  await backlogCard.getByRole("button", { name: "Project settings" }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole("radio", { name: /^Paused\b/i }).click();
  await modal.getByRole("button", { name: "Save changes" }).click();
  await expect(modal).toBeHidden();
  await expect(header).toContainText("2 doing (in KPI) · 4 total projects");

  // 4. Active project with test activity locks Not Started radio option in UI & returns 409 on direct API
  const activeCard = page.locator(`#project-card-${seeded.projects.activeVcs.id}`);
  await activeCard.getByRole("button", { name: "Project actions" }).click();
  await activeCard.getByRole("button", { name: "Project settings" }).click();
  await expect(modal).toBeVisible();
  const notStartedRadio = modal.getByRole("radio", { name: /^Not Started\b/i });
  await expect(notStartedRadio).toBeDisabled();
  await expect(modal).toContainText(/Paused or Completed/i);

  // Use footer link "Open full settings in workspace" -> General & Lifecycle tab
  await modal.getByRole("button", { name: /Open full settings in workspace/i }).click();
  await expect(page).toHaveURL(/tab=settings/);
  await expect(page).toHaveURL(/setting=project-general/);
  await markAllToursSeen(page);

  const settingsView = page.getByLabel("Project General and Lifecycle Settings");
  await expect(settingsView).toBeVisible();
  await expect(settingsView).toContainText("feat/vn-checkout");

  // Verify Workspace Topbar has 0 lifecycle dropdown and hides badge when DOING
  const topbarIsolatedBtn = page.getByRole("button", {
    name: /Isolated project lifecycle status/i,
  });
  await expect(topbarIsolatedBtn).toHaveCount(0);

  // Transition to Paused from Workspace Settings -> Topbar static warning pill appears immediately
  await settingsView.getByRole("radio", { name: /^Paused\b/i }).click();
  await settingsView.getByRole("button", { name: "Save changes" }).click();
  await expect(topbarIsolatedBtn).toBeVisible();
  await expect(topbarIsolatedBtn).toContainText("Paused");

  // Restore to Doing -> Topbar pill hides again
  await settingsView.getByRole("radio", { name: /^Doing\b/i }).click();
  await settingsView.getByRole("button", { name: "Save changes" }).click();
  await expect(topbarIsolatedBtn).toHaveCount(0);

  // Direct API guard checks via Node request fixture (clean, no console error noise)
  const ownerToken = await apiLoginToken(request, seeded.users.owner.email);
  const revertRes = await request.patch(
    `${API_BASE}/projects/${seeded.projects.activeVcs.id}/status`,
    {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { lifecycleStatus: "NOT_STARTED" },
    },
  );
  expect(revertRes.status()).toBe(409);
  const revertBody = await revertRes.json();
  expect(revertBody.code).toBe("CANNOT_REVERT_TO_NOT_STARTED");

  // 5. EDITOR & VIEWER RBAC: read-only UI on /projects + 403 on PATCH /:id/status
  for (const memberUser of [seeded.users.editor, seeded.users.viewer]) {
    const memberToken = await apiLoginToken(request, memberUser.email);
    const forbiddenRes = await request.patch(
      `${API_BASE}/projects/${seeded.projects.activeVcs.id}/status`,
      {
        headers: { Authorization: `Bearer ${memberToken}` },
        data: { lifecycleStatus: "PAUSED" },
      },
    );
    expect(forbiddenRes.status()).toBe(403);

    await loginByEmail(page, memberUser.email, memberUser.id);
    const card = page.locator(`#project-card-${seeded.projects.activeVcs.id}`);
    await card.getByRole("button", { name: "Project actions" }).click();
    await card.getByRole("button", { name: "Project settings" }).click();
    const roModal = page.getByRole("dialog");
    await expect(roModal).toContainText("Read-only access");
    await expect(roModal.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(roModal.getByRole("radio", { name: /^Paused\b/i })).toBeDisabled();
    await roModal.getByRole("button", { name: "Close", exact: true }).click();
  }

  assertNoUnexpectedBrowserErrors({ pageErrors, consoleErrors });
});

test("2. KPI Truthfulness, Real VCS/Git Branches, Untested Quadrant Isolation & Light/Dark Theme", async ({
  page,
  request,
}) => {
  const seedRes = await request.post(`${API_BASE}/__test/seed-portfolio`);
  expect(seedRes.ok()).toBe(true);
  const seeded = await seedRes.json();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await loginByEmail(page, seeded.users.owner.email, seeded.users.owner.id);

  // 1. Real Branch Resolution (never hardcoded "main")
  const vcsCard = page.locator(`#project-card-${seeded.projects.activeVcs.id}`);
  await expect(vcsCard).toContainText("feat/vn-checkout");
  const untestedCard = page.locator(`#project-card-${seeded.projects.untestedDoing.id}`);
  await expect(untestedCard).toContainText("release/v1.2");

  // 2. X/Y Measured Indicators + QA time saved (Est.) + Generated=3 (NOT 4) + zero "IEEE 829"
  const kpiRow = page.locator("#portfolio-executive-kpi-row");
  await expect(kpiRow).toContainText("1/2");
  await expect(kpiRow).toContainText("0/2");
  await expect(kpiRow).toContainText("QA time saved (Est.)");
  await expect(kpiRow).toContainText("Est. (CovAI Baseline)");
  // Generated card col has 3 generated & 1 healed
  const generatedTile = kpiRow.locator("div[title*='AI-generated']");
  await expect(generatedTile).toContainText("3");
  const healedTile = kpiRow.locator("div[title*='Self-healed']");
  await expect(healedTile).toContainText("1");

  // 3. Risk Quadrant isolates Worker Notification Service in "Not Yet Tested (1)"
  const analyticsZone = page.locator("#portfolio-benchmark-and-risk-zone");
  await expect(analyticsZone).toContainText("Not Yet Tested (1):");
  await expect(analyticsZone).toContainText("Worker Notification Service");

  // Switch Project Comparison to QA Time & Speedup ROI and confirm ZERO "IEEE 829" anywhere on page
  await analyticsZone.getByLabel("Select comparison bar chart").selectOption("roi");
  await expect(analyticsZone).toContainText("Est. (CovAI Baseline)");
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(/IEEE\s*829/i.test(bodyText)).toBe(false);

  // 4. Light / Dark theme toggle sanity
  const themeBtn = page.locator("header button[aria-label^='Current theme']");
  await expect(themeBtn).toBeVisible();
  const initialTheme = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  await themeBtn.click();
  const toggledTheme = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  expect(toggledTheme).not.toBe(initialTheme);
  await themeBtn.click();

  assertNoUnexpectedBrowserErrors({ pageErrors, consoleErrors });
});

test("3. Portfolio Export Report E2E: Real PDF, UTF-8 BOM + Formula-Safe CSV, JSON Parity, IDOR & 0-Doing Preview", async ({
  page,
  request,
}) => {
  const seedRes = await request.post(`${API_BASE}/__test/seed-portfolio`);
  expect(seedRes.ok()).toBe(true);
  const seeded = await seedRes.json();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await loginByEmail(page, seeded.users.owner.email, seeded.users.owner.id);

  // 1. Download real PDF (active_kpi scope)
  await page.locator("#portfolio-btn-export").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("In Export");

  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#portfolio-export-submit-btn").click(),
  ]);
  expect(pdfDownload.suggestedFilename()).toMatch(
    /^covai-portfolio-report-active-kpi-\d{4}-\d{2}-\d{2}\.pdf$/,
  );
  const pdfPath = await pdfDownload.path();
  const pdfBuf = fs.readFileSync(pdfPath);
  expect(pdfBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(pdfBuf.length).toBeGreaterThan(4000);

  // 2. Download CSV across "all" projects -> verify UTF-8 BOM & Formula Injection neutralization
  await page.locator("#portfolio-btn-export").click();
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /CSV Spreadsheet/i }).click();
  await modal.getByRole("radio", { name: /All Projects/i }).click();
  await expect(modal).toContainText(/2 non-Doing project\(s\)/i);

  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#portfolio-export-submit-btn").click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(
    /^covai-portfolio-report-all-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csvPath = await csvDownload.path();
  const csvText = await fsp.readFile(csvPath, "utf8");
  expect(csvText.startsWith("\uFEFF")).toBe(true);
  expect(csvText).toContain("Hệ thống Thanh toán VNPay");
  expect(csvText).toContain("feat/vn-checkout");
  expect(csvText).toContain("'=CMD");
  expect(csvText).toContain("'+malicious-branch");

  // 3. Filter directory -> Download JSON (Current Filtered View) & check canonical parity
  const directory = page.locator("#project-directory-workspace-zone");
  await directory.getByPlaceholder("Search projects...").fill("Thanh toán");
  await page.locator("#portfolio-btn-export").click();
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /JSON Data/i }).click();
  await modal.getByRole("radio", { name: /Current Filtered View/i }).click();

  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#portfolio-export-submit-btn").click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(
    /^covai-portfolio-report-filtered-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const jsonPath = await jsonDownload.path();
  const parsed = JSON.parse(await fsp.readFile(jsonPath, "utf8"));
  expect(parsed.metadata.generatedBy.email).toBe(seeded.users.owner.email);
  expect(parsed.metadata.scope).toBe("filtered");
  expect(parsed.projects.map((p) => p.id)).toEqual([seeded.projects.activeVcs.id]);
  expect(parsed.projects[0].branch).toBe("feat/vn-checkout");
  expect(Array.isArray(parsed.priorityFindings)).toBe(true);
  expect(parsed.priorityFindings.length).toBeGreaterThan(0);

  // 4. IDOR Check via direct API: foreignSecret projectId must be silently dropped
  const ownerToken = await apiLoginToken(request, seeded.users.owner.email);
  const idorRes = await request.post(`${API_BASE}/portfolio/export`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: {
      format: "json",
      scope: "filtered",
      projectIds: [seeded.projects.activeVcs.id, seeded.projects.foreignSecret.id],
    },
  });
  expect(idorRes.status()).toBe(200);
  const idorJson = JSON.parse(await idorRes.text());
  expect(idorJson.projects.map((p) => p.id)).toEqual([seeded.projects.activeVcs.id]);

  // 5. 0-Doing honest warning & empty PDF export
  for (const pid of [seeded.projects.activeVcs.id, seeded.projects.untestedDoing.id]) {
    const pRes = await request.patch(`${API_BASE}/projects/${pid}/status`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { lifecycleStatus: "PAUSED" },
    });
    expect(pRes.status()).toBe(200);
  }
  await page.reload();
  await markAllToursSeen(page);
  await page.locator("#portfolio-command-header").getByLabel("Refresh portfolio metrics").click();
  await expect(page.locator("#portfolio-command-header")).toContainText("0 doing (in KPI)");

  await page.locator("#portfolio-btn-export").click();
  await expect(modal).toContainText("0 projects are currently in Doing state");
  const [zeroPdfDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#portfolio-export-submit-btn").click(),
  ]);
  const zeroPdfBuf = fs.readFileSync(await zeroPdfDownload.path());
  expect(zeroPdfBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

  assertNoUnexpectedBrowserErrors({ pageErrors, consoleErrors });
});
