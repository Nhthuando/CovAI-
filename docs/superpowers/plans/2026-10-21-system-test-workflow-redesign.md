# System Test Workflow Redesign Implementation Plan

> **For agentic workers:** Implement tasks in order, one reviewed change at a time. Checkboxes track completion. Preserve the existing working tree; never include unrelated files in a commit.

**Goal:** Make CovAI's System Test follow the approved business workflow in `docs/superpowers/specs/2026-10-21-system-test-workflow-redesign-design.md` and the linked Figma screens.

**Architecture:** Extend the existing snapshot-scoped Playwright assessment, Istanbul measurement, Redis lease and proposal pipeline. Add a durable pre-run scenario catalog and review gate, a sequenced live event/evidence layer, explicit verdict and gap derivation, a user-approved improvement loop, a Figma-aligned UI and an immutable PDF export.

**Tech Stack:** React 19/Vite, Express 5, Prisma/PostgreSQL, Redis/BullMQ, Socket.IO, Playwright Test, Istanbul, Zod, PDFKit, Jest/Supertest.

## Global constraints

- Business behavior follows `Chi_tiet_System_Test.png`; Figma controls visual composition. User confirmed this on 2026-10-21.
- Playwright is the measured adapter. Cypress legacy execution stays available and reports unsupported evidence honestly.
- Current source is dirty. Review diffs before every edit; preserve all existing user changes and untracked files.
- No generated scenario, screenshot, code execution hit or AI claim verifies a business criterion without owner-confirmed expected outcome and a reviewed assertion binding.
- No aggregate suite coverage may be assigned to an individual scenario. Zero denominator or absent instrumentation has no percentage.
- Full Stack test data/database must be disposable. Artifacts and all routes are snapshot-owned; sanitize secrets before storage and live broadcast.
- Tests disabled by environment are marked `BLOCKED`. Failures never lead to deletion of the discovering test.
- Migration is additive. Review SQL, cascades and current migration history before applying to any user database. Do not run `migrate dev` or reset on the current database during this plan.

## Baseline and verification setup

The 2026-10-21 read-only baseline ran five focused suites with a Jest cache inside the workspace: four passed (`systemAssessment.service`, `systemCoverageCollector`, `systemTestRunner.service`, `systemTestDetection.service`). `systemAssessment.route` had nine `EACCES 127.0.0.1` failures because sandboxed Supertest could not bind loopback. Treat that as an environment gate, not a green or red product verdict. Re-run route tests in an approved local test environment. Existing documentation also records unrelated full-suite failures; record the exact baseline before claiming regression-free completion.

Use `npm test --prefix server -- --runInBand --cacheDirectory "D:\HuuThuan - Project\NCKH\CovAI\tmp\jest-system-research" <test paths>` for focused local runs. Use `npm run build --prefix client` and `npm run lint --prefix client` for UI tasks. The implementation team may use a task-specific writable Jest cache directory.

## File map

| Responsibility | Current files to extend | Focused new files |
| --- | --- | --- |
| Requirement brief | `server/src/services/systemRequirement.service.js`, `server/src/validators/systemAssessment.validator.js`, `server/src/controllers/systemAssessment.controller.js` | `client/src/components/dashboard/system/SystemTestBrief.jsx` |
| Scenario catalog/review | `server/src/services/systemAssessmentDiscovery.service.js`, `server/src/services/systemTestStaticAnalysis.service.js`, `server/prisma/schema.prisma` | `server/src/services/systemScenarioCatalog.service.js`, `server/src/services/systemScenarioReview.service.js`, `client/src/components/dashboard/system/SystemTestScenarioWorkspace.jsx` |
| Run admission | `server/src/controllers/systemAssessment.controller.js`, `server/src/services/systemAssessmentJob.service.js` | `server/src/services/systemRunAdmission.service.js` |
| Live events/evidence | `server/src/services/systemTestRunner.service.js`, `server/src/services/systemTestEvidence.service.js`, `server/src/services/queue.service.js` | `server/src/services/systemLiveEvent.service.js`, `server/src/services/systemRunArtifact.service.js`, `client/src/components/dashboard/system/SystemTestLiveRun.jsx` |
| Verdict/gaps | `server/src/services/systemAssessment.service.js`, `server/src/services/systemTestResultParser.service.js`, `server/src/services/systemCoverageCollector.service.js` | `server/src/services/systemScenarioVerdict.service.js`, `server/src/services/systemGapAnalysis.service.js` |
| Improvement review | `server/src/services/systemTestImprovementJob.service.js`, `server/src/services/systemImprovementPolicy.service.js`, `client/src/components/dashboard/system/SystemTestImprovementReview.jsx` | `server/src/services/systemProposalReview.service.js` |
| UI/report | `client/src/components/dashboard/SystemTestDashboard.jsx`, `client/src/services/systemTest.service.js`, `client/src/components/dashboard/system/SystemTestReportView.jsx` | `client/src/components/dashboard/system/SystemTestResults.jsx`, `client/src/components/dashboard/system/SystemTestCoverageGaps.jsx`, `server/src/services/systemTestPdf.service.js` |

### Task 1: Add durable catalog and evidence schema

**Files:** Modify `server/prisma/schema.prisma`; create `server/prisma/migrations/20261021090000_system_test_workflow/migration.sql`; create `server/src/tests/systemWorkflowSchema.test.js`.

**Interfaces:** `SystemScenario` belongs to `ProjectSnapshot` and stores `scenarioKey`, source, file/title, flow/input/expected JSON, criterion IDs, review state, requirement revision ID, test hash, assertion hashes, approver and timestamps. `SystemRunEvent` belongs to `SystemTestAssessment` and has unique `(assessmentId, sequence)`. `SystemRunArtifact` belongs to assessment and scenario key, storing kind, relative path, SHA-256, MIME and bytes. Continue using `SystemRequirementRevision.contentJson` for the brief instead of adding a duplicate brief table.

- [ ] Write a schema/migration test that asserts all three models, unique/index keys, and `onDelete: Cascade` only under owned snapshot/assessment parents. Assert existing `TestRun` and `TestScenario` columns are untouched.
- [ ] Add the Prisma models and an additive SQL migration. Use review states `DRAFT`, `REVIEWED`, `STALE`; keep execution verdict out of `SystemScenario`.
- [ ] Run `npx.cmd prisma validate`, `npx.cmd prisma generate` from `server/`, and inspect `migration.sql` line by line. Apply only to a disposable database during implementation verification; never migrate the current configured DB without separate review.
- [ ] Commit only schema, SQL and focused test after review.

### Task 2: Version and confirm the business brief

**Files:** Modify `server/src/validators/systemAssessment.validator.js`, `server/src/services/systemRequirement.service.js`, `server/src/controllers/systemAssessment.controller.js`, `server/src/routes/systemAssessment.route.js`; create `client/src/components/dashboard/system/SystemTestBrief.jsx`; extend `client/src/services/systemTest.service.js`; create `server/src/tests/systemBrief.route.test.js`.

**Interfaces:** `POST /:snapshotId/system/requirements` accepts `{brief:{purpose,actors,flows,preconditions,dataConstraints},criteria:[{id,description,expectedOutcome,references}]}`; `POST /requirements/:revisionId/confirm` uses `expectedContentHash`; GET returns revisions. Existing criteria-only records remain readable with an empty displayed brief.

- [ ] Test validation of a real brief, duplicate criterion IDs, oversized fields, ownership and stale confirm hash. Test backward-compatible read of the current criteria-only JSON.
- [ ] Extend the strict Zod object and `createRequirementRevision` without auto-confirming AI/source drafts. Preserve the current `contentHash` check and revision numbering.
- [ ] Build the brief view with a draft editor, criterion table, source/provenance label and a distinct **Confirm expected outcomes** action. A confirmed revision is read-only; editing creates a new revision.
- [ ] Run focused route/service tests and client build. Commit the API and UI slice.

### Task 3: Discover and author pre-run scenarios

**Files:** Create `server/src/services/systemScenarioCatalog.service.js`, `server/src/tests/systemScenarioCatalog.test.js`; modify `server/src/services/systemAssessmentDiscovery.service.js`, `server/src/controllers/systemAssessment.controller.js`, `server/src/routes/systemAssessment.route.js`, `client/src/components/dashboard/system/SystemTestZeroStateBanner.jsx`, `client/src/services/systemTest.service.js`; create `client/src/components/dashboard/system/SystemTestScenarioWorkspace.jsx`.

**Interfaces:** `GET /:snapshotId/system/catalog` returns catalog entries plus `discoveryStatus`, `unsupportedFeatures` and source provenance. `POST /catalog` creates a manual draft. `POST /catalog/import` registers an existing owned spec path; `POST /catalog/sync` refreshes discovered files. Each request is snapshot-owned and uses repository-relative path validation.

- [ ] Test zero files, normal Playwright `test(...)`, multiple specs, custom fixture, dynamic title, symlink/path escape and stale source. Do not fabricate Input/Expected from a test title or static route scan.
- [ ] Build catalog synchronization from `scanSystemTestFiles` and `analyzeSystemTestFile`; stable key is a digest of normalized repository path plus supported scenario identity. Preserve manual metadata across scans while marking changed test hashes `STALE`.
- [ ] Add manual draft creation with Flow/Input/Expected and criterion links. For a runnable manual scenario, route to the existing test editor with a safe Playwright template; save the source file through existing owned file APIs, then sync catalog. AI generation creates drafts requiring review.
- [ ] Replace the no-tests single action with Figma's **Write a scenario**, **Generate from brief**, **Import test file**; show the scenario list/detail before any run.
- [ ] Run focused discovery/catalog tests and client build. Commit this slice.

### Task 4: Enforce review and exact run admission

**Files:** Create `server/src/services/systemScenarioReview.service.js`, `server/src/services/systemRunAdmission.service.js`, `server/src/tests/systemScenarioReview.test.js`, `server/src/tests/systemRunAdmission.route.test.js`; modify `server/src/controllers/systemAssessment.controller.js`, `server/src/routes/systemAssessment.route.js`, `server/src/services/systemAssessmentJob.service.js`, `client/src/components/dashboard/system/SystemTestScenarioWorkspace.jsx`, `client/src/components/dashboard/SystemTestDashboard.jsx`.

**Interfaces:** `POST /catalog/:scenarioId/review` accepts `expectedScenarioHash`, `expectedRequirementHash`, `assertionIds` and `reviewDecision`. `evaluateRunReadiness({snapshotId,revisionId,testFiles})` returns `{ready,blockers:[{scenarioKey,code,message}]}`. `POST /assessments` rejects a non-ready catalog with 409 and the blockers. Hashes are computed server-side from normalized Input/Expected, criterion revision, test content and supported assertion sites.

- [ ] Test run denial for unconfirmed requirements, missing Input/Expected, unbound assertion, stale file, foreign review and unsupported dynamic fixture. Test successful admission and invalidation after any relevant edit.
- [ ] Reuse `SystemAssertionBinding`/`approveAssertionBinding` for criterion linkage; store scenario review separately. A reviewed scenario cannot silently inherit approval after a new revision or test hash.
- [ ] Make the UI show exact blockers and enable **Run after review** only when readiness is true. Keep Full Stack/Frontend mode visible and explain mocked API exclusions.
- [ ] Run ownership and readiness tests in an environment where Supertest can bind; otherwise report the sandbox limitation and run service-level tests. Commit.

### Task 5: Persist and replay live Playwright progress

**Files:** Create `server/src/services/systemLiveEvent.service.js`, `server/src/tests/systemLiveEvent.test.js`, `client/src/components/dashboard/system/SystemTestLiveRun.jsx`; modify `server/src/services/systemTestEvidence.service.js`, `server/src/services/systemTestRunner.service.js`, `server/src/routes/systemAssessment.route.js`, `server/src/controllers/systemAssessment.controller.js`, `client/src/services/systemTest.service.js`, `client/src/components/dashboard/SystemTestDashboard.jsx`.

**Interfaces:** `publishRunEvent({assessmentId,runIndex,scenarioKey,type,payload})` allocates monotonic `sequence`, persists a bounded sanitized payload then emits to the authenticated user's room. `GET /assessments/:id/events?after=<sequence>&limit=100` replays owned events. Event types: `RUN_STARTED`, `SCENARIO_STARTED`, `STEP_STARTED`, `STEP_ENDED`, `SCENARIO_ENDED`, `RUN_ENDED`, `RUN_BLOCKED`, `RUN_CANCELED`.

- [ ] Test stable event order, duplicate reporter delivery, cursor pagination, reconnect replay, cross-owner denial and event truncation. Reconcile final event counts with the stored Playwright JSON report.
- [ ] Add a custom Playwright reporter in the disposable run directory using `onTestBegin`, `onStepBegin`, `onStepEnd`, `onTestEnd`; send bounded JSON lines to the parent worker over a local file/pipe. Keep the existing JSON reporter and trace output. Identify scenarios by normalized file and Playwright test ID, not title alone.
- [ ] Wire queue worker to persist events and broadcast after commit. A dropped socket event cannot change the verdict. On reload the UI replays from the last sequence, then subscribes; deduplicate by sequence.
- [ ] Implement **Pause** as no new scenario scheduled after the current one, and **Stop run** through the existing cancellation signal. Document that an in-flight action completes or is canceled, and label remaining work accurately. Start with managed `workers:1` for ordered live playback; make any parallel support a later verified adapter.
- [ ] Run reporter/event tests plus one small local Playwright fixture. Commit.

### Task 6: Capture scenario evidence without false attribution

**Files:** Create `server/src/services/systemRunArtifact.service.js`, `server/src/tests/systemRunArtifact.test.js`; modify `server/src/services/systemTestEvidence.service.js`, `server/src/services/systemAssessmentJob.service.js`, `server/src/controllers/systemAssessment.controller.js`, `server/src/routes/systemAssessment.route.js`, `client/src/components/dashboard/system/SystemTestLiveRun.jsx`, `client/src/components/dashboard/system/SystemTestEvidencePreview.jsx`.

**Interfaces:** `storeArtifact({assessmentId,scenarioKey,kind,bytes,mimeType})` returns a hash and owned artifact ID. `GET /assessments/:id/scenarios/:key/evidence` returns a manifest with `CAPTURED`, `NOT_CAPTURED`, `UNSUPPORTED` or `INVALID`; `GET /artifacts/:artifactId` streams only owned, contained files. API records are `{method,path,status,durationMs,requestId}` with optional allowlisted response preview.

- [ ] Test screenshot/trace size limits, path escape, symlink, hash mismatch, content type, retention, secret redaction, missing artifact and unauthorized fetch. Test that failure evidence remains if preview capture fails.
- [ ] Capture bounded screenshots at scenario/step transitions for the live browser pane and store the failure/approved checkpoint PNG plus Playwright trace. Use a screenshot stream fallback; do not require the newer screencast API. Retain raw trace only behind authenticated artifact retrieval.
- [ ] Capture browser request/response events for same-origin AUT calls; exclude cookies, authorization and query secrets. A backend route/code path appears as **executed** only with a verified correlation ID from the instrumented test AUT. Without it, show observed API calls and aggregate code coverage separately.
- [ ] Make Data & DB show local storage changes only through an allowlist and redaction. Implement database row diffs only for explicitly configured isolated PostgreSQL/MySQL tables after a separate adapter test; until then show `NOT_CAPTURED` and do not claim the Figma sample row was observed.
- [ ] Run evidence and auth tests; manually inspect a failed fixture's screenshot/trace/API record. Commit.

### Task 7: Derive verdicts, quality and prioritized gaps

**Files:** Create `server/src/services/systemScenarioVerdict.service.js`, `server/src/services/systemGapAnalysis.service.js`, `server/src/services/systemQualityScore.service.js`, `server/src/tests/systemScenarioVerdict.test.js`, `server/src/tests/systemGapAnalysis.test.js`, `server/src/tests/systemQualityScore.test.js`; modify `server/src/services/systemAssessment.service.js`, `server/src/services/systemTestResultParser.service.js`, `server/src/services/systemAssessmentPersistence.service.js`, `client/src/components/dashboard/system/SystemTestAssessmentPanel.jsx`.

**Interfaces:** `deriveScenarioVerdict({scenario,review,assertionEvidence,repeatRuns,infraStatus})` returns `{executionStatus,qualityStatus,reasons}`; `buildSystemGaps({criteria,verdicts,coverage})` returns typed `FAILED_BEHAVIOR`, `WEAK_ASSERTION`, `MISSING_CRITERION`, `UNEXECUTED_SOURCE` findings, each with evidence reference and next action. `scoreSystemSuite({requirements,verdicts,stability,artifacts})` returns `NOT_CALCULATED` or a 40/25/20/15 point breakdown. Do not overload `TestScenario.status` with `MISSING` because missing flows have no execution result.

- [ ] Test first-fail/second-pass, no supported outcome assertion, constant/smoke assertion, confirmed criterion without binding, infra startup fault, skipped test, no coverage artifact, and measured zero-hit branch. A pass after retry is WEAK/FLAKY with both attempts retained.
- [ ] Derive execution status from the Playwright report and assertion events; derive quality status separately. Existing static findings are review cues, not unconditional proof of weak semantics. Preserve FAIL when expected/actual differ.
- [ ] Build gap priorities: confirmed missing/failed behavior first, weak assertion second, measured uncovered source third. Tie every source gap to measured scope and line/branch identifier. Keep frontend/backend counters and repeat stability independent.
- [ ] Calculate quality components from exact counts: `40*verifiedCriteria/totalCriteria`, `25*reviewedStrongScenarios/reviewedScenarios`, `20*cleanIndependentRuns/independentRuns`, `15*capturedRequiredArtifacts/requiredArtifacts`. The required set is one checkpoint/final screenshot per executed scenario plus trace and failure screenshot per failed scenario. Round only the displayed total. Return `NOT_CALCULATED` if a denominator is zero, assertion analysis is unsupported, or the artifact manifest is absent; a missing individual artifact lowers the evidence component. Test each boundary and show the breakdown in the API.
- [ ] Persist the derived report once and use it for UI and PDF. Add regression tests that reject per-scenario coverage copied from aggregate values.
- [ ] Run focused service/parser tests. Commit.

### Task 8: Require review before AI-generated additions are applied

**Files:** Create `server/src/services/systemProposalReview.service.js`, `server/src/tests/systemProposalReview.test.js`; modify `server/src/services/systemTestImprovementJob.service.js`, `server/src/controllers/systemAssessment.controller.js`, `server/src/routes/systemAssessment.route.js`, `client/src/components/dashboard/system/SystemTestAssessmentPanel.jsx`, `client/src/components/dashboard/system/SystemTestImprovementReview.jsx`.

**Interfaces:** `POST /proposals/:proposalId/review` records approval of each new scenario's Input/Expected and criterion bindings with proposal hash. `POST /proposals/:proposalId/apply` requires verified candidate, approved proposal hash, unchanged source/test/revision identities and no regression. Accept a candidate when it either closes a confirmed missing criterion with reviewed assertion evidence or delivers a comparable measured source-coverage gain; record which basis qualified it.

- [ ] Test that `autoApply:true` cannot bypass review in the redesigned workflow; old API requests receive a clear conflict or use explicit legacy behavior only where no new expected outcome is introduced. Test stale diff, changed requirement, failed candidate, zero-coverage-gain but newly verified criterion, zero-gain without criterion closure, and preserved original failing test.
- [ ] Make AI improvement produce a proposal without direct save. Keep existing two-run candidate verification and recovery journal. Extend `evaluateSystemImprovement` with the explicit criterion-closure basis while preserving its coverage-gain rules for coverage-only proposals. Attach gap IDs and explicit new scenario metadata to the review screen.
- [ ] Show code diff, Input/Expected, source evidence, before/after denominators and verification outcome. The owner approves exact proposal content, then apply publishes a new assessment transactionally.
- [ ] Run proposal policy/auto-apply tests and route authorization tests. Commit.

### Task 9: Compose the Figma-aligned System Test workspace

**Files:** Modify `client/src/components/dashboard/SystemTestDashboard.jsx`, `client/src/index.css`, `client/src/services/systemTest.service.js`; create `client/src/components/dashboard/system/SystemTestResults.jsx`, `client/src/components/dashboard/system/SystemTestCoverageGaps.jsx`; extend `SystemTestScenarioWorkspace.jsx` and `SystemTestLiveRun.jsx`.

**Interfaces:** One selected snapshot/runner/mode drives `Scenarios`, `Live run`, `Results` tabs. `Coverage & gaps` opens from Results. The detail panes consume catalog, event cursor and persisted assessment APIs; no Figma sample data is hard-coded.

- [ ] Match the Figma hierarchy: zero state and discovery, left scenario list/right Input-Expected, live browser/steps with evidence tabs, failure-first results, coverage/gaps table. Add the brief/review surfaces required by the diagram in the same visual system.
- [ ] Preserve selection across refresh, show loading/empty/error/stale/unsupported states, and make status labels accessible to keyboard and screen reader. At narrow widths stack columns without hiding Expected, Actual or evidence controls.
- [ ] Ensure `Run after review`, `Pause`, `Stop`, `Re-run`, `Edit assertion`, `Add scenario`, `Open trace` and `Export PDF` each call the correct owned endpoint or display a precise unsupported reason.
- [ ] Run client lint/build, then inspect the rendered desktop and narrow layouts with a browser against real fixture data. Compare each state with Figma screenshots. Commit.

### Task 10: Export an immutable assessment PDF

**Files:** Create `server/src/services/systemTestPdf.service.js`, `server/src/tests/systemTestPdf.test.js`; modify `server/src/controllers/systemAssessment.controller.js`, `server/src/routes/systemAssessment.route.js`, `client/src/services/systemTest.service.js`, `client/src/components/dashboard/system/SystemTestCoverageGaps.jsx`, `client/src/components/dashboard/system/SystemTestReportView.jsx`.

**Interfaces:** `GET /:snapshotId/system/assessments/:assessmentId/report.pdf` streams `application/pdf` for a completed owned assessment. Report content is rendered from the persisted report and artifact manifest, never from browser state. Include report revision, generated time, hashes, criterion revision, exact counts, scope/denominators, before/after comparison only when comparable, findings and evidence IDs/hashes.

- [ ] Test owner/foreign access, incomplete assessment, missing artifact, deterministic counts, UTF-8 Vietnamese text with an embedded font, multi-page layout and safe filename. Parse generated PDF text to compare with fixture JSON.
- [ ] Implement PDFKit stream with bounded images and page breaks. Mark unavailable evidence and unsupported tiers in text; do not print a synthetic percentage. Include linkable artifact IDs or a manifest appendix.
- [ ] Wire **Export PDF** to the endpoint and retain the existing print/JSON view as optional legacy actions with truthful labels.
- [ ] Run PDF service/route tests and inspect rendered pages. Commit.

### Task 11: End-to-end acceptance and rollout

**Files:** Create `server/e2e/system-workflow.spec.js`, `server/src/tests/fixtures/system-workflow/` and `docs/system-test-workflow-runbook.md`; update relevant existing route/coverage tests only when contract changes require it.

- [ ] Exercise three projects: no specs; an existing supported suite; a custom/dynamic unsupported suite. Verify brief revision, draft/review gate, run, live reconnect, failure trace, weak test, missing criterion, proposal review, compare and PDF.
- [ ] Exercise Full Stack with a disposable database and a fixture bug that returns an unexpected response. Confirm FAIL preserves the test and evidence. Check a mock-API suite is not presented as full-backend coverage.
- [ ] Test multi-user isolation across catalog, events, artifacts, proposal and PDF. Test cancellation, failed setup, crash/restart during event replay and stale source/test hashes.
- [ ] Compare the UI against all Figma frames on desktop and a narrow viewport. Verify no copied sample data. Run focused server suites, client lint/build and the full server suite when the environment supports loopback/Docker. Report pre-existing failures separately from new regressions.
- [ ] Document feature flags, database migration review, artifact retention, supported adapters, rollback, and user steps. Review migration and production rollout with the owner before applying to the configured database or enabling the redesigned workflow.

## Coverage check against the approved design

| Approved requirement | Tasks |
| --- | --- |
| Brief and confirmed criteria | 2 |
| No tests, import/manual/AI draft, scenario library | 3 |
| Input/Expected owner review and stale gate | 4 |
| Playwright live run, pause/stop, replay | 5 |
| Screenshot, trace, API/code/data evidence | 6 |
| PASS/FAIL/WEAK/MISSING and honest measured gaps | 7 |
| AI proposal, explicit review, rerun and comparison | 8 |
| Figma interface | 9 |
| Immutable PDF | 10 |
| Security, migration and acceptance | 1, 4, 6, 10, 11 |
