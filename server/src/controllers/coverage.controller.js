import { requireFullStackMode } from "../services/systemExecutionPolicy.service.js";
import { withPreparedProjectWorkspace } from "../services/projectWorkspacePreparation.service.js";
import { stagePreparedPublication } from "../services/projectOperationWorkspace.service.js";
import {
  membershipWhere,
  resolveProjectAccess,
  resolveSnapshotAccess,
  withProjectGuard,
} from "../services/projectAccess.service.js";
import { readVersionedProjectFile } from "../services/projectFileVersion.service.js";
import { mutateProjectWorkspace } from "../services/projectMutation.service.js";
import { snapshotWorkspaceRoot } from "../utils/snapshotWorkspace.js";
import { requestedAiModel } from "../utils/selectedAiModel.js";
import { scheduleUnitTestPostApplyAnalysis } from "../services/unitTestPostApplyAnalysis.service.js";
import { resolveSystemScreenshot } from "../services/systemScreenshotPath.service.js";
import { coverageSummaryFor } from "../services/systemAssessmentContract.service.js";
import { collectExternalRequirements } from "../services/externalDependencyClassifier.service.js";
import { deriveRunStatusNotices } from "../services/testResultParser.service.js";
import { parseSystemTestResultQuery } from "../validators/systemTestResultQuery.validator.js";
import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import {
  createSnapshotJob,
  createInstallDepsJob,
  createRunTestsJob,
  createSupertestCoverageJob,
  createVitestCoverageJob,
  createSystemTestAnalysisJob,
} from "../services/job.service.js";

async function enqueueUnitTestJob({
  projectId,
  snapshotId,
  userId,
  type,
  payloadJson,
}) {
  const existingJob = await prisma.job.findFirst({
    where: {
      projectId,
      snapshotId,
      type,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existingJob) {
    return { queued: true, reused: true, job: existingJob };
  }

  const job = await createSnapshotJob({
    projectId,
    snapshotId,
    userId,
    type,
    payloadJson,
  });
  await addJobToQueue(type, job.id, { projectId, snapshotId });
  return { queued: true, reused: false, job };
}
const STALE_JOB_TIMEOUT_MS = 25 * 60 * 1000;
import {
  jobQueue,
  addJobToQueue,
  addSupertestCoveragePipeline,
} from "../services/queue.service.js";
import { processCoverageJob } from "../services/coverageRunner.service.js";
import { detectSupertest } from "../services/supertestDetection.service.js";
import {
  detectIntegrationFrameworks,
  installIntegrationDependencies,
} from "../services/integrationDetection.service.js";
import {
  detectCoverageFrameworks,
  selectCoverageFramework,
} from "../services/coverageFramework.service.js";
import {
  buildIntegrationWorkspace,
  getIntegrationHistoryService,
  invalidateEndpointCache,
} from "../services/integrationWorkspace.service.js";
import {
  getIntegrationVersionHistoryService,
  compareVersionsService,
  getHistoricalWorkspaceVersionService,
} from "../services/integrationVersionHistory.service.js";
import {
  getBeforeAfterComparisonService,
  getSourceFileDiffService,
} from "../services/comparison.service.js";

import { getFileCoverageDetails } from "../services/fileCoverage.service.js";
import { suggestUnitTestcases } from "../services/unitTestSuggestion.service.js";
import { applyUnitTestSuggestion } from "../services/applyTestSuggestion.service.js";
import {
  getCommittedUnitTestVersions,
  switchUnitTestVersion,
} from "../services/unitTestVersion.service.js";
import {
  detectProjectEnvironment,
  saveWorkspaceEnv,
} from "../services/environmentDetection.service.js";
import {
  captureUnitTestTrace,
  findRecordedUnitTestTrace,
} from "../services/unitTestRuntimeTrace.service.js";
import {
  getAvailableSimulationSources,
  generateSimulationTrace,
} from "../services/unitTestSimulationEngine.service.js";

import { classifyTestFile } from "../utils/testingFrameworkDetector.js";
import {
  findLogicSourceFiles,
  extractBranches,
} from "../services/runTestsJob.service.js";
import { extractFunctions } from "../services/cyclomaticFunctionExtractor.service.js";
import {
  resolveProjectRoot,
  hasSourceCodeFiles,
} from "../utils/projectRootResolver.js";
import {
  updateScenarioService,
  addScenarioService,
  deleteScenarioService,
  deleteProjectScenarioService,
  toggleScenarioService,
  regenerateScenarioService,
} from "../services/scenarioManager.service.js";
import {
  cleanStoragePath,
  cleanStorageText,
  stripAnsi,
  canonicalizeFilePath,
} from "../utils/pathSanitizer.js";
import {
  isBusinessLogicSourceFile,
  extractProjectCoverageExclusions,
} from "../utils/businessLogicFileDetector.js";
import { detectSystemTestFrameworksForSnapshot } from "../services/systemTestFrameworkDetection.service.js";
import { optimizeSystemTest } from "../services/systemTestBooster.service.js";
import { createSystemGenerationDraft } from "../services/systemGenerationProposal.service.js";
import { validateGeneratedTestCode } from "../validators/aiTestCode.validator.js";
import { extractSuitesAndScenarios } from "../utils/testFileParser.js";
import {
  containedPath,
  readFullSystemConfig,
} from "../services/fullSystemLifecycle.service.js";

// ── Canonical project-relative path resolution & matching ────────────────────
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
    // If file exists as-is relative to rootDir, it is already the canonical project-relative path
    try {
      if (fs.existsSync(path.join(rootDir, clean))) {
        return clean;
      }
      // Check standard monorepo/subproject prefixes
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

export const getNormalizedMatchKey = (p = "") => {
  return (p || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^(?:server|backend|client|frontend|app|api)\//i, "")
    .toLowerCase();
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_SORT_FIELDS = [
  "filePath",
  "linesPct",
  "branchesPct",
  "funcsPct",
  "stmtsPct",
];
const ALLOWED_SORT_ORDERS = ["asc", "desc"];
const ALLOWED_FUNC_SORT_FIELDS = [
  "functionName",
  "filePath",
  "hit",
  "startLine",
];

import { isApiFilePath } from "../utils/apiFileDetector.js";
export { isApiFilePath };

export const resolveSnapshotRootDir = (rootDir) => {
  if (!rootDir) return null;
  let candidate = rootDir;
  if (!fs.existsSync(rootDir)) {
    if (rootDir.startsWith("/app/")) {
      const hostCandidate = path.resolve(
        process.cwd(),
        rootDir.replace(/^\/app\//, ""),
      );
      if (fs.existsSync(hostCandidate)) candidate = hostCandidate;
    } else {
      const storageIdx = rootDir.indexOf("storage");
      if (storageIdx !== -1) {
        const subPath = rootDir.slice(storageIdx).replace(/\\/g, "/");
        const containerCandidate = path.join("/app", subPath);
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

const findOwnedSnapshot = async (snapshotId, userId) => {
  if (!snapshotId) return null;
  let snapshot = null;
  const projectFilter = userId
    ? typeof membershipWhere === "function"
      ? membershipWhere(userId)
      : { ownerId: userId }
    : {};
  try {
    if (typeof prisma?.projectSnapshot?.findUnique === "function") {
      const uniqueSnap = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        include: { project: true },
      });
      if (uniqueSnap) {
        if (
          !userId ||
          !uniqueSnap.project ||
          uniqueSnap.project.ownerId === userId
        ) {
          snapshot = uniqueSnap;
        }
      }
    }
  } catch {}
  if (!snapshot) {
    try {
      if (typeof prisma?.projectSnapshot?.findFirst === "function") {
        snapshot = await prisma.projectSnapshot.findFirst({
          where: {
            id: snapshotId,
            ...(userId ? { project: projectFilter } : {}),
          },
          select: { id: true, projectId: true, rootDir: true, project: true },
        });
      }
    } catch {}
  }
  if (!snapshot) {
    try {
      if (typeof prisma?.projectSnapshot?.findFirst === "function") {
        // Fallback: check if snapshotId is actually a projectId
        snapshot = await prisma.projectSnapshot.findFirst({
          where: {
            projectId: snapshotId,
            ...(userId ? { project: projectFilter } : {}),
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, projectId: true, rootDir: true, project: true },
        });
      }
    } catch {}
  }
  return snapshot;
};

const testSuitesCache = new Map();
const frameworksCache = new Map();
const unitFilesCache = new Map();
const UNIT_FILES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const invalidateCoverageCache = (snapshotId, rootDir = null) => {
  if (snapshotId) {
    unitFilesCache.delete(snapshotId);
    frameworksCache.delete(snapshotId);
  } else {
    unitFilesCache.clear();
    frameworksCache.clear();
  }

  for (const key of Array.from(testSuitesCache.keys())) {
    if (!snapshotId || key.startsWith(snapshotId)) {
      testSuitesCache.delete(key);
    }
  }

  try {
    import("../services/testDependencyResolver.service.js")
      .then((mod) => {
        mod?.invalidateDependencyCache?.(rootDir);
      })
      .catch(() => {});
    import("../services/unifiedQualityDashboard.service.js")
      .then((mod) => {
        mod?.clearUnifiedDashboardCache?.(snapshotId);
      })
      .catch(() => {});
    import("../services/portfolioDashboard.service.js")
      .then((mod) => {
        mod?.clearPortfolioCache?.();
      })
      .catch(() => {});
  } catch (_) {}
};

export const getCoverageFrameworks = async (req, res) => {
  try {
    const snapshot = await findOwnedSnapshot(
      req.params.snapshotId,
      req.user?.id,
    );
    if (!snapshot)
      return res.status(404).json({
        success: false,
        message: "Snapshot not found or unauthorized.",
      });
    if (!snapshot.rootDir)
      return res.status(409).json({
        success: false,
        message: "Snapshot is not ready for analysis.",
      });

    const resolvedRootDir =
      resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;

    if (frameworksCache.has(snapshot.id)) {
      return res.json({
        success: true,
        data: frameworksCache.get(snapshot.id),
      });
    }
    const data = detectCoverageFrameworks(resolvedRootDir);
    frameworksCache.set(snapshot.id, data);
    return res.json({ success: true, data });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

export const runCoverageByType = async (req, res) => {
  try {
    const { snapshotId, coverageType } = req.params;
    const requestedFramework =
      req.body?.framework || req.query?.framework || null;
    const isRestart = Boolean(req.body?.restart || req.query?.restart);
    const parseOptionalBoolean = (val) => {
      if (val === undefined || val === null || val === "") return undefined;
      if (typeof val === "boolean") return val;
      if (typeof val === "string") {
        const lower = val.trim().toLowerCase();
        if (lower === "true" || lower === "1") return true;
        if (lower === "false" || lower === "0") return false;
      }
      return Boolean(val);
    };
    const parsedBodyHermetic = parseOptionalBoolean(req.body?.useHermeticMock);
    const parsedQueryHermetic = parseOptionalBoolean(
      req.query?.useHermeticMock,
    );
    const useHermeticMock =
      parsedBodyHermetic !== undefined
        ? parsedBodyHermetic
        : parsedQueryHermetic !== undefined
          ? parsedQueryHermetic
          : true;
    const userId = req.user?.id;
    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res
        .status(404)
        .json({
          success: false,
          message: "Snapshot not found or unauthorized.",
        });
    if (!snapshot.rootDir)
      return res
        .status(409)
        .json({
          success: false,
          message: "Snapshot is not ready for analysis.",
        });

    invalidateCoverageCache(snapshot.id);
    if (snapshotId !== snapshot.id) invalidateCoverageCache(snapshotId);

    const resolvedRootDir =
      resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;

    const detection = detectCoverageFrameworks(resolvedRootDir);
    let job;
    let jobs = [];
    let framework;

    if (coverageType === "unit") {
      const unitFws = detection.supported?.unit || [];
      const hasJest = unitFws.includes("jest");
      const hasVitest = unitFws.includes("vitest");
      framework =
        hasJest && hasVitest ? "jest & vitest" : hasVitest ? "vitest" : "jest";
      if (!framework) framework = "jest";

      const targetFiles = Array.isArray(req.body?.targetFiles)
        ? req.body.targetFiles.filter((f) => typeof f === "string" && f.trim())
        : [];
      const targetTestNames = Array.isArray(req.body?.targetTestNames)
        ? req.body.targetTestNames.filter(
            (t) => typeof t === "string" && t.trim(),
          )
        : [];
      const draftTests = Array.isArray(req.body?.draftTests)
        ? req.body.draftTests
            .filter(
              (d) =>
                d &&
                typeof d === "object" &&
                typeof d.testFile === "string" &&
                d.testFile.trim() &&
                !d.testFile.includes("..") &&
                typeof d.code === "string" &&
                d.code.trim() &&
                d.code.length <= 512 * 1024,
            )
            .slice(0, 100)
            .map((d) => ({
              testFile: String(d.testFile)
                .replace(/\\/g, "/")
                .replace(/^\/+/, "")
                .trim(),
              sourceFile:
                typeof d.sourceFile === "string"
                  ? String(d.sourceFile)
                      .replace(/\\/g, "/")
                      .replace(/^\/+/, "")
                      .trim()
                  : "",
              framework:
                d.framework === "vitest" || d.framework === "jest"
                  ? d.framework
                  : null,
              code: d.code,
            }))
        : [];
      const isTargetedUnitRun =
        targetFiles.length > 0 ||
        targetTestNames.length > 0 ||
        draftTests.length > 0;
      const runMode = isTargetedUnitRun ? "TARGETED" : "FULL";

      // Unified Unit Test Job: Check if a RUN_TESTS job is already active for this snapshot
      const activeUnitJob = await prisma.job.findFirst({
        where: {
          projectId: snapshot.projectId,
          snapshotId: snapshot.id,
          type: "RUN_TESTS",
          status: { in: ["QUEUED", "RUNNING"] },
        },
      });

      if (activeUnitJob) {
        const startTime = activeUnitJob.startedAt || activeUnitJob.createdAt;
        const elapsedMs = startTime
          ? Date.now() - new Date(startTime).getTime()
          : 0;
        // If user requested restart/targeted run, or stuck in QUEUED > 2m, or running > 15m timeout, cancel and recreate
        const isOrphanedQueued =
          activeUnitJob.status === "QUEUED" && elapsedMs > 2 * 60 * 1000;
        const isStaleRunning =
          activeUnitJob.status === "RUNNING" &&
          elapsedMs > (STALE_JOB_TIMEOUT_MS || 15 * 60 * 1000);

        if (
          isRestart ||
          isTargetedUnitRun ||
          isOrphanedQueued ||
          isStaleRunning
        ) {
          await prisma.job
            .update({
              where: { id: activeUnitJob.id },
              data: { status: "CANCELED", finishedAt: new Date() },
            })
            .catch(() => {});
          if (typeof prisma.projectOperation?.updateMany === "function") {
            await prisma.projectOperation
              .updateMany({
                where: {
                  primaryJobId: activeUnitJob.id,
                  status: {
                    in: ["ADMITTED", "QUEUED", "RUNNING", "PUBLISHING"],
                  },
                },
                data: { status: "CANCELED" },
              })
              .catch(() => {});
          }
          job = await createRunTestsJob({
            projectId: snapshot.projectId,
            snapshotId: snapshot.id,
            userId,
            mode: runMode,
            useHermeticMock,
            targetFiles,
            targetTestNames,
            draftTests,
          });
          await addJobToQueue("RUN_TESTS", job.id, {
            useHermeticMock,
            targetFiles,
            targetTestNames,
          });
        } else {
          job = activeUnitJob;
          if (job.status === "QUEUED") {
            // Ensure queued job is properly enqueued in BullMQ in case it was missed
            await addJobToQueue("RUN_TESTS", job.id, { useHermeticMock }).catch(
              () => {},
            );
          }
        }
      } else {
        job = await createRunTestsJob({
          projectId: snapshot.projectId,
          snapshotId: snapshot.id,
          userId,
          mode: runMode,
          useHermeticMock,
          targetFiles,
          targetTestNames,
          draftTests,
        });
        await addJobToQueue("RUN_TESTS", job.id, {
          useHermeticMock,
          targetFiles,
          targetTestNames,
        });
      }
      jobs = [job];
    } else {
      framework = selectCoverageFramework(
        detection,
        coverageType,
        requestedFramework,
      );
      if (framework === "supertest") {
        const { detectIntegrationFrameworks } =
          await import("../services/integrationDetection.service.js");
        const intDetect = await detectIntegrationFrameworks(resolvedRootDir);
        const hasIntDeps = Boolean(
          intDetect?.hasDependencies ?? intDetect?.summary?.hasDependencies,
        );
        if (!hasIntDeps && !req.body?.skipHitlCheck) {
          return res.status(409).json({
            success: false,
            code: "INTEGRATION_DEPENDENCY_MISSING",
            message:
              "Integration tests require supertest and jest installed in package.json. Please install dependencies before running.",
            missingPackages: intDetect.summary?.missingPackages || [
              "supertest",
              "jest",
            ],
          });
        }
        const targetEndpoint = req.body?.targetEndpoint || null;
        const targetTestNames = Array.isArray(req.body?.targetTestNames)
          ? req.body.targetTestNames.filter(Boolean)
          : [];
        const selectedScenarioIds = Array.isArray(req.body?.selectedScenarioIds)
          ? req.body.selectedScenarioIds.filter(Boolean)
          : [];
        const supertestPayload = {
          ...(targetEndpoint ? { targetEndpoint } : {}),
          ...(targetTestNames.length > 0 ? { targetTestNames } : {}),
          ...(selectedScenarioIds.length > 0 ? { selectedScenarioIds } : {}),
        };
        const isTargetedRun =
          targetTestNames.length > 0 || selectedScenarioIds.length > 0;
        const hasInstalledNodeModules =
          fs.existsSync(path.join(resolvedRootDir, "node_modules")) ||
          ["server", "backend", "api"].some((sub) =>
            fs.existsSync(path.join(resolvedRootDir, sub, "node_modules")),
          );
        if ((isTargetedRun || hasInstalledNodeModules) && hasIntDeps) {
          job = await createSupertestCoverageJob({
            projectId: snapshot.projectId,
            snapshotId,
            userId,
            payloadJson: supertestPayload,
          });
          await addJobToQueue("SUPERTEST_COVERAGE", job.id, supertestPayload);
          jobs = [job];
        } else {
          const installJob = await createInstallDepsJob({
            projectId: snapshot.projectId,
            snapshotId,
            userId,
          });
          job = await createSupertestCoverageJob({
            projectId: snapshot.projectId,
            snapshotId,
            userId,
            payloadJson: supertestPayload,
          });
          await addSupertestCoveragePipeline(installJob.id, job.id);
          jobs = [installJob, job];
        }
      } else {
        const runner = framework === "cypress" ? "cypress" : "playwright";
        job = await createSystemTestAnalysisJob({
          projectId: snapshot.projectId,
          snapshotId,
          userId,
          runner,
          executionMode: req.body?.executionMode || "full",
        });
        await addJobToQueue("SYSTEM_TEST_ANALYSIS", job.id);
        jobs = [job];
      }
    }

    return res.status(202).json({
      success: true,
      message: `${framework} ${coverageType} coverage queued.`,
      data: {
        framework,
        coverageType,
        detectedFrameworks: detection.all,
        job,
        jobs,
      },
    });
  } catch (error) {
    if (error.statusCode === 409) {
      try {
        const activeJob = await prisma.job.findFirst({
          where: {
            snapshotId: req.params.snapshotId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
        });
        if (activeJob) {
          return res.status(202).json({
            success: true,
            message: "Attached to ongoing coverage analysis job.",
            data: { job: activeJob, jobs: [activeJob] },
          });
        }
      } catch (_) {}
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Unable to run coverage analysis.",
      details: error.details,
    });
  }
};

/**
 * SCRUM-151: Create summary endpoint
 * SCRUM-152: Verify permissions
 * SCRUM-153: Retrieve CoverageSummary
 * SCRUM-154: Return formatted response
 *
 * GET /api/coverage/:snapshotId/summary
 */
export const getCoverageSummary = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { snapshotId } = req.params;

    if (
      !snapshotId ||
      typeof snapshotId !== "string" ||
      snapshotId.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid snapshotId." });
    }

    // Verify snapshot exists and belongs to user project
    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        source: true,
        commitSha: true,
        createdAt: true,
        rootDir: true,
        project: {
          select: { ownerId: true, name: true },
        },
      },
    });

    if (!snapshot) {
      return res
        .status(404)
        .json({ success: false, message: "Snapshot does not exist." });
    }

    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    // Retrieve CoverageSummary
    const summary = await prisma.coverageSummary.findUnique({
      where: { snapshotId },
    });

    const typeFilter = req.query?.type || req.query?.coverageType || null;

    const storedCoverage = summary
      ? {
          lines: summary.linesPct,
          branches: summary.branchesPct,
          functions: summary.funcsPct,
          statements: summary.stmtsPct,
        }
      : null;

    let coverage = summary
      ? {
          lines: summary.linesPct,
          branches: summary.branchesPct,
          functions: summary.funcsPct,
          statements: summary.stmtsPct,
        }
      : {
          lines: 0,
          branches: 0,
          functions: 0,
          statements: 0,
        };

    // Read rawTotals from namespaced coverage-summary.json based on typeFilter
    let rawTotals = null;
    const resolvedRootDir = resolveSnapshotRootDir(snapshot.rootDir);
    if (resolvedRootDir) {
      let candidateSummaryFiles = [];
      if (typeFilter === "integration") {
        candidateSummaryFiles = [
          path.join(
            resolvedRootDir,
            "coverage",
            "integration",
            "coverage-summary.json",
          ),
          path.join(
            resolvedRootDir,
            "coverage",
            "supertest-coverage-summary.json",
          ),
          path.join(resolvedRootDir, "coverage", "coverage-summary.json"),
        ];
      } else if (typeFilter === "system") {
        candidateSummaryFiles = [
          path.join(
            resolvedRootDir,
            "coverage",
            "system",
            "coverage-summary.json",
          ),
          path.join(
            resolvedRootDir,
            "coverage",
            "playwright-coverage-summary.json",
          ),
          path.join(
            resolvedRootDir,
            "coverage",
            "cypress-coverage-summary.json",
          ),
        ];
      } else {
        // Unit test coverage (default)
        candidateSummaryFiles = [
          path.join(
            resolvedRootDir,
            "coverage",
            "unit",
            "coverage-summary.json",
          ),
          path.join(resolvedRootDir, "coverage", "coverage-summary.json"),
          path.join(
            resolvedRootDir,
            "server",
            "coverage",
            "coverage-summary.json",
          ),
          path.join(
            resolvedRootDir,
            "client",
            "coverage",
            "coverage-summary.json",
          ),
          path.join(
            resolvedRootDir,
            "backend",
            "coverage",
            "coverage-summary.json",
          ),
          path.join(resolvedRootDir, "coverage-summary.json"),
          path.join(resolvedRootDir, "coverage", "jest-coverage-summary.json"),
          path.join(
            resolvedRootDir,
            "coverage",
            "vitest-coverage-summary.json",
          ),
        ];
      }

      // Scan immediate subdirectories for monorepo packages (e.g. server, app, pkg)
      try {
        const subEntries = fs.readdirSync(resolvedRootDir, {
          withFileTypes: true,
        });
        for (const entry of subEntries) {
          if (
            entry.isDirectory() &&
            !["node_modules", ".git", "dist", ".gemini", "storage"].includes(
              entry.name,
            )
          ) {
            candidateSummaryFiles.push(
              path.join(
                resolvedRootDir,
                entry.name,
                "coverage",
                "coverage-summary.json",
              ),
            );
            candidateSummaryFiles.push(
              path.join(resolvedRootDir, entry.name, "coverage-summary.json"),
            );
          }
        }
      } catch (_) {}

      let bestSummary = null;
      let bestSummaryMtime = 0;
      let bestHasNonZero = false;

      for (const summaryFile of candidateSummaryFiles) {
        if (fs.existsSync(summaryFile)) {
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
                (hasNonZero === bestHasNonZero &&
                  stat.mtimeMs > bestSummaryMtime)
              ) {
                bestSummary = parsed;
                bestSummaryMtime = stat.mtimeMs;
                bestHasNonZero = hasNonZero;
              }
            }
          } catch (_) {}
        }
      }
      let raw = bestSummary;

      if (raw) {
        if (typeFilter === "unit") {
          // Extract path-matched threshold exceptions from Jest's coverageThreshold (if any)
          const thresholdExceptions = new Set();
          try {
            const { readProjectJestConfig } =
              await import("../services/runTestsJob.service.js");
            const projectJestConfig = await readProjectJestConfig(
              resolvedRootDir,
              snapshot.jestConfigPath,
            );
            const coverageThreshold = projectJestConfig?.coverageThreshold;
            if (coverageThreshold && typeof coverageThreshold === "object") {
              for (const pattern of Object.keys(coverageThreshold)) {
                if (pattern === "global") continue;
                const normPattern = pattern
                  .replace(/^\.\//, "")
                  .replace(/\\/g, "/")
                  .toLowerCase();
                thresholdExceptions.add(normPattern);
              }
            }
          } catch {}

          // Filter out non-business logic files (examples, configs, types, hooks, i18n, routes, frontend)
          const configExclusions =
            extractProjectCoverageExclusions(resolvedRootDir);
          const canonicalMap = new Map();
          const canonicalByMatchKey = new Map();
          for (const [filePath, data] of Object.entries(raw)) {
            if (filePath === "total" || !data) continue;
            const can =
              resolveProjectRelativePath(filePath, resolvedRootDir) || filePath;
            const norm = can.replace(/\\/g, "/").toLowerCase();
            const isThresholdException = Array.from(thresholdExceptions).some(
              (exc) => norm.endsWith(exc),
            );
            if (
              isBusinessLogicSourceFile(can, configExclusions) &&
              !isThresholdException
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
                if (existingKey && existingKey !== can)
                  canonicalMap.delete(existingKey);
                canonicalMap.set(can, data);
                canonicalByMatchKey.set(matchKey, can);
              }
            }
          }

          // Ensure ALL project business logic files are accounted for in unit coverage totals
          const logicFiles = findLogicSourceFiles(resolvedRootDir);
          for (const lf of logicFiles) {
            const can =
              resolveProjectRelativePath(lf.relativePath, resolvedRootDir) ||
              lf.relativePath;
            const norm = can.replace(/\\/g, "/").toLowerCase();
            const isThresholdException = Array.from(thresholdExceptions).some(
              (exc) => norm.endsWith(exc),
            );
            if (
              isThresholdException ||
              !isBusinessLogicSourceFile(can, configExclusions)
            )
              continue;

            const matchKey = getNormalizedMatchKey(can);
            const existingKey = canonicalMap.has(can)
              ? can
              : canonicalByMatchKey.get(matchKey) || null;

            if (!existingKey) {
              let content = "";
              try {
                content = fs.readFileSync(lf.absolutePath, "utf8");
              } catch {}
              const codeLines = content.split("\n");
              const totalLines = Math.max(1, codeLines.length);
              let funcs = [];
              try {
                funcs = extractFunctions(content) || [];
              } catch {
                funcs = [];
              }
              let branchList = [];
              try {
                branchList = extractBranches(content) || [];
              } catch {
                branchList = [];
              }

              canonicalMap.set(can, {
                lines: { total: totalLines, covered: 0, skipped: 0, pct: 0 },
                statements: {
                  total: totalLines,
                  covered: 0,
                  skipped: 0,
                  pct: 0,
                },
                functions: {
                  total: funcs.length,
                  covered: 0,
                  skipped: 0,
                  pct: 0,
                },
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

          const unitFileEntries = Array.from(canonicalMap.entries());

          if (unitFileEntries.length > 0) {
            let stmtsCovered = 0,
              stmtsTotal = 0;
            let branchesCovered = 0,
              branchesTotal = 0;
            let funcsCovered = 0,
              funcsTotal = 0;
            let linesCovered = 0,
              linesTotal = 0;

            for (const [, data] of unitFileEntries) {
              stmtsCovered += data.statements?.covered || 0;
              stmtsTotal += data.statements?.total || 0;
              branchesCovered += data.branches?.covered || 0;
              branchesTotal += data.branches?.total || 0;
              funcsCovered += data.functions?.covered || 0;
              funcsTotal += data.functions?.total || 0;
              linesCovered += data.lines?.covered || 0;
              linesTotal += data.lines?.total || 0;
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

            rawTotals = {
              statements: {
                total: stmtsTotal,
                covered: stmtsCovered,
                pct: stmtsPct,
              },
              branches: {
                total: branchesTotal,
                covered: branchesCovered,
                pct: branchesPct,
              },
              functions: {
                total: funcsTotal,
                covered: funcsCovered,
                pct: funcsPct,
              },
              lines: {
                total: linesTotal,
                covered: linesCovered,
                pct: linesPct,
              },
            };

            coverage = {
              statements: stmtsPct,
              branches: branchesPct,
              functions: funcsPct,
              lines: linesPct,
            };
          } else if (raw.total) {
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
            rawTotals = {
              statements: raw.total.statements || null,
              branches: raw.total.branches
                ? { ...raw.total.branches, pct: rawBranchesPct }
                : null,
              functions: raw.total.functions || null,
              lines: raw.total.lines || null,
            };
            if (
              !coverage.statements &&
              !coverage.lines &&
              raw.total.statements?.pct != null
            ) {
              coverage = {
                statements: raw.total.statements.pct ?? 0,
                branches: rawBranchesPct,
                functions: raw.total.functions.pct ?? 0,
                lines: raw.total.lines.pct ?? 0,
              };
            }
          }
        } else if (typeFilter === "integration") {
          const apiFileEntries = Object.entries(raw).filter(([filePath]) => {
            if (filePath === "total") return false;
            return isApiFilePath(filePath);
          });

          if (apiFileEntries.length > 0) {
            let stmtsCovered = 0,
              stmtsTotal = 0;
            let branchesCovered = 0,
              branchesTotal = 0;
            let funcsCovered = 0,
              funcsTotal = 0;
            let linesCovered = 0,
              linesTotal = 0;

            for (const [, data] of apiFileEntries) {
              stmtsCovered += data.statements?.covered || 0;
              stmtsTotal += data.statements?.total || 0;
              branchesCovered += data.branches?.covered || 0;
              branchesTotal += data.branches?.total || 0;
              funcsCovered += data.functions?.covered || 0;
              funcsTotal += data.functions?.total || 0;
              linesCovered += data.lines?.covered || 0;
              linesTotal += data.lines?.total || 0;
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

            rawTotals = {
              statements: {
                total: stmtsTotal,
                covered: stmtsCovered,
                pct: stmtsPct,
              },
              branches: {
                total: branchesTotal,
                covered: branchesCovered,
                pct: branchesPct,
              },
              functions: {
                total: funcsTotal,
                covered: funcsCovered,
                pct: funcsPct,
              },
              lines: {
                total: linesTotal,
                covered: linesCovered,
                pct: linesPct,
              },
            };

            coverage = {
              statements: stmtsPct,
              branches: branchesPct,
              functions: funcsPct,
              lines: linesPct,
            };
          } else if (raw.total) {
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
            rawTotals = {
              statements: raw.total.statements || null,
              branches: raw.total.branches
                ? { ...raw.total.branches, pct: rawBranchesPct }
                : null,
              functions: raw.total.functions || null,
              lines: raw.total.lines || null,
            };
          }
        } else if (typeFilter === "system") {
          // System test coverage: strictly derived from Playwright / Cypress, never from Jest or Vitest
          rawTotals = null;
          coverage = { statements: 0, branches: 0, functions: 0, lines: 0 };
          const sysFiles = [
            path.join(
              resolvedRootDir,
              "coverage",
              "playwright-coverage-summary.json",
            ),
            path.join(
              resolvedRootDir,
              "coverage",
              "cypress-coverage-summary.json",
            ),
          ];
          for (const sf of sysFiles) {
            if (fs.existsSync(sf)) {
              try {
                const sysRaw = JSON.parse(fs.readFileSync(sf, "utf8"));
                if (sysRaw?.total) {
                  rawTotals = sysRaw.total;
                  coverage = {
                    statements: sysRaw.total.statements?.pct ?? 0,
                    branches: sysRaw.total.branches?.pct ?? 0,
                    functions: sysRaw.total.functions?.pct ?? 0,
                    lines: sysRaw.total.lines?.pct ?? 0,
                  };
                  break;
                }
              } catch (_) {}
            }
          }
        } else if (raw.total) {
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
          rawTotals = {
            statements: raw.total.statements || null,
            branches: raw.total.branches
              ? { ...raw.total.branches, pct: rawBranchesPct }
              : null,
            functions: raw.total.functions || null,
            lines: raw.total.lines || null,
          };
        }
      }
    }

    // Database fallback: if no JSON file on disk, check if coverage was stored in DB
    if (!rawTotals) {
      try {
        const dbFiles = await prisma.coverageFile.findMany({
          where: { snapshotId: snapshot.id },
          select: {
            filePath: true,
            linesPct: true,
            branchesPct: true,
            funcsPct: true,
            stmtsPct: true,
          },
        });

        if (dbFiles && dbFiles.length > 0) {
          const configExclusions = resolvedRootDir
            ? extractProjectCoverageExclusions(resolvedRootDir)
            : [];
          let sTot = 0,
            sCovExact = 0,
            bTot = 0,
            bCovExact = 0,
            fTot = 0,
            fCovExact = 0,
            lTot = 0,
            lCovExact = 0;
          let matchedFileCount = 0;

          for (const f of dbFiles) {
            const can = resolvedRootDir
              ? canonicalizeFilePath(f.filePath, resolvedRootDir) || f.filePath
              : f.filePath;
            if (
              typeFilter === "unit" &&
              !isBusinessLogicSourceFile(can, configExclusions)
            )
              continue;
            if (typeFilter === "integration" && !isApiFilePath(can)) continue;

            matchedFileCount++;
            let totalLines = 100;
            let funcsCount = 5;
            let branchesCount = 5;

            if (resolvedRootDir) {
              const absPath = path.isAbsolute(f.filePath)
                ? f.filePath
                : path.join(resolvedRootDir, f.filePath);
              if (fs.existsSync(absPath)) {
                try {
                  const fileContent = fs.readFileSync(absPath, "utf8");
                  const codeLines = fileContent.split("\n");
                  totalLines = Math.max(1, codeLines.length);
                  const funcs = extractFunctions(fileContent) || [];
                  funcsCount = Math.max(1, funcs.length);
                  const branchList = extractBranches(fileContent) || [];
                  branchesCount = Math.max(
                    1,
                    branchList.reduce(
                      (s, b) => s + (b.locations?.length || 1),
                      0,
                    ),
                  );
                } catch (_) {}
              }
            }

            sTot += totalLines;
            sCovExact += totalLines * ((f.stmtsPct || 0) / 100);
            lTot += totalLines;
            lCovExact += totalLines * ((f.linesPct || 0) / 100);
            fTot += funcsCount;
            fCovExact += funcsCount * ((f.funcsPct || 0) / 100);
            bTot += branchesCount;
            bCovExact += branchesCount * ((f.branchesPct || 0) / 100);
          }

          if (matchedFileCount > 0 && (sTot > 0 || lTot > 0)) {
            const sPct =
              sTot > 0 ? Number(((sCovExact / sTot) * 100).toFixed(1)) : 0;
            const bPct =
              bTot > 0
                ? Number(((bCovExact / bTot) * 100).toFixed(1))
                : lCovExact > 0
                  ? 100
                  : 0;
            const fPct =
              fTot > 0 ? Number(((fCovExact / fTot) * 100).toFixed(1)) : 0;
            const lPct =
              lTot > 0 ? Number(((lCovExact / lTot) * 100).toFixed(1)) : 0;

            rawTotals = {
              statements: {
                total: sTot,
                covered: Math.round(sCovExact),
                pct: sPct,
              },
              branches: {
                total: bTot,
                covered: Math.round(bCovExact),
                pct: bPct,
              },
              functions: {
                total: fTot,
                covered: Math.round(fCovExact),
                pct: fPct,
              },
              lines: { total: lTot, covered: Math.round(lCovExact), pct: lPct },
            };
            coverage = {
              statements: sPct,
              branches: bPct,
              functions: fPct,
              lines: lPct,
            };
          }
        }
      } catch (dbAggErr) {
        console.warn(
          "[CoverageSummary] DB fallback aggregation error:",
          dbAggErr.message,
        );
      }
    }

    if (!rawTotals) {
      try {
        const dbSummary =
          summary ||
          (await prisma.coverageSummary.findUnique({
            where: { snapshotId: snapshot.id },
          }));
        if (
          dbSummary &&
          (dbSummary.stmtsPct != null || dbSummary.linesPct != null)
        ) {
          const sPct = dbSummary.stmtsPct ?? 0;
          const bPct = dbSummary.branchesPct ?? 0;
          const fPct = dbSummary.funcsPct ?? 0;
          const lPct = dbSummary.linesPct ?? 0;
          const hasDbCoverage = sPct > 0 || lPct > 0 || fPct > 0 || bPct > 0;
          if (hasDbCoverage || !rawTotals) {
            rawTotals = {
              statements: { total: 100, covered: Math.round(sPct), pct: sPct },
              branches: { total: 100, covered: Math.round(bPct), pct: bPct },
              functions: { total: 100, covered: Math.round(fPct), pct: fPct },
              lines: { total: 100, covered: Math.round(lPct), pct: lPct },
            };
            coverage = {
              statements: sPct,
              branches: bPct,
              functions: fPct,
              lines: lPct,
            };
          }
        }
      } catch (dbSummaryErr) {
        console.warn(
          "[CoverageSummary] DB summary fallback error:",
          dbSummaryErr.message,
        );
      }
    }

    // If integration test and no explicit summary file found, compute baseline 0% totals across all API route files
    if (typeFilter === "integration" && !rawTotals && resolvedRootDir) {
      try {
        const logicFiles = findLogicSourceFiles(resolvedRootDir);
        let stmtsTotal = 0;
        let linesTotal = 0;
        let funcsTotal = 0;
        let branchesTotal = 0;

        for (const lf of logicFiles) {
          const can =
            resolveProjectRelativePath(lf.relativePath, resolvedRootDir) ||
            lf.relativePath;
          if (!isApiFilePath(can)) continue;

          let content = "";
          try {
            content = fs.readFileSync(lf.absolutePath, "utf8");
          } catch {}
          const codeLines = content.split("\n");
          const totalLines = Math.max(1, codeLines.length);
          linesTotal += totalLines;
          stmtsTotal += totalLines;

          let funcs = [];
          try {
            funcs = extractFunctions(content) || [];
          } catch {
            funcs = [];
          }
          funcsTotal += funcs.length;

          let branchList = [];
          try {
            branchList = extractBranches(content) || [];
          } catch {
            branchList = [];
          }
          branchesTotal += branchList.reduce(
            (s, b) => s + (b.locations?.length || 1),
            0,
          );
        }

        if (linesTotal > 0 || stmtsTotal > 0) {
          rawTotals = {
            statements: { total: stmtsTotal, covered: 0, pct: 0 },
            branches: { total: branchesTotal, covered: 0, pct: 0 },
            functions: { total: funcsTotal, covered: 0, pct: 0 },
            lines: { total: linesTotal, covered: 0, pct: 0 },
          };
          coverage = { statements: 0, branches: 0, functions: 0, lines: 0 };
        }
      } catch (integrationBaselineErr) {
        console.warn(
          "[CoverageSummary] Integration baseline fallback error:",
          integrationBaselineErr.message,
        );
      }
    }

    // If unit test and no explicit summary file found, compute baseline 0% totals across all business logic files
    const hasActiveCoverage =
      (coverage.statements || 0) > 0 ||
      (coverage.lines || 0) > 0 ||
      (coverage.functions || 0) > 0;
    if (
      typeFilter === "unit" &&
      !rawTotals &&
      !hasActiveCoverage &&
      resolvedRootDir
    ) {
      try {
        const configExclusions =
          extractProjectCoverageExclusions(resolvedRootDir);
        const logicFiles = findLogicSourceFiles(resolvedRootDir);
        let stmtsTotal = 0;
        let linesTotal = 0;
        let funcsTotal = 0;
        let branchesTotal = 0;

        for (const lf of logicFiles) {
          const can =
            resolveProjectRelativePath(lf.relativePath, resolvedRootDir) ||
            lf.relativePath;
          if (!isBusinessLogicSourceFile(can, configExclusions)) continue;

          let content = "";
          try {
            content = fs.readFileSync(lf.absolutePath, "utf8");
          } catch {}
          const codeLines = content.split("\n");
          const totalLines = Math.max(1, codeLines.length);
          linesTotal += totalLines;
          stmtsTotal += totalLines;

          let funcs = [];
          try {
            funcs = extractFunctions(content) || [];
          } catch {
            funcs = [];
          }
          funcsTotal += funcs.length;

          let branchList = [];
          try {
            branchList = extractBranches(content) || [];
          } catch {
            branchList = [];
          }
          branchesTotal += branchList.reduce(
            (s, b) => s + (b.locations?.length || 1),
            0,
          );
        }

        rawTotals = {
          statements: { total: stmtsTotal, covered: 0, pct: 0 },
          branches: { total: branchesTotal, covered: 0, pct: 0 },
          functions: { total: funcsTotal, covered: 0, pct: 0 },
          lines: { total: linesTotal, covered: 0, pct: 0 },
        };
        coverage = { statements: 0, branches: 0, functions: 0, lines: 0 };
      } catch (baselineErr) {
        console.warn(
          "[CoverageSummary] Baseline fallback error:",
          baselineErr.message,
        );
      }
    }

    // If system test and no explicit summary file found, ensure system coverage starts clean at 0%
    if (typeFilter === "system" && !rawTotals) {
      coverage = { statements: 0, branches: 0, functions: 0, lines: 0 };
    }

    // Check latest test run or analysis job filtered strictly by coverage type
    // Jest and Vitest only belong to unit test; System test only uses Playwright and Cypress
    let latestTestRun = null;
    let latestJob = null;
    const testTypeCondition =
      typeFilter === "unit"
        ? { in: ["JEST", "VITEST"] }
        : typeFilter === "integration"
          ? { in: ["SUPERTEST"] }
          : typeFilter === "system"
            ? { in: ["PLAYWRIGHT", "CYPRESS"] }
            : undefined;

    const jobTypeCondition =
      typeFilter === "unit"
        ? { in: ["RUN_TESTS", "VITEST_COVERAGE"] }
        : typeFilter === "integration"
          ? { in: ["SUPERTEST_COVERAGE"] }
          : typeFilter === "system"
            ? { in: ["PLAYWRIGHT_SYSTEM_COVERAGE", "CYPRESS_SYSTEM_COVERAGE"] }
            : undefined;

    try {
      if (prisma.testRun?.findFirst) {
        latestTestRun =
          (await prisma.testRun.findFirst({
            where: {
              snapshotId: snapshot.id,
              totalTests: { gt: 0 },
              ...(testTypeCondition ? { type: testTypeCondition } : {}),
            },
            orderBy: { createdAt: "desc" },
            include: { scenarios: true },
          })) ||
          (await prisma.testRun.findFirst({
            where: {
              snapshotId: snapshot.id,
              ...(testTypeCondition ? { type: testTypeCondition } : {}),
            },
            orderBy: { createdAt: "desc" },
            include: { scenarios: true },
          }));
      }
    } catch (testRunErr) {
      console.warn(
        "[CoverageSummary] Warning querying latestTestRun:",
        testRunErr.message,
      );
    }

    try {
      if (prisma.job?.findFirst) {
        latestJob = await prisma.job.findFirst({
          where: {
            snapshotId: snapshot.id,
            ...(jobTypeCondition ? { type: jobTypeCondition } : {}),
          },
          orderBy: { createdAt: "desc" },
        });
      }
    } catch (jobErr) {
      console.warn(
        "[CoverageSummary] Warning querying latestJob:",
        jobErr.message,
      );
    }

    const {
      isFatalFailure,
      hasTestFailures,
      failedSuite,
      failedSuites,
      latestRunStatus,
    } = deriveRunStatusNotices(latestTestRun, latestJob);

    const scenarioWithErr = latestTestRun?.scenarios?.find(
      (s) => s.failureMessages?.length > 0,
    );
    const latestRunError = cleanStorageText(
      stripAnsi(
        scenarioWithErr?.failureMessages?.[0] ||
          latestJob?.errorMessage ||
          null,
      ),
    );

    const sanitizedTestExecution = latestTestRun
      ? {
          ...latestTestRun,
          scenarios: latestTestRun.scenarios?.map((s) => ({
            ...s,
            testFile: cleanStoragePath(s.testFile) || null,
            failureMessages: (s.failureMessages || []).map((m) =>
              cleanStorageText(stripAnsi(m)),
            ),
          })),
        }
      : null;

    const { collectWorkspaceMissingDependencies } =
      await import("../services/dependencyResolution.service.js");
    const missingDependencies = collectWorkspaceMissingDependencies(
      snapshot.rootDir,
      [
        ...(latestTestRun?.scenarios?.flatMap((s) => s.failureMessages || []) ||
          []),
        latestJob?.errorMessage || "",
        latestRunError || "",
      ],
      failedSuite,
    );
    const missingDependency = missingDependencies[0] || null;

    // Return formatted response with explicit distinction between current run and last successful coverage
    const hasTypeRun = Boolean(
      latestTestRun || latestJob?.status === "SUCCESS",
    );
    const lastSuccessfulCoverage = coverage ?? storedCoverage;
    let peakReport = null;
    if (typeFilter === "unit") {
      try {
        const {
          getPeakUnitReport,
          capturePeakUnitReportIfHigher,
          computeUnitCoverageRank,
        } = await import("../services/unitReport.service.js");
        peakReport = await getPeakUnitReport(snapshot.id);
        const curCov = isFatalFailure ? null : coverage;
        const hasPositiveCurrent =
          curCov &&
          ((curCov.lines || 0) > 0 ||
            (curCov.statements || 0) > 0 ||
            (curCov.functions || 0) > 0);
        if (hasPositiveCurrent) {
          const curScore = computeUnitCoverageRank({
            linesPct: curCov.lines ?? 0,
            branchesPct: curCov.branches ?? 0,
            funcsPct: curCov.functions ?? 0,
            stmtsPct: curCov.statements ?? 0,
            passedTests: latestTestRun?.passedTests ?? 0,
          });
          if (!peakReport || curScore > (peakReport.peakMeta?.score ?? -1)) {
            const dbFilesForPeak = await prisma.coverageFile
              .findMany({
                where: { snapshotId: snapshot.id },
                select: {
                  filePath: true,
                  linesPct: true,
                  branchesPct: true,
                  funcsPct: true,
                  stmtsPct: true,
                },
              })
              .catch(() => []);
            peakReport = await capturePeakUnitReportIfHigher(snapshot.id, {
              summaryTotal: rawTotals || {
                lines: { total: 100, covered: Math.round(curCov.lines || 0), pct: curCov.lines || 0 },
                branches: { total: 100, covered: Math.round(curCov.branches || 0), pct: curCov.branches || 0 },
                functions: { total: 100, covered: Math.round(curCov.functions || 0), pct: curCov.functions || 0 },
                statements: { total: 100, covered: Math.round(curCov.statements || 0), pct: curCov.statements || 0 },
              },
              fileCoverages: dbFilesForPeak,
              testStats: latestTestRun
                ? {
                    total: latestTestRun.totalTests || 0,
                    passed: latestTestRun.passedTests || 0,
                    failed: latestTestRun.failedTests || 0,
                    durationMs: latestTestRun.durationMs || 0,
                  }
                : null,
              isTargetedRun: false,
            });
          }
        }
      } catch (peakErr) {
        console.warn("[CoverageSummary] Peak unit report lookup warning:", peakErr?.message);
      }
    }
    return res.status(200).json({
      success: true,
      data: {
        snapshotId: snapshot.id,
        projectId: snapshot.projectId,
        projectName: snapshot.project.name,
        source: snapshot.source,
        commitSha: snapshot.commitSha ?? null,
        snapshotCreatedAt: snapshot.createdAt,
        hasRun: hasTypeRun,
        coverage: isFatalFailure ? null : coverage,
        previousCoverage: lastSuccessfulCoverage,
        lastSuccessfulCoverage,
        isPreviousResult: isFatalFailure,
        latestRunStatus,
        latestRunError,
        missingDependency,
        missingDependencies,
        failedSuite,
        failedSuites,
        hasTestFailures,
        testExecution: sanitizedTestExecution,
        rawTotals,
        summaryCreatedAt: summary?.createdAt ?? null,
        ...(peakReport ? { peakReport } : {}),
      },
    });
  } catch (error) {
    console.error("[CoverageSummary] Server error:", error);
    if (error instanceof ServiceError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: "Internal server error!" });
  }
};

/**
 * POST /api/coverage/:snapshotId/run
 *
 * Trigger asynchronous pipeline:
 *   INSTALL_DEPS Job (npm install) → on success → RUN_TESTS Job (jest --coverage)
 *
 * Returns installJobId immediately for Frontend polling.
 */
export const runCoverage = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { snapshotId } = req.params;
    if (
      !snapshotId ||
      typeof snapshotId !== "string" ||
      snapshotId.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid snapshotId." });
    }

    // Fetch snapshot and verify permissions
    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        rootDir: true,
        hasJest: true,
        jestConfigPath: true,
        project: { select: { ownerId: true, name: true } },
      },
    });

    if (!snapshot) {
      return res
        .status(404)
        .json({ success: false, message: "Snapshot does not exist." });
    }
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "tests.run",
    });

    // Snapshot must have rootDir (INGEST job completed)
    if (!snapshot.rootDir) {
      return res.status(409).json({
        success: false,
        message:
          "Snapshot is not extracted yet (INGEST job pending). Please wait for INGEST to complete.",
      });
    }

    if (!snapshot.rootDir) {
      return res.status(422).json({
        success: false,
        message:
          "Invalid Node.js project: package.json was not found in the uploaded project.",
      });
    }

    const resolvedRootDir =
      resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;
    const candidateDirs = [
      "",
      "server",
      "backend",
      "api",
      "client",
      "frontend",
      "web",
      "app",
    ];
    const hasPackageJson = candidateDirs.some((cand) =>
      fs.existsSync(
        cand
          ? path.join(snapshot.rootDir, cand, "package.json")
          : path.join(resolvedRootDir, "package.json"),
      ),
    );
    if (
      !hasPackageJson &&
      !hasSourceCodeFiles(resolvedRootDir) &&
      !hasSourceCodeFiles(snapshot.rootDir)
    ) {
      return res.status(422).json({
        success: false,
        message:
          "Invalid Node.js project: package.json was not found in the uploaded project.",
      });
    }

    // Missing manifests are prepared only in the admitted worker's private
    // workspace. HTTP admission must not modify canonical source files.

    // RUN_TESTS owns dependency setup inside its guarded private workspace.
    // Return the same trackable ID for admission, execution and completion.
    const runJob = await createRunTestsJob({
      projectId: snapshot.projectId,
      snapshotId,
      userId,
    });
    await addJobToQueue("RUN_TESTS", runJob.id);
    return res.status(200).json({
      success: true,
      message: "Coverage pipeline started.",
      jobId: runJob.id,
      installJobId: runJob.id,
      snapshotId,
      reused: Boolean(runJob.reused),
      hint: "Poll GET /api/job/:jobId to track status.",
    });
  } catch (error) {
    console.error("[RunCoverage] Server error:", error);
    if (error instanceof ServiceError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: "Internal server error!" });
  }
};

/**
 * POST /api/coverage/:snapshotId/supertest/run
 * Queues a dedicated Supertest integration coverage job.
 */
export const runSupertestCoverage = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId || typeof snapshotId !== "string" || !snapshotId.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid snapshotId." });
    }

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        rootDir: true,
        project: { select: { ownerId: true } },
      },
    });
    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "tests.run",
    });
    if (!snapshot.rootDir)
      return res.status(409).json({
        success: false,
        message: "Snapshot is not ready to run tests.",
      });

    const resolvedRootDir =
      resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;

    const candidateDirs = [
      "",
      "server",
      "backend",
      "api",
      "client",
      "frontend",
      "web",
      "app",
    ];
    const hasPackageJson = candidateDirs.some((cand) =>
      fs.existsSync(
        cand
          ? path.join(snapshot.rootDir, cand, "package.json")
          : path.join(resolvedRootDir, "package.json"),
      ),
    );
    if (
      !hasPackageJson &&
      !hasSourceCodeFiles(resolvedRootDir) &&
      !hasSourceCodeFiles(snapshot.rootDir)
    ) {
      return res.status(422).json({
        success: false,
        message:
          "Invalid Node.js project: package.json was not found in the uploaded project.",
      });
    }

    const supertestInfo = await detectSupertest(resolvedRootDir);
    let hasDbAiTests = false;
    if (!supertestInfo.detected || supertestInfo.supertestFiles.length === 0) {
      if (typeof prisma?.aiTest?.count === "function") {
        const aiCount = await prisma.aiTest
          .count({ where: { snapshotId } })
          .catch(() => 0);
        hasDbAiTests = aiCount > 0;
      }
      if (!hasDbAiTests) {
        return res.status(422).json({
          success: false,
          message: "No Supertest test files were found in this snapshot.",
        });
      }
    }

    const targetEndpoint = req.body?.targetEndpoint || null;
    const targetEndpoints = Array.isArray(req.body?.targetEndpoints)
      ? req.body.targetEndpoints.filter(Boolean)
      : [];
    const targetTestNames = Array.isArray(req.body?.targetTestNames)
      ? req.body.targetTestNames.filter(Boolean)
      : [];
    const selectedScenarioIds = Array.isArray(req.body?.selectedScenarioIds)
      ? req.body.selectedScenarioIds.filter(Boolean)
      : [];
    const supertestPayload = {
      ...(targetEndpoint ? { targetEndpoint } : {}),
      ...(targetEndpoints.length > 0 ? { targetEndpoints } : {}),
      ...(targetTestNames.length > 0 ? { targetTestNames } : {}),
      ...(selectedScenarioIds.length > 0 ? { selectedScenarioIds } : {}),
    };
    const hasPayload = Object.keys(supertestPayload).length > 0;

    const isTargetedRun =
      targetTestNames.length > 0 || selectedScenarioIds.length > 0;
    const { detectIntegrationFrameworks } =
      await import("../services/integrationDetection.service.js");
    const intDetect = await detectIntegrationFrameworks(resolvedRootDir);
    const hasIntDeps = Boolean(
      intDetect?.hasDependencies ?? intDetect?.summary?.hasDependencies,
    );
    const hasInstalledNodeModules =
      fs.existsSync(path.join(resolvedRootDir, "node_modules")) ||
      ["server", "backend", "api"].some((sub) =>
        fs.existsSync(path.join(resolvedRootDir, sub, "node_modules")),
      );

    if ((isTargetedRun || hasInstalledNodeModules) && hasIntDeps) {
      const job = await createSupertestCoverageJob({
        projectId: snapshot.projectId,
        snapshotId,
        userId,
        ...(hasPayload ? { payloadJson: supertestPayload } : {}),
      });
      await addJobToQueue(
        "SUPERTEST_COVERAGE",
        job.id,
        hasPayload ? supertestPayload : {},
      );

      return res.status(202).json({
        success: true,
        message:
          "Supertest coverage job queued (dependencies already present).",
        jobId: job.id,
        snapshotId,
        supertestFileCount: supertestInfo.supertestFiles.length,
      });
    }

    // Snapshots without node_modules yet: install dependencies first.
    const installJob = await createInstallDepsJob({
      projectId: snapshot.projectId,
      snapshotId,
      userId,
    });
    const job = await createSupertestCoverageJob({
      projectId: snapshot.projectId,
      snapshotId,
      userId,
      ...(hasPayload ? { payloadJson: supertestPayload } : {}),
    });

    // Queue Supertest pipeline with correct BullMQ dependency direction:
    // SUPERTEST_COVERAGE_PIPELINE (parent) waits for INSTALL_DEPS (child)
    try {
      await addSupertestCoveragePipeline(installJob.id, job.id);
    } catch (error) {
      console.error(`[Supertest Pipeline] Error queuing pipeline:`, error);
      throw error;
    }

    return res.status(202).json({
      success: true,
      message:
        "Supertest coverage pipeline queued (install dependencies, then run tests).",
      jobId: job.id,
      installJobId: installJob.id,
      snapshotId,
      supertestFileCount: supertestInfo.supertestFiles.length,
    });
  } catch (error) {
    console.error("[RunSupertestCoverage] Server error:", error);
    if (error instanceof ServiceError)
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: "Unable to queue Supertest coverage." });
  }
};

/**
 * SCRUM-155: Create files endpoint
 * SCRUM-156: Verify permissions
 * SCRUM-157: Retrieve CoverageFile records
 * SCRUM-158: Support sorting
 *
 * GET /api/coverage/:snapshotId/files
 *
 * Query params:
 *  - sortBy   : "filePath" | "linesPct" | "branchesPct" | "funcsPct" | "stmtsPct"  (default: "filePath")
 *  - order    : "asc" | "desc"  (default: "asc")
 *  - page     : number >= 1     (default: 1)
 *  - limit    : number 1-200    (default: 50)
 */
export const getCoverageFiles = async (req, res) => {
  try {
    // ── Auth ────────────────────────────────────────────────────────────
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // ── SCRUM-155: Validate params ───────────────────────────────────────
    const { snapshotId } = req.params;
    if (
      !snapshotId ||
      typeof snapshotId !== "string" ||
      snapshotId.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid snapshotId." });
    }

    // ── SCRUM-158: Parse & validate sorting params ───────────────────────
    const rawSortBy = req.query.sortBy ?? "filePath";
    const rawOrder = req.query.order ?? "asc";

    const sortBy = ALLOWED_SORT_FIELDS.includes(rawSortBy)
      ? rawSortBy
      : "filePath";
    const order = ALLOWED_SORT_ORDERS.includes(rawOrder) ? rawOrder : "asc";

    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      1000,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const skip = (page - 1) * limit;

    // ── SCRUM-156: Verify permissions ────────────────────────────────────
    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        source: true,
        commitSha: true,
        createdAt: true,
        project: {
          select: { ownerId: true, name: true },
        },
      },
    });

    if (!snapshot) {
      return res
        .status(404)
        .json({ success: false, message: "Snapshot does not exist." });
    }

    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    // ── SCRUM-157: Retrieve CoverageFile records ─────────────────────────
    const typeFilter = req.query?.type || req.query?.coverageType || null;
    const baseExclusions = [
      { NOT: { filePath: { contains: "coverage/" } } },
      { NOT: { filePath: { contains: "coverage\\" } } },
      { NOT: { filePath: { contains: "node_modules/" } } },
      { NOT: { filePath: { contains: "node_modules\\" } } },
      { NOT: { filePath: { contains: ".git/" } } },
    ];
    const where = {
      snapshotId,
      AND: [
        ...baseExclusions,
        ...(typeFilter === "unit"
          ? [
              { NOT: { filePath: { contains: "/specs/" } } },
              { NOT: { filePath: { contains: "\\specs\\" } } },
              { NOT: { filePath: { contains: "/tests/" } } },
              { NOT: { filePath: { contains: "\\tests\\" } } },
              { NOT: { filePath: { contains: "/__tests__/" } } },
              { NOT: { filePath: { contains: "\\__tests__\\" } } },
              { NOT: { filePath: { contains: ".test." } } },
              { NOT: { filePath: { contains: ".spec." } } },
              { NOT: { filePath: { contains: ".steps." } } },
              { NOT: { filePath: { contains: "step-definitions" } } },
              { NOT: { filePath: { contains: "client/" } } },
              { NOT: { filePath: { contains: "frontend/" } } },
              { NOT: { filePath: { contains: "examples/" } } },
              { NOT: { filePath: { contains: "examples\\" } } },
              { NOT: { filePath: { contains: "demo/" } } },
              { NOT: { filePath: { contains: "demo\\" } } },
              { NOT: { filePath: { contains: "sample/" } } },
              { NOT: { filePath: { contains: "sample\\" } } },
              { NOT: { filePath: { contains: ".config." } } },
              { NOT: { filePath: { endsWith: "types.ts" } } },
              { NOT: { filePath: { endsWith: "types.js" } } },
              { NOT: { filePath: { contains: "/types/" } } },
              { NOT: { filePath: { contains: "\\types\\" } } },
              { NOT: { filePath: { contains: "/hooks/" } } },
              { NOT: { filePath: { contains: "\\hooks\\" } } },
              { NOT: { filePath: { contains: "/i18n/" } } },
              { NOT: { filePath: { contains: "\\i18n\\" } } },
              { NOT: { filePath: { contains: "/context/" } } },
              { NOT: { filePath: { contains: "\\context\\" } } },
              { NOT: { filePath: { contains: "/components/" } } },
              { NOT: { filePath: { contains: "\\components\\" } } },
              { NOT: { filePath: { endsWith: ".jsx" } } },
              { NOT: { filePath: { endsWith: ".tsx" } } },
              { NOT: { filePath: { contains: "routes/" } } },
              { NOT: { filePath: { contains: "endpoints/" } } },
              { NOT: { filePath: { endsWith: "app.js" } } },
              { NOT: { filePath: { endsWith: "app.ts" } } },
              { NOT: { filePath: { endsWith: "server.js" } } },
              { NOT: { filePath: { endsWith: "server.ts" } } },
              { NOT: { filePath: { contains: "presets/tier" } } },
              { NOT: { filePath: { contains: "presets\\tier" } } },
            ]
          : []),
      ],
    };

    let files = [];
    let total = 0;

    if (typeFilter === "unit") {
      const cachedUnitFiles = unitFilesCache.get(snapshotId);
      const now = Date.now();

      if (
        cachedUnitFiles &&
        now - cachedUnitFiles.timestamp < UNIT_FILES_CACHE_TTL_MS
      ) {
        // Cache hit: zero database queries and zero disk scan
        let allFiles = cachedUnitFiles.allFiles;

        allFiles.sort((a, b) => {
          let valA = a[sortBy];
          let valB = b[sortBy];
          if (typeof valA === "string") {
            return order === "desc"
              ? valB.localeCompare(valA)
              : valA.localeCompare(valB);
          }
          valA = Number(valA || 0);
          valB = Number(valB || 0);
          return (
            (order === "desc" ? valB - valA : valA - valB) ||
            a.filePath.localeCompare(b.filePath)
          );
        });

        total = allFiles.length;
        files = allFiles.slice(skip, skip + limit);
      } else {
        // Cold build: load all DB files once, merge with logic files, and cache
        const [dbFiles, snapshotWithRoot] = await Promise.all([
          prisma.coverageFile.findMany({
            where,
            select: {
              id: true,
              filePath: true,
              linesPct: true,
              branchesPct: true,
              funcsPct: true,
              stmtsPct: true,
            },
          }),
          prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: { rootDir: true },
          }),
        ]);

        const effectiveRoot = snapshotWithRoot?.rootDir
          ? resolveSnapshotRootDir(snapshotWithRoot.rootDir) ||
            snapshotWithRoot.rootDir
          : "";
        const configExclusions =
          extractProjectCoverageExclusions(effectiveRoot);

        const seen = new Map();
        const seenByMatchKey = new Map();

        for (const f of dbFiles) {
          const can =
            resolveProjectRelativePath(f.filePath, effectiveRoot) || f.filePath;
          if (!isBusinessLogicSourceFile(can, configExclusions)) continue;

          const matchKey = getNormalizedMatchKey(can);
          const existingKey = seen.has(can)
            ? can
            : seenByMatchKey.get(matchKey) || null;

          if (!existingKey) {
            seen.set(can, { ...f, filePath: can });
            seenByMatchKey.set(matchKey, can);
          } else {
            const existing = seen.get(existingKey);
            const currentHasCoverage =
              (f.linesPct || 0) > 0 || (f.stmtsPct || 0) > 0;
            const existingHasCoverage =
              (existing.linesPct || 0) > 0 || (existing.stmtsPct || 0) > 0;

            if (
              (!existingHasCoverage && currentHasCoverage) ||
              (existingKey !== can &&
                can.length > existingKey.length &&
                !existingHasCoverage)
            ) {
              seen.delete(existingKey);
              seen.set(can, { ...f, filePath: can });
              seenByMatchKey.set(matchKey, can);
            } else if (
              existingKey !== can &&
              can.length > existingKey.length &&
              existingHasCoverage &&
              currentHasCoverage
            ) {
              seen.delete(existingKey);
              seen.set(can, { ...existing, filePath: can });
              seenByMatchKey.set(matchKey, can);
            }
          }
        }

        if (effectiveRoot) {
          const logicFiles = findLogicSourceFiles(effectiveRoot);
          for (let idx = 0; idx < logicFiles.length; idx++) {
            const lf = logicFiles[idx];
            const can = resolveProjectRelativePath(
              lf.relativePath,
              effectiveRoot,
            );
            if (!isBusinessLogicSourceFile(can, configExclusions)) continue;

            const matchKey = getNormalizedMatchKey(can);
            const existingKey = seen.has(can)
              ? can
              : seenByMatchKey.get(matchKey) || null;

            if (!existingKey) {
              seen.set(can, {
                id: `logic_${idx}_${path.basename(can)}`,
                filePath: can,
                linesPct: 0,
                branchesPct: 0,
                funcsPct: 0,
                stmtsPct: 0,
              });
              seenByMatchKey.set(matchKey, can);
            } else if (existingKey !== can) {
              const existing = seen.get(existingKey);
              seen.delete(existingKey);
              seen.set(can, { ...existing, filePath: can });
              seenByMatchKey.set(matchKey, can);
            }
          }
        }

        const assembledFiles = Array.from(seen.values());
        unitFilesCache.set(snapshotId, {
          allFiles: assembledFiles,
          timestamp: now,
        });

        assembledFiles.sort((a, b) => {
          let valA = a[sortBy];
          let valB = b[sortBy];
          if (typeof valA === "string") {
            return order === "desc"
              ? valB.localeCompare(valA)
              : valA.localeCompare(valB);
          }
          valA = Number(valA || 0);
          valB = Number(valB || 0);
          return (
            (order === "desc" ? valB - valA : valA - valB) ||
            a.filePath.localeCompare(b.filePath)
          );
        });

        total = assembledFiles.length;
        files = assembledFiles.slice(skip, skip + limit);
      }
    } else {
      // Non-unit types: direct paginated database query
      const [queriedFiles, countTotal] = await Promise.all([
        prisma.coverageFile.findMany({
          where,
          orderBy: { [sortBy]: order },
          skip,
          take: limit,
          select: {
            id: true,
            filePath: true,
            linesPct: true,
            branchesPct: true,
            funcsPct: true,
            stmtsPct: true,
          },
        }),
        prisma.coverageFile.count({ where }),
      ]);
      files = queriedFiles;
      total = countTotal;
    }

    // Return an empty dataset instead of a 404 so the UI can render a valid
    // "no coverage generated yet" state without treating it as a broken API.
    return res.status(200).json({
      success: true,
      data: {
        snapshotId: snapshot.id,
        projectId: snapshot.projectId,
        projectName: snapshot.project.name,
        source: snapshot.source,
        commitSha: snapshot.commitSha ?? null,
        snapshotCreatedAt: snapshot.createdAt,
        sorting: { sortBy, order },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        files: files.map((f) => ({
          ...f,
          filePath: cleanStoragePath(f.filePath) || f.filePath,
        })),
      },
    });
  } catch (error) {
    console.error("[CoverageFiles] Server error:", error);
    if (error instanceof ServiceError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: "Internal server error!" });
  }
};

/**
 * SCRUM-160: Create functions endpoint
 * SCRUM-161: Verify permissions
 * SCRUM-162: Retrieve CoverageFunction records
 * SCRUM-163: Support filtering by file
 *
 * GET /api/coverage/:snapshotId/functions
 *
 * Query params:
 *  - filePath : string  (optional) — filter functions by file path (SCRUM-163, partial match)
 *  - sortBy   : "functionName" | "filePath" | "hit" | "startLine"  (default: "filePath")
 *  - order    : "asc" | "desc"  (default: "asc")
 *  - page     : number >= 1     (default: 1)
 *  - limit    : number 1-200    (default: 50)
 */
export const getTestExecution = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { projectId: true, project: { select: { ownerId: true } } },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    const testRuns =
      (prisma.testRun?.findMany
        ? await prisma.testRun
            .findMany({
              where: { snapshotId },
              include: { scenarios: true },
              orderBy: { createdAt: "desc" },
              take: 40,
            })
            .catch(() => [])
        : []) || [];

    // Map to expected frontend structure with sanitized paths
    const { summarizeUnitFailure } =
      await import("../../../shared/unitTestCaseCoverage.js");
    const sanitizeRun = (r) => {
      if (!r) return null;
      return {
        ...r,
        scenarios: r.scenarios?.map((s) => {
          const cleanedFailureMsgs = (s.failureMessages || []).map((m) =>
            cleanStorageText(m),
          );
          const statusUpper = String(s.status || "").toUpperCase();
          return {
            ...s,
            testFile: cleanStoragePath(s.testFile) || null,
            failureMessages: cleanedFailureMsgs,
            ...(statusUpper === "FAILED" || statusUpper === "FAIL"
              ? {
                  failureSummary:
                    s.failureSummary ||
                    summarizeUnitFailure(cleanedFailureMsgs),
                }
              : {}),
          };
        }),
      };
    };

    // Merge scenarios across recent runs of the same type (newest run wins per testFile + title)
    // so a targeted run on 1 file never wipes out other files' test scenarios on reload.
    const latestByType = (type) => {
      const runsOfType = testRuns.filter((r) => r.type === type);
      if (runsOfType.length === 0) return null;
      const latest = sanitizeRun(runsOfType[0]);
      if (runsOfType.length === 1) return latest;

      const mergedMap = new Map();
      for (const run of runsOfType) {
        const sanitized = sanitizeRun(run);
        for (const sc of sanitized?.scenarios || []) {
          const key = `${String(sc.testFile || "").toLowerCase()}::${String(sc.title || "").trim().toLowerCase()}`;
          if (!mergedMap.has(key)) {
            mergedMap.set(key, sc);
          }
        }
      }
      const mergedScenarios = Array.from(mergedMap.values());
      const passedCount = mergedScenarios.filter((s) =>
        ["PASSED", "PASS"].includes(String(s.status || "").toUpperCase()),
      ).length;
      const failedCount = mergedScenarios.filter((s) =>
        ["FAILED", "FAIL"].includes(String(s.status || "").toUpperCase()),
      ).length;
      return {
        ...latest,
        scenarios: mergedScenarios,
        totalTests: Math.max(Number(latest.totalTests || 0), mergedScenarios.length),
        passedTests: Math.max(Number(latest.passedTests || 0), passedCount),
        failedTests: failedCount,
      };
    };

    // Recover persisted unit test suggestions from completed UNIT_TEST_SUGGEST jobs in DB
    // so reloading the browser never loses generated unit test scenarios.
    const persistedSuggestions = {};
    if (prisma.job?.findMany) {
      const suggestJobs = await prisma.job
        .findMany({
          where: { snapshotId, type: "UNIT_TEST_SUGGEST", status: "SUCCESS" },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, resultJson: true, createdAt: true },
        })
        .catch(() => []);
      for (const j of suggestJobs) {
        let parsed = null;
        try {
          parsed =
            typeof j.resultJson === "string"
              ? JSON.parse(j.resultJson)
              : j.resultJson;
        } catch {
          parsed = null;
        }
        const list = Array.isArray(parsed?.suggestions)
          ? parsed.suggestions
          : [];
        for (const s of list) {
          const srcKey = cleanStoragePath(s?.sourceFile || "");
          if (!srcKey) continue;
          const fw = String(s?.framework || "jest").toLowerCase();
          if (!Array.isArray(persistedSuggestions[srcKey])) {
            persistedSuggestions[srcKey] = [];
          }
          const alreadyHasFw = persistedSuggestions[srcKey].some(
            (existing) =>
              String(existing?.framework || "jest").toLowerCase() === fw,
          );
          if (!alreadyHasFw) {
            persistedSuggestions[srcKey].push(s);
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        jest: latestByType("JEST"),
        vitest: latestByType("VITEST"),
        supertest: latestByType("SUPERTEST"),
        playwright: latestByType("PLAYWRIGHT"),
        cypress: latestByType("CYPRESS"),
        persistedSuggestions,
      },
    });
  } catch (error) {
    console.error("[getTestExecution] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: "Server error." });
  }
};

const isGenericTitle = (raw, cleanFileName) => {
  if (!raw) return true;
  const lower = raw.toLowerCase().trim();
  if (
    lower === cleanFileName ||
    lower === `${cleanFileName}.js` ||
    lower === `${cleanFileName}.ts` ||
    lower.endsWith(".service") ||
    lower.endsWith(".controller") ||
    lower.endsWith(".middleware") ||
    lower.endsWith(".validation") ||
    lower.endsWith(".util") ||
    lower.endsWith(".helper") ||
    lower.includes("unit test") ||
    lower.includes("test suite") ||
    lower.includes("tests for") ||
    lower.includes("test case") ||
    lower.startsWith("describe ")
  ) {
    return true;
  }
  return false;
};

export const extractTargetFunction = (a, fileName, knownFunctions = []) => {
  const ancestors = Array.isArray(a.ancestorTitles) ? a.ancestorTitles : [];
  const cleanFileName = (fileName || "")
    .replace(/\\.(test|spec|testcase|steps?)\.[a-z0-9]+$/i, "")
    .replace(/^[._]/, "")
    .toLowerCase();

  // 1. Check ancestors backwards (from deepest describe block upwards)
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const raw = ancestors[i]?.trim();
    if (!raw || isGenericTitle(raw, cleanFileName)) continue;

    const cleaned = raw
      .replace(/^(function|method|fn)\s+/i, "")
      .replace(/\(\)$/, "")
      .replace(/^#/, "")
      .trim();

    if (cleaned && !isGenericTitle(cleaned, cleanFileName)) {
      return cleaned;
    }
  }

  // 2. Cross-reference against knownFunctions of the file
  const fullText = `${a.fullName || ""} ${a.title || ""}`;
  const fullTextCompressed = fullText.replace(/[^a-z0-9]/gi, "").toLowerCase();

  if (Array.isArray(knownFunctions) && knownFunctions.length > 0) {
    // 2a. Direct word boundary match
    for (const fn of knownFunctions) {
      if (fn && typeof fn === "string" && fn.length > 1) {
        const regex = new RegExp(
          `\\b${fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i",
        );
        if (regex.test(fullText)) {
          return fn;
        }
      }
    }

    // 2b. Check compressed string match (e.g. "run cache benchmark" matches "runcachebenchmark")
    for (const fn of knownFunctions) {
      if (fn && typeof fn === "string" && fn.length > 2) {
        const fnCompressed = fn.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (fullTextCompressed.includes(fnCompressed)) {
          return fn;
        }
      }
    }

    // 2c. If the file only has 1 known function, all its tests target that function
    if (knownFunctions.length === 1 && knownFunctions[0]) {
      return knownFunctions[0];
    }
  }

  // 3. Try to extract from title: e.g. "register: should hash...", "login - should fail", "getUser() returns user"
  const titleMatch = (a.title || "").match(
    /^([a-zA-Z0-9_$]+)(?:\(\))?\s*[:\-–—\s]/,
  );
  if (titleMatch && titleMatch[1]) {
    const cand = titleMatch[1];
    const lowerCand = cand.toLowerCase();
    if (
      ![
        "should",
        "it",
        "test",
        "when",
        "given",
        "returns",
        "verify",
        "can",
        "must",
        "expect",
        "throws",
      ].includes(lowerCand)
    ) {
      return cand;
    }
  }

  return null;
};

/**
 * Classifies an assertion into one of the 4 test categories:
 * - Category A: HAPPY_PATH (Happy Path / Standard flow)
 * - Category B: BOUNDARY_VALUES (Boundary values: 0, -1, empty, max limits)
 * - Category C: BRANCH_TOGGLING (Condition branches, fallback, falsy/truthy)
 * - Category D: ERROR_HANDLING (Exceptions, throw, reject, error handling)
 */
export const classifyTestCategory = (a, title = "", ancestorTitles = []) => {
  const fullText = [
    title || a?.title || a?.fullName || "",
    ...(Array.isArray(ancestorTitles)
      ? ancestorTitles
      : a?.ancestorTitles || []),
  ]
    .join(" ")
    .toLowerCase();

  // 1. Category D: Error & Exception Handling
  if (
    /\b(error|throw|throws|exception|reject|rejects|catch|fail|failed|failure|invalid|malformed|unauthorized|forbidden|not\s*found|crash|abort)\b/i.test(
      fullText,
    ) ||
    /\b(500|400|401|403|404|422)\b/.test(fullText)
  ) {
    return {
      category: "ERROR_HANDLING",
      categoryName: "D. Error & Exception Handling",
      categoryBadge: "Error Handling",
      categoryColor: "#ef4444",
    };
  }

  // 2. Category B: Boundary Value Analysis
  if (
    /\b(bound|boundary|extreme|limits?|edge\s*cases?|empty|zero|\b0\b|-1|negative|null|undefined|nan|max|min|overflow|underflow|whitespace|blank)\b/i.test(
      fullText,
    ) ||
    /\[\s*\]|\{\s*\}|""|''/.test(fullText)
  ) {
    return {
      category: "BOUNDARY_VALUES",
      categoryName: "B. Boundary Values",
      categoryBadge: "Boundary Value",
      categoryColor: "#f59e0b",
    };
  }

  // 3. Category C: Branch Toggling
  if (
    /\b(branch|branches|toggle|condition|conditional|if|else|switch|case|when|fallback|default|optional|ternary|without|falsy|truthy|neither|either|boolean|flag)\b/i.test(
      fullText,
    ) ||
    /\b(or|and|\?\?|\|\||\?\.)\b/.test(fullText)
  ) {
    return {
      category: "BRANCH_TOGGLING",
      categoryName: "C. Branch Toggling",
      categoryBadge: "Branch Toggling",
      categoryColor: "#0284c7",
    };
  }

  // 4. Category A: Happy Path (Default standard successful flow)
  return {
    category: "HAPPY_PATH",
    categoryName: "A. Happy Path",
    categoryBadge: "Happy Path",
    categoryColor: "#10b981",
  };
};

/**
 * Extract a repo-relative path from a test suite name.
 * Handles both Docker paths (/app/storage/.../repo/foo.test.js)
 * and Windows paths (D:\...\storage\...\repo\foo.test.js).
 * Returns the part after the last occurrence of /repo/ (or \repo\).
 */
const extractRepoRelativePath = (suiteName) => {
  if (!suiteName) return "";
  const normalized = suiteName.replace(/\\/g, "/");
  // Match everything after the last /repo/
  const repoMatch = normalized.match(/(?:\/|^)repo\/(.+)$/i);
  if (repoMatch) return repoMatch[1];
  // Fallback: match storage/projects/<id>/.../<ts>/repo/ pattern
  const storageMatch = normalized.match(
    /storage\/projects\/[^/]+(?:\/[^/]+)*?\/repo\/(.+)$/i,
  );
  if (storageMatch) return storageMatch[1];
  return normalized;
};

/**
 * GET /api/coverage/:snapshotId/test-suites?type=unit|integration|system
 * Returns test files executed for this snapshot, with classification and test case counts.
 * For type=unit: strictly returns Jest and Vitest test files only.
 */
export const mapCoverageSuiteResult = (suiteResult) => {
  const assertions = (suiteResult?.assertionResults || [])
    .filter(Boolean)
    .map((a) => ({
      ...a,
      title: a.title || a.fullName || "Test case",
      status: (a.status || "pending").toLowerCase(),
      ...(typeof a.message === "string"
        ? { message: stripAnsi(a.message) }
        : {}),
      ...(Array.isArray(a.failureMessages)
        ? { failureMessages: a.failureMessages.map(stripAnsi) }
        : {}),
    }));
  const passedTests = Math.max(
    assertions.filter((a) => a.status === "passed").length,
    suiteResult?.numPassingTests || 0,
  );
  const failedTests = Math.max(
    assertions.filter((a) => a.status === "failed").length,
    suiteResult?.numFailingTests || 0,
  );
  const totalTests = Math.max(
    assertions.length,
    passedTests + failedTests + (suiteResult?.numPendingTests || 0),
  );
  const status =
    suiteResult?.status?.toLowerCase() === "failed" || failedTests > 0
      ? "failed"
      : passedTests > 0
        ? "passed"
        : "pending";
  return {
    assertions,
    passedTests,
    failedTests,
    totalTests,
    status,
    ...(typeof suiteResult?.message === "string"
      ? { message: stripAnsi(suiteResult.message) }
      : {}),
  };
};

export const storedTestRunSuites = (runs) => {
  const latestTypes = new Set();
  const suites = [];
  // Runs arrive newest first. Never combine old assertions with the latest run.
  for (const run of runs) {
    if (latestTypes.has(run.type)) continue;
    latestTypes.add(run.type);
    const byFile = new Map();
    for (const scenario of run.scenarios || []) {
      if (!scenario.testFile) continue;
      if (!byFile.has(scenario.testFile))
        byFile.set(scenario.testFile, {
          name: scenario.testFile,
          assertionResults: [],
        });
      byFile.get(scenario.testFile).assertionResults.push(scenario);
    }
    suites.push(...byFile.values());
  }
  return suites;
};

export const getCoverageTestSuites = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    const requestedType = (req.query.type || "unit").toLowerCase();

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        rootDir: true,
        project: { select: { ownerId: true } },
      },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    const cacheKey = `${snapshotId}:${requestedType}`;
    const cached = testSuitesCache.get(cacheKey);
    const shouldBypassCache =
      req.query?.refresh === "true" ||
      req.headers?.["cache-control"] === "no-cache";
    const TEST_SUITES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    if (
      !shouldBypassCache &&
      cached &&
      Date.now() - cached.timestamp < TEST_SUITES_CACHE_TTL_MS
    ) {
      return res.status(200).json({ success: true, data: cached.data });
    }

    const snapshotRootDir = resolveSnapshotRootDir(snapshot.rootDir);
    if (!snapshotRootDir || !fs.existsSync(snapshotRootDir)) {
      return res.status(200).json({ success: true, data: { testSuites: [] } });
    }

    // Retrieve known functions for snapshot to cross-reference
    const coverageFunctions = await prisma.coverageFunction
      .findMany({
        where: { snapshotId },
        select: { filePath: true, functionName: true },
      })
      .catch(() => []);

    const functionsByBaseName = new Map();
    for (const cf of coverageFunctions) {
      const base = path
        .basename(cf.filePath || "")
        .replace(/\.[^.]+$/, "")
        .toLowerCase();
      if (!functionsByBaseName.has(base)) functionsByBaseName.set(base, []);
      if (
        cf.functionName &&
        !cf.functionName.startsWith("(") &&
        !cf.functionName.startsWith("anonymous")
      ) {
        functionsByBaseName.get(base).push(cf.functionName);
      }
    }

    const norm = (p) =>
      (p || "")
        .replace(/\\/g, "/")
        .replace(/^\.?\//, "")
        .trim();

    // 1. Locate test-results.json and separate Jest vs Vitest results
    // Operation workspaces may be gone; persisted scenarios still describe the run.
    const storedRuns =
      requestedType === "unit"
        ? await prisma.testRun.findMany({
            where: { snapshotId, type: { in: ["JEST", "VITEST"] } },
            include: { scenarios: true },
            orderBy: { createdAt: "desc" },
          })
        : [];
    const loadTestResultsFromPaths = (paths, storedSuites = []) => {
      const list = [...storedSuites];
      const seen = new Set();
      for (const p of paths) {
        if (fs.existsSync(p) && !seen.has(p)) {
          seen.add(p);
          try {
            const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
            if (Array.isArray(parsed?.testResults)) {
              list.push(...parsed.testResults);
            }
          } catch (_) {}
        }
      }
      const map = new Map();
      for (const suite of list) {
        // extractRepoRelativePath handles Docker paths like /app/storage/.../repo/foo.test.js
        // path.relative() fails when mixing Docker linux paths with Windows host paths
        const repoRelative = suite.name
          ? norm(
              canonicalizeFilePath(suite.name, snapshotRootDir) ||
                extractRepoRelativePath(suite.name),
            )
          : "";
        if (!repoRelative) continue;
        map.set(repoRelative, suite);
        // Also index by shorter relative path (strip first directory segment)
        map.set(repoRelative.replace(/^[^/]+\//, ""), suite);
        // Also index with backend/ prefix
        if (!repoRelative.startsWith("backend/")) {
          map.set(`backend/${repoRelative}`, suite);
        }
        // Also index by basename for fallback matching
        map.set(path.basename(repoRelative), suite);
      }
      return map;
    };

    const findJsonFiles = (base, filename) => {
      const results = [
        path.join(base, "coverage", requestedType, filename),
        path.join(base, "coverage", filename),
        path.join(base, filename),
        path.join(base, "backend", "coverage", requestedType, filename),
        path.join(base, "backend", "coverage", filename),
        path.join(base, "backend", filename),
      ];
      try {
        const covDirs = [
          path.join(base, "coverage", requestedType),
          path.join(base, "coverage"),
        ];
        for (const covDir of covDirs) {
          if (fs.existsSync(covDir)) {
            for (const f of fs.readdirSync(covDir)) {
              if (
                f.endsWith(".json") &&
                f.includes(filename.replace(".json", ""))
              ) {
                results.push(path.join(covDir, f));
              }
            }
          }
        }
      } catch {}
      return results;
    };

    const jestResultsByPath = loadTestResultsFromPaths(
      findJsonFiles(snapshotRootDir, "jest-results.json"),
      storedTestRunSuites(storedRuns.filter((run) => run.type === "JEST")),
    );
    const vitestResultsByPath = loadTestResultsFromPaths(
      findJsonFiles(snapshotRootDir, "vitest-results.json"),
      storedTestRunSuites(storedRuns.filter((run) => run.type === "VITEST")),
    );
    const generalResultsByPath = loadTestResultsFromPaths(
      findJsonFiles(snapshotRootDir, "test-results.json"),
    );

    const resolveSuiteResult = (relPath, baseName, fw) => {
      const maps =
        fw === "jest"
          ? [jestResultsByPath, generalResultsByPath, vitestResultsByPath]
          : [vitestResultsByPath, generalResultsByPath, jestResultsByPath];

      for (const m of maps) {
        if (!m || m.size === 0) continue;
        const stripped = relPath.replace(/^[^/]+\//, "");
        const backendPrefixed = `backend/${relPath}`;
        const match =
          m.get(relPath) ||
          m.get(stripped) ||
          m.get(backendPrefixed) ||
          m.get(baseName);
        if (match) return match;

        for (const [key, val] of m.entries()) {
          if (
            key.endsWith("/" + baseName) ||
            key.endsWith(relPath) ||
            relPath.endsWith(key)
          ) {
            return val;
          }
        }
      }
      return null;
    };

    // 2. Discover test files in snapshot rootDir
    const testFiles = [];
    const scanDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          try {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (
                requestedType === "unit" &&
                (entry.name === "client" || entry.name === "frontend")
              ) {
                continue;
              }
              if (
                ![
                  "node_modules",
                  ".git",
                  "coverage",
                  "dist",
                  "build",
                  ".next",
                  ".vite",
                  ".vitest",
                  ".cache",
                  "test-data",
                  "test_data",
                  "fixtures",
                  "mocks",
                  "__mocks__",
                ].includes(entry.name)
              ) {
                scanDir(fullPath);
              }
            } else if (entry.isFile()) {
              const isSetupOrHelper =
                /^(setup|global-?setup|setup-?tests|teardown|helpers?|mocks?|fixtures?|config|utils?)\.[a-z0-9]+$/i.test(
                  entry.name,
                );
              const relPathNorm = fullPath.replace(/\\/g, "/").toLowerCase();
              const isExplicitTestName =
                /\.(test|spec|testcase|steps?)\.[a-z0-9]+$/i.test(entry.name);
              const isHelperDir =
                /(^|\/)(test-data|test_data|fixtures?|helpers?|mocks?|__mocks__|utils?|support)\//i.test(
                  relPathNorm,
                );
              if (isSetupOrHelper || (isHelperDir && !isExplicitTestName)) {
                continue;
              }
              if (
                requestedType === "unit" &&
                (relPathNorm.includes("client/") ||
                  relPathNorm.includes("frontend/") ||
                  /\.[jt]sx$/i.test(entry.name))
              ) {
                continue;
              }
              const isTest =
                (isExplicitTestName ||
                  (/(^|\/)(tests?|__tests__|unit)\//i.test(relPathNorm) &&
                    !/\.(d\.ts|json|md|txt)$/i.test(entry.name))) &&
                /\.[cm]?[jt]sx?$/i.test(entry.name);
              if (isTest) {
                testFiles.push(fullPath);
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    };

    scanDir(snapshotRootDir);

    // 3. Classify and assemble test suites
    const suites = [];
    const seenSuites = new Set();
    for (const fullPath of testFiles) {
      const relPath = norm(path.relative(snapshotRootDir, fullPath));
      const cleanPath = cleanStoragePath(relPath) || relPath;
      if (seenSuites.has(cleanPath)) continue;
      seenSuites.add(cleanPath);
      const baseName = path.basename(fullPath);
      const lowerPath = relPath.toLowerCase();

      // Read content to detect framework imports
      let content = "";
      try {
        const buf = Buffer.alloc(8192);
        const fd = fs.openSync(fullPath, "r");
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);
        content = buf.toString("utf8", 0, bytesRead);
      } catch (_) {}

      // Framework classification using classifyTestFile
      const framework = classifyTestFile(content, relPath);
      let category = "unit";
      if (framework === "supertest") {
        category = "integration";
      } else if (framework === "playwright" || framework === "cypress") {
        category = "system";
      } else {
        category = "unit";
      }

      // Filter strictly by requested type!
      // If requestedType === "unit", ONLY return unit (Jest & Vitest)
      if (category !== requestedType) {
        continue;
      }

      // Exclude frontend / client / jsx / tsx for unit test suites
      if (
        requestedType === "unit" &&
        (lowerPath.includes("client/") ||
          lowerPath.includes("frontend/") ||
          /\.[jt]sx$/i.test(fullPath))
      ) {
        continue;
      }

      // Find matching execution results from framework-specific results map
      const suiteResult = resolveSuiteResult(relPath, baseName, framework);

      const cleanBase = baseName
        .replace(/\.(test|spec|testcase|steps?)\.[a-z0-9]+$/i, "")
        .toLowerCase();
      const fileKnownFunctions = functionsByBaseName.get(cleanBase) || [];

      const mappedSuite = mapCoverageSuiteResult(suiteResult);
      const assertions = mappedSuite.assertions.map((a) => {
        let targetFunction = null;
        try {
          targetFunction = extractTargetFunction(
            a,
            baseName,
            fileKnownFunctions,
          );
        } catch (_) {}
        const catInfo = classifyTestCategory(
          a,
          a?.title || a?.fullName,
          a?.ancestorTitles,
        );
        return {
          title: a?.title || a?.fullName || "Test case",
          status: a.status,
          ...(typeof a.message === "string" ? { message: a.message } : {}),
          ...(Array.isArray(a.failureMessages)
            ? { failureMessages: a.failureMessages }
            : {}),
          duration: typeof a?.duration === "number" ? a.duration : 0,
          targetFunction: targetFunction || null,
          ancestorTitles: Array.isArray(a?.ancestorTitles)
            ? a.ancestorTitles
            : [],
          category: catInfo.category,
          categoryName: catInfo.categoryName,
          categoryBadge: catInfo.categoryBadge,
          categoryColor: catInfo.categoryColor,
          line: a?.location?.line || a?.line || a?.startLine || null,
        };
      });

      // pending = file found but no executed assertions; failures take precedence.
      const { passedTests, failedTests, totalTests, status } = mappedSuite;

      const rawDuration =
        suiteResult?.endTime && suiteResult?.startTime
          ? suiteResult.endTime - suiteResult.startTime
          : suiteResult?.durationMs || suiteResult?.duration || 0;
      const durationMs = Math.max(0, Math.round(rawDuration));

      // Extract error message from failed suite (e.g. SyntaxError, compile error, failed assertions)
      let message = null;
      if (suiteResult && (suiteResult.status === "failed" || failedTests > 0)) {
        if (
          typeof suiteResult.failureMessage === "string" &&
          suiteResult.failureMessage
        ) {
          message = stripAnsi(suiteResult.failureMessage).slice(0, 1000);
        } else if (Array.isArray(suiteResult.failureMessage)) {
          message =
            suiteResult.failureMessage
              .filter(Boolean)
              .map(stripAnsi)
              .join("\n")
              .slice(0, 1000) || null;
        } else if (
          typeof suiteResult.message === "string" &&
          suiteResult.message
        ) {
          message = mappedSuite.message.slice(0, 1000);
        } else if (Array.isArray(suiteResult.assertionResults)) {
          const failedAssertion = suiteResult.assertionResults.find(
            (a) =>
              a &&
              a.status === "failed" &&
              Array.isArray(a.failureMessages) &&
              a.failureMessages.length > 0,
          );
          if (failedAssertion) {
            message =
              failedAssertion.failureMessages
                .filter(Boolean)
                .map(stripAnsi)
                .join("\n")
                .slice(0, 1000) || null;
          }
        }
      }

      // Determine explicit diagnostic reason if suite is pending/skipped
      let pendingReason = null;
      if (status === "pending") {
        const hasAnyTest =
          /\b(test|it|describe|scenario|suite|autoBindSteps|defineFeature|defineStep|loadFeature|loadFeatures|given|when|then|Given|When|Then|StepDefinitions|beforeEach|afterEach)\b/i.test(
            content,
          );
        if (!hasAnyTest) {
          pendingReason =
            "File contains no executable test or step-definition blocks (empty stub file).";
        } else if (suiteResult) {
          if (
            suiteResult.numPendingTests > 0 &&
            (suiteResult.numPassingTests || 0) +
              (suiteResult.numFailingTests || 0) ===
              0
          ) {
            pendingReason =
              "All test cases in this suite were skipped (e.g. test.skip, describe.skip, or xit).";
          } else if (
            suiteResult.status === "pending" ||
            suiteResult.status === "skipped"
          ) {
            pendingReason =
              "Test suite was explicitly skipped or bypassed during execution.";
          }
        } else {
          pendingReason =
            "Test suite was not executed by the test runner (not targeted by testMatch or excluded in configuration).";
        }
      }

      suites.push({
        filePath: cleanStoragePath(relPath) || relPath,
        fileName: baseName,
        framework,
        category,
        status,
        totalTests,
        passedTests,
        failedTests,
        durationMs,
        assertions,
        pendingReason,
        message: cleanStorageText(message || pendingReason),
      });
    }

    const responseData = {
      snapshotId,
      type: requestedType,
      totalSuites: suites.length,
      testSuites: suites,
    };
    testSuitesCache.set(cacheKey, {
      data: responseData,
      timestamp: Date.now(),
    });

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("[getCoverageTestSuites] Error:", error);
    return res.status(200).json({
      success: true,
      data: {
        snapshotId: req.params?.snapshotId || null,
        type: (req.query?.type || "unit").toLowerCase(),
        totalSuites: 0,
        testSuites: [],
      },
    });
  }
};

export const getCoverageFunctions = async (req, res) => {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // ── SCRUM-160: Validate route param ───────────────────────────────────
    const { snapshotId } = req.params;
    if (
      !snapshotId ||
      typeof snapshotId !== "string" ||
      snapshotId.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid snapshotId." });
    }

    // ── SCRUM-163: Parse filter + sorting + pagination ────────────────────
    const filePathFilter =
      typeof req.query.filePath === "string" &&
      req.query.filePath.trim().length > 0
        ? req.query.filePath.trim()
        : null;

    const rawSortBy = req.query.sortBy ?? "filePath";
    const rawOrder = req.query.order ?? "asc";
    const sortBy = ALLOWED_FUNC_SORT_FIELDS.includes(rawSortBy)
      ? rawSortBy
      : "filePath";
    const order = ALLOWED_SORT_ORDERS.includes(rawOrder) ? rawOrder : "asc";

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      2000,
      Math.max(1, parseInt(req.query.limit, 10) || 50),
    );
    const skip = (page - 1) * limit;

    // ── SCRUM-161: Verify permissions ─────────────────────────────────────
    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        source: true,
        commitSha: true,
        createdAt: true,
        rootDir: true,
        project: {
          select: { ownerId: true, name: true },
        },
      },
    });

    if (!snapshot) {
      return res
        .status(404)
        .json({ success: false, message: "Snapshot does not exist." });
    }

    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    // ── SCRUM-162: Retrieve CoverageFunction records ───────────────────────
    const typeFilter = req.query?.type || req.query?.coverageType || null;
    const where = {
      snapshotId,
      // SCRUM-163: optional filter by filePath (partial, case-insensitive)
      ...(filePathFilter && {
        filePath: { contains: filePathFilter, mode: "insensitive" },
      }),
      ...(typeFilter === "unit" && {
        AND: [
          { NOT: { filePath: { contains: "coverage/" } } },
          { NOT: { filePath: { contains: "client/" } } },
          { NOT: { filePath: { contains: "frontend/" } } },
          { NOT: { filePath: { contains: "examples/" } } },
          { NOT: { filePath: { contains: "demo/" } } },
          { NOT: { filePath: { contains: "sample/" } } },
          { NOT: { filePath: { contains: ".config." } } },
          { NOT: { filePath: { endsWith: "types.ts" } } },
          { NOT: { filePath: { endsWith: "types.js" } } },
          { NOT: { filePath: { contains: "/types/" } } },
          { NOT: { filePath: { contains: "/hooks/" } } },
          { NOT: { filePath: { contains: "/i18n/" } } },
          { NOT: { filePath: { contains: "/context/" } } },
          { NOT: { filePath: { contains: "/components/" } } },
          { NOT: { filePath: { contains: "tests/" } } },
          { NOT: { filePath: { contains: "specs/" } } },
          { NOT: { filePath: { contains: "fixtures/" } } },
          { NOT: { filePath: { contains: "mocks/" } } },
          { NOT: { filePath: { endsWith: ".jsx" } } },
          { NOT: { filePath: { endsWith: ".tsx" } } },
          { NOT: { filePath: { contains: "routes/" } } },
          { NOT: { filePath: { contains: "endpoints/" } } },
          { NOT: { filePath: { endsWith: "app.js" } } },
          { NOT: { filePath: { endsWith: "app.ts" } } },
          { NOT: { filePath: { endsWith: "server.js" } } },
          { NOT: { filePath: { endsWith: "server.ts" } } },
          { NOT: { filePath: { contains: "presets/tier" } } },
          { NOT: { filePath: { contains: "presets\\tier" } } },
        ],
      }),
    };

    // ── Milestone 1 (F3): Safe database pagination without synchronous Babel AST parsing ──
    let [functions, total, cycRecords, cfgRecords] = await Promise.all([
      prisma.coverageFunction.findMany({
        where,
        orderBy: { [sortBy]: order },
        skip,
        take: limit,
        select: {
          id: true,
          filePath: true,
          functionName: true,
          startLine: true,
          endLine: true,
          hit: true,
        },
      }),
      prisma.coverageFunction.count({ where }),
      prisma.cyclomatic?.findMany
        ? prisma.cyclomatic
            .findMany({
              where: { snapshotId },
              select: {
                id: true,
                cfgId: true,
                filePath: true,
                functionName: true,
                value: true,
              },
            })
            .catch(() => [])
        : Promise.resolve([]),
      prisma.cfg?.findMany
        ? prisma.cfg
            .findMany({
              where: { snapshotId },
              select: {
                id: true,
                filePath: true,
                functionName: true,
                startLine: true,
              },
            })
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    const normPath = (p = "") =>
      p.replace(/\\/g, "/").replace(/^(backend|server|app)\//i, "");
    const cycByFile = new Map();
    for (const c of cycRecords || []) {
      const fp = normPath(c.filePath);
      if (!cycByFile.has(fp)) cycByFile.set(fp, []);
      cycByFile.get(fp).push(c);
    }
    const cfgByFile = new Map();
    for (const g of cfgRecords || []) {
      const fp = normPath(g.filePath);
      if (!cfgByFile.has(fp)) cfgByFile.set(fp, []);
      cfgByFile.get(fp).push(g);
    }

    // Return an empty dataset instead of a 404 so the UI can render a valid
    // empty coverage state while tests are still running or no tests exist.
    return res.status(200).json({
      success: true,
      data: {
        snapshotId: snapshot.id,
        projectId: snapshot.projectId,
        projectName: snapshot.project.name,
        source: snapshot.source,
        commitSha: snapshot.commitSha ?? null,
        snapshotCreatedAt: snapshot.createdAt,
        filter: { filePath: filePathFilter },
        sorting: { sortBy, order },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        functions: functions.map((f) => {
          const effectiveRoot = snapshot.rootDir
            ? resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir
            : "";
          const canonicalPath =
            canonicalizeFilePath(f.filePath, effectiveRoot) ||
            cleanStoragePath(f.filePath) ||
            f.filePath;
          const fNorm = normPath(f.filePath);
          const fileCycs = cycByFile.get(fNorm) || [];
          const fileCfgs = cfgByFile.get(fNorm) || [];

          // Match cyclomatic complexity by exact name or line proximity
          let matchedCyc = fileCycs.find(
            (c) =>
              c.functionName.toLowerCase() === f.functionName.toLowerCase(),
          );
          if (!matchedCyc && f.startLine) {
            matchedCyc = fileCycs.find((c) => {
              const m = c.functionName.match(/@L(\d+)/i);
              if (m) {
                const l = parseInt(m[1], 10);
                return Math.abs(l - f.startLine) <= 3;
              }
              return false;
            });
          }

          // Match CFG by id from cyc or direct match
          let matchedCfg = null;
          if (matchedCyc?.cfgId) {
            matchedCfg = fileCfgs.find((g) => g.id === matchedCyc.cfgId);
          }
          if (!matchedCfg) {
            matchedCfg = fileCfgs.find(
              (g) =>
                g.functionName.toLowerCase() === f.functionName.toLowerCase(),
            );
            if (!matchedCfg && f.startLine) {
              matchedCfg = fileCfgs.find((g) => {
                const m = g.functionName.match(/@L(\d+)/i);
                if (m) {
                  const l = parseInt(m[1], 10);
                  return Math.abs(l - f.startLine) <= 3;
                }
                return g.startLine && Math.abs(g.startLine - f.startLine) <= 3;
              });
            }
          }

          const complexity = matchedCyc?.value
            ? Math.max(1, matchedCyc.value)
            : 1;
          const complexityStatus =
            complexity > 10 ? "HIGH" : complexity > 5 ? "MEDIUM" : "LOW";

          return {
            ...f,
            filePath: canonicalPath,
            complexity,
            complexityStatus,
            cfgId: matchedCfg?.id || matchedCyc?.cfgId || null,
            hasCfg: Boolean(matchedCfg?.id || matchedCyc?.cfgId),
          };
        }),
      },
    });
  } catch (error) {
    console.error("[CoverageFunctions] Server error:", error);
    if (error instanceof ServiceError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: "Internal server error!" });
  }
};

/**
 * GET /api/coverage/:snapshotId/integration/workspace
 * Retrieves the data for the new Integration Test Workspace
 */
/**
 * GET /api/coverage/:snapshotId/integration/detection
 * Detects integration testing frameworks (Supertest & Playwright API) and determines 4 Permutations
 */
export const getIntegrationDetectionController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    const { detectIntegrationFrameworksService } =
      await import("../services/integrationApiService.service.js");
    const detection = await detectIntegrationFrameworksService({
      snapshotId,
      userId,
    });

    return res.status(200).json({ success: true, data: detection });
  } catch (error) {
    console.error("[getIntegrationDetectionController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to detect integration frameworks.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/integration/install-dependencies
 * Installs missing integration testing dependencies (Supertest/Jest or Playwright API)
 */
/**
 * POST /api/coverage/:snapshotId/integration/generate-tests
 * Task 4.3: Generate AI integration test suites (Cold-Start & Multi-Endpoint)
 */
export const generateIntegrationTestsController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const { framework, targetEndpoints, force } = req.body || {};

    const { queueIntegrationTestGenerationService } =
      await import("../services/integrationApiService.service.js");
    const result = await queueIntegrationTestGenerationService({
      snapshotId,
      userId,
      framework: framework || "supertest",
      targetEndpoints: targetEndpoints || [],
      force: Boolean(force),
      model: requestedAiModel(req),
      requestId: req.get("Idempotency-Key"),
    });

    return res.status(202).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[generateIntegrationTestsController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to queue integration test generation.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/integration/regenerate-scenario
 * Task 4.3: Regenerate single test scenario or fix faulty test
 */
export const regenerateIntegrationScenarioController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const { scenarioId, framework, failureContext } = req.body || {};

    const { queueRegenerateScenarioService } =
      await import("../services/integrationApiService.service.js");
    const result = await queueRegenerateScenarioService({
      snapshotId,
      userId,
      scenarioId: scenarioId || req.params.scenarioId,
      framework: framework || "supertest",
      failureContext: failureContext || null,
      expectedVersion: req.body?.expectedVersion,
      model: requestedAiModel(req),
      requestId: req.get("Idempotency-Key"),
    });

    try {
      const snap = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { projectId: true },
      });
      if (snap?.projectId) {
        const { autoTransitionProjectToDoingIfNeeded } =
          await import("../services/job.service.js");
        void autoTransitionProjectToDoingIfNeeded(snap.projectId);
      }
    } catch (_) {}

    return res.status(202).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[regenerateIntegrationScenarioController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to queue scenario regeneration.",
    });
  }
};

/**
 * PUT /api/coverage/:snapshotId/integration/scenarios/:scenarioId
 * Task 4.4: Update an integration scenario
 */
export const updateIntegrationScenarioController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId, scenarioId } = req.params;
    const updates = req.body || {};

    const { updateIntegrationScenarioService } =
      await import("../services/integrationApiService.service.js");
    const result = await updateIntegrationScenarioService({
      snapshotId,
      scenarioId,
      userId,
      updates,
    });

    try {
      const snap = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { projectId: true },
      });
      if (snap?.projectId) {
        const { autoTransitionProjectToDoingIfNeeded } =
          await import("../services/job.service.js");
        void autoTransitionProjectToDoingIfNeeded(snap.projectId);
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[updateIntegrationScenarioController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update integration scenario.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/integration/apply-tests
 * Task 4.4: Apply approved/selected integration tests directly into source code
 */
export const applyIntegrationTestsController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const { testIds, selectedScenarios, targetFilePath, fileName } =
      req.body || {};

    const { applyIntegrationTestsService } =
      await import("../services/integrationApiService.service.js");
    const result = await applyIntegrationTestsService({
      snapshotId,
      userId,
      testIds: testIds || [],
      selectedScenarios: Array.isArray(selectedScenarios)
        ? selectedScenarios
        : [],
      targetFilePath: targetFilePath || null,
      fileName: fileName || null,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[applyIntegrationTestsController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Failed to apply integration tests to source code.",
    });
  }
};

export const installIntegrationDependenciesController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const { packages, framework } = req.body || {};

    const {
      installIntegrationDependenciesService,
      detectIntegrationFrameworksService,
    } = await import("../services/integrationApiService.service.js");
    const installResult = await installIntegrationDependenciesService({
      snapshotId,
      userId,
      packages,
      framework: framework || "supertest",
    });
    const updatedDetection = await detectIntegrationFrameworksService({
      snapshotId,
      userId,
    });

    return res.status(200).json({
      success: true,
      message: "Integration dependencies installed successfully.",
      installResult,
      detection: updatedDetection,
    });
  } catch (error) {
    console.error("[installIntegrationDependenciesController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to install dependencies.",
    });
  }
};

export const installMissingDependencyController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const {
      packageName,
      isDev = false,
      rerunTests = true,
      importedFrom = null,
    } = req.body || {};

    if (!packageName || typeof packageName !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "packageName is required." });
    }

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res
        .status(404)
        .json({
          success: false,
          message: "Snapshot not found or unauthorized.",
        });
    if (!snapshot.rootDir)
      return res
        .status(409)
        .json({
          success: false,
          message: "Snapshot directory is not available.",
        });

    const { installPackageInWorkspace, isValidNpmPackageName } =
      await import("../services/dependencyResolution.service.js");
    if (!isValidNpmPackageName(packageName)) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Invalid or unsafe package name: '${packageName}'`,
        });
    }

    const installResult = await installPackageInWorkspace({
      rootDir: snapshot.rootDir,
      packageName: packageName.trim(),
      isDev: Boolean(isDev),
      importedFrom: importedFrom || null,
    });

    if (!installResult.success) {
      return res.status(installResult.timedOut ? 504 : 422).json({
        success: false,
        code: installResult.timedOut
          ? "DEPENDENCY_INSTALL_TIMEOUT"
          : "DEPENDENCY_INSTALL_FAILED",
        message: installResult.timedOut
          ? `Installation of '${packageName}' exceeded ${Math.round(installResult.timeoutMs / 1000)} seconds. Check registry connectivity and retry.`
          : `Could not install '${packageName}'. ${installResult.stderr || "Check the package manager output and retry."}`,
        installResult,
        newJobId: null,
      });
    }

    let newJob = null;
    if (rerunTests) {
      const { createRunTestsJob } = await import("../services/job.service.js");
      const { addJobToQueue } = await import("../services/queue.service.js");

      newJob = await createRunTestsJob({
        projectId: snapshot.projectId,
        snapshotId: snapshot.id,
        userId,
        mode: "FULL",
      });
      await addJobToQueue("RUN_TESTS", newJob.id);
    }

    return res.status(200).json({
      success: true,
      message: `Installed package '${packageName}' successfully.${rerunTests ? " Test re-execution initiated." : ""}`,
      installResult,
      newJobId: newJob?.id || null,
    });
  } catch (error) {
    console.error("[installMissingDependencyController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to install dependency.",
    });
  }
};

export const getIntegrationWorkspace = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    let targetSnapshotId = snapshotId;
    let snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        project: { select: { ownerId: true } },
      },
    });

    if (!snapshot) {
      // Fallback: Check if the provided ID is actually a projectId
      const latestSnapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId: snapshotId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          projectId: true,
          project: { select: { ownerId: true } },
        },
      });
      if (latestSnapshot) {
        snapshot = latestSnapshot;
        targetSnapshotId = latestSnapshot.id;
      }
    }

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    if (snapshot.project?.ownerId && snapshot.project.ownerId !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden." });
    }
    if (typeof resolveProjectAccess === "function") {
      await resolveProjectAccess({
        projectId: snapshot.projectId,
        userId,
        capability: "project.read",
      });
    }

    const skipAutoScan =
      req.query?.skipAutoScan === "true" || req.query?.skipAutoScan === "1";
    const scanNow = req.query?.scan === "true" || req.query?.scan === "1";

    const workspaceData = await buildIntegrationWorkspace(targetSnapshotId, {
      skipAutoScan,
      scanNow,
      bypassCache: scanNow,
    });

    return res.status(200).json({ success: true, data: workspaceData });
  } catch (error) {
    console.error("[getIntegrationWorkspace] Server error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Server error while fetching integration workspace.",
    });
  }
};

export const approveIntegrationTests = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    const { approvedTestIds, approveAll } = req.body || {};
    if (!approveAll && !Array.isArray(approvedTestIds)) {
      return res.status(400).json({
        success: false,
        message: "approvedTestIds array or approveAll is required.",
      });
    }
    const safeApprovedTestIds = Array.isArray(approvedTestIds)
      ? approvedTestIds
      : [];

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { projectId: true, project: { select: { ownerId: true } } },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    // Group approved scenarios by AiTest ID
    const approvedScenariosByTestId = {};
    for (const idStr of safeApprovedTestIds) {
      const separatorIndex = idStr.indexOf("::");
      if (separatorIndex === -1) continue;

      const testId = idStr.substring(0, separatorIndex);
      const scenarioName = idStr.substring(separatorIndex + 2);

      if (!approvedScenariosByTestId[testId])
        approvedScenariosByTestId[testId] = [];
      if (scenarioName) approvedScenariosByTestId[testId].push(scenarioName);
    }

    const aiTests = await prisma.aiTest.findMany({ where: { snapshotId } });

    for (const t of aiTests) {
      try {
        if (t.metaJson) {
          const meta =
            typeof t.metaJson === "string"
              ? JSON.parse(t.metaJson)
              : t.metaJson;
          const fwUpper = String(meta.framework || "SUPERTEST").toUpperCase();
          if (fwUpper === "SUPERTEST" || fwUpper === "PLAYWRIGHT_API") {
            const approvedScenarios = approvedScenariosByTestId[t.id] || [];
            const isApproved = approvedScenarios.length > 0;

            if (approveAll) {
              const reqs = Array.isArray(meta.requests)
                ? meta.requests
                    .map((r) => r.scenarioId || r.testName)
                    .filter(Boolean)
                : [];
              meta.status = "APPROVED";
              meta.approvedScenarios = reqs.length > 0 ? reqs : ["*"];
            } else {
              meta.status = isApproved ? "APPROVED" : "DRAFT";
              meta.approvedScenarios = approvedScenarios;
            }

            await prisma.aiTest.update({
              where: { id: t.id },
              data: { metaJson: JSON.stringify(meta) },
            });
          }
        }
      } catch (e) {
        console.error("Failed to parse metaJson for AiTest", t.id, e);
      }
    }

    return res
      .status(200)
      .json({ success: true, message: "Approved successfully." });
  } catch (error) {
    console.error("[approveIntegrationTests] Server error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: "Server error while approving tests." });
  }
};

/**
 * GET /api/coverage/:snapshotId/file-coverage?filePath=...
 */
export const getFileCoverage = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const filePath = req.query.filePath;
    if (!filePath)
      return res.status(400).json({
        success: false,
        message: "filePath query parameter is required.",
      });

    const data = await getFileCoverageDetails(snapshotId, filePath, userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[getFileCoverage] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to retrieve file coverage.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/suggest-testcase
 */
export const suggestUnitTestcase = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    let {
      projectId,
      filePath,
      framework,
      validationMode = "fast",
    } = req.body || {};
    if (!["fast", "full"].includes(validationMode))
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid suggestion validation mode.",
        });

    if (!filePath)
      return res
        .status(400)
        .json({ success: false, message: "filePath is required in body." });

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res.status(404).json({
        success: false,
        message: "Snapshot not found or unauthorized.",
      });

    const actualSnapshotId = snapshot.id;
    const actualProjectId =
      projectId || snapshot.projectId || snapshot.project?.id;
    if (!actualProjectId) {
      return res
        .status(400)
        .json({ success: false, message: "Valid projectId is required." });
    }

    if (req.body?.async === true || req.query?.async === "true") {
      const queuedData = await enqueueUnitTestJob({
        projectId: actualProjectId,
        snapshotId: actualSnapshotId,
        userId,
        type: "UNIT_TEST_SUGGEST",
        payloadJson: {
          projectId: actualProjectId,
          snapshotId: actualSnapshotId,
          userId,
          filePath,
          validationMode,
          framework,
          selectedAiModel: requestedAiModel(req),
        },
      });
      return res
        .status(queuedData.reused ? 200 : 202)
        .json({ success: true, data: queuedData });
    }

    const result = await suggestUnitTestcases({
      projectId: actualProjectId,
      snapshotId: actualSnapshotId,
      filePath,
      validationMode,
      userId,
      framework,
      selectedAiModel: requestedAiModel(req),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("[suggestUnitTestcase] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to suggest unit testcases.",
      });
  }
};
export const getIntegrationHistory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { projectId: true, project: { select: { ownerId: true } } },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    const result = await getIntegrationHistoryService(snapshotId);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("[getIntegrationHistory] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch history.",
    });
  }
};

export const getIntegrationVersionHistory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { projectId: true, project: { select: { ownerId: true } } },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    const result = await getIntegrationVersionHistoryService(
      snapshotId,
      req.query,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("[getIntegrationVersionHistory] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch version history.",
    });
  }
};

export const compareIntegrationVersions = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const { versionAId, versionBId, type } = req.query;

    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    if (!versionAId || !versionBId) {
      return res.status(400).json({
        success: false,
        message: "versionAId and versionBId query parameters are required.",
      });
    }

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { projectId: true, project: { select: { ownerId: true } } },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    const result = await compareVersionsService(
      snapshotId,
      versionAId,
      versionBId,
      type,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("[compareIntegrationVersions] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to compare versions.",
    });
  }
};

export const getHistoricalWorkspaceVersion = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId, versionId } = req.params;
    const { type } = req.query;

    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    if (!versionId)
      return res
        .status(400)
        .json({ success: false, message: "versionId is required." });

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { projectId: true, project: { select: { ownerId: true } } },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    const result = await getHistoricalWorkspaceVersionService(
      snapshotId,
      versionId,
      type,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("[getHistoricalWorkspaceVersion] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch historical version.",
    });
  }
};

export const getBeforeAfterComparison = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { projectId } = req.params;
    const {
      baselineSnapshotId,
      currentSnapshotId,
      snapshotId,
      baselineRunId,
      currentRunId,
      baselineJobId,
      currentJobId,
    } = req.query;

    if (!projectId)
      return res
        .status(400)
        .json({ success: false, message: "projectId is required." });

    const comparison = await getBeforeAfterComparisonService({
      projectId,
      baselineSnapshotId,
      currentSnapshotId: currentSnapshotId || snapshotId,
      baselineRunId,
      currentRunId,
      baselineJobId,
      currentJobId,
      userId,
    });

    return res.status(200).json({ success: true, data: comparison });
  } catch (error) {
    console.error("[getBeforeAfterComparison] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to generate comparison.",
    });
  }
};

export const getSourceFileDiff = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { projectId } = req.params;
    const { baselineSnapshotId, currentSnapshotId, filePath } = req.query;

    if (!projectId || !baselineSnapshotId || !currentSnapshotId || !filePath) {
      return res.status(400).json({
        success: false,
        message:
          "projectId, baselineSnapshotId, currentSnapshotId, and filePath are required.",
      });
    }

    const diffResult = await getSourceFileDiffService({
      projectId,
      baselineSnapshotId,
      currentSnapshotId,
      filePath,
      userId,
    });

    return res.status(200).json({ success: true, data: diffResult });
  } catch (error) {
    console.error("[getSourceFileDiff] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch source file diff.",
    });
  }
};

const isSyntheticAiTestId = (aiTestId) =>
  !aiTestId ||
  [
    "default",
    "new",
    "fallback",
    "existing_test_lookup",
    "workspace_scenario_lookup",
  ].includes(aiTestId) ||
  String(aiTestId).startsWith("existing_test_");

const resolveOrCreateAiTest = async (
  snapshotId,
  aiTestId,
  userId,
  context = {},
) => {
  const {
    filePath: hintFilePath,
    testName: hintTestName,
    scenarioId: hintScenarioId,
  } = context || {};

  // 1. Try finding by aiTestId directly if not synthetic
  if (!isSyntheticAiTestId(aiTestId)) {
    const found = await prisma.aiTest.findFirst({
      where: { id: aiTestId, snapshotId },
      select: { id: true, projectId: true, snapshotId: true },
    });
    if (found) {
      await resolveProjectAccess({
        projectId: found.projectId,
        userId,
        capability: "project.read",
      });
      return found;
    }
  }

  // 1.5 Match an existing AiTest by filePath, scenarioId, or testName before creating/falling back
  if (hintFilePath || hintTestName || hintScenarioId) {
    const allAiTests = await prisma.aiTest.findMany({
      where: { snapshotId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        snapshotId: true,
        filePath: true,
        content: true,
        metaJson: true,
      },
    });
    const normHintPath = hintFilePath
      ? String(hintFilePath)
          .replace(/\\/g, "/")
          .replace(/^\/+/, "")
          .toLowerCase()
      : null;

    const matched = allAiTests.find((row) => {
      if (normHintPath && row.filePath) {
        const normRowPath = String(row.filePath)
          .replace(/\\/g, "/")
          .replace(/^\/+/, "")
          .toLowerCase();
        if (
          normRowPath === normHintPath ||
          normRowPath.endsWith(normHintPath) ||
          normHintPath.endsWith(normRowPath)
        ) {
          return true;
        }
      }
      if (hintTestName && row.content && row.content.includes(hintTestName)) {
        return true;
      }
      if (
        hintScenarioId &&
        row.metaJson &&
        String(row.metaJson).includes(hintScenarioId)
      ) {
        return true;
      }
      return false;
    });

    if (matched) {
      await resolveProjectAccess({
        projectId: matched.projectId,
        userId,
        capability: "project.read",
      });
      return {
        id: matched.id,
        projectId: matched.projectId,
        snapshotId: matched.snapshotId,
      };
    }
  }

  // 2. If targeting an existing project test file (PROJECT_EXISTING), import it into an editable workspace AiTest
  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, projectId: true, rootDir: true },
  });
  if (!snapshot) return null;

  const { normalizeDiskPath } = await import("../utils/snapshotWorkspace.js");
  const rootDir = snapshot.rootDir
    ? resolveSnapshotRootDir(snapshot.rootDir) ||
      normalizeDiskPath(snapshot.rootDir) ||
      snapshot.rootDir
    : null;

  if (
    rootDir &&
    fs.existsSync(rootDir) &&
    (hintFilePath || hintTestName || isSyntheticAiTestId(aiTestId))
  ) {
    try {
      const { discoverProjectIntegrationTests } =
        await import("../services/integrationWorkspace.service.js");
      const { extractTestRequests } =
        await import("../services/testSourceParser.service.js");
      const projectSuites = await discoverProjectIntegrationTests(
        rootDir,
      ).catch(() => []);
      const normHintPath = hintFilePath
        ? String(hintFilePath)
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .toLowerCase()
        : null;

      let matchedSuite = null;
      if (aiTestId && String(aiTestId).startsWith("existing_test_")) {
        matchedSuite = projectSuites.find((s) => s.id === aiTestId) || null;
      }
      if (!matchedSuite && normHintPath) {
        matchedSuite =
          projectSuites.find((s) => {
            const p = String(s.filePath || "")
              .replace(/\\/g, "/")
              .replace(/^\/+/, "")
              .toLowerCase();
            return (
              p === normHintPath ||
              p.endsWith(normHintPath) ||
              normHintPath.endsWith(p)
            );
          }) || null;
      }
      if (!matchedSuite && hintTestName) {
        matchedSuite =
          projectSuites.find(
            (s) =>
              (s.requests || []).some((r) => r.testName === hintTestName) ||
              (s.content && s.content.includes(hintTestName)),
          ) || null;
      }

      if (matchedSuite && matchedSuite.content) {
        await resolveProjectAccess({
          projectId: snapshot.projectId,
          userId,
          capability: "files.write",
        });
        const parsedReqs = (
          matchedSuite.requests && matchedSuite.requests.length > 0
            ? matchedSuite.requests
            : extractTestRequests(matchedSuite.content, matchedSuite.filePath)
        ).map((r) => ({
          ...r,
          enabled: r.enabled !== false,
          origin: r.origin || "PROJECT_EXISTING",
        }));
        const created = await prisma.aiTest.create({
          data: {
            projectId: snapshot.projectId,
            snapshotId: snapshot.id,
            mode: "FULL",
            status: "VERIFIED",
            filePath: matchedSuite.filePath,
            content: matchedSuite.content,
            metaJson: JSON.stringify({
              framework: "SUPERTEST",
              status: "APPROVED",
              origin: "PROJECT_EXISTING",
              requests: parsedReqs,
            }),
          },
          select: { id: true, projectId: true, snapshotId: true },
        });
        return created;
      }
    } catch (importErr) {
      console.warn(
        "[resolveOrCreateAiTest] Could not import PROJECT_EXISTING suite:",
        importErr.message,
      );
    }
  }

  // 3. Try finding any existing AiTest for this snapshotId (for ADD scenario mode)
  const existing = await prisma.aiTest.findFirst({
    where: { snapshotId },
    orderBy: { createdAt: "desc" },
    select: { id: true, projectId: true, snapshotId: true },
  });
  if (existing) {
    await resolveProjectAccess({
      projectId: existing.projectId,
      userId,
      capability: "project.read",
    });
    return existing;
  }

  // 4. No AiTest in DB: create default scaffold
  await resolveProjectAccess({
    projectId: snapshot.projectId,
    userId,
    capability: "files.write",
  });

  let testFilePath = "tests/integration/api.test.js";
  let testContent = "";

  if (rootDir && fs.existsSync(rootDir)) {
    const candidatePaths = [
      path.join(rootDir, "tests", "api.integration.test.js"),
      path.join(rootDir, "tests", "integration", "api.test.js"),
      path.join(rootDir, "tests", "api.test.js"),
      path.join(rootDir, "test", "api.test.js"),
    ];
    for (const cp of candidatePaths) {
      if (fs.existsSync(cp)) {
        testFilePath = path.relative(rootDir, cp).replace(/\\/g, "/");
        testContent = fs.readFileSync(cp, "utf8");
        break;
      }
    }
  }

  if (!testContent || !testContent.includes("describe")) {
    let entryRel = "../index.js";
    if (rootDir && fs.existsSync(path.join(rootDir, "index.js"))) {
      entryRel = "../index.js";
    } else if (rootDir && fs.existsSync(path.join(rootDir, "app.js"))) {
      entryRel = "../app.js";
    } else if (
      rootDir &&
      fs.existsSync(path.join(rootDir, "src", "index.js"))
    ) {
      entryRel = "../src/index.js";
    } else if (rootDir && fs.existsSync(path.join(rootDir, "src", "app.js"))) {
      entryRel = "../src/app.js";
    }

    testContent = `const request = require('supertest');\nconst app = require('${entryRel}');\n\ndescribe('API Integration Tests', () => {\n  it('should verify test suite initialization', async () => {\n    expect(true).toBe(true);\n  });\n});\n`;
  }

  const created = await prisma.aiTest.create({
    data: {
      projectId: snapshot.projectId,
      snapshotId: snapshot.id,
      mode: "FULL",
      status: "VERIFIED",
      filePath: testFilePath,
      content: testContent,
      metaJson: JSON.stringify({
        framework: "SUPERTEST",
        status: "APPROVED",
        origin: "USER_MODIFIED",
        requests: [],
      }),
    },
    select: { id: true, projectId: true, snapshotId: true },
  });

  return created;
};

const verifyAiTestOwnership = async (
  aiTestId,
  userId,
  res,
  expectedSnapshotId = null,
  context = {},
) => {
  let aiTest = !isSyntheticAiTestId(aiTestId)
    ? await prisma.aiTest.findUnique({
        where: { id: aiTestId },
        select: {
          id: true,
          projectId: true,
          snapshotId: true,
          project: { select: { ownerId: true } },
        },
      })
    : null;
  if (!aiTest && expectedSnapshotId) {
    aiTest = await resolveOrCreateAiTest(
      expectedSnapshotId,
      aiTestId,
      userId,
      context,
    );
  }
  if (!aiTest) {
    res.status(404).json({ success: false, message: "AiTest not found." });
    return false;
  }
  await resolveProjectAccess({
    projectId: aiTest.projectId,
    userId,
    capability: "project.read",
  });
  if (expectedSnapshotId && aiTest.snapshotId !== expectedSnapshotId) {
    res.status(403).json({ success: false, message: "Snapshot mismatch." });
    return false;
  }
  return aiTest;
};

export const updateScenario = async (req, res) => {
  try {
    const { snapshotId, aiTestId, scenarioId } = req.params;
    const { code, filePath, testName, origin } = req.body || {};
    const decodedScenarioId = decodeURIComponent(scenarioId);

    const targetAiTest = await verifyAiTestOwnership(
      aiTestId,
      req.user.id,
      res,
      req.params.snapshotId,
      { filePath, testName, scenarioId: decodedScenarioId, origin },
    );
    if (!targetAiTest) return;

    const updatedTest = await updateScenarioService(
      targetAiTest.id,
      decodedScenarioId,
      code,
      {
        userId: req.user.id,
        snapshotId: req.params.snapshotId,
        expectedVersion: req.body?.expectedVersion,
        fallbackTestName: testName,
      },
    );
    if (snapshotId) invalidateEndpointCache(snapshotId);
    return res.status(200).json({ success: true, data: updatedTest });
  } catch (error) {
    console.error("[updateScenario] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message, code: error.code });
  }
};

export const addScenario = async (req, res) => {
  try {
    const { snapshotId, aiTestId } = req.params;
    const { code, endpoint, filePath, testName, origin } = req.body || {};

    const aiTest = await resolveOrCreateAiTest(
      snapshotId,
      aiTestId,
      req.user.id,
      { filePath, testName, origin },
    );
    if (!aiTest) {
      return res
        .status(404)
        .json({ success: false, message: "Snapshot or project not found." });
    }

    const updatedTest = await addScenarioService(aiTest.id, code, endpoint, {
      userId: req.user.id,
      snapshotId: req.params.snapshotId,
      expectedVersion: req.body?.expectedVersion,
    });
    if (snapshotId) invalidateEndpointCache(snapshotId);
    return res.status(200).json({ success: true, data: updatedTest });
  } catch (error) {
    console.error("[addScenario] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message, code: error.code });
  }
};

export const deleteScenario = async (req, res) => {
  try {
    const { snapshotId, aiTestId, scenarioId } = req.params;
    const decodedScenarioId = decodeURIComponent(scenarioId);
    const { filePath, testName, origin } = req.body || {};

    const isExistingProjectId =
      !aiTestId ||
      aiTestId === "fallback" ||
      aiTestId === "existing_test_lookup" ||
      aiTestId === "workspace_scenario_lookup" ||
      String(aiTestId).startsWith("existing_test_") ||
      origin === "PROJECT_EXISTING";

    let dbAiTest = null;
    if (!isExistingProjectId) {
      dbAiTest = await prisma.aiTest
        .findFirst({
          where: { id: aiTestId, snapshotId },
          select: { id: true, projectId: true, snapshotId: true },
        })
        .catch(() => null);
    }

    if (!dbAiTest) {
      const deletedResult = await deleteProjectScenarioService({
        snapshotId,
        userId: req.user.id,
        aiTestId,
        scenarioId: decodedScenarioId,
        filePath,
        testName,
      });
      if (snapshotId) invalidateEndpointCache(snapshotId);
      return res.status(200).json({ success: true, data: deletedResult });
    }

    const targetAiTest = await verifyAiTestOwnership(
      aiTestId,
      req.user.id,
      res,
      req.params.snapshotId,
    );
    if (!targetAiTest) return;

    const updatedTest = await deleteScenarioService(
      targetAiTest.id,
      decodedScenarioId,
      {
        userId: req.user.id,
        snapshotId: req.params.snapshotId,
        expectedVersion: req.body?.expectedVersion,
      },
    );
    if (snapshotId) invalidateEndpointCache(snapshotId);
    return res.status(200).json({ success: true, data: updatedTest });
  } catch (error) {
    console.error("[deleteScenario] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message, code: error.code });
  }
};

export const toggleScenario = async (req, res) => {
  try {
    const { snapshotId, aiTestId, scenarioId } = req.params;
    const { enable, filePath, testName, origin } = req.body || {};
    const decodedScenarioId = decodeURIComponent(scenarioId);

    const targetAiTest = await verifyAiTestOwnership(
      aiTestId,
      req.user.id,
      res,
      req.params.snapshotId,
      { filePath, testName, scenarioId: decodedScenarioId, origin },
    );
    if (!targetAiTest) return;

    const updatedTest = await toggleScenarioService(
      targetAiTest.id,
      decodedScenarioId,
      enable,
      {
        userId: req.user.id,
        snapshotId: req.params.snapshotId,
        expectedVersion: req.body?.expectedVersion,
      },
    );
    if (snapshotId) invalidateEndpointCache(snapshotId);
    return res.status(200).json({ success: true, data: updatedTest });
  } catch (error) {
    console.error("[toggleScenario] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message, code: error.code });
  }
};

export const regenerateScenario = async (req, res) => {
  try {
    const { snapshotId, aiTestId, scenarioId } = req.params;

    const targetAiTest = await verifyAiTestOwnership(
      aiTestId,
      req.user.id,
      res,
      snapshotId,
    );
    if (!targetAiTest) return;

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot) throw new Error("Snapshot not found");

    const { assertScenarioVersion } =
      await import("../services/scenarioManager.service.js");
    const { createAiTestsJob } = await import("../services/job.service.js");
    const artifact = await prisma.aiTest.findUnique({
      where: { id: aiTestId },
    });
    assertScenarioVersion(artifact, req.body?.expectedVersion);
    const job = await createAiTestsJob({
      projectId: snapshot.projectId,
      snapshotId,
      userId: req.user.id,
      mode: "SUPERTEST_REGENERATE",
      aiTestId,
      scenarioId: decodeURIComponent(scenarioId),
      expectedVersion: req.body.expectedVersion,
      model: requestedAiModel(req),
    });
    if (!job.reused)
      await addJobToQueue("AI_TESTS", job.id, {
        snapshotId,
        userId: req.user.id,
        projectId: snapshot.projectId,
      });
    if (snapshotId) invalidateEndpointCache(snapshotId);

    return res.status(200).json({
      success: true,
      message: "Regeneration job queued",
      jobId: job.id,
    });
  } catch (error) {
    console.error("[regenerateScenario] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message, code: error.code });
  }
};

import { getScenarioService } from "../services/scenarioManager.service.js";
export const getScenario = async (req, res) => {
  try {
    const { aiTestId, scenarioId } = req.params;
    const decodedScenarioId = decodeURIComponent(scenarioId);
    const { filePath, testName, origin } = req.query || {};

    const targetAiTest = await verifyAiTestOwnership(
      aiTestId,
      req.user.id,
      res,
      req.params.snapshotId,
      { filePath, testName, scenarioId: decodedScenarioId, origin },
    );
    if (!targetAiTest) return;

    const result = await getScenarioService(
      targetAiTest.id,
      decodedScenarioId,
      { userId: req.user.id, snapshotId: req.params.snapshotId },
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message, code: error.code });
  }
};

/**
 * GET /api/coverage/:snapshotId/system/scenarios/:scenarioId/evidence
 * Returns screenshot image or DOM snapshot evidence for a scenario.
 */
export const getSystemTestEvidence = async (req, res) => {
  try {
    const snapshot = await findOwnedSnapshot(
      req.params.snapshotId,
      req.user?.id,
    );
    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found" });

    const scenario = await prisma.testScenario.findFirst({
      where: {
        id: req.params.scenarioId,
        testRun: { snapshotId: snapshot.id },
      },
    });
    if (!scenario) {
      return res
        .status(404)
        .json({ success: false, message: "Scenario not found" });
    }

    const queryType = req.query.type || req.query.format;
    const requestedType =
      queryType ||
      (req.accepts && req.accepts(["json", "png"]) === "json"
        ? "dom"
        : "screenshot");

    // If client specifically requested DOM snapshot
    if (
      requestedType === "dom" ||
      requestedType === "json" ||
      queryType === "dom" ||
      queryType === "json"
    ) {
      if (!scenario.domSnapshot) {
        return res
          .status(404)
          .json({ success: false, message: "DOM snapshot evidence not found" });
      }
      return res.status(200).json({
        success: true,
        data: {
          scenarioId: scenario.id,
          title: scenario.title,
          failureStep: scenario.failureStep,
          failureCategory: scenario.failureCategory,
          domSnapshot: scenario.domSnapshot,
        },
      });
    }

    // Otherwise attempt to serve screenshot image
    if (
      scenario.screenshotPath &&
      scenario.screenshotPath.startsWith(".covai-system-test/evidence/")
    ) {
      const file = resolveSystemScreenshot(
        snapshot.rootDir,
        scenario.screenshotPath,
      );
      if (file) {
        res.set({
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        });
        return res.type("png").sendFile(file, { dotfiles: "allow" });
      }
    }

    // Fallback: If screenshot image is absent on disk but DOM snapshot is available, return DOM snapshot
    if (scenario.domSnapshot) {
      return res.status(200).json({
        success: true,
        message: "Screenshot unavailable; returning DOM snapshot evidence.",
        data: {
          scenarioId: scenario.id,
          title: scenario.title,
          failureStep: scenario.failureStep,
          failureCategory: scenario.failureCategory,
          domSnapshot: scenario.domSnapshot,
        },
      });
    }

    return res
      .status(404)
      .json({ success: false, message: "Evidence not found" });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to load evidence",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/system/run
 * Triggers system test execution and analysis for Playwright or Cypress.
 * Parameters:
 *   - runner: "playwright" | "cypress" (optional)
 *   - executionMode: "full" (optional, default: "full")
 *   - testFile: string (optional)
 */
export const runSystemTestCoverage = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { snapshotId } = req.params;
    if (
      !snapshotId ||
      typeof snapshotId !== "string" ||
      snapshotId.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    }

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      include: { project: true },
    });

    if (!snapshot) {
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    }
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });
    if (snapshot.rootDir) {
      snapshot.rootDir =
        resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;
    }
    if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
      return res.status(409).json({
        success: false,
        message: "Snapshot files are not ready on disk.",
      });
    }

    const rawRunner = req.body?.runner || req.body?.framework;
    let runner = rawRunner ? String(rawRunner).toLowerCase().trim() : null;
    if (runner && !["playwright", "cypress"].includes(runner)) {
      return res.status(400).json({
        success: false,
        message: "runner must be 'playwright' or 'cypress'.",
      });
    }

    if (!runner) {
      try {
        const detected = detectCoverageFrameworks(snapshot.rootDir);
        const systemFws = detected?.supported?.system || [];
        if (systemFws.includes("playwright")) {
          runner = "playwright";
        } else if (systemFws.includes("cypress")) {
          runner = "cypress";
        } else {
          runner = "playwright";
        }
      } catch (_) {
        runner = "playwright";
      }
    }

    const executionMode = requireFullStackMode(req.body?.executionMode);
    if (executionMode === "full") {
      readFullSystemConfig(snapshot.rootDir, { allowMissing: true });
    }

    const testFile = req.body?.testFile
      ? String(req.body.testFile).trim()
      : null;
    const selectedFiles = Array.isArray(req.body?.selectedFiles)
      ? req.body.selectedFiles.filter((f) => typeof f === "string" && f.trim())
      : [];
    const selectedTitles = Array.isArray(req.body?.selectedTitles)
      ? req.body.selectedTitles.filter((t) => typeof t === "string" && t.trim())
      : [];
    const headed = Boolean(req.body?.headed);

    const job = await createSystemTestAnalysisJob({
      projectId: snapshot.projectId,
      snapshotId,
      userId,
      runner,
      executionMode,
      testFile,
      selectedFiles,
      selectedTitles,
      headed,
    });

    await addJobToQueue("SYSTEM_TEST_ANALYSIS", job.id, {
      snapshotId,
      userId,
      projectId: snapshot.projectId,
      runner,
      executionMode,
      testFile,
      selectedFiles,
      selectedTitles,
      headed,
    });

    return res.status(202).json({
      success: true,
      jobId: job.id,
      message: `System test analysis queued (${runner}, mode: ${executionMode}).`,
      data: {
        jobId: job.id,
        runner,
        executionMode,
        testFile,
      },
    });
  } catch (error) {
    console.error("[runSystemTestCoverage] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to queue system test execution.",
    });
  }
};

/**
 * GET /api/coverage/:snapshotId/system/summary
 * Returns System (E2E) Test summary with runner, counts, stabilityScorePct, durationMs, and coverage.
 */
export const getSystemTestSummary = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { snapshotId } = req.params;
    if (
      !snapshotId ||
      typeof snapshotId !== "string" ||
      snapshotId.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid snapshotId." });
    }

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        rootDir: true,
        project: { select: { ownerId: true, name: true } },
      },
    });

    if (!snapshot) {
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    }

    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    const resultFilter = parseSystemTestResultQuery(req.query);
    const testRuns = await prisma.testRun.findMany({
      where: {
        snapshotId,
        type: { in: ["PLAYWRIGHT", "CYPRESS"] },
        ...resultFilter,
      },
      orderBy: { createdAt: "desc" },
      include: {
        // Execution payloads are fetched separately for failed scenarios in the latest run.
        scenarios: { omit: { executionDetails: true } },
        testFiles: true,
      },
    });

    // Query latest AI Test for this snapshot
    const latestAiTestRecord = prisma.aiTest?.findFirst
      ? await prisma.aiTest.findFirst({
          where: {
            snapshotId,
            mode: { in: ["PLAYWRIGHT_E2E"] },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            filePath: true,
            content: true,
            metaJson: true,
            createdAt: true,
          },
        })
      : null;

    let latestAiTest = null;
    if (latestAiTestRecord) {
      latestAiTest = {
        id: latestAiTestRecord.id,
        filePath: latestAiTestRecord.filePath,
        status: latestAiTestRecord.status,
        createdAt: latestAiTestRecord.createdAt,
      };
    }

    if (!testRuns || testRuns.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          hasRun: false,
          testRunId: null,
          executionMode: resultFilter.executionMode || null,
          runner: null,
          status: null,
          e2eTests: 0,
          totalTests: 0,
          passed: 0,
          passedTests: 0,
          failed: 0,
          failedTests: 0,
          blockedByExternal: 0,
          externalServices: [],
          flaky: 0,
          flakyTests: 0,
          durationMs: 0,
          stabilityScorePct: null,
          passRatePct: null,
          coverageAvailable: false,
          coverageSummary: coverageSummaryFor({ status: "NOT_MEASURED" }),
          featureCoverage: null,
          files: [],
          testFiles: [],
          testRuns: [],
          scenarios: [],
          latestAiTest,
        },
      });
    }

    const latestRun = testRuns[0];
    const totalTests = latestRun.totalTests || 0;
    const passedTests = latestRun.passedTests || 0;
    const failedTests = latestRun.failedTests || 0;
    const failedScenarios = latestRun.scenarios.some(
      (scenario) => scenario.status === "failed",
    )
      ? await prisma.testScenario.findMany({
          where: { testRun: { id: latestRun.id }, status: "failed" },
          select: { title: true, executionDetails: true },
        })
      : [];
    const blockedScenarios = failedScenarios
      .filter((scenario) => scenario.executionDetails?.externalDependency)
      .map((scenario) => [
        scenario.title,
        scenario.executionDetails.externalDependency,
      ]);
    const externalServices = collectExternalRequirements(blockedScenarios).map(
      ({ scenarios, ...service }) => ({
        ...service,
        scenarioCount: scenarios.length,
      }),
    );
    const flakyTests = latestRun.flakyTests || 0;
    const durationMs = latestRun.durationMs || 0;
    const passRatePct =
      totalTests > 0
        ? Number(((passedTests / totalTests) * 100).toFixed(2))
        : null;
    const stabilityScorePct = null;
    const coverageSummary = coverageSummaryFor(latestRun.systemMeasurement);
    const coverageAvailable = Object.values(coverageSummary.tiers).some(
      (tier) => tier.status === "MEASURED",
    );

    const systemTestFiles = (latestRun.testFiles || []).map((file) => ({
      ...file,
      coverageLinesPct: null,
    }));

    // Parse scenarios: use DB records if available, otherwise check report files on disk
    let scenarios = [];
    if (latestRun.scenarios && latestRun.scenarios.length > 0) {
      scenarios = latestRun.scenarios.map((s) => ({
        id: s.id,
        title: s.title,
        suiteName: s.suiteName,
        file: s.testFile ? cleanStoragePath(s.testFile) : "",
        durationMs: s.durationMs || 0,
        status: s.status?.toLowerCase() || "unknown",
        failureMessages: s.failureMessages || [],
        hasEvidence: Boolean(s.screenshotPath),
        failureStep: s.failureStep || null,
        failureCategory: s.failureCategory || null,
        failureCodeSnippet: s.failureCodeSnippet || null,
        domSnapshot: s.domSnapshot || null,
        coverageContributions: {
          linesPct: null,
          branchesPct: null,
        },
      }));
    } else if (snapshot.rootDir && fs.existsSync(snapshot.rootDir)) {
      const reportCandidates = [
        path.join(
          snapshot.rootDir,
          ".covai-system-test",
          `${latestRun.type.toLowerCase()}-results.json`,
        ),
      ];

      for (const reportPath of reportCandidates) {
        if (fs.existsSync(reportPath)) {
          try {
            const modifiedAt = fs.statSync(reportPath).mtimeMs;
            if (
              !latestRun.startedAt ||
              !latestRun.finishedAt ||
              modifiedAt < new Date(latestRun.startedAt).getTime() ||
              modifiedAt > new Date(latestRun.finishedAt).getTime()
            )
              continue;
            const content = fs.readFileSync(reportPath, "utf8");
            const reportData = JSON.parse(content);
            if (reportData.suites) {
              const collectPlaywrightSpecs = (suite, parentFile = "") => {
                const currentFile = suite.file || parentFile;
                for (const spec of suite.specs || []) {
                  const testObj = (spec.tests || [])[0];
                  const result = (testObj?.results || [])[0];
                  let status =
                    result?.status || (spec.ok ? "passed" : "failed");
                  if (
                    testObj?.status === "flaky" ||
                    (testObj?.results?.length > 1 &&
                      testObj.results.some((r) => r.status === "passed"))
                  ) {
                    status = "flaky";
                  }
                  const failureMessages = [];
                  if (result?.error?.message)
                    failureMessages.push(result.error.message);
                  if (Array.isArray(result?.errors)) {
                    for (const err of result.errors) {
                      if (
                        err?.message &&
                        !failureMessages.includes(err.message)
                      )
                        failureMessages.push(err.message);
                    }
                  }
                  scenarios.push({
                    id: spec.id || `${currentFile}-${spec.title}`,
                    title: spec.title,
                    file: currentFile
                      ? path
                          .relative(snapshot.rootDir, currentFile)
                          .replace(/\\/g, "/")
                      : "",
                    durationMs: result?.duration || 0,
                    status,
                    failureMessages,
                  });
                }
                for (const child of suite.suites || []) {
                  collectPlaywrightSpecs(child, currentFile);
                }
              };
              for (const s of reportData.suites || []) {
                collectPlaywrightSpecs(s);
              }
            }
            if (scenarios.length > 0) break;
          } catch (_) {}
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        hasRun: true,
        testRunId: latestRun.id,
        runner: latestRun.type.toLowerCase(),
        status: latestRun.status,
        e2eTests: totalTests,
        totalTests,
        passed: passedTests,
        passedTests,
        failed: failedTests,
        failedTests,
        blockedByExternal: blockedScenarios.length,
        externalServices,
        flaky: flakyTests,
        flakyTests,
        skippedTests: latestRun.skippedTests || 0,
        durationMs,
        stabilityScorePct,
        passRatePct,
        coverageAvailable,
        coverageSummary,
        featureCoverage: null,
        files: systemTestFiles,
        testFiles: systemTestFiles,
        testRuns: testRuns.map((run) => ({
          ...run,
          coverageLinesPct: null,
          coverageBranchesPct: null,
          coverageStatementsPct: null,
          coverageFunctionsPct: null,
          coverageSummary: coverageSummaryFor(run.systemMeasurement),
          scenarios: run.scenarios?.map(({ screenshotPath, ...scenario }) => ({
            ...scenario,
            hasEvidence: Boolean(screenshotPath),
          })),
        })),
        scenarios,
        latestRun: {
          ...latestRun,
          coverageLinesPct: null,
          coverageBranchesPct: null,
          coverageStatementsPct: null,
          coverageFunctionsPct: null,
          coverageSummary,
          scenarios: undefined,
        },
        executionMode: latestRun.executionMode || "frontend",
        latestAiTest,
      },
    });
  } catch (error) {
    console.error("[getSystemTestSummary] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Server error.",
    });
  }
};

/**
 * GET /api/coverage/:snapshotId/system/scenarios
 * Returns scenarios grouped hierarchically by test file with failure breakpoints,
 * error messages, evidence links, duration, and coverage contributions.
 */
export const getSystemTestScenarios = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { snapshotId } = req.params;
    if (!snapshotId) {
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    }

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: "Snapshot not found or unauthorized.",
      });
    }

    const resultFilter = parseSystemTestResultQuery(req.query);
    const testRunId = req.query.testRunId;
    const recentSystemRuns = await prisma.testRun.findMany({
      where: {
        snapshotId,
        type: { in: ["PLAYWRIGHT", "CYPRESS"] },
        ...resultFilter,
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { scenarios: true, testFiles: true },
    });
    let targetRun = testRunId
      ? recentSystemRuns.find((r) => r.id === testRunId) || recentSystemRuns[0] || null
      : recentSystemRuns[0] || null;
    if (targetRun && recentSystemRuns.length > 1) {
      const mergedScenariosMap = new Map();
      const mergedFilesMap = new Map();
      for (const run of recentSystemRuns) {
        for (const sc of run.scenarios || []) {
          const key = `${cleanStoragePath(sc.testFile || "").toLowerCase()}::${String(sc.title || "").trim().toLowerCase()}`;
          if (!mergedScenariosMap.has(key)) {
            mergedScenariosMap.set(key, sc);
          }
        }
        for (const tf of run.testFiles || []) {
          const fKey = cleanStoragePath(tf.filePath || "").toLowerCase();
          if (fKey && !mergedFilesMap.has(fKey)) {
            mergedFilesMap.set(fKey, tf);
          }
        }
      }
      targetRun = {
        ...targetRun,
        scenarios: Array.from(mergedScenariosMap.values()),
        testFiles: Array.from(mergedFilesMap.values()),
      };
    }

    if (!targetRun) {
      return res.status(200).json({
        success: true,
        data: {
          hasRun: false,
          testRunId: null,
          runner: null,
          executionMode: resultFilter.executionMode || null,
          totalScenarios: 0,
          testFiles: [],
          scenarios: [],
        },
      });
    }

    let rawScenarios = targetRun.scenarios || [];
    const statusFilter = req.query.status
      ? String(req.query.status).toLowerCase().trim()
      : null;
    if (statusFilter && statusFilter !== "all") {
      rawScenarios = rawScenarios.filter(
        (s) => (s.status || "").toLowerCase() === statusFilter,
      );
    }
    const fileFilter = req.query.testFile
      ? String(req.query.testFile).trim()
      : null;
    if (fileFilter) {
      rawScenarios = rawScenarios.filter(
        (s) => s.testFile && s.testFile.includes(fileFilter),
      );
    }

    const { summarizeSystemFailure } =
      await import("../../../shared/systemCaseCoverage.js");
    const enrichedScenarios = rawScenarios.map((s) => {
      const cleanedMsgs = (s.failureMessages || []).map((m) =>
        cleanStorageText(m),
      );
      const statusUpper = String(s.status || "").toUpperCase();
      return {
        id: s.id,
        title: s.title,
        suiteName: s.suiteName,
        status: s.status,
        durationMs: s.durationMs ?? null,
        executionDetails: s.executionDetails || null,
        failureMessages: cleanedMsgs,
        ...(statusUpper === "FAILED" ||
        statusUpper === "FAIL" ||
        statusUpper === "FLAKY"
          ? { failureSummary: summarizeSystemFailure(cleanedMsgs) }
          : {}),
        testFile: cleanStoragePath(s.testFile) || "unknown",
        failureBreakpoint: {
          failureStep: s.failureStep || null,
          failureCategory: s.failureCategory || null,
          failureCodeSnippet: s.failureCodeSnippet || null,
          hasDomSnapshot: Boolean(s.domSnapshot),
        },
        coverageContributions: {
          linesPct: null,
          branchesPct: null,
        },
        evidence: {
          hasScreenshot: Boolean(s.screenshotPath),
          screenshotUrl: s.screenshotPath
            ? `/api/coverage/${snapshotId}/system/scenarios/${s.id}/evidence`
            : null,
          hasDomSnapshot: Boolean(s.domSnapshot),
          domSnapshotUrl: s.domSnapshot
            ? `/api/coverage/${snapshotId}/system/scenarios/${s.id}/evidence?type=dom`
            : null,
        },
      };
    });

    const fileGroupsMap = new Map();
    for (const scenario of enrichedScenarios) {
      const fileKey = scenario.testFile || "unspecified";
      if (!fileGroupsMap.has(fileKey)) {
        fileGroupsMap.set(fileKey, {
          filePath: fileKey,
          status: "PASSED",
          durationMs: 0,
          totalScenarios: 0,
          passedScenarios: 0,
          failedScenarios: 0,
          flakyScenarios: 0,
          coverageLinesPct: null,
          scenarios: [],
        });
      }
      const group = fileGroupsMap.get(fileKey);
      group.scenarios.push(scenario);
      group.totalScenarios += 1;
      group.durationMs += scenario.durationMs || 0;
      if (scenario.status === "PASSED" || scenario.status === "passed") {
        group.passedScenarios += 1;
      } else if (scenario.status === "FAILED" || scenario.status === "failed") {
        group.failedScenarios += 1;
        group.status = "FAILED";
      } else if (scenario.status === "FLAKY" || scenario.status === "flaky") {
        group.flakyScenarios += 1;
        if (group.status !== "FAILED") group.status = "FLAKY";
      }
    }

    const dbFiles = targetRun.testFiles || [];
    for (const dbFile of dbFiles) {
      if (fileGroupsMap.has(dbFile.filePath)) {
        const grp = fileGroupsMap.get(dbFile.filePath);
        grp.coverageLinesPct = null;
        if (dbFile.durationMs) grp.durationMs = dbFile.durationMs;
      } else {
        fileGroupsMap.set(dbFile.filePath, {
          filePath: dbFile.filePath,
          status: dbFile.status,
          durationMs: dbFile.durationMs || 0,
          totalScenarios: dbFile.scenarioCount || 0,
          passedScenarios: 0,
          failedScenarios: 0,
          flakyScenarios: 0,
          coverageLinesPct: null,
          scenarios: [],
        });
      }
    }

    const groupedFiles = Array.from(fileGroupsMap.values());

    return res.status(200).json({
      success: true,
      data: {
        hasRun: true,
        testRunId: targetRun.id,
        runner: targetRun.type.toLowerCase(),
        executionMode: targetRun.executionMode,
        totalScenarios: enrichedScenarios.length,
        testFiles: groupedFiles,
        scenarios: enrichedScenarios,
      },
    });
  } catch (error) {
    console.error("[getSystemTestScenarios] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message || "Server error." });
  }
};

/**
 * POST /api/coverage/:snapshotId/system/save-ai-test
 * Manually saves an AI-generated Playwright test to the codebase even if dry-run timed out.
 */
export const saveAiSystemTest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      include: { project: true },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });

    const aiTest = await prisma.aiTest.findFirst({
      where: {
        snapshotId,
        mode: "PLAYWRIGHT_E2E",
      },
      orderBy: { createdAt: "desc" },
    });

    if (!aiTest) {
      return res.status(404).json({
        success: false,
        message: "No AI test found for this snapshot.",
      });
    }
    if (aiTest.status !== "VERIFIED")
      return res.status(409).json({
        success: false,
        message:
          "Only tests that pass full-system verification can be saved. Regenerate to repair this candidate.",
      });

    const targetFilePath = aiTest.filePath;
    let meta = {};
    try {
      meta =
        typeof aiTest.metaJson === "string"
          ? JSON.parse(aiTest.metaJson)
          : aiTest.metaJson || {};
    } catch (_) {}
    if (meta.applied === true)
      return res.status(200).json({
        success: true,
        data: {
          id: aiTest.id,
          snapshotId,
          alreadyApplied: true,
          filePath: aiTest.filePath,
        },
        message: "This generated candidate was already applied.",
      });
    const base = meta.proposalBase || meta;
    if (
      base.snapshotId !== snapshotId ||
      !Number.isSafeInteger(base.workspaceRevision) ||
      (base.isExisting !== false && !base.baseVersion)
    ) {
      throw Object.assign(
        new ServiceError(
          "This generated candidate has no captured file version. Regenerate it before applying.",
          428,
        ),
        { code: "FILE_VERSION_REQUIRED" },
      );
    }
    const canonicalPath = path
      .relative(
        snapshotWorkspaceRoot(snapshot),
        containedPath(snapshot.rootDir, targetFilePath),
      )
      .replaceAll("\\", "/");
    const mutation = await mutateProjectWorkspace({
      projectId: snapshot.projectId,
      snapshotId,
      userId,
      path: canonicalPath,
      kind: base.isExisting === false ? "CREATE_FILE" : "WRITE_FILE",
      content: aiTest.content,
      expectedVersion: base.baseVersion,
      expectedWorkspaceRevision: base.workspaceRevision,
      requestId: req.body?.requestId || `apply-system-${aiTest.id}`,
    });

    meta.dryRun = "MANUALLY_SAVED";
    meta.savedAt = new Date().toISOString();

    const updatedAiTest = await prisma.aiTest.update({
      where: { id: aiTest.id },
      data: {
        status: "VERIFIED",
        metaJson: JSON.stringify(meta),
      },
    });

    try {
      const { autoTransitionProjectToDoingIfNeeded } =
        await import("../services/job.service.js");
      void autoTransitionProjectToDoingIfNeeded(snapshot.projectId);
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: `Successfully saved test to ${targetFilePath}`,
      data: {
        id: updatedAiTest.id,
        status: updatedAiTest.status,
        filePath: updatedAiTest.filePath,
        content: updatedAiTest.content,
        ...mutation,
        meta,
        createdAt: updatedAiTest.createdAt,
      },
    });
  } catch (error) {
    console.error("[saveAiSystemTest] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code,
      details: error.details,
      message: error.message || "Server error while saving AI test.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/system/generate-tests
 * Cold-Start E2E system test generation for Playwright and Cypress.
 * Generates configuration if missing, harvests app context, prompts AI, validates AST,
 * and writes runnable test files to disk and DB.
 */
export const generateColdStartSystemTestsController = async (req, res) => {
  if (!req.user?.id)
    return res
      .status(401)
      .json({ success: false, message: "Authentication required" });
  const cancellation = new AbortController();
  const onAbort = () => cancellation.abort();
  req.once?.("aborted", onAbort);
  try {
    const framework = req.body?.framework || "playwright";
    const executionMode = requireFullStackMode(req.body?.executionMode);
    const targetRoutes = req.body?.routes || req.body?.targetRoutes || [];
    if (
      !["playwright", "cypress"].includes(framework) ||
      !Array.isArray(targetRoutes) ||
      targetRoutes.length > 20 ||
      targetRoutes.some(
        (route) =>
          typeof route !== "string" ||
          route.length > 500 ||
          !route.startsWith("/") ||
          route.startsWith("//"),
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Choose a supported framework, execution mode and at most 20 local routes.",
      });
    }

    const { snapshotId } = req.params;
    if (!snapshotId) {
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    }
    const { createSystemGenerationDraft } =
      await import("../services/systemGenerationProposal.service.js");
    const data = await createSystemGenerationDraft({
      snapshotId,
      userId: req.user.id,
      framework,
      targetRoutes,
      executionMode,
      model: requestedAiModel(req),
      signal: AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(10 * 60 * 1000),
      ]),
    });
    return res.status(201).json({
      success: true,
      data,
      message: "Draft generated. Review the tests before applying.",
    });
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) {
      console.error("[generateColdStartSystemTests] Generation failed:", error);
    }
    const providerBusy =
      !error.statusCode &&
      (error?.status === 503 ||
        error?.status === 429 ||
        /\b(503|429)\b|high demand|overloaded|Service Unavailable/i.test(
          String(error?.message || ""),
        ));
    if (providerBusy) {
      return res.status(503).json({
        success: false,
        code: "AI_PROVIDER_BUSY",
        details: error.details,
        message:
          "The AI model is busy right now. Retry in a minute or choose another model.",
      });
    }
    const timedOut =
      !error.statusCode &&
      (error?.name === "TimeoutError" || error?.name === "AbortError");
    return res.status(error.statusCode || (timedOut ? 504 : 500)).json({
      success: false,
      code: error.code,
      details: error.details,
      message: error.statusCode
        ? error.message
        : timedOut
          ? "System Test generation timed out. Retry with fewer target routes."
          : "System Test generation failed because of an unexpected server error. Retry; if it repeats, check the server log.",
    });
  } finally {
    req.off?.("aborted", onAbort);
  }
};

/**
 * POST /api/coverage/:snapshotId/apply-suggestion
 * Apply suggested test cases directly to test file on disk, rerun tests, and return fresh coverage.
 */
export const applySuggestion = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    let {
      projectId,
      suggestion,
      suggestions,
      skipBackgroundJob,
      requireCoverageGoal,
      requestId,
      dryRun,
    } = req.body || {};
    const isDryRun = Boolean(dryRun);
    if (
      requestId !== undefined &&
      (typeof requestId !== "string" ||
        !/^[A-Za-z0-9_-]{8,100}$/.test(requestId))
    )
      return res
        .status(400)
        .json({ success: false, message: "Invalid request ID" });

    if (!suggestion && (!suggestions || suggestions.length === 0)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "suggestion or suggestions array is required.",
        });
    }

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res
        .status(404)
        .json({
          success: false,
          message: "Snapshot not found or unauthorized.",
        });

    const actualSnapshotId = snapshot.id;
    const actualProjectId =
      projectId || snapshot.projectId || snapshot.project?.id;
    if (!actualProjectId) {
      return res
        .status(400)
        .json({ success: false, message: "Valid projectId is required." });
    }

    if (
      !isDryRun &&
      (req.body?.async === true || req.query?.async === "true")
    ) {
      const queuedData = await enqueueUnitTestJob({
        projectId: actualProjectId,
        snapshotId: actualSnapshotId,
        userId,
        type: "UNIT_TEST_APPLY",
        payloadJson: {
          projectId: actualProjectId,
          snapshotId: actualSnapshotId,
          userId,
          suggestion,
          suggestions,
          requestId,
          skipBackgroundJob,
          requireCoverageGoal: requireCoverageGoal === true,
        },
      });
      return res
        .status(queuedData.reused ? 200 : 202)
        .json({ success: true, data: queuedData });
    }

    const result = await applyUnitTestSuggestion({
      snapshotId: actualSnapshotId,
      projectId: actualProjectId,
      userId,
      suggestion,
      suggestions,
      requestId,
      dryRun: isDryRun,
      requireCoverageGoal: requireCoverageGoal === true,
    });

    // Refresh coverage after publication or after verifying an already covered baseline.
    let backgroundJob = null;
    let postApplyAnalysisError = null;
    if (!isDryRun && actualSnapshotId && actualProjectId) {
      try {
        backgroundJob = await scheduleUnitTestPostApplyAnalysis({
          result,
          projectId: actualProjectId,
          snapshotId: actualSnapshotId,
          userId,
          requestId,
          skipBackgroundJob,
        });
      } catch (jobErr) {
        postApplyAnalysisError =
          "Automatic coverage refresh could not be queued. Run Analysis to refresh project coverage.";
        console.warn(
          "[applySuggestion] Warning auto-triggering background RUN_TESTS job:",
          jobErr.message,
        );
      }
    }

    return res
      .status(200)
      .json({
        success: true,
        data: {
          ...result,
          backgroundJob,
          ...(postApplyAnalysisError ? { postApplyAnalysisError } : {}),
        },
      });
  } catch (error) {
    console.error("[applySuggestion] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to apply test suggestion.",
      ...(error.code === "INVALID_TEST_TARGET" && {
        code: error.code,
        details: error.details,
      }),
    });
  }
};

/**
 * GET /api/coverage/:snapshotId/system/tests/content?filePath=...
 * Reads and returns content and parsed metadata of a specific system test file.
 */
export const getSystemTestFileContent = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const filePath = req.query.filePath;
    if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
      return res.status(400).json({
        success: false,
        message: "filePath query parameter is required.",
      });
    }

    const { snapshot } = await resolveSnapshotAccess({
      snapshotId,
      userId,
      capability: "project.read",
    });
    if (!snapshot)
      return res.status(404).json({
        success: false,
        message: "Snapshot not found or unauthorized.",
      });
    if (snapshot.rootDir) {
      snapshot.rootDir =
        resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;
    }
    if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
      return res
        .status(409)
        .json({ success: false, message: "Snapshot directory not found." });
    }

    const fullPath = containedPath(snapshot.rootDir, filePath.trim());
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return res
        .status(404)
        .json({ success: false, message: `Test file not found: ${filePath}` });
    }

    const canonicalPath = path
      .relative(snapshotWorkspaceRoot(snapshot), fullPath)
      .replaceAll("\\", "/");
    const versioned = await readVersionedProjectFile({
      projectId: snapshot.projectId,
      snapshotId,
      userId,
      path: canonicalPath,
    });
    const { content } = versioned;
    const isCypress =
      filePath.toLowerCase().includes("cypress") || /\bcy\./.test(content);
    const framework = isCypress ? "cypress" : "playwright";
    const { suites, scenarios } = extractSuitesAndScenarios(
      content,
      framework.toUpperCase(),
    );

    return res.status(200).json({
      success: true,
      data: {
        filePath: filePath.trim(),
        content,
        snapshotId: versioned.snapshotId,
        version: versioned.version,
        workspaceRevision: versioned.workspaceRevision,
        framework,
        size: versioned.size,
        lineCount: content.split("\n").length,
        suites,
        scenarios,
        suiteCount: suites.length,
        scenarioCount: scenarios.length,
      },
    });
  } catch (error) {
    console.error("[getSystemTestFileContent] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to read test file.",
    });
  }
};

/**
 * PUT /api/coverage/:snapshotId/system/tests/content
 * Updates and saves modified test file content to disk and synchronizes DB records.
 */
export const updateSystemTestFileContent = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const { filePath, content } = req.body || {};
    if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "filePath is required." });
    }
    if (typeof content !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "content string is required." });
    }

    const { snapshot } = await resolveSnapshotAccess({
      snapshotId,
      userId,
      capability: "files.write",
    });
    if (!snapshot)
      return res.status(404).json({
        success: false,
        message: "Snapshot not found or unauthorized.",
      });
    if (snapshot.rootDir) {
      snapshot.rootDir =
        resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;
    }
    if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
      return res
        .status(409)
        .json({ success: false, message: "Snapshot directory not found." });
    }

    // Validate syntax and dangerous imports using AST validator
    validateGeneratedTestCode(content);

    const fullPath = containedPath(snapshot.rootDir, filePath.trim());
    const canonicalPath = path
      .relative(snapshotWorkspaceRoot(snapshot), fullPath)
      .replaceAll("\\", "/");
    const mutation = await mutateProjectWorkspace({
      projectId: snapshot.projectId,
      snapshotId,
      userId,
      path: canonicalPath,
      content,
      kind: "WRITE_FILE",
      expectedVersion: req.body.expectedVersion,
      expectedWorkspaceRevision: req.body.expectedWorkspaceRevision,
      requestId: req.body.requestId,
    });

    const isCypress =
      filePath.toLowerCase().includes("cypress") || /\bcy\./.test(content);
    const framework = isCypress ? "cypress" : "playwright";
    const { suites, scenarios } = extractSuitesAndScenarios(
      content,
      framework.toUpperCase(),
    );

    // Update any associated AiTest record
    try {
      await withProjectGuard(
        { projectId: snapshot.projectId, userId, capability: "files.write" },
        async (tx, access) => {
          if (access.project.workspaceRevision !== mutation.workspaceRevision)
            return;
          await tx.aiTest.updateMany({
            where: { snapshotId, filePath: filePath.trim() },
            data: { content },
          });
        },
      );
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "Test file saved successfully.",
      data: {
        snapshotId: mutation.snapshotId,
        version: mutation.version,
        workspaceRevision: mutation.workspaceRevision,
        filePath: filePath.trim(),
        framework,
        suiteCount: suites.length,
        scenarioCount: scenarios.length,
        suites,
        scenarios,
      },
    });
  } catch (error) {
    console.error("[updateSystemTestFileContent] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code,
      details: error.details,
      message: error.message || "Failed to update test file.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/system/tests/run-single
 * Executes a single test file quickly for immediate verification without rerunning the entire suite.
 */
export const runSingleSystemTest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const {
      filePath,
      runner: rawRunner,
      framework: rawFramework,
      executionMode: explicitMode,
    } = req.body || {};
    const explicitRunner = rawRunner || rawFramework;
    if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "filePath is required." });
    }

    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      include: { project: true },
    });

    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId,
      capability: "project.read",
    });
    if (snapshot.rootDir) {
      snapshot.rootDir =
        resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;
    }
    if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
      return res.status(409).json({
        success: false,
        message: "Snapshot repository not ready on disk.",
      });
    }

    const fullPath = containedPath(snapshot.rootDir, filePath.trim());
    if (!fs.existsSync(fullPath)) {
      return res
        .status(404)
        .json({ success: false, message: `Test file not found: ${filePath}` });
    }

    // Detect runner if not explicitly provided
    let runner = explicitRunner
      ? String(explicitRunner).toLowerCase().trim()
      : null;
    if (!runner) {
      const isCypress =
        filePath.toLowerCase().includes("cypress") || filePath.includes(".cy.");
      runner = isCypress ? "cypress" : "playwright";
    }
    if (!["playwright", "cypress"].includes(runner)) {
      return res.status(400).json({
        success: false,
        message: "runner must be 'playwright' or 'cypress'.",
      });
    }

    const executionMode = requireFullStackMode(explicitMode);

    const job = await createSystemTestAnalysisJob({
      projectId: snapshot.projectId,
      snapshotId,
      userId,
      runner,
      executionMode,
      testFile: filePath.trim(),
    });

    await addJobToQueue("SYSTEM_TEST_ANALYSIS", job.id, {
      snapshotId,
      userId,
      projectId: snapshot.projectId,
      runner,
      executionMode,
      testFile: filePath.trim(),
    });

    return res.status(202).json({
      success: true,
      jobId: job.id,
      message: `Single test file execution queued for ${filePath.trim()}`,
      data: {
        jobId: job.id,
        filePath: filePath.trim(),
        runner,
        executionMode,
      },
    });
  } catch (error) {
    console.error("[runSingleSystemTest] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to run single test.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/system/optimize-test
 * Invokes AI Booster to optimize coverage or repair failure breakpoint in a test file.
 */
export const optimizeSystemTestController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const {
      filePath,
      scenarioId,
      mode = "BOOST_COVERAGE",
      instruction,
    } = req.body || {};

    if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "filePath is required." });
    }

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res.status(404).json({
        success: false,
        message: "Snapshot not found or unauthorized.",
      });
    if (snapshot.rootDir) {
      snapshot.rootDir =
        resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;
    }
    if (!snapshot.rootDir || !fs.existsSync(snapshot.rootDir)) {
      return res.status(409).json({
        success: false,
        message: "Snapshot repository not ready on disk.",
      });
    }

    let scenarioData = null;
    if (scenarioId) {
      scenarioData = await prisma.testScenario.findFirst({
        where: {
          id: scenarioId,
          testRun: { snapshotId },
          testFile: filePath.trim(),
        },
      });
      if (!scenarioData)
        return res.status(404).json({
          success: false,
          message: "Scenario not found for this snapshot and test file",
        });
    }
    const optimizationResult = await optimizeSystemTest({
      model: requestedAiModel(req),
      rootDir: snapshot.rootDir,
      snapshotId,
      filePath: filePath.trim(),
      scenarioData,
      mode,
      instruction: instruction || null,
    });

    return res.status(200).json({
      success: true,
      message: `Successfully optimized test (${optimizationResult.mode}).`,
      data: optimizationResult,
    });
  } catch (error) {
    console.error("[optimizeSystemTestController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to optimize test file.",
    });
  }
};

import {
  buildUnifiedQualityDashboard,
  getUnifiedTestRunInspection,
  clearUnifiedDashboardCache,
} from "../services/unifiedQualityDashboard.service.js";

/**
 * GET /api/coverage/:snapshotId/unified-dashboard
 * Returns the aggregated single-project Unified Quality Overview payload across Unit, Integration, and System layers.
 */
export const getUnifiedQualityDashboardController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    if (!snapshotId || typeof snapshotId !== "string" || !snapshotId.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    }

    const bypassCache =
      req.query?.refresh === "true" || req.query?.bypassCache === "true";

    const data = await buildUnifiedQualityDashboard({
      snapshotId: snapshotId.trim(),
      userId,
      bypassCache,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[getUnifiedQualityDashboardController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to build unified quality dashboard.",
    });
  }
};

/**
 * GET /api/coverage/:snapshotId/unified-dashboard/runs/:runId
 * Returns full inspection details for a specific TestRun for the SlideOverInspectorDrawer.
 */
export const getUnifiedTestRunInspectionController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId, runId } = req.params;
    if (!snapshotId || !runId) {
      return res.status(400).json({
        success: false,
        message: "snapshotId and runId are required.",
      });
    }

    const data = await getUnifiedTestRunInspection({
      snapshotId: snapshotId.trim(),
      runId: runId.trim(),
      userId,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[getUnifiedTestRunInspectionController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load test run inspection details.",
    });
  }
};

/**
 * GET /api/coverage/:snapshotId/unit-test-versions
 * Retrieves all stored unit test versions for the snapshot or a specific file.
 */
export const getUnitTestVersionsController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const { filePath } = req.query;

    if (!snapshotId) {
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    }

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res
        .status(404)
        .json({
          success: false,
          message: "Snapshot not found or unauthorized.",
        });

    const versions = await getCommittedUnitTestVersions({
      snapshot,
      userId,
      filePath: filePath ? String(filePath).trim() : null,
    });

    return res.status(200).json({
      success: true,
      data: versions,
    });
  } catch (error) {
    console.error("[getUnitTestVersionsController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load unit test versions.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/unit-test-versions/switch
 * Switches a test file (or all test files) to target version (Old vs New).
 */
export const switchUnitTestVersionController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const {
      projectId,
      filePath,
      targetVersionId,
      targetVersion,
      allFiles,
      targetVersionType,
      runTests = true,
    } = req.body || {};

    if (!snapshotId) {
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    }

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res
        .status(404)
        .json({
          success: false,
          message: "Snapshot not found or unauthorized.",
        });

    const isAllFiles = Boolean(allFiles);
    const cleanFilePath =
      filePath && typeof filePath === "string" && filePath.trim()
        ? filePath.trim()
        : null;

    if (!isAllFiles && !cleanFilePath) {
      return res.status(400).json({
        success: false,
        message: "Either filePath or allFiles: true is required.",
      });
    }

    const parsedTargetVersion =
      targetVersion != null ? Number(targetVersion) : null;

    const result = await switchUnitTestVersion({
      snapshotId: snapshot.id,
      projectId: projectId || snapshot.projectId,
      userId,
      filePath: cleanFilePath,
      targetVersionId,
      targetVersion: parsedTargetVersion,
      allFiles: isAllFiles,
      targetVersionType,
      runTests: Boolean(runTests),
    });

    if (result && result.success === false) {
      return res.status(422).json({
        success: false,
        targetVersion: result?.targetVersion ?? parsedTargetVersion,
        message: result.message || "Failed to switch unit test version.",
        verification: result.verification,
        errorDetail: result.errorDetail,
        data: result,
      });
    }

    const resolvedTargetVersion =
      result?.targetVersion ?? parsedTargetVersion ?? 1;

    let coverage = result?.coverage || null;
    if (!coverage) {
      const summaryRecord = await prisma.coverageSummary.findUnique({
        where: { snapshotId: snapshot.id },
      });
      if (summaryRecord) {
        coverage = {
          statements: { pct: summaryRecord.stmtsPct },
          branches: { pct: summaryRecord.branchesPct },
          functions: { pct: summaryRecord.funcsPct },
          lines: { pct: summaryRecord.linesPct },
        };
      }
    }

    const message =
      result?.message ||
      (isAllFiles
        ? resolvedTargetVersion === 1
          ? "Successfully reverted all files to Version 1 (Baseline)."
          : `Successfully switched all files to Version ${resolvedTargetVersion}.`
        : `Successfully switched ${cleanFilePath || "file"} to Version ${resolvedTargetVersion}.`);

    return res.status(200).json({
      success: true,
      targetVersion: resolvedTargetVersion,
      message,
      coverage,
      data: {
        ...result,
        targetVersion: resolvedTargetVersion,
        message,
        coverage,
      },
    });
  } catch (error) {
    console.error("[switchUnitTestVersionController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to switch unit test version.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/unit-test-versions/save
 * Explicitly save or record versions for a unit test file.
 */
export const saveUnitTestVersionsController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    const {
      projectId,
      sourceFile,
      testFile,
      originalContent,
      updatedContent,
      framework,
      summary,
      isExisting,
      status,
    } = req.body || {};

    if (!snapshotId) {
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });
    }

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res
        .status(404)
        .json({
          success: false,
          message: "Snapshot not found or unauthorized.",
        });

    return res
      .status(409)
      .json({
        success: false,
        code: "VERIFIED_BATCH_REQUIRED",
        message:
          "Versions are created only after the complete Apply batch passes runner and coverage verification.",
      });
  } catch (error) {
    console.error("[saveUnitTestVersionsController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to save unit test versions.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/suggest-testcase-all
 * Suggest AI unit testcases for all candidate business logic files.
 */
export const suggestUnitTestcaseAll = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const { snapshotId } = req.params;
    let {
      projectId,
      framework,
      filePaths = [],
      validationMode = "fast",
    } = req.body || {};
    if (
      !Array.isArray(filePaths) ||
      filePaths.length > 2000 ||
      filePaths.some((file) => typeof file !== "string" || !file.trim()) ||
      !["fast", "full"].includes(validationMode)
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid suggestion file list or validation mode.",
        });
    }

    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res
        .status(404)
        .json({
          success: false,
          message: "Snapshot not found or unauthorized.",
        });

    const actualSnapshotId = snapshot.id;
    const actualProjectId =
      projectId || snapshot.projectId || snapshot.project?.id;
    if (!actualProjectId) {
      return res
        .status(400)
        .json({ success: false, message: "Valid projectId is required." });
    }

    if (req.body?.async === true || req.query?.async === "true") {
      const queuedData = await enqueueUnitTestJob({
        projectId: actualProjectId,
        snapshotId: actualSnapshotId,
        userId,
        type: "UNIT_TEST_SUGGEST",
        payloadJson: {
          projectId: actualProjectId,
          snapshotId: actualSnapshotId,
          userId,
          filePath: "all",
          filePaths,
          validationMode,
          framework,
          selectedAiModel: requestedAiModel(req),
        },
      });
      return res
        .status(queuedData.reused ? 200 : 202)
        .json({ success: true, data: queuedData });
    }

    const result = await suggestUnitTestcases({
      projectId: actualProjectId,
      snapshotId: actualSnapshotId,
      filePath: "all",
      filePaths,
      validationMode,
      userId,
      framework,
      selectedAiModel: requestedAiModel(req),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("[suggestUnitTestcaseAll] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message || "Failed to suggest unit testcases for all files.",
      });
  }
};

/**
 * GET /api/coverage/:snapshotId/unit/env-check
 * Non-blocking stub under R1 zero-.env architecture.
 */
export const checkUnitTestEnvironment = async (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      requiresPrompt: false,
      missingRequired: [],
      detectedVariables: [],
      existingVariables: {},
    },
  });
};

/**
 * POST /api/coverage/:snapshotId/unit/env
 * Non-blocking stub under R1 zero-.env architecture.
 */
export const saveUnitTestEnvironment = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Hermetic in-memory mocks active.",
  });
};

/**
 * GET /api/coverage/:snapshotId/simulation/sources
 * Returns business logic source files, functions, available tests, and virtual scenarios for simulation.
 */
export const getSimulationSources = async (req, res, next) => {
  try {
    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    if (!req.user?.id)
      return res.status(401).json({ success: false, message: "Unauthorized." });
    const snapshot = await findOwnedSnapshot(snapshotId, req.user.id);
    if (!snapshot)
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });

    const options = {
      ...(req.query || {}),
      rootDir: snapshot.rootDir,
      snapshot,
    };
    const result = await getAvailableSimulationSources(snapshot.id, options);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ServiceError)
      return res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    if (typeof next === "function") return next(error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to get simulation sources.",
      });
  }
};

/**
 * POST /api/coverage/:snapshotId/simulation/trace
 * Generates discrete AST execution simulation steps, branch evaluations, universal RAM mocks, and assertions.
 */
export const getSimulationTrace = async (req, res, next) => {
  try {
    const { snapshotId } = req.params;
    if (!snapshotId)
      return res
        .status(400)
        .json({ success: false, message: "snapshotId is required." });

    const { sourceFilePath, sourceCode } = req.body || {};
    if (!sourceFilePath && typeof sourceCode !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "sourceFilePath is required." });
    }

    if (!req.user?.id)
      return res.status(401).json({ success: false, message: "Unauthorized." });
    const snapshot = await findOwnedSnapshot(snapshotId, req.user.id);
    if (!snapshot && typeof sourceCode !== "string") {
      return res
        .status(404)
        .json({ success: false, message: "Snapshot not found." });
    }

    const payload = {
      ...(req.body || {}),
      rootDir: snapshot?.rootDir,
      snapshot,
    };
    let result = await generateSimulationTrace(snapshotId, payload);
    if (req.body?.capture === true) {
      const owned = await findOwnedSnapshot(snapshotId, req.user?.id);
      if (!req.user?.id || !owned)
        return res
          .status(404)
          .json({
            success: false,
            message: "Snapshot not found or unauthorized.",
          });
      const { resolveProjectAccess } =
        await import("../services/projectAccess.service.js");
      await resolveProjectAccess({
        projectId: owned.projectId,
        userId: req.user.id,
        capability: "tests.run",
      });
      result = await captureUnitTestTrace({
        snapshotId,
        rootDir: owned.rootDir,
        sourceFilePath: result.sourceFilePath,
        testFilePath: result.testFilePath,
        testCaseTitle: result.testCase?.fullTitle || result.testCase?.title,
        category: result.testCase?.category,
        workspaceRevision: owned.project?.workspaceRevision ?? null,
        scope: req.body?.scope === "suite" ? "suite" : "test",
      });
    } else if (
      snapshot &&
      !req.body?.sourceCode &&
      !req.body?.testCode &&
      !result.isVirtualScenario
    ) {
      result =
        findRecordedUnitTestTrace({
          snapshotId,
          rootDir: snapshot.rootDir,
          sourceFilePath: result.sourceFilePath,
          testFilePath: result.testFilePath,
          testCaseTitle: result.testCase?.fullTitle || result.testCase?.title,
          workspaceRevision: snapshot.project?.workspaceRevision ?? null,
        }) || result;
    }
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ServiceError)
      return res
        .status(error.statusCode || 400)
        .json({ success: false, message: error.message });
    if (typeof next === "function") return next(error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to generate simulation trace.",
      });
  }
};

/**
 * GET /api/coverage/:snapshotId/suites-readiness
 * Pre-flight HITL readiness check across Unit, Integration, and System suites
 */
export const getSuitesReadinessController = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { snapshotId } = req.params;
    const onlyActiveJob =
      req.query?.mode === "active-job-only" ||
      req.query?.onlyActiveJob === "true";
    const { getSuitesReadinessService } =
      await import("../services/suitesReadiness.service.js");
    const data = await getSuitesReadinessService({
      snapshotId,
      userId,
      onlyActiveJob,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[getSuitesReadinessController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to evaluate suites readiness.",
    });
  }
};

/**
 * POST /api/coverage/:snapshotId/system/scenarios/confirm-batch
 * Pre-flight HITL quick confirmation of unconfirmed system scenario outcomes
 */
export const confirmBatchSystemScenariosController = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { snapshotId } = req.params;
    const snapshot = await findOwnedSnapshot(snapshotId, userId);
    if (!snapshot)
      return res.status(404).json({
        success: false,
        message: "Snapshot not found or unauthorized.",
      });

    const updated = await prisma.systemScenario.updateMany({
      where: {
        snapshotId: snapshot.id,
        reviewState: { notIn: ["EXPECTED_CONFIRMED", "REVIEWED"] },
      },
      data: {
        reviewState: "EXPECTED_CONFIRMED",
        reviewedByUserId: userId,
        reviewedAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: `Confirmed expected outcomes for ${updated.count} system scenario(s).`,
      count: updated.count,
    });
  } catch (error) {
    console.error("[confirmBatchSystemScenariosController] Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to confirm system scenarios.",
    });
  }
};

const loadUnitCaseSnapshotAndAccess = async (
  snapshotId,
  userId,
  capability,
) => {
  if (!userId) throw new ServiceError("Unauthorized.", 401);
  if (!snapshotId) throw new ServiceError("snapshotId is required.", 400);
  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, projectId: true, rootDir: true },
  });
  if (!snapshot) throw new ServiceError("Snapshot not found.", 404);
  await resolveProjectAccess({
    projectId: snapshot.projectId,
    userId,
    capability,
  });
  return snapshot;
};

/**
 * GET /api/coverage/:snapshotId/unit/test-case?testFile=...&testName=...
 */
export const getUnitTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "project.read",
    );
    const { getUnitTestCaseDetail } =
      await import("../services/unitTestCaseOperations.service.js");
    const data = await getUnitTestCaseDetail({
      snapshot,
      testFile: req.query?.testFile,
      testName: req.query?.testName,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[getUnitTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to load unit test case.",
      });
  }
};

/**
 * POST /api/coverage/:snapshotId/unit/test-case
 */
export const addUnitTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "files.write",
    );
    const { addUnitTestCase } =
      await import("../services/unitTestCaseOperations.service.js");
    const data = await addUnitTestCase({ snapshot, ...(req.body || {}) });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("[addUnitTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to add unit test case.",
      });
  }
};

/**
 * PUT /api/coverage/:snapshotId/unit/test-case
 */
export const updateUnitTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "files.write",
    );
    const { updateUnitTestCase } =
      await import("../services/unitTestCaseOperations.service.js");
    const data = await updateUnitTestCase({ snapshot, ...(req.body || {}) });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[updateUnitTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to update unit test case.",
      });
  }
};

/**
 * DELETE /api/coverage/:snapshotId/unit/test-case
 */
export const deleteUnitTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "files.write",
    );
    const { deleteUnitTestCase } =
      await import("../services/unitTestCaseOperations.service.js");
    const bodyOrQuery = { ...(req.query || {}), ...(req.body || {}) };
    const data = await deleteUnitTestCase({ snapshot, ...bodyOrQuery });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[deleteUnitTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to delete unit test case.",
      });
  }
};

/**
 * POST /api/coverage/:snapshotId/unit/test-case/ai-fix
 */
export const aiFixUnitTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "ai.use",
    );
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId: req.user?.id,
      capability: "files.write",
    });
    const { aiFixUnitTestCase } =
      await import("../services/unitTestCaseOperations.service.js");
    const data = await aiFixUnitTestCase({
      snapshot,
      ...(req.body || {}),
      model: requestedAiModel(req),
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[aiFixUnitTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to AI fix unit test case.",
      });
  }
};

/**
 * GET /api/coverage/:snapshotId/system/test-case
 */
export const getSystemTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "project.read",
    );
    const { getSystemTestCaseDetail } =
      await import("../services/systemTestCaseOperations.service.js");
    const data = await getSystemTestCaseDetail({
      snapshot,
      testFile: req.query?.testFile,
      testName: req.query?.testName,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[getSystemTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to load system test scenario.",
      });
  }
};

/**
 * POST /api/coverage/:snapshotId/system/test-case
 */
export const addSystemTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "files.write",
    );
    const { addSystemTestCase } =
      await import("../services/systemTestCaseOperations.service.js");
    const data = await addSystemTestCase({
      snapshot,
      userId: req.user?.id,
      ...(req.body || {}),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("[addSystemTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to add system test scenario.",
      });
  }
};

/**
 * PUT /api/coverage/:snapshotId/system/test-case
 */
export const updateSystemTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "files.write",
    );
    const { updateSystemTestCase } =
      await import("../services/systemTestCaseOperations.service.js");
    const data = await updateSystemTestCase({
      snapshot,
      userId: req.user?.id,
      ...(req.body || {}),
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[updateSystemTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to update system test scenario.",
      });
  }
};

/**
 * DELETE /api/coverage/:snapshotId/system/test-case
 */
export const deleteSystemTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "files.write",
    );
    const { deleteSystemTestCase } =
      await import("../services/systemTestCaseOperations.service.js");
    const bodyOrQuery = { ...(req.query || {}), ...(req.body || {}) };
    const data = await deleteSystemTestCase({
      snapshot,
      userId: req.user?.id,
      ...bodyOrQuery,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[deleteSystemTestCaseController] Error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message: error.message || "Failed to delete system test scenario.",
      });
  }
};

/**
 * POST /api/coverage/:snapshotId/system/test-case/ai-fix
 */
export const aiFixSystemTestCaseController = async (req, res) => {
  try {
    const snapshot = await loadUnitCaseSnapshotAndAccess(
      req.params.snapshotId,
      req.user?.id,
      "ai.use",
    );
    await resolveProjectAccess({
      projectId: snapshot.projectId,
      userId: req.user?.id,
      capability: "files.write",
    });
    const { aiFixSystemTestCase } =
      await import("../services/systemTestCaseOperations.service.js");
    const data = await aiFixSystemTestCase({
      snapshot,
      userId: req.user?.id,
      ...(req.body || {}),
      model: requestedAiModel(req),
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[aiFi