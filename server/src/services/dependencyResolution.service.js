import fs from "fs";
import path from "path";
import { dockerRunner } from "./dockerRunner.service.js";
import { resolveProjectRoot, resolveSnapshotRootDir } from "../utils/projectRootResolver.js";
import { ServiceError } from "../utils/serviceError.js";
import { DEPENDENCY_INSTALL_TIMEOUT_MS } from '../../../shared/unitTestRuntime.js';

export function resolvePackageManagerHostCommand(command, { platform = process.platform, nodeExecutable = process.execPath, exists = fs.existsSync } = {}) {
  if (platform !== 'win32' || !command.startsWith('npm ')) return command;
  const npmCli = path.win32.join(path.win32.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  // npm.cmd/npm.ps1 can point at a broken global prefix. Execute the known
  // bundled CLI directly without changing system settings or global packages.
  if (!exists(npmCli)) return command;
  return `"${nodeExecutable}" "${npmCli}" ${command.slice(4)}`;
}

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
 * Common monorepo subpackage folder candidates.
 */
const MONOREPO_SUBPACKAGE_CANDIDATES = [
  "backend",
  "server",
  "api",
  "app",
  "client",
  "frontend",
  "web",
];

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
    // Node.js ESM loader: Cannot find package 'mathjs' imported from '/app/.../evaluator.ts'
    /Cannot find package ['"]([^'"]+)['"]\s+imported from\s+['"]([^'"]+)['"]/i,
    // Node.js ESM loader: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mathjs'
    /Error\s*(?:\[[^\]]+\])?:\s*Cannot find package ['"]([^'"]+)['"]/i,
    // Plain Node ESM: Cannot find package 'mathjs'
    /Cannot find package ['"]([^'"]+)['"]/i,
    // Jest resolver: Cannot find module 'mathjs' from 'src/utils/evaluator.ts'
    /Cannot find module ['"]([^'"]+)['"]\s+from\s+['"]([^'"]+)['"]/i,
    // Vitest / Vite resolver: Failed to resolve import "mathjs" from "src/utils/evaluator.ts"
    /Failed to resolve import ['"]([^'"]+)['"]\s+from\s+['"]([^'"]+)['"]/i,
    // Node.js loader: Error: Cannot find module 'mathjs'
    /Error:\s*Cannot find module ['"]([^'"]+)['"]/i,
    // Plain Jest/Node message: Cannot find module 'mathjs'
    /Cannot find module ['"]([^'"]+)['"]/i,
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
 * Lists all candidate package directories in a project (root + monorepo subpackages).
 *
 * @param {string} resolvedRoot
 * @returns {string[]}
 */
export const listWorkspacePackageDirs = (resolvedRoot) => {
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return [];
  const dirs = [];
  if (fs.existsSync(path.join(resolvedRoot, "package.json"))) {
    dirs.push(resolvedRoot);
  }

  for (const sub of MONOREPO_SUBPACKAGE_CANDIDATES) {
    const subDir = path.join(resolvedRoot, sub);
    if (fs.existsSync(path.join(subDir, "package.json"))) {
      dirs.push(subDir);
    }
  }

  for (const group of ["packages", "apps"]) {
    const groupDir = path.join(resolvedRoot, group);
    if (fs.existsSync(groupDir)) {
      try {
        const entries = fs.readdirSync(groupDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const pkgDir = path.join(groupDir, entry.name);
            if (fs.existsSync(path.join(pkgDir, "package.json"))) {
              dirs.push(pkgDir);
            }
          }
        }
      } catch { }
    }
  }

  return dirs;
};

/**
 * Checks whether a package.json file declares any dependencies or devDependencies.
 *
 * @param {string} pkgJsonPath
 * @returns {boolean}
 */
const hasDeclaredDependencies = (pkgJsonPath) => {
  try {
    if (!fs.existsSync(pkgJsonPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const depCount =
      Object.keys(pkg.dependencies || {}).length +
      Object.keys(pkg.devDependencies || {}).length +
      Object.keys(pkg.peerDependencies || {}).length;
    return depCount > 0;
  } catch {
    return false;
  }
};

/**
 * Checks whether a package.json file declares a specific packageName.
 *
 * @param {string} pkgJsonPath
 * @param {string} packageName
 * @returns {boolean}
 */
const declaresPackage = (pkgJsonPath, packageName) => {
  if (!packageName) return false;
  try {
    if (!fs.existsSync(pkgJsonPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    return Boolean(
      pkg.dependencies?.[packageName] ||
      pkg.devDependencies?.[packageName] ||
      pkg.peerDependencies?.[packageName]
    );
  } catch {
    return false;
  }
};

/**
 * Finds the closest directory containing package.json relative to importedFrom or rootDir,
 * including monorepo subpackage resolution when importedFrom is relative to a subpackage
 * (e.g. `src/utils/evaluator.ts` inside `<rootDir>/backend/src/utils/evaluator.ts`).
 *
 * @param {string} rootDir
 * @param {string|null} [importedFrom=null]
 * @param {string|null} [packageName=null]
 * @returns {string}
 */
export const findTargetPackageDir = (rootDir, importedFrom = null, packageName = null) => {
  const resolvedRoot = rootDir ? path.resolve(resolveSnapshotRootDir(rootDir) || rootDir) : null;
  if (!resolvedRoot) return rootDir;

  const subpackageDirs = listWorkspacePackageDirs(resolvedRoot).filter(
    (dir) => dir !== resolvedRoot
  );

  if (importedFrom) {
    // Strip container / temporary execution directory prefixes
    let cleanRel = String(importedFrom)
      .replace(/^.*?[\\/]\.covai-temp[\\/]collaboration-operations[\\/][^\\/]+[\\/]/i, "")
      .replace(/^.*?[\\/]storage[\\/]projects[\\/][^\\/]+[\\/]/i, "")
      .replace(/^.*?[\\/](?:app|workspace)[\\/]/i, "")
      .replace(/^[\\/]+/, "");

    const directCandidate = (path.isAbsolute(importedFrom) && fs.existsSync(importedFrom))
      ? importedFrom
      : path.join(resolvedRoot, cleanRel);

    let resolvedSourceFile = null;
    if (fs.existsSync(directCandidate)) {
      resolvedSourceFile = directCandidate;
    } else {
      // Search monorepo subpackages for `<subDir>/<cleanRel>`
      for (const subDir of subpackageDirs) {
        const subCandidate = path.join(subDir, cleanRel);
        if (fs.existsSync(subCandidate)) {
          resolvedSourceFile = subCandidate;
          break;
        }
        const subBase = path.basename(subDir);
        if (cleanRel.startsWith(subBase + "/") || cleanRel.startsWith(subBase + "\\")) {
          const strippedRel = cleanRel.substring(subBase.length + 1);
          const candidate2 = path.join(subDir, strippedRel);
          if (fs.existsSync(candidate2)) {
            resolvedSourceFile = candidate2;
            break;
          }
        }
      }
    }

    if (resolvedSourceFile) {
      let currentDir = path.dirname(resolvedSourceFile);
      while (
        currentDir &&
        !path.relative(resolvedRoot,currentDir).startsWith('..') &&
        currentDir !== path.dirname(resolvedRoot)
      ) {
        const pkgPath = path.join(currentDir, "package.json");
        if (fs.existsSync(pkgPath)) {
          return currentDir;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
      }
    }
  }

  // If packageName is provided and declared in one of the subpackages, return that subpackage
  if (packageName) {
    if (declaresPackage(path.join(resolvedRoot, "package.json"), packageName)) {
      return resolvedRoot;
    }
    for (const subDir of subpackageDirs) {
      if (declaresPackage(path.join(subDir, "package.json"), packageName)) {
        return subDir;
      }
    }
  }

  // Fallback walk-up if importedFrom was provided even if file doesn't exist yet
  if (importedFrom) {
    const cleanRel = String(importedFrom)
      .replace(/^.*?[\\/]\.covai-temp[\\/]collaboration-operations[\\/][^\\/]+[\\/]/i, "")
      .replace(/^.*?[\\/]storage[\\/]projects[\\/][^\\/]+[\\/]/i, "")
      .replace(/^.*?[\\/](?:app|workspace)[\\/]/i, "")
      .replace(/^[\\/]+/, "");

    for (const subDir of subpackageDirs) {
      const subBase = path.basename(subDir);
      if (cleanRel.startsWith(subBase + "/") || cleanRel.startsWith(subBase + "\\")) {
        return subDir;
      }
    }

    let currentDir = (path.isAbsolute(importedFrom) && fs.existsSync(importedFrom))
      ? path.dirname(importedFrom)
      : path.dirname(path.join(resolvedRoot, cleanRel));

    while (
      currentDir &&
      !path.relative(resolvedRoot,currentDir).startsWith('..') &&
      currentDir !== path.dirname(resolvedRoot)
    ) {
      const pkgPath = path.join(currentDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        return currentDir;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
  }

  // Use a package with dependencies only after resolving explicit target hints.
  if (!hasDeclaredDependencies(path.join(resolvedRoot, 'package.json'))) {
    const subWithDeps = subpackageDirs.find(dir => hasDeclaredDependencies(path.join(dir, 'package.json')));
    if (subWithDeps) return subWithDeps;
  }
  return resolvedRoot;
};

/**
 * Inspects the workspace environment to check whether a package is declared or installed.
 *
 * @param {Object} params
 * @param {string} params.rootDir
 * @param {string} params.packageName
 * @param {string|null} [params.importedFrom=null]
 * @returns {{ inPackageJson: boolean, inNodeModules: boolean, targetDir: string, suggestedCommand: string }}
 */
export const inspectWorkspaceDependency = ({ rootDir, packageName, importedFrom = null }) => {
  const targetDir = findTargetPackageDir(rootDir, importedFrom, packageName);
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
 * Links existing `node_modules` directories from `originalRootDir` (and its monorepo subpackages)
 * into `preparedRootDir` using OS directory junctions (Windows) or symlinks (Linux/macOS) so
 * isolated operation workspaces can resolve already-installed dependencies without copying GBs.
 *
 * @param {string} originalRootDir
 * @param {string} preparedRootDir
 * @returns {string[]} Array of created symlink/junction paths so caller can clean them up before publish
 */
export const ensureWorkspaceNodeModulesLinked = (originalRootDir, preparedRootDir) => {
  const createdLinks = [];
  if (!originalRootDir || !preparedRootDir) return createdLinks;

  const resolvedOrig = resolveProjectRoot(originalRootDir);
  const resolvedPrep = resolveProjectRoot(preparedRootDir);
  if (!resolvedOrig || !resolvedPrep || path.resolve(resolvedOrig) === path.resolve(resolvedPrep)) {
    return createdLinks;
  }

  const pkgDirs = listWorkspacePackageDirs(resolvedOrig);
  for (const origPkgDir of pkgDirs) {
    const relDir = path.relative(resolvedOrig, origPkgDir);
    const prepPkgDir = relDir ? path.join(resolvedPrep, relDir) : resolvedPrep;
    const origNm = path.join(origPkgDir, "node_modules");
    const prepNm = path.join(prepPkgDir, "node_modules");

    if (!fs.existsSync(origNm) || !fs.existsSync(prepPkgDir)) {
      continue;
    }

    let prepNmExists = false;
    let prepNmIsSymlink = false;
    try {
      const lstat = fs.lstatSync(prepNm);
      prepNmExists = true;
      prepNmIsSymlink = lstat.isSymbolicLink();
    } catch (_) {
      prepNmExists = false;
    }

    if (prepNmExists) {
      if (prepNmIsSymlink) {
        try {
          const target = fs.realpathSync(prepNm);
          if (path.resolve(target) === path.resolve(origNm)) {
            continue; // Already correctly linked
          }
          fs.unlinkSync(prepNm);
        } catch (_) {
          try { fs.unlinkSync(prepNm); } catch { }
        }
      } else {
        // prepNm is a directory. Check if it's empty or only contains transient cache (.vite, .cache, .bin)
        let entries = [];
        try { entries = fs.readdirSync(prepNm); } catch { }
        const isOnlyCacheOrEmpty = entries.length === 0 || entries.every(e => [".vite", ".cache", ".bin"].includes(e));
        if (isOnlyCacheOrEmpty) {
          try {
            fs.rmSync(prepNm, { recursive: true, force: true });
          } catch (rmErr) {
            console.warn(`[ensureWorkspaceNodeModulesLinked] Could not remove cache dir ${prepNm}:`, rmErr.message);
          }
        } else {
          // prepNm has real contents; link missing individual packages from origNm into prepNm
          try {
            const origEntries = fs.readdirSync(origNm, { withFileTypes: true });
            for (const oe of origEntries) {
              const origItem = path.join(origNm, oe.name);
              const prepItem = path.join(prepNm, oe.name);
              if (!fs.existsSync(prepItem)) {
                try {
                  fs.symlinkSync(
                    origItem,
                    prepItem,
                    process.platform === "win32" ? "junction" : "dir"
                  );
                  createdLinks.push(prepItem);
                } catch (_) { }
              }
            }
          } catch (_) { }
          continue;
        }
      }
    }

    // Create fresh symlink/junction from origNm to prepNm
    try {
      fs.symlinkSync(
        origNm,
        prepNm,
        process.platform === "win32" ? "junction" : "dir"
      );
      createdLinks.push(prepNm);
    } catch (err) {
      console.warn(`[ensureWorkspaceNodeModulesLinked] Could not link ${origNm} -> ${prepNm}:`, err.message);
    }
  }

  return createdLinks;
};

/**
 * Removes temporary `node_modules` symlinks/junctions created by `ensureWorkspaceNodeModulesLinked`.
 *
 * @param {string[]} linkPaths
 */
export const cleanupWorkspaceNodeModulesLinks = (linkPaths = []) => {
  if (!Array.isArray(linkPaths)) return;
  for (const linkPath of linkPaths) {
    try {
      if (linkPath) {
        let isSym = false;
        try {
          const stat = fs.lstatSync(linkPath);
          isSym = stat.isSymbolicLink();
        } catch (_) { }
        if (isSym) {
          fs.unlinkSync(linkPath);
        }
      }
    } catch { }
  }
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
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, targetDir: string, timedOut?: boolean }>}
 */
export const installPackageInWorkspace = async ({
  rootDir,
  packageName,
  isDev = false,
  importedFrom = null,
  jobId = null,
  cacheDir = null,
  version = null,
}) => {
  if (!isValidNpmPackageName(packageName)) {
    throw new ServiceError(`Invalid or unsafe npm package name: '${packageName}'`, 400);
  }
  packageName = packageName.trim();
  if (version !== null && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new ServiceError('An exact package version is required for runtime alignment',400);

  const effectiveRootDir = rootDir ? path.resolve(resolveSnapshotRootDir(rootDir) || rootDir) : null;
  if (!effectiveRootDir || !fs.existsSync(effectiveRootDir)) {
    throw new ServiceError(`Invalid project root directory: ${rootDir}`, 404);
  }
  const rootRelative = path.relative(path.resolve(rootDir),path.resolve(effectiveRootDir));
  if (rootRelative.startsWith('..') || path.isAbsolute(rootRelative)) throw new ServiceError('Dependency installation requires a package manifest inside the operation workspace',409);

  const targetDir = findTargetPackageDir(effectiveRootDir, importedFrom, packageName);
  const targetRelative = path.relative(path.resolve(effectiveRootDir),path.resolve(targetDir));
  if (targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) throw new ServiceError('Dependency target escapes the operation workspace',400);

  // Detect package manager (npm, pnpm, yarn, bun)
  let pkgManager = "npm";
  let packageManifest = {};
  const pkgJsonPath = path.join(targetDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) throw new ServiceError('Select a project package directory containing package.json before installing dependencies',409);
  const realRelative = path.relative(fs.realpathSync(effectiveRootDir),fs.realpathSync(targetDir));
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new ServiceError('Dependency target resolves outside the project workspace',400);
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      packageManifest = parsed;
      if (typeof parsed.packageManager === "string") {
        if (parsed.packageManager.startsWith("pnpm")) pkgManager = "pnpm";
        else if (parsed.packageManager.startsWith("yarn")) pkgManager = "yarn";
        else if (parsed.packageManager.startsWith("bun")) pkgManager = "bun";
      }
    } catch (_) { }
  }
  if (pkgManager === "npm") {
    if (fs.existsSync(path.join(targetDir, "pnpm-lock.yaml")) || fs.existsSync(path.join(effectiveRootDir, "pnpm-lock.yaml"))) {
      pkgManager = "pnpm";
    } else if (fs.existsSync(path.join(targetDir, "yarn.lock")) || fs.existsSync(path.join(effectiveRootDir, "yarn.lock"))) {
      pkgManager = "yarn";
    } else if (fs.existsSync(path.join(targetDir, "bun.lockb")) || fs.existsSync(path.join(targetDir, "bun.lock")) || fs.existsSync(path.join(effectiveRootDir, "bun.lockb"))) {
      pkgManager = "bun";
    }
  }

  let command;
  let installSpecifier = version ? `${packageName}@${version}` : packageName;
  if (!version && /^@vitest\/coverage-(?:v8|istanbul)$/.test(packageName)) {
    try {
      const runnerVersion = JSON.parse(fs.readFileSync(path.join(targetDir,'node_modules','vitest','package.json'),'utf8')).version;
      if (/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(runnerVersion)) installSpecifier = `${packageName}@${runnerVersion}`;
    } catch { /* Restore a declared version when an installed runner is absent. */ }
  }
  const declared = !version && Boolean(packageManifest.dependencies?.[packageName] || packageManifest.devDependencies?.[packageName]);
  const managerRoot = [targetDir,effectiveRootDir].find(directory => ['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb'].some(file => fs.existsSync(path.join(directory,file)))) || targetDir;
  const installDirectory = declared ? managerRoot : targetDir;
  if (declared) {
    if (pkgManager === 'pnpm') command = 'pnpm install --frozen-lockfile';
    else if (pkgManager === 'yarn') command = /^yarn@[234]/.test(packageManifest.packageManager || '') ? 'yarn install --immutable' : 'yarn install --frozen-lockfile';
    else if (pkgManager === 'bun') command = 'bun install --frozen-lockfile';
    else command = `npm ${fs.existsSync(path.join(managerRoot,'package-lock.json')) ? 'ci' : 'install'} --no-audit --no-fund --progress=false`;
  } else if (pkgManager === "pnpm") {
    command = `pnpm add ${isDev ? "-D" : ""} ${installSpecifier}${version ? ' --save-exact' : ''}`;
  } else if (pkgManager === "yarn") {
    command = `yarn add ${isDev ? "-D" : ""} ${installSpecifier}${version ? ' --exact' : ''}`;
  } else if (pkgManager === "bun") {
    command = `bun add ${isDev ? "-d" : ""} ${installSpecifier}${version ? ' --exact' : ''}`;
  } else {
    const saveFlag = isDev ? "--save-dev" : "--save";
    command = `npm install ${saveFlag} ${installSpecifier}${version ? ' --save-exact' : ''} --prefer-offline --prefer-cached --no-audit --no-fund --progress=false --maxsockets=4`;
  }

  // A prepared workspace may borrow dependencies through directory junctions.
  // Installation must never write through those junctions into its origin.
  for (const directory of new Set([effectiveRootDir,targetDir,installDirectory])) {
    const modules = path.join(directory,'node_modules');
    if (!fs.existsSync(modules)) continue;
    if (fs.lstatSync(modules).isSymbolicLink()) { fs.unlinkSync(modules); continue; }
    for (const entry of fs.readdirSync(modules,{withFileTypes:true})) {
      const target = path.join(modules,entry.name);
      if (entry.isSymbolicLink()) fs.unlinkSync(target);
      else if (entry.name.startsWith('@') && entry.isDirectory()) {
        for (const child of fs.readdirSync(target,{withFileTypes:true})) if(child.isSymbolicLink())fs.unlinkSync(path.join(target,child.name));
      }
    }
  }
  const timeoutMs = DEPENDENCY_INSTALL_TIMEOUT_MS;

  let execResult;
  try {
    execResult = await dockerRunner.run({
      snapshotPath: installDirectory,
      command,
      hostCommand: resolvePackageManagerHostCommand(command),
      timeoutMs,
      jobId,
      inheritEnv: false,
      loadEnvExamples: false,
      env: cacheDir ? { NPM_CONFIG_CACHE: cacheDir } : {},
    });
  } catch (err) {
    console.warn(`[installPackageInWorkspace] Package installation failed for '${packageName}':`, err.message);
    execResult = {
      success: false,
      stdout: "",
      stderr: err.message || `Timed out after ${Math.round(timeoutMs / 1000)}s`,
      exitCode: err.statusCode === 408 || /timed?\s*out|ETIMEDOUT/i.test(err.message || '') ? 408 : 1,
      timedOut: err.statusCode === 408 || /timed?\s*out|ETIMEDOUT/i.test(err.message || ''),
    };
  }

  // The caller supplies an isolated workspace. Declared packages retain their
  // lockfile versions; newly added packages are reviewed with the test batch.

  const installed = [targetDir,installDirectory,effectiveRootDir].some(directory => {
    try { const pkg=JSON.parse(fs.readFileSync(path.join(directory,'node_modules',packageName,'package.json'),'utf8'));return pkg.name === packageName && (!version || pkg.version === version); }
    catch { return false; }
  }) || (pkgManager === 'yarn' && fs.existsSync(path.join(installDirectory,'.pnp.cjs')));
  const verified = Boolean(execResult.success && installed);
  return {
    success: verified,
    stdout: execResult.stdout || "",
    stderr: execResult.stderr || (execResult.success && !installed ? `The package manager exited successfully, but '${packageName}' was not found in the target workspace.` : ""),
    targetDir,
    exitCode: execResult.exitCode,
    timedOut: Boolean(execResult.timedOut),
    timeoutMs,
    packageManager: pkgManager,
    verified,
  };
};
