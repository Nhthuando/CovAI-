import fs from "fs";
import path from "path";
import { dockerRunner } from "./dockerRunner.service.js";
import { addJobLog } from "./job.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import {
  ensureSupertestDatabaseSetupFile,
  ensureSystemDatabaseMockPreload,
} from "./databaseMockTemplate.service.js";
import { prepareIntegrationDatabase } from "./integrationRuntimeDatabase.service.js";
import { getJobAbortSignal } from "./jobCancellation.service.js";

const SUPERTEST_TIMEOUT_MS = 10 * 60 * 1000;

const quoteForShell = (value) => {
  if (!value) return '""';
  const str = String(value);
  // Safe alphanumeric path with no spaces doesn't need quotes
  if (/^[a-zA-Z0-9_\-./\\]+$/.test(str)) {
    return str;
  }
  // On Windows cmd.exe, single quotes are NOT stripped and get passed as literal characters into filename.
  // Use double quotes on Windows.
  if (process.platform === "win32") {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `'${str.replaceAll("'", "'\\''")}'`;
};

const readPkg = (dir) => {
  const packageJsonPath = path.join(dir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (_) {
    return null;
  }
};

const shouldUseNodeJestDirect = (rootDir, testFiles = []) => {
  const pkgDirs = [
    rootDir,
    path.join(rootDir, "server"),
    path.join(rootDir, "backend"),
    path.join(rootDir, "api"),
  ];
  for (const dir of pkgDirs) {
    const pkg = readPkg(dir);
    if (pkg?.type === "module") return true;
    if (
      [
        "jest.config.mjs",
        "jest.config.js",
        "jest.config.cjs",
        "jest.config.ts",
      ].some(
        (name) => fs.existsSync(path.join(dir, name)) && name.endsWith(".mjs"),
      )
    ) {
      return true;
    }
  }

  for (const rel of testFiles) {
    try {
      const abs = path.isAbsolute(rel) ? rel : path.join(rootDir, rel);
      if (fs.existsSync(abs)) {
        const content = fs.readFileSync(abs, "utf8");
        if (/^\s*import\s+.+\s+from\s+['"]/m.test(content)) {
          return true;
        }
      }
    } catch (_) {}
  }

  return false;
};

const resolveJestBinPath = (rootDir) => {
  const candidates = [
    path.join(rootDir, "node_modules", "jest", "bin", "jest.js"),
    path.join(rootDir, "server", "node_modules", "jest", "bin", "jest.js"),
    path.join(rootDir, "backend", "node_modules", "jest", "bin", "jest.js"),
    path.join(rootDir, "api", "node_modules", "jest", "bin", "jest.js"),
    ...(process.platform !== "win32"
      ? ["/app/node_modules/jest/bin/jest.js"]
      : []),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
};

const formatJestBinArg = (resolvedRoot, jestBinPath) => {
  const rel = path.relative(resolvedRoot, jestBinPath).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return jestBinPath.replace(/\\/g, "/");
  }
  return rel;
};

const findBackendJestConfig = (rootDir) => {
  const configNames = ["jest.config.js", "jest.config.mjs", "jest.config.cjs"];
  for (const sub of ["server", "backend", "api"]) {
    for (const name of configNames) {
      const cand = path.join(rootDir, sub, name);
      if (fs.existsSync(cand)) return cand;
    }
  }
  return null;
};

const assertValidRootDir = (rootDir) => {
  if (!rootDir || typeof rootDir !== "string" || rootDir.trim().length === 0) {
    throw new ServiceError("Project root directory is required", 400);
  }

  const resolvedRoot = path.resolve(rootDir);
  if (
    !fs.existsSync(resolvedRoot) ||
    !fs.statSync(resolvedRoot).isDirectory()
  ) {
    throw new ServiceError(
      "Project root directory does not exist or is not a directory",
      400,
    );
  }

  return resolvedRoot;
};

/** Execute only Supertest test files in an isolated test environment. */
export const runSupertest = async (
  jobId,
  rootDir,
  jestConfigPath,
  supertestFiles = [],
  options = {},
) => {
  if (!Array.isArray(supertestFiles)) {
    throw new ServiceError("supertestFiles must be an array", 400);
  }

  const resolvedRoot = assertValidRootDir(resolveProjectRoot(rootDir));
  if (supertestFiles.length === 0) {
    throw new ServiceError("No Supertest test files were supplied", 422);
  }

  const normalizedFiles = supertestFiles
    .map((file) => {
      if (!file || typeof file !== "string") {
        throw new ServiceError(
          "Supertest file paths must be valid strings",
          400,
        );
      }
      const resolvedFile = path.resolve(file);
      const relativePath = path.relative(resolvedRoot, resolvedFile);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new ServiceError(
          `Supertest file is outside the project root: ${file}`,
          400,
        );
      }
      return path.relative(resolvedRoot, resolvedFile).replace(/\\/g, "/");
    })
    .filter(
      (file) => file && !file.startsWith("../") && !path.isAbsolute(file),
    );

  if (normalizedFiles.length === 0) {
    throw new ServiceError(
      "Supertest files must be inside the project root",
      400,
    );
  }

  const testArgs = normalizedFiles.map(quoteForShell).join(" ");
  const usesEsm = shouldUseNodeJestDirect(resolvedRoot, normalizedFiles);
  const jestBinPath = resolveJestBinPath(resolvedRoot);
  const nodePathCandidates = [
    ...(process.platform !== "win32" ? ["/app/node_modules"] : []),
    path.join(resolvedRoot, "node_modules"),
    path.join(resolvedRoot, "server", "node_modules"),
    path.join(resolvedRoot, "backend", "node_modules"),
    path.join(resolvedRoot, "api", "node_modules"),
  ].filter((p) => fs.existsSync(p));

  const hasExplicitStripeMock = normalizedFiles.some((rel) => {
    try {
      const abs = path.resolve(resolvedRoot, rel);
      if (!fs.existsSync(abs)) return false;
      const src = fs.readFileSync(abs, "utf8");
      return /(?:unstable_mockModule|mock)\s*\(\s*['"]stripe['"]/.test(src);
    } catch (_) {
      return false;
    }
  });
  const hasExplicitGenAiMock = normalizedFiles.some((rel) => {
    try {
      const abs = path.resolve(resolvedRoot, rel);
      if (!fs.existsSync(abs)) return false;
      const src = fs.readFileSync(abs, "utf8");
      return /(?:unstable_mockModule|mock)\s*\(\s*['"]@google\/generative-ai['"]/.test(
        src,
      );
    } catch (_) {
      return false;
    }
  });

  const env = {
    CI: "true",
    NODE_ENV: "test",
    COVAI_JOB_ID: jobId || "",
    ...(options?.databaseUrl || process.env.TEST_DATABASE_URL
      ? { DATABASE_URL: options?.databaseUrl || process.env.TEST_DATABASE_URL }
      : {}),
    PORT: options?.port ? String(options.port) : "0",
    STRIPE_SECRET_KEY:
      process.env.STRIPE_SECRET_KEY || "sk_test_covai_mock_secret_key_12345",
    STRIPE_API_KEY:
      process.env.STRIPE_API_KEY || "sk_test_covai_mock_api_key_12345",
    GEMINI_API_KEY:
      process.env.GEMINI_API_KEY || "covai_mock_gemini_api_key_12345",
    GOOGLE_API_KEY:
      process.env.GOOGLE_API_KEY || "covai_mock_google_api_key_12345",
    ...(hasExplicitStripeMock ? { COVAI_SKIP_STRIPE_MOCK: "true" } : {}),
    ...(hasExplicitGenAiMock ? { COVAI_SKIP_GENAI_MOCK: "true" } : {}),
    ...(nodePathCandidates.length > 0
      ? { NODE_PATH: nodePathCandidates.join(path.delimiter) }
      : {}),
    ...(usesEsm ? { NODE_OPTIONS: "--experimental-vm-modules" } : {}),
  };
  // NODE_OPTIONS already carries --experimental-vm-modules when usesEsm is true,
  // so npx --no-install jest inherits it without passing `npx` as a script to `node`.
  const jestBinary = jestBinPath
    ? `${quoteForShell(process.execPath)} ${usesEsm ? "--experimental-vm-modules " : ""}${quoteForShell(formatJestBinArg(resolvedRoot, jestBinPath))}`
    : "npx --no-install jest";

  const coverageDir = path.join(resolvedRoot, "coverage", "integration");
  if (!fs.existsSync(coverageDir)) {
    fs.mkdirSync(coverageDir, { recursive: true });
  }
  const resultsPath = path.join(coverageDir, "test-results.json");
  // Remove stale results and evidence files from previous runs so a failed run does not report false success
  if (fs.existsSync(resultsPath)) {
    try {
      fs.unlinkSync(resultsPath);
    } catch (_) {}
  }
  const evidencePath = path.join(coverageDir, "runtime-evidence.json");
  if (fs.existsSync(evidencePath)) {
    try {
      fs.unlinkSync(evidencePath);
    } catch (_) {}
  }
  const tempEvidencePath = path.join(
    resolvedRoot,
    ".covai-temp",
    "runtime-evidence.json",
  );
  if (fs.existsSync(tempEvidencePath)) {
    try {
      fs.unlinkSync(tempEvidencePath);
    } catch (_) {}
  }
  const relativeResultsPath = path
    .relative(resolvedRoot, resultsPath)
    .replace(/\\/g, "/");

  const abortSignal = options?.signal || getJobAbortSignal(jobId);
  let dbSession = null;
  let esmPreloadSession = null;
  const tempEsmPkgMarkers = [];
  try {
    if (!options?.databaseUrl && options?.useLiveDatabase !== false) {
      dbSession = await prepareIntegrationDatabase({
        jobId,
        rootDir: resolvedRoot,
        signal: abortSignal,
      });
      if (dbSession?.active && dbSession.environment) {
        Object.assign(env, dbSession.environment);
      }
    }

    if (usesEsm && !dbSession?.useLiveDatabase) {
      try {
        esmPreloadSession = ensureSystemDatabaseMockPreload(resolvedRoot, {
          tempSubdir: ".covai-temp/supertest-esm-mock",
        });
        env.NODE_OPTIONS =
          `${env.NODE_OPTIONS || "--experimental-vm-modules"} ${esmPreloadSession.requireFlag}`.trim();
      } catch (_) {}

      // If any ESM test file (.js) sits outside the backend subpackage (e.g. repo/tests/integration/*.test.js
      // where root package.json lacks "type": "module"), place a temporary {"type": "module"} marker in its dir
      // so Node's ESM VM module loader executes `import` without SyntaxError, and clean it in finally.
      for (const relTest of normalizedFiles) {
        try {
          const absTest = path.resolve(resolvedRoot, relTest);
          const testDir = path.dirname(absTest);
          const pkgMarker = path.join(testDir, "package.json");
          if (fs.existsSync(absTest) && !fs.existsSync(pkgMarker)) {
            const content = fs.readFileSync(absTest, "utf8");
            if (/^\s*import\s+.+\s+from\s+['"]/m.test(content)) {
              fs.writeFileSync(
                pkgMarker,
                JSON.stringify({ type: "module" }, null, 2) + "\n",
                "utf8",
              );
              tempEsmPkgMarkers.push(pkgMarker);
            }
          }
        } catch (_) {}
      }
    }

    let setupArgs = "";
    try {
      const useLiveDb = Boolean(dbSession?.useLiveDatabase);
      const setupFileInfo = ensureSupertestDatabaseSetupFile(resolvedRoot, {
        disableDatabaseMock: useLiveDb,
      });
      if (setupFileInfo?.absolutePath) {
        const cleanAbs = setupFileInfo.absolutePath.replace(/\\/g, "/");
        setupArgs = ` --setupFilesAfterEnv=${quoteForShell(cleanAbs)}`;
        const dbModeLabel = useLiveDb
          ? `live ephemeral ${dbSession.engine || "service"} (DB mocks disabled)`
          : `schema-aware mock DB (${setupFileInfo.dbInfo?.primaryType || dbSession?.engine || "in-memory"})`;
        await addJobLog(
          jobId,
          "INFO",
          `[SUPERTEST] Injected runtime setup: ${setupFileInfo.relativePath} (${dbModeLabel})`,
        ).catch(() => {});
      }
    } catch (setupErr) {
      console.warn(
        "[SupertestRunner] Could not create setup file:",
        setupErr.message,
      );
    }

    const relCovDir =
      path.relative(resolvedRoot, coverageDir).replace(/\\/g, "/") ||
      "coverage/integration";
    let jestCmd = `${jestBinary} --runInBand --testEnvironment=node --coverage --coverageDirectory=${quoteForShell(path.resolve(coverageDir).replace(/\\/g, "/"))} --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --json --outputFile=${quoteForShell(resultsPath.replace(/\\/g, "/"))} --forceExit --testTimeout=30000${setupArgs}`;
    if (
      options?.testNamePattern &&
      typeof options.testNamePattern === "string" &&
      options.testNamePattern.trim()
    ) {
      jestCmd += ` --testNamePattern=${quoteForShell(options.testNamePattern.trim())}`;
    }
    if (nodePathCandidates.length > 0) {
      for (const modDir of nodePathCandidates) {
        jestCmd += ` --modulePaths=${quoteForShell(modDir.replace(/\\/g, "/"))}`;
      }
    }
    jestCmd += ` --runTestsByPath ${testArgs}`;

    const effectiveConfigPath =
      jestConfigPath || findBackendJestConfig(resolvedRoot);
    if (effectiveConfigPath) {
      const resolvedConfig = path.isAbsolute(effectiveConfigPath)
        ? effectiveConfigPath
        : path.resolve(resolvedRoot, effectiveConfigPath);
      const relativeConfig = path
        .relative(resolvedRoot, resolvedConfig)
        .replace(/\\/g, "/");
      const lowerConfig = relativeConfig.toLowerCase();

      let isFrontendConfig =
        lowerConfig.startsWith("client/") ||
        lowerConfig.startsWith("frontend/") ||
        lowerConfig.startsWith("ui/") ||
        lowerConfig.startsWith("web/");
      if (!isFrontendConfig && fs.existsSync(resolvedConfig)) {
        try {
          const configContent = fs.readFileSync(resolvedConfig, "utf8");
          if (
            configContent.includes("jsdom") ||
            configContent.includes("jest-environment-jsdom")
          ) {
            isFrontendConfig = true;
          }
        } catch (_) {}
      }

      if (isFrontendConfig) {
        await addJobLog(
          jobId,
          "WARN",
          `[SUPERTEST] Ignored client-side Jest config (${relativeConfig}) for server integration tests. Running with default Node test environment.`,
        ).catch(() => {});
      } else if (
        relativeConfig &&
        !relativeConfig.startsWith("../") &&
        !path.isAbsolute(relativeConfig)
      ) {
        jestCmd += ` --config=${quoteForShell(relativeConfig)}`;
        // If Jest config lives in a subpackage (e.g. server/jest.config.js), Jest sets default
        // roots to [dirname(config)] and silently drops test files outside it (e.g. root tests/integration/*).
        // Explicitly expand --roots when any test file lies outside the config directory.
        const configDir = path.dirname(resolvedConfig);
        const hasTestsOutsideConfigDir = normalizedFiles.some((relTest) => {
          const relToCfg = path.relative(
            configDir,
            path.resolve(resolvedRoot, relTest),
          );
          return relToCfg.startsWith("..") || path.isAbsolute(relToCfg);
        });
        if (hasTestsOutsideConfigDir) {
          jestCmd += ` --roots=${quoteForShell(resolvedRoot.replace(/\\/g, "/"))}`;
          if (path.resolve(configDir) !== path.resolve(resolvedRoot)) {
            jestCmd += ` --roots=${quoteForShell(configDir.replace(/\\/g, "/"))}`;
          }
        }
      }
    }

    await addJobLog(
      jobId,
      "INFO",
      "[SUPERTEST] Starting isolated integration tests.",
    ).catch(() => {});

    // Automatically generate Prisma Client if project uses Prisma and schema sync didn't already run it
    if (!dbSession?.prismaSynced) {
      try {
        const { detectAndRunPrismaGenerate } =
          await import("./runTestsJob.service.js");
        await detectAndRunPrismaGenerate(jobId, resolvedRoot);
      } catch (_) {}
    }

    const startedAt = Date.now();
    let result;
    try {
      result = await dockerRunner.run({
        snapshotPath: resolvedRoot,
        command: jestCmd,
        timeoutMs: SUPERTEST_TIMEOUT_MS,
        jobId,
        env,
        signal: abortSignal,
      });
    } catch (error) {
      await addJobLog(
        jobId,
        "ERROR",
        `[SUPERTEST] Runner error: ${error.message}`,
      ).catch(() => {});
      throw error;
    }

    if (!result.success && result.exitCode === null) {
      const message = `[SUPERTEST] Integration tests failed (process terminated unexpectedly).`;
      await addJobLog(jobId, "ERROR", message).catch(() => {});
      throw new ServiceError(message, 422);
    }

    if (result.exitCode !== 0) {
      await addJobLog(
        jobId,
        "WARN",
        `[SUPERTEST] Integration tests failed with exit code ${result.exitCode}. Proceeding to parse results.`,
      ).catch(() => {});
    } else {
      await addJobLog(
        jobId,
        "INFO",
        "[SUPERTEST] Integration tests completed successfully.",
      ).catch(() => {});
    }

    return {
      exitCode: result.exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      executionTimeMs: Date.now() - startedAt,
      coverageDir,
    };
  } finally {
    for (const marker of tempEsmPkgMarkers) {
      try {
        if (fs.existsSync(marker)) fs.unlinkSync(marker);
      } catch (_) {}
    }
    if (esmPreloadSession?.cleanup) {
      await esmPreloadSession.cleanup().catch(() => {});
    }
    if (dbSession?.cleanup) {
      try {
        await dbSession.cleanup();
        if (dbSession.active) {
          await addJobLog(
            jobId,
            "INFO",
            "[SUPERTEST] Cleaned up isolated ephemeral test service(s).",
          ).catch(() => {});
        }
      } catch (cleanupErr) {
        console.warn(
          "[SupertestRunner] Ephemeral DB cleanup warning:",
          cleanupErr.message,
        );
      }
    }
  }
};

export const runSupertestTests = runSupertest;
