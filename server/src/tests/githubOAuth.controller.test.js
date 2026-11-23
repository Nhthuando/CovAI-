import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { jest } from "@jest/globals";

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  githubPendingLink: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(async (arg) =>
    typeof arg === "function" ? arg(prismaMock) : Promise.all(arg),
  ),
};

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: prismaMock,
}));

jest.unstable_mockModule("../utils/crypto.js", () => ({
  encrypt: jest.fn((val) => `enc:${val}`),
  decrypt: jest.fn((val) => val.replace(/^enc:/, "")),
  isEncryptedFormat: jest.fn(() => true),
}));

jest.unstable_mockModule("../middlewares/auth.middleware.js", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = {
      id: "user-regular-1",
      name: "Regular User",
      email: "regular@covai.dev",
    };
    next();
  },
}));

const { default: authRouter } = await import("../routes/auth.route.js");

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use("/api/auth", authRouter);

describe("GitHub OAuth Connect & Callback Routes", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function getStateAndCookie(mode) {
    const urlRes = await request(app).get(`/api/auth/github/url?mode=${mode}`);
    const parsed = new URL(urlRes.body.url);
    const state = parsed.searchParams.get("state");
    const cookie = (urlRes.headers["set-cookie"] || []).find((c) =>
      c.startsWith("covai_oauth_state="),
    );
    return { state, cookie };
  }

  describe("POST /api/auth/github/connect", () => {
    it("returns 400 when code is missing", async () => {
      const { state, cookie } = await getStateAndCookie("connect");
      const res = await request(app)
        .post("/api/auth/github/connect")
        .set("Cookie", cookie)
        .send({ state });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Code parameter not found/i);
    });

    it("returns 400 when GitHub rejects the OAuth code", async () => {
      const { state, cookie } = await getStateAndCookie("connect");
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        }),
      });

      const res = await request(app)
        .post("/api/auth/github/connect")
        .set("Cookie", cookie)
        .send({ code: "expired-code", state });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("The code passed is incorrect or expired.");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("returns 409 when GitHub account is already linked to another user", async () => {
      const { state, cookie } = await getStateAndCookie("connect");
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "gho_123" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 999888, login: "octocat" }),
        });

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "other-user-2" });

      const res = await request(app)
        .post("/api/auth/github/connect")
        .set("Cookie", cookie)
        .send({ code: "valid-code", state });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already linked/i);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("links GitHub to the authenticated user without creating a duplicate account", async () => {
      const { state, cookie } = await getStateAndCookie("connect");
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "gho_abc" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 777666, login: "dev-octo" }),
        });

      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.update.mockResolvedValueOnce({
        id: "user-regular-1",
        githubUserId: "777666",
      });

      const res = await request(app)
        .post("/api/auth/github/connect")
        .set("Cookie", cookie)
        .send({ code: "valid-code", state });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: "GitHub account connected successfully!",
        githubUserId: "777666",
        githubLogin: "dev-octo",
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-regular-1" },
        data: {
          githubUserId: "777666",
          githubAccessTokenEnc: "enc:gho_abc",
        },
        select: { id: true, githubUserId: true },
      });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/auth/github/callback", () => {
    it("logs in existing linked user by githubUserId even if GitHub email differs", async () => {
      const { state, cookie } = await getStateAndCookie("login");
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "gho_login" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 777666, login: "dev-octo", email: null }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { email: "different@github.dev", primary: true, verified: true },
          ],
        });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "user-regular-1",
        email: "regular@covai.dev",
        name: "Regular User",
        avatarUrl: null,
        githubUserId: "777666",
      });
      prismaMock.user.update.mockResolvedValue({
        id: "user-regular-1",
        email: "regular@covai.dev",
        name: "Regular User",
        avatarUrl: null,
        githubUserId: "777666",
      });

      const res = await request(app)
        .get(`/api/auth/github/callback?code=login-code&state=${encodeURIComponent(state)}`)
        .set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe("user-regular-1");
      expect(res.body.email).toBe("regular@covai.dev");
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { githubUserId: "777666" },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          githubUserId: true,
        },
      });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
  });
});
