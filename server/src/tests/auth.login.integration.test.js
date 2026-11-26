import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createAuthTestDatabase } from "./helpers/authTestDatabase.js";
import authRoute from "../routes/auth.route.js";
import refreshRoute from "../routes/refresh.route.js";
import { AUTH_ERROR_CODES, AUTH_MESSAGES } from "../../../shared/authValidation.js";

function createTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api/auth", authRoute);
  app.use("/api/refresh", refreshRoute);
  return app;
}

describe("Login & Session Integration Tests (TC_LOG_01 – TC_LOG_14, TC_LOG_18 – TC_LOG_21, TC_LOG_30)", () => {
  let testDb;
  let app;

  beforeAll(async () => {
    process.env.JWT_SECRET = "integration-jwt-secret-key";
    process.env.JWT_REFRESH_SECRET = "integration-refresh-secret-key";
    process.env.JWT_ACCESS_EXPIRES_IN = "15m";
    process.env.LOGIN_IP_RATE_LIMIT_MAX = "1000";
    testDb = await createAuthTestDatabase();
    app = createTestApp();
  }, 60000);

  afterAll(async () => {
    if (testDb) await testDb.close();
  });

  beforeEach(async () => {
    await testDb.resetAuthTables();
  });

  async function seedUser(email, password, name = "Test Engineer") {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name, email, password });
    expect(res.status).toBe(201);
    return res.body;
  }

  it("TC_LOG_01 & TC_LOG_21: logs in with valid credentials, issues 15m JWT + HttpOnly refresh cookie, and refreshes token", async () => {
    await seedUser("phuc@covai.dev", "ValidPass123!");

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "phuc@covai.dev", password: "ValidPass123!" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.userId).toBeTruthy();
    expect(res.body.email).toBe("phuc@covai.dev");

    const decoded = jwt.verify(res.body.accessToken, process.env.JWT_SECRET);
    expect(decoded.exp - decoded.iat).toBe(15 * 60);

    const setCookie = res.headers["set-cookie"] || [];
    const refreshCookie = setCookie.find((c) => c.startsWith("refreshToken="));
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie).toMatch(/HttpOnly/i);

    const refreshRes = await request(app)
      .post("/api/refresh")
      .set("Cookie", refreshCookie);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
  });

  it("TC_LOG_02 – TC_LOG_04: returns standardized 400 validation errors for empty email/password", async () => {
    const bothEmpty = await request(app)
      .post("/api/auth/login")
      .send({ email: "", password: "" });
    expect(bothEmpty.status).toBe(400);
    expect(bothEmpty.body.error.email[0]).toBe(AUTH_MESSAGES.EMAIL_REQUIRED);
    expect(bothEmpty.body.error.password[0]).toBe(AUTH_MESSAGES.PASSWORD_REQUIRED);

    const emptyPass = await request(app)
      .post("/api/auth/login")
      .send({ email: "phuc@covai.dev", password: "" });
    expect(emptyPass.status).toBe(400);
    expect(emptyPass.body.error.password[0]).toBe(AUTH_MESSAGES.PASSWORD_REQUIRED);

    const emptyEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "   ", password: "ValidPass123!" });
    expect(emptyEmail.status).toBe(400);
    expect(emptyEmail.body.error.email[0]).toBe(AUTH_MESSAGES.EMAIL_REQUIRED);
  });

  it("TC_LOG_05 & TC_LOG_13: invalid email and XSS payload return identical standardized message", async () => {
    const invalidRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "Phucgmail.com", password: "ValidPass123!" });
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error.email[0]).toBe(AUTH_MESSAGES.EMAIL_INVALID);

    const xssRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: "<script>alert('XSS')</script>@test.com",
        password: "ValidPass123!",
      });
    expect(xssRes.status).toBe(400);
    expect(xssRes.body.error.email[0]).toBe(AUTH_MESSAGES.EMAIL_INVALID);
  });

  it("TC_LOG_06 – TC_LOG_08: unregistered email, wrong password (including short password), and wrong casing return 401 generic error", async () => {
    await seedUser("case@covai.dev", "SecretPass123!");

    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@covai.dev", password: "SecretPass123!" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(AUTH_MESSAGES.INVALID_CREDENTIALS);

    const wrongShort = await request(app)
      .post("/api/auth/login")
      .send({ email: "case@covai.dev", password: "abc" });
    expect(wrongShort.status).toBe(401);
    expect(wrongShort.body.message).toBe(AUTH_MESSAGES.INVALID_CREDENTIALS);

    const wrongCase = await request(app)
      .post("/api/auth/login")
      .send({ email: "case@covai.dev", password: "secretpass123!" });
    expect(wrongCase.status).toBe(401);
    expect(wrongCase.body.message).toBe(AUTH_MESSAGES.INVALID_CREDENTIALS);

    const dbUser = await testDb.db.user.findUnique({
      where: { email: "case@covai.dev" },
      select: { failedLoginAttempts: true },
    });
    expect(dbUser.failedLoginAttempts).toBe(2);
  });

  it("TC_LOG_09 & TC_LOG_14: normalizes uppercase and whitespace-padded emails on login", async () => {
    await seedUser("phuc@gmail.com", "ValidPass123!");

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "   PHUC@GMAIL.COM  ", password: "ValidPass123!" });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("phuc@gmail.com");
  });

  it("TC_LOG_10 & TC_LOG_11: locks Account 1 after 5 failures with 423 + Retry-After while Account 2 succeeds, then restores after expiry", async () => {
    await seedUser("acc1@covai.dev", "Account1Pass!");
    await seedUser("acc2@covai.dev", "Account2Pass!");

    for (let i = 1; i <= 4; i += 1) {
      const r = await request(app)
        .post("/api/auth/login")
        .send({ email: "acc1@covai.dev", password: "wrong" });
      expect(r.status).toBe(401);
    }

    const fifth = await request(app)
      .post("/api/auth/login")
      .send({ email: "acc1@covai.dev", password: "wrong" });
    expect(fifth.status).toBe(423);
    expect(fifth.body.code).toBe(AUTH_ERROR_CODES.ACCOUNT_LOCKED);
    expect(Number(fifth.headers["retry-after"])).toBeGreaterThan(800);

    // 6th attempt even with right password is still 423 Locked
    const sixthRight = await request(app)
      .post("/api/auth/login")
      .send({ email: "acc1@covai.dev", password: "Account1Pass!" });
    expect(sixthRight.status).toBe(423);

    // Account 2 from the exact same IP logs in normally!
    const acc2Login = await request(app)
      .post("/api/auth/login")
      .send({ email: "acc2@covai.dev", password: "Account2Pass!" });
    expect(acc2Login.status).toBe(200);

    // Simulate 15-minute expiry in PostgreSQL
    await testDb.db.user.update({
      where: { email: "acc1@covai.dev" },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    const unlockedLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "acc1@covai.dev", password: "Account1Pass!" });
    expect(unlockedLogin.status).toBe(200);

    const acc1After = await testDb.db.user.findUnique({
      where: { email: "acc1@covai.dev" },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });
    expect(acc1After.failedLoginAttempts).toBe(0);
    expect(acc1After.lockedUntil).toBeNull();
  });

  it("TC_LOG_12: rejects SQL injection payload safely without DB error leakage", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "' OR 1=1; --", password: "anything" });
    expect(res.status).toBe(400);
    expect(res.body.error.email[0]).toBe(AUTH_MESSAGES.EMAIL_INVALID);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres|sql|syntax/i);
  });

  it("TC_LOG_18: returns 400 OAUTH_ONLY_ACCOUNT (never 500) when logging in locally on a GitHub-only account", async () => {
    await testDb.db.user.create({
      data: {
        email: "ghuser@covai.dev",
        name: "GitHub User",
        githubUserId: "555111",
        passwordHash: null,
      },
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghuser@covai.dev", password: "AnyPassword123!" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(AUTH_ERROR_CODES.OAUTH_ONLY_ACCOUNT);
    expect(res.body.message).toBe(AUTH_MESSAGES.OAUTH_ONLY_ACCOUNT);
  });

  it("TC_LOG_20: handles 5 concurrent wrong-password attempts atomically and locks the account", async () => {
    await seedUser("concurrent@covai.dev", "ConcurrentPass1!");

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/auth/login")
          .send({ email: "concurrent@covai.dev", password: "WrongPassword!" }),
      ),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(423);

    const userRow = await testDb.db.user.findUnique({
      where: { email: "concurrent@covai.dev" },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });
    expect(userRow.failedLoginAttempts).toBe(5);
    expect(userRow.lockedUntil).toBeInstanceOf(Date);
  });

  it("TC_LOG_30: resetPassword unlocks locked/GitHub-only account and logout clears refresh token", async () => {
    const crypto = await import("node:crypto");
    const rawToken = "test-reset-token-123456";
    const hashed = crypto.createHash("sha256").update(rawToken).digest("hex");

    await testDb.db.user.create({
      data: {
        email: "recover@covai.dev",
        name: "Recover User",
        githubUserId: "888999",
        passwordHash: null,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 600_000),
        passwordResetToken: hashed,
        passwordResetExpires: new Date(Date.now() + 60_000),
      },
    });

    const resetRes = await request(app)
      .post(`/api/auth/resetPassword/${rawToken}`)
      .send({ newPassword: "NewLocalPass123!" });
    expect(resetRes.status).toBe(200);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "recover@covai.dev", password: "NewLocalPass123!" });
    expect(loginRes.status).toBe(200);

    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);
    expect(logoutRes.status).toBe(200);

    const afterLogout = await testDb.db.user.findUnique({
      where: { email: "recover@covai.dev" },
      select: { refreshToken: true },
    });
    expect(afterLogout.refreshToken).toBeNull();
  });

  it("keeps existing refresh session valid when user signs in from a second tab/browser, and clears all on logout", async () => {
    await seedUser("multisession@covai.dev", "ValidPass123!");

    const login1 = await request(app)
      .post("/api/auth/login")
      .send({ email: "multisession@covai.dev", password: "ValidPass123!" });
    expect(login1.status).toBe(200);
    const cookie1 = (login1.headers["set-cookie"] || []).find((c) => c.startsWith("refreshToken="));

    await new Promise((r) => setTimeout(r, 1100));

    const login2 = await request(app)
      .post("/api/auth/login")
      .send({ email: "multisession@covai.dev", password: "ValidPass123!" });
    expect(login2.status).toBe(200);
    const cookie2 = (login2.headers["set-cookie"] || []).find((c) => c.startsWith("refreshToken="));
    expect(cookie2).not.toBe(cookie1);

    const refresh1 = await request(app).post("/api/refresh").set("Cookie", cookie1);
    expect(refresh1.status).toBe(200);
    expect(refresh1.body.accessToken).toBeTruthy();

    const refresh2 = await request(app).post("/api/refresh").set("Cookie", cookie2);
    expect(refresh2.status).toBe(200);
    expect(refresh2.body.accessToken).toBeTruthy();

    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${refresh2.body.accessToken}`);
    expect(logoutRes.status).toBe(200);

    const afterLogoutRefresh = await request(app).post("/api/refresh").set("Cookie", cookie1);
    expect(afterLogoutRefresh.status).toBe(403);
  });
});
