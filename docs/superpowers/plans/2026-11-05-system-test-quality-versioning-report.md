# System Test Quality, Versioning and Report — Implementation Plan

> **For agentic workers:** Execute inline, sequentially, one task at a time. This plan is written for the user's requested GPT-6.1 Sol / Medium execution profile. Do not spawn subagents or depend on unavailable execution skills. Track completion using the checkboxes and the checkpoint format below.

**Goal:** Improve System Test generation, make its results truthful and readable, support isolated test-suite history/restore, and produce consistent English reports without changing Unit/Integration behavior.

**Architecture:** Keep the existing runner, two independent verification runs, Istanbul measurement, project access policy, guarded operation workspaces and recoverable multi-file publication. Introduce a versioned report projection, immutable System Test suite revisions and focused generation context modules. React, JSON export and PDF consume the same persisted assessment projection; suite restore publishes only explicitly owned System Test files.

**Tech Stack:** Existing React 19/Vite/Tailwind, Express ES modules, Prisma/PostgreSQL, Redis/BullMQ, Playwright, Gemini structured responses, PDFKit, Jest and Node's built-in test runner. Prefer existing dependencies; no chart library, FE test framework or SDK migration is required.

**Status:** Implementation delivered; user E2E acceptance pending. Baseline: develop at f9b89b46d6ffdcd88adcc5f8fe49604cff16e638. Existing untracked changes were the audit report, inventory and this plan. No unrelated tracked edits.

## Global constraints

- User-facing UI, buttons, tooltips, empty/error states, generated descriptions, PDF/JSON field descriptions and system-authored notifications must be **English**. Planning notes and the handoff conversation may be Vietnamese or English.
- Preserve original user requirement text, project names, source code, raw runtime errors and captured data; do not translate or rewrite them to enforce English UI.
- Execute as a single agent with small, reviewable changes. Do not replace the entire System Test implementation in one edit.
- Implementation was subsequently authorized. Production source changes are allowed; do not apply migrations to the normal database, invoke paid AI generation, launch AUTs, run browser E2E or commit without separate instructions.
- At implementation time, use compact, behavior-focused tests. No snapshot tests of class names or full prompt strings, no new browser automation suite. User performs final end-to-end testing.
- Keep the application's existing two-run verification semantics. The user's request to reduce development testing cost does not remove product verification gates.
- Preserve authMiddleware, project capability checks, resource ancestry, hash/CAS checks, editor coordination, cancellation and recovery. Scope by authenticated user/project; never trust client user IDs or arbitrary rootDir.
- System version restore changes System Test-owned files only. Project snapshot restore remains the action for the whole workspace, including source and all three testing levels.
- No automatic business approval, invented Expected, sample runtime data, fabricated coverage, fallback quality score or silent PDF-to-print substitution.
- Keep Playwright as the supported measured-evidence path. Preserve Cypress's existing execution path and explicitly display unsupported evidence capabilities.
- Do not treat test failure as a confirmed product defect; do not weaken assertions to make generation pass.
- Avoid unrelated refactors, dependency changes, global theme changes, Unit/Integration schema rewrites, automatic deployment or destructive DB resets.
- Windows: use npm.cmd/npx.cmd where appropriate; filesystem cleanup stays inside verified temporary workspaces. Never print .env contents.
- Build and lint once at the final gate, or earlier only if a structural frontend change needs feedback. Run focused tests after each relevant logic slice, not the entire server suite repeatedly.

## Evidence and scope decisions

Source review: [audit report](../../system-test-review-2026-11-05.md), [inventory](../../system-test-review-2026-11-05-inventory.md), and the current source at execution time. Previous documents contain proposals, not proof of implemented behavior.

Additional planning findings:

1. `SystemTestAssessmentPanel.jsx` renders `95/100` when execution exists but qualityScore is not calculated. Remove this fallback alongside the previously identified sample dimensions/evidence.
2. `processSystemAssessmentJob` currently selects catalog fields without reviewState/criterionIds, although verdict/scoring needs those fields. Preserve the reviewed metadata and snapshot it into the assessment.
3. `withPreparedProjectWorkspace` and `publishPreparedWorkspace` already support guarded multi-file publication and recovery. Reuse them for Apply/Restore; do not invent a second journal.
4. `gemini.service.js` already records provider usage into the AI job budget. Expose that existing metadata rather than changing the generic provider's return type.
5. Requirement review currently asks for JSON and is not sufficient as the main user flow. The update must make confirmed criteria and assertion review reachable through ordinary English form controls.
6. `snapshotIdentity` currently includes non-spec test helpers in sourceHash. Suite-managed helper edits must not be mislabeled as app-source edits; add an explicit, versioned identity policy before comparing or restoring helper-containing suites.

### Product choices fixed by this plan

| Topic | Decision |
|---|---|
| Default mode | Keep existing Frontend default for compatibility; expose Frontend / Full Stack in settings and always show active mode. Full Stack setup failure must not silently fall back to Frontend |
| Review | Existing scenario-level Expected confirmation stays supported. Fully reviewed criteria/bindings are required to claim requirement verification. Run never writes confirmation automatically |
| Missing requirements | Allow scenario-confirmed execution with `Requirement coverage: Not measured`; do not block every existing project on a full business brief |
| Generation | Generated code is a draft unless runtime verified. No auto-approval; explicit Apply for new generated files as well as improvement candidates |
| Version | BASELINE, APPLY and RESTORE create immutable suite revisions. Hand edits remain unrecorded working changes until an explicit Apply captures them |
| Version check | View diff or run selected historical tests in an isolated workspace using the current source; record that source and label the operation clearly |
| Cross-snapshot restore | In this delivery, suite restore is scoped to the active snapshot. Browse old snapshots through existing snapshot navigation; project-wide return uses snapshot restore |
| Historical source | Running old tests against old source requires selecting/restoring that source snapshot. Do not imply that selecting a suite version restores app source |
| Report | Assessment ID is authoritative; keep raw assessments immutable, adapt legacy data on read with explicit missing-data states |
| Quality score | Show a calculated score and its denominator/components, otherwise `Not calculated`; never estimate a value |
| Motion | 120–180ms opacity/color/small panel transitions; respect reduced motion; no decorative long-running animation |
| Verification handoff | Agent performs focused logic checks, build/lint and bounded PDF layout QA. User performs E2E and live AI quality evaluation |

## Delivery map and sequencing

```text
0 baseline
  → 1 report/evidence contract
  → 2 truthful API/history projection
  → 3 review and mode flow
  → 4 live-run correctness
  → 5 generation context and draft proposal
  → 6 review/verification acceptance
  → 7 suite schema and manifest
  → 8 guarded Apply revisions
  → 9 compare/restore/check-version APIs
  → 10 historical evidence
  → 11 English UI and version drawer
  → 12 shared visual report and PDF
  → 13 targeted final checks and user handoff
```

Tasks 1–4 are the first complete slice: remove misleading data and preserve usable execution. Tasks 5–6 improve generation without new suite history. Tasks 7–10 deliver safe versioning. Tasks 11–12 finish UI/report over stable contracts. Task 13 closes delivery without claiming E2E has passed.

### File responsibility map

| Boundary | Files to introduce | Existing integration points |
|---|---|---|
| Report projection | `server/src/services/systemReportProjection.service.js` | assessment service/job/controller, report view, PDF |
| Pure FE presentation | `client/src/components/dashboard/system/systemReportModel.js`, `systemLiveRunModel.js` | dashboard, metrics, dimensions, scenario detail/live |
| UI data coordination | `client/src/hooks/useSystemTestWorkspace.js` | dashboard/service; only extract System Test request/selection state |
| Generation contract | `server/src/services/systemGenerationContract.service.js`, `systemTestPrompt.service.js` | context, budget, verified/cold-start/booster paths |
| Generated draft | `server/src/services/systemGenerationProposal.service.js` | generation endpoint, queue preparation, proposal review/apply |
| Candidate bindings | `server/src/services/systemCandidateReview.service.js` | proposal review, assertion instrumentation, improvement policy |
| Suite persistence | `server/src/services/systemSuiteManifest.service.js`, `systemSuiteVersion.service.js` | schema, proposal apply, guarded publisher |
| Suite API | `server/src/controllers/systemSuiteVersion.controller.js`, `server/src/validators/systemSuiteVersion.validator.js` | existing authenticated assessment route and endpoint policy |
| Historical run | `server/src/services/systemSuiteVersionRun.service.js` | existing assessment job + prepared workspace; no separate runner |
| Main UI | `SystemTestSettings.jsx`, `SystemTestVersionHistory.jsx`, `SystemTestVersionDiff.jsx` under existing `client/src/components/dashboard/system/` | current tabs, generator/review and editor |
| Charts | `SystemTestReportCharts.jsx` in the same directory | shared report projection; SVG/CSS bars and matrix |
| PDF layout | `server/src/services/systemTestPdfLayout.service.js` | keep `renderSystemTestPdf` entry point; split layout helpers only |

Do not create all files as empty scaffolding. Create a module only in the task that implements its responsibility. Existing service methods retain wrappers where callers depend on their current signatures.

## Contract A — report projection

Create a JSON-serializable projection once on the server; persist it for new assessments under `reportJson.presentation`, with schemaVersion 2. Legacy assessments derive the same projection from their saved evidence, never current catalog metadata.

```js
buildSystemReportProjection({ assessment, report, artifacts, scenarioSnapshot })
// => {
//   schemaVersion: 2,
//   identity: {assessmentId, snapshotId, suiteVersionId, sourceHash,
//     testHash, requirementRevisionId, runner, executionMode, createdAt},
//   execution: {selected, executed, passed, failed, flaky, skipped,
//     blocked, canceled, notRun, elapsedMs},
//   stability: {status, requiredRuns, completedRuns, consistent, inconsistent},
//   requirements: {status, total, designed, verified, criteria},
//   coverage: {frontend, backend},
//   observations: {
//     routes: {items:[], observed:0, total:null, pct:null, status},
//     apiEndpoints: {items:[], observed:0, total:null, pct:null, status},
//     inventoryStatus},
//   qualityScore: {status, value, components, reason},
//   scenarios: [{scenarioKey, filePath, title, reviewState, flow, inputs,
//     expected, executionStatus, qualityStatus, attempts, artifacts}],
//   gaps: [], limitations: [], generatedWith: {promptVersion, model, usage}
// }
```

Rules:

- `null` means unknown; numeric 0 means a measured zero. A denominator of 0 returns no percentage.
- Execution counts are disjoint. Preserve legacy executionStatus WEAK for compatibility, but project it as flaky/incomplete/skip as supported by attempts; assertion quality is a separate dimension.
- `consistent` means matching observed scenario results across all required runs, not “100% deterministic.” A consistently failing scenario is still failed.
- Identity key is scenarioKey; legacy match fallback requires unique `(filePath, title, occurrence)` and never title alone. Ambiguous data stays unavailable.
- Expected comes from scenario metadata captured for this assessment. Actual comes from assertions/errors/runtime evidence, never reconstructed from operation tags.
- API observed count is distinct method + normalized route when normalization is proven; otherwise keep raw observed paths. No API coverage percent without a complete, scoped denominator. Discovery by regex is partial inventory.
- Selected scenario catalog and complete review metadata must be persisted before/with execution; later file deletion must not erase historical report meaning.
- Code-path/DB panels remain `Not captured` unless a real adapter supplies correlated evidence. Aggregate Istanbul coverage is not per-scenario evidence.

## Task 0 — Capture execution baseline

**Files:** Read `AGENTS.md`, plan, audit, root/client/server package files, current Git diff, relevant per-directory instructions. Update only the execution checkpoint in this plan.

- [x] Record branch/HEAD and existing user changes; do not overwrite the two audit files or unrelated work.
- [x] Re-read only the functions a task will change plus their callers/tests. If source differs materially from this plan, record the exact adaptation before editing.
- [x] Record available test helpers and isolated DB support without reading/printing secrets. Do not start Docker, Redis, AUTs or AI requests just to plan execution.
- [x] Confirm syntax of existing frontend Node tests and the Jest test safety setup. Use the previous 58-test result as historical evidence, not a new baseline claim.

**Done:** A concrete execution checkpoint exists; no unrelated source changes.

## Task 1 — Build the truthful report model and remove fabricated presentation

**Files:** Create report projection service and FE report model. Modify `SystemTestAssessmentPanel.jsx`, `SystemTestDimensionsTable.jsx`, `SystemTestScenarioLibrary.jsx`, `SystemTestGapNavigator.jsx`, `systemScenarioVerdict.service.js`, `systemAssessmentJob.service.js`.

**Interfaces:** Produce Contract A; `systemReportModel.js` exports `percentOrNull(covered, total)` and `scenarioIdentity(row)` for formatting/joins, not independent coverage calculations.

- [x] Add a compact `systemReportProjection.service.test.js` covering absent criteria, empty evidence, an unrelated non-Todo project, duplicate titles and inconsistent repeats. Example core assertions:

```js
expect(projection.qualityScore.status).toBe('NOT_CALCULATED');
expect(projection.observations.apiEndpoints.items).toEqual([]);
expect(projection.observations.apiEndpoints.pct).toBeNull();
expect(projection.stability.status).toBe('INCONSISTENT');
```

- [x] Implement projection from persisted inputs with explicit unsupported/unknown states. Include selected catalog reviewState, criterionIds, assertionHashes and requirementRevisionId in job capture.
- [x] Remove Todo feature/route/API/code/DB samples, ordinal feature matching, arbitrary fallback totals and `95/100` fallback from real components.
- [x] Replace “100% Edge-Case…”, unconditional “100% passed”, “VERIFIED” derived from execution existence, and defect claims with evidence-supported English copy.
- [x] Use stable identity joins; preserve FAIL/FLAKY/BLOCKED/SKIPPED/NOT_RUN distinctions in details. Do not rewrite stored legacy reports.
- [x] Run projection tests and existing `systemScenarioVerdict.service.test.js` + `systemCoverageTruthfulness.test.js` once after implementation.

**Done:** An arbitrary project with one result and no API evidence cannot produce Todo details, 100% API coverage or a made-up quality score.

## Task 2 — Pin results, exports and history to one assessment

**Files:** Modify assessment controller/routes/validator, `systemAssessmentPersistence.service.js`, `systemTest.service.js`, dashboard/report view. Create `useSystemTestWorkspace.js`.

**Interfaces:** Keep GET `/system/assessments` default response backwards compatible. Add GET `/system/assessments/history?runner=playwright&executionMode=full&limit=20&cursor=...` returning `{items,nextCursor}`. Register `/history` before `/:assessmentId`. Existing latest endpoint accepts optional validated runner/mode/status filters. Selected report fetch remains GET `/assessments/:assessmentId`.

- [x] Implement `loadSystemAssessment({snapshotId, assessmentId, runner, executionMode})` in client service and keep assessment ID selected until the user changes it or a completed run explicitly becomes selected.
- [x] Never substitute an active/failed/prepare-only assessment for the previous completed result. Track activeJobId separately from selectedAssessmentId; history includes statuses but report export requires a completed assessment.
- [x] Save Contract A for new completed assessments. Return a projection for legacy data with `Legacy evidence is incomplete` where necessary.
- [x] Hook resets selection/data/errors on snapshot/runner/mode changes; abort or ignore old responses; prevent duplicate simultaneous status polls. Do not refactor unrelated editor or project hooks.
- [x] HTML, PDF and JSON receive the same assessment ID/projection. Show source/test/version identity; exports cannot silently choose latest again.
- [x] Replace PDF failure fallback with `Could not export PDF. Try again.` and explicit Retry. `Print view` is a separate action, with images loaded before printing.
- [ ] Add 2–3 cases to existing workflow endpoint/persistence tests for filtering, unauthorized IDs and selected historical assessment remaining unchanged when a new run finishes.

**Done:** HTML/JSON/PDF represent the same assessment and mode. Snapshot changes cannot leave old evidence visible under a new identity.

## Task 3 — Make review, requirements and execution mode explicit

**Files:** Dashboard, Workflow, GeneratorModal, ZeroStateBanner, `SystemRequirementReview.jsx`, service, scenario catalog/readiness service, assessment validator/controller.

**Interfaces:** Keep current confirmation/review APIs and exact hash payloads. Mode propagates through discovery, generation, execution, summary, history and report calls.

- [x] Delete auto-fill/auto-confirm branches from Run. `Run selected` uses current selected IDs and backend readiness; a blocked run returns actionable scenario-specific reasons.
- [x] Stop optimistic `ready:true` solely from file existence. Derive readiness from the validated response for the exact selection; ensure zero selected scenarios stays zero and never falls back to all scenarios.
- [x] Add ordinary brief/criterion form fields: Purpose, Actors, Main flows, Preconditions, Test data constraints, Criterion ID, Description, Expected outcome and References. JSON import can remain an advanced option.
- [x] Distinguish `Draft`, `Expected confirmed`, `Reviewed`, `Stale` and runtime `Passed`; bulk confirmation displays exact Expected items before the explicit click.
- [x] Make criterion/assertion review reachable; user can link criterion to a supported assertion and approve the exact binding/hash. Existing no-requirement projects still run via scenario confirmation with requirement coverage not measured.
- [x] Pass selected requirementRevisionId to assessment when available. Changing criteria invalidates verification; no source-derived automatic business approval.
- [x] Expose settings with English options `Frontend` / `Full Stack`; keep Frontend default and active badge. Generator receives executionMode; no hidden downgrade when Full Stack setup fails.
- [x] Reuse `systemScenarioCatalog.service.test.js` and workflow endpoint tests: Run performs no review mutation, stale/hash mismatch rejects, empty selection rejects, mode is propagated. No tests of CSS/layout.

**Done:** A user can deliberately confirm/review scenarios and run either supported mode without invented Expected or misleading verification labels.

## Task 4 — Correct live progress and cancellation across repeat runs

**Files:** Create FE `systemLiveRunModel.js` + colocated Node test. Modify LiveRun, assessment job event/frame payload, reporter only where identity is missing.

**Interfaces:** `deriveLiveRunState({events,jobStatus,requiredRuns})` returns `{completedRuns,activeRunIndex,isTerminal,canStop}`. Frames include `{snapshotId,assessmentId,runIndex,frame}`; no client-assigned room authority.

- [x] Base terminal state on job/assessment terminal status, not the first RUN_ENDED. Show `Run 1 of 2` / `Run 2 of 2`, setup/execution stage, real elapsed time and Stop.
- [x] Filter every frame/event by assessment ID and snapshot; reset event list, cursor, checkpoint, frame, stopping/access state on context change.
- [x] Keep replay cursor contiguous: receiving sequence 9 over socket must not prevent recovery of 7–8. Track received sequence separately from last replayed contiguous sequence and page replay without jumping gaps.
- [x] Keep existing owner/actor cancellation policy; permission revocation clears access immediately. No new pause button without a real safe-boundary scheduler.
- [x] Auto-scroll only when user is already following latest output; do not drag the reader away from an inspected error. Label live capture honestly; remove hardcoded `30FPS` if rate is not guaranteed.
- [x] Test with 3 compact sequences: run 1 ended while job RUNNING, run 2 terminal, out-of-order/replayed duplicate events. Reuse cancellation endpoint test if cancellation behavior changes.

**Done:** Stop remains available during run 2, old frames cannot leak across runs and reconnect can recover missed events.

## Contract B — generation and review

```js
buildSystemGenerationInput({context, requirements, existingTests,
  targetRoutes, gapIds, executionMode, runtimeCapabilities})
// => {schemaVersion:1, promptVersion:'system-test-v2', mode,
//   requirements, sourceFiles, omittedFiles, targets, existingTests,
//   runtimeCapabilities, unknowns}

parseSystemGenerationResponse(raw)
// => {schemaVersion:1, scenarios:[{id,title,criterionIds,preconditions,
//   inputs,actions,expected,sourceReferences}],
//   files:[{path,content}], limitations:[]}
```

Do not require AI to compute runtime assertion IDs/hash/coverage. Derive assertion sites with the existing AST analyzer after validating code. Bind human-reviewed expected outcomes to those sites. Keep raw user criteria text unchanged.

## Task 5 — Consolidate prompt composition and generated drafts

**Files:** Create generation contract/prompt/proposal services. Modify `systemGenerationContext`, `systemTestPromptBudget`, `verifiedSystemGeneration`, `automaticSystemTests`, `systemTestBooster`, generation controller/queue entry and GeneratorModal.

**Interfaces:** Contract B. Existing endpoints return draft/proposal identity and status instead of presenting unreviewed files as approved. Preserve legacy response keys where necessary and add explicit `state`/`verificationStatus`.

- [x] Share one rule composer with mode-specific sections: user behavior, valid source-backed data setup, independence, observable assertions, no invented requirements and English generated titles/descriptions.
- [x] Focus source by target route/criterion references/gap plus direct dependencies, including TS index files. Retain whole selected files and omitted-file metadata; exclude secrets/runtime output. Keep existing character/request caps and usage accounting.
- [x] Replace Todo/icon repair anecdotes with compact general locator rules. Keep actionable DOM/source-specific failure feedback in the candidate payload, not permanent rules for every app.
- [x] Use structured scenario metadata + code response; continue supporting legacy `{content}` responses as a limited code-only draft with metadata pending review, never silently mark it verified.
- [x] Initially keep the new draft adapter private until Task 7's additive candidate schema and Task 8's Apply path exist. Do not switch the public generator to a response it cannot yet persist/review/apply. Test this task with injected storage; complete public endpoint/UI wiring in Task 8.
- [x] Propagate cancellation/deadline/AI budget through context, observation, generation and repair. Fix source identity races; config preparation in disposable workspace must not become an implicit source edit.
- [x] Generated candidates/config changes stay in disposable/draft storage until explicit Apply. Automatic prepare may produce a verified draft for review; it must not publish scenario files without an Apply action.
- [x] Store `promptVersion`, contextHash, selected model, actual available provider usage, attempts and draft/verification status. Do not change the generic generateText string return contract.
- [x] Extend prompt budget/generation tests with small in-memory auth and multi-route source fixtures. Verify route context priority, unknown fixture handling, Full Stack no-mock rules and draft no-write behavior. AI calls are mocked; no paid benchmark now.

**Done:** Cold-start, verified generation and improvement share consistent rules/mode/context; generated metadata is reviewable and existing project files remain unchanged before Apply.

## Task 6 — Review the exact candidate and accept meaningful improvements

**Files:** Create candidate-review service. Modify proposal review/controller/validator, improvement job/policy, assessment instrumentation input and improvement review UI. Generalize SystemTestProposal additively in Task 7 for generation drafts.

**Interfaces:** Candidate review state `EXECUTION_VERIFIED_AWAITING_REVIEW` is allowed before final acceptance; legacy `VERIFIED_IMPROVEMENT` remains recognized. Evaluation adds `improvementKind: 'COVERAGE'|'REQUIREMENT'`, `newlyVerifiedCriterionIds` and reason codes without removing existing fields.

- [x] Break the current circular dependency: requirement gain cannot be computed for new scenarios before their candidate assertion bindings are reviewed. Permit reviewing an execution-verified exact candidate before it is finally accepted.
- [x] Build candidate-only reviewed bindings from candidate AST IDs, matching criterion revision and reviewer-approved mapping. They are temporary verification inputs; do not write them into the active suite's bindings before Apply.
- [x] Reuse two-run candidate evidence only if exact assertion-site execution events prove every new reviewed binding in both runs. Otherwise queue bounded re-verification with those bindings. A generic screenshot/pass is insufficient.
- [x] COVERAGE acceptance: stable baseline/candidate, no lost/regressed measurement or scenario regression and positive comparable counter gain.
- [x] REQUIREMENT acceptance: same stable/no-regression conditions, same confirmed revision and newly verified reviewed criteria; allow code delta 0. A changed requirement revision is a new baseline, not a comparable gain.
- [x] Generation acceptance is distinct: first suite need not “improve” a nonexistent baseline. Validate safety/quality and user review; label unverified drafts explicitly and keep runtime-verified claims gated by real runs.
- [x] Generation without a confirmed business revision may use explicit scenario Expected/code review and remain `Requirement coverage: Not measured`. Never manufacture criterion bindings to satisfy Apply. REQUIREMENT improvement still requires a confirmed revision and reviewed runtime proof.
- [x] Preserve failing candidates as diagnostic drafts/reproducers with errors; no automatic acceptance, deleting baseline tests or changing Expected to make them pass. Do not introduce a separate bug-tracker feature.
- [x] Add table-driven cases to improvement policy/review tests for zero-code-delta requirement gain, unreviewed assertion rejection, changed hash/revision and baseline regression.

**Done:** A useful reviewed requirement test can be accepted without inflating code coverage; final acceptance always refers to the reviewed exact candidate.

## Contract C — immutable suite versions

Schema changes are additive. Exact Prisma syntax follows repository conventions when implementing, but the following fields and semantics are required:

```text
SystemSuiteState:
  snapshotId unique FK, headVersionId nullable FK, revision Int default 0

SystemSuiteVersion:
  id, snapshotId FK, parentVersionId nullable FK, restoredFromVersionId nullable FK
  sequence Int, action BASELINE|APPLY|RESTORE, suiteHash
  sourceHash, configHash, requirementRevisionId nullable, requirementHash nullable
  manifestJson, scenarioSnapshotJson, provenanceJson
  proposalId nullable, assessmentId nullable, actorId nullable, createdAt
  requestId, requestHash
  unique(snapshotId, sequence), unique(snapshotId, requestId)

SystemTestBlob:
  sha256 primary key, content Text, byteSize Int, createdAt

Manifest entry:
  {path, sha256, byteSize, role:SPEC|FIXTURE|HELPER}
```

- State/head updates and version creation commit in the same guarded transaction as publication. Version rows and blob content are immutable through application APIs.
- Snapshot owns its state/versions; parent/restored links use SetNull on deletion, never cascade-delete descendant history. Actor/proposal/assessment links use SetNull; immutable provenance retains original identifiers. Blob rows are not cascade-deleted with a project because hashes may be shared; serving a blob always requires a reachable authorized version. No blob GC in this delivery.
- An individual managed text file is at most 256 KiB; at most 100 managed files and 16 MiB total revision bytes, consistent with publisher limits. Reject with English 413 errors before publication.
- Paths are canonical workspace-relative paths. Reuse path containment, case normalization on Windows and symlink rejection. Do not treat `.spec.js` anywhere as System Test ownership.
- Baseline contains explicit selected/discovered Playwright/Cypress System Test specs plus statically resolved, exclusive local fixtures/helpers. Ambiguous/shared imports are recorded as dependencies, not restorable owned files. Package/lock/env/app source/global config files are excluded from restore.
- Restore set is union of current head and target manifests; create/update/delete only owned files in this set. New hand-written untracked files cause a visible conflict rather than silent deletion.
- Stable sorted path/hash manifest determines suiteHash. File byte hashes are exact UTF-8 bytes; do not normalize newlines in restored files.
- Add a System Test-specific identity policy (`identityVersion: 'system-suite-v2'`): app source identity excludes explicit system-owned specs/fixtures/helpers, while suiteHash includes them. Pass the owned manifest into System Test identity capture; leave Unit/Integration hashing behavior unchanged. Preserve legacy hashes and make legacy/v2 measurements incomparable until remeasured. Mixed ownership never gets excluded from app source merely by filename.
- Generated setup/config diffs require separate explicit review and guarded application; shared config is not automatically swept into suite rollback. Show `Shared setup is not included in test versions`.
- `SystemTestProposal` becomes a tagged candidate (`GENERATION`/`IMPROVEMENT`), with nullable baseline assessment only for generation, a content manifest for multi-file candidates and optional legacy file/content fields retained for compatibility.
- `SystemTestAssessment` adds nullable `suiteVersionId` and report schema provenance; `SystemRunArtifact` adds nullable runIndex/attemptIndex/stepKey/purpose/expiredAt. Legacy null means unknown, never run 1 by default.

## Task 7 — Add suite schema, ownership manifest and baseline

**Files:** Prisma schema + one additive migration; manifest/version services; generated proposal model integration; existing snapshot/version tests. Add `systemSuiteVersion.service.test.js` and a small isolated DB integration test file.

**Interfaces:** `captureSystemSuiteManifest({rootDir,selectedSpecs,declaredHelpers})`, `ensureSystemSuiteBaseline({tx,snapshot,manifest,userId,requestId})`, `assertSystemSuiteUnchanged({head,currentManifest})`.

- [x] Inspect current migration naming and the schema's existing relations. Write migration SQL without DROP/TRUNCATE or renaming legacy data.
- [x] Implement Contract C and exact cascade behavior. Backfill is lazy: no automatic reconstruction of nonexistent old content. Capture current real bytes as the initial baseline before first Apply; do not pretend prior proposals constitute a complete history.
- [x] Add the versioned System Test identity input to `systemAssessmentWorkspace.service.js` and callers. Test that modifying an exclusively owned fixture changes suiteHash but not app sourceHash, while modifying a shared helper changes app identity and blocks direct comparison/restore. Include identityVersion in comparability checks.
- [x] Detect exclusive helpers from import graph; reject ambiguous shared files for ownership, surface read-only dependency information. Include deletion/rename in the manifest model (rename is old-path deletion plus new-path creation).
- [x] GET history can return `initialized:false` without mutating DB. Baseline is persisted during an authorized Apply/explicit initialization, not as a side effect of viewing.
- [ ] Add manifest tests: path traversal/symlink, shared helper exclusion, sorted hash stability, raw newline preservation and oversize files. Use temporary directories, no AUT.
- [x] Run `npx.cmd prisma validate` and `npx.cmd prisma generate` from server. Review migration SQL; validate it against a disposable test database using existing safety helpers when available. Do not apply it to the user's normal DB without a reviewed migration step.

**Done:** Baseline can capture exact current System Test bytes and review metadata with deterministic ownership; old data still loads.

## Task 8 — Record explicit Apply atomically

**Files:** Suite version service, generation proposal service, `systemTestImprovementJob.service.js`, proposal controller/review, `projectWorkspacePreparation.service.js` and publisher only for a narrow needed hook, endpoint policy.

**Interfaces:** `applySystemSuiteCandidate({snapshotId,proposalId,userId,expectedHeadId,expectedSuiteHash,expectedWorkspaceRevision,requestId})`. Returns `{versionId,suiteHash,assessmentId,workspaceRevision,reused}`.

- [x] Route manual improvement Apply and generation Apply through one guarded publisher. Preserve existing review/hash checks and evidence.approve authority.
- [x] Activate the public generation draft endpoint/modal only now, using Task 7's tagged candidate storage and the working Apply route. Finish the delayed Task 5 wiring before marking generation complete; a first-time project must have a complete draft → review → Apply path.
- [x] Capture baseline and candidate full owned manifest; stage blob/version/state/proposal/catalog/binding writes into `stagePreparedPublication` / publisher transaction. Do not create a durable version before file publication succeeds.
- [x] Ensure candidate changedPaths are allowlisted: system-owned files plus separately reviewed setup diffs only. Unexpected app/unit/integration/config change aborts before live files are touched.
- [x] Apply immutable review metadata for new scenarios and refresh review states for any unchanged baseline scenario whose file hash changed. Rebind only if assertion/criterion identities can be proven unchanged; otherwise mark Stale rather than silently losing or inventing review.
- [x] Publish verified assessment only if source/test/runtime/review identities match the applied bytes. Persist its projection/artifact manifest atomically; zero-code-delta requirement improvement uses final reviewed verification evidence.
- [x] Request idempotency: same actor/request/payload returns committed receipt; different payload rejects; double-click cannot create extra versions. Retain committed receipt if refresh/report generation fails after Apply.
- [x] Extend existing proposal Apply tests for changed head/hash, duplicate request and failure before version commit. Add one disposable-DB happy-path/rollback case using existing helpers rather than a large new mock framework.

**Done:** Successful Apply creates exactly one suite revision; failed Apply creates neither a partial revision nor partial test files.

## Task 9 — History, compare, restore and check-version APIs

**Files:** Suite controller/validator, existing systemAssessment route, suite services, `systemSuiteVersionRun.service.js`, endpoint policy, assessment job/validator, job payload handling. Reuse existing `SYSTEM_TEST_ASSESSMENT` job type for version-check execution.

**Interfaces:** Base `/api/coverage/:snapshotId/system/versions`:

```text
GET  /                              -> {initialized,headId,workingChanges,items,nextCursor}
GET  /:versionId                     -> {version,manifest,scenarioSnapshot,compatibility}
GET  /compare?from=ID&to=ID           -> {files,scenarios,identity,canCompareMeasurements}
POST /:versionId/restore             -> {versionId,suiteHash,workspaceRevision,reused}
POST /:versionId/check               -> 202 {jobId,assessmentId}
```

Restore request: `{expectedHeadId,expectedSuiteHash,expectedSourceHash,expectedWorkspaceRevision,requestId}`. Check request: `{expectedSourceHash,runner,executionMode,requestId}`. IDs never imply cross-project authority; route ordering places `/compare` before `/:versionId`.

- [x] Implement paginated read/history and bounded file/scenario diff. Blob content is loaded only after authorized version ancestry checks; no public blob-by-hash endpoint.
- [x] Restore checks active snapshot, capability `evidence.approve`, no conflicting queued/running operations, dirty editor, expected source/head/suite/workspace identity, symlinks and managed ownership. Source/config mismatch returns `VERSION_SOURCE_MISMATCH` with an actionable English message; do not restore app source to resolve it.
- [x] Prepare target bytes in operation workspace; validate syntax and references, then publish the exact union-of-manifests change set using existing multi-file publisher. Preserve application/unit/integration bytes. No-op target=head returns reused current result without a fake revision.
- [x] Restore creates a new version with restoredFromVersionId and parent=current head. Keep old assessments unchanged; current review/binding/coverage becomes stale until exact identity is revalidated or tests run again.
- [x] Check-version replaces managed suite only in disposable workspace and publishes **no source changes**. Run through existing isolated assessment machinery; report records requestedVersionId, source actually used, manifest test hash and `Historical tests on current source` provenance. Disable automatic missing-test generation in this path.
- [x] On checked source/config mismatch, allow only the explicitly requested diagnostic run on current source; mark comparability false and requirement review stale. Never present this as old-source reproduction or verified requirement evidence.
- [x] Snapshot restore starts a new active suite lineage from the new snapshot's actual files on next authorized baseline capture. Do not copy all assessment DB rows or reactivate previous reviews automatically.
- [ ] Add bounded endpoint tests (ownership, permissions, cross-snapshot ID, invalid hashes) and restore service cases (create/delete, hand-edit conflict, source mismatch, idempotency, failed publication recovery). Include hashes proving unrelated sentinel files unchanged.

**Done:** User can inspect, compare, restore and check old System Test versions without rolling back the rest of the project.

## Task 10 — Keep historical evidence addressable and traceable

**Files:** Artifact schema from Task 7, `systemRunArtifact.service.js`, assessment job/persistence/controller, report projection, scenario catalog sync and artifact expiry utility.

**Interfaces:** Evidence lookup is assessment + historical scenarioKey + run/attempt, not existence of today's SystemScenario row. Public response includes `{status:CAPTURED|NOT_CAPTURED|EXPIRED|INVALID,artifacts}`.

- [x] Persist runIndex, attemptIndex when available, purpose CHECKPOINT/FAILURE/FINAL and scenario identity. Legacy records retain null/unknown metadata.
- [x] Resolve historical scenario from saved assessment snapshot; do not require active catalog row. Keep ownership + containment + hash verification on every artifact read.
- [x] Avoid double-counting a live preview and final screenshot as two required-artifact slots. Required artifact score uses distinct evidence purposes and required runs; if lineage cannot be established, show the limitation rather than inventing completeness.
- [x] Validate actually persisted artifact manifest before final quality score/projection. Rejected/over-limit/missing artifacts remain explicit; do not count a metadata array as verified captured evidence.
- [x] Centralize 14-day artifact retention in one constant for the existing policy; cleanup updates expired metadata consistently for managed screenshot/trace/raw report directories. Never delete suite blobs as artifact cleanup. Show expiry in history/export.
- [x] Avoid introducing broad browser/DOM redaction rewriting in this delivery. Keep API field allowlists, do not render raw response bodies/tokens, and make sensitive screenshot/trace limitations explicit in export. Secure artifact access remains mandatory.
- [x] Extend existing artifact tests with historical scenario deletion, run identity, integrity mismatch and expired status; a compact table is sufficient.

**Done:** Renaming/deleting a current scenario does not erase the meaning or access path of an authorized historical assessment.

## Task 11 — Finish a concise, consistent English workspace

**Files:** Dashboard/Workflow/AssessmentPanel/Generator/Editor/ImprovementReview/LiveRun/ReportView; create Settings, VersionHistory, VersionDiff components. Modify client System Test service only for new APIs. Use existing design tokens/common buttons/modal patterns.

Before editing JSX, read applicable frontend/anti-ui-slop guidance and relevant existing components; user language/testing constraints override optional broader workflow suggestions. Do not open a separate website project or replace global styling.

**Interfaces:** Components consume selected assessment projection and version API; they do not calculate measured coverage independently.

- [x] Use three main tabs: `Scenarios`, `Live run`, `Results`. Coverage/gaps is a Results section; `Version history` is a drawer opened from toolbar. Keep context-specific file/evidence navigation intact.
- [x] Toolbar: one primary contextual action (`Generate tests`, `Review scenarios`, `Run selected`, `View results`); secondary `Improve tests`, `Version history`, `Export`, `Settings` appear when usable. Do not hide permission/error reasons behind an unlabeled disabled icon.
- [x] Scenario master/detail uses real Title, Input, Expected, review state and latest actual/evidence. Technical source/stack/network details live in secondary tabs or disclosure. No large generic help paragraphs repeated per card.
- [x] Version drawer shows sequence/action/time/actor, scenario/file changes, verification status and current/working changes. Detail actions: `Compare`, `Check version`, `Restore tests`. Restore preview names exact affected files; explicit final `Restore tests` records reason/target and current hash.
- [ ] Keep draft form/code input on failed request or conflict; offer reload/compare. Close/discard confirmation only for actual unsaved edits. Disable duplicate submits; leave previously completed result visible during a new run.
- [x] Use existing typography and theme tokens, restrained accent, consistent spacing, readable body labels and a clear evidence-first hierarchy. Avoid multi-gradient panels and excessive uppercase/monospace copy.
- [ ] Desktop uses list + detail; mobile stacks with bounded horizontal scroll only for diff/code tables. Label focus targets, Escape/close/focus restoration, keyboard tabs and accessible status announcements. No per-frame screen-reader announcements.
- [x] Respect reduced motion. Unconditional `slowMo:450` in the managed runner becomes observation/headed-only; normal verification uses normal speed. Do not change workers/isolation policy for visual polish.
- [x] Add a small English copy audit covering system-authored strings and negative states, including export errors, pluralization, file counts, permissions and `Not measured` / `Not captured` / `Not calculated`. Do not translate raw user content.
- [x] No new UI unit tests for static labels/CSS. Exercise pure report/live models with existing Node tests; final browser interaction is in the user checklist.

**Done:** User-facing flow is entirely English, concise and backed by real data; version restore scope and run mode are always understandable.

## Task 12 — Shared charts, JSON and a readable PDF

**Files:** ReportView, report charts component, metrics/coverage comparison components, PDF renderer/layout, report projection. Update existing PDF test; add no second report data calculation.

**Interfaces:** Keep `renderSystemTestPdf({assessment,artifacts,generatedAt})`; normalize to Contract A before layout. New SVG/CSS charts consume exact projection counts; PDF draws equivalent static vectors.

- [x] Overview: project + snapshot + suite version + mode + assessment time; scenario outcomes, confirmed criteria verified, observed repeat consistency and elapsed runtime. Missing totals show em dash with English explanation.
- [x] Build status stacked bar, requirement designed/verified bars, FE/BE measured coverage bars, scenario × run matrix and comparable before/after bars. Every chart includes numeric labels and accessible table/text. Weak assertion quality stays separate from execution totals.
- [x] No API/route percentage without verified inventory denominator. No trend chart until enough comparable records exist; for sparse history show actual measurements only.
- [x] HTML/JSON/PDF use identical projection values and selected ID. JSON export includes schemaVersion/provenance/limitations; use Blob URLs instead of huge data URIs and revoke URLs after use.
- [x] PDF page 1 emphasizes outcomes and priority actions, then failures with Expected/Actual and selected screenshots; append complete scenario/evidence summary with clear counts if details are bounded. Never silently cut to 15 items and imply completeness.
- [x] Screenshot embedding reads authorized artifact bytes server-side with count/size limits. Missing/expired/invalid image gets a labeled placeholder, not a missing section. Use existing NotoSans font; keep non-English project/user text renderable.
- [ ] Repeat table headers on page breaks; measure long title/error rows; cap displayed stack text with a clear continuation/reference. Include assessment/run/version IDs, full hashes in appendix, time zone and export timestamp separately from run timestamp.
- [x] Format system dates with explicit English locale and a visible time zone; default display Asia/Ho_Chi_Minh or existing selected app timezone, persist ISO UTC. Do not depend on the Windows server's locale/time zone.
- [ ] Keep print view explicit and load/check all selected images before `window.print()`. PDF rendering does not open a browser print dialog.
- [x] Use PDF skill at implementation time for bounded render/inspect: one mixed-status normal report and one long-row/multipage/expired-evidence report. This is artifact layout QA, not E2E.
- [x] Strengthen existing PDF test to inspect extracted semantic text (no fake determinism, same counts/assessment, English unavailable labels), keeping just 1–2 fixtures. Do not use binary PDF snapshots.

**Done:** Report is readable with and without charts, exports correspond to the chosen assessment, and two representative PDFs have been visually inspected.

## Task 13 — Final focused verification and handoff

**Files:** Add `docs/system-test-manual-acceptance.md`; update existing workflow runbook and this plan's checkpoint. Do not update every historical design document.

- [x] Run only the touched/related fast suites; use `--silent` and inspect failures instead of printing successful verbose logs. No full backend test campaign unless a shared infrastructure failure justifies it.
- [x] Run client Node model tests, client lint/build and Prisma validation/generation if schema changed. Distinguish existing unrelated lint failures from introduced failures.
- [x] Run one bounded isolated-DB suite for suite Apply/Restore transaction + recovery if an isolated DB is available. If unavailable, record it as an unverified integration gate; never replace it with fake success or point tests at normal project data.
- [x] Review migration SQL, ownership/cascade rules, API permissions, diff scope, English copy and unchanged Unit/Integration/source sentinel hashes for restore tests.
- [x] Check all plan tasks and findings mapping. Do not mark a task complete while its required logic is still a placeholder or hidden behind a non-working button.
- [x] Provide a compact handoff: changed behavior/files, migration/config instructions, actual commands/results, remaining limitations, and a link to manual acceptance. State `Ready for your E2E testing` only with the precise automated-check status; do not say E2E passed.
- [x] Do not run browser E2E, live AI generation, full AUT stacks or a multi-model benchmark. Leave real browser/AI prompt quality confirmation to the user's final acceptance run.
- [x] Do not automatically commit/push/merge/deploy. Keep changes reviewable in the working tree unless the user separately requests version-control actions.

**Done:** Implementation and bounded checks are complete, with explicit user E2E handoff and no invented verification claims.

## Minimal verification budget

Use behavior tests at module boundaries; add cases to existing files where sensible. Test count is not an acceptance target. Avoid large helper frameworks and duplicated tests across projection/FE/PDF.

| Risk | Smallest meaningful check |
|---|---|
| False coverage/evidence/score | One table-driven report projection suite; existing coverage truthfulness test |
| Review/mode/readiness | Extend scenario/workflow test with no auto-confirm, zero selection and stale hash |
| Live repeat/cursor | A pure Node model test with three event sequences |
| Prompt | Small in-memory source fixtures + mocked AI response; no full prompt snapshots |
| Candidate acceptance | Existing policy/review tests with requirement gain=0 code delta, regression and hash mismatch |
| Version ownership | Temporary-directory manifest tests and sentinel file hashes |
| Atomic version publication | One isolated integration suite reusing publisher/recovery helpers |
| Access | Small route table: member allowed, insufficient capability rejected, foreign version rejected |
| Historical artifacts | Existing artifact tests, 3–4 focused cases |
| PDF | 1–2 semantic extraction fixtures + two visual renders at finish |
| UI | Lint/build + model tests; browser E2E performed by user |

Representative commands; include only files actually created/touched by that point:

```powershell
npm.cmd test --prefix server -- --runInBand --silent src/tests/systemReportProjection.service.test.js src/tests/systemScenarioVerdict.service.test.js src/tests/systemCoverageTruthfulness.test.js
npm.cmd test --prefix server -- --runInBand --silent src/tests/systemTestPromptBudget.test.js src/tests/verifiedSystemGeneration.test.js src/tests/systemImprovementPolicy.test.js src/tests/systemProposalReview.service.test.js
npm.cmd test --prefix server -- --runInBand --silent src/tests/systemSuiteVersion.service.test.js src/tests/systemTestProposalApply.test.js src/tests/systemRunArtifact.service.test.js src/tests/systemTestPdf.service.test.js
node --test client/src/components/dashboard/system/systemLiveRunModel.test.js client/src/components/dashboard/system/systemTestExecutionModel.test.js
npm.cmd run lint --prefix client
npm.cmd run build --prefix client
```

From `server/`, after schema changes:

```powershell
npx.cmd prisma validate
npx.cmd prisma generate
```

No E2E command is part of the agent's completion gate. Keep actual generated testcase verification as product behavior; do not invoke it as development QA unless the user later requests it.

## Manual acceptance checklist to deliver to the user

Write UI labels in English; explanatory test instructions may be Vietnamese. Each item includes expected result and data prerequisites.

1. Empty project → choose mode → generate draft → inspect Input/Expected/code → explicit Apply. Original project files do not change before Apply.
2. Existing non-Todo project → scan → confirm Expected → run selected. No Todo fixtures, guessed API/DB details or fallback score anywhere.
3. Run two repeats → inspect run 2 → Stop/reload/reconnect. Do not see completion after run 1 or frames from previous assessment.
4. Missing requirements/evidence/instrumentation → read clear unavailable states; never 100% from missing data.
5. Full Stack vs Frontend → verify correct mode/config, no silent fallback; mocked test exclusions explain why.
6. Improve with coverage gain; improve with reviewed requirement gain and no new lines; application bug remains a failing diagnostic instead of weakened assertion.
7. Apply twice → compare versions → check old tests → restore tests. New revision is created; unrelated source/unit/integration remain unchanged.
8. Edit a managed file manually, keep editor draft open or run a job → restore. Clear conflict appears; user draft/source is preserved.
9. Restore project snapshot → confirm full workspace changes and new suite lineage; historical report stays associated with original identity.
10. Choose older assessment → compare displayed data, JSON and PDF; then rename/remove current scenario → old evidence remains readable if retained.
11. Try foreign-project version/artifact and insufficient role. API denies access, UI cannot bypass permissions.
12. Light/dark, narrow viewport, keyboard, long scenario title, export failure/retry, expired screenshot, reduced motion and multipage PDF.
13. Real AI generation across auth, multi-route and validation projects: assess useful assertions, supported data setup, duplicate cases and bug detection. This quality evaluation is not claimed by mocked development tests.

## Coverage of prior findings

| Audit finding / requirement | Tasks |
|---|---|
| F01 fake dimensions / F02 fake scenario evidence | 1, 2, 10, 11 |
| F03 auto-Expected / mislabeled review | 3, 6 |
| F04 unsupported success claims | 1, 4, 12 |
| F05 report/mode mismatch | 2, 3, 12 |
| F06 live completion/cancellation | 4 |
| F07 suite history / snapshot separation | 7, 8, 9, 11 |
| F08 coverage-only improvement | 6 |
| F09 prompt/context/mode inconsistency | 3, 5, 6 |
| F10 artifact provenance/retention/PDF | 10, 12 |
| English UI/report and original user text | Global constraints, 3, 5, 11, 12 |
| Focused testing / user-owned E2E | Every task, 13, minimal verification budget |
| Small-agent execution / resume after compaction | Task order and checkpoint below |

## Execution checkpoints and stop rules

After each task, update this compact block rather than writing long progress logs or rereading all 241 indexed files:

```text
Last completed task:
Current task / next concrete step:
Files changed:
Contract/schema changes:
Checks actually run and result:
Unverified gates / environment limits:
Adaptations from plan and reason:
```

Do not mark tasks checked based only on files existing. Re-run relevant checks only after new changes/failures. If a shared infrastructure edit is needed, document exactly why and constrain the diff; do not launch an unrelated cleanup.

Restore publication, candidate review identity and report provenance are correctness gates: reduce cosmetic scope if necessary rather than bypass those gates. A genuine missing product decision can be asked concisely while independent work continues; do not ask permission for routine reversible edits already authorized during execution.

Plan self-review: all F01–F10 map to tasks; English copy and original user text are distinguished; compact testing does not weaken product verification; E2E is explicitly handed to the user; no unavailable subagent/skill dependency is required. No production implementation or runtime validation was performed while writing this plan.

### Final execution checkpoint

Implementation Tasks 0?13 delivered with the adaptations below. User E2E and live AI quality acceptance remain pending; no browser acceptance is claimed.

| Area | Implemented result / evidence |
|---|---|
| 0 baseline | develop / f9b89b46d6ffdcd88adcc5f8fe49604cff16e638; no unrelated tracked baseline edits |
| 1?2 reports/history | Persisted projection, no sample results or fallback score; selected assessment history and ID-pinned HTML/JSON/PDF; current artifact expiry overlays immutable results |
| 3 review/mode | English brief/criteria forms, scenario/assertion mapping, explicit Expected confirmation; exact selection; Frontend / Full Stack |
| 4 live | Job terminal status, independent repeats, scoped frames/events, contiguous replay cursor, follow-latest scrolling |
| 5 generation | Shared mode/framework rules, focused source, metadata validation, prompt/context/model/usage provenance, unpublished recoverable draft and explicit Apply |
| 6 improvement | Review exact candidate before non-AI repeat verification; accept stable comparable reviewed criterion gain without additional covered lines |
| 7?9 versions | Additive schema, immutable manifests/blobs, explicit baseline/Apply/Restore, file/scenario diff, guarded publication, isolated historical checks |
| 10 evidence | Run/purpose metadata, owned artifact reads, retention expiry, persisted-manifest scoring; each required run needs its own evidence |
| 11?12 UI/report | Three tabs, scenario master/detail, version dialog, status/requirements/coverage/repeat/before-after charts, English copy, shared exports and multipage PDF |
| 13 checks | 149 tests / 21 related Jest suites passed; two Node tests passed; targeted lint/build and Prisma validate/generate passed; PGlite migration/transaction/recovery integration passed |

Adaptations backed by repository evidence:

1. Generation drafts reuse the existing `AiTest` DRAFT model with `SYSTEM_GENERATION_DRAFT` metadata. Existing `SystemTestProposal` keeps its required baseline-assessment relation. This avoids weakening legacy proposal invariants or adding unused tagged columns.
2. Suite ownership identity lives in `systemSuiteManifest.service.js` as `system-suite-v2`. Runtime assessment comparability retains the existing conservative identity contract. These hash domains are not substituted for one another; suite version provenance records its identity version.
3. Runtime setup/generation runs in operation copies. Run no longer silently generates/publishes tests. Full Stack config and generated SQL are captured as separately reviewed setup files; suite restore excludes this shared setup.
4. Shared publisher change is limited to immediate recovery of a filesystem journal after a DB transaction exception. A deliberately rejected version INSERT on the disposable database proved both database and filesystem rollback.
5. PDF semantic checks use extraction of two rendered QA fixtures with temporary PyMuPDF, alongside the existing lightweight Jest PDF test. No PDF parser or browser-test dependency was added to the application. Final normal/long fixtures have 3/6 pages; earlier versions were visually inspected and the final first/last pages checked.
6. Version comparison is file/scenario metadata comparison. Runtime verification at Apply is labeled separately; generation/manual/restore revisions never inherit a fabricated verified status. Old tests run on current source and stale requirement review is explicit.
7. Syntax and manifest integrity are checked before restore. External package/service compatibility is diagnosed by Check version / Run; restoring a suite does not install or restore app dependencies.
8. Automated checks use compact fixtures and an offline real database. Browser focus/responsiveness, real image capture and AI usefulness remain in the user checklist, rather than being claimed from code inspection.

Detailed original checkboxes above are a design reference: checked items indicate implementation or the explicitly documented equivalent above. Unchecked items describe exact additional verification/UX criteria not established by this agent's bounded checks; they are not permission to claim E2E success.

Remaining acceptance: [manual acceptance and migration instructions](../../system-test-manual-acceptance.md). No normal DB migration, paid/live AI call, AUT launch, browser E2E, commit, push or deployment was performed.
