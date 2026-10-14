# Test Execution Visualization System — analysis and proposed design

Date: 2026-10-11
Status: First delivery approved and implemented on 2026-10-12.

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

Approved scope: System Test (Playwright and Cypress), individual steps when reported and existing screenshots. Implementation: approach 1.

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

## Delivered behavior and verification (2026-10-12)

- System dashboard offers Scenarios / Execution on the same pinned run and runner/mode selection. Execution shows attempt timing on a shared axis, name/outcome filters, nested reported steps, retry errors and existing authenticated screenshot evidence.
- `TestScenario.executionDetails` is nullable versioned JSON; the additive migration was validated, generated and deployed. Existing results display an unavailable-detail message; rerunning collects new detail.
- Normalization bounds 20 attempts, 200 total steps, depth 8 and 65,536 text characters per scenario; malformed timing is unavailable, zero durations are preserved, credentials/host paths are sanitized and truncation is visible. Truncation retains failed step status.
- Playwright JSON emits named `test.step` blocks, not every browser command. Cypress Mocha JSON supplies flat scenario results without step/start-time detail; structured Cypress reports preserve reported attempts when available. Missing fields are not estimated.
- 66 focused backend tests passed, plus 4 Node view-model tests. Comprehensive system service regression tests passed. Changed-file ESLint, frontend build and Prisma validate/generate passed; existing bundle-size/dynamic-import warnings remain.
- A real Playwright browser report produced 1 passing, 1 failing, 1 flaky and 1 skipped scenario with nested steps, two workers and screenshots. It was persisted to PostgreSQL and read through the authenticated scenario API. Temporary run/evidence records were removed afterward, preserving original run history.
- Browser verification passed for selection, nested steps, screenshots, filters, Frontend/Full Stack isolation, Cypress empty state, historical null detail, keyboard access, light/dark themes and 390px mobile layout. Error recovery and running progress were exercised with UI test responses without launching a fake backend job. A transient database connection timeout was resolved by retrying.
- No real Cypress binary smoke run was performed; Cypress normalization is covered by report fixture tests.

Screenshots: [Desktop](assets/system-test-execution-dark.png), [Mobile](assets/system-test-execution-mobile.png).

## Automatic generated Playwright steps (2026-10-12)

- User requested automatic step recording whenever System Test generation is invoked. Verified full-system, cold-start, legacy Playwright generation and AI Boost/Fix now share explicit prompt instructions for meaningful awaited `test.step` blocks.
- A generation-boundary AST pass adds missing step wrappers before verification/storage/preview. It preserves named steps and is idempotent. Shared declarations stay in scenario scope, returned response values survive, and assertions, conditions, loops, throws and cleanup retain their behavior. Awaited operations inside a named step stay in that group.
- Automatically derived titles describe operations without copying arguments or input values. Missing awaits on explicit steps, blank/empty steps, unsupported callback structure, nested scenarios and shadowed Playwright bindings fail validation instead of silently losing report detail.
- Offline Playwright templates also record steps. Booster fallback insertion uses suite AST boundaries; files with top-level tests get top-level new scenarios instead of invalid nested declarations.
- Cypress generation uses its own APIs and remains unchanged by Playwright instrumentation. Old saved files/results need regeneration or an AI Boost/Fix/save/run cycle to gain new step detail; no existing snapshot file is rewritten by this code change.
- Real Playwright before/after verification preserved 1 passing and 1 failing scenario, shared response/input values and cleanup. The instrumented report contained 9 and 2 steps respectively, including the original failed assertion at its failed step. No Gemini call or source upload was needed for this verification.
- Follow-up regression verification passed all 62 tests across 9 backend suites covering step instrumentation, generation, repair, prompts, editor/booster flows and result parsing.
