# Suggest and Apply target validation and performance plan

Date: 2026-11-07
Status: Core fixes implemented and regression-tested; production end-to-end measurements pending.

Implementation details, validation evidence and local benchmark results:
[Suggest/Apply target and performance implementation](suggest-apply-targets-and-performance-implementation.md).

## Observed failure

Apply rejected `specs/test-data/validation-and-code-generation.ts` as a source file.
The inspected project is jest-cucumber. Its Jest configuration selects
`**/*.{steps,test}.ts`. The failing file contains exported Gherkin strings and
fixture functions. Its directory and calls named `test` do not establish that it
is a runnable test suite.

The current components disagree.

- `businessLogicFileDetector.js` treats `specs`, fixtures and test-data directories
  as test-related paths for coverage exclusion.
- `fileCoverage.service.js` accepts paths under `specs` as an existing test and
  can return them with `relationType: SELF`. Other matching paths also use broad
  directory/import/name heuristics.
- `applyTestSuggestion.service.js` permits conventional test suffixes or files
  under `test`, `tests`, `__tests__`, or singular `spec`. It rejects plural `specs`
  without a recognized suffix and does not consistently support `*.steps.ts`.
- Suggest can therefore assemble, review and verify an invalid write target
  before Apply rejects it.

Expanding the Apply directory expression alone would leave fixture selection
incorrect and would authorize writes to data/helper modules.

## P0. Share target classification and fail early

1. Introduce one file-role result shared by association, generation, preview,
   Apply, regression discovery and version rollback. Distinguish source, runnable
   test, fixture, helper, setup/config and unknown. Keep broad test-related
   exclusion separate from permission to write generated tests.
2. Discover runnable suites using the selected runner configuration and package
   root. Honor Jest testMatch/testRegex/ignore patterns and Vitest include/exclude
   patterns. Use installed-version-supported listing commands where available.
   Do not execute test bodies for discovery. Cache the resulting inventory.
3. Accept explicitly configured custom suites such as `*.steps.ts`. Use AST
   registration/import evidence as supplementary information. Exported fixture
   functions and strings containing test syntax must not establish writability.
4. Select associated targets only from the runnable inventory. Prefer a direct
   source import and the correct package/framework. Ambiguous matches become
   review items instead of selecting the highest name score automatically.
5. If no existing suite matches a real source module, propose a new conventional
   test path in that package. Verify that the selected runner will collect it.
   A fixture selected as the source is outside the unit generation scope and
   should return an explicit diagnostic.
6. Validate both source and destination before capturing a proposal base, calling
   AI, copying a workspace or starting a baseline run. Store the canonical target,
   runner, package and classification evidence in the proposal. Preview and Apply
   must use the same assembled candidate and target.
7. Validate legacy cached proposals again at Apply. Invalid fixture/source targets
   return HTTP 422 with `INVALID_TEST_TARGET` and require regeneration. Do not
   silently redirect already reviewed code to another file.

Expected result for the reported file: classify it as fixture data, retain its
bytes, and suggest changes only to an applicable runnable suite for the selected
business source. A valid configured `.steps.ts` suite remains eligible.

## P1. Make Suggest fast and batch-aware

Current costs include collection retries, per-file operation copies, unchanged
baseline execution and full regression/coverage during every draft validation.
Bulk Suggest starts four file requests. Each request can independently repeat
these steps. Measure phase durations before assigning a latency improvement.

1. Build one source/test/import/config inventory per project revision and share
   it across the bulk operation. Reuse parsed ASTs within that revision.
2. Generate additions against the original suite and preserve its contracts.
   Merge proposals sharing a test target into one candidate before collection.
   Detect conflicting setup/import edits before invoking a runner.
3. Split validation states into DRAFT, TARGET_CHECKED, BATCH_VERIFIED and explicit
   blocked/failed states. AST/config/target checks are the fast path. Optional
   target-only execution provides feedback but cannot establish a full passing
   regression batch or authoritative project coverage.
4. Run unchanged baseline analysis only when an existing failing case needs a
   repair decision. Multiple candidates from one immutable baseline share its
   result. The cache identity must include source/test contents, runner version,
   configuration, setup files, dependency lock/manifests and a private environment
   fingerprint. A mismatch invalidates reuse. Keep cache size and lifetime bounded.
5. For a fully verified draft, collect and verify the combined batch once in an
   isolated workspace instead of verifying the entire project once per file.
6. Bound repairs by error category and stop after the same error fingerprint,
   failed dependency recovery, resource failure or absent coverage improvement.
   Record a stop reason. Keep all unresolved coverage gaps visible.

## P2. Reduce Apply repetition and preserve publication guarantees

1. Stage a deduplicated batch in one operation workspace and resolve dependencies
   once per package. Avoid repeatedly scanning and parsing unchanged files.
2. Check proposal revision, candidate hashes, target classification, runner
   configuration and setup requirements before running tests.
3. Start with target/affected suites when a diagnostic run is useful. Perform
   the final complete regression and fresh coverage verification once before
   publication. Rerun after any candidate repair.
4. Preserve source integrity checks, baseline-backed repairs to existing tests,
   all-file pass requirements and atomic version publication. A cached report
   alone cannot authorize publication after relevant inputs change.
5. Retain the user-requested full Analysis after successful Apply. Schedule one
   job for the published run ID and reuse that operation on HTTP retries. Remove
   duplicate client-triggered scheduling and unrelated repeated refresh requests.

## P3. Keep execution within the memory budget

The existing process-tree cleanup, single collection worker, 512 MiB collection
heap and shared two-subprocess limit remain the starting resource policy.

- Put bulk generation behind a project-level queue. Deduplicate identical active
  requests and show queued/running phases rather than opening additional pools.
- Separate AI/network concurrency from CLI concurrency. Increasing AI request
  concurrency must not increase simultaneous test runners.
- Use supported runner flags to disable watch mode and limit workers. Account
  for all workers across active jobs, not only each individual command.
- Cancel obsolete work and terminate its owned process groups. Cap captured
  output, cache size and retained artifacts.

## Verification and acceptance

Required regressions cover the exact fixture path, configured `.steps.ts` suites,
ordinary tests under `specs`, custom config selection, monorepo package roots,
fixture strings/exported callbacks, helper/setup files and legacy proposals.
Keep traversal/symlink protection and existing suite preservation checks.

Performance comparisons use the same revision, dependencies, environment and
test inventory for cold and warm runs. Record inventory/AST, queue wait, AI,
workspace preparation, dependency install, collection, baseline, verification,
coverage merge and publication timings. Also record runner starts, copied bytes,
peak RSS, CPU and worker counts. Compare end-to-end median and p95 only after
collecting enough equivalent runs.

Acceptance requires all of the following.

- The reported fixture is never selected as a generated-test write destination.
- Configured custom suites can be suggested, reviewed and applied consistently.
- Correct existing tests and fixture data remain intact.
- Invalid targets are rejected before expensive work and identify the reason.
- A bulk operation does not repeat a complete baseline for every file.
- Apply creates a version only after the final batch verification passes.
- One post-Apply Analysis is scheduled per published run.
- Runner counts stay within the configured budget and completed/canceled work
  leaves no live workers.
- Reduced latency is demonstrated with measured phase timings and equivalent
  coverage/verification requirements. No percentage speedup is assumed in advance.

## Delivery order

Implement P0 first and verify the reported project fixture. Then add phase timing
and the P1 inventory/batch changes. Apply the P2 execution reductions and finish
with concurrent load measurements for P3. Ship each phase with its specific
regressions and measured results. The implementation record above distinguishes
completed local checks from production measurements that remain outstanding.
