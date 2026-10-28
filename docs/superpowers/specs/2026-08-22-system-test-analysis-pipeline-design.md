# System Test Analysis Pipeline Design

## Goal

Provide one reliable asynchronous pipeline that detects supported browser E2E
frameworks, selects a safe runner, executes the project's explicitly configured
E2E command, collects results and optional Istanbul coverage, persists outputs,
and always finishes the job in a truthful terminal state.

The pipeline supports Playwright and Cypress. It must not guess how an uploaded
project starts its application: a runnable framework configuration or an
explicitly configured project script is required.

## Scope

The feature includes:

- detecting Playwright and Cypress from package metadata and configuration;
- validating an explicit execution command/configuration before queueing;
- selecting a requested runner or one unambiguous detected runner;
- dispatching a `SYSTEM_TEST_ANALYSIS` job through BullMQ;
- executing Playwright or Cypress with bounded timeouts and streamed output;
- normalising runner reports into `TestRun` data;
- collecting and persisting Istanbul coverage when it exists;
- storing command metadata and parsed results on the job; and
- deterministic failures for missing configuration, ambiguous selection,
  non-zero runner exits, missing/malformed reports, and timeouts.

It does not generate tests, install arbitrary dependencies at execution time,
infer web-server commands, or alter Jest, Vitest, Supertest, coverage, or AI
test-generation behaviour.

## Detection and Selection

Detection reads the snapshot's `package.json`, framework config files, and
scripts. A runner is executable only when both its package dependency and one
of the following are present:

1. a framework config containing an explicit `webServer`/server-start command;
2. a project script explicitly nominated for E2E execution; or
3. a framework config whose documented command is self-contained and requires
   no application server.

The API may supply `runner: "playwright" | "cypress"`. If omitted, the
pipeline selects the only executable detected runner. No executable runner
returns a validation error. More than one executable runner returns a conflict
and requires an explicit selection. The selected command and configuration
path are recorded in job metadata/result data for traceability.

## Execution Flow

1. The API verifies project and snapshot ownership, validates runner selection,
   and creates a `SYSTEM_TEST_ANALYSIS` job.
2. The queue worker marks it `RUNNING`, initialises output, then executes the
   selected runner in the snapshot directory through the existing isolated
   runner abstraction.
3. The runner writes its JSON result report to a pipeline-owned result path.
   Configuration is passed explicitly rather than relying on ambient defaults.
4. The pipeline parses the report into total, passed, failed, skipped, duration,
   status, and start/end timestamps, then persists one `TestRun` record.
5. If standard Istanbul output is present, existing coverage parsers and
   storage are invoked. Absence of coverage is a successful E2E result with a
   documented `coverageAvailable: false`; malformed coverage that is present is
   a failure.
6. The job stores a normalised `resultJson`, reaches 100% progress, and is
   marked `SUCCESS` only after all required persistence succeeds.

`TestType` gains `PLAYWRIGHT` and `CYPRESS`; `JobType` gains
`SYSTEM_TEST_ANALYSIS`. A focused Prisma migration accompanies these enum
changes.

## Failure Semantics

Each failure goes through one idempotent finalisation path. It preserves streamed
stdout/stderr, writes a concise `errorMessage`, records the stage and exit code
where available, and marks the job `FAILED` exactly once. The queue fallback
only acts if a handler left the job non-terminal.

Test failures (a runner exits non-zero but emits a valid report) persist the
failed `TestRun` and then mark the job failed. Startup/configuration errors,
timeouts, and missing/malformed result reports fail without creating misleading
successful test data. No retry is automatic; BullMQ retries are opt-in and must
reuse the same idempotent persistence keys.

## Compatibility and Safety

Existing standalone Playwright/Vitest jobs remain untouched unless the new
pipeline deliberately reuses their low-level command helpers. Existing coverage
tables and Firebase output layout remain the source of truth. The system does
not modify uploaded test projects except for runner report and coverage files
created inside their working snapshot, matching current coverage behaviour.

## Verification

Unit tests cover detection, command validation/selection, Playwright and
Cypress report parsing, and each error mapping. Orchestrator tests mock the
execution adapter, Prisma, storage, and job lifecycle for successful runs,
failing test runs, timeout, missing reports, malformed reports, and coverage
present/absent. Queue tests assert dispatch and fallback behaviour. The server
Jest suite and Prisma validation run after implementation. Browser E2E tests
are not launched by the server test suite; fixture projects are exercised via
mocked runner output to ensure deterministic CI verification.
