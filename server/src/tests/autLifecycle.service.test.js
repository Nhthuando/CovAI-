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
  waitForHttpHealthy,
  detectAutPort,
  prepareAutEnvironment,
  runSeedDataIfPresent,
  startAutServer,
  stopAutServer,
  formatAutStartupFailure,
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
  it('keeps the original startup error, strips ANSI and redacts credentials', () => {
    const message=formatAutStartupFailure('\x1b[31mError: Prisma initialization failed for secret-value\x1b[39m\n'+' at Module.load\n'.repeat(100),{DB_PASSWORD:'secret-value'});
    expect(message).toContain('Error: Prisma initialization failed for [redacted]');
    expect(message).not.toContain('\x1b');
    expect(message).not.toContain('secret-value');
  });
  it('explains the missing Stripe test key', () => {
    expect(formatAutStartupFailure('Error: Neither apiKey nor config.authenticator provided')).toContain('STRIPE_SECRET_KEY');
  });
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
      expect(result.vars.PORT).toBe('4173');
      expect(result.vars.NODE_ENV).toBe('development');
      expect(result.vars.JWT_SECRET).toMatch(/^[a-f0-9]{64}$/);
      expect(addJobLog).toHaveBeenCalledWith("job-1", "INFO", expect.stringContaining("4173"));
    });

    it("parses .env.example and populates safe mock defaults", async () => {
      const rootDir = fixture({
        ".env.example": "PORT=3000\nDATABASE_URL=\nAPI_KEY=xxx\nBACKEND_URL=",
      });
      const result = await prepareAutEnvironment(rootDir, 4173, "job-1");
      expect(result.created).toBe(true);
      const content = fs.readFileSync(path.join(rootDir, ".env"), "utf8");
      expect(result.vars.PORT).toBe('4173');
      expect(content).not.toMatch(/DATABASE_URL|API_KEY|BACKEND_URL|mock_secret|mock_value/);
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
    it('does not automatically execute database seed scripts in frontend mode',async()=>{
      const snapshotDir=fixture({'package.json':JSON.stringify({scripts:{seed:'node seed.js'}})});
      expect(await runSeedDataIfPresent({snapshotDir})).toEqual({executed:false,reason:'ISOLATED_DATABASE_REQUIRED'});
    });
    it('uses the selected manager and isolated database and stops if seeding fails',async()=>{
      const snapshotDir=fixture({'package.json':JSON.stringify({scripts:{seed:'node seed.js'}})});
      const prepare=jest.fn().mockResolvedValue({command:'pnpm',env:{}}),run=jest.fn().mockResolvedValue({success:false,stderr:'seed invalid'});
      await expect(runSeedDataIfPresent({snapshotDir,isolatedDatabase:true,env:{DATABASE_URL:'mysql://test:test@127.0.0.1:45000/covai_test'},dependencies:{prepare,run}})).rejects.toThrow('seed invalid');
      expect(run.mock.calls[0][0]).toMatchObject({command:'pnpm run seed',env:{DATABASE_URL:'mysql://test:test@127.0.0.1:45000/covai_test',NODE_ENV:'test'}});
      await expect(runSeedDataIfPresent({snapshotDir,isolatedDatabase:true,env:{DATABASE_URL:'mysql://live.example/production'},dependencies:{prepare,run}})).rejects.toThrow('isolated test database');
      expect(run).toHaveBeenCalledTimes(1);
    });
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

  describe('HTTP readiness retries', () => {
    let server;
    afterEach(async () => { if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;} });
    const listen = async handler => {
      server=http.createServer(handler);
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      return server.address().port;
    };
    it('waits past an initial HTTP timeout while a listening frontend compiles', async () => {
      let requests=0;
      const port=await listen((req,res)=>{if(++requests===1)return;res.end('ready');});
      const onRetry=jest.fn();
      expect((await waitForHttpHealthy({port,timeoutMs:1000,probeTimeoutMs:50,intervalMs:10,onRetry})).status).toBe(200);
      expect(requests).toBe(2);
      expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({status:0,error:'HTTP probe timeout'}));
    });
    it('retries transient backend initialization failures', async () => {
      let requests=0;
      const port=await listen((req,res)=>{res.statusCode=++requests<3?503:200;res.end();});
      expect((await waitForHttpHealthy({port,timeoutMs:1000,intervalMs:10})).status).toBe(200);
      expect(requests).toBe(3);
    });
    it('retains a real timeout failure with connection details', async () => {
      const port=await listen(()=>{});
      await expect(waitForHttpHealthy({port,timeoutMs:120,probeTimeoutMs:40,intervalMs:10})).rejects.toThrow(/status 0 \(HTTP probe timeout\)/);
    });
    it('does not retry an invalid health endpoint or ignore process exit', async () => {
      let requests=0;
      const port=await listen((req,res)=>{requests++;res.statusCode=404;res.end();});
      await expect(waitForHttpHealthy({port,timeoutMs:1000})).rejects.toThrow('status 404');
      expect(requests).toBe(1);
      await expect(waitForHttpHealthy({port,isExited:()=>true})).rejects.toThrow('process exited');
      expect(requests).toBe(1);
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
