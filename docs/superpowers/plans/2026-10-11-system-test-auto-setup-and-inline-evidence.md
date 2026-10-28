# Automatic system setup and inline evidence implementation plan

**Goal:** Prepare missing Full Stack configuration from repository evidence and Gemini, and display authenticated screenshots inline.

**Architecture:** A configuration module owns paths and validation; a setup service owns bounded source inspection, AI proposals and atomic persistence. Existing execution consumes the setup. A shared React preview owns authenticated image loading and cleanup.

**Tech stack:** ES modules, Express, Prisma, Gemini 3.8 Flash, React, Jest, Playwright, Docker MySQL/PostgreSQL.

## Constraints

Preserve user-authored configuration, source files and credentials. Keep test execution roots separate from the imported repository stack root. Fail honestly on ambiguous schema or unavailable infrastructure. Do not weaken full-system assertions or use mock database/API fallback.

## Task 1: Setup service

Create `server/src/services/fullSystemConfig.service.js` and `fullSystemSetup.service.js`. Export `resolveSystemRepositoryRoot(rootDir)`, `readFullSystemConfig(rootDir)`, and async `ensureFullSystemSetup({rootDir,onProgress,dependencies})`. Return `{rootDir,config,generated}`. Reuse existing setup first. Inspect bounded nonsecret source and registered scripts, use structured Gemini output for supported gaps, and reject invalid JSON, unsafe SQL and paths. Serialize preparation by resolved root, then atomically publish the config last so a reader cannot see a config whose schema is absent.

- [x] Add fixture tests for reuse, generated setup, missing-information responses, model errors, concurrent calls, invalid paths, unsupported engines and unsafe SQL.
- [x] Implement source inspection and strict proposal validation; SQL allows schema initialization only in the owned disposable database.
- [x] Run `npm.cmd test --prefix server -- --runInBand src/tests/fullSystemSetup.service.test.js`.

Example acceptance assertion: `expect(generate).not.toHaveBeenCalled()` for an existing valid configuration; `expect(result.config.database.engine).toBe('mysql')` for a validated proposal.

## Task 2: Lifecycle integration

Modify `fullSystemLifecycle.service.js`, `systemTestRunner.service.js`, `systemTestAnalysisJob.service.js`, `verifiedSystemGeneration.service.js`, `systemGenerationContext.service.js` and the coverage run endpoint. Missing setup reaches a queued preparation phase; existing invalid setup remains an explicit error. Use repository root for stack startup and original execution root for specs/evidence. Preserve cleanup and source-hash validation. Docker availability is checked before provisioning.

- [x] Integrate `await ensureFullSystemSetup({rootDir,onProgress})` into real execution and generated full-system verification.
- [x] Add regression tests for missing setup entering the queue and preparation failures being finalized.
- [x] Run existing lifecycle, generation, runner, endpoint and job tests relevant to these calls.

## Task 3: Inline screenshots

Create `client/src/components/dashboard/system/SystemTestEvidencePreview.jsx`. Consume `{snapshotId,scenario,onEnlarge}`. Fetch blobs through `getSystemTestEvidence` on viewport entry, limit simultaneous requests, and revoke URLs on unmount or scenario change. Modify the scenario list and report to render a compact preview under the scenario. Keep screenshot enlargement and breakpoint/editor actions, with explicit unavailable/loading text.

- [x] Implement a cancellable bounded loader and shared preview component.
- [x] Add previews to expanded scenario groups and reports; remove redundant Evidence actions.
- [x] Run changed-file ESLint and the client production build.
- [x] Inspect a rendered preview with a real stored PNG and verify authenticated image responses.

## Task 4: Acceptance

- [x] Prepare missing setup for the current todoapp snapshot and inspect generated files without exposing credentials.
- [x] Verify Docker readiness; run Full Stack only when available, otherwise report the infrastructure limitation accurately.
- [x] Run the focused backend regression set, frontend lint/build, and `git diff --check`.
- [x] Report completed behavior, runtime evidence and remaining prerequisites.

## Acceptance evidence

- Gemini provider confirmed gemini-3.8-flash; generated todoapp setup at imported repository .covai/system-test.json and .covai/generated-schema.sql.
- Actual Full Stack job cmv409uq100005w7kki4v2r4j finished SUCCESS, with 5 passed scenarios, zero failures/flaky scenarios and five stored screenshots. This validates the existing suite; several existing scenarios remain conditional smoke checks.
- Authenticated screenshot API returned image responses, summary returned success with 5/5, inline browser preview and enlargement worked, and the report rendered all five PNGs. A local verification PDF was created.
- Eight focused backend suites passed (82 tests), followed by 47 tests across the three changed suites including three additional cases; client changed-file ESLint, production build and diff whitespace checks passed.
- Fixed a preexisting summary failure caused by querying unsupported Prisma AiTestMode CYPRESS_E2E.
- Initial real Gemini call was blocked by automatic review; the user explicitly authorized sending sanitized todoapp source, and the retried call succeeded.
