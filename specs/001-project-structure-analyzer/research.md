# Research: Project Structure Analyzer

**Feature**: [spec.md](./spec.md)  
**Date**: 2026-08-04

## Decision 1: Extend the existing analysis worker, not a parallel pipeline

**Decision**: Replace the stub implementation in `server/src/services/analysisJob.service.js` with the structure-analysis pipeline and reuse the existing `ANALYSIS` case in `queue.service.js`.

**Rationale**: The worker dispatch branch and job lifecycle seam already exist. A new queue or worker would duplicate Redis/BullMQ configuration, logs, notifications, and status polling.

**Alternatives considered**:

- A separate queue/worker was rejected because it duplicates operational behavior.
- A synchronous endpoint was rejected because the feature must process up to 1,000 files asynchronously.

## Decision 2: Persist a latest-result read model separately from jobs

**Decision**: Add `ProjectStructureAnalysis`, unique by snapshot, for the full serialized graph. Keep `Job` for lifecycle, compact result reference/summary, logs, errors, and notifications.

**Rationale**: Jobs are historical operational records; a unique result row enables a stable read path and leaves the previous completed result intact if a later job fails.

## Decision 3: Use snapshot-scoped authorization for every feature file/job read

**Decision**: Resolve a project and optional snapshot through `Project.ownerId = req.user.id` in the service layer. Apply it to snapshots, editor tree/file content, `GET /api/files`, job detail, user jobs, project jobs, analysis start, and persisted-result read.

**Rationale**: Authentication alone and `Job.userId` alone do not establish current ownership. The server-owned snapshot is the only filesystem boundary.

**Alternatives considered**:

- Trusting client `rootDir`, `snapshotId`, or `userId` was rejected because it allows filesystem/tenant boundary bypasses.
- Authorizing job detail by `Job.userId` alone was rejected because it does not prove current project ownership.

## Decision 4: Redesign the existing files-list API without arbitrary paths

**Decision**: Keep `GET /api/files` but replace `rootDir` with required `projectId` and optional `snapshotId`. The server selects the newest owned snapshot when omitted and returns normalized relative paths only.

**Rationale**: The prior parameter can point at any server-readable directory. Relative paths are the only safe stable client contract for a snapshot.

**Compatibility impact**: This is an intentional breaking change for callers of the old arbitrary-path endpoint. No current client usage was found; route tests and API documentation must cover the replacement contract. Requests containing `rootDir` are rejected rather than silently honored.

## Decision 5: Keep `run-analysis` response-compatible while changing it to static analysis

**Decision**: Retain `POST /api/projects/:id/run-analysis`, remove the Jest prerequisite, and return both new fields (`job`, `reused`) and legacy fields (`data.job`, `needsTests: false`, `snapshotId`).

**Rationale**: The current client reads `data.job` and `needsTests`. A dual response lets the client transition without a response-shape break while the endpoint changes from test/CFG orchestration to the specified static analysis.

**Alternatives considered**:

- A v2 endpoint was rejected by product decision.
- A new start URL was rejected by product decision.
- A response-only breaking replacement was rejected because existing client code would dereference `data.job`.

## Decision 6: Keep uppercase job status as the stable API contract

**Decision**: Database and API use `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, and `CANCELED`. UI/documentation may call `SUCCESS` “completed”, but no second lifecycle status field is added.

**Rationale**: This matches existing Prisma data and job UI behavior and avoids a status breaking change.

## Decision 7: Scope analysis deduplication by project, snapshot, and type

**Decision**: Add an analysis-specific active-job lookup keyed by `(projectId, snapshotId, type)` and a matching PostgreSQL partial unique index for active `ANALYSIS` jobs only.

**Rationale**: The generic helper currently scopes by project/type and would incorrectly block simultaneous analyses of different snapshots. The service check provides normal idempotency; the index closes races.

## Decision 8: Use forward-only PostgreSQL enum migration and operational index creation

**Decision**: Add `ANALYSIS` in a committed enum-only migration first. Apply schema/table changes next. Create the unique partial index with `CREATE UNIQUE INDEX CONCURRENTLY` outside a transaction after a duplicate preflight; enable the feature only after success.

**Rationale**: PostgreSQL cannot safely remove enum values in a normal rollback, and an enum value should not be used in the same transaction that introduces it. A regular index build can block production writes; concurrent creation avoids that lock profile.

**Recovery**:

- If a later step fails after enum expansion, leave the additive value in place, keep feature code disabled, and forward-fix.
- If concurrent index creation fails, inspect/drop any invalid index, resolve active duplicates if present, then rerun it.
- Operational rollback is code rollback/feature disable. Do not automatically drop the enum value, table, or index; destructive cleanup is a separately approved migration with backup.

## Decision 9: Reuse Babel and existing test placement conventions

**Decision**: Extend `babelParser.service.js` and `functionExtraction.service.js` with the installed Babel packages. Extend the colocated Babel test; use `server/src/tests` for scanner, job, route, and feature integration tests.

**Rationale**: This avoids a second parser/extractor and follows the actual mixed-but-established test placement in the repository.

## Decision 10: Make every measurable success criterion executable

**Decision**: Use benchmark/conformance fixtures for SC-001, SC-004, SC-005, SC-008, and SC-009, plus a ten-user usability protocol for SC-007.

**Rationale**: Existing generic unit tests do not prove thresholds, repeatability, or user discoverability.
