# Implementation Plan: Project Structure Analyzer

**Branch**: `001-project-structure-analyzer` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)

## Summary

Implement a static project-structure analyzer for a server-owned `ProjectSnapshot.rootDir`. It scans supported JavaScript/TypeScript files without executing them, builds the specified graph/tree and function catalog, and persists one latest successful result per snapshot.

The feature reuses the existing Express route -> controller -> service layers, Prisma/PostgreSQL, the existing BullMQ `ANALYSIS` dispatch branch, Babel, and dashboard job polling. `POST /projects/:id/run-analysis` remains the start URL, but becomes the static-analysis operation. Its response is deliberately backward-compatible with the current client (`data.job`, `needsTests: false`, and `snapshotId`) while also exposing the new top-level `job` and `reused` fields. The full result has its own read endpoint.

## Technical Context

**Language/Version**: JavaScript ES modules on the server; React 19/Vite client.

**Primary Dependencies**: Existing `@babel/parser`, `@babel/traverse`, Express, Prisma 7, PostgreSQL, BullMQ, Redis/ioredis, Jest, React, and existing fetch utilities. No new runtime dependency.

**Storage**: PostgreSQL. Add a one-row-per-snapshot `ProjectStructureAnalysis` read model and `ANALYSIS` to `JobType`. The result is written only after successful analysis; `Job` retains operational state and a compact payload.

**Compatibility**: Database/API status values remain `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, and `CANCELED`. “completed” is a UI label for `SUCCESS`, not another persisted/API state. The legacy response fields for `run-analysis` remain during this feature rollout.

**Security constraints**: The worker receives only a server-resolved snapshot root. All file and job reads are authenticated and project-owner-scoped. Public responses never expose `rootDir`, `storagePath`, source text, environment contents, or absolute host paths.

**Performance goals**: A 1,000-source-file fixture completes within 30 seconds; literal-relative resolution and function-metadata fixtures meet the specified accuracy thresholds; one unreadable/malformed file does not stop the remaining analysis.

## Constitution Check

- **I. Existing Architecture First — PASS**: Existing routes/controllers/services, worker, Prisma, and client patterns are extended; no parallel queue is introduced.
- **II. Authentication and Ownership — PASS WITH EXPLICIT COVERAGE**: Every analysis/file/job read path uses `authMiddleware` and a project-owner query; `job.userId` alone is never authorization.
- **III. Secrets Never Cross Boundaries — PASS**: Snapshot and analysis responses omit local/storage paths; analyzer output uses normalized relative paths only.
- **IV. Backward-Compatible Data Evolution — PASS WITH EXPAND-ONLY ROLLOUT**: Enum addition is forward-only; automated rollback never removes an enum value. Deployment is gated on the concurrently created active-job index.
- **V. Verifiable Outcomes — PASS**: Fixture benchmarks, response compatibility tests, authorization matrices, and usability protocol cover measurable requirements.
- **VI. Required Quality Gates — PASS**: Server Jest, client lint/build, Prisma validation, reviewed SQL, and migration runbook checks are mandatory.
- **VII. Dependency Discipline — PASS**: Existing parser, queue, and UI dependencies suffice.

## Project Structure

```text
server/
├── prisma/
│   ├── schema.prisma
│   └── migrations/<timestamp>_add_project_structure_analysis/
│       └── migration.sql
└── src/
    ├── routes/project.route.js
    ├── routes/file.routes.js
    ├── routes/job.route.js
    ├── controllers/project.controller.js
    ├── controllers/file.controller.js
    ├── controllers/job.controller.js
    ├── services/
    │   ├── project.service.js
    │   ├── analysisJob.service.js              # replace existing stub lifecycle
    │   ├── job.service.js
    │   ├── queue.service.js                    # reuse existing ANALYSIS case
    │   ├── babelParser.service.js
    │   ├── functionExtraction.service.js
    │   ├── fileDiscovery.service.js
    │   ├── projectStructureAnalyzer.service.js # new orchestrator
    │   ├── projectStructureRoles.service.js    # new
    │   ├── projectStructureDependencies.service.js # new
    │   └── projectStructureTree.service.js     # new
    ├── services/babelParser.test.js             # extend colocated test
    └── tests/
        ├── fileDiscovery.test.js                # extend existing test
        ├── functionExtraction.test.js           # new focused test
        ├── projectStructureAnalyzer.test.js     # new fixture test
        ├── projectStructureJob.test.js          # new service/integration test
        └── projectStructure.route.test.js       # new route test

client/src/
├── services/project.service.js
├── services/job.service.js
└── components/dashboard/
    ├── Layout.jsx
    ├── JobQueue.jsx
    └── ProjectArchitecturePanel.jsx             # new
```

`GET /projects/:id/tree` remains the editor tree. The existing generic `GET /api/files` changes from an arbitrary `rootDir` reader to a project/snapshot-scoped source-file listing and returns relative paths; it is not used as the analyzer’s persistence API.

## Phase 0 — Confirmed decisions

1. Extend the existing `analysisJob.service.js` stub and the existing `ANALYSIS` worker case; do not add a worker, queue, or second analysis pipeline.
2. Use `ProjectStructureAnalysis` as the latest-result read model and `Job` as operational history.
3. Keep `POST /projects/:id/run-analysis` and use its additive compatibility response. It no longer requires Jest or initiates `RUN_TESTS`/`BUILD_CFG`.
4. Keep uppercase job status values stable in database/API; map `SUCCESS` to “completed” only in presentation.
5. Replace `GET /api/files?rootDir=...` with `GET /api/files?projectId=...&snapshotId=...`; `snapshotId` defaults to the newest owned snapshot and `rootDir` is rejected.
6. Omit both `rootDir` and `storagePath` from all snapshot/list responses. They are internal implementation details and may be absolute host paths.

## Phase 1 — Design and contracts

### Authorization and read-boundary design

1. Keep `authMiddleware` on all project, file, and job routes. Add a shared project-scoped resolver in the service layer that receives `projectId`, optional `snapshotId`, and `req.user.id`; it returns only an owned snapshot or a user-safe not-found result.
2. Use that resolver for start/read structure analysis, snapshot listing metadata, project tree, file content, and the redesigned `GET /api/files`. The file route accepts no filesystem path from the client and returns normalized relative paths only.
3. Authorize `GET /job/:jobId`, `GET /job/user`, and `GET /job/:projectId/jobs` through `Job -> Project.ownerId`, not merely `Job.userId`. Return only safe job fields, logs, and compact result data; non-owners receive the same not-found shape as a missing resource.
4. Ensure the new structure-result route performs its own owner + snapshot ownership check even when called after a successful job poll. No client-provided project, snapshot, room, or user identifier is trusted.
5. Remove `rootDir` and `storagePath` from `GET /projects/:id/snapshots` and any new result metadata. Retain only selector-safe fields such as id, source, checksum/commit SHA, created time, and structure-result availability/version.

### Data and migration design

1. Add `ANALYSIS` to `JobType`, `ProjectStructureAnalysis`, the optional `ProjectSnapshot.structureAnalysis` relation, and query indexes described in [data-model.md](./data-model.md).
2. Use an expand-only PostgreSQL rollout in three ordered release operations:
   1. Commit a standalone enum migration, `ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ANALYSIS'`. Do not use the value in the same transaction.
   2. After that migration commits, apply the Prisma migration that adds the analysis table, relation, and ordinary supporting indexes.
   3. Run a reviewed operational command outside a transaction to create the active-analysis unique partial index with `CREATE UNIQUE INDEX CONCURRENTLY`; preflight for duplicates and keep the start endpoint disabled until it succeeds.
3. The partial unique index is scoped to `(projectId, snapshotId, type)` only when `type = 'ANALYSIS'`, `snapshotId IS NOT NULL`, and status is `QUEUED` or `RUNNING`. It permits concurrent analyses of different snapshots and re-analysis after terminal states.
4. Document lock/recovery behavior: concurrent index creation avoids table-write blocking but can fail and leave an invalid index; inspect/drop that invalid index, resolve duplicate active rows if any, and rerun. If a later migration step fails after enum expansion, leave the additive enum value in place, keep feature code disabled, and forward-fix; do not attempt automatic enum-value removal.
5. Operational rollback is code rollback/feature disable after stopping or failing active analysis jobs. Leave the unused enum/table/index intact. Any later destructive cleanup requires an approved, separate data migration with backup and explicit enum recreation plan.
6. Deploy in order: database enum -> schema/table -> concurrent index verification -> Prisma client/application -> enable route/worker. Verify previous application versions remain functional during every database-only stage.

### Analyzer engine and job integration

1. Extend `fileDiscovery.service.js` only through a snapshot-bound API used by the analyzer; preserve a clear boundary between safe relative-path discovery and the redesigned file-list HTTP contract. It must include `.mjs`/`.cjs`, exclusion rules, per-file diagnostics, and no absolute paths in returned data.
2. Extend the existing Babel parser and function extraction services for ESM/CommonJS/JSX/TypeScript, stable identifiers, parameters, source ranges, async state, and export visibility. Do not introduce another parser or duplicate extractor.
3. Add role, dependency-resolution, and tree-aggregation services, then compose them in the new pure `projectStructureAnalyzer.service.js` orchestration boundary. It returns one serializable result and does not write the database.
4. Replace the existing `analysisJob.service.js` stub with the staged scanner -> parser -> catalog -> dependency -> tree worker. Reuse the existing queue `ANALYSIS` case and generic job lifecycle functions.
5. Implement an analysis-specific active-job lookup/creator keyed by `(projectId, snapshotId, type)`. Do not use the existing project-wide `assertNoActiveJob` helper for `ANALYSIS`. On unique violation, re-read and return the active job.
6. Upsert `ProjectStructureAnalysis` only after the complete result is built, then mark the job `SUCCESS` with a compact reference/summary. On failure, mark `FAILED` and preserve the previous row.

### API and client compatibility design

1. Preserve `POST /projects/:id/run-analysis`; accept optional `snapshotId`; remove the Jest prerequisite; queue `ANALYSIS` rather than `RUN_TESTS`/`BUILD_CFG`.
2. New-job response is `201`; reused active job is `200`. Both include top-level `job` and `reused`, plus legacy `data.job`, `needsTests: false`, and `snapshotId`. The duplicated job representation is temporary compatibility surface and must remain identical.
3. Add `GET /projects/:id/structure-analysis?snapshotId=...`; it only reads a completed result and never starts analysis.
4. Preserve API/database status values as uppercase. The client maps `SUCCESS` to a completed visual state; no lowercase lifecycle value is added.
5. Update client callers to pass an optional snapshot, read top-level fields first with `data.job` fallback during transition, render the `ANALYSIS` label, and fetch the persisted result after `SUCCESS`.

### Verification design

1. Extend `server/src/tests/fileDiscovery.test.js` for exclusions, relative paths, rejected arbitrary-path HTTP inputs, and owned/default/foreign snapshot behavior. Extend colocated `server/src/services/babelParser.test.js`; add focused analyzer/job/route tests under `server/src/tests`.
2. Add authorization matrix tests for owner, non-owner, anonymous, missing project/snapshot/job, and cross-project snapshot for: snapshots, tree, file content, `GET /api/files`, job detail, user jobs, project jobs, analysis start, and stored-result read. Assert owner-safe 404 responses and no paths/result metadata leak.
3. Add migration tests/runbook checks for enum-first ordering, schema compatibility, partial-index preflight, race recovery, failure recovery, and the fact that code rollback does not remove existing data or enum values.
4. Add a 1,000-file benchmark fixture for SC-001 with a 30-second ceiling; record elapsed time in the automated test/report.
5. Add conformance fixtures/oracles: at least 95% correct named-function metadata for SC-004; 100% detectable ESM/CommonJS file labels and project `Mixed` for SC-005; deterministic IDs and equivalent graph edges across repeated unchanged runs for SC-008; and one malformed/unreadable file while at least 99% of remaining readable files are analyzed for SC-009.
6. Run a documented usability protocol for SC-007: ten representative users receive a selected file and must locate role, direct dependencies, direct dependents, and exported functions using the consumer view alone; at least nine finish within five minutes.
7. Run server Jest, client lint/build, `npx.cmd prisma validate`, reviewed migration SQL/runbook, and manual owner/non-owner dashboard checks from [quickstart.md](./quickstart.md).

## Constitution Check — Post-Design

- **I. Existing Architecture First — PASS**: The existing queue branch and stub are extended in place; route/controller/service seams remain intact.
- **II. Authentication and Ownership — PASS**: The design now covers all feature-related file/job read paths and uses project ownership as the server-side authority.
- **III. Secrets Never Cross Boundaries — PASS**: Internal filesystem/storage fields are excluded from API responses and analyzer output.
- **IV. Backward-Compatible Data Evolution — PASS**: Additive deployment, enum-first sequencing, concurrent-index runbook, and forward recovery protect legacy data.
- **V. Verifiable Outcomes — PASS**: Every quantitative success criterion has a named fixture, benchmark, or usability protocol.
- **VI. Required Quality Gates — PASS**: Required build, tests, Prisma validation, SQL review, and operational migration verification are explicit.
- **VII. Dependency Discipline — PASS**: No dependency is added.

## Complexity Tracking

No new architectural pattern is introduced. The dedicated result model, analysis-specific concurrency helper, and operational concurrent-index step are required to preserve result history, snapshot-level concurrency, and safe production migration behavior.
