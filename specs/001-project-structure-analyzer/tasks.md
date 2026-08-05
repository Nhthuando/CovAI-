---

description: "Executable task list for Project Structure Analyzer"
---

# Tasks: Project Structure Analyzer

**Input**: `spec.md`, `plan.md`, `data-model.md`, `contracts/structure-analysis-api.md`, `research.md`, and `quickstart.md`

**Execution note**: `[P]` means the task can be worked on in parallel with other `[P]` tasks in the same phase because it has no dependency on incomplete work and targets different files. Every task includes its expected file path, traceability, and a checkable completion condition.

**User stories**:

- **US1 (P1)** — Analyze a project snapshot and produce a complete inventory, summary, hierarchy, and diagnostics.
- **US2 (P1)** — Classify architecture roles and resolve internal/external dependencies.
- **US3 (P2)** — Catalog functions with stable locations, parameters, async state, export visibility, and dependency context.
- **US4 (P2)** — Persist and safely consume one stable project graph through the backend API and dashboard UI.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared fixtures, identifiers, and result-shape conventions before story implementation.

- [X] T001 [P] Create the analyzer fixture layout and shared test helper in `server/src/tests/fixtures/project-structure/` and `server/src/tests/helpers/projectStructureTestUtils.js`; **AC/FR**: FR-019 and SC-001/SC-008; **Done when** fixture creation, temporary snapshot roots, and JSON comparison excluding timestamps are reusable by Jest tests.
- [X] T002 [P] Define the serialized result schema version, diagnostic categories, module-format values, and safe status labels in `server/src/services/projectStructure.constants.js`; **AC/FR**: FR-006, FR-018, FR-025, FR-019; **Done when** all later analyzer and API code can import one source of truth and schema version `1` is explicit.
- [X] T003 [P] Add deterministic node, edge, and function identifier helpers in `server/src/utils/projectStructureId.util.js`; **AC/FR**: FR-016 and SC-008; **Done when** identical relative paths/source ranges produce identical IDs across two independent calls and IDs contain no absolute path.

## Phase 2: Foundational (Database and Access Boundaries)

**Purpose**: Create the expand-only persistence foundation and shared ownership boundary required by all user stories.

**Dependency rule**: T004–T007 are deployment-ordered database tasks. Application tasks that create/read `ANALYSIS` data must not be enabled until T007 is verified.

- [X] T004 Update `server/prisma/schema.prisma` with `JobType.ANALYSIS`, `ProjectStructureAnalysis`, the optional `ProjectSnapshot.structureAnalysis` relation, the `(projectId, snapshotId, type, status)` support index, and the one-result-per-snapshot constraint; **AC/FR**: FR-021, FR-024, FR-028, FR-029 and data-model rules; **Done when** the schema expresses cascade behavior and `npx.cmd prisma validate` passes after client generation.
- [X] T005 Create the standalone enum migration `server/prisma/migrations/<timestamp>_add_analysis_job_type/migration.sql` containing only `ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ANALYSIS'`; **AC/FR**: FR-024 and migration runbook check 1; **Done when** the SQL is transaction-safe for PostgreSQL and does not use `ANALYSIS` in the same migration transaction.
- [ ] T006 Create the schema migration `server/prisma/migrations/<timestamp>_add_project_structure_analysis/migration.sql` for the result table, relation, ordinary indexes, and foreign-key cascade after T005; **AC/FR**: FR-021, FR-026 and data-model migration steps 2–3; **Done when** existing projects, snapshots, and jobs remain valid and the SQL matches `schema.prisma`.
- [ ] T007 Create the reviewed operational index script `server/prisma/operations/project-structure-analysis-index.sql` with duplicate preflight and `CREATE UNIQUE INDEX CONCURRENTLY` for active `ANALYSIS` jobs; **AC/FR**: FR-029 and migration runbook checks 1–3; **Done when** the script runs outside a transaction, scopes the predicate to `ANALYSIS` + `snapshotId IS NOT NULL` + `QUEUED/RUNNING`, and documents invalid-index recovery.
- [ ] T008 [P] Implement the shared owner-scoped project/snapshot resolver in `server/src/services/projectScope.service.js`; **AC/FR**: FR-022, FR-023, FR-027 and authorization checks; **Done when** it selects the newest owned snapshot when omitted, rejects foreign/mismatched snapshots with safe not-found behavior, and never returns `rootDir` or `storagePath` to callers.
- [ ] T009 [P] Implement safe job, snapshot, and analysis-result projections in `server/src/services/analysisResponse.service.js`; **AC/FR**: FR-020, FR-023, FR-025, FR-028; **Done when** projections omit payload/raw result/source content/absolute paths/secrets while retaining the contract fields needed by owner consumers.

**Checkpoint**: Database rollout order, ownership resolution, and safe response boundaries are defined and independently reviewable before story code is enabled.

## Phase 3: User Story 1 — Analyze a Project Snapshot (Priority: P1) — MVP Core

**Goal**: Scan one server-owned snapshot without executing source code and return every supported file as an analyzed node or explicit diagnostic.

**Independent test**: Run the US1 fixture through the pure analyzer and verify supported-file coverage, exclusions, zero-file validity, per-file read/parse diagnostics, normalized paths, and summary/tree consistency.

### Tests and fixtures for User Story 1

- [ ] T010 [P] [US1] Add readable, empty, ignored-directory, nested, and unreadable-file fixtures under `server/src/tests/fixtures/project-structure/us1-inventory/`; **AC/FR**: US1 scenarios 1–3 and FR-002–FR-004; **Done when** the fixture includes expected included/excluded paths and an explicit expected diagnostic for the unreadable file.
- [ ] T011 [P] [US1] Extend `server/src/tests/fileDiscovery.test.js` with snapshot-bound discovery tests for supported extensions, exclusions, normalized relative paths, empty roots, and per-file failures; **AC/FR**: US1 scenarios 1–3, FR-002–FR-004, SC-002; **Done when** the tests fail against the old arbitrary-root behavior and assert that no absolute path is returned.
- [ ] T012 [P] [US1] Add inventory contract tests to `server/src/tests/projectStructureAnalyzer.test.js` for source-file nodes, zero-count results, diagnostics, and summary/tree counts; **AC/FR**: FR-015, FR-017–FR-020, SC-002 and SC-006; **Done when** the expected serializable result shape is executable as a Jest oracle.

### Implementation for User Story 1

- [ ] T013 [US1] Replace the arbitrary-root analyzer entry point with a snapshot-bound discovery API in `server/src/services/fileDiscovery.service.js`; **AC/FR**: FR-001–FR-004 and FR-020; **Done when** only supported `.js/.jsx/.mjs/.cjs/.ts/.tsx` files are returned with `/`-normalized relative paths, configured exclusions are applied, and unreadable files become diagnostics without aborting the scan.
- [ ] T014 [US1] Extend `server/src/services/babelParser.service.js` to parse JavaScript/JSX/TypeScript ESM and CommonJS syntax while converting parse failures into file diagnostics; **AC/FR**: FR-006, FR-018 and US1 scenario 3; **Done when** parser tests cover all supported extensions and malformed syntax produces a safe reason without source text or host paths.
- [ ] T015 [US1] Implement the inventory-first orchestration boundary in `server/src/services/projectStructureAnalyzer.service.js`; **AC/FR**: FR-015, FR-017, FR-019, FR-020 and SC-006; **Done when** it accepts a server-resolved snapshot root, does not write the database or execute source, emits summary/graph/tree/function-catalog/diagnostics sections, and passes T012.
- [ ] T016 [US1] Extend `server/src/services/projectStructureTree.service.js` to aggregate normalized file paths into deterministic folder/file nodes for the US1 result; **AC/FR**: FR-015, FR-016 and US1 scenario 1; **Done when** nested folders are preserved, node IDs are unique/stable, and ignored paths never appear in the tree.

**Checkpoint**: US1 is independently deliverable when T010–T016 pass and a fixture with one unreadable file still returns the remaining inventory plus actionable diagnostics.

## Phase 4: User Story 2 — Explore Architecture and Dependencies (Priority: P1)

**Goal**: Add evidence-based role labels, module-format detection, internal/external dependency classification, forward edges, reverse dependents, and unresolved-reference context.

**Independent test**: Analyze a mixed ESM/CommonJS fixture with route/controller/service/component/hook/utility files, manifests, static imports, require calls, literal dynamic imports, and unresolved references; verify role and graph oracles.

### Tests and fixtures for User Story 2

- [ ] T017 [P] [US2] Add the mixed-format role/dependency fixture and manifests under `server/src/tests/fixtures/project-structure/us2-architecture/`; **AC/FR**: US2 scenarios 1–5 and FR-005–FR-011; **Done when** the fixture has expected roles, `ESM`/`CommonJS` labels, `Mixed` project format, internal edges, external packages, and unresolved cases.
- [ ] T018 [P] [US2] Add role-classification tests in `server/src/tests/projectStructureRoles.test.js`; **AC/FR**: FR-005 and US2 scenario 1; **Done when** recognized backend/frontend roles are asserted, ambiguous evidence maps to `unknown`, and folder role aggregation is covered.
- [ ] T019 [P] [US2] Add dependency-resolution tests in `server/src/tests/projectStructureDependencies.test.js`; **AC/FR**: FR-007–FR-011, SC-003 and US2 scenarios 2–5; **Done when** extension/index resolution, ESM/CommonJS/re-export/require/literal dynamic import, external dependency categories, reverse edges, and unresolved reasons are all asserted.

### Implementation for User Story 2

- [ ] T020 [P] [US2] Implement evidence-based file/folder role detection in `server/src/services/projectStructureRoles.service.js`; **AC/FR**: FR-005; **Done when** it returns recognized roles with evidence/confidence metadata and returns `unknown` instead of guessing when evidence is insufficient.
- [ ] T021 [P] [US2] Implement module-format detection and relative/external dependency resolution in `server/src/services/projectStructureDependencies.service.js`; **AC/FR**: FR-006–FR-011 and SC-003/SC-005; **Done when** it resolves supported extension/index variants, deduplicates manifest packages with origin/category, emits reverse relationships, and retains unresolved specifiers/reasons.
- [ ] T022 [US2] Integrate roles and dependencies into `server/src/services/projectStructureAnalyzer.service.js`; **AC/FR**: FR-005–FR-011, FR-015, FR-017–FR-019; **Done when** T018–T019 pass, file nodes expose imports/importedBy/diagnostics, graph edges are typed, and project format reports `ESM`, `CommonJS`, `Mixed`, or `Unknown`.

**Checkpoint**: US1 remains valid and US2 can be demonstrated independently from the mixed-format fixture with both forward and reverse dependency navigation.

## Phase 5: User Story 3 — Inspect Functions and Test Context (Priority: P2)

**Goal**: Produce a deterministic function catalog and attach each function's containing-file dependency context without a second source scan.

**Independent test**: Analyze declarations, expressions, arrows, methods, async functions, exports, private helpers, and anonymous constructs; compare catalog records with the fixture oracle.

### Tests and fixtures for User Story 3

- [ ] T023 [P] [US3] Add the function conformance fixture under `server/src/tests/fixtures/project-structure/us3-functions/`; **AC/FR**: US3 scenarios 1–4 and FR-012–FR-014; **Done when** expected names/generated labels, line ranges, parameters, async values, export visibility, and containing files are recorded.
- [ ] T024 [P] [US3] Extend `server/src/services/babelParser.test.js` and add focused assertions in `server/src/tests/functionExtraction.test.js`; **AC/FR**: FR-012–FR-014 and SC-004; **Done when** named/anonymous declarations, expressions, arrows, methods, ESM exports, CommonJS exports, and unsupported ambiguity diagnostics are covered.
- [ ] T025 [P] [US3] Add catalog integration assertions to `server/src/tests/projectStructureAnalyzer.test.js`; **AC/FR**: US3 scenario 4, FR-015, FR-019 and SC-006/SC-008; **Done when** every function record links to a file node and exposes the file's already-computed direct internal/external dependencies.

### Implementation for User Story 3

- [ ] T026 [US3] Extend `server/src/services/functionExtraction.service.js` for declarations, expressions, arrows, methods, parameters, source ranges, async state, ESM/CommonJS export visibility, and deterministic generated labels; **AC/FR**: FR-012–FR-014 and SC-004; **Done when** T024 passes and generated identifiers depend only on normalized path/source location/construct identity.
- [ ] T027 [US3] Integrate the function catalog and file dependency context in `server/src/services/projectStructureAnalyzer.service.js`; **AC/FR**: FR-013, FR-015, FR-017, FR-019 and US3 scenario 4; **Done when** `totalFunctions` and `exportedFunctionCount` match catalog records and no second source discovery pass is required.

**Checkpoint**: US3 is independently testable against the function fixture and leaves US1/US2 graph behavior unchanged.

## Phase 6: User Story 4 — Consume a Stable Project Graph (Priority: P2)

**Goal**: Persist the latest successful graph per snapshot, expose safe owner-scoped job/result/file APIs, and render the result in the dashboard with backward-compatible polling.

**Independent test**: As owner, queue and poll an analysis, fetch the stored result, select an older snapshot, repeat an active request, and verify that a non-owner receives safe `404` responses and no internal paths/status/result data.

### Tests for User Story 4

- [ ] T028 [P] [US4] Add persistence/job lifecycle tests in `server/src/tests/projectStructureJob.test.js`; **AC/FR**: FR-021, FR-024–FR-029 and US4 scenarios 7–10; **Done when** tests cover snapshot-scoped active-job reuse, unique-race recovery, queued/running/failed preservation of the prior result, success upsert, and compact job result data.
- [ ] T029 [P] [US4] Add route contract and authorization tests in `server/src/tests/projectStructure.route.test.js` and `server/src/tests/projectStructure.authorization.test.js`; **AC/FR**: FR-022–FR-030, API contract, and US4 scenarios 5–10; **Done when** owner/non-owner/anonymous/missing/cross-project cases cover snapshots, tree, file content, `/api/files`, job detail/lists, start, and stored-result read with safe `404` behavior.
- [ ] T030 [P] [US4] Add migration/runbook checks in `server/src/tests/projectStructureMigration.test.js`; **AC/FR**: migration runbook checks 1–3 and constitution IV; **Done when** enum-first ordering, schema/index predicates, duplicate preflight, failed-index recovery, and no enum removal on code rollback are asserted from the reviewed SQL/docs.

### Backend persistence, worker, model, controller, and routes

- [ ] T031 [US4] Implement snapshot-scoped analysis job creation/reuse and safe job projections in `server/src/services/job.service.js`; **AC/FR**: FR-024–FR-029; **Done when** active lookup keys on `(projectId, snapshotId, type)`, terminal jobs do not block re-analysis, unique violations re-read the active job, and owner-safe fields are returned.
- [ ] T032 [US4] Replace the stub pipeline in `server/src/services/analysisJob.service.js` with scanner → parser → function catalog → dependency → tree stages; **AC/FR**: FR-001, FR-004, FR-015, FR-018, FR-021, FR-026; **Done when** the complete result is built before persistence, `ProjectStructureAnalysis` is upserted only on success, failures mark the job `FAILED`, and previous results remain readable.
- [ ] T033 [US4] Finalize the existing `ANALYSIS` dispatch and lifecycle error handling in `server/src/services/queue.service.js`; **AC/FR**: FR-024–FR-025 and research decision 1; **Done when** no second queue/worker is introduced and queued analysis jobs reach the existing lifecycle through `ANALYSIS`.
- [ ] T034 [US4] Add owner-scoped start/result/snapshot service methods in `server/src/services/project.service.js`; **AC/FR**: FR-021–FR-029 and US4 scenarios 5–10; **Done when** omitted snapshots select newest owned snapshots, selected snapshots are verified against the route project, stored results are read-only, and snapshot metadata excludes `rootDir`/`storagePath`.
- [ ] T035 [US4] Update `server/src/controllers/project.controller.js` and `server/src/routes/project.route.js` for compatible start and result endpoints; **AC/FR**: API contract start/read sections and FR-024–FR-029; **Done when** `POST /projects/:id/run-analysis` returns `201` new/`200` reused with identical top-level `job` and `data.job`, `needsTests: false`, uppercase status, and `GET /projects/:id/structure-analysis` never starts a scan.
- [ ] T036 [US4] Redesign `server/src/controllers/file.controller.js` and `server/src/routes/file.routes.js` from `rootDir` input to owned `projectId` plus optional `snapshotId`; **AC/FR**: FR-022, FR-023, FR-030 and API contract safe file-list section; **Done when** missing/foreign/rootDir requests are rejected safely and successful responses contain only normalized relative source paths.
- [ ] T037 [US4] Apply `projectScope.service.js` and safe projections to project tree/file-content/snapshot reads in `server/src/services/project.service.js` and `server/src/controllers/project.controller.js`; **AC/FR**: FR-022–FR-023 and authorization matrix; **Done when** owner checks are server-side for every project-derived read and no response exposes host paths, secrets, or source content to a non-owner.
- [ ] T038 [US4] Enforce project-owner authorization and safe fields for job detail/list endpoints in `server/src/services/job.service.js`, `server/src/controllers/job.controller.js`, and `server/src/routes/job.route.js`; **AC/FR**: FR-022–FR-025 and API contract job sections; **Done when** authorization joins `Job -> Project.ownerId`, not only `Job.userId`, and responses omit payload/raw result/absolute paths.

### Frontend API integration and UI

- [ ] T039 [P] [US4] Update `client/src/services/project.service.js` and `client/src/services/job.service.js` for optional snapshot selection, top-level job fields with `data.job` fallback, stored-result reads, and safe status handling; **AC/FR**: FR-024–FR-030 and consumer UX checks; **Done when** the client can start/poll/read an analysis without sending `rootDir` and maps `SUCCESS` only at presentation time.
- [ ] T040 [P] [US4] Update `client/src/components/dashboard/Layout.jsx` and `client/src/components/dashboard/JobQueue.jsx` to retain snapshot selection, display `ANALYSIS` progress, poll uppercase statuses, and show actionable failure while keeping the previous result; **AC/FR**: US4 scenarios 7–10 and consumer UX checks; **Done when** the dashboard defaults to newest snapshot, does not lose selection during polling, and never runs a browser-side scan.
- [ ] T041 [US4] Implement and integrate `client/src/components/dashboard/ProjectArchitecturePanel.jsx`; **AC/FR**: US4 scenarios 1–5 and SC-007; **Done when** the panel renders summary/tree/file metadata, role, direct dependencies, direct dependents, exported functions, diagnostics, and snapshot/result availability from the persisted API response alone.

**Checkpoint**: US4 is complete when T028–T041 pass, owner smoke tests can queue/read a result, repeated active requests reuse one job, and previous successful data survives a queued/running/failed replacement.

## Phase 7: Integration Verification, Documentation, and Final Review

**Purpose**: Verify all quantitative criteria, complete the requested backend/integration quality gates, and document operational recovery and consumer behavior.

- [ ] T042 [P] Add a 1,000-file performance fixture and benchmark test in `server/src/tests/fixtures/project-structure/sc001-1000-files/` and `server/src/tests/projectStructure.performance.test.js`; **AC/FR**: SC-001; **Done when** the automated report records elapsed time and fails when analysis exceeds 30 seconds on the standard test environment.
- [ ] T043 [P] Add conformance/repeatability tests in `server/src/tests/projectStructure.conformance.test.js`; **AC/FR**: SC-003–SC-005, SC-008, SC-009; **Done when** the test verifies the stated function accuracy, mixed-format labels, stable IDs/equivalent edges, and at least 99% remaining-file analysis with diagnostics.
- [ ] T044 [P] Add the ten-user consumer usability protocol and result template in `docs/project-structure-analyzer-usability.md`; **AC/FR**: SC-007 and consumer UX checks; **Done when** the protocol records selected-file role/dependency/dependent/export discovery and requires at least 9 of 10 users to finish within five minutes.
- [ ] T045 [P] Document deployment order, duplicate preflight, concurrent-index failure recovery, feature disablement, and forward-only rollback in `docs/runbooks/project-structure-analysis-migration.md`, cross-linking `server/prisma/operations/project-structure-analysis-index.sql`; **AC/FR**: constitution IV, data-model migration/recovery steps, migration runbook checks; **Done when** an operator can execute enum → schema → index verification → Prisma/application enablement without destructive enum rollback.
- [ ] T046 [P] Document the API compatibility contract and safe response fields in `docs/project-structure-analyzer-api.md` and add owner smoke-test examples to `api.http`; **AC/FR**: FR-023–FR-030 and `contracts/structure-analysis-api.md`; **Done when** examples cover new/reused start responses, polling, stored-result read, snapshot selection, rejected `rootDir`, and owner/non-owner behavior without secrets or host paths.
- [ ] T047 Run the full quality gate and record results in `docs/project-structure-analyzer-verification.md`: `npm test --prefix server -- --runInBand`, `npm run lint --prefix client`, `npm run build --prefix client`, and `npx.cmd prisma validate` from `server/`; **AC/FR**: constitution V–VI and quickstart.md; **Done when** all commands pass or each exception has an explicit cause, impact, and approval reference.
- [ ] T048 Perform final security, compatibility, and scope review across `server/src/services/projectScope.service.js`, `server/src/services/analysisResponse.service.js`, `server/src/routes/project.route.js`, `server/src/routes/file.routes.js`, `server/src/routes/job.route.js`, `client/src/components/dashboard/ProjectArchitecturePanel.jsx`, and `docs/project-structure-analyzer-verification.md`; **AC/FR**: FR-020–FR-030, constitution I–VII, and all acceptance scenarios; **Done when** the review confirms auth middleware/ownership, no path or secret leakage, uppercase statuses, no duplicate active jobs, previous-result preservation, no unapproved dependency, and all story checkpoints are satisfied.

## Dependencies and Execution Order

### Phase dependencies

- **Phase 1** has no prerequisites. T001–T003 can run in parallel.
- **Phase 2** depends on the shared paths from Phase 1. T004 → T005 → T006 → T007 is the required database rollout order; T008–T009 can run in parallel with T004–T006 because they use separate service files, but application enablement still waits for T007.
- **Phase 3 (US1)** depends on T002–T003 and the access/database boundary being accepted. Its tests/fixtures (T010–T012) precede implementation (T013–T016).
- **Phase 4 (US2)** depends on the inventory/parser seam from US1, especially T013–T015. T017–T021 can be prepared in parallel where files do not overlap; T022 integrates them.
- **Phase 5 (US3)** depends on T014 and the analyzer result shape from US1, and uses dependency context from US2. T023–T025 precede T026–T027.
- **Phase 6 (US4)** depends on the pure analyzer output from US1–US3 and T007–T009. T028–T030 are test contracts; backend implementation proceeds T031 → T032/T033 → T034–T038; client work T039–T041 follows the API contract and can be split by file ownership.
- **Phase 7** depends on the desired US1–US4 checkpoints. T042–T046 can run in parallel after the relevant implementation exists; T047–T048 are final gates.

### Story dependency graph

```text
Phase 1
   ↓
Phase 2: schema/migrations + ownership/safe-response boundaries
   ↓
US1 inventory/parser/tree ───────┐
   ↓                             │
US2 roles/dependencies ──────────┼──→ US4 persistence/API/client/UI
   ↓                             │       ↓
US3 function catalog ────────────┘   Phase 7 verification/docs/review
```

US1 and US2 are both P1, but US2 consumes the inventory/parser contract from US1. US3 is P2 and consumes dependency context. US4 is P2 and consumes the complete pure result, while its authorization/migration tests can be authored as soon as the Phase 2 contracts are stable.

## Parallel Execution Examples

### Example A — Phase 1 and Phase 2 preparation

```text
Parallel: T001, T002, T003
Parallel after Phase 1 review: T008, T009
Sequential database rollout: T004 → T005 → T006 → T007
```

### Example B — US1

```text
Parallel: T010, T011, T012
Then: T013 and T014
Then: T015 → T016
```

### Example C — US2 and US3

```text
After US1: parallel T017, T018, T019, T020, T021
Then: T022
After T014/T022: parallel T023, T024, T025
Then: T026 → T027
```

### Example D — US4 and final delivery

```text
Parallel test authoring: T028, T029, T030
Backend sequence: T031 → T032/T033 → T034–T038
After API shape is stable: parallel T039, T040
Then: T041
Final parallel evidence: T042, T043, T044, T045, T046
Then: T047 → T048
```

## Implementation Strategy

### MVP first

1. Complete Phase 1 and the database/access prerequisites in Phase 2, including the reviewed index operation.
2. Complete US1 (T010–T016) and validate the pure analyzer on readable, empty, ignored, nested, and partially unreadable fixtures.
3. Add US2 (T017–T022) and US3 (T023–T027) to make the result useful for architecture and test-generation consumers.
4. Complete the backend half of US4 (T028–T038), then stop for an owner/non-owner API smoke test before UI work.
5. Complete client integration/UI (T039–T041), run the full verification phase, and document deployment/recovery.

### Incremental delivery

- **Increment 1**: US1 pure inventory result; no database writes.
- **Increment 2**: US2 role/dependency graph enrichment.
- **Increment 3**: US3 function catalog enrichment.
- **Increment 4 (MVP product surface)**: US4 persistence, async job API, safe files/jobs/snapshot reads, and dashboard consumer.
- **Increment 5**: benchmarks, conformance evidence, usability protocol, runbook, and final review.

## Completion Criteria by User Story

- **US1**: T010–T016 pass; every supported readable file is represented or diagnosed, no excluded/absolute path leaks exist, and summary/tree counts agree.
- **US2**: T017–T022 pass; recognized roles, `unknown` fallback, module formats, internal/external/unresolved edges, and reverse dependents match the fixture oracle.
- **US3**: T023–T027 pass; catalog records meet the function metadata contract, stable IDs repeat, and dependency context is available without rescanning.
- **US4**: T028–T041 pass; owner-only start/read, safe 404s, snapshot selection, active-job idempotency, result preservation, compatible response shape, polling, and persisted-result UI all work.

## Suggested MVP Scope

The smallest demonstrable MVP is **US1 + the Phase 2 foundation**: a server-resolved snapshot can be scanned into a serializable inventory/tree with diagnostics and deterministic IDs. The first product-ready MVP should include **US1–US4**, because the spec's user-visible value requires persistence, ownership-safe APIs, asynchronous job status, and the dashboard consumer.

## Format Validation

- All 48 implementation tasks use the required `- [ ] T###` checkbox and sequential ID format.
- `[P]` appears only on tasks intended to have no dependency on incomplete tasks and separate file ownership.
- `[US1]`–`[US4]` labels appear on user-story tasks; setup/foundational/polish tasks intentionally use acceptance-criterion references instead.
- Every task names one or more expected files and states a checkable completion condition.
