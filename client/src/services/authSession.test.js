import test from "node:test";
import assert from "node:assert/strict";

function toBase64Url(obj) {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeJwt(payload) {
  const header = toBase64Url({ alg: "HS256", typ: "JWT" });
  const body = toBase64Url(payload);
  return `${header}.${body}.sig`;
}

function createStorageMock() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
  };
}

function setupBrowserGlobals() {
  const assignedUrls = [];
  const dispatched = [];
  const localStorage = createStorageMock();
  globalThis.localStorage = localStorage;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.window = {
    location: {
      pathname: "/projects",
      assign: (url) => { assignedUrls.push(url); },
    },
    dispatchEvent: (evt) => { dispatched.push(evt); },
    setInterval: () => 0,
    addEventListener: () => {},
  };
  globalThis.document = {
    hidden: false,
    addEventListener: () => {},
  };
  return { assignedUrls, dispatched, localStorage };
}

test("isAuthEndpoint excludes authenticated GitHub connect/repo endpoints while keeping unauthenticated auth routes", async () => {
  setupBrowserGlobals();
  const { isAuthEndpoint } = await import("../lib/authSession.js");

  assert.equal(isAuthEndpoint("http://localhost:5000/api/auth/login"), true);
  assert.equal(isAuthEndpoint("http://localhost:5000/api/auth/register"), true);
  assert.equal(isAuthEndpoint("/api/refresh"), true);
  assert.equal(isAuthEndpoint("/api/auth/github/url?mode=connect"), true);
  assert.equal(isAuthEndpoint("/api/auth/github/callback?code=abc"), true);
  assert.equal(isAuthEndpoint("/api/auth/github/confirm-link"), true);
  assert.equal(isAuthEndpoint("/api/auth/github/cancel-link"), true);

  assert.equal(isAuthEndpoint("/api/auth/github/connect"), false);
  assert.equal(isAuthEndpoint("/api/auth/github/repositories"), false);
  assert.equal(isAuthEndpoint("/api/auth/github/access"), false);
  assert.equal(isAuthEndpoint("/api/projects"), false);
  assert.equal(isAuthEndpoint("/api/users/me"), false);
});

test("computeRenewBeforeMs scales dynamically for short-lived and 15m access tokens", async () => {
  setupBrowserGlobals();
  const { computeRenewBeforeMs } = await import("../lib/authSession.js");

  const nowSec = Math.floor(Date.now() / 1000);
  const twoMinToken = makeJwt({ userId: "u1", iat: nowSec, exp: nowSec + 120 });
  const fifteenMinToken = makeJwt({ userId: "u1", iat: nowSec, exp: nowSec + 900 });

  assert.equal(computeRenewBeforeMs(twoMinToken), 30 * 1000);
  assert.equal(computeRenewBeforeMs(fifteenMinToken), 3 * 60 * 1000);
});

test("authAwareFetch deduplicates concurrent 401 refreshes, replays requests, and preserves session on 503", async () => {
  const { assignedUrls, localStorage } = setupBrowserGlobals();
  const oldToken = makeJwt({ userId: "u1", iat: 1000, exp: 1900 });
  const newToken = makeJwt({ userId: "u1", iat: 2000, exp: 2900 });
  localStorage.setItem("token", oldToken);
  localStorage.setItem("user", JSON.stringify({ id: "u1", token: oldToken }));

  const origFetch = globalThis.fetch;
  let refreshCalls = 0;

  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/refresh")) {
        refreshCalls += 1;
        return new Response(JSON.stringify({ accessToken: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected global fetch: ${url}`);
    };

    const { authAwareFetch } = await import("../lib/authSession.js");

    const mockApiFetch = async (_url, init) => {
      const auth = init.headers.Authorization || init.headers.authorization;
      if (auth === `Bearer ${newToken}`) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "Token expired" }), { status: 401 });
    };

    const [r1, r2] = await Promise.all([
      authAwareFetch(mockApiFetch, "/api/auth/github/repositories"),
      authAwareFetch(mockApiFetch, "/api/auth/github/connect", { method: "POST" }),
    ]);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(refreshCalls, 1);
    assert.equal(localStorage.getItem("token"), newToken);
    assert.equal(assignedUrls.length, 0);

    // Transient 503 on /refresh must NOT log the user out
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/refresh")) {
        return new Response(JSON.stringify({ code: "REFRESH_UNAVAILABLE" }), { status: 503 });
      }
      throw new Error(`Unexpected global fetch: ${url}`);
    };
    const r3 = await authAwareFetch(
      async () => new Response(JSON.stringify({ message: "expired" }), { status: 401 }),
      "/api/projects",
    );
    assert.equal(r3.status, 401);
    assert.equal(localStorage.getItem("token"), newToken);
    assert.equal(assignedUrls.length, 0);

    // Explicit 403 invalid refresh session DOES clear auth state and redirect to /login
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/refresh")) {
        return new Response(JSON.stringify({ code: "REFRESH_TOKEN_INVALID" }), { status: 403 });
      }
      throw new Error(`Unexpected global fetch: ${url}`);
    };
    const r4 = await authAwareFetch(
      async () => new Response(JSON.stringify({ message: "expired" }), { status: 401 }),
      "/api/projects",
    );
    assert.equal(r4.status, 401);
    assert.equal(localStorage.getItem("token"), null);
    assert.deepEqual(assignedUrls, ["/login"]);
  } finally {
    globalThis.fetch = origFetch;
  }
});
