import { jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import { createAuthTestDatabase } from "./helpers/authTestDatabase.js";
import { login, register } from "../services/auth.service.js";
import {
  AUTH_ERROR_CODES,
  AUTH_LIMITS,
  AUTH_MESSAGES,
} from "../../../shared/authValidation.js";
import logger from "../utils/logger.js";

describe("auth.service.js — Account Lockout, Clock Injection & Security Audit", () => {
  let testDb;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-jwt-secret-for-auth-service-tests";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret-for-auth-service-tests";
    testDb = await createAuthTestDatabase();
  }, 60000);

  afterAll(async () => {
    if (testDb) await testDb.close();
  });

  beforeEach(async () => {
    await testDb.resetAuthTables();
  });

  it("TC_LOG_10 & TC_LOG_11: locks specific account at 5th failure for 15m, unlocks deterministically at +15m01s, and resets counter", async () => {
    await register("Alice", "alice@covai.test", "StrongPass1!");
    await register("Bob", "bob@covai.test", "StrongPass2!");

    let currentMs = Date.UTC(2026, 10, 23, 12, 0, 0);
    const now = () => new Date(currentMs);

    // Attempts 1..4 fail with 401 INVALID_CREDENTIALS
    for (let i = 1; i <= 4; i += 1) {
      await expect(
        login("alice@covai.test", "WrongPass!", { now, ip: "10.0.0.1" }),
      ).rejects.toMatchObject({
        statusCode: 401,
        code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        message: AUTH_MESSAGES.INVALID_CREDENTIALS,
      });
    }

    // Attempt 5 triggers 423 Locked for 15 minutes
    await expect(
      login("alice@covai.test", "WrongPass!", { now, ip: "10.0.0.1" }),
    ).rejects.toMatchObject({
      statusCode: 423,
      code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
      details: expect.objectContaining({
        retryAfterSeconds: 900,
      }),
    });

    // Account 2 (Bob) from same IP is completely unaffected
    const bobSession = await login("bob@covai.test", "StrongPass2!", {
      now,
      ip: "10.0.0.1",
    });
    expect(bobSession.accessToken).toBeTruthy();

    // At +14m59s Alice is STILL locked even with the correct password
    currentMs += AUTH_LIMITS.ACCOUNT_LOCKOUT_MS - 1000;
    await expect(
      login("alice@covai.test", "StrongPass1!", { now, ip: "10.0.0.1" }),
    ).rejects.toMatchObject({
      statusCode: 423,
      code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
      details: expect.objectContaining({ retryAfterSeconds: 1 }),
    });

    // At +15m01s Alice unlocks automatically and resets counters on login
    currentMs += 2000;
    const aliceSession = await login("alice@covai.test", "StrongPass1!", {
      now,
      ip: "10.0.0.1",
    });
    expect(aliceSession.accessToken).toBeTruthy();

    const aliceRow = await testDb.db.user.findUnique({
      where: { email: "alice@covai.test" },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });
    expect(aliceRow.failedLoginAttempts).toBe(0);
    expect(aliceRow.lockedUntil).toBeNull();
  });

  it("TC_LOG_11 (post-expiry wrong password): resets expired lockout counter to 1 instead of instant re-lock", async () => {
    await register("Eve", "eve@covai.test", "CorrectPass1!");
    let currentMs = Date.UTC(2026, 10, 23, 14, 0, 0);
    const now = () => new Date(currentMs);

    for (let i = 0; i < 5; i += 1) {
      await login("eve@covai.test", "BadPass!", { now }).catch(() => {});
    }

    currentMs += AUTH_LIMITS.ACCOUNT_LOCKOUT_MS + 1000;

    await expect(
      login("eve@covai.test", "BadPass!", { now }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    });

    const eveRow = await testDb.db.user.findUnique({
      where: { email: "eve@covai.test" },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });
    expect(eveRow.failedLoginAttempts).toBe(1);
    expect(eveRow.lockedUntil).toBeNull();
  });

  it("TC_LOG_19: resets failedLoginAttempts to 0 after a successful login", async () => {
    await register("ResetUser", "reset@covai.test", "ValidPass123!");
    for (let i = 0; i < 3; i += 1) {
      await expect(login("reset@covai.test", "WrongPass")).rejects.toMatchObject({
        statusCode: 401,
      });
    }

    await login("reset@covai.test", "ValidPass123!");
    const row = await testDb.db.user.findUnique({
      where: { email: "reset@covai.test" },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();

    // 4 more wrong attempts must NOT lock yet (counter started fresh from 0)
    for (let i = 0; i < 4; i += 1) {
      await expect(login("reset@covai.test", "WrongPass")).rejects.toMatchObject({
        statusCode: 401,
      });
    }
  });

  it("TC_LOG_18: rejects local login on GitHub-only user (passwordHash: null) with 400 OAUTH_ONLY_ACCOUNT and leaves counter at 0", async () => {
    await testDb.db.user.create({
      data: {
        email: "ghonly@covai.test",
        name: "GH Only",
        githubUserId: "900100",
        passwordHash: null,
      },
    });

    await expect(
      login("ghonly@covai.test", "any-password-123"),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: AUTH_ERROR_CODES.OAUTH_ONLY_ACCOUNT,
      message: AUTH_MESSAGES.OAUTH_ONLY_ACCOUNT,
    });

    const row = await testDb.db.user.findUnique({
      where: { email: "ghonly@covai.test" },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("TC_LOG_29 (QA08): logs structured [AUTH_SECURITY] events without leaking passwords, tokens, or stack traces", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const secretPassword = "SuperSecretWrongPassword999!";
    await register("AuditUser", "audit@covai.test", await bcrypt.hash("Pass1234!", 4));

    await login("audit@covai.test", secretPassword, { ip: "127.0.0.1" }).catch(
      () => {},
    );

    expect(warnSpy).toHaveBeenCalled();
    const combinedLogs = warnSpy.mock.calls.flat().join(" ");
    expect(combinedLogs).toContain("[AUTH_SECURITY]");
    expect(combinedLogs).toContain("LOGIN_FAILED");
    expect(combinedLogs).not.toContain(secretPassword);
    expect(combinedLogs).not.toContain("audit@covai.test");
    expect(combinedLogs).toContain("au***@covai.test");

    warnSpy.mockRestore();
  });
});
