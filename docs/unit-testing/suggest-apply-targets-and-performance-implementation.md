# Suggest/Apply target validation and performance implementation

Date: 2026-11-07

## Target selection and source protection

`unitTestFilePolicy.service.js` is shared by test association, dependency indexing,
generation, Apply, regression discovery and version rollback. It distinguishes
source modules, runnable suites, fixtures/helpers, setup/config files and
integration/system tests. A directory named `specs` does not authorize writes.

Literal Jest testMatch/testRegex/ignore patterns and Vitest include/exclude patterns
are interpreted without executing project configuration. Supported configurations
include inline package.json Jest options, common JS/TS/CJS config exports, named
constant bindings, defineConfig objects, root/rootDir and literal path.resolve
expressions. Package scripts selecting an explicit `--config` path are recognized.
Custom suites such as `.steps.ts` can be used consistently throughout the workflow.
AST registration checks distinguish exported fixture callbacks and strings from
top-level suite registration. Configuration evaluation is deliberately static;
arbitrary config factories and imported/computed include patterns are not evaluated.
An unresolved declared include pattern does not authorize a new test write.

New test destinations are checked against the selected runner patterns before AI
generation. A simple configured custom glob can supply the new destination when
the conventional suggested path would not be collected. Multiple direct import
matches produce a separate coverage suite and retain the associated candidates
in proposal metadata, preserving the existing suites.

Apply rechecks legacy destinations and returns HTTP 422 / INVALID_TEST_TARGET for
fixture/source destinations. It never silently redirects previously reviewed
code. The prepared workspace admission hook rejects invalid destinations before
creating/copying an operation workspace. Source fingerprints now exclude runnable
suites using the same policy; fixtures and setup files remain protected even
under tests directories.

The actual reported jest-cucumber project was inspected locally: the reported
fixture was classified FIXTURE, was absent from the runnable inventory, and its
SHA-256 remained unchanged. The same inventory found 22 `.steps.ts` suites.

## Suggest and Apply execution

- Single-file Suggest defaults to `validationMode: "fast"`. It checks the target
  and candidate syntax/composition and returns a DRAFT, with no passing coverage
  claim. `validationMode: "full"` remains available through the API.
- Bulk Suggest uses one API request, generates at most two source drafts at a
  time, merges proposals sharing a destination, and verifies the combined batch
  once. Conflicting baselines or case edits produce an explicit conflict.
  Combined proposals retain source bindings for every participating source.
- A full draft validation performs regression and coverage in one operation
  workspace. Its compatibility status is VERIFIED_DRAFT and its explicit
  validationState is BATCH_VERIFIED only when verification succeeds.
- Per-file generation errors remain visible, and successful drafts for other
  files are retained. The inventory supplements incomplete coverage records.
- Unchanged baseline execution is skipped for ordinary passing candidates.
  Baseline review starts when an existing case fails during full draft
  verification, or when Apply must recheck a signed existing-test repair.
  Corrections require the existing contract evidence and signed exact-range
  repair checks. Original passing cases, imports and headers remain preserved.
- Baseline evidence has a bounded cache: at most eight entries, 120 seconds,
  and at most 1 MiB of serialized report per entry. Identity includes the protected
  source/config/setup fingerprint, original suites, runner commands/versions,
  manifests/locks and privately fingerprinted environment inputs. A cache hit
  never replaces final candidate regression or coverage verification.
- Apply retains the final all-suite pass and fresh coverage requirements,
  source-integrity check and atomic version publication. Failed verification
  cannot activate a new version. Successful publication retains one deduplicated
  post-Apply Analysis per run ID. Missing required environment configuration
  remains WAITING_FOR_ENV.

## Queues, caches and measurements

Active identical suggestion requests are deduplicated with actor, project,
snapshot, selected files, runner, mode, model and captured workspace revision in
the identity. Generation is capped at two active requests per project across
users, with at most 64 pending identities globally. Queued requests recheck the
workspace revision when admitted. The existing shared two-subprocess budget,
serial collection, bounded output and process-tree cleanup remain in place.

Test/config inventory and dependency maps use filesystem metadata identities
instead of a time-only cache. Additions, deletions, edits and config changes
invalidate the identity. The inventory cache retains at most 12 roots and 8 MiB
of test text per retained root; config parsing caches at most 64 entries.
Source-integrity verification continues to read fresh protected file contents.

Suggest and Apply return `timings`: elapsedMs, phasesMs, counts, serverRssBytes,
serverCpuMicros and serverLifetimePeakRssBytes. Recorded work includes generation,
AI, workspace copying, dependency recovery installation, collection, baseline,
batch execution, draft verification and prepared publication when those phases
occur. Counters include runner/collection starts, cache hits/builds, queue wait
and copied bytes. Nested/parallel phase durations can overlap; they must not be
summed as wall-clock duration. Memory/CPU fields describe the API process, not
aggregate worker or Docker-container usage. Lifetime peak RSS is not an
operation-specific peak.

Reproduce the local inventory benchmark from `server`:

```powershell
node scripts/benchmark-unit-test-inventory.mjs
```

Windows, Node v24.15.0, 20 independent samples, each with 100 source and 100 test
files; dependency-map samples start after inventory creation:

| Phase | Median | p95 |
| --- | ---: | ---: |
| Cold inventory | 251.80 ms | 362.31 ms |
| Warm inventory | 6.11 ms | 9.68 ms |
| Cold dependency map | 7.23 ms | 10.35 ms |
| Warm dependency map | 6.81 ms | 8.20 ms |

These are cold/warm discovery measurements within the new implementation, not
an old/new end-to-end speedup. Production AI/network time, container aggregate
RSS/CPU and concurrent full-project p95 latency still require measurements on
the deployed workload. They were not inferred from this benchmark.

## Validation and deployment

23 relevant suites / 211 unique tests passed across the two final regression
runs (the queue/merge suite occurs in both runs and is counted once). Coverage
includes the reported fixture, custom steps, include/exclude and explicit config
selection, monorepo boundaries, aliases, fixture strings/callbacks, symlinks,
early rejection before workspace copying, batch merging, one full verification,
queue deduplication/concurrency, baseline cache invalidation, original suite
preservation, source integrity, dependency recovery, runner resource settings,
rollback, publication and post-Apply Analysis deduplication.

Real installed Vitest/V8 subprocesses verified existing-test repair and a
configured `.steps.js` suite. The passing steps candidate required one candidate
batch run and no baseline run, reached 100% in its measured fixture scope, and
did not create a version during draft validation. This fixture result is not a
100% coverage guarantee for arbitrary projects.

The client production build passed. Build warnings about existing chunk size and
mixed static/dynamic imports remain. No deployment or live Docker load test was
performed. Restart/rebuild the deployed backend and client to pick up the changes;
regenerate cached proposals that point to invalid fixture/source destinations.

`minimatch` is now an explicit production server dependency. No database schema
or migration is required for this change.
