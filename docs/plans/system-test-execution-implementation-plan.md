# Test Execution Visualization System Implementation Plan

**Goal:** Explore completed System Test attempts on a real time axis and inspect reported steps and screenshot evidence.

**Architecture:** Normalize bounded execution details from runner reports, persist them on TestScenario, and expose them through the existing owned scenario API. Render focused Execution components inside SystemTestDashboard using the same pinned run and runner/mode selection as Scenarios.

**Tech Stack:** ES modules, Prisma/PostgreSQL, Jest, React 19, Tailwind, Playwright.

## Constraints

- Completed report exploration; existing job-stage progress during execution.
- No invented timestamps, step outcomes, screenshots or durations; preserve zero.
- Playwright and Cypress retain only data actually supplied by their reports.
- Historical null detail is valid; mode and runner results stay isolated.
- Additive nullable JSON column, no data deletion. Review SQL before applying.
- Bound attempts, total steps, depth and text. Redact secrets and host paths.
- Reuse authenticated scenario screenshot previews, snapshot ownership checks and editor/breakpoint actions.

## Delivery

- [x] Follow-up approved by user: enforce automatic named Playwright step recording across verified generation, cold-start, legacy AI jobs and Boost/Fix, including fallback templates. Use prompt requirements plus idempotent AST instrumentation at the generation boundary; verify source scope, returned values, failure propagation and native runner report steps.

- [x] Normalize execution details in `server/src/services/systemTestExecutionDetails.service.js`; cover retries, parallel timing, nested failures, expected failure, skipped/unknown results, zero/missing data and truncation in a focused Jest suite.
- [x] Integrate normalization in `systemTestResultParser.service.js`; keep existing totals and derive no step success from absent results.
- [x] Add `TestScenario.executionDetails Json?` and additive migration; persist explicit detail in `systemTestAnalysisJob.service.js`, remap managed spec locations to original files and return details from the owned scenario API. Validate/generate Prisma; inspect pending migrations before deploying.
- [x] Create `systemTestExecutionModel.js` with pure flatten/filter/offset helpers and tests for overlaps, missing timestamps and elapsed wall time.
- [x] Add `SystemTestExecutionView.jsx` and `SystemTestExecutionDetail.jsx`: shared-axis attempts, name/status filters, accessible selection, nested step details and existing evidence. Wire Scenarios / Execution selection in the dashboard; keep loading/empty/error and running banners.
- [x] Run parser/job/API/model tests, changed-file ESLint and frontend build. Verify a real Playwright passing/failing/retry/parallel report, persisted detail and browser navigation, filters, selection, historical data, modes and themes. Record results and any verification limitations.
