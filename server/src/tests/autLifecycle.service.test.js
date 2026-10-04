import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import http from "http";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const addJobLog = jest.fn();
await jest.unstable_mockModule("../services/job.service.js", () => ({ addJobLog }));

const treeKillMock = jest.fn((pid, sig, cb) => cb(null));
await jest.unstable_mockModule("tree-kill", () => ({ default: treeKillMock }));

const {
  isPortInUse,
  waitForPortOpen,
  verifyHttpHealth,
  detectAutPort,
  prepareAutEnvironment,
  runSeedDataIfPresent,
  startAutServer,
  stopAutServer,
} = await import("../services/autLifecycle.service.js");

const roots = [];
const fixture = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-aut-lifecycle-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
};

afterEach(() => {
  roots.splice(0).forEach((root) => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });
});

describe("autLifecycle.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("prepareAutEnvironment", () => {
    it("preserves existing .env file and does not overwrite", async () => {
      const rootDir = fixture({
        ".env": "EXISTING_VAR=true\nPORT=9999",
      });
      const result = await prepareAutEnvironment(rootDir, 4173, "job-1");
      expect(result.created).toBe(false);
      const content = fs.readFileSync(path.join(rootDir, ".env"), "utf8");
      expect(content).toContain("EXISTING_VAR=true");
    });

    it("creates default mock .env when no template exists", async () => {
      const rootDir = fixture({});
      const result = await prepareAutEnvironment(rootDir, 4173, "job-1");
      expect(result.created).toBe(true);
      const content = fs.readFileSync(path.join(rootDir, ".env"), "utf8");
      expect(content).toContain("PORT=4173");
      expect(content).toContain("NODE_ENV=test");
      expect(content).toContain("JWT_SECRET=covai_test_mock_jwt_secret");
      expect(addJobLog).toHaveBeenCalledWith("job-1", "INFO", expect.stringContaining("4173"));
    });

    it("parses .env.example and populates safe mock defaults", async () => {
      const rootDir = fixture({
        ".env.example": "PORT=3000\nDATABASE_URL=\nAPI_KEY=xxx\nBACKEND_URL=",
      });
      const result = await prepareAutEnvironment(rootDir, 4173, "job-1");
      expect(result.created).toBe(true);
      const content = fs.readFileSync(path.join(rootDir, ".env"), "utf8");
      expect(content).toContain("PORT=4173");
      expect(content).toContain("DATABASE_URL=postgresql://postgres:postgres@localhost:5432/covai_mock_test");
      expect(content).toContain("API_KEY=covai_mock_secret_key");
      expect(content).toContain("BACKEND_URL=http://localhost:4173");
    });
  });

  describe("detectAutPort", () => {
    it("extracts port from playwright.config.js webServer port", () => {
      const rootDir = fixture({
        "playwright.config.js": "export default { webServer: { command: 'npm start', port: 3000 } };",
      });
      expect(detectAutPort(rootDir, 4173)).toBe(3000);
    });

    it("extracts port from cypress.config.js baseUrl", () => {
      const rootDir = fixture({
        "cypress.config.js": "export default { e2e: { baseUrl: 'http://localhost:8080' } };",
      });
      expect(detectAutPort(rootDir, 4173)).toBe(8080);
    });

    it("defaults to 4173 when no port config is specified", () => {
      const rootDir = fixture({});
      expect(detectAutPort(rootDir, 4173)).toBe(4173);
    });

    it("detects Vite in client subdirectory and returns 5173", () => {
      const rootDir = fixture({
        "client/vite.config.js": "export default {};",
      });
      expect(detectAutPort(rootDir, 4173)).toBe(5173);
    });
  });

  describe("runSeedDataIfPresent", () => {
    it("returns executed false if package.json has no seed script", async () => {
      const rootDir = fixture({
        "package.json": JSON.stringify({ scripts: { start: "node index.js" } }),
      });
      const result = await runSeedDataIfPresent({ snapshotDir: rootDir, jobId: "job-1" });
      expect(result.executed).toBe(false);
    });
  });

  describe("2-Tier Healthcheck: Socket & HTTP", () => {
    let server;
    let testPort;

    afterEach((done) => {
      if (server && server.listening) {
        server.close(done);
      } else {
        done();
      }
    });

    it("Tầng 1 (Socket check): waitForPortOpen succeeds when port is listening", async () => {
      server = net.createServer();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      testPort = server.address().port;

      const open = await waitForPortOpen(testPort, 3000);
      expect(open).toBe(true);
    });

    it("Tầng 1 (Socket check): waitForPortOpen throws when port is closed and times out", async () => {
      // Choose a high port unlikely to be open
      await expect(waitForPortOpen(49999, 1000, "127.0.0.1", 200)).rejects.toThrow("did not open");
    });

    it("Tầng 2 (HTTP verify): responds healthy with status 200", async () => {
      server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      testPort = server.address().port;

      const result = await verifyHttpHealth(testPort, "/", "127.0.0.1");
      expect(result.healthy).toBe(true);
      expect(result.status).toBe(200);
    });

    it("Tầng 2 (HTTP verify): captures HTTP 500 without crashing/hanging and flags warning", async () => {
      server = http.createServer((req, res) => {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error - DB Missing");
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      testPort = server.address().port;

      const result = await verifyHttpHealth(testPort, "/", "127.0.0.1");
      expect(result.healthy).toBe(false);
      expect(result.status).toBe(500);
      expect(result.warning).toBe(true);
    });
  });

  describe("stopAutServer", () => {
    it("calls tree-kill with SIGKILL and logs to JobLog", async () => {
      await stopAutServer(9999, 4173, "job-1");
      expect(treeKillMock).toHaveBeenCalledWith(9999, "SIGKILL", expect.any(Function));
      expect(addJobLog).toHaveBeenCalledWith("job-1", "INFO", expect.stringContaining("Stopped AUT server"));
    });
  });
});
