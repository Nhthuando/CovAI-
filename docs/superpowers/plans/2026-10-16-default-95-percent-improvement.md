# Default 95% Coverage Improvement Implementation Plan

**Goal:** Implement the user's approved automatic 90–95% objective without a target picker. Aim for 95% on every nonempty lines/branches/functions/statements counter in configured tiers; 90% is a milestone, not a stopping rule. Unknown measurements never count as reaching the goal.

**Architecture:** Keep an immutable initial baseline and a separately verified best candidate. Each round appends tests to the best candidate, measures twice, and must improve coverage with no regression against that best report. Accepted candidates become the next round's input; rejected additions are discarded. Compare the final best report with the initial baseline for saving/publishing. Retain the best verified improvement on bounded stops, including provider limits and worker timeout, subject to a still-owned lease, RUNNING job, unchanged source/tests/revision, and existing strict apply checks. User cancellation, lost lease and stale source never authorize a save.

**Tech Stack:** Existing ES modules, Express/Prisma, Playwright, Istanbul, React, Jest.

## Global constraints

- Default target 95%, milestone 90%; no selector, no reduced coverage denominator or fake 100%.
- At most 8 candidate rounds, 12 provider requests including retries, 20 minutes; stop after 3 consecutive rejected/no-gain rounds. Reserve 2 minutes before starting another round for finishing. Preserve existing per-job dependency reuse and fresh run databases/processes.
- Preserve all original and previously accepted tests/assertions. Each new batch adds 1–3 supported scenarios; two real passing runs, no skipped/flaky tests, measured gain and no metric decrease remain mandatory.
- English UI must distinguish source coverage target progress from execution-stage progress and show the reason if the goal was not reached. No new schema or migration.

## Tasks

- [x] Add `shared/systemImprovement.js` limits and pure `coverageGoal(report)` summary; add server gap-priority helper and branch/function gap provenance. Test all-counter thresholds, unknown/empty counters and diverse uncovered targets.
- [x] Refactor `systemTestImprovementJob.service.js` into bounded accumulation with immutable initial baseline and verified best content/report. Persist current best evidence for progress, advance gaps after each gain, and discard regressing additions. Test cumulative gains, preserving accepted scenarios and rejecting regression against the best report.
- [x] Finalize only the verified best candidate on clean/provider/budget stops. Add an ownership-only lease assertion for controlled timeout finalization; never bypass user cancellation or lease/source checks. Test timeout after gain, cancellation, provider failure after gain and stale-source protection.
- [x] Update assessment/review/progress UI with the fixed target, lowest measured metric, reached/below-target states and bounded limits. Keep legacy proposals displayable. Verify English copy, no target picker, responsive spacing and terminal partial-improvement state in browser.
- [x] Run focused Jest suites, frontend lint/build and real browser checks. Perform a bounded real improvement on the already authorized Food Ordering project if runtime/quota allow, then record actual goal status and measured gains without claiming an unachieved 95%.
