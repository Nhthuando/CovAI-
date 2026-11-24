import fs from "fs";
import path from "path";
import {
  markJobRunning,
  markJobSuccess,
  markJobFailed,
  updateJobProgress,
  getJobById,
  addJobLog,
} from "./job.service.js";
import { saveJobOutput } from "./jobOutput.service.js";
import { runSupertest } from "./supertestRunner.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { detectSupertest } from "./supertestDetection.service.js";
import {
  parseJestResults,
  formatScenariosForPrisma,
} from "./testResultParser.service.js";
import {
  resolveAppImportPath,
  resolveAppEntryPoint,
} from "./aiTestStorage.service.js";
import { dockerRunner } from "./dockerRunner.service.js";
import babel from "@babel/core";
import transformCommonJsPlugin from "@babel/plugin-transform-modules-commonjs";
import prisma from "../config/prisma.js";
import { randomUUID } from "node:crypto";
import {
  currentProjectOperation,
  operationSnapshot,
  withOperationPublishGuard,
  stagePreparedPublication,
} from "./projectOperationWorkspace.service.js";
import { resolveContainedProjectPath } from "./projectFileVersion.service.js";
import {
  resolveProjectRoot,
  ensureMinimalPackageJson,
} from "../utils/projectRootResolver.js";
import {
  registerJobAbortController,
  unregisterJobAbortController,
  isJobCanceled,
} from "./jobCancellation.service.js";

/**
 * Ensure project and subproject dependencies (e.g. server/node_modules) are installed.
 */
export const ensureProjectDependencies = async (jobId, rootDir) => {
  const candidates = [
    rootDir,
    path.join(rootDir, "server"),
    path.join(rootDir, "backend"),
    path.join(rootDir, "api"),
  ];

  for (const dir of candidates) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const modulesPath = path.join(dir, "node_modules");
      const needsInstall =
        !fs.existsSync(modulesPath) || fs.readdirSync(modulesPath).length <= 2;
      if (needsInstall) {
        const rel = path.relative(rootDir, dir).replace(/\\/g, "/");
        const label = rel ? rel : "root";
        await addJobLog(
          jobId,
          "INFO",
          `[SUPERTEST] Installing dependencies for ${label}...`,
        ).catch(() => {});
        const prefixFlag = rel ? ` --prefix ${rel}` : "";
        const installCmd = `npm install${prefixFlag} --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false`;
        await dockerRunner.run({
          snapshotPath: rootDir,
          command: installCmd,
          timeoutMs: 5 * 60 * 1000,
          jobId,
        });
      }
    }
  }

  try {
    const { detectAndRunPrismaGenerate } =
      await import("./runTestsJob.service.js");
    await detectAndRunPrismaGenerate(jobId, rootDir);
  } catch (_) {}
};

const isEsmProject = (rootDir) => {
  const checkPkgEsm = (dir) => {
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return pkg?.type === "module";
    } catch (_) {
      return false;
    }
  };
  return (
    checkPkgEsm(rootDir) ||
    checkPkgEsm(path.join(rootDir, "server")) ||
    checkPkgEsm(path.join(rootDir, "backend")) ||
    checkPkgEsm(path.join(rootDir, "api"))
  );
};

/**
 * Automatically transform ESM test code to CommonJS if the project is CommonJS.
 */
export const transformTestCodeForProject = async (code, rootDir, filePath) => {
  try {
    let transformedCode = resolveAppImportPath(code, rootDir, filePath);

    const isEsm = isEsmProject(rootDir);

    if (
      !isEsm &&
      (/\bimport\s+[\s\S]*?from\s+['"]/.test(transformedCode) ||
        /\bexport\s+(default|\{)/.test(transformedCode))
    ) {
      const result = babel.transformSync(transformedCode, {
        plugins: [transformCommonJsPlugin],
        sourceType: "module",
      });
      if (result?.code) {
        return result.code;
      }
    }
    return transformedCode;
  } catch (err) {
    if (err.statusCode || err.name === "ServiceError") throw err;
    console.warn(
      "[SupertestCoverageJob] Babel transform fallback:",
      err.message,
    );
    throw err;
  }
};

const resolveSupertestPackageSpecifier = (resolvedRoot) => {
  const candidates = [
    path.join(resolvedRoot, "node_modules", "supertest"),
    path.join(resolvedRoot, "server", "node_modules", "supertest"),
    path.join(resolvedRoot, "backend", "node_modules", "supertest"),
    path.join(resolvedRoot, "api", "node_modules", "supertest"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir.replace(/\\/g, "/");
  }
  return "supertest";
};

const buildPlaywrightShimMethods = () => `
const wrapResponse = (res) => ({
  status: () => res.status,
  statusText: () => (res.res && res.res.statusMessage) || '',
  ok: () => res.status >= 200 && res.status < 300,
  headers: () => res.headers || {},
  json: async () => (res.body !== undefined ? res.body : JSON.parse(res.text || '{}')),
  text: async () => (typeof res.text === 'string' ? res.text : JSON.stringify(res.body ?? '')),
  body: async () => Buffer.from(typeof res.text === 'string' ? res.text : JSON.stringify(res.body ?? '')),
});

const makeReq = (verb) => async (url, options = {}) => {
  if (!app) throw new Error('Express app entry could not be resolved for Playwright API shim');
  let req = supertest(app)[verb](url);
  if (options && options.params) req = req.query(options.params);
  if (options && options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      req = req.set(k, v);
    }
  }
  if (options && options.data !== undefined) {
    req = req.send(options.data);
  }
  const res = await req;
  return wrapResponse(res);
};

const pwRequest = {
  get: makeReq('get'),
  post: makeReq('post'),
  put: makeReq('put'),
  patch: makeReq('patch'),
  delete: makeReq('delete'),
  head: makeReq('head'),
  fetch: async (url, opts = {}) => makeReq(String(opts.method || 'get').toLowerCase())(url, opts),
};

const g = globalThis;
const testFn = (title, fn) => {
  if (typeof g.it !== 'function') return;
  return g.it(title, () => fn({ request: pwRequest }));
};
testFn.skip = (title, fn) => {
  if (typeof g.it !== 'function') return;
  return g.it.skip(title, () => (typeof fn === 'function' ? fn({ request: pwRequest }) : undefined));
};
testFn.only = (title, fn) => {
  if (typeof g.it !== 'function') return;
  return g.it.only(title, () => fn({ request: pwRequest }));
};
testFn.describe = (title, fn) => (typeof g.describe === 'function' ? g.describe(title, fn) : fn());
testFn.beforeEach = (fn) => (typeof g.beforeEach === 'function' ? g.beforeEach(() => fn({ request: pwRequest })) : undefined);
testFn.afterEach = (fn) => (typeof g.afterEach === 'function' ? g.afterEach(() => fn({ request: pwRequest })) : undefined);
testFn.beforeAll = (fn) => (typeof g.beforeAll === 'function' ? g.beforeAll(() => fn({ request: pwRequest })) : undefined);
testFn.afterAll = (fn) => (typeof g.afterAll === 'function' ? g.afterAll(() => fn({ request: pwRequest })) : undefined);
const expectProxy = new Proxy(function () {}, {
  apply(_target, _thisArg, args) {
    return g.expect(...args);
  },
  get(_target, prop) {
    return g.expect ? g.expect[prop] : undefined;
  },
});
`;

/**
 * Create a lightweight Jest/Supertest-backed shim for `@playwright/test` API tests
 * (`test('...', async ({ request }) => ...)`), allowing Playwright API suites to
 * execute in-process with full Istanbul coverage and without requiring Chromium or a live port.
 */
export const adaptPlaywrightApiCodeForJest = (code, rootDir, testFilePath) => {
  if (!code || !/@playwright\/test/.test(code)) return code;
  const resolvedRoot = path.resolve(rootDir);
  const shimDir = path.join(resolvedRoot, ".covai-temp");
  if (!fs.existsSync(shimDir)) {
    fs.mkdirSync(shimDir, { recursive: true });
  }

  const appEntryPath = resolveAppEntryPoint(
    resolvedRoot,
    path.join(shimDir, "probe.test.js"),
  );
  let appRelPath = "../app.js";
  if (appEntryPath) {
    appRelPath = path.relative(shimDir, appEntryPath).replace(/\\/g, "/");
    if (!appRelPath.startsWith(".")) appRelPath = `./${appRelPath}`;
  } else {
    const probeApp = resolveAppImportPath(
      "import app from '../../app.js';",
      resolvedRoot,
      path.join(shimDir, "probe.test.js"),
    );
    const appImportMatch = probeApp.match(/from\s+['"]([^'"]+)['"]/);
    if (appImportMatch?.[1]) appRelPath = appImportMatch[1];
  }

  const supertestSpec = resolveSupertestPackageSpecifier(resolvedRoot);
  const useEsmShim =
    isEsmProject(resolvedRoot) ||
    /^\s*import\s+[\s\S]*?from\s+['"]@playwright\/test['"]/m.test(code);
  const shimPath = path.join(
    shimDir,
    useEsmShim ? "playwright-api-shim.mjs" : "playwright-api-shim.cjs",
  );

  const shimSource = useEsmShim
    ? `
import { createRequire } from 'node:module';
import * as appModule from '${appRelPath}';
const __require = createRequire(import.meta.url);
const supertest = __require('${supertestSpec}');
const app = (appModule && ((appModule.default && appModule.default.default) || appModule.default || appModule.app)) || appModule;
${buildPlaywrightShimMethods()}
export { testFn as test, expectProxy as expect, pwRequest as request };
`
    : `
const supertest = require('${supertestSpec}');
let appModule = null;
try {
  appModule = require('${appRelPath}');
} catch (e) {
  console.error('[PlaywrightApiShim] Failed to load Express app entry:', e?.message || e);
  appModule = null;
}
const app = (appModule && (appModule.default || appModule.app)) || appModule;
${buildPlaywrightShimMethods()}
module.exports = {
  test: testFn,
  expect: expectProxy,
  request: pwRequest,
};
`;

  fs.writeFileSync(shimPath, shimSource.trim() + "\n", "utf8");

  let relShim = path
    .relative(path.dirname(path.resolve(testFilePath)), shimPath)
    .replace(/\\/g, "/");
  if (!relShim.startsWith(".")) relShim = `./${relShim}`;

  return code.replace(/(['"])@playwright\/test\1/g, `'${relShim}'`);
};

/**
 * Temporarily prepare Express entry files for isolated Supertest runs when
 * a project creates `const app = express()` and calls `app.listen(...)`
 * without exporting `app` or guarding `.listen()` under Jest.
 * Returns a `restore()` callback to revert any temporary edits in `finally`.
 */
export const prepareExpressEntriesForSupertest = async (rootDir) => {
  const backups = new Map();
  if (!rootDir) return () => {};

  const baseCandidates = [
    "app.js",
    "server.js",
    "index.js",
    "main.js",
    "src/app.js",
    "src/server.js",
    "src/index.js",
    "src/main.js",
  ];
  const candidates = [];
  const seenResolved = new Set();
  for (const prefix of ["", "server", "backend", "api"]) {
    for (const rel of baseCandidates) {
      const joined = prefix ? path.join(prefix, rel) : rel;
      const full = path.resolve(rootDir, joined);
      if (!seenResolved.has(full)) {
        seenResolved.add(full);
        candidates.push(full);
      }
    }
  }

  const _genModule = await import("@babel/generator");
  const generate =
    _genModule.default?.default || _genModule.default || _genModule;

  const isJestWorkerGuard = () => ({
    type: "UnaryExpression",
    operator: "!",
    prefix: true,
    argument: {
      type: "MemberExpression",
      object: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "process" },
        property: { type: "Identifier", name: "env" },
        computed: false,
      },
      property: { type: "Identifier", name: "JEST_WORKER_ID" },
      computed: false,
    },
  });

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;

    let originalContent;
    try {
      originalContent = fs.readFileSync(filePath, "utf8");
    } catch (readErr) {
      console.warn(
        `[SupertestCoverageJob] Could not read ${filePath}:`,
        readErr?.message,
      );
      continue;
    }

    let ast;
    try {
      ast = babel.parseSync(originalContent, {
        sourceType: "unambiguous",
        filename: filePath,
      });
    } catch (parseErr) {
      console.warn(
        `[SupertestCoverageJob] Could not parse ${filePath}:`,
        parseErr?.message,
      );
      continue;
    }

    const body = ast?.program?.body;
    if (!Array.isArray(body) || body.length === 0) continue;

    let expressAppName = null;
    let hasDefaultExport = false;
    let hasNamedAppExport = false;
    let hasCjsExport = false;
    let hasEsm = false;
    const guardIndices = [];

    for (let i = 0; i < body.length; i++) {
      const node = body[i];
      if (node.type === "ImportDeclaration") {
        hasEsm = true;
      } else if (node.type === "ExportDefaultDeclaration") {
        hasEsm = true;
        hasDefaultExport = true;
      } else if (
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration"
      ) {
        hasEsm = true;
        if (
          node.declaration?.type === "VariableDeclaration" &&
          node.declaration.declarations?.some(
            (d) =>
              d.id?.type === "Identifier" &&
              (d.id.name === "app" ||
                (d.init?.type === "CallExpression" &&
                  d.init.callee?.name === "express")),
          )
        ) {
          hasNamedAppExport = true;
        }
        if (
          Array.isArray(node.specifiers) &&
          node.specifiers.some(
            (s) => s.exported?.name === "app" || s.exported?.name === "default",
          )
        ) {
          if (node.specifiers.some((s) => s.exported?.name === "default")) {
            hasDefaultExport = true;
          }
          if (node.specifiers.some((s) => s.exported?.name === "app")) {
            hasNamedAppExport = true;
          }
        }
      } else if (node.type === "VariableDeclaration") {
        for (const decl of node.declarations || []) {
          if (
            decl.id?.type === "Identifier" &&
            decl.init?.type === "CallExpression" &&
            decl.init.callee?.type === "Identifier" &&
            decl.init.callee.name === "express"
          ) {
            expressAppName = decl.id.name;
          }
        }
      } else if (node.type === "ExpressionStatement") {
        const expr = node.expression;
        if (
          expr?.type === "AssignmentExpression" &&
          expr.left?.type === "MemberExpression"
        ) {
          const objName = expr.left.object?.name;
          const propName = expr.left.property?.name;
          if (objName === "module" && propName === "exports") {
            hasCjsExport = true;
            hasDefaultExport = true;
          } else if (objName === "exports") {
            hasCjsExport = true;
            if (propName === "app") hasNamedAppExport = true;
          }
        }
        if (expr?.type === "CallExpression") {
          if (
            expr.callee?.type === "MemberExpression" &&
            expr.callee.property?.type === "Identifier" &&
            expr.callee.property.name === "listen"
          ) {
            guardIndices.push(i);
          } else if (
            expr.callee?.type === "Identifier" &&
            /^(?:cleanup|start.*cron|schedule)/i.test(expr.callee.name || "")
          ) {
            guardIndices.push(i);
          }
        }
      }
    }

    const needsAppExport =
      Boolean(expressAppName) &&
      (hasEsm ? !hasDefaultExport && !hasNamedAppExport : !hasCjsExport);

    if (!expressAppName || (!needsAppExport && guardIndices.length === 0)) {
      continue;
    }

    for (const idx of guardIndices) {
      const stmt = body[idx];
      body[idx] = {
        type: "IfStatement",
        test: isJestWorkerGuard(),
        consequent: {
          type: "BlockStatement",
          body: [stmt],
          directives: [],
        },
        alternate: null,
      };
    }

    if (needsAppExport) {
      if (hasEsm) {
        if (!hasDefaultExport) {
          body.push({
            type: "ExportDefaultDeclaration",
            declaration: { type: "Identifier", name: expressAppName },
          });
        }
        if (!hasNamedAppExport && expressAppName === "app") {
          body.push({
            type: "ExportNamedDeclaration",
            declaration: null,
            specifiers: [
              {
                type: "ExportSpecifier",
                local: { type: "Identifier", name: expressAppName },
                exported: { type: "Identifier", name: "app" },
              },
            ],
            source: null,
          });
        }
      } else {
        body.push({
          type: "ExpressionStatement",
          expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: {
              type: "MemberExpression",
              object: { type: "Identifier", name: "module" },
              property: { type: "Identifier", name: "exports" },
              computed: false,
            },
            right: { type: "Identifier", name: expressAppName },
          },
        });
      }
    }

    try {
      const { code: patchedCode } = generate(ast);
      backups.set(filePath, originalContent);
      fs.writeFileSync(filePath, patchedCode, "utf8");
    } catch (writeErr) {
      console.warn(
        `[SupertestCoverageJob] Failed to stage Express entry ${filePath}:`,
        writeErr?.message,
      );
    }
  }

  return () => {
    for (const [filePath, originalContent] of backups.entries()) {
      try {
        fs.writeFileSync(filePath, originalContent, "utf8");
      } catch (restoreErr) {
        console.warn(
          `[SupertestCoverageJob] Failed to restore ${filePath}:`,
          restoreErr?.message,
        );
      }
    }
  };
};

/**
 * Pipeline cho Supertest Coverage:
 * 1. Run Supertest (runSupertest)
 * 2. Parse coverage (reuse existing parsers)
 * 3. Save results to DB & Firebase
 */
export const processSupertestCoverageJob = async (jobId) => {
  const abortController = new AbortController();
  registerJobAbortController(jobId, abortController);
  let projectId;
  let snapshotId;
  let stagedIntegrationDir = null;
  let restoreExpressEntries = null;

  try {
    if (isJobCanceled(jobId, abortController.signal)) return;

    await markJobRunning(jobId);
    const job = await getJobById(jobId);
    projectId = job.projectId;
    snapshotId = job.snapshotId;
    if (
      isJobCanceled(jobId, abortController.signal) ||
      job?.status === "CANCELED"
    )
      return;

    const rawSnapshot = job.snapshot;
    if (!rawSnapshot?.rootDir) {
      throw new ServiceError("Snapshot is not ready to run Supertest.", 409);
    }
    const snapshot =
      typeof operationSnapshot === "function"
        ? operationSnapshot(rawSnapshot)
        : rawSnapshot;
    const { jestConfigPath } = snapshot;
    const rootDir = resolveProjectRoot(snapshot.rootDir) || snapshot.rootDir;
    const canonicalOrigBase =
      snapshot.originalRootDir ||
      rawSnapshot.originalRootDir ||
      currentProjectOperation()?.originalRootDir ||
      rawSnapshot.rootDir;
    const origRootDir =
      resolveProjectRoot(canonicalOrigBase) || canonicalOrigBase;
    const userId = job.userId;
    const reportIntProgress = async (progress, stage, message) => {
      await updateJobProgress(jobId, progress).catch((err) => {
        console.warn(
          "[SupertestCoverageJob] updateJobProgress warning:",
          err?.message,
        );
      });
      await addJobLog(
        jobId,
        "INFO",
        JSON.stringify({ stage, label: message, progress }),
      ).catch((err) => {
        console.warn("[SupertestCoverageJob] addJobLog warning:", err?.message);
      });
      try {
        const { emitDashboardJobProgress } =
          await import("./dashboardEvents.service.js");
        emitDashboardJobProgress(projectId, {
          snapshotId,
          jobId,
          pillar: "integration",
          progress,
          stage,
          message,
        });
      } catch (err) {
        console.warn(
          "[SupertestCoverageJob] emitDashboardJobProgress warning:",
          err?.message,
        );
      }
    };
    if (currentProjectOperation()) {
      ensureMinimalPackageJson(rootDir);
      if (origRootDir && path.resolve(origRootDir) !== path.resolve(rootDir)) {
        try {
          const { ensureWorkspaceNodeModulesLinked } =
            await import("./dependencyResolution.service.js");
          ensureWorkspaceNodeModulesLinked(origRootDir, rootDir);
        } catch (_) {}
        for (const sub of ["", "server", "backend", "api"]) {
          const srcNm = sub
            ? path.join(origRootDir, sub, "node_modules")
            : path.join(origRootDir, "node_modules");
          const dstNm = sub
            ? path.join(rootDir, sub, "node_modules")
            : path.join(rootDir, "node_modules");
          if (fs.existsSync(srcNm) && !fs.existsSync(dstNm)) {
            try {
              if (dockerRunner.containerEnabled) {
                fs.cpSync(srcNm, dstNm, { recursive: true, dereference: true });
              } else {
                fs.symlinkSync(
                  srcNm,
                  dstNm,
                  process.platform === "win32" ? "junction" : "dir",
                );
              }
            } catch (_) {
              try {
                fs.cpSync(srcNm, dstNm, { recursive: true, dereference: true });
              } catch (_) {}
            }
          }
        }
      }
      const hasJestAndSupertest =
        fs.existsSync(path.join(rootDir, "node_modules", "jest")) &&
        fs.existsSync(path.join(rootDir, "node_modules", "supertest"));
      if (!hasJestAndSupertest) {
        const { runNpmInstall } = await import("./runTestsJob.service.js");
        await runNpmInstall(jobId, rootDir);
        if (
          origRootDir &&
          path.resolve(origRootDir) !== path.resolve(rootDir) &&
          fs.existsSync(path.join(rootDir, "node_modules")) &&
          !fs.existsSync(path.join(origRootDir, "node_modules"))
        ) {
          try {
            fs.cpSync(
              path.join(rootDir, "node_modules"),
              path.join(origRootDir, "node_modules"),
              { recursive: true },
            );
          } catch (_) {}
        }
      }
    }

    const supertestInfo = await detectSupertest(rootDir);
    const { detectIntegrationFrameworks } =
      await import("./integrationDetection.service.js");
    const intDetection = await detectIntegrationFrameworks(rootDir);
    const hasIntegrationDeps = Boolean(
      intDetection?.hasDependencies ||
      intDetection?.summary?.hasDependencies ||
      fs.existsSync(path.join(rootDir, "node_modules", "supertest")) ||
      fs.existsSync(path.resolve(process.cwd(), "node_modules", "supertest")),
    );
    if (!hasIntegrationDeps) {
      throw new ServiceError(
        "Integration tests require 'supertest' to be installed in the project's package.json. Please run 'Install supertest & jest' first.",
        409,
      );
    }

    // Targeted single-endpoint or multi-scenario execution support
    let parsedPayload = {};
    if (typeof job.payloadJson === "string") {
      try {
        parsedPayload = JSON.parse(job.payloadJson) || {};
      } catch (_) {
        parsedPayload = {};
      }
    } else if (job.payloadJson && typeof job.payloadJson === "object") {
      parsedPayload = job.payloadJson;
    }
    const targetTestNames = Array.isArray(parsedPayload?.targetTestNames)
      ? parsedPayload.targetTestNames
          .map((t) => String(t).trim())
          .filter(Boolean)
      : [];
    const selectedScenarioIds = Array.isArray(
      parsedPayload?.selectedScenarioIds,
    )
      ? parsedPayload.selectedScenarioIds
          .map((id) => String(id).trim())
          .filter(Boolean)
      : [];
    const targetEndpoint = parsedPayload?.targetEndpoint || null;
    const rawTargetEndpoints = Array.isArray(parsedPayload?.targetEndpoints)
      ? parsedPayload.targetEndpoints
          .map((ep) => String(ep).trim())
          .filter(Boolean)
      : [];
    const targetEndpoints = rawTargetEndpoints.map((ep) => ep.toUpperCase());
    const targetEndpointSet = new Set(targetEndpoints);
    const targetEndpointSpecs = rawTargetEndpoints
      .map((ep) => {
        const parts = ep.split(/\s+/);
        const method = (parts[0] || "").toUpperCase();
        const epPath = parts.slice(1).join(" ").trim();
        if (!epPath) return null;
        const cleanPath = epPath.replace(/\/+$/, "") || "/";
        const escaped = cleanPath
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/:([a-zA-Z0-9_]+)/g, "[^/\\s'\"`?]+");
        return {
          method,
          path: cleanPath,
          pathLower: cleanPath.toLowerCase(),
          pathRegex: new RegExp(`^${escaped}(?:\\?.*)?$`, "i"),
          contentRegex: new RegExp(escaped, "i"),
        };
      })
      .filter(Boolean);
    const targetEndpointPaths = targetEndpointSpecs.map((s) => s.path);
    const isTargetedRun =
      targetTestNames.length > 0 ||
      selectedScenarioIds.length > 0 ||
      targetEndpoints.length > 0;
    const targetNameSet = new Set(targetTestNames);
    const targetIdSet = new Set(
      selectedScenarioIds.flatMap((id) =>
        id.includes("::") ? [id, id.split("::").slice(1).join("::")] : [id],
      ),
    );

    // Use ONLY generated AI tests to avoid running broken user tests
    const aiTests = await prisma.aiTest.findMany({
      where: { snapshotId },
    });

    const supertestFiles = [];
    const targetedAiExecutionFiles = new Set();
    const { parseCode, findScenarioPath, getScenarioIdentity } =
      await import("./scenarioManager.service.js");
    const _genModule = await import("@babel/generator");
    const generate =
      _genModule.default?.default || _genModule.default || _genModule;

    for (const t of aiTests) {
      if (!t.metaJson) continue;
      let meta;
      try {
        meta =
          typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
      } catch (e) {
        continue;
      }
      const fwUpper = meta.framework
        ? String(meta.framework).toUpperCase()
        : "SUPERTEST";
      if (fwUpper !== "SUPERTEST" && fwUpper !== "PLAYWRIGHT_API") continue;
      if (meta.status === "REJECTED" || meta.status === "DISABLED") continue;

      const filePath = (await resolveContainedProjectPath(snapshot, t.filePath))
        .target;

      const testCode =
        t.content ||
        (fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "");
      if (!testCode) continue;

      // Sync DB content to disk and enforce approval & toggle semantics
      const ast = parseCode(testCode, t.filePath || filePath);
      const requests = Array.isArray(meta.requests) ? meta.requests : [];
      const approvedScenarios = new Set(meta.approvedScenarios || []);
      let hasActiveScenario = requests.length === 0;

      for (const r of requests) {
        const { testName, nameIndex } = getScenarioIdentity(t, r.scenarioId);
        const scenarioPath = findScenarioPath(ast, testName, nameIndex);
        if (scenarioPath) {
          const isExplicitlyApproved =
            approvedScenarios.has(r.scenarioId) ||
            approvedScenarios.has(r.testName);
          const isDraftTest =
            meta.status === "DRAFT" ||
            (!meta.status && approvedScenarios.size === 0);
          const isApproved =
            !isDraftTest &&
            (approvedScenarios.size === 0 || isExplicitlyApproved);
          const isEnabled = r.enabled !== false;
          const epSignature =
            `${String(r.method || "").toUpperCase()} ${String(r.path || "").trim()}`
              .trim()
              .toUpperCase();
          const matchesTarget =
            targetNameSet.has(r.testName) ||
            targetNameSet.has(testName) ||
            targetIdSet.has(r.scenarioId) ||
            targetIdSet.has(`${t.id}::${r.scenarioId}`) ||
            (targetNameSet.size === 0 &&
              targetIdSet.size === 0 &&
              targetEndpointSet.has(epSignature));
          const shouldRun = isTargetedRun
            ? isEnabled && matchesTarget
            : isApproved && isEnabled;

          if (shouldRun) hasActiveScenario = true;

          const callee = scenarioPath.node.callee;
          if (shouldRun) {
            if (
              callee.type === "MemberExpression" &&
              (callee.object.name === "it" || callee.object.name === "test")
            ) {
              scenarioPath.node.callee = callee.object;
            }
          } else {
            if (
              callee.type === "Identifier" &&
              (callee.name === "it" || callee.name === "test")
            ) {
              scenarioPath.node.callee = {
                type: "MemberExpression",
                object: callee,
                property: { type: "Identifier", name: "skip" },
                computed: false,
              };
            }
          }
        }
      }

      const { code: finalCode } = generate(ast);
      const resolvedRootDir = path.resolve(rootDir);
      const relToRoot = path.relative(resolvedRootDir, path.resolve(filePath));
      const isOutsideResolvedRoot =
        !relToRoot || relToRoot.startsWith("..") || path.isAbsolute(relToRoot);
      const executionFilePath = isOutsideResolvedRoot
        ? (() => {
            stagedIntegrationDir = path.join(
              resolvedRootDir,
              "__covai_integration__",
            );
            return path.join(
              stagedIntegrationDir,
              String(t.filePath || path.basename(filePath)).replace(
                /^[/\\]+/,
                "",
              ),
            );
          })()
        : filePath;

      const adaptedCode =
        fwUpper === "PLAYWRIGHT_API" || /@playwright\/test/.test(finalCode)
          ? adaptPlaywrightApiCodeForJest(finalCode, rootDir, executionFilePath)
          : finalCode;

      const executableCode = await transformTestCodeForProject(
        adaptedCode,
        rootDir,
        executionFilePath,
      );
      fs.mkdirSync(path.dirname(executionFilePath), { recursive: true });
      fs.writeFileSync(executionFilePath, executableCode, "utf8");
      supertestFiles.push(executionFilePath);
      if (isTargetedRun && hasActiveScenario) {
        targetedAiExecutionFiles.add(executionFilePath);
      }
    }

    const projectTestFiles =
      supertestInfo.supertestFiles && supertestInfo.supertestFiles.length > 0
        ? supertestInfo.supertestFiles
        : supertestInfo.testFiles || [];
    const existingResolvedPaths = new Set(
      supertestFiles.map((f) => path.resolve(f)),
    );
    for (const f of projectTestFiles) {
      const fullF = path.isAbsolute(f) ? f : path.join(rootDir, f);
      const resolvedFullF = path.resolve(fullF);
      if (fs.existsSync(fullF) && !existingResolvedPaths.has(resolvedFullF)) {
        supertestFiles.push(fullF);
        existingResolvedPaths.add(resolvedFullF);
      }
    }

    if (supertestFiles.length === 0) {
      throw new ServiceError(
        "Không tìm thấy tệp kiểm thử Supertest hợp lệ trong snapshot này. Vui lòng bấm 'Sinh test AI' để tạo kịch bản kiểm thử API.",
        422,
      );
    }

    let testNamePattern = null;

    if (isTargetedRun && targetTestNames.length > 0) {
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      testNamePattern = targetTestNames.map(escapeRegex).join("|");
      const matchedFiles = supertestFiles.filter((filePath) => {
        if (targetedAiExecutionFiles.has(filePath)) return true;
        try {
          const content = fs.readFileSync(filePath, "utf8");
          return targetTestNames.some((tName) => content.includes(tName));
        } catch (_) {
          return true;
        }
      });
      if (matchedFiles.length > 0) {
        supertestFiles.splice(0, supertestFiles.length, ...matchedFiles);
      }
    } else if (isTargetedRun && targetEndpointSpecs.length > 0) {
      const { extractTestRequests } =
        await import("./testSourceParser.service.js");
      const matchedFiles = [];
      const matchedTestNames = new Set();

      for (const filePath of supertestFiles) {
        try {
          const content = fs.readFileSync(filePath, "utf8");
          let fileMatched = false;

          const parsedReqs = extractTestRequests(content, filePath);
          for (const req of parsedReqs) {
            const reqMethod = String(req.method || "").toUpperCase();
            const reqPath =
              String(req.path || "")
                .split("?")[0]
                .replace(/\/+$/, "") || "/";
            const isMatch = targetEndpointSpecs.some(
              (spec) =>
                (!spec.method || !reqMethod || spec.method === reqMethod) &&
                (spec.pathRegex.test(reqPath) ||
                  reqPath.toLowerCase() === spec.pathLower),
            );
            if (isMatch) {
              fileMatched = true;
              if (req.testName) matchedTestNames.add(req.testName);
            }
          }

          if (!fileMatched) {
            fileMatched = targetEndpointSpecs.some((spec) =>
              spec.contentRegex.test(content),
            );
          }

          if (fileMatched) {
            matchedFiles.push(filePath);
          }
        } catch (err) {
          console.warn(
            `[SupertestCoverageJob] Could not inspect ${filePath}:`,
            err?.message,
          );
        }
      }

      if (matchedFiles.length === 0) {
        await stagePreparedPublication(async (tx) => {
          await tx.testRun.create({
            data: {
              id: randomUUID(),
              snapshotId,
              type: "SUPERTEST",
              totalTests: 0,
              passedTests: 0,
              failedTests: 0,
              skippedTests: 0,
              durationMs: 0,
              status: "PASSED",
              startedAt: job.startedAt || new Date(),
              finishedAt: new Date(),
            },
          });
        });

        await markJobSuccess(jobId, {
          coverage: { lines: 0, branches: 0, functions: 0, statements: 0 },
          supertest: {
            version: supertestInfo.version,
            testFileCount: 0,
            configFile: supertestInfo.configFile,
            exitCode: 0,
          },
          analyzedEndpoints: targetEndpoints,
        });

        await addJobLog(
          jobId,
          "INFO",
          JSON.stringify({
            stage: "COMPLETE",
            label:
              "Selected endpoints analyzed (0 test scenarios found; marked Uncovered).",
            progress: 100,
          }),
        );

        try {
          const { invalidateCoverageCache } =
            await import("../controllers/coverage.controller.js");
          invalidateCoverageCache(snapshotId);
          const { invalidateEndpointCache } =
            await import("./integrationWorkspace.service.js");
          invalidateEndpointCache(snapshotId);
        } catch (_) {}

        return;
      }

      supertestFiles.splice(0, supertestFiles.length, ...matchedFiles);
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (matchedTestNames.size > 0) {
        testNamePattern = Array.from(matchedTestNames)
          .map(escapeRegex)
          .join("|");
      } else {
        testNamePattern = targetEndpointPaths.map(escapeRegex).join("|");
      }
    }

    // Targeted runs report only the newly executed endpoints & scenarios (unselected tests remain skipped/not run)
    const previousRuntimeEvidence = [];

    await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => {});
    await updateJobProgress(jobId, 10);
    await addJobLog(
      jobId,
      "INFO",
      JSON.stringify({
        stage: "PREPARE_ENV",
        label: isTargetedRun
          ? `Starting targeted Supertest run (${targetEndpoint || `${targetTestNames.length} scenario(s)`})...`
          : "Starting Supertest coverage pipeline...",
        progress: 10,
      }),
    );

    if (isJobCanceled(jobId, abortController.signal)) return;

    // Ensure dependencies exist (e.g. server/node_modules) before starting test suite
    await updateJobProgress(jobId, 25);
    await ensureProjectDependencies(jobId, rootDir);

    if (isJobCanceled(jobId, abortController.signal)) return;

    // 1. Run Supertest
    await addJobLog(
      jobId,
      "INFO",
      JSON.stringify({
        stage: "RUN_JEST",
        label: isTargetedRun
          ? `Executing targeted test scenario(s)${targetEndpoint ? ` for ${targetEndpoint}` : ""}...`
          : "Running Supertest test suite...",
        progress: 20,
      }),
    );
    restoreExpressEntries = await prepareExpressEntriesForSupertest(rootDir);

    // Temporarily skip scenarios staged as deleted in the Integration Workspace on repo test files
    // without mutating user repo source on disk permanently (restored in finally).
    const stagedSkipBackups = new Map();
    try {
      if (typeof prisma?.projectStructureAnalysis?.findUnique === "function") {
        const analysisRow = await prisma.projectStructureAnalysis
          .findUnique({
            where: { snapshotId },
            select: { resultJson: true },
          })
          .catch(() => null);
        const parsedAnalysis = analysisRow?.resultJson
          ? typeof analysisRow.resultJson === "string"
            ? JSON.parse(analysisRow.resultJson)
            : analysisRow.resultJson
          : null;
        const stagedDeletes = Array.isArray(
          parsedAnalysis?.deletedIntegrationScenarios,
        )
          ? parsedAnalysis.deletedIntegrationScenarios
          : [];
        const skipTitleSet = new Set(
          stagedDeletes
            .map((d) => String(d?.testName || "").trim())
            .filter(Boolean),
        );
        if (skipTitleSet.size > 0) {
          const { default: traverseModule } = await import("@babel/traverse");
          const babelTraverse = traverseModule?.default || traverseModule;
          for (const testFilePath of supertestFiles) {
            if (!fs.existsSync(testFilePath)) continue;
            const origContent = fs.readFileSync(testFilePath, "utf8");
            if (origContent.includes("[AI GENERATED]")) continue;
            try {
              const ast = parseCode(origContent);
              let modified = false;
              babelTraverse(ast, {
                CallExpression(p) {
                  const { callee, arguments: args } = p.node;
                  if (
                    callee.type === "Identifier" &&
                    (callee.name === "it" || callee.name === "test") &&
                    args.length > 0 &&
                    args[0].type === "StringLiteral" &&
                    skipTitleSet.has(args[0].value.trim())
                  ) {
                    p.node.callee = {
                      type: "MemberExpression",
                      object: callee,
                      property: { type: "Identifier", name: "skip" },
                      computed: false,
                    };
                    modified = true;
                  }
                },
              });
              if (modified) {
                const { code: patched } = generate(ast);
                stagedSkipBackups.set(testFilePath, origContent);
                fs.writeFileSync(testFilePath, patched, "utf8");
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {}

    let runResult;
    try {
      runResult = await runSupertest(
        jobId,
        rootDir,
        jestConfigPath ?? supertestInfo.configPath,
        supertestFiles,
        ...(testNamePattern ? [{ testNamePattern }] : []),
      );
    } finally {
      for (const [fPath, orig] of stagedSkipBackups.entries()) {
        try {
          fs.writeFileSync(fPath, orig, "utf8");
        } catch (_) {}
      }
    }
    // DockerRunner streams output live. Saving the final buffers also covers
    // alternative runners and guarantees a complete output record.
    await saveJobOutput(jobId, {
      stdout: runResult.stdout ?? "",
      stderr: runResult.stderr ?? "",
    }).catch(() => {});
    const { coverageDir } = runResult;
    await updateJobProgress(jobId, 60);

    // 2. Parse coverage
    const summaryPath = path.join(coverageDir, "coverage-summary.json");
    const finalPath = path.join(coverageDir, "coverage-final.json");
    if (!fs.existsSync(summaryPath) || !fs.existsSync(finalPath)) {
      const errorSnippet = (runResult.stderr || runResult.stdout || "").trim();
      const reason = errorSnippet ? `: ${errorSnippet.slice(-300)}` : "";
      throw new ServiceError(
        `Supertest completed without producing the required coverage JSON files${reason}`,
        422,
      );
    }
    const summaryResult = await withOperationPublishGuard(() =>
      parseCoverageSummary(coverageDir, snapshotId, {
        skipSummaryUpsert: true,
        skipFileUpsert: true,
      }),
    );

    // Parse test results
    const supertestResults = parseJestResults(coverageDir, {
      aiTests,
      rootDir,
    });
    let createdTestRun = null;
    // SCRUM-141: Persist Supertest test results (only executed/targeted scenarios)
    if (supertestResults) {
      const finalScenarios = supertestResults.scenarios || [];
      const finalDurationMs = supertestResults.durationMs || 0;

      const formattedScenarios = formatScenariosForPrisma(finalScenarios);
      const passedCount = finalScenarios.filter(
        (s) => s.status === "passed",
      ).length;
      const failedCount = finalScenarios.filter(
        (s) => s.status === "failed",
      ).length;
      const skippedCount = finalScenarios.filter(
        (s) => s.status !== "passed" && s.status !== "failed",
      ).length;
      const dataPayload = {
        snapshotId,
        type: "SUPERTEST",
        totalTests: passedCount + failedCount,
        passedTests: passedCount,
        failedTests: failedCount,
        skippedTests: skippedCount,
        durationMs: finalDurationMs,
        status: failedCount > 0 ? "FAILED" : "PASSED",
        startedAt: job.startedAt || new Date(),
        finishedAt: new Date(),
        coverageLinesPct: summaryResult?.total?.lines?.pct ?? null,
        coverageBranchesPct: summaryResult?.total?.branches?.pct ?? null,
        coverageStatementsPct: summaryResult?.total?.statements?.pct ?? null,
        coverageFunctionsPct: summaryResult?.total?.functions?.pct ?? null,
      };
      if (formattedScenarios) {
        dataPayload.scenarios = formattedScenarios;
      }
      dataPayload.id = randomUUID();
      if (dataPayload.scenarios?.create)
        dataPayload.scenarios.create = dataPayload.scenarios.create.map(
          (row) => ({ ...row, id: row.id || randomUUID() }),
        );
      createdTestRun = {
        ...dataPayload,
        scenarios: dataPayload.scenarios?.create || [],
      };
      await stagePreparedPublication(async (tx) => {
        const stored = await tx.testRun.create({
          data: dataPayload,
          include: { scenarios: true },
        });
        if (stored?.id) createdTestRun = stored;
      });
      await addJobLog(
        jobId,
        "INFO",
        JSON.stringify({
          stage: "PARSE_COVERAGE",
          label: `[SCRUM-141] Saved TestRun (SUPERTEST): ${dataPayload.totalTests} tests.`,
          progress: 60,
        }),
      ).catch(() => {});

      // Enrich runtime evidence with testRunId and scenarioId
      try {
        const evidencePath = path.join(coverageDir, "runtime-evidence.json");
        const tempEvidencePath = path.join(
          rootDir,
          ".covai-temp",
          "runtime-evidence.json",
        );
        const targetEvidencePath = fs.existsSync(evidencePath)
          ? evidencePath
          : fs.existsSync(tempEvidencePath)
            ? tempEvidencePath
            : null;
        if (targetEvidencePath || previousRuntimeEvidence.length > 0) {
          const rawEv = targetEvidencePath
            ? JSON.parse(fs.readFileSync(targetEvidencePath, "utf8"))
            : [];
          if (Array.isArray(rawEv)) {
            const newTestTitles = new Set(
              rawEv.map((e) => e.testTitle).filter(Boolean),
            );
            const preservedEv = isTargetedRun
              ? previousRuntimeEvidence.filter(
                  (prev) =>
                    prev.testTitle &&
                    !newTestTitles.has(prev.testTitle) &&
                    !targetTestNames.some((t) => prev.testTitle.includes(t)),
                )
              : [];
            const combinedEv = [...preservedEv, ...rawEv];
            const scenarioMap = new Map(
              (createdTestRun.scenarios || []).map((s) => [s.title, s]),
            );
            const enriched = combinedEv.map((ev) => {
              const sc =
                scenarioMap.get(ev.testTitle) ||
                (createdTestRun.scenarios || []).find(
                  (s) =>
                    ev.testTitle &&
                    s.title &&
                    (ev.testTitle.includes(s.title) ||
                      s.title.includes(ev.testTitle)),
                );
              return {
                ...ev,
                testRunId: createdTestRun.id,
                scenarioId: sc?.id || null,
                runnerVerdict: sc
                  ? sc.status === "passed"
                    ? "PASS"
                    : sc.status === "failed"
                      ? "FAIL"
                      : "SKIPPED"
                  : ev.actualStatusFromRuntime
                    ? "PASS"
                    : "UNKNOWN",
                statusAssertionResult: sc
                  ? sc.status === "passed"
                    ? "PASS"
                    : sc.status === "failed"
                      ? "FAIL"
                      : "NOT_EVALUATED"
                  : ev.actualStatusFromRuntime
                    ? "PASS"
                    : "NOT_EVALUATED",
              };
            });
            fs.writeFileSync(
              evidencePath,
              JSON.stringify(enriched, null, 2),
              "utf8",
            );
            try {
              fs.writeFileSync(
                tempEvidencePath,
                JSON.stringify(enriched, null, 2),
                "utf8",
              );
            } catch (_) {}
          }
        }
      } catch (evErr) {
        console.warn(
          "[SupertestCoverageJob] Failed to enrich runtime evidence:",
          evErr.message,
        );
      }
    }

    // Parse details (reuse logic from runTestsJob)
    const { parseCoverageFilesForSnapshot } =
      await import("./coverageFileParser.service.js");
    const { parseCoverageFunctionsForSnapshot } =
      await import("./coverageFunctionParser.service.js");

    await addJobLog(
      jobId,
      "INFO",
      JSON.stringify({
        stage: "MAP_RESULTS",
        label: "Parsing coverage files and functions...",
        progress: 70,
      }),
    );
    const coverageReport = JSON.parse(fs.readFileSync(finalPath, "utf8"));
    await withOperationPublishGuard(() =>
      parseCoverageFilesForSnapshot({
        projectId,
        snapshotId,
        coverageReport,
        userId,
        testType: "INTEGRATION",
      }),
    );
    await withOperationPublishGuard(() =>
      parseCoverageFunctionsForSnapshot({
        projectId,
        snapshotId,
        coverageReport,
        userId,
      }),
    );

    await updateJobProgress(jobId, 80);

    // 3. Save results
    const storageResult = await storeCoverageOutputs(
      snapshotId,
      projectId,
      coverageDir,
    );

    const allSuitesFailedAtLoad =
      runResult.exitCode !== 0 &&
      Boolean(
        supertestResults &&
          (supertestResults.allSuitesFailedToLoad ||
            (supertestResults.scenarios?.length > 0 &&
              supertestResults.scenarios.every((s) => s.isSuiteLevelFailure))),
      );

    if (allSuitesFailedAtLoad) {
      const firstFailText =
        supertestResults.scenarios?.[0]?.failureSummary ||
        String(supertestResults.scenarios?.[0]?.failureMessages?.[0] || "")
          .split(/\r?\n/)
          .find((l) => /Error:|ReferenceError:|SyntaxError:|TypeError:|Cannot find module/i.test(l)) ||
        "All integration test suites crashed during Jest module loading (0 assertions executed).";
      const conciseReason = firstFailText.trim().slice(0, 300);

      try {
        const { invalidateCoverageCache } =
          await import("../controllers/coverage.controller.js");
        invalidateCoverageCache(snapshotId);
        const { invalidateEndpointCache } =
          await import("./integrationWorkspace.service.js");
        invalidateEndpointCache(snapshotId, rootDir);
      } catch (_) {}

      try {
        import("./dashboardEvents.service.js")
          .then(({ emitDashboardRunStatus }) => {
            emitDashboardRunStatus(projectId, {
              snapshotId,
              jobId,
              pillar: "integration",
              status: "FAILED",
              message: conciseReason,
            }).catch(() => {});
          })
          .catch(() => {});
      } catch (_) {}

      throw new ServiceError(
        `Integration test suites failed to load (${supertestResults.scenarios.length} suite failure(s)): ${conciseReason}`,
        422,
      );
    }

    await markJobSuccess(jobId, {
      coverage: {
        lines: summaryResult.total.lines.pct,
        branches: summaryResult.total.branches.pct,
        functions: summaryResult.total.functions.pct,
        statements: summaryResult.total.statements.pct,
      },
      supertest: {
        version: supertestInfo.version,
        testFileCount: supertestFiles.length,
        configFile: supertestInfo.configFile,
        exitCode: runResult.exitCode,
      },
      storageBasePath: storageResult.baseStoragePath,
      analyzedEndpoints:
        isTargetedRun && targetEndpoints.length > 0 ? targetEndpoints : ["*"],
    });

    await addJobLog(
      jobId,
      "INFO",
      JSON.stringify({
        stage: "COMPLETE",
        label: "Supertest coverage pipeline completed.",
        progress: 100,
      }),
    );
    try {
      import("./dashboardEvents.service.js")
        .then(({ emitDashboardRunStatus, emitDashboardJobProgress }) => {
          emitDashboardJobProgress(projectId, {
            snapshotId,
            jobId,
            pillar: "integration",
            progress: 100,
            stage: "Complete",
            message: "Supertest pipeline completed.",
          }).catch(() => {});
          emitDashboardRunStatus(projectId, {
            snapshotId,
            jobId,
            pillar: "integration",
            status: "SUCCESS",
          }).catch(() => {});
        })
        .catch(() => {});
    } catch (_) {}

    try {
      const { invalidateCoverageCache } =
        await import("../controllers/coverage.controller.js");
      invalidateCoverageCache(snapshotId);
      const { invalidateEndpointCache } =
        await import("./integrationWorkspace.service.js");
      invalidateEndpointCache(snapshotId, rootDir);
    } catch (_) {}

    try {
      const { capturePeakIntegrationReportIfHigher } =
        await import("./integrationReport.service.js");
      await capturePeakIntegrationReportIfHigher(snapshotId, {
        projectId,
        testRunId: createdTestRun?.id || null,
        coverageTotal: summaryResult?.total || null,
      });
    } catch (peakErr) {
      console.warn(
        "[SupertestCoverageJob] Non-fatal peak report capture warning:",
        peakErr?.message,
      );
    }
  } catch (error) {
    if (
      isJobCanceled(jobId, abortController.signal) ||
      error?.code === "OPERATION_CANCELED" ||
      error?.message?.includes("canceled") ||
      error?.message?.includes("cancelled")
    ) {
      await addJobLog(
        jobId,
        "INFO",
        "[SUPERTEST] Run Tests canceled by user. Preserving partial execution evidence.",
      ).catch(() => {});

      // Safely stage partial evidence without overwriting previous successful run
      try {
        const job = await getJobById(jobId).catch(() => null);
        const snapshotId = job?.snapshotId;
        const rootDir = job?.snapshot?.rootDir;

        if (snapshotId && rootDir) {
          const coverageDir = path.join(rootDir, "coverage");
          let scenarios = [];

          // 1. Try to read partial Jest results if Jest managed to output before abort
          try {
            const partialJest = parseJestResults(coverageDir, { rootDir });
            if (partialJest && Array.isArray(partialJest.scenarios)) {
              scenarios = partialJest.scenarios;
            }
          } catch (_) {}

          // 2. Read runtime evidence from coverage or temp dir
          const evidenceCandidates = [
            path.join(coverageDir, "runtime-evidence.json"),
            path.join(rootDir, ".covai-temp", "runtime-evidence.json"),
          ];
          let rawEv = [];
          let foundEvPath = null;
          for (const p of evidenceCandidates) {
            if (fs.existsSync(p)) {
              try {
                rawEv = JSON.parse(fs.readFileSync(p, "utf8"));
                if (Array.isArray(rawEv) && rawEv.length > 0) {
                  foundEvPath = p;
                  break;
                }
              } catch (_) {}
            }
          }

          // If no Jest scenarios were parsed, but runtime evidence has captured tests:
          if (scenarios.length === 0 && rawEv.length > 0) {
            scenarios = rawEv.map((ev) => ({
              title: ev.testTitle || "Executed Scenario",
              suiteName: "Integration Tests",
              status: ev.actualStatusFromRuntime ? "passed" : "failed",
              duration: 0,
              failureMessages: [],
              testFile: null,
            }));
          }

          // Create a CANCELED TestRun record preserving evidence without fabricating unrun tests
          const formattedScenarios = formatScenariosForPrisma(scenarios);
          const passed = scenarios.filter((s) => s.status === "passed").length;
          const failed = scenarios.filter((s) => s.status === "failed").length;
          const skipped = scenarios.filter(
            (s) => s.status === "pending" || s.status === "skipped",
          ).length;

          const canceledTestRun = await prisma.testRun.create({
            data: {
              snapshotId,
              type: "SUPERTEST",
              totalTests: scenarios.length,
              passedTests: passed,
              failedTests: failed,
              skippedTests: skipped,
              durationMs: 0,
              status: "CANCELED",
              startedAt: new Date(),
              finishedAt: new Date(),
              ...(formattedScenarios ? { scenarios: formattedScenarios } : {}),
            },
            include: { scenarios: true },
          });

          // Ensure Job is marked CANCELED in DB so withOperationWorkspace knows it was canceled
          await prisma.job
            .update({
              where: { id: jobId },
              data: { status: "CANCELED", finishedAt: new Date() },
            })
            .catch(() => {});
          try {
            const { emitDashboardRunStatus } =
              await import("./dashboardEvents.service.js");
            emitDashboardRunStatus(job.projectId, {
              snapshotId,
              jobId,
              pillar: "integration",
              status: "CANCELED",
            }).catch(() => {});
          } catch (_) {}

          // Enrich runtime evidence with this canceled TestRun ID
          if (foundEvPath && rawEv.length > 0) {
            const scenarioMap = new Map(
              (canceledTestRun.scenarios || []).map((s) => [s.title, s]),
            );
            const enriched = rawEv.map((ev) => {
              const sc =
                scenarioMap.get(ev.testTitle) ||
                (canceledTestRun.scenarios || []).find(
                  (s) =>
                    ev.testTitle &&
                    s.title &&
                    (ev.testTitle.includes(s.title) ||
                      s.title.includes(ev.testTitle)),
                );
              return {
                ...ev,
                testRunId: canceledTestRun.id,
                scenarioId: sc?.id || null,
                runnerVerdict: sc
                  ? sc.status === "passed"
                    ? "PASS"
                    : sc.status === "failed"
                      ? "FAIL"
                      : "SKIPPED"
                  : ev.actualStatusFromRuntime
                    ? "PASS"
                    : "UNKNOWN",
                statusAssertionResult: sc
                  ? sc.status === "passed"
                    ? "PASS"
                    : sc.status === "failed"
                      ? "FAIL"
                      : "NOT_EVALUATED"
                  : ev.actualStatusFromRuntime
                    ? "PASS"
                    : "NOT_EVALUATED",
              };
            });
            fs.writeFileSync(
              foundEvPath,
              JSON.stringify(enriched, null, 2),
              "utf8",
            );
          }
        }
      } catch (stageErr) {
        console.warn(
          "[SupertestCoverageJob] Error saving partial canceled run evidence:",
          stageErr.message,
        );
      }
      return;
    }
    console.error(`[SupertestCoverageJob ${jobId}] Error:`, error);
    await markJobFailed(jobId, error).catch(() => {});
    try {
      import("./dashboardEvents.service.js")
        .then(({ emitDashboardRunStatus }) => {
          emitDashboardRunStatus(projectId, {
            snapshotId,
            jobId,
            pillar: "integration",
            status: "FAILED",
          }).catch(() => {});
        })
        .catch(() => {});
    } catch (_) {}
  } finally {
    unregisterJobAbortController(jobId);
    if (typeof restoreExpressEntries === "function") {
      restoreExpressEntries();
    }
    if (stagedIntegrationDir && fs.existsSync(stagedIntegrationDir)) {
      try {
        fs.rmSync(stagedIntegrationDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn(
          "[SupertestCoverageJob] Staged integration test cleanup warning:",
          cleanupErr?.message,
        );
      }
    }
  }
};
