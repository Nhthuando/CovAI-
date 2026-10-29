import fs from "fs";
import path from "path";
import { dockerRunner } from "./dockerRunner.service.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Standard Node.js built-in modules that should never be installed from npm.
 */
export const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib"
]);

/**
 * Strict regex for valid npm package names (prevent command injection).
 * Accepts regular packages (e.g. "mathjs", "lodash") and scoped packages (e.g. "@prisma/client", "@types/node").
 */
export const NPM_PACKAGE_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

/**
 * Validates a package name for npm installation.
 * @param {string} packageName
 * @returns {boolean}
 */
export const isValidNpmPackageName = (packageName) => {
  if (!packageName || typeof packageName !== "string") return false;
  const trimmed = packageName.trim();
  if (trimmed.length === 0 || trimmed.length > 214) return false;
  // Disallow shell metacharacters
  if (/[\s;&|`$><\\!*?(){}[\]\r\n]/.test(trimmed)) return false;
  return NPM_PACKAGE_REGEX.test(trimmed);
};

/**
 * Parses test runner output (Jest, Vitest, Node CJS, ESM) to extract a missing third-party dependency.
 *
 * @param {string} rawOutput - stdout or stderr from test execution
 * @returns {{ packageName: string, rawSpecifier: string, importedFrom: string | null } | null}
 */
export const extractMissingDependency = (rawOutput = "") => {
  if (!rawOutput || typeof rawOutput !== "string") return null;

  const patterns = [
    // Jest resolver: Cannot find module 'mathjs' from 'src/utils/evaluator.ts'
    /Cannot find module ['"]([^'"]+)['"]\s+from\s+['"]([^'"]+)['"]/i,
    // Vitest / Vite resolver: Failed to resolve import "mathjs" from "src/utils/evaluator.ts"
    /Failed to resolve import ['"]([^'"]+)['"]\s+from\s+['"]([^'"]+)['"]/i,
    // Node.js loader: Error: Cannot find module 'mathjs'
    /Error:\s*Cannot find module ['"]([^'"]+)['"]/i,
    // Webpack / bundler resolver: Module not found: Can't resolve 'mathjs' in '...'
    /Module not found:\s*Can't resolve ['"]([^'"]+)['"]\s+in\s+['"]([^'"]+)['"]/i,
  ];

  let rawSpecifier = null;
  let importedFrom = null;

  for (const regex of patterns) {
    const match = rawOutput.match(regex);
    if (match) {
      rawSpecifier = match[1]?.trim();
      importedFrom = match[2]?.trim() || null;
      break;
    }
  }

  if (!rawSpecifier) return null;

  // Disallow relative or absolute file paths (internal project files)
  if (
    rawSpecifier.startsWith(".") ||
    rawSpecifier.startsWith("/") ||
    rawSpecifier.startsWith("\\")
  ) {
    return null;
  }

  // Extract base package name
  let packageName = rawSpecifier;
  if (rawSpecifier.startsWith("@")) {
    // Scoped package: @org/pkg/subpath -> @org/pkg
    const parts = rawSpecifier.split("/");
    if (parts.length >= 2) {
      packageName = `${parts[0]}/${parts[1]}`;
    }
  } else {
    // Regular package: mathjs/lib/esm -> mathjs
    packageName = rawSpecifier.split("/")[0];
  }

  // Strip trailing version tag if any (e.g. mathjs@^12 -> mathjs)
  packageName = packageName.replace(/@[\^~]?[0-9].*$/, "").trim();

  // Exclude Node.js built-ins
  if (NODE_BUILTINS.has(packageName.toLowerCase())) {
    return null;
  }

  // Validate npm package format
  if (!isValidNpmPackageName(packageName)) {
    return null;
  }

  return {
    packageName,
    rawSpecifier,
    importedFrom,
  };
};

/**
 * Finds the closest directory containing package.json relative to importedFrom or rootDir.
 *
 * @param {string} rootDir
 * @param {string|null} importedFrom
 * @returns {string}
 */
export const findTargetPackageDir = (rootDir, importedFrom = null) => {
  const resolvedRoot = resolveProjectRoot(rootDir);
  if (!importedFrom) return resolvedRoot;

  let currentDir = path.isAbsolute(importedFrom)
    ? path.dirname(importedFrom)
    : path.dirname(path.join(resolvedRoot, importedFrom));

  // Walk up from file directory to root directory
  while (currentDir && currentDir.startsWith(resolvedRoot) && currentDir !== path.dirname(resolvedRoot)) {
    const pkgPath = path.join(currentDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return resolvedRoot;
};

/**
 * Inspects the workspace environment to check whether a package is declared or installed.
 *
 * @param {Object} params
 * @param {string} params.rootDir
 * @param {string} params.packageName
 * @param {string|null} params.importedFrom
 * @returns {{ inPackageJson: boolean, inNodeModules: boolean, targetDir: string, suggestedCommand: string }}
 */
export const inspectWorkspaceDependency = ({ rootDir, packageName, importedFrom = null }) => {
  const targetDir = findTargetPackageDir(rootDir, importedFrom);
  const pkgPath = path.join(targetDir, "package.json");

  let inPackageJson = false;
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      inPackageJson = Boolean(
        pkg.dependencies?.[packageName] ||
        pkg.devDependencies?.[packageName] ||
        pkg.peerDependencies?.[packageName]
      );
    } catch { }
  }

  const nodeModulesPath = path.join(targetDir, "node_modules", packageName);
  const rootNodeModulesPath = path.join(rootDir, "node_modules", packageName);
  const inNodeModules = fs.existsSync(nodeModulesPath) || fs.existsSync(rootNodeModulesPath);

  const isDevTarget = importedFrom && /(?:__tests__|tests?|specs?|\.test\.|\.spec\.)/i.test(importedFrom);
  const suggestedCommand = isDevTarget
    ? `npm install --save-dev ${packageName}`
    : `npm install ${packageName}`;

  return {
    inPackageJson,
    inNodeModules,
    targetDir,
    suggestedCommand,
  };
};

/**
 * Installs a missing dependency into the workspace using dockerRunner (with shell fallback).
 * Updates package.json safely if npm did not persist changes.
 *
 * @param {Object} params
 * @param {string} params.rootDir
 * @param {string} params.packageName
 * @param {boolean} [params.isDev=false]
 * @param {string|null} [params.importedFrom=null]
 * @param {string|null} [params.jobId=null]
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, targetDir: string }>}
 */
export const installPackageInWorkspace = async ({
  rootDir,
  packageName,
  isDev = false,
  importedFrom = null,
  jobId = null,
}) => {
  if (!isValidNpmPackageName(packageName)) {
    throw new ServiceError(`Invalid or unsafe npm package name: '${packageName}'`, 400);
  }

  const effectiveRootDir = resolveProjectRoot(rootDir);
  if (!effectiveRootDir || !fs.existsSync(effectiveRootDir)) {
    throw new ServiceError(`Invalid project root directory: ${rootDir}`, 404);
  }

  const targetDir = findTargetPackageDir(effectiveRootDir, importedFrom);
  const saveFlag = isDev ? "--save-dev" : "--save";
  const command = `npm install ${saveFlag} ${packageName} --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false`;

  const execResult = await dockerRunner.run({
    snapshotPath: targetDir,
    command,
    timeoutMs: 5 * 60 * 1000,
    jobId,
  });

  // Guarantee package.json has entry in case npm ran in restricted sandbox
  const pkgJsonPath = path.join(targetDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      const section = isDev ? "devDependencies" : "dependencies";
      pkg[section] = pkg[section] || {};
      if (!pkg.dependencies?.[packageName] && !pkg.devDependencies?.[packageName]) {
        pkg[section][packageName] = "^latest";
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2), "utf8");
      }
    } catch (err) {
      console.warn("[installPackageInWorkspace] Notice updating package.json:", err.message);
    }
  }

  return {
    success: execResult.success,
    stdout: execResult.stdout || "",
    stderr: execResult.stderr || "",
    targetDir,
    exitCode: execResult.exitCode,
  };
};
