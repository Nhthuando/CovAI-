# System Test Analysis Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Execute configured Playwright or Cypress E2E suites safely, collect normalized test results and optional Istanbul coverage, and persist a truthful terminal Job state.

**Architecture:** A detector resolves one executable runner from a snapshot without guessing a startup command. A new job processor invokes the existing isolated command runner, parses framework reports, persists TestRun and coverage through existing services, then finalizes once. The project API and BullMQ queue only create and dispatch this job, leaving legacy runner endpoints unchanged.

**Tech Stack:** Node.js ES modules, Express, Prisma/PostgreSQL, BullMQ, Jest, Docker/direct-shell runner, Playwright/Cypress JSON reports, Istanbul.

## Global Constraints

- Support Playwright and Cypress only; do not change Jest, Vitest, Supertest, or AI-generation behavior.
- Require package dependency plus explicit config/server declaration or one of scripts test:e2e, test:e2e:playwright, test:e2e:cypress.
- Never run npm install, browser install, or inferred start commands in uploaded snapshots.
- Preserve output via existing jobOutput service and use job lifecycle helpers for terminal state.
- Coverage is optional: consume existing Istanbul files only when present.
- Preserve all pre-existing uncommitted Cypress AI-generation files and client package-lock.

---

### Task 1: Add system-test database types and job creation

**Files:**
- Modify: server/prisma/schema.prisma
- Create: server/prisma/migrations/<timestamp>_add_system_test_analysis/migration.sql
- Modify: server/src/services/job.service.js
- Test: server/src/tests/job.service.test.js

**Interfaces:**
- Produces createSystemTestAnalysisJob({ projectId, snapshotId, userId, runner }).
- Adds JobType.SYSTEM_TEST_ANALYSIS and TestType.PLAYWRIGHT/CYPRESS.

- [ ] **Step 1: Write failing creator test**

~~~js
it("creates a system-test job", async () => {
  await createSystemTestAnalysisJob({
    projectId: "project-1", snapshotId: "snapshot-1", userId: "user-1", runner: "playwright",
  });
  expect(prismaMock.job.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      type: "SYSTEM_TEST_ANALYSIS",
      payloadJson: JSON.stringify({ snapshotId: "snapshot-1", runner: "playwright" }),
    }),
  }));
});
~~~

- [ ] **Step 2: Confirm it fails**

Run: npm test --prefix server -- job.service.test.js

Expected: FAIL because the job type and creator are missing.

- [ ] **Step 3: Implement additive schema and creator**

~~~prisma
enum JobType {
  // current values
  SYSTEM_TEST_ANALYSIS
}
enum TestType {
  JEST
  SUPERTEST
  PLAYWRIGHT
  CYPRESS
}
~~~

~~~js
export const createSystemTestAnalysisJob = ({ projectId, snapshotId, userId, runner = null }) =>
  createSnapshotJob({
    projectId, snapshotId, userId, type: "SYSTEM_TEST_ANALYSIS",
    payloadJson: { snapshotId, runner },
  });
~~~

Generate the named Prisma migration, and retain it only if its SQL contains additive enum values.

- [ ] **Step 4: Verify**

Run: npx.cmd prisma validate from server, then npm test --prefix server -- job.service.test.js

Expected: both pass.

- [ ] **Step 5: Commit**

~~~bash
git add server/prisma/schema.prisma server/prisma/migrations server/src/services/job.service.js server/src/tests/job.service.test.js
git commit -m "feat: add system test job types"
~~~

### Task 2: Detect and choose an executable E2E runner

**Files:**
- Create: server/src/services/systemTestDetection.service.js
- Test: server/src/tests/systemTestDetection.service.test.js

**Interfaces:**
- Produces resolveSystemTestExecution({ rootDir, runner }) returning runner, command, configPath, reportPath, coverageDir.
- Throws ServiceError 422 for no executable runner/configuration and 409 for ambiguous automatic selection.

- [ ] **Step 1: Write failing selection tests**

~~~js
it("uses an explicitly nominated Cypress script", () => {
  const plan = resolveSystemTestExecution({
    rootDir: fixture({
      "package.json": JSON.stringify({
        devDependencies: { cypress: "^13" },
        scripts: { "test:e2e:cypress": "cypress run" },
      }),
    }),
    runner: "cypress",
  });
  expect(plan).toMatchObject({
    runner: "cypress", command: expect.stringContaining("cypress run"),
  });
});

it("rejects two executable runners without a requested runner", () => {
  expect(() => resolveSystemTestExecution({ rootDir: dualRunnerFixture }))
    .toThrow(expect.objectContaining({ statusCode: 409 }));
});
~~~

- [ ] **Step 2: Confirm tests fail**

Run: npm test --prefix server -- systemTestDetection.service.test.js

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement detection and controlled command building**

~~~js
export const resolveSystemTestExecution = ({ rootDir, runner = null }) => {
  const selected = selectRunner(detectExecutableRunners(rootDir), runner);
  return {
    runner: selected.runner,
    command: appendReportArguments(selected.command, selected.runner, rootDir),
    configPath: selected.configPath,
    reportPath: path.join(rootDir, ".covai-system-test", selected.runner + "-results.json"),
    coverageDir: path.join(rootDir, "coverage"),
  };
};
~~~

Detect @playwright/test and cypress plus config files playwright.config.{js,ts,mjs,cjs} and cypress.config.{js,ts,mjs,cjs}. Accept only explicit scripts listed by the global constraints. If no nominated script exists, require Playwright config text with webServer; for Cypress require baseUrl and an explicit server-start reference. Do not evaluate config source or concatenate request-provided commands. Create Playwright/Cypress command variants that write the planned JSON report.

- [ ] **Step 4: Verify focused suite**

Run: npm test --prefix server -- systemTestDetection.service.test.js

Expected: PASS for runner-specific scripts, config resolution, missing configuration, explicit selection, and ambiguity.

- [ ] **Step 5: Commit**

~~~bash
git add server/src/services/systemTestDetection.service.js server/src/tests/systemTestDetection.service.test.js
git commit -m "feat: select configured system test runner"
~~~

### Task 3: Execute the runner and parse results

**Files:**
- Create: server/src/services/systemTestRunner.service.js
- Create: server/src/services/systemTestResultParser.service.js
- Test: server/src/tests/systemTestRunner.service.test.js
- Test: server/src/tests/systemTestResultParser.service.test.js

**Interfaces:**
- Produces runSystemTests({ jobId, rootDir, execution }) -> dockerRunner result.
- Produces parseSystemTestResult({ runner, resultPath, startedAt, finishedAt }) -> TestRun field values.

- [ ] **Step 1: Write failing runner and parser tests**

~~~js
expect(parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt }))
  .toEqual({
    totalTests: 3, passedTests: 2, failedTests: 1, skippedTests: 0,
    durationMs: 1200, status: "FAILED", startedAt, finishedAt,
  });

await runSystemTests({ jobId: "job-1", rootDir: "/snapshot", execution });
expect(dockerRunner.run).toHaveBeenCalledWith(expect.objectContaining({
  snapshotPath: "/snapshot", command: expect.stringContaining("--reporter"), jobId: "job-1",
}));
~~~

- [ ] **Step 2: Confirm tests fail**

Run: npm test --prefix server -- systemTestRunner.service.test.js systemTestResultParser.service.test.js

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement runner and parsers**

~~~js
export const runSystemTests = ({ jobId, rootDir, execution }) =>
  dockerRunner.run({
    snapshotPath: rootDir, command: execution.command, timeoutMs: 10 * 60 * 1000, jobId,
  });
~~~

Parse only the report schema emitted by Task 2 commands. Valid reports with failing tests return FAILED data. Missing, empty, invalid, or count-less reports throw ServiceError with 422. Let dockerRunner timeouts propagate.

- [ ] **Step 4: Verify focused suite**

Run: npm test --prefix server -- systemTestRunner.service.test.js systemTestResultParser.service.test.js

Expected: PASS for success, valid test failures, timeout propagation, missing report, and malformed report.

- [ ] **Step 5: Commit**

~~~bash
git add server/src/services/systemTestRunner.service.js server/src/services/systemTestResultParser.service.js server/src/tests/systemTestRunner.service.test.js server/src/tests/systemTestResultParser.service.test.js
git commit -m "feat: run and parse browser system tests"
~~~

### Task 4: Persist result, coverage, and job terminal status

**Files:**
- Create: server/src/services/systemTestAnalysisJob.service.js
- Test: server/src/tests/systemTestAnalysisJob.service.test.js

**Interfaces:**
- Consumes a SYSTEM_TEST_ANALYSIS job ID.
- Produces a TestRun type PLAYWRIGHT or CYPRESS and Job.resultJson containing runner, exitCode, testRun, coverageAvailable, coverageStorage.
- Uses existing job lifecycle, coverage parsers, and coverage storage.

- [ ] **Step 1: Write failing orchestration tests**

~~~js
it("persists a successful Playwright run and succeeds without coverage", async () => {
  await processSystemTestAnalysisJob("job-1");
  expect(prismaMock.testRun.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      snapshotId: "snapshot-1", type: "PLAYWRIGHT",
      totalTests: 4, passedTests: 4, status: "PASSED",
    }),
  });
  expect(markJobSuccess).toHaveBeenCalledWith("job-1",
    expect.objectContaining({ coverageAvailable: false }));
});

it("persists a valid failed report then fails once", async () => {
  await expect(processSystemTestAnalysisJob("job-1")).rejects.toThrow("System tests failed");
  expect(prismaMock.testRun.create).toHaveBeenCalled();
  expect(markJobFailed).toHaveBeenCalledTimes(1);
});
~~~

- [ ] **Step 2: Confirm it fails**

Run: npm test --prefix server -- systemTestAnalysisJob.service.test.js

Expected: FAIL because the job processor is absent.

- [ ] **Step 3: Implement idempotent orchestration**

~~~js
export const processSystemTestAnalysisJob = async (jobId) => {
  try {
    await markJobRunning(jobId);
    const job = await getJobById(jobId);
    const execution = resolveSystemTestExecution({ rootDir: job.snapshot.rootDir, runner: readRunner(job.payloadJson) });
    const run = await runSystemTests({ jobId, rootDir: job.snapshot.rootDir, execution });
    const testRun = parseSystemTestResult({ runner: execution.runner, resultPath: execution.reportPath, startedAt: job.startedAt, finishedAt: new Date() });
    await prisma.testRun.create({ data: { snapshotId: job.snapshotId, type: testTypeFor(execution.runner), ...testRun } });
    const coverage = await persistCoverageIfPresent(job, execution.coverageDir);
    if (!run.success || testRun.status === "FAILED") throw new Error("System tests failed");
    await markJobSuccess(jobId, { runner: execution.runner, exitCode: run.exitCode, testRun, ...coverage });
  } catch (error) {
    await failSystemTestJobOnce(jobId, error);
    throw error;
  }
};
~~~

persistCoverageIfPresent returns coverageAvailable false only if all Istanbul files are absent. If any exists, require summary and final JSON, parse summary/files/functions, then call storeCoverageOutputs. failSystemTestJobOnce reads Job status and calls markJobFailed only for RUNNING status. Persist valid failed reports before failing the job.

- [ ] **Step 4: Verify focused suite**

Run: npm test --prefix server -- systemTestAnalysisJob.service.test.js

Expected: PASS for coverage absent/present, valid failed report, timeout, malformed report, malformed partial coverage, and no double finalisation.

- [ ] **Step 5: Commit**

~~~bash
git add server/src/services/systemTestAnalysisJob.service.js server/src/tests/systemTestAnalysisJob.service.test.js
git commit -m "feat: persist system test analysis results"
~~~

### Task 5: Expose and dispatch without changing legacy routes

**Files:**
- Modify: server/src/services/queue.service.js
- Modify: server/src/controllers/project.controller.js
- Modify: server/src/routes/project.route.js
- Test: server/src/tests/queue.service.test.js
- Test: server/src/tests/projectSystemTest.controller.test.js

**Interfaces:**
- Consumes POST /api/projects/:id/system-test-analysis body { snapshotId, runner? }.
- Produces HTTP 202 with Job and BullMQ data type SYSTEM_TEST_ANALYSIS.

- [ ] **Step 1: Write failing HTTP and queue tests**

~~~js
await request(app)
  .post("/projects/project-1/system-test-analysis")
  .send({ snapshotId: "snapshot-1", runner: "cypress" })
  .expect(202);
expect(addJobToQueue).toHaveBeenCalledWith("SYSTEM_TEST_ANALYSIS", "job-1");

await globalThis.__TEST_QUEUE_HANDLER__({
  data: { type: "SYSTEM_TEST_ANALYSIS", jobId: "job-1" },
});
expect(processSystemTestAnalysisJob).toHaveBeenCalledWith("job-1");
~~~

- [ ] **Step 2: Confirm tests fail**

Run: npm test --prefix server -- queue.service.test.js projectSystemTest.controller.test.js

Expected: FAIL because route and queue case are absent.

- [ ] **Step 3: Add only the new route/controller/worker case**

~~~js
router.post("/:id/system-test-analysis", authMiddleware,
  projectController.runSystemTestAnalysis.bind(projectController));

case "SYSTEM_TEST_ANALYSIS":
  await processSystemTestAnalysisJob(jobId);
  break;
~~~

The controller creates the typed job, awaits addJobToQueue, and returns 202. On enqueue failure it calls markQueuedJobFailed and returns 503. Do not modify existing run-playwright, run-integration-tests, or run-vitest endpoints.

- [ ] **Step 4: Verify focused suite**

Run: npm test --prefix server -- queue.service.test.js projectSystemTest.controller.test.js

Expected: PASS for dispatch, creation error, enqueue error, and legacy routes.

- [ ] **Step 5: Commit**

~~~bash
git add server/src/services/queue.service.js server/src/controllers/project.controller.js server/src/routes/project.route.js server/src/tests/queue.service.test.js server/src/tests/projectSystemTest.controller.test.js
git commit -m "feat: queue system test analysis"
~~~

### Task 6: Review migration and run regression verification

**Files:**
- Modify: README.md only if project endpoint documentation is maintained there.
- Test: suites created in Tasks 1-5 and existing server suite.

- [ ] **Step 1: Review migration SQL**

Run: Get-Content -Raw server/prisma/migrations/<timestamp>_add_system_test_analysis/migration.sql

Expected: only enum additions; no table rewrites, drops, or data loss.

- [ ] **Step 2: Run feature suites**

Run: npm test --prefix server -- systemTestDetection.service.test.js systemTestRunner.service.test.js systemTestResultParser.service.test.js systemTestAnalysisJob.service.test.js projectSystemTest.controller.test.js queue.service.test.js

Expected: all target suites pass.

- [ ] **Step 3: Run project validation**

Run: npx.cmd prisma validate from server; npm test --prefix server

Expected: Prisma passes; distinguish pre-existing failures from regressions.

- [ ] **Step 4: Check scope**

Run: git diff --check; git status --short

Expected: no whitespace errors and no changes outside planned files plus user-owned existing changes.

- [ ] **Step 5: Commit verification/documentation changes**

~~~bash
git add README.md server/prisma/migrations
git commit -m "docs: document system test analysis"
~~~

## Plan Self-Review

- **Spec coverage:** Tasks 1-5 cover types, detection, selection, execution, results, coverage, storage, queue dispatch, and terminal failures. Task 6 validates them.
- **Placeholder scan:** No deferred implementation markers; the migration timestamp is generated by Prisma and constrained to an additive reviewed migration.
- **Type consistency:** runner stays lowercase until one mapping to uppercase Prisma TestType in Task 4. SYSTEM_TEST_ANALYSIS is the same creator, queue, and enum value throughout.
