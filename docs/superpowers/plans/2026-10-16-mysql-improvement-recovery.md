# MySQL improvement recovery and focused status UI

**Goal:** Repair the reported pre-AI database startup failure and remove distracting status text while retaining useful progress, evidence and diagnostics.

**Design:** Keep existing automatic isolated setup, verified coverage checks and the default 95% objective. Probe real service readiness with a wall-clock budget, inspect container state on failure, preserve redacted diagnostics before cleanup and distinguish runtime setup failures from operation deadlines/provider failures. Do not alter Docker data or application source to bypass failing tests. Main UI shows one concise status, stage/time while running, and verified changes when available. Usage, target details and failure diagnostics live under Details. Hide unmeasured coverage/zero-request telemetry after setup failure.

**Risk:** Local disposable service orchestration; no database schema or public authorization changes. Keep generated-resource ownership and cleanup strict, signal cancellation responsive and credentials redacted.

- [x] Diagnose the actual failed job and Docker/MySQL runtime; reproduce with isolated resources when infrastructure permits.
- [x] Test and implement bounded readiness diagnostics, cancellation and cleanup; classify setup failures independently of AI request errors and the global deadline, including historical display normalization.
- [x] Simplify assessment/review/progress UI using existing tokens. Keep English copy and actionable failure state; hide empty goal/usage panels and move technical details behind disclosure.
- [x] Run focused regression suites, browser tests at desktop/mobile widths, inspect screenshots, and verify actual isolated MySQL startup/query/cleanup. Record any unavailable real provider verification explicitly.

## Diagnosis and implementation notes

The reported job `cmvanryyp0000uw7kio0u8rq8` failed before any AI request after 113 seconds. The old resource loop used 90 probe attempts and discarded startup diagnostics. Its service-specific HTTP 408 was incorrectly treated as the global twenty-minute deadline. Docker Desktop subsequently reported a stopped engine and WSL/dockerd input/output/read-only-mount errors. A normal Desktop restart recovered the engine; no reset, configuration replacement or volume pruning was performed. CovAI's existing Redis container was restarted after that recovery.

MySQL readiness now has a wall-clock budget (up to three minutes for cold initialization), executes a real authenticated query, detects stopped/OOM containers or an unavailable engine, captures redacted probe/container logs before cleanup and propagates cancellation. Cleanup includes only each generated container and its anonymous volumes. MySQL initialization is not equivalent to a running container: see the [official image entrypoint](https://github.com/docker-library/mysql/blob/master/8.4/docker-entrypoint.sh) and [MySQL deployment documentation](https://dev.mysql.com/doc/refman/8.4/en/docker-mysql-getting-started.html). Recovery used the supported [Docker Desktop CLI](https://docs.docker.com/desktop/features/desktop-cli/).

Real reruns exposed separate generation problems: valid negated assertions and synchronous API response status/JSON assertions were incorrectly rejected. Their AST matcher/provenance analysis was corrected while unawaited web assertions, fabricated response values, swallowed errors and weakened original assertions remain rejected. Checkbox controls are distinguished from mutable edit text inputs.

A further issue discarded entire generated batches when only one experimental scenario was invalid or failed runtime execution. The new candidate helper can discard only invalid top-level additions, preserving all original/accepted tests, hooks and helpers. It can retain only observed passing additions from a mixed runtime result, then measure the entire retained suite again in two fresh independent runs. Those retained tests are not accepted until the normal stability, coverage gain and non-regression gates pass.

The main UI now presents a concise status, stage/countdown while running, elapsed duration and next action. Target details, token usage and diagnostic evidence are collapsed under Details. Empty goal/token panels are omitted for pre-AI setup failures; required project credentials remain actionable in the main status. Duplicate success notices and the long policy paragraph were removed.

## Verification

- Final focused Jest run: **14 suites / 137 tests passed**. Covers candidate filtering/passing-subset re-verification, original intent preservation, valid API/negated assertions, rejected unresolved/fabricated values, real measurement rules, setup diagnostics/redaction, cancellation, timeout classification and historical response normalization.
- Chromium: **6 tests passed**, including desktop/mobile spacing, hidden telemetry, honest countdown/timeout states, partial/target-reached states and required ENV instructions visible outside Details. Rendered mobile running state and desktop setup failure screenshots were inspected.
- Scoped frontend ESLint and production build passed (existing bundle-size/dynamic-import warnings remain).
- Real isolated MySQL startup, authenticated CREATE/INSERT/SELECT and cleanup passed in **40,102 ms**. The exited, labeled CovAI container left by the original engine failure was removed with only its anonymous volumes after recovery.
- Diagnostic rerun `cmvao6sk600001k7ksf0h5qby`: setup and original suite passed twice; pre-fix static rules rejected three experimental batches. No tests saved; 239,257 ms, 4 requests, 29,052 reported tokens with one request lacking reported usage.
- Diagnostic rerun `cmvaoguye0000lo7k8wdz6w1u`: confirmed corrected assertion parsing but exposed whole-batch rejection of an otherwise useful suite containing one failed edit scenario. No tests saved; 454,257 ms, 5 requests, 51,848 reported tokens.
- Final verification job `cmvaotmg90000l47kk046xlnd` ran the batch-retention changes and finished **APPLIED** in **823,501 ms (13m 44s)**. Usage: **6 requests, 69,520 reported tokens** (65,535 prompt; 3,985 output), all requests reporting usage. Three rounds accumulated verified gains; three later candidates were rejected (two attempted prohibited API mocking, one changed protected scenario identities). The verified best was saved on `NO_FURTHER_GAIN`.

## Final real result

Published assessment: `cmvapb3zi0091l47k3jxxdw9u` (`COMPLETED`).

| Tier | Metric | Existing baseline | Saved best |
| --- | --- | ---: | ---: |
| Frontend | Lines | 30.88% | 89.71% |
| Frontend | Branches | 12.50% | 90.63% |
| Frontend | Functions | 13.04% | 100% |
| Frontend | Statements | 28.38% | 89.19% |
| Backend | Lines | 40.38% | 84.62% |
| Backend | Branches | 10% | 90% |
| Backend | Functions | 40% | 100% |
| Backend | Statements | 40.38% | 84.62% |

Post-save audit confirmed:

- Original **2** scenarios preserved; **7** additional scenarios saved, for **9/9 passing tests in each of two independent runs**.
- All **18** scenario screenshot files exist and have valid PNG signatures.
- Application source hash unchanged; saved file matches the verified candidate hash; published assessment test hash matches the current source tree.
- No metric regressed and no eligible source files/denominators were removed.
- The **95% objective was not reached for all metrics**. Failed or prohibited experiments were not saved and their coverage was not published as a successful improvement.

Final authenticated dashboard E2E against the saved job: **4/4 passed** in 1.4 minutes. Verified every screenshot in the latest nine-scenario run through the real API (PNG content/type), unauthenticated denial and unrelated-owner denial, no repeated discovery/loading flashes, search preservation during refresh, enlarged evidence, report rendering, navigation/reload recovery and screenshot retry at mobile width without horizontal overflow. Together with the six focused UI checks above, **10 browser tests passed**. These checks submitted no additional AI requests or source changes.
