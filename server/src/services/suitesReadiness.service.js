import fs from 'node:fs';
import path from 'node:path';
import prisma from '../config/prisma.js';
import { resolveSnapshotRootDir } from '../utils/projectRootResolver.js';
import { detectCoverageFrameworks } from './coverageFramework.service.js';
import { detectIntegrationFrameworks } from './integrationDetection.service.js';
import { scanSystemTestFiles } from '../utils/testFileParser.js';
import { ServiceError } from '../utils/serviceError.js';

/**
 * Scan filesystem for unit test files excluding integration and e2e paths
 */
function scanUnitTestFiles(dir, rootDir, testFiles = []) {
  if (!fs.existsSync(dir)) return testFiles;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/').toLowerCase();

      if (entry.isDirectory()) {
        const ignoredDirs = [
          'node_modules', '.git', 'coverage', 'dist', 'build', '.next', '.vite',
          '.vitest', 'integration', 'e2e', 'cypress', '.covai', '.covai-temp',
          '.covai-system-test', 'tests/integration', 'tests/e2e', 'tests/system'
        ];
        if (!ignoredDirs.some(ignored => relPath === ignored || relPath.startsWith(ignored + '/') || entry.name === ignored)) {
          scanUnitTestFiles(fullPath, rootDir, testFiles);
        }
      } else if (entry.isFile()) {
        // Must match unit test pattern and not be in integration/e2e directories
        if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
          if (!relPath.includes('integration') && !relPath.includes('e2e') && !relPath.includes('cypress')) {
            testFiles.push(relPath);
          }
        }
      }
    }
  } catch (_) {}
  return testFiles;
}

/**
 * Evaluates the readiness of all 3 test suites (unit, integration, system)
 * for a specific snapshot and returns unified pre-flight checks and HITL actions.
 */
export async function getSuitesReadinessService({ snapshotId, userId }) {
  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    include: { project: true }
  });

  if (!snapshot) {
    throw new ServiceError('Snapshot not found', 404);
  }

  const rootDir = resolveSnapshotRootDir(snapshot.rootDir) || snapshot.rootDir;
  if (!rootDir || !fs.existsSync(rootDir)) {
    throw new ServiceError('Snapshot workspace directory unavailable', 409);
  }

  // ── 1. UNIT TEST SUITE READINESS ──────────────────────────────────────────
  let unitFramework = 'jest';
  let unitTestFiles = [];
  try {
    const unitDetection = detectCoverageFrameworks(rootDir);
    const unitFws = unitDetection.supported?.unit || [];
    unitFramework = (unitFws.includes('jest') && unitFws.includes('vitest'))
      ? 'jest & vitest'
      : (unitFws.includes('vitest') ? 'vitest' : 'jest');
  } catch (_) {}

  unitTestFiles = scanUnitTestFiles(rootDir, rootDir);
  const pendingSuggestionsCount = await prisma.aiSuggestion.count({
    where: {
      snapshotId: snapshot.id,
      status: { in: ['PENDING', 'SUGGESTED', 'DRAFT'] }
    }
  }).catch(() => 0);

  const unitReady = unitTestFiles.length > 0;
  let unitStatus = 'READY';
  const unitBlockers = [];
  const unitHitlActions = [];

  if (!unitReady) {
    if (pendingSuggestionsCount > 0) {
      unitStatus = 'NEEDS_SUGGESTION_REVIEW';
      unitBlockers.push({
        code: 'PENDING_SUGGESTIONS',
        message: `${pendingSuggestionsCount} unit test suggestion(s) are waiting to be reviewed and applied.`
      });
      unitHitlActions.push({
        actionType: 'REVIEW_UNIT_SUGGESTIONS',
        label: `Review ${pendingSuggestionsCount} AI Unit Suggestion(s)`,
        targetTab: 'unit'
      });
    } else {
      unitStatus = 'NO_TESTS';
      unitBlockers.push({
        code: 'NO_UNIT_TESTS',
        message: 'No physical unit test files (*.test.js, *.spec.js) discovered in workspace.'
      });
      unitHitlActions.push({
        actionType: 'OPEN_WORKSPACE',
        label: 'Launch Unit Test Suite',
        targetTab: 'unit'
      });
    }
  }

  const unitSuite = {
    suite: 'unit',
    status: unitStatus,
    readyForExecution: unitReady,
    framework: unitFramework,
    testFilesCount: unitTestFiles.length,
    pendingSuggestionsCount,
    blockers: unitBlockers,
    hitlActions: unitHitlActions
  };

  // ── 2. INTEGRATION TEST SUITE READINESS ────────────────────────────────────
  let integrationDetection;
  try {
    integrationDetection = await detectIntegrationFrameworks(rootDir);
  } catch (err) {
    integrationDetection = {
      summary: {
        hasDependencies: false,
        hasTestFiles: false,
        readyForExecution: false,
        missingPackages: ['supertest', 'jest']
      },
      details: { permutation: 'D' }
    };
  }

  const aiTests = await prisma.aiTest.findMany({
    where: { snapshotId: snapshot.id }
  }).catch(() => []);

  let approvedScenariosCount = 0;
  let draftScenariosCount = 0;

  for (const t of aiTests) {
    if (!t.metaJson) continue;
    try {
      const meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson;
      if (meta.framework && String(meta.framework).toUpperCase() !== 'SUPERTEST') continue;
      if (meta.status === 'REJECTED' || meta.status === 'DISABLED') continue;

      const approvedList = Array.isArray(meta.approvedScenarios) ? meta.approvedScenarios : [];
      if (meta.status === 'APPROVED' || meta.status === 'APPLIED' || approvedList.length > 0) {
        approvedScenariosCount += (approvedList.length || 1);
      } else {
        const reqs = Array.isArray(meta.requests) ? meta.requests.length : 1;
        draftScenariosCount += reqs;
      }
    } catch (_) {}
  }

  const hasPhysicalIntFiles = Boolean(
    integrationDetection.hasTestFiles ??
    (integrationDetection.supertestFiles && integrationDetection.supertestFiles.length > 0) ??
    integrationDetection.summary?.hasTestFiles
  );
  const hasDependencies = Boolean(
    integrationDetection.hasDependencies ??
    integrationDetection.supertest?.hasDep ??
    integrationDetection.summary?.hasDependencies
  );
  const missingPackages =
    integrationDetection.permutationDetails?.missingPackages ||
    integrationDetection.summary?.missingPackages ||
    (hasDependencies ? [] : ['supertest', 'jest']);

  let intStatus = 'READY';
  let intReady = false;
  const intBlockers = [];
  const intHitlActions = [];

  if (!hasDependencies) {
    intStatus = 'NEEDS_DEPENDENCY';
    intReady = false;
    intBlockers.push({
      code: 'MISSING_INTEGRATION_DEPS',
      message: `Snapshot workspace requires '${(missingPackages.length > 0 ? missingPackages : ['supertest', 'jest']).join(', ')}' installed in package.json.`
    });
    intHitlActions.push({
      actionType: 'INSTALL_INTEGRATION_DEPS',
      label: `Install ${(missingPackages.length > 0 ? missingPackages : ['supertest', 'jest']).join(' & ')}`,
      endpoint: `/api/coverage/${snapshot.id}/integration/install-dependencies`
    });
  } else if (!hasPhysicalIntFiles && approvedScenariosCount === 0) {
    if (draftScenariosCount > 0) {
      intStatus = 'NEEDS_SCENARIO_REVIEW';
      intReady = false;
      intBlockers.push({
        code: 'DRAFT_INTEGRATION_SCENARIOS',
        message: `${draftScenariosCount} integration scenario(s) are in DRAFT status and need human review/approval.`
      });
      intHitlActions.push({
        actionType: 'APPROVE_INTEGRATION_SCENARIOS',
        label: `Approve All ${draftScenariosCount} Pending Scenario(s)`,
        endpoint: `/api/coverage/${snapshot.id}/integration/approve`
      });
      intHitlActions.push({
        actionType: 'OPEN_WORKSPACE',
        label: 'Review in Workspace ↗',
        targetTab: 'integration'
      });
    } else {
      intStatus = 'NO_TESTS';
      intReady = false;
      intBlockers.push({
        code: 'NO_INTEGRATION_TESTS',
        message: "No Supertest integration test files or AI scenarios found. Generate AI scenarios to proceed."
      });
      intHitlActions.push({
        actionType: 'OPEN_WORKSPACE',
        label: 'Open Integration Workspace ↗',
        targetTab: 'integration'
      });
    }
  } else {
    intStatus = 'READY';
    intReady = true;
  }

  const integrationSuite = {
    suite: 'integration',
    status: intStatus,
    readyForExecution: intReady,
    framework: 'supertest',
    permutation: integrationDetection.details?.permutation || 'A',
    permutationLabel: integrationDetection.details?.classification?.key || 'READY_TO_RUN',
    testFilesCount: integrationDetection.summary?.testFilesCount || 0,
    approvedScenariosCount,
    draftScenariosCount,
    missingPackages,
    blockers: intBlockers,
    hitlActions: intHitlActions
  };

  // ── 3. SYSTEM TEST SUITE READINESS ────────────────────────────────────────
  const systemScenarios = await prisma.systemScenario.findMany({
    where: { snapshotId: snapshot.id }
  }).catch(() => []);

  let systemStatus = 'READY';
  let systemReady = false;
  const systemBlockers = [];
  const systemHitlActions = [];

  const unconfirmedScenarios = systemScenarios.filter(
    s => !['EXPECTED_CONFIRMED', 'REVIEWED'].includes(s.reviewState)
  );

  if (systemScenarios.length > 0) {
    if (unconfirmedScenarios.length > 0) {
      systemStatus = 'NEEDS_SCENARIO_REVIEW';
      systemReady = false;
      systemBlockers.push({
        code: 'EXPECTED_UNCONFIRMED',
        message: `${unconfirmedScenarios.length} system scenario(s) require human confirmation of expected outcomes before execution.`
      });
      systemHitlActions.push({
        actionType: 'CONFIRM_SYSTEM_OUTCOMES',
        label: `Confirm All ${unconfirmedScenarios.length} Expected Outcomes`,
        endpoint: `/api/coverage/${snapshot.id}/system/scenarios/confirm-batch`
      });
      systemHitlActions.push({
        actionType: 'OPEN_WORKSPACE',
        label: 'Review in System Workspace ↗',
        targetTab: 'system'
      });
    } else {
      systemStatus = 'READY';
      systemReady = true;
    }
  } else {
    // Check if physical files exist on disk
    let scanResult = { playwrightFiles: [], cypressFiles: [] };
    try {
      scanResult = scanSystemTestFiles(rootDir);
    } catch (_) {}

    const totalSystemFiles = (scanResult.playwrightFiles?.length || 0) + (scanResult.cypressFiles?.length || 0);

    if (totalSystemFiles > 0) {
      systemStatus = 'NEEDS_SCENARIO_REVIEW';
      systemReady = false;
      systemBlockers.push({
        code: 'CATALOG_SYNC_REQUIRED',
        message: `${totalSystemFiles} system test file(s) found on disk. Catalog sync and scenario review required.`
      });
      systemHitlActions.push({
        actionType: 'OPEN_WORKSPACE',
        label: 'Sync & Review in System Workspace ↗',
        targetTab: 'system'
      });
    } else {
      systemStatus = 'NO_TESTS';
      systemReady = false;
      systemBlockers.push({
        code: 'NO_SYSTEM_TESTS',
        message: 'No E2E test files or system scenarios found in workspace.'
      });
      systemHitlActions.push({
        actionType: 'OPEN_WORKSPACE',
        label: 'Open System Workspace ↗',
        targetTab: 'system'
      });
    }
  }

  const systemSuite = {
    suite: 'system',
    status: systemStatus,
    readyForExecution: systemReady,
    runner: 'playwright',
    totalScenarios: systemScenarios.length,
    readyScenarios: systemScenarios.length - unconfirmedScenarios.length,
    unconfirmedScenariosCount: unconfirmedScenarios.length,
    blockers: systemBlockers,
    hitlActions: systemHitlActions
  };

  // ── 4. ACTIVE SUITE RUN DETECTION (FOR F5 / NETWORK RECOVERY) ──────────────
  const activeJob = await prisma.job.findFirst({
    where: {
      projectId: snapshot.projectId,
      snapshotId: snapshot.id,
      type: { in: ['RUN_TESTS', 'INSTALL_DEPS', 'SUPERTEST_COVERAGE', 'SYSTEM_TEST_ANALYSIS'] },
      status: { in: ['QUEUED', 'RUNNING'] }
    },
    orderBy: { createdAt: 'desc' }
  }).catch(() => null);

  const activeSuiteRun = activeJob ? {
    jobId: activeJob.id,
    type: activeJob.type,
    pillar: activeJob.type === 'RUN_TESTS'
      ? 'unit'
      : (activeJob.type === 'SUPERTEST_COVERAGE' || activeJob.type === 'INSTALL_DEPS')
        ? 'integration'
        : 'system',
    status: activeJob.status,
    progress: activeJob.progress || 0,
    stage: activeJob.stage || '',
    startedAt: activeJob.startedAt || activeJob.createdAt
  } : null;

  const suites = {
    unit: unitSuite,
    integration: integrationSuite,
    system: systemSuite
  };

  const readyCount = [unitReady, intReady, systemReady].filter(Boolean).length;
  const allReady = readyCount === 3;

  return {
    snapshotId: snapshot.id,
    projectId: snapshot.projectId,
    allReady,
    readyCount,
    activeSuiteRun,
    suites
  };
}

