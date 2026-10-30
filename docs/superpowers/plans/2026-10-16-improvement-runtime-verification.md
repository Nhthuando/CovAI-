# Improvement runtime verification

## Incident

Owned job `cmvagfpgg00az447kvkyfzca9` ended after 1,213 seconds, with four AI requests and 88,246 reported tokens. Its stored error was `System improvement canceled`, incorrectly mapped to STALE. Both source and test hashes still matched the completed assessment. Logs contained fourteen npm ci executions across baseline and candidate verification. Most generations took seconds; installs and failed test timeouts dominated.

## Changes

- Preserve worker time-budget abort reasons; classify actual source/test/revision/runtime conflicts separately from interruptions.
- Keep completed verification evidence when a job stops. Correct the displayed state of previously mislabeled interrupted jobs without rewriting historical database records.
- Stop improvement verification after its first failed, skipped, or flaky independent run. Successful candidates still need two complete passes, original scenarios/assertions, a measured coverage increase and no decrease.
- Reuse installed dependencies within a single improvement job by copying private templates into fresh execution workspaces. No live dependency directory, process, browser context or database is shared between runs. Windows uses parallel native copying; unsuccessful cache preparation falls back to normal installation.
- Freeze generated/repaired npm locks in execution copies. Cache inputs include manifest/config/runtime and package location. Custom install hooks, local packages and workspaces use ordinary setup. Partial runner dependencies can be replaced only inside explicitly registered disposable workspaces.
- Show Estimated time remaining prominently, elapsed time secondarily, and count down from the server sampling timestamp. Estimates use successful job history or actual completed independent run durations, never stage percentages. Unknown/overrun states remain explicit.

## Verification

- Backend regression batches: 13 suites / 112 tests; later targeted batches 9 suites / 62 tests and 3 suites / 35 tests, all passing. Final cache, repeat-control and improvement orchestration batch: 3 suites / 27 tests passing. Batches overlap and are not additive.
- Actual repeat-control tests demonstrate one real runner invocation for failed/skipped/flaky early-stop cases, two separate execution workspaces for passing candidates, and unchanged normal-assessment repeat behavior.
- Three real Chromium UI checks pass: live countdown and overrun; timeout message and frozen terminal elapsed duration; mobile (390px) and desktop (1440px) layout without horizontal overflow. Screenshots under `tmp/improvement-progress-e2e/` were visually inspected.
- Scoped frontend ESLint passes. Production build passes with existing bundle-size/dynamic-import warnings.
- Affected Food Ordering project: two real existing-test runs passed independently. Instrumented timing: **206,089 ms** total, **two npm ci commands** (one server, one client), rather than repeating both installs for the second run. Source/test hashes remained unchanged; disposable databases and processes were cleaned up. Frontend lines 55/210 (26.19%); backend lines 74/140 (52.86%). These are existing-suite measurements, not a claim of a new coverage gain.
- Earlier sequential Node copy attempt took 528 seconds and one navigation exceeded the test's 30-second timeout. The implementation was replaced with native Windows parallel copy. A separate same-temp-volume dependency copy measured 3,761 ms. Do not compare the 206-second baseline measurement to the original whole 20-minute AI job as though they were the same operation.

## Initial approval block

Automatic approval review rejected the real AI Improve rerun because it sends imported source/tests to the configured Gemini provider and may auto-apply passing generated tests. An explicit asynchronous approval request was presented; the user subsequently approved the exact project, configured model, quota use and strict auto-save conditions. Results of the authorized verification follow below. Overall AI job latency still depends on project setup, candidate failures and provider responses; no fixed completion-time or 100% coverage guarantee is claimed.


## Authorized real AI verification

The first started attempt stopped before any Gemini request because `docker info` exceeded its 10-second probe timeout even though the engine was reachable. Replaced that heavyweight diagnostic with a lightweight server-version request and one bounded retry. Six resource-provisioning tests pass, including transient Docker wake-up failure and cancellation. No application ENV or source was changed to mask the infrastructure issue.

The first complete approved improvement job, `cmvajfsa00000us7kn0sjd9e6`, ended safely after **762,335 ms (12m 42s)**. Four reported requests used **85,089 tokens**. No tests were applied: generated record interactions assumed a populated database, and later candidates failed static outcome-assertion checks. Failed independent runs stopped after the first run. The original file remained intact.

Added the missing generic runtime contract to generation and repair prompts: Full Stack runs use fresh databases; additional tests establish their own data through actual source-supported APIs/UI; the managed Playwright `request` fixture points to the real isolated backend, while `page` uses the frontend. Mode is explicitly supplied. No fixed ports, mock data injection, conditional fallbacks, source edits or assertion weakening were introduced. Also preserve previously measured candidate evidence if a later generation is statically rejected, and prioritize the actual stopping error in the UI. The added evidence-preservation regression passes; orchestration tests pass 12/12, and the preceding booster/resources/orchestration batch passes 30/30 (overlapping batches).

Final job **`cmvajyfo10000es7kw2itb4ak`** completed in **485,019 ms (8m 05s)** and reached **APPLIED** on its first candidate round. The model was `gemini-3.5-flash-lite`. One transient provider 503 retried successfully: **two requests**, **one response with 19,916 reported tokens**; usage for the error request was not reported, so accounting remains explicitly incomplete. Across both completed jobs: six requests, 105,005 reported tokens, with one request lacking usage. No further generation was performed.

The generated file retains the original scenario and appends two scenarios: create a food item through the real backend and verify detail/add-to-cart; verify the missing-food error state and its back control. Both independent runs passed **3/3**, with no skipped/flaky scenarios. Every measured metric increased:

| Tier | Metric | Before | After |
| --- | --- | ---: | ---: |
| Frontend | Lines | 26.19% | 48.10% |
| Frontend | Branches | 12.40% | 33.33% |
| Frontend | Functions | 7.59% | 24.05% |
| Frontend | Statements | 23.61% | 44.64% |
| Backend | Lines | 52.86% | 59.29% |
| Backend | Branches | 20.83% | 29.17% |
| Backend | Functions | 21.74% | 39.13% |
| Backend | Statements | 51.03% | 57.93% |

Post-save audit verifies the exact candidate hash, unchanged application source, unchanged original scenario AST, current test hash matching published assessment **`cmvak8lk4004zes7kn5287qnk`**, and valid PNG signatures for all six persisted scenario screenshots across the two runs. The 8-minute result is an observed successful AI job, not a guaranteed latency for every project/model/candidate. Coverage is measured execution and does not establish complete business correctness.

Final real authenticated dashboard E2E: **3/3 passed** against the applied Food Ordering snapshot. Checks cover saved PNG delivery and ownership, enlargement/print rendering/navigation/reload, and evidence-download retry with mobile overflow checks. Scoped frontend ESLint also passes.
