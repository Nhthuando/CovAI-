import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { createAuthTestDatabase } from "../src/tests/helpers/authTestDatabase.js";
import authRoute from "../src/routes/auth.route.js";
import refreshRoute from "../src/routes/refresh.route.js";
import userRoute from "../src/routes/user.route.js";
import { authMiddleware } from "../src/middlewares/auth.middleware.js";

const PORT = Number(process.env.E2E_API_PORT || 55100);
const CLIENT_URL = process.env.CLIENT_URL || "http://127.0.0.1:55273";

process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-auth-jwt-secret-key-2026";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "e2e-auth-refresh-secret-key-2026";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "c".repeat(64);
process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "e2e-github-client-id";
process.env.GITHUB_CLIENT_SECRET =
  process.env.GITHUB_CLIENT_SECRET || "e2e-github-client-secret";
process.env.CLIENT_URL = CLIENT_URL;
process.env.LOGIN_IP_RATE_LIMIT_MAX = "1000";

const MOCK_GITHUB_SCENARIOS = {
  "e2e-linked": {
    token: "gho_e2e_linked_token",
    user: { id: 910001, login: "linked-octo", name: "Linked Octo", avatar_url: "" },
    emails: [{ email: "linked@covai.test", primary: true, verified: true }],
  },
  "e2e-new": {
    token: "gho_e2e_new_token",
    user: { id: 910002, login: "new-octo", name: "New Octo", avatar_url: "" },
    emails: [{ email: "newgh@covai.test", primary: true, verified: true }],
  },
  "e2e-match-local": {
    token: "gho_e2e_match_token",
    user: { id: 910003, login: "match-octo", name: "Matched Octo", avatar_url: "" },
    emails: [{ email: "localmatch@covai.test", primary: true, verified: true }],
  },
  "e2e-unverified": {
    token: "gho_e2e_unv_token",
    user: { id: 910004, login: "unv-octo", name: "Unverified Octo", avatar_url: "" },
    emails: [{ email: "unv@covai.test", primary: true, verified: false }],
  },
};

const originalFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const urlStr = String(url);
  if (urlStr === "https://github.com/login/oauth/access_token") {
    const body = JSON.parse(init.body || "{}");
    const scenario = MOCK_GITHUB_SCENARIOS[body.code];
    if (!scenario) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: scenario.token }),
    };
  }

  if (urlStr === "https://api.github.com/user") {
    const auth = init.headers?.Authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const scenario = Object.values(MOCK_GITHUB_SCENARIOS).find(
      (s) => s.token === token,
    );
    return {
      ok: Boolean(scenario),
      status: scenario ? 200 : 401,
      json: async () => scenario?.user || { message: "Bad credentials" },
    };
  }

  if (urlStr === "https://api.github.com/user/emails") {
    const auth = init.headers?.Authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const scenario = Object.values(MOCK_GITHUB_SCENARIOS).find(
      (s) => s.token === token,
    );
    return {
      ok: Boolean(scenario),
      status: scenario ? 200 : 401,
      json: async () => scenario?.emails || [],
    };
  }

  return originalFetch(url, init);
};

const testDb = await createAuthTestDatabase();

const app = express();
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ success: true }));
app.use("/api/auth", authRoute);
app.use("/api/refresh", refreshRoute);
app.use("/api/users", userRoute);

// Lightweight stubs so /projects renders cleanly after auth redirect
app.get("/api/projects", authMiddleware, (_req, res) =>
  res.json({ success: true, data: [], projects: [] }),
);
app.get("/api/portfolio/summary", authMiddleware, (_req, res) =>
  res.json({ success: true, data: { projects: [], totals: {} } }),
);
app.get("/api/notifications", authMiddleware, (_req, res) =>
  res.json({ success: true, notifications: [] }),
);

// E2E test control endpoints (only in this isolated disposable server)
app.post("/api/__test/reset", async (_req, res) => {
  await testDb.resetAuthTables();
  res.json({ ok: true });
});

app.post("/api/__test/seed", async (req, res) => {
  const { email, name, password, githubUserId } = req.body;
  const passwordHash = password ? await bcrypt.hash(password, 4) : null;
  const user = await testDb.db.user.create({
    data: {
      email: email.trim().toLowerCase(),
      name: name || "Seeded User",
      passwordHash,
      githubUserId: githubUserId || null,
    },
    select: { id: true, email: true, githubUserId: true },
  });
  res.json({ ok: true, user });
});

app.post("/api/__test/backdate-lock", async (req, res) => {
  const { email } = req.body;
  await testDb.db.user.update({
    where: { email: email.trim().toLowerCase() },
    data: { lockedUntil: new Date(Date.now() - 1000) },
  });
  res.json({ ok: true });
});

app.post("/api/__test/backdate-pending-link", async (req, res) => {
  const { email } = req.body;
  await testDb.db.githubPendingLink.updateMany({
    where: { email: email.trim().toLowerCase() },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  res.json({ ok: true });
});

app.get("/api/__test/user-state", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const user = await testDb.db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      githubUserId: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });
  res.json({ user });
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[E2E-AUTH] Ready on http://127.0.0.1:${PORT}`);
});

async function shutdown() {
  server.close();
  await testDb.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
