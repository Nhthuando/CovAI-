# Measured AI test improvement implementation plan

**Goal:** Save AI test additions only after verified coverage gains with preserved test behavior and useful outcome assertions.

**Architecture:** Put acceptance and feedback rules in a pure policy service shared by worker and apply. Keep one baseline, isolate up to three candidate rounds, and retain existing ownership, snapshot lease and hash protections. Reuse the current result panel for coverage comparison.

**Tech stack:** Existing ES modules, Express services, Babel AST, Playwright, Prisma, React and Jest. No dependencies or schema changes.

**Approved:** User approved the linked behavior contract in this conversation and asked for implementation. Execute inline; preserve unrelated working-tree changes.

## Tasks

- [x] Acceptance policy: add `systemImprovementPolicy.service.js` with `evaluateSystemImprovement({baseline,candidate})`; reject zero gain, any decreasing metric, invalid comparisons, failed/skipped/flaky runs, and missing original passing scenarios. Return measured counter and percentage-point comparisons. Cover these behaviors with a pure Jest suite.
- [x] Generation quality: add a new-scenario validator to `systemTestStaticAnalysis.service.js`; require supported awaited assertions and reject conditional action fallbacks/fixed waits for additions. Invoke it in booster, worker and apply. Add booster regression tests without changing original tests' requirements.
- [x] Candidate loop: baseline executes once; each of three rounds starts from original code, generates at most three additions and verifies twice. Guard a single repair per round, feed bounded result/delta/gap feedback to subsequent rounds, and stop after the first strictly improved candidate. Keep terminal outcomes distinct and reject stale/provider failures. Exercise using mocked provider/runner and actual temporary file writes.
- [x] Apply: allow only `VERIFIED_IMPROVEMENT` and recompute acceptance from stored evidence before writing. Test manual no-gain rejection and rollback after database failure.
- [x] Result panel: terminal no-improvement and regression states never spin or offer Save. Render frontend/backend before/after percentages with correctly computed percentage-point deltas. Preserve the successful result while refreshing measurements, offer retry for rejected rounds, and retain existing look and responsive behavior.
- [x] Verification: run related Jest suites, frontend lint/build and rendered success/no-gain/regression states. Run a real authorized AI improvement on the current Todo snapshot and report actual results; do not promise guaranteed generation or 100% coverage.

Commands: `npm.cmd test --prefix server -- --runInBand systemImprovement systemTestProposalApply systemTestEditorAndBooster systemTestPromptBudget systemAssessment systemCoverageTruthfulness`; `npm.cmd run lint --prefix client`; `npm.cmd run build --prefix client`.
