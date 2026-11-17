# System test review — 2026-10-04

The existing implementation was reviewed against `system-test-implementation-plan.md`. Existing staged and unstaged work was preserved.

## Changes

- Discover the runner in client/frontend/server workspaces and execute from the matching workspace. A generic Jest `tests/` directory no longer identifies Playwright.
- Resolve local Playwright packages without relying on an `npx` download. Include `playwright-core`, resolve packages relative to the service, and generate an ESM fallback config that targets E2E directories.
- Execute E2E on the host alongside the AUT. Respect a project's own Playwright `webServer`; when CovAI starts the AUT, override baseURL through a temporary config without rewriting the original config.
- Clear the previous report before execution. Reject runner errors, empty runs, and contradictory successful reports with nonzero process exits. Expected failures and skipped tests have consistent metrics and scenario statuses.
- Give AI dry-run its own config and baseURL so project testDir/testMatch cannot hide the temporary file. Save generated code only to the fixed E2E destination and remove temporary config/test files after execution.
- Keep E2E coverage artifacts out of shared Unit/Integration coverage tables. Ignore old coverage artifacts. Source coverage remains unavailable on the dashboard.
- Subscribe to user rooms using verified JWT claims. Emit System/AI progress only to the owner's room and accept progress only for the UI's active job. Allow the UI to wait longer than the runner timeout.
- Drain AUT stdout, handle spawn errors, and attempt process-tree cleanup on startup failure. Report cleanup errors rather than silently hiding them.
- Add and apply the additive migration for flakyTests and TestScenario. Prisma validation and generation passed.

## Verification

- Full backend regression run: 61 suites, 376 tests passed before the final additional report-cleanup regression test. Jest used `--runInBand --forceExit --silent`; Redis/BullMQ handles prevent a clean automatic exit in this environment.
- Related System/AI/AUT/socket tests passed after the runner and progress changes.
- Frontend production build passed. Full frontend lint reported 122 errors and 12 warnings across existing code; it is not a clean lint baseline.
- Real Playwright smoke test (`node scratch/verify-system-test.mjs`): 2 scenarios, 1 pass, 1 intentional assertion failure, exit code 1, and AUT port released. On this Windows sandbox, taskkill requires execution outside the sandbox; the unrestricted verification passed.

## Remaining verification and limitations

- The frontend is running at http://127.0.0.1:5173. Redis on port 6379 and the API on port 5000 were not running; Docker daemon was unavailable. Start Redis using the configured REDIS_URL and then start the API before trying queued jobs.
- The authenticated browser flow (import, generate through Gemini, dry-run, run analysis, refresh dashboard) has not been exercised with a real account. AI generation tests mock Gemini; the live AI provider was not verified.
- Automatic V8 collection/conversion and isolated source coverage display are not implemented completely. The dashboard correctly uses N/A and scenario results; it should not be presented as completing the dual-track coverage phase.
- Cypress execution/reporting has not been verified end to end. Playwright is the tested path.
- AUT dependency installation and seed execution still use synchronous subprocesses. Complex fullstack startup, databases, and arbitrary package layouts require project-specific configuration.

## Manual acceptance

1. Start Redis and the API, then open the frontend and sign in.
2. Import a small public Vite/React project. Verify System metrics are empty and do not show Unit files.
3. Generate AI System Tests. Inspect syntax/dry-run errors if it fails; a rejected test must not overwrite the existing suite.
4. Run System analysis. Verify progress, final pass/fail/flaky counts, scenario errors, and refresh persistence.
5. Retry with a failing test and check that analysis completes with failed scenarios. Runner startup/config errors should fail the job and preserve the previous valid run.

## Live browser acceptance on todoapp

The previous browser/environment limitations above were resolved for this verification. Redis was started in Docker, the API was started on port 5000, and the user completed GitHub login in the headed agent-browser session.

- Opened the user's imported `todoapp---test-` project. Initially, the System summary failed because AiTest.status and the PLAYWRIGHT_E2E enum value had no committed migration. Added and applied `20261004093000_ai_system_test_status`; the empty state then loaded correctly with zero metrics and N/A coverage.
- Clicking Run Analysis without E2E configuration returned a failed job with the expected missing-Playwright message. The UI exited its waiting state.
- With explicit user permission to send source context to Gemini, generated tests through the dashboard. The first dry-run had one passing test and one strict locator failure; no test file was saved. Added selector-scoping instructions to the prompt and a reporter failure formatter that extracts scenario errors rather than displaying the leading JSON config.
- The second generation completed dry-run, saved a VERIFIED test file, and automatically started System analysis. Four scenarios passed: initial render, adding a todo, empty list, and API/database-error UI.
- A manual Run Analysis also completed with four passed, zero failed, zero flaky. Reloading the app and selecting System Test preserved the four results and scenarios. Unit Test did not inherit the E2E scenarios.
- Job Queue displayed both completed System analyses and the earlier failed jobs, with zero active jobs. AUT port 5174 was closed after execution.
- The tests use Playwright API mocks. This verifies the CovAI generation/dry-run/analysis/dashboard pipeline and todoapp frontend, not the real todoapp Express/MySQL stack. V8/source coverage remains unavailable.
- Final regression: 62 suites, 379 tests passed with --runInBand --forceExit --silent. Fixed a Unit suggestion test to mock its project lookup instead of depending on a live database connection.
- Browser screenshot: `temp/todoapp-system-e2e.png`. The browser remains on the System results dashboard; API and Redis are running for follow-up testing.
