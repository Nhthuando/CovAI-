# Test Execution Visualization System — analysis and proposed design

Date: 2026-10-11
Status: System Test scope confirmed by user; proposed design awaiting approval.

## Repository findings

- No task specification with this exact name was found in the repository.
- `UnitTestExecutionVisualizer.jsx` already provides Jest/Vitest duration bars, suite hierarchy and performance views. Bars use relative duration, without actual start offsets. Missing assertion durations are estimated from suite duration, and an empty result is presented as all tests passed.
- `SystemTestDashboard.jsx` provides runner selection, stage-level job progress, scenario lists, breakpoint inspection and an editor. It has no execution timeline or step explorer.
- `systemTestResultParser.service.js` reads Playwright results and retries, but collapses them into one scenario and drops individual attempt timing and nested steps. Cypress normalization is separate.
- `TestScenario` persists status, duration, failure details and one screenshot, but has no execution-detail field. `TestRun` already records run start/end times.
- `systemTestAnalysisJob.service.js` persists scenarios and broadcasts job-stage progress. These events are not a per-step execution stream.
- Existing evidence services and authenticated screenshot loading should be reused. The implementation must retain snapshot ownership checks.

## Approaches

1. **Recommended: System Test report visualization.** Preserve runner report timing, attempts and available steps; add a timeline and detail explorer inside the existing System dashboard. Reuse job-stage progress while a run is active. Useful evidence with a limited change to the existing pipeline.
2. **Live step streaming.** Add runner-specific reporters, a bounded event transport, reconnect recovery and durable execution events. More useful during long runs, but substantially larger and requires independent Playwright/Cypress integration.
3. **Unified visualization for all test types.** Introduce a shared execution model and adapters for Unit, Integration and System tests. Broad scope; split into separate deliveries if selected.

## Proposed first delivery

Confirmed scope: System Test (Playwright and Cypress), individual steps and screenshots. Proposed implementation: approach 1; design approval is pending.

- Add an Execution view reachable from the existing System Test dashboard, alongside its scenario view.
- Show run outcome, real elapsed time and passed/failed/flaky/skipped counts. With no run, show an explicit empty state.
- Place scenario attempts on a common time axis using runner timestamps where supplied. Parallel attempts overlap instead of being drawn as sequential execution.
- Filter by name and outcome; selecting a scenario opens its attempt list, nested steps, actual durations, failure details and existing screenshot evidence.
- Preserve failed attempts before a passing retry. Distinguish flaky outcomes and expected failures using runner semantics.
- Keep existing Run System Tests and editor/breakpoint actions accessible.
- During execution, show the existing job stage and progress. Completed report detail appears after persistence. Do not label completed report data as a live step stream.
- Report missing timing or step information explicitly. Never fabricate timestamps, step results, source links or screenshots. Cypress exposes only what its report actually contains.
- Historical runs without execution detail remain usable with scenario status/duration and a clear detail-unavailable message.

## Data and implementation boundaries

- Introduce a versioned normalized execution-detail structure with bounded attempts and recursively bounded steps: attempt index, runner status, start timestamp, nullable duration, nested step title/category/location/error and timing provenance. Preserve meaningful zero durations.
- Add nullable `executionDetails Json?` to `TestScenario` through an additive migration. Existing run timestamps stay on `TestRun`. Review SQL and validate/generate Prisma; applying a database migration is a separate action.
- Keep normalization in a focused service, invoked by the existing runner result parser. Persist through the existing analysis job and expose through the existing authorized scenario API.
- Sanitize file locations and errors using repository helpers, strip host paths and exclude report attachments/credentials from detail payloads. Screenshot access continues through the existing evidence API.
- Implement focused React components and view-model helpers with existing Tailwind/theme tokens and shared controls. Handle loading, empty, unavailable-detail, error and running states; support keyboard access and responsive overflow.

## Verification and completion criteria

- Parser tests: parallel attempts, retries/flaky results, nested failures, skipped tests, expected failures, zero/missing timing, malformed report values and bounded payloads.
- Persistence/API tests: detail survives storage, historical null detail remains valid, and another user's snapshot is denied.
- View-model tests: correct offsets and elapsed time, no invented ordering for unavailable timestamps, filter/count consistency.
- Frontend build and lint of changed files; browser verification of navigation, selection, filters, empty/error/running states and light/dark themes.
- A real runner smoke test with passing and failing scenarios verifies the report-to-API-to-view flow where local runtime prerequisites are available. State any blocked verification explicitly.

## Deferred work

Per-step live streaming, video replay, importing Playwright trace archives, a new dedicated route, run-history comparison and visualization changes for Unit/Integration are outside the proposed first delivery.
