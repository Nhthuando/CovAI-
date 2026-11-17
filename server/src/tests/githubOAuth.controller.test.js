import request from "supertest";
import express from "express";
import { jest } from "@jest/globals";

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: prismaMock,
}));

jest.unstable_mockModule("../utils/crypto.js", () => ({
  encrypt: jest.fn((val) => `enc:${val}`),
  decrypt: jest.fn((val) => val.replace(/^enc:/, "")),
}));

jest.unstable_mockModule("../middlewares/auth.middleware.js", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { id: "user-regular-1", name: "Regular User", email: "regular@covai.dev" };
    next();
  },
}));

const { default: authRouter } = await import("../routes/auth.route.js");

const app = express();
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

  describe("POST /api/auth/github/connect", () => {
    it("returns 400 when code is missing", async () => {
      const res = await request(app).post("/api/auth/github/connect").send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Code parameter not found/i);
    });

    it("returns 400 when GitHub rejects the OAuth code", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        }),
      });

      const res = await request(app)
        .post("/api/auth/github/connect")
        .send({ code: "expired-code" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("The code passed is incorrect or expired.");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("returns 409 when GitHub account is already linked to another user", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_123" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 999888, login: "octocat" }),
        });

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: "other-user-2" });

      const res = await request(app)
        .post("/api/auth/github/connect")
        .send({ code: "valid-code" });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already linked/i);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("links GitHub to the authenticated user without creating a duplicate account", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_abc" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 777666, login: "dev-octo" }),
        });

      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.update.mockResolvedValueOnce({
        id: "user-regular-1",
        githubUserId: "777666",
      });

      const res = await request(app)
        .post("/api/auth/github/connect")
        .send({ code: "valid-code" });

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
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "gho_login" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 777666, login: "dev-octo", email: null }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ email: "different@github.dev", primary: true }],
        });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: "user-regular-1",
        email: "regular@covai.dev",
        name: "Regular User",
        githubUserId: "777666",
      });
      prismaMock.user.update.mockResolvedValueOnce({
        id: "user-regular-1",
        email: "regular@covai.dev",
        name: "Regular User",
        githubUserId: "777666",
      });

      const res = await request(app).get("/api/auth/github/callback?code=login-code");

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe("user-regular-1");
      expect(res.body.email).toBe("regular@covai.dev");
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { githubUserId: "777666" },
      });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
  });
});
