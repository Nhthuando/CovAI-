import fs from "node:fs";
import path from "node:path";
import { jest } from "@jest/globals";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import { fileURLToPath } from "node:url";
import { createAuthTestDatabase } from "./helpers/authTestDatabase.js";
import { splitSqlStatements } from "../../scripts/applyVersionControlMigration.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDb = await createAuthTestDatabase();

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: testDb.db,
}));

jest.unstable_mockModule("../utils/email.js", () => ({
  sendEmail: jest.fn(async () => ({ ok: true })),
}));

let authRoute;
let refreshRoute;
let userRoute;
let authMiddleware;
let requireAuthProvider;
let AUTH_PROVIDERS;
let VC_MODES;
let AUTH_ERROR_CODES;

try {
  ({ default: authRoute } = await import("../routes/auth.route.js"));
  ({ default: refreshRoute } = await import("../routes/refresh.route.js"));
  ({ default: userRoute } = await import("../routes/user.route.js"));
  ({ authMiddleware } = await import("../middlewares/auth.middleware.js"));
  ({ requireAuthProvider } = await import(
    "../middlewares/requireAuthProvider.middleware.js"
  ));
  ({ AUTH_PROVIDERS, VC_MODES } = await import(
    "../../../shared/versionControlMode.js"
  ));
  ({ AUTH_ERROR_CODES } = await import("../../../shared/authValidation.js"));
} catch (error) {
  await testDb.close().catch(() => {});
  throw error;
}

function buildTestApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoute);
  app.use("/api/refresh", refreshRoute);
  app.use("/api/users", userRoute);

  app.get(
    "/api/test/github-only",
    authMiddleware,
    requireAuthProvider(AUTH_PROVIDERS.GITHUB),
    (req, res) =>
      res.status(200).json({ ok: true, authProvider: req.user.authProvider }),
  );
  app.get(
    "/api/test/email-only",
    authMiddleware,
    requireAuthProvider(AUTH_PROVIDERS.EMAIL),
    (req, res) =>
      res.status(200).json({ ok: true, authProvider: req.user.authProvider }),
  );
  return app;
}

describe("Phase 0 Auth Provider Separation & Migration Idempotency", () => {
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    CLIENT_URL: process.env.CLIENT_URL,
  };
  const originalFetch = global.fetch;
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || "phase0_test_jwt_secret_1234567890";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET || "phase0_test_refresh_secret_1234567890";
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY || "0123456789abcdef".repeat(4);
    process.env.GITHUB_CLIENT_ID =
      process.env.GITHUB_CLIENT_ID || "phase0-github-client-id";
    process.env.GITHUB_CLIENT_SECRET =
      process.env.GITHUB_CLIENT_SECRET || "phase0-github-client-secret";
    process.env.CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
    app = buildTestApp();
  });

  beforeEach(async () => {
    await testDb.resetAuthTables();
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    await testDb.close();
  });

  async function issueGithubStateCookie(mode = "login") {
    const res = await request(app).get(`/api/auth/github/url?mode=${mode}`);
    const url = new URL(res.body.url);
    const cookie = res.headers["set-cookie"]?.[0] || "";
    return { state: url.searchParams.get("state"), cookie };
  }

  function mockGithubOAuthFlow({
    githubId = 889900,
    login = "phase0-octo",
    email = "phase0-octo@example.com",
    scope = "repo read:user user:email",
  } = {}) {
    global.fetch = jest.fn(async (input) => {
      const target = String(input);
      if (target.includes("github.com/login/oauth/access_token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "gho_phase0_token",
            scope,
          }),
        };
      }
      if (target.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            id: githubId,
            login,
            name: "Phase0 Octo",
            email,
            avatar_url: "https://avatars.example.com/u/889900",
          }),
        };
      }
      if (target.endsWith("/user/emails")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ email, primary: true, verified: true }],
        };
      }
      throw new Error(`Unexpected fetch URL: ${target}`);
    });
  }

  it("issues authProvider='email' in JWT & /api/users/me after email register and login", async () => {
    const reg = await request(app).post("/api/auth/register").send({
      name: "Email Dev",
      email: "email.dev@example.com",
      password: "Password123!",
    });
    expect(reg.status).toBe(201);
    expect(reg.body.authProvider).toBe(AUTH_PROVIDERS.EMAIL);

    const decodedReg = jwt.verify(reg.body.accessToken, process.env.JWT_SECRET);
    expect(decodedReg.authProvider).toBe(AUTH_PROVIDERS.EMAIL);

    const log = await request(app).post("/api/auth/login").send({
      email: "email.dev@example.com",
      password: "Password123!",
    });
    expect(log.status).toBe(200);
    expect(log.body.authProvider).toBe(AUTH_PROVIDERS.EMAIL);

    const meRes = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${log.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({
      email: "email.dev@example.com",
      authProvider: AUTH_PROVIDERS.EMAIL,
      vcMode: VC_MODES.SNAPSHOT_VCS,
      githubLogin: null,
      githubScopes: [],
      hasGithubRepoWriteScope: false,
      hasLocalPassword: true,
    });
    expect(meRes.body.passwordHash).toBeUndefined();
    expect(meRes.body.githubAccessTokenEnc).toBeUndefined();
  });

  it("issues authProvider='github' & persists githubLogin/scopes on GitHub OAuth login", async () => {
    const { state, cookie } = await issueGithubStateCookie("login");
    mockGithubOAuthFlow();

    const cb = await request(app)
      .get(`/api/auth/github/callback?code=oauth-code-1&state=${encodeURIComponent(state)}`)
      .set("Cookie", cookie);

    expect(cb.status).toBe(200);
    expect(cb.body.authProvider).toBe(AUTH_PROVIDERS.GITHUB);
    expect(cb.body.githubLogin).toBe("phase0-octo");
    expect(cb.body.githubScopes).toEqual(["repo", "read:user", "user:email"]);
    expect(cb.body.hasGithubRepoWriteScope).toBe(true);

    const decoded = jwt.verify(cb.body.accessToken, process.env.JWT_SECRET);
    expect(decoded.authProvider).toBe(AUTH_PROVIDERS.GITHUB);

    const meRes = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${cb.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({
      authProvider: AUTH_PROVIDERS.GITHUB,
      vcMode: VC_MODES.GIT_GITHUB,
      githubLogin: "phase0-octo",
      githubScopes: ["repo", "read:user", "user:email"],
      hasGithubRepoWriteScope: true,
      hasLocalPassword: false,
    });
    expect(meRes.body.passwordHash).toBeUndefined();
    expect(meRes.body.githubAccessTokenEnc).toBeUndefined();
  });

  it("allows dual-linked user to switch active session mode based on login method", async () => {
    await request(app).post("/api/auth/register").send({
      name: "Dual User",
      email: "dual@example.com",
      password: "Password123!",
    });

    // Simulate existing GitHub link on dual user
    const userRow = await testDb.db.user.findUnique({
      where: { email: "dual@example.com" },
    });
    await testDb.db.user.update({
      where: { id: userRow.id },
      data: {
        githubUserId: "554433",
        githubLogin: "dual-octo",
        githubOAuthScopes: "repo read:user user:email",
      },
    });

    // Login via Email -> email session
    const emailLogin = await request(app).post("/api/auth/login").send({
      email: "dual@example.com",
      password: "Password123!",
    });
    expect(emailLogin.status).toBe(200);
    expect(emailLogin.body.authProvider).toBe(AUTH_PROVIDERS.EMAIL);

    // Login via GitHub OAuth -> github session
    const { state, cookie } = await issueGithubStateCookie("login");
    mockGithubOAuthFlow({
      githubId: 554433,
      login: "dual-octo",
      email: "dual@example.com",
    });
    const ghLogin = await request(app)
      .get(`/api/auth/github/callback?code=dual-code&state=${encodeURIComponent(state)}`)
      .set("Cookie", cookie);
    expect(ghLogin.status).toBe(200);
    expect(ghLogin.body.authProvider).toBe(AUTH_PROVIDERS.GITHUB);

    const ghCheck = await request(app)
      .get("/api/test/github-only")
      .set("Authorization", `Bearer ${ghLogin.body.accessToken}`);
    expect(ghCheck.status).toBe(200);

    const emailCheckBlocked = await request(app)
      .get("/api/test/email-only")
      .set("Authorization", `Bearer ${ghLogin.body.accessToken}`);
    expect(emailCheckBlocked.status).toBe(403);
    expect(emailCheckBlocked.body).toMatchObject({
      success: false,
      code: AUTH_ERROR_CODES.AUTH_PROVIDER_MISMATCH,
      expectedProvider: AUTH_PROVIDERS.EMAIL,
      actualProvider: AUTH_PROVIDERS.GITHUB,
    });
  });

  it("enforces requireAuthProvider 403 mismatch and supports legacy JWT fallback", async () => {
    const reg = await request(app).post("/api/auth/register").send({
      name: "Legacy User",
      email: "legacy@example.com",
      password: "Password123!",
    });
    const dbUser = await testDb.db.user.findUnique({
      where: { email: "legacy@example.com" },
    });

    // Legacy token without authProvider claim on email user -> falls back to DB ("email")
    const legacyEmailJwt = jwt.sign(
      { userId: dbUser.id, userEmail: dbUser.email, userName: dbUser.name },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    const emailPass = await request(app)
      .get("/api/test/email-only")
      .set("Authorization", `Bearer ${legacyEmailJwt}`);
    expect(emailPass.status).toBe(200);
    expect(emailPass.body.authProvider).toBe(AUTH_PROVIDERS.EMAIL);

    const ghBlocked = await request(app)
      .get("/api/test/github-only")
      .set("Authorization", `Bearer ${legacyEmailJwt}`);
    expect(ghBlocked.status).toBe(403);
    expect(ghBlocked.body).toMatchObject({
      success: false,
      code: AUTH_ERROR_CODES.AUTH_PROVIDER_MISMATCH,
      expectedProvider: AUTH_PROVIDERS.GITHUB,
      actualProvider: AUTH_PROVIDERS.EMAIL,
    });

    // Legacy GitHub-only user without passwordHash and without lastAuthProvider
    const ghOnlyUser = await testDb.db.user.create({
      data: {
        email: "legacy-gh@example.com",
        name: "Legacy Octo",
        githubUserId: "998877",
        lastAuthProvider: null,
      },
    });
    const legacyGhJwt = jwt.sign(
      { userId: ghOnlyUser.id, userEmail: ghOnlyUser.email, userName: ghOnlyUser.name },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );
    const ghPass = await request(app)
      .get("/api/test/github-only")
      .set("Authorization", `Bearer ${legacyGhJwt}`);
    expect(ghPass.status).toBe(200);
    expect(ghPass.body.authProvider).toBe(AUTH_PROVIDERS.GITHUB);

    expect(reg.status).toBe(201);
  });

  it("preserves authProvider across /api/refresh (standard, sliding renewal, and legacy)", async () => {
    const { state, cookie } = await issueGithubStateCookie("login");
    mockGithubOAuthFlow({
      githubId: 445566,
      login: "refresh-octo",
      email: "refresh-octo@example.com",
    });
    const cb = await request(app)
      .get(`/api/auth/github/callback?code=rf-code&state=${encodeURIComponent(state)}`)
      .set("Cookie", cookie);

    const refreshCookie = (cb.headers["set-cookie"] || []).find((c) =>
      c.startsWith("refreshToken="),
    );
    expect(refreshCookie).toMatch(/refreshToken=/);

    // 1. Standard refresh preserves authProvider="github"
    const res1 = await request(app).post("/api/refresh").set("Cookie", refreshCookie);
    expect(res1.status).toBe(200);
    expect(res1.body.authProvider).toBe(AUTH_PROVIDERS.GITHUB);
    expect(jwt.verify(res1.body.accessToken, process.env.JWT_SECRET).authProvider).toBe(
      AUTH_PROVIDERS.GITHUB,
    );

    // 2. Sliding renewal (< 7 days remaining) renews refresh token AND preserves authProvider
    const dbUser = await testDb.db.user.findUnique({
      where: { email: "refresh-octo@example.com" },
    });
    const shortRefreshSecret =
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const shortRefresh = jwt.sign(
      { userId: dbUser.id, authProvider: AUTH_PROVIDERS.EMAIL },
      shortRefreshSecret,
      { expiresIn: "2d" },
    );
    await testDb.db.user.update({
      where: { id: dbUser.id },
      data: { refreshToken: shortRefresh },
    });
    const res2 = await request(app)
      .post("/api/refresh")
      .set("Cookie", `refreshToken=${shortRefresh}`);
    expect(res2.status).toBe(200);
    expect(res2.body.authProvider).toBe(AUTH_PROVIDERS.EMAIL);
    expect(res2.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);
    expect(res2.headers["set-cookie"]?.[0]).not.toContain(shortRefresh);

    // 3. Legacy refresh token without authProvider falls back cleanly
    const legacyRefresh = jwt.sign({ userId: dbUser.id }, shortRefreshSecret, {
      expiresIn: "20d",
    });
    await testDb.db.user.update({
      where: { id: dbUser.id },
      data: { refreshToken: legacyRefresh, lastAuthProvider: null },
    });
    const res3 = await request(app)
      .post("/api/refresh")
      .set("Cookie", `refreshToken=${legacyRefresh}`);
    expect(res3.status).toBe(200);
    expect(res3.body.authProvider).toBe(AUTH_PROVIDERS.GITHUB);
  });

  it("GET /api/auth/github/capabilities handles valid token, 401 revoked, and missing token", async () => {
    const reg = await request(app).post("/api/auth/register").send({
      name: "No GitHub",
      email: "nogh@example.com",
      password: "Password123!",
    });

    // Missing GitHub connection
    const missingRes = await request(app)
      .get("/api/auth/github/capabilities?refresh=true")
      .set("Authorization", `Bearer ${reg.body.accessToken}`);
    expect(missingRes.status).toBe(200);
    expect(missingRes.body.data).toMatchObject({
      connected: false,
      valid: false,
      revoked: false,
      hasRepoScope: false,
    });

    // Valid connected GitHub user
    const { state, cookie } = await issueGithubStateCookie("login");
    mockGithubOAuthFlow({
      githubId: 771122,
      login: "cap-octo",
      email: "cap@example.com",
    });
    const ghLogin = await request(app)
      .get(`/api/auth/github/callback?code=cap-code&state=${encodeURIComponent(state)}`)
      .set("Cookie", cookie);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (headerName) => {
          const lower = String(headerName).toLowerCase();
          if (lower === "x-oauth-scopes") return "repo, read:user, user:email";
          if (lower === "x-ratelimit-remaining") return "4999";
          return null;
        },
      },
      json: async () => ({ login: "cap-octo" }),
    });

    const validRes = await request(app)
      .get("/api/auth/github/capabilities?refresh=true")
      .set("Authorization", `Bearer ${ghLogin.body.accessToken}`);
    expect(validRes.status).toBe(200);
    expect(validRes.body.data).toMatchObject({
      connected: true,
      valid: true,
      revoked: false,
      login: "cap-octo",
      scopes: ["repo", "read:user", "user:email"],
      hasRepoScope: true,
      rateLimitRemaining: 4999,
    });

    // Revoked 401 response
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ message: "Bad credentials" }),
    });
    const revokedRes = await request(app)
      .get("/api/auth/github/capabilities?refresh=true")
      .set("Authorization", `Bearer ${ghLogin.body.accessToken}`);
    expect(revokedRes.status).toBe(200);
    expect(revokedRes.body.data).toMatchObject({
      connected: true,
      valid: false,
      revoked: true,
      scopes: [],
      hasRepoScope: false,
    });
  });

  it("executes Phase 0 additive migration SQL twice cleanly on PGlite without errors", async () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../prisma/migrations/20261127000000_version_control_separation_and_snapshot_vcs/migration.sql",
    );
    const sqlText = fs.readFileSync(migrationPath, "utf8");
    const statements = splitSqlStatements(sqlText);
    expect(statements.length).toBeGreaterThan(20);

    for (const stmt of statements) {
      await testDb.engine.exec(stmt);
    }
    // Second execution must remain completely idempotent
    for (const stmt of statements) {
      await testDb.engine.exec(stmt);
    }

    const tableCheck = await testDb.engine.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'SnapshotVcs%';`,
    );
    const names = tableCheck.rows.map((r) => r.table_name).sort();
    expect(names).toEqual([
      "SnapshotVcsBlobRef",
      "SnapshotVcsBranch",
      "SnapshotVcsEntry",
      "SnapshotVcsStaging",
      "SnapshotVcsTag",
    ]);
  });
});
