import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const SERVER_DIR = path.join(ROOT_DIR, "server");
const CLIENT_DIR = path.join(ROOT_DIR, "client");

const API_BASE = "http://127.0.0.1:55100/api";
const CLIENT_URL = "http://127.0.0.1:55273";

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

test.beforeAll(async () => {
  apiProc = spawn(process.execPath, ["e2e/auth-login-server.mjs"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      E2E_API_PORT: "55100",
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
      "55273",
      "--strictPort",
    ],
    {
      cwd: CLIENT_DIR,
      env: {
        ...process.env,
        VITE_API_URL: API_BASE,
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

test.afterAll(async () => {
  for (const proc of [viteProc, apiProc]) {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
    }
  }
});

test.beforeEach(async ({ request }) => {
  const res = await request.post(`${API_BASE}/__test/reset`);
  expect(res.ok()).toBe(true);
});

test("TC_LOG_01, TC_LOG_09, TC_LOG_14, TC_LOG_21, TC_LOG_22: logs in with normalized email, survives reload, and auto-redirects /login -> /projects", async ({
  page,
  request,
}) => {
  await request.post(`${API_BASE}/__test/seed`, {
    data: { email: "phuc@gmail.com", name: "Phuc QA", password: "ValidPassword123!" },
  });

  await page.goto("/login");
  await page.locator("#auth-email").fill("   PHUC@GMAIL.COM  ");
  await page.locator("#auth-password").fill("ValidPassword123!");
  await page.locator("#auth-submit-btn").click();

  await expect(page).toHaveURL(/\/projects$/);

  // TC_LOG_21: Reload (F5) preserves authenticated session
  await page.reload();
  await expect(page).toHaveURL(/\/projects$/);

  // TC_LOG_22: Already-authenticated user navigating to /login auto-redirects to /projects
  await page.goto("/login");
  await expect(page).toHaveURL(/\/projects$/);
});

test("TC_LOG_02 – TC_LOG_05, TC_LOG_13: standardized client-side validation blocks dispatch for empty, invalid, and XSS emails", async ({
  page,
}) => {
  let loginApiCalls = 0;
  await page.route("**/api/auth/login", async (route) => {
    loginApiCalls += 1;
    await route.continue();
  });

  await page.goto("/login");

  // TC_LOG_02: Both empty
  await page.locator("#auth-submit-btn").click();
  await expect(page.getByText("Email is required", { exact: true })).toBeVisible();
  await expect(page.getByText("Password is required", { exact: true })).toBeVisible();
  expect(loginApiCalls).toBe(0);

  // TC_LOG_05: Invalid email format
  await page.locator("#auth-email").fill("Phucgmail.com");
  await page.locator("#auth-password").fill("ValidPass123!");
  await page.locator("#auth-submit-btn").click();
  await expect(
    page.getByText("Please enter a valid email address", { exact: true }),
  ).toBeVisible();
  expect(loginApiCalls).toBe(0);

  // TC_LOG_13: XSS payload rejected client-side with identical copy & zero requests
  await page.locator("#auth-email").fill("<script>alert('XSS')</script>@test.com");
  await page.locator("#auth-submit-btn").click();
  await expect(
    page.getByText("Please enter a valid email address", { exact: true }),
  ).toBeVisible();
  expect(loginApiCalls).toBe(0);
});

test("TC_LOG_10 & TC_LOG_11: 5 failed logins lock Account 1 (423) while Account 2 logs in cleanly, then Account 1 unlocks after expiry", async ({
  page,
  request,
}) => {
  await request.post(`${API_BASE}/__test/seed`, {
    data: { email: "acc1@covai.test", name: "Account 1", password: "PassOne123!" },
  });
  await request.post(`${API_BASE}/__test/seed`, {
    data: { email: "acc2@covai.test", name: "Account 2", password: "PassTwo123!" },
  });

  await page.goto("/login");

  for (let i = 1; i <= 4; i += 1) {
    await page.locator("#auth-email").fill("acc1@covai.test");
    await page.locator("#auth-password").fill("wrong");
    await page.locator("#auth-submit-btn").click();
    await expect(page.locator("#auth-server-error")).toContainText(
      "Incorrect email or password",
    );
  }

  // 5th attempt triggers 423 account lock
  await page.locator("#auth-email").fill("acc1@covai.test");
  await page.locator("#auth-password").fill("wrong");
  await page.locator("#auth-submit-btn").click();
  await expect(page.locator("#auth-server-error")).toContainText(
    /temporarily locked/i,
  );

  // Account 2 logs in cleanly from the same browser & IP!
  await page.locator("#auth-email").fill("acc2@covai.test");
  await page.locator("#auth-password").fill("PassTwo123!");
  await page.locator("#auth-submit-btn").click();
  await expect(page).toHaveURL(/\/projects$/);

  // Sign out Account 2
  await page.evaluate(() => localStorage.clear());

  // Backdate Account 1's lockedUntil and verify Account 1 logs in again
  await request.post(`${API_BASE}/__test/backdate-lock`, {
    data: { email: "acc1@covai.test" },
  });

  await page.goto("/login");
  await page.locator("#auth-email").fill("acc1@covai.test");
  await page.locator("#auth-password").fill("PassOne123!");
  await page.locator("#auth-submit-btn").click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("TC_LOG_18: GitHub-only user sees clear guidance with GitHub and Set Local Password actions (no 500)", async ({
  page,
  request,
}) => {
  await request.post(`${API_BASE}/__test/seed`, {
    data: {
      email: "ghonly@covai.test",
      name: "GH Only",
      password: null,
      githubUserId: "910099",
    },
  });

  await page.goto("/login");
  await page.locator("#auth-email").fill("ghonly@covai.test");
  await page.locator("#auth-password").fill("AnyPassword123!");
  await page.locator("#auth-submit-btn").click();

  await expect(page.locator("#auth-server-error")).toContainText(
    "This account is linked with GitHub",
  );
  await expect(page.locator("#auth-oauth-guidance-github")).toBeVisible();
  await expect(page.locator("#auth-oauth-guidance-forgot")).toBeVisible();

  await page.locator("#auth-oauth-guidance-forgot").click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await expect(page.locator("#forgot-email")).toHaveValue("ghonly@covai.test");
});

test("TC_LOG_17 (Option B): GitHub OAuth matching local email requires explicit password confirmation and supports cancel & confirm", async ({
  page,
  request,
}) => {
  await request.post(`${API_BASE}/__test/seed`, {
    data: {
      email: "localmatch@covai.test",
      name: "Matched Owner",
      password: "OwnerPassword123!",
    },
  });

  // Intercept GitHub authorize redirect to bounce back to our callback with valid CSRF state
  await page.route("https://github.com/login/oauth/authorize*", async (route) => {
    const reqUrl = new URL(route.request().url());
    expect(reqUrl.searchParams.get("scope")).toBe("read:user user:email");
    const state = reqUrl.searchParams.get("state");
    await route.fulfill({
      status: 302,
      headers: {
        Location: `${CLIENT_URL}/auth/github/callback?code=e2e-match-local&state=${encodeURIComponent(state)}`,
      },
    });
  });

  // 1. Trigger GitHub login -> lands on Confirmation Card -> test Cancel
  await page.goto("/login");
  await page.locator("#auth-github-btn").click();

  await expect(page.locator("#github-link-heading")).toHaveText(
    "Confirm GitHub Account Linking",
  );
  await expect(page.getByText("localmatch@covai.test")).toBeVisible();
  await expect(page.getByText("@match-octo")).toBeVisible();

  await page.locator("#github-link-cancel-btn").click();
  await expect(page).toHaveURL(/\/login$/);

  const afterCancel = await (
    await request.get(`${API_BASE}/__test/user-state?email=localmatch@covai.test`)
  ).json();
  expect(afterCancel.user.githubUserId).toBeNull();

  // 2. Trigger again -> wrong password shows inline error -> valid password links & opens /projects
  await page.locator("#auth-github-btn").click();
  await expect(page.locator("#github-link-heading")).toBeVisible();

  await page.locator("#github-link-password").fill("WrongLocalPassword!");
  await page.locator("#github-link-confirm-btn").click();
  await expect(page.locator("#github-link-error")).toContainText(
    "Incorrect password",
  );

  await page.locator("#github-link-password").fill("OwnerPassword123!");
  await page.locator("#github-link-confirm-btn").click();
  await expect(page).toHaveURL(/\/projects$/);

  const afterConfirm = await (
    await request.get(`${API_BASE}/__test/user-state?email=localmatch@covai.test`)
  ).json();
  expect(afterConfirm.user.githubUserId).toBe("910003");
});

test("TC_LOG_24, TC_LOG_27, TC_LOG_28: OAuth cancel error view, Eye toggle, single-flight Enter submit, and auth links", async ({
  page,
  request,
}) => {
  await request.post(`${API_BASE}/__test/seed`, {
    data: { email: "ux@covai.test", name: "UX Dev", password: "UxPassword123!" },
  });

  // TC_LOG_27: Eye toggle + duplicate submit prevention + Enter key submit
  let postCount = 0;
  await page.route("**/api/auth/login", async (route) => {
    postCount += 1;
    await new Promise((r) => setTimeout(r, 250));
    await route.continue();
  });

  await page.goto("/login");
  const pwInput = page.locator("#auth-password");
  await expect(pwInput).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(pwInput).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(pwInput).toHaveAttribute("type", "password");

  await page.locator("#auth-email").fill("ux@covai.test");
  await pwInput.fill("UxPassword123!");
  await pwInput.press("Enter");
  await pwInput.press("Enter");

  await expect(page).toHaveURL(/\/projects$/);
  expect(postCount).toBe(1);

  // TC_LOG_24: GitHub access_denied callback renders friendly error + Back to Login
  await page.evaluate(() => localStorage.clear());
  await page.goto("/auth/github/callback?error=access_denied");
  await expect(page.getByText("GitHub Login Failed")).toBeVisible();
  await expect(page.getByText(/cancelled/i)).toBeVisible();
  await page.getByRole("button", { name: "Back to Login" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // TC_LOG_28: Navigation links
  await page.locator("#auth-toggle-to-register").click();
  await expect(page).toHaveURL(/\/register$/);
  await page.locator("#auth-toggle-to-login").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator("#auth-back-home").click();
  await expect(page).toHaveURL(/\/$/);
});
