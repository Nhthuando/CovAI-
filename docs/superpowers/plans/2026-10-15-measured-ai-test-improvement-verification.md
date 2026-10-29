# Measured AI test improvement verification

Approved behavior: [design](../specs/2026-10-15-measured-ai-test-improvement-design.md). Implementation: [plan](2026-10-15-measured-ai-test-improvement.md).

## Automated checks

- 101 tests passed in 16 relevant Jest suites: improvement policy/worker/quality/feedback, proposal application and rollback, booster, prompt budget, assessment routes/workspace/discovery/preparation, coverage collector/truthfulness, managed evidence and navigation.
- Frontend production build passed. Scoped ESLint passed without warnings on the three changed result/assessment components.
- Full frontend lint initially reported 307 findings across the repository, including untouched components and existing service code. This change does not repair that unrelated lint backlog.
- Browser-rendered real components were inspected on desktop and at 390px. Applied, no-gain, coverage-regression and verifying states were exercised. No-gain/regression results have retry without Save or progressbar. The mobile page had no horizontal overflow. Screenshot artifacts are in local `tmp/improvement-*.png`; temporary preview source and its server/browser were cleaned up.

## Live source and model verification

An imported Todo application had a backend-package snapshot root while its assessment covered the full repository. Root normalization restored matching identities without changing application source.

Job `cmv9innio00002w7kjwxfhy70` exercised all three rounds and guarded interaction repairs. It terminated `FAILED_VERIFICATION`, with the original file retained, after the model repeated mutable-row locators and produced invalid unescaped Tailwind selectors. Runtime findings informed pre-execution checks for those mechanics and bounded rejected-code feedback. The code never accepted the failed tests or manufactured coverage gains.

Job `cmv9jbauq0000ns7k6hl7zy87` used the final quality checks. It generated two additional scenarios: editing a title with persistence after reload, and cancelling an edit. Both retained all five original scenarios and added three supported outcome assertions. Baseline and candidate each passed both independent runs, no failed/skipped/flaky scenario remained, comparison was compatible, no coverage metric decreased, and the proposal reached `APPLIED` in its first candidate round. The saved file hash matched the verified candidate.

| Tier / metric | Original | AI candidate | Change (percentage points) |
| --- | ---: | ---: | ---: |
| Frontend lines | 66.18% | 83.82% | +17.64 |
| Frontend branches | 59.38% | 84.38% | +25.00 |
| Frontend functions | 65.22% | 95.65% | +30.43 |
| Frontend statements | 64.86% | 83.78% | +18.92 |
| Backend lines | 80.77% | 80.77% | 0.00 |
| Backend branches | 50.00% | 70.00% | +20.00 |
| Backend functions | 100.00% | 100.00% | 0.00 |
| Backend statements | 80.77% | 80.77% | 0.00 |

These observations establish execution, coverage gains and the configured structural assertion checks. They do not establish complete business correctness or guarantee that every future provider response can improve coverage.

Post-apply assessment `cmv9jhhqc0002ac7kf922ser5` (job `cmv9jhh7m0000ac7kxkisjbm1`) completed with 7/7 tests passing in each of two independent runs. It reproduced the coverage values above, and its source/test hashes match the saved repository. The dashboard can read this completed current assessment without another user-run measurement.
