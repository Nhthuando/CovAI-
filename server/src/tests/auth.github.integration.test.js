import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcryptjs";
import { jest } from "@jest/globals";
import { createAuthTestDatabase } from "./helpers/authTestDatabase.js";
import authRoute from "../routes/auth.route.js";
import { decrypt, isEncryptedFormat } from "../utils/crypto.js";
import { AUTH_ERROR_CODES, AUTH_MESSAGES } from "../../../shared/authValidation.js";

function createTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api/auth", authRoute);
  return app;
}

describe("GitHub OAuth 2.0 & Identity Linking Integration Tests (TC_LOG_15 – TC_LOG_17, TC_LOG_23 – TC_LOG_26)", () => {
  let testDb;
  let app;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    process.env.JWT_SECRET = "gh-integration-jwt-secret";
    process.env.JWT_REFRESH_SECRET = "gh-integration-refresh-secret";
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    process.env.GITHUB_CLIENT_ID = "gh-test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-test-client-secret";
    process.env.CLIENT_URL = "http://localhost:5173";
    process.env.LOGIN_IP_RATE_LIMIT_MAX = "1000";
    testDb = await createAuthTestDatabase();
    app = createTestApp();
  }, 60000);

  afterAll(async () => {
    global.fetch = originalFetch;
    if (testDb) await testDb.close();
  });

  beforeEach(async () => {
    global.fetch = originalFetch;
    await testDb.resetAuthTables();
    process.env.ENCRYPTION_KEY = "b".repeat(64);
  });

  async function issueOAuthStateCookie(mode = "login") {
    const res = await request(app).get(`/api/auth/github/url?mode=${mode}`);
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    const state = url.searchParams.get("state");
    const cookie = (res.headers["set-cookie"] || []).find((c) =>
      c.startsWith("covai_oauth_state="),
    );
    return { url, state, cookie };
  }

  function mockGithubApi({ id = 12345, login = "octo", name = "Octo Cat", avatarUrl = "https://avatars.example/octo.png", emails = [] } = {}) {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "gho_live_secret_token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id,
          login,
          name,
          avatar_url: avatarUrl,
          email: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => emails,
      });
  }

  it("TC_LOG_23: enforces minimal read:user user:email scopes and blocks missing/tampered CSRF state", async () => {
    const { url, state, cookie } = await issueOAuthStateCookie("login");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(state).toMatch(/^login\.[0-9a-f]{64}$/);

    global.fetch = jest.fn();
    const missingCookie = await request(app).get(
      `/api/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`,
    );
    expect(missingCookie.status).toBe(400);
    expect(missingCookie.body.code).toBe(AUTH_ERROR_CODES.INVALID_OAUTH_STATE);
    expect(global.fetch).not.toHaveBeenCalled();

    const tampered = await request(app)
      .get("/api/auth/github/callback?code=abc&state=login.tampered")
      .set("Cookie", cookie);
    expect(tampered.status).toBe(400);
    expect(tampered.body.code).toBe(AUTH_ERROR_CODES.INVALID_OAUTH_STATE);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("TC_LOG_15: authenticates already-linked GitHub user and updates encrypted token", async () => {
    await testDb.db.user.create({
      data: {
        email: "linked@covai.dev",
        name: "Linked Dev",
        githubUserId: "777001",
      },
    });

    const { state, cookie } = await issueOAuthStateCookie("login");
    mockGithubApi({
      id: 777001,
      login: "linkeddev",
      emails: [{ email: "other@github.dev", primary: true, verified: true }],
    });

    const res = await request(app)
      .get(`/api/auth/github/callback?code=good&state=${encodeURIComponent(state)}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("AUTHENTICATED");
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.email).toBe("linked@covai.dev");

    const row = await testDb.db.user.findUnique({
      where: { email: "linked@covai.dev" },
      select: { githubAccessTokenEnc: true },
    });
    expect(isEncryptedFormat(row.githubAccessTokenEnc)).toBe(true);
    expect(decrypt(row.githubAccessTokenEnc)).toBe("gho_live_secret_token");
  });

  it("TC_LOG_16 & TC_LOG_25: auto-registers first-time GitHub user with normalized verified email, avatar, and AES-256-GCM encrypted token", async () => {
    const { state, cookie } = await issueOAuthStateCookie("login");
    mockGithubApi({
      id: 888002,
      login: "newgh",
      name: "New GH User",
      avatarUrl: "https://avatars.example/new.png",
      emails: [{ email: "NewGH@Example.COM", primary: true, verified: true }],
    });

    const res = await request(app)
      .get(`/api/auth/github/callback?code=first-time&state=${encodeURIComponent(state)}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("AUTHENTICATED");
    expect(res.body.email).toBe("newgh@example.com");
    expect(res.body.avatarUrl).toBe("https://avatars.example/new.png");

    const created = await testDb.db.user.findUnique({
      where: { email: "newgh@example.com" },
      select: {
        githubUserId: true,
        avatarUrl: true,
        passwordHash: true,
        githubAccessTokenEnc: true,
      },
    });
    expect(created.githubUserId).toBe("888002");
    expect(created.passwordHash).toBeNull();
    expect(isEncryptedFormat(created.githubAccessTokenEnc)).toBe(true);
    expect(decrypt(created.githubAccessTokenEnc)).toBe("gho_live_secret_token");
  });

  it("TC_LOG_17 (Option B): requires explicit confirmation + local password when GitHub email matches local account, supports cancel, wrong-password lockout, expiry, and single-use confirm", async () => {
    const passwordHash = await bcrypt.hash("LocalOwnerPass1!", 4);
    await testDb.db.user.create({
      data: {
        email: "owner@covai.dev",
        name: "Local Owner",
        passwordHash,
      },
    });

    // Step 1: OAuth callback returns LINK_REQUIRED without modifying User
    const { state, cookie } = await issueOAuthStateCookie("login");
    mockGithubApi({
      id: 999003,
      login: "owner-gh",
      name: "Owner GH",
      avatarUrl: "https://avatars.example/owner.png",
      emails: [{ email: "owner@covai.dev", primary: true, verified: true }],
    });

    const cbRes = await request(app)
      .get(`/api/auth/github/callback?code=match&state=${encodeURIComponent(state)}`)
      .set("Cookie", cookie);

    expect(cbRes.status).toBe(200);
    expect(cbRes.body.status).toBe("LINK_REQUIRED");
    expect(cbRes.body.requiresPassword).toBe(true);
    expect(cbRes.body.linkToken).toBeTruthy();
    expect(cbRes.body.accessToken).toBeUndefined();

    const userBefore = await testDb.db.user.findUnique({
      where: { email: "owner@covai.dev" },
      select: { githubUserId: true },
    });
    expect(userBefore.githubUserId).toBeNull();

    // Step 2: Wrong password returns 401 and keeps linkToken alive
    const wrongPw = await request(app)
      .post("/api/auth/github/confirm-link")
      .send({ linkToken: cbRes.body.linkToken, password: "WrongPassword!" });
    expect(wrongPw.status).toBe(401);
    expect(wrongPw.body.code).toBe(AUTH_ERROR_CODES.INVALID_LINK_PASSWORD);

    // Step 3: Correct password links account, issues tokens, resets failedLoginAttempts, and consumes linkToken
    const confirmOk = await request(app)
      .post("/api/auth/github/confirm-link")
      .send({ linkToken: cbRes.body.linkToken, password: "LocalOwnerPass1!" });
    expect(confirmOk.status).toBe(200);
    expect(confirmOk.body.status).toBe("AUTHENTICATED");
    expect(confirmOk.body.accessToken).toBeTruthy();

    const userAfter = await testDb.db.user.findUnique({
      where: { email: "owner@covai.dev" },
      select: {
        githubUserId: true,
        failedLoginAttempts: true,
        githubAccessTokenEnc: true,
      },
    });
    expect(userAfter.githubUserId).toBe("999003");
    expect(userAfter.failedLoginAttempts).toBe(0);
    expect(isEncryptedFormat(userAfter.githubAccessTokenEnc)).toBe(true);

    // Step 4: Replay of same linkToken fails safely
    const replay = await request(app)
      .post("/api/auth/github/confirm-link")
      .send({ linkToken: cbRes.body.linkToken, password: "LocalOwnerPass1!" });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe(AUTH_ERROR_CODES.INVALID_LINK_TOKEN);
  });

  it("TC_LOG_17 (Cancel & Expiry & Brute-force Lock): cancel leaves user unlinked, expired token fails, 5 wrong passwords lock account", async () => {
    const passwordHash = await bcrypt.hash("LocalPass2!", 4);
    await testDb.db.user.create({
      data: {
        email: "victim@covai.dev",
        name: "Victim",
        passwordHash,
      },
    });

    // Test cancel flow
    const s1 = await issueOAuthStateCookie("login");
    mockGithubApi({
      id: 999004,
      login: "v-gh",
      emails: [{ email: "victim@covai.dev", primary: true, verified: true }],
    });
    const cb1 = await request(app)
      .get(`/api/auth/github/callback?code=c1&state=${encodeURIComponent(s1.state)}`)
      .set("Cookie", s1.cookie);
    expect(cb1.body.status).toBe("LINK_REQUIRED");

    const cancelRes = await request(app)
      .post("/api/auth/github/cancel-link")
      .send({ linkToken: cb1.body.linkToken });
    expect(cancelRes.status).toBe(200);

    const afterCancel = await request(app)
      .post("/api/auth/github/confirm-link")
      .send({ linkToken: cb1.body.linkToken, password: "LocalPass2!" });
    expect(afterCancel.status).toBe(400);
    expect(afterCancel.body.code).toBe(AUTH_ERROR_CODES.INVALID_LINK_TOKEN);

    // Test 5 wrong passwords lock during confirm-link
    const s2 = await issueOAuthStateCookie("login");
    mockGithubApi({
      id: 999004,
      login: "v-gh",
      emails: [{ email: "victim@covai.dev", primary: true, verified: true }],
    });
    const cb2 = await request(app)
      .get(`/api/auth/github/callback?code=c2&state=${encodeURIComponent(s2.state)}`)
      .set("Cookie", s2.cookie);

    for (let i = 1; i <= 4; i += 1) {
      const w = await request(app)
        .post("/api/auth/github/confirm-link")
        .send({ linkToken: cb2.body.linkToken, password: "wrong" });
      expect(w.status).toBe(401);
    }
    const locked = await request(app)
      .post("/api/auth/github/confirm-link")
      .send({ linkToken: cb2.body.linkToken, password: "wrong" });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe(AUTH_ERROR_CODES.ACCOUNT_LOCKED);

    // Test expired linkToken
    await testDb.db.user.update({
      where: { email: "victim@covai.dev" },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await testDb.db.githubPendingLink.updateMany({
      where: { email: "victim@covai.dev" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expiredRes = await request(app)
      .post("/api/auth/github/confirm-link")
      .send({ linkToken: cb2.body.linkToken, password: "LocalPass2!" });
    expect(expiredRes.status).toBe(400);
    expect(expiredRes.body.code).toBe(AUTH_ERROR_CODES.INVALID_LINK_TOKEN);
  });

  it("TC_LOG_24 & TC_LOG_25 & TC_LOG_26: graceful handling for access_denied, unverified email, invalid ENCRYPTION_KEY, and 409 conflict", async () => {
    const denied = await request(app).get(
      "/api/auth/github/callback?error=access_denied",
    );
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe(AUTH_ERROR_CODES.OAUTH_ACCESS_DENIED);
    expect(denied.body.message).toBe(AUTH_MESSAGES.OAUTH_ACCESS_DENIED);

    // Unverified email only -> 400 GITHUB_EMAIL_UNVERIFIED, zero orphan users
    const s1 = await issueOAuthStateCookie("login");
    mockGithubApi({
      id: 444555,
      login: "unverified",
      emails: [{ email: "unverified@example.com", primary: true, verified: false }],
    });
    const unverifiedRes = await request(app)
      .get(`/api/auth/github/callback?code=unv&state=${encodeURIComponent(s1.state)}`)
      .set("Cookie", s1.cookie);
    expect(unverifiedRes.status).toBe(400);
    expect(unverifiedRes.body.code).toBe(AUTH_ERROR_CODES.GITHUB_EMAIL_UNVERIFIED);
    expect(await testDb.db.user.count()).toBe(0);

    // Missing ENCRYPTION_KEY -> fail closed 500, zero plaintext in DB
    process.env.ENCRYPTION_KEY = "";
    const s2 = await issueOAuthStateCookie("login");
    mockGithubApi({
      id: 444556,
      login: "failenc",
      emails: [{ email: "failenc@example.com", primary: true, verified: true }],
    });
    const encFail = await request(app)
      .get(`/api/auth/github/callback?code=enc&state=${encodeURIComponent(s2.state)}`)
      .set("Cookie", s2.cookie);
    expect(encFail.status).toBe(500);
    expect(encFail.body.code).toBe(AUTH_ERROR_CODES.ENCRYPTION_CONFIG_ERROR);
    expect(await testDb.db.user.count()).toBe(0);

    // Restore key and verify 409 when email already linked to different githubUserId
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    await testDb.db.user.create({
      data: {
        email: "taken@covai.dev",
        githubUserId: "111",
      },
    });
    const s3 = await issueOAuthStateCookie("login");
    mockGithubApi({
      id: 222,
      login: "other",
      emails: [{ email: "taken@covai.dev", primary: true, verified: true }],
    });
    const conflict = await request(app)
      .get(`/api/auth/github/callback?code=conf&state=${encodeURIComponent(s3.state)}`)
      .set("Cookie", s3.cookie);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe(
      AUTH_ERROR_CODES.EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB,
    );
  });
});
