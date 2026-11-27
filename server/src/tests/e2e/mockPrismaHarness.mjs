import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Force local offline mode before any server config module initializes Firebase/PostgreSQL
process.env.DATABASE_URL = "";
process.env.PROJECT_STORAGE_DRIVER = "local";
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

const createdTempDirs = new Set();
let backendPromise = null;
let clientPromise = null;
let snapshotCounter = 0;

export function nextSnapshotId(prefix = "snap-e2e") {
  snapshotCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${snapshotCounter}`;
}

export async function loadBackendModules() {
  if (!backendPromise) {
    backendPromise = (async () => {
      process.env.DATABASE_URL = "";
      process.env.PROJECT_STORAGE_DRIVER = "local";
      const prismaMod = await import("../../config/prisma.js");
      const dashboardMod = await import("../../services/unifiedQualityDashboard.service.js");
      return {
        setPrismaClient: prismaMod.setPrismaClient,
        buildUnifiedQualityDashboard: dashboardMod.buildUnifiedQualityDashboard,
        clearUnifiedDashboardCache: dashboardMod.clearUnifiedDashboardCache,
        buildCrossLayerMatrix: dashboardMod.buildCrossLayerMatrix,
        buildCausalTrendSeries: dashboardMod.buildCausalTrendSeries,
        diagnoseModuleRootCause: dashboardMod.diagnoseModuleRootCause,
        isExcludedCausalRun: dashboardMod.isExcludedCausalRun,
        getDashboardFingerprint: dashboardMod.getDashboardFingerprint,
      };
    })();
  }
  return backendPromise;
}

export async function loadClientModules() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const [adapterMod, selectorsMod, diagramsMod, exportMod, i18nMod] = await Promise.all([
        import("../../../../client/src/services/unifiedDashboard/unifiedDashboard.adapter.js"),
        import("../../../../client/src/services/unifiedDashboard/unifiedDashboard.selectors.js"),
        import("../../../../client/src/services/unifiedDashboard/unifiedDashboard.reportDiagrams.js"),
        import("../../../../client/src/services/unifiedDashboard/unifiedDashboard.export.js"),
        import("../../../../client/src/services/unifiedDashboard/unifiedDashboard.reportI18n.js"),
      ]);
      return {
        ...adapterMod,
        ...selectorsMod,
        ...diagramsMod,
        ...exportMod,
        ...i18nMod,
      };
    })();
  }
  return clientPromise;
}

export function createTempProjectDir(prefix = "covai-e2e-proj-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdTempDirs.add(dir);
  // Required by resolveSnapshotRootDir() -> hasCodeOrConfig() on Windows
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "covai-e2e-fixture",
        version: "1.0.0",
        private: true,
        type: "module",
      },
      null,
      2
    ),
    "utf8"
  );
  return dir;
}

export function writeProjectFile(rootDir, relPath, content, options = {}) {
  const fullPath = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const serialized = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(fullPath, serialized, "utf8");
  if (Number.isFinite(options.mtimeOffsetMs)) {
    const targetDate = new Date(Date.now() + options.mtimeOffsetMs);
    fs.utimesSync(fullPath, targetDate, targetDate);
  }
  return fullPath;
}

export function removeTempDir(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    // ignore cleanup failures on locked handles
  } finally {
    createdTempDirs.delete(dir);
  }
}

export function cleanupTempDirs() {
  for (const dir of [...createdTempDirs]) {
    removeTempDir(dir);
  }
}

function buildStructureAnalysisRecord(fixtureState) {
  if (fixtureState.structureAnalysis) {
    return fixtureState.structureAnalysis;
  }
  const hasIntegrationScan = Boolean(fixtureState.integrationScan);
  const hasPeakUnitReport = Boolean(fixtureState.peakUnitReport);
  if (!hasIntegrationScan && !hasPeakUnitReport) {
    return null;
  }
  const resultObj = {};
  if (hasIntegrationScan) {
    resultObj.integrationScan = fixtureState.integrationScan;
  }
  if (hasPeakUnitReport) {
    resultObj.peakUnitReport = fixtureState.peakUnitReport;
  }
  return {
    schemaVersion: 1,
    resultJson: JSON.stringify(resultObj),
  };
}

export function createMockPrisma(fixtureState = {}) {
  const snapshot = fixtureState.snapshot || null;
  const projectSnapshots = fixtureState.projectSnapshots || (snapshot ? [snapshot] : []);
  const coverageFiles = fixtureState.coverageFiles || [];
  const jobs = fixtureState.jobs || [];
  const aiTests = fixtureState.aiTests || [];
  const allTestRuns = fixtureState.testRuns || [];
  const snapshotTestRuns = fixtureState.snapshotTestRuns || allTestRuns;
  const historicalTestRuns = fixtureState.historicalTestRuns || allTestRuns;
  let structureAnalysis = buildStructureAnalysisRecord(fixtureState);

  return {
    projectSnapshot: {
      findUnique: async ({ where } = {}) => {
        if (!snapshot) return null;
        if (where?.id && where.id !== snapshot.id) return null;
        return snapshot;
      },
      findMany: async () => projectSnapshots,
    },
    coverageFile: {
      findMany: async ({ where } = {}) => {
        if (!where?.snapshotId) return coverageFiles;
        return coverageFiles.filter((f) => !f.snapshotId || f.snapshotId === where.snapshotId);
      },
    },
    coverageSummary: {
      findUnique: async ({ where } = {}) => {
        if (fixtureState.coverageSummary !== undefined) {
          return fixtureState.coverageSummary;
        }
        if (snapshot && (!where?.snapshotId || where.snapshotId === snapshot.id)) {
          return snapshot.coverageSummaries || null;
        }
        return null;
      },
    },
    job: {
      findMany: async ({ where } = {}) => {
        if (!where?.snapshotId) return jobs;
        return jobs.filter((j) => !j.snapshotId || j.snapshotId === where.snapshotId);
      },
    },
    aiTest: {
      findMany: async () => aiTests,
      findFirst: async () => aiTests[0] || null,
    },
    testRun: {
      findMany: async ({ where } = {}) => {
        if (where?.snapshotId) {
          return snapshotTestRuns.filter((r) => !r.snapshotId || r.snapshotId === where.snapshotId);
        }
        return historicalTestRuns;
      },
      findFirst: async ({ where } = {}) => {
        const list = where?.snapshotId
          ? snapshotTestRuns.filter((r) => !r.snapshotId || r.snapshotId === where.snapshotId)
          : allTestRuns;
        return list[0] || null;
      },
    },
    project: {
      findUnique: async () => snapshot?.project || null,
      updateMany: async () => ({ count: 0 }),
    },
    projectMember: {
      findUnique: async () => null,
      findFirst: async () => null,
    },
    projectStructureAnalysis: {
      findUnique: async ({ where } = {}) => {
        if (!snapshot || (where?.snapshotId && where.snapshotId !== snapshot.id)) {
          return null;
        }
        return structureAnalysis;
      },
      upsert: async ({ create, update } = {}) => {
        const resultJson = update?.resultJson ?? create?.resultJson ?? "{}";
        structureAnalysis = {
          schemaVersion: create?.schemaVersion || structureAnalysis?.schemaVersion || 1,
          resultJson,
        };
        return structureAnalysis;
      },
    },
  };
}

export async function runBackendDashboard({
  snapshotId,
  userId = "user-e2e-owner",
  fixtureState,
}) {
  const { setPrismaClient, buildUnifiedQualityDashboard, clearUnifiedDashboardCache } =
    await loadBackendModules();
  setPrismaClient(createMockPrisma(fixtureState));
  if (snapshotId) {
    clearUnifiedDashboardCache(snapshotId);
  }
  return buildUnifiedQualityDashboard({
    snapshotId,
    userId,
    bypassCache: true,
  });
}
