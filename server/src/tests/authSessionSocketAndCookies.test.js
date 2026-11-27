import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as createClient } from "socket.io-client";
import prisma from "../config/prisma.js";
import { getRefreshCookieOptions } from "../controllers/auth.controller.js";
import {
  refreshSocketAuthToken,
  subscribeToUserRoom,
} from "../utils/socketSubscription.js";
import { attachProjectEditorGateway } from "../realtime/projectEditor.gateway.js";

describe("Session refresh cookie flags & live Socket.IO token rotation", () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalClientUrl = process.env.CLIENT_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-live-session-secret";
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalJwtSecret;
    process.env.CLIENT_URL = originalClientUrl;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("resolves Secure and SameSite cookie options accurately across multi-proxy HTTPS and local HTTP Docker", () => {
    // Cloudflare -> Nginx -> Express multi-hop X-Forwarded-Proto
    const multiProxyHttps = getRefreshCookieOptions({
      secure: false,
      headers: {
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "covai.tech, covai.tech",
        origin: "https://covai.tech",
      },
    });
    expect(multiProxyHttps.secure).toBe(true);
    expect(multiProxyHttps.sameSite).toBe("lax");

    // Cross-origin HTTPS frontend -> API
    const crossOriginHttps = getRefreshCookieOptions({
      secure: true,
      headers: {
        host: "api.covai.tech",
        origin: "https://www.covai.tech",
      },
    });
    expect(crossOriginHttps.secure).toBe(true);
    expect(crossOriginHttps.sameSite).toBe("none");

    // Local HTTP preview/Docker when NODE_ENV=production and CLIENT_URL=https://covai.tech
    process.env.NODE_ENV = "production";
    process.env.CLIENT_URL = "https://covai.tech";
    const localHttp = getRefreshCookieOptions({
      secure: false,
      headers: {
        "x-forwarded-proto": "http",
        host: "localhost:4173",
        origin: "http://localhost:4173",
      },
    });
    expect(localHttp.secure).toBe(false);
    expect(localHttp.sameSite).toBe("lax");
  });

  it("renews main Socket.IO token in-place and emits auth:expired on expired room subscription", () => {
    const expiredToken = jwt.sign({ userId: "u-sock-1" }, process.env.JWT_SECRET, {
      expiresIn: -10,
    });
    const freshToken = jwt.sign({ userId: "u-sock-1" }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });
    const otherUserToken = jwt.sign({ userId: "u-sock-2" }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const emitted = [];
    const joinedRooms = [];
    const mockSocket = {
      handshake: { auth: { token: expiredToken } },
      data: {},
      emit: (evt) => emitted.push(evt),
      join: (room) => joinedRooms.push(room),
    };

    expect(subscribeToUserRoom(mockSocket, "u-sock-1")).toBe(false);
    expect(emitted).toContain("auth:expired");

    const renewed = refreshSocketAuthToken(mockSocket, freshToken);
    expect(renewed).toEqual({ ok: true, userId: "u-sock-1" });
    expect(subscribeToUserRoom(mockSocket, "u-sock-1")).toBe(true);
    expect(joinedRooms).toContain("user:u-sock-1");

    // Prevent switching user identity on an already authenticated socket
    const mismatch = refreshSocketAuthToken(mockSocket, otherUserToken);
    expect(mismatch).toEqual({ ok: false, code: "AUTH_IDENTITY_MISMATCH" });
  });

  it("rotates /editor namespace token in-place via editor:auth so 15m token expiry never drops live editing", async () => {
    const origFindUnique = prisma.user.findUnique;
    prisma.user.findUnique = async ({ where }) =>
      where?.id === "u-editor-1"
        ? { name: "Editor One", email: "editor1@covai.test" }
        : null;

    const httpServer = createServer();
    const io = new Server(httpServer);
    attachProjectEditorGateway(io);

    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const port = httpServer.address().port;

    const shortLivedToken = jwt.sign(
      { userId: "u-editor-1" },
      process.env.JWT_SECRET,
      { expiresIn: "1s" },
    );
    const renewedToken = jwt.sign(
      { userId: "u-editor-1" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );
    const wrongUserToken = jwt.sign(
      { userId: "u-editor-other" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    const client = createClient(`http://127.0.0.1:${port}/editor`, {
      auth: { token: shortLivedToken },
      transports: ["websocket"],
    });

    try {
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });

      // Wait for initial 1s handshake token to expire
      await new Promise((r) => setTimeout(r, 1250));

      // Before renewal, editor:presence fails with AUTH_REQUIRED
      const expiredAck = await client.timeout(5000).emitWithAck("editor:presence", {});
      expect(expiredAck).toMatchObject({ ok: false, code: "AUTH_REQUIRED" });

      // Identity mismatch token is rejected
      const mismatchAck = await client
        .timeout(5000)
        .emitWithAck("editor:auth", { token: wrongUserToken });
      expect(mismatchAck).toMatchObject({
        ok: false,
        code: "AUTH_IDENTITY_MISMATCH",
      });

      // Renewing with matching user's refreshed access token restores live editor operations immediately
      const renewAck = await client
        .timeout(5000)
        .emitWithAck("editor:auth", { token: renewedToken });
      expect(renewAck).toEqual({ ok: true });

      const healthyAck = await client.timeout(5000).emitWithAck("editor:presence", {});
      expect(healthyAck).toMatchObject({ ok: true });
    } finally {
      client.disconnect();
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
      prisma.user.findUnique = origFindUnique;
    }
  });
});
