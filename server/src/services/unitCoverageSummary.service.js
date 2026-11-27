import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { cleanStoragePath, canonicalizeFilePath } from "../utils/pathSanitizer.js";
import {
  isBusinessLogicSourceFile,
  extractProjectCoverageExclusions,
} from "../utils/businessLogicFileDetector.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { getPeakUnitReport } from "./unitReport.service.js";
import { extractFunctions } from "./cyclomaticFunctionExtractor.service.js";

/**
 * Resolve a coverage file path to a canonical project-relative path.
 */
export const resolveProjectRelativePath = (p, rootDir = "") => {
  if (!p || typeof p !== "string") return "";
  let clean = cleanStoragePath(p) || p;
  clean = clean
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();

  if (rootDir) {
    const normRoot = rootDir
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/\/+$/, "");
    if (clean.toLowerCase().startsWith(normRoot.toLowerCase() + "/")) {
      clean = clean.slice(normRoot.length + 1).replace(/^\/+/, "");
    }
    try {
      if (fs.existsSync(path.join(rootDir, clean))) {
        return clean;
      }
      const candidatePrefixes = [
        "server",
        "backend",
        "client",
        "frontend",
        "services",
        "src",
        "app",
        "api",
      ];
      for (const prefix of candidatePrefixes) {
        if (
          !clean.startsWith(prefix + "/") &&
          fs.existsSync(path.join(rootDir, prefix, clean))
        ) {
          return `${prefix}/${clean}`;
        }
      }
    } catch (_) {}
  }
  const canon = canonicalizeFilePath(clean, rootDir);
  return canon || clean;
};

/**
 * Normalize path for deduplication across subproject prefixes.
 */
export const getNormalizedMatchKey = (p = "") => {
  return (p || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^(?:server|backend|client|frontend|app|api)\//i, "")
    .toLowerCase();
};

/**
 * Resolve snapshot rootDir across container (/app) and host paths.
 */
export const resolveSnapshotRootDir = (rootDir) => {
  if (!rootDir) return null;
  let candidate = rootDir;
  if (!fs.existsSync(rootDir)) {
    const normalized = String(rootDir).replace(/\\/g, "/");
    if (normalized.startsWith("/app/")) {
      const hostCandidate = path.resolve(
        process.cwd(),
        normalized.replace(/^\/app\//, ""),
      );
      if (fs.existsSync(hostCandidate)) candidate = hostCandidate;
    } else {
      const storageMatch = normalized.match(
        /(?:^|\/)((?:storage|uploads)\/.+)$/i,
      );
      if (storageMatch) {
        const subPath = storageMatch[1];
        const containerCandidate = path.posix.join("/app", subPath);
        if (fs.existsSync(containerCandidate)) candidate = containerCandidate;
        else {
          const hostCandidate = path.resolve(process.cwd(), subPath);
          if (fs.existsSync(hostCandidate)) candidate = hostCandidate;
        }
      }
    }
  }
  const resolved =
    typeof resolveProjectRoot === "function"
      ? resolveProjectRoot(candidate)
      : candidate;
  return resolved || candidate;
};

/**
 * Locate unit-namespaced coverage artifacts on disk.
 */
export const findUnitCoverageArtifacts = (rootDir) => {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return { summaryPath: null, finalPath: null };
  }
  const summaryCandidates = [
    path.join(rootDir, "coverage", "unit", "coverage-summary.json"),
    path.join(rootDir, "coverage", "jest-coverage-summary.json"),
    path.join(rootDir, "coverage", "vitest-coverage-summary.json"),
    path.join(rootDir, "coverage", "unit", "jest-coverage-summary.json"),
    path.join(rootDir, "coverage", "unit", "vitest-coverage-summary.json"),
  ];
  const finalCandidates = [
    path.join(rootDir, "coverage", "unit", "coverage-final.json"),
    path.join(rootDir, "coverage", "jest-coverage-final.json"),
    path.join(rootDir, "coverage", "vitest-coverage-final.json"),
  ];
  return {
    summaryPath: summaryCandidates.find((p) => fs.existsSync(p)) || null,
    finalPath: finalCandidates.find((p) => fs.existsSync(p)) || null,
  };
};

/**
 * Determine whether any unit test or coverage execution evidence exists.
 */
export const hasUnitExecutionEvidence = async (snapshotId, rootDir) => {
  const artifacts = findUnitCoverageArtifacts(rootDir);
  if (artifacts.summaryPath || artifacts.finalPath) return true;
  if (rootDir && findBestUnitCoverageSummary(rootDir)) return true;
  if (snapshotId && prisma?.testRun?.findFirst) {
    const unitRun = await prisma.testRun
      .findFirst({
        where: { snapshotId, type: { in: ["JEST", "VITEST"] } },
        select: { id: true },
      })
      .catch(() => null);
    if (unitRun) return true;
  }
  if (snapshotId && prisma?.job?.findFirst) {
    const unitJob = await prisma.job
      .findFirst({
        where: {
          snapshotId,
          type: { in: ["RUN_TESTS", "VITEST_COVERAGE"] },
          status: "SUCCESS",
        },
        select: { id: true },
      })
      .catch(() => null);
    if (unitJob) return true;
  }
  return false;
};

/**
 * Find the best unit coverage-summary.json on disk (preferring non-zero & newest mtimeMs).
 */
export const findBestUnitCoverageSummary = (resolvedRootDir) => {
  if (!resolvedRootDir || !fs.existsSync(resolvedRootDir)) return null;

  const candidateSummaryFiles = [
    path.join(resolvedRootDir, "coverage", "unit", "coverage-summary.json"),
    path.join(resolvedRootDir, "coverage", "unit", "jest-coverage-summary.json"),
    path.join(resolvedRootDir, "coverage", "unit", "vitest-coverage-summary.json"),
    path.join(resolvedRootDir, "coverage", "jest-coverage-summary.json"),
    path.join(resolvedRootDir, "coverage", "vitest-coverage-summary.json"),
    path.join(resolvedRootDir, "server", "coverage", "unit", "coverage-summary.json"),
    path.join(resolvedRootDir, "client", "coverage", "unit", "coverage-summary.json"),
    path.join(resolvedRootDir, "backend", "coverage", "unit", "coverage-summary.json"),
  ];

  try {
    const subEntries = fs.readdirSync(resolvedRootDir, { withFileTypes: true });
    for (const entry of subEntries) {
      if (
        entry.isDirectory() &&
        !["node_modules", ".git", "dist", ".gemini", "storage", "coverage"].includes(
          entry.name,
        )
      ) {
        candidateSummaryFiles.push(
          path.join(
            resolvedRootDir,
            entry.name,
            "coverage",
            "unit",
            "coverage-summary.json",
          ),
        );
      }
    }
  } catch (_) {}

  let bestSummary = null;
  let bestSummaryPath = null;
  let bestSummaryMtime = 0;
  let bestHasNonZero = false;

  for (const summaryFile of candidateSummaryFiles) {
    if (!fs.existsSync(summaryFile)) continue;
    try {
      const stat = fs.statSync(summaryFile);
      const parsed = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
      if (parsed && typeof parsed === "object") {
        const hasNonZero =
          (parsed.total?.lines?.pct || 0) > 0 ||
          (parsed.total?.statements?.pct || 0) > 0 ||
          Object.values(parsed).some(
            (v) =>
              v !== parsed.total &&
              typeof v === "object" &&
              ((v.lines?.pct || 0) > 0 || (v.statements?.pct || 0) > 0),
          );
        if (
          !bestSummary ||
          (hasNonZero && !bestHasNonZero) ||
          (hasNonZero === bestHasNonZero && stat.mtimeMs > bestSummaryMtime)
        ) {
          bestSummary = parsed;
          bestSummaryPath = summaryFile;
          bestSummaryMtime = stat.mtimeMs;
          bestHasNonZero = hasNonZero;
        }
      }
    } catch (_) {}
  }

  if (!bestSummary) return null;
  return {
    raw: bestSummary,
    summaryPath: bestSummaryPath,
    mtimeMs: bestSummaryMtime,
  };
};

/**
 * Extract path-matched threshold exceptions from Jest coverageThreshold config.
 */
export const extractThresholdExceptions = async (
  resolvedRootDir,
  jestConfigPath = null,
) => {
  const thresholdExceptions = new Set();
  if (!resolvedRootDir) return thresholdExceptions;
  try {
    const { readProjectJestConfig } = await import("./runTestsJob.service.js");
    const projectJestConfig = await readProjectJestConfig(
      resolvedRootDir,
      jestConfigPath,
    );
    const coverageThreshold = projectJestConfig?.coverageThreshold;
    if (coverageThreshold && typeof coverageThreshold === "object") {
      for (const pattern of Object.keys(coverageThreshold)) {
        if (pattern === "global") continue;
        const normPattern = pattern
          .replace(/^\.\//, "")
          .replace(/\\/g, "/")
          .toLowerCase();
        if (normPattern) thresholdExceptions.add(normPattern);
      }
    }
  } catch (_) {}
  return thresholdExceptions;
};

/**
 * Composite unit coverage score matching UnitTestWorkspace.jsx & unitReport.service.js.
 */
export const computeCompositeCoverageScore = (cov = {}) =>
  Number(cov?.lines || 0) * 0.4 +
  Number(cov?.branches || 0) * 0.25 +
  Number(cov?.functions || 0) * 0.2 +
  Number(cov?.statements || 0) * 0.15;

const matchesThresholdException = (can, exceptions) => {
  if (!exceptions || exceptions.size === 0) return false;
  const norm = String(can || "")
    .replace(/\\/g, "/")
    .toLowerCase();
  for (const exc of exceptions) {
    if (exc && (norm === exc || norm.endsWith(exc))) {
      return true;
    }
  }
  return false;
};

/**
 * Canonical filtered unit coverage calculator shared by coverage.controller.js and unifiedQualityDashboard.service.js.
 */
export const computeFilteredUnitCoverageFromRaw = async (
  raw,
  {
    resolvedRootDir = "",
    configExclusions = null,
    thresholdExceptions = null,
    includeUncoveredLogicFiles = true,
  } = {},
) => {
  if (!raw || typeof raw !== "object") return null;

  const exclusions =
    configExclusions ??
    (resolvedRootDir ? extractProjectCoverageExclusions(resolvedRootDir) : []);
  const exceptions = thresholdExceptions ?? new Set();

  const canonicalMap = new Map();
  const canonicalByMatchKey = new Map();

  for (const [filePath, data] of Object.entries(raw)) {
    if (filePath === "total" || !data) continue;
    const can =
      resolveProjectRelativePath(filePath, resolvedRootDir) || filePath;
    if (
      isBusinessLogicSourceFile(can, exclusions) &&
      !matchesThresholdException(can, exceptions)
    ) {
      const matchKey = getNormalizedMatchKey(can);
      const existingKey = canonicalMap.has(can)
        ? can
        : canonicalByMatchKey.get(matchKey) || null;
      if (
        !existingKey ||
        (canonicalMap.get(existingKey).statements?.total || 0) <
          (data.statements?.total || 0)
      ) {
        if (existingKey && existingKey !== can) {
          canonicalMap.delete(existingKey);
        }
        canonicalMap.set(can, data);
        canonicalByMatchKey.set(matchKey, can);
      }
    }
  }

  if (
    includeUncoveredLogicFiles &&
    resolvedRootDir &&
    fs.existsSync(resolvedRootDir)
  ) {
    try {
      const { findLogicSourceFiles, extractBranches } = await import(
        "./runTestsJob.service.js"
      );
      const logicFiles = findLogicSourceFiles(resolvedRootDir);
      for (const lf of logicFiles) {
        const can =
          resolveProjectRelativePath(lf.relativePath, resolvedRootDir) ||
          lf.relativePath;
        if (
          matchesThresholdException(can, exceptions) ||
          !isBusinessLogicSourceFile(can, exclusions)
        ) {
          continue;
        }

        const matchKey = getNormalizedMatchKey(can);
        const existingKey = canonicalMap.has(can)
          ? can
          : canonicalByMatchKey.get(matchKey) || null;

        if (!existingKey) {
          let content = "";
          try {
            content = fs.readFileSync(lf.absolutePath, "utf8");
          } catch (_) {}
          const codeLines = content.split("\n");
          const totalLines = Math.max(1, codeLines.length);
          let funcs = [];
          try {
            funcs = extractFunctions(content) || [];
          } catch (_) {
            funcs = [];
          }
          let branchList = [];
          try {
            branchList = extractBranches(content) || [];
          } catch (_) {
            branchList = [];
          }

          canonicalMap.set(can, {
            lines: { total: totalLines, covered: 0, skipped: 0, pct: 0 },
            statements: { total: totalLines, covered: 0, skipped: 0, pct: 0 },
            functions: { total: funcs.length, covered: 0, skipped: 0, pct: 0 },
            branches: {
              total: branchList.reduce(
                (s, b) => s + (b.locations?.length || 1),
                0,
              ),
              covered: 0,
              skipped: 0,
              pct: 0,
            },
          });
          canonicalByMatchKey.set(matchKey, can);
        } else if (existingKey !== can) {
          const existingData = canonicalMap.get(existingKey);
          canonicalMap.delete(existingKey);
          canonicalMap.set(can, existingData);
          canonicalByMatchKey.set(matchKey, can);
        }
      }
    } catch (_) {}
  }

  const unitFileEntries = Array.from(canonicalMap.entries());

  if (unitFileEntries.length > 0) {
    let stmtsCovered = 0;
    let stmtsTotal = 0;
    let branchesCovered = 0;
    let branchesTotal = 0;
    let funcsCovered = 0;
    let funcsTotal = 0;
    let linesCovered = 0;
    let linesTotal = 0;

    const files = [];
    const filteredSummaryMap = {};

    for (const [can, data] of unitFileEntries) {
      const fStmtsCovered = Number(data.statements?.covered || 0);
      const fStmtsTotal = Number(data.statements?.total || 0);
      const fBranchesCovered = Number(data.branches?.covered || 0);
      const fBranchesTotal = Number(data.branches?.total || 0);
      const fFuncsCovered = Number(data.functions?.covered || 0);
      const fFuncsTotal = Number(data.functions?.total || 0);
      const fLinesCovered = Number(data.lines?.covered || 0);
      const fLinesTotal = Number(data.lines?.total || 0);

      stmtsCovered += fStmtsCovered;
      stmtsTotal += fStmtsTotal;
      branchesCovered += fBranchesCovered;
      branchesTotal += fBranchesTotal;
      funcsCovered += fFuncsCovered;
      funcsTotal += fFuncsTotal;
      linesCovered += fLinesCovered;
      linesTotal += fLinesTotal;

      const fLinesPct =
        fLinesTotal > 0
          ? Number(((fLinesCovered / fLinesTotal) * 100).toFixed(1))
          : Number(Number(data.lines?.pct ?? 0).toFixed(1));
      const fStmtsPct =
        fStmtsTotal > 0
          ? Number(((fStmtsCovered / fStmtsTotal) * 100).toFixed(1))
          : Number(Number(data.statements?.pct ?? 0).toFixed(1));
      const fFuncsPct =
        fFuncsTotal > 0
          ? Number(((fFuncsCovered / fFuncsTotal) * 100).toFixed(1))
          : fLinesCovered > 0 && fLinesPct === 100
            ? 100
            : Number(Number(data.functions?.pct ?? 0).toFixed(1));
      const fBranchesPct =
        fBranchesTotal > 0
          ? Number(((fBranchesCovered / fBranchesTotal) * 100).toFixed(1))
          : fLinesCovered > 0 && fLinesPct === 100
            ? 100
            : Number(Number(data.branches?.pct ?? 0).toFixed(1));

      files.push({
        filePath: can,
        linesPct: fLinesPct,
        branchesPct: fBranchesPct,
        funcsPct: fFuncsPct,
        stmtsPct: fStmtsPct,
        linesTotal: fLinesTotal,
        linesCovered: fLinesCovered,
        branchesTotal: fBranchesTotal,
        branchesCovered: fBranchesCovered,
        funcsTotal: fFuncsTotal,
        funcsCovered: fFuncsCovered,
        stmtsTotal: fStmtsTotal,
        stmtsCovered: fStmtsCovered,
      });

      filteredSummaryMap[can] = data;
    }

    const stmtsPct =
      stmtsTotal > 0
        ? Number(((stmtsCovered / stmtsTotal) * 100).toFixed(1))
        : 0;
    const linesPct =
      linesTotal > 0
        ? Number(((linesCovered / linesTotal) * 100).toFixed(1))
        : 0;
    const funcsPct =
      funcsTotal > 0
        ? Number(((funcsCovered / funcsTotal) * 100).toFixed(1))
        : 0;
    const branchesPct =
      branchesTotal > 0
        ? Number(((branchesCovered / branchesTotal) * 100).toFixed(1))
        : linesCovered > 0 && linesPct === 100
          ? 100
          : 0;

    const rawTotals = {
      statements: { total: stmtsTotal, covered: stmtsCovered, pct: stmtsPct },
      branches: { total: branchesTotal, covered: branchesCovered, pct: branchesPct },
      functions: { total: funcsTotal, covered: funcsCovered, pct: funcsPct },
      lines: { total: linesTotal, covered: linesCovered, pct: linesPct },
    };

    filteredSummaryMap.total = rawTotals;

    const coverage = {
      statements: stmtsPct,
      branches: branchesPct,
      functions: funcsPct,
      lines: linesPct,
    };

    return {
      coverage,
      rawTotals,
      files,
      filteredSummaryMap,
    };
  }

  if (raw.total) {
    let rawBranchesPct = raw.total.branches?.pct ?? 0;
    if (
      (raw.total.branches?.covered === 0 ||
        raw.total.branches?.total === 0) &&
      (raw.total.statements?.pct === 0 ||
        raw.total.lines?.pct === 0 ||
        (raw.total.lines?.covered || 0) === 0)
    ) {
      rawBranchesPct = 0;
    }
    const rawTotals = {
      statements: raw.total.statements || null,
      branches: raw.total.branches
        ? { ...raw.total.branches, pct: rawBranchesPct }
        : null,
      functions: raw.total.functions || null,
      lines: raw.total.lines || null,
    };
    const coverage = {
      statements: Number(Number(raw.total.statements?.pct ?? 0).toFixed(1)),
      branches: Number(Number(rawBranchesPct ?? 0).toFixed(1)),
      functions: Number(Number(raw.total.functions?.pct ?? 0).toFixed(1)),
      lines: Number(Number(raw.total.lines?.pct ?? 0).toFixed(1)),
    };
    return {
      coverage,
      rawTotals,
      files: [],
      filteredSummaryMap: { total: rawTotals },
    };
  }

  return null;
};

const toFixed1 = (v, fallback = 0) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(1)) : fallback;
};

/**
 * Resolve canonical unit coverage matching live UnitTestWorkspace priority:
 * 1. Filtered disk coverage-summary.json (unless peakReport has higher composite score)
 * 2. peakUnitReport
 * 3. DB fallback (CoverageSummary -> TestRun -> averaged unitFiles)
 * 4. None (0%)
 */
export const resolveCanonicalUnitCoverage = async ({
  snapshotId = null,
  rootDir = "",
  jestConfigPath = null,
  unitSummaryRecord = null,
  latestUnitRun = null,
  unitFiles = [],
  hasUnitEvidence = null,
} = {}) => {
  const resolvedRootDir = resolveSnapshotRootDir(rootDir) || rootDir || "";
  const evidence =
    hasUnitEvidence !== null
      ? Boolean(hasUnitEvidence)
      : await hasUnitExecutionEvidence(snapshotId, resolvedRootDir);

  const configExclusions = resolvedRootDir
    ? extractProjectCoverageExclusions(resolvedRootDir)
    : [];

  let liveResult = null;
  if (resolvedRootDir && evidence) {
    const best = findBestUnitCoverageSummary(resolvedRootDir);
    if (best?.raw) {
      const thresholdExceptions = await extractThresholdExceptions(
        resolvedRootDir,
        jestConfigPath,
      );
      liveResult = await computeFilteredUnitCoverageFromRaw(best.raw, {
        resolvedRootDir,
        configExclusions,
        thresholdExceptions,
        includeUncoveredLogicFiles: true,
      });
    }
  }

  const liveScore = liveResult
    ? computeCompositeCoverageScore(liveResult.coverage)
    : -1;

  const peakUnitReport = snapshotId
    ? await getPeakUnitReport(snapshotId)
    : null;
  const peakCov = peakUnitReport
    ? {
        lines: toFixed1(
          peakUnitReport.coverageSummary?.lines ??
            peakUnitReport.peakMeta?.linesPct,
          0,
        ),
        branches: toFixed1(
          peakUnitReport.coverageSummary?.branches ??
            peakUnitReport.peakMeta?.branchesPct,
          0,
        ),
        functions: toFixed1(
          peakUnitReport.coverageSummary?.functions ??
            peakUnitReport.peakMeta?.funcsPct,
          0,
        ),
        statements: toFixed1(
          peakUnitReport.coverageSummary?.statements ??
            peakUnitReport.peakMeta?.stmtsPct,
          0,
        ),
      }
    : null;
  const peakScore = peakCov ? computeCompositeCoverageScore(peakCov) : -1;

  if (peakUnitReport && peakScore > 0 && (!liveResult || peakScore > liveScore)) {
    const filteredPeakFiles = Array.isArray(peakUnitReport.fileCoverages)
      ? peakUnitReport.fileCoverages.filter((f) =>
          f?.filePath
            ? isBusinessLogicSourceFile(f.filePath, configExclusions)
            : false,
        )
      : [];
    return {
      coverage: peakCov,
      rawTotals: peakUnitReport.rawTotals || null,
      files: filteredPeakFiles,
      peakReport: peakUnitReport,
      coverageSource: "peak-report",
    };
  }

  if (liveResult) {
    return {
      ...liveResult,
      peakReport: peakUnitReport || null,
      coverageSource: "filtered-summary",
    };
  }

  const hasRunTests = Number(latestUnitRun?.totalTests || 0) > 0;
  if (evidence || hasRunTests) {
    const avgFromFiles = (getter) =>
      unitFiles.length > 0
        ? toFixed1(
            unitFiles.reduce((acc, f) => acc + Number(getter(f) ?? 0), 0) /
              unitFiles.length,
            0,
          )
        : null;

    const linesVal =
      unitSummaryRecord?.linesPct ??
      latestUnitRun?.coverageLinesPct ??
      avgFromFiles((f) => f.linesPct);
    const branchesVal =
      unitSummaryRecord?.branchesPct ??
      latestUnitRun?.coverageBranchesPct ??
      avgFromFiles((f) => f.branchesPct);
    const funcsVal =
      unitSummaryRecord?.funcsPct ??
      unitSummaryRecord?.functionsPct ??
      latestUnitRun?.coverageFunctionsPct ??
      avgFromFiles((f) => f.funcsPct ?? f.functionsPct);
    const stmtsVal =
      unitSummaryRecord?.stmtsPct ??
      unitSummaryRecord?.statementsPct ??
      latestUnitRun?.coverageStatementsPct ??
      avgFromFiles((f) => f.stmtsPct ?? f.statementsPct);

    if (
      linesVal != null ||
      branchesVal != null ||
      funcsVal != null ||
      stmtsVal != null
    ) {
      return {
        coverage: {
          lines: toFixed1(linesVal, 0),
          branches: toFixed1(branchesVal, 0),
          functions: toFixed1(funcsVal, 0),
          statements: toFixed1(stmtsVal, 0),
        },
        rawTotals: null,
        files: [],
        peakReport: null,
        coverageSource: "db-summary",
      };
    }
  }

  return {
    coverage: { lines: 0, branches: 0, functions: 0, statements: 0 },
    rawTotals: null,
    files: [],
    peakReport: null,
    coverageSource: "none",
  };
};
