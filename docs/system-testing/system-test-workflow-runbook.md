# System Test workflow

The workflow follows the business diagram: confirm the project brief and expected outcomes, discover or author scenarios, review each scenario's Flow/Input/Expected and exact Playwright assertions, run twice, inspect evidence and gaps, then export a PDF. Figma supplies the workspace layout. Imported test titles are never treated as business requirements.

## Supported execution

- Imported web JavaScript/TypeScript projects with a runnable Playwright suite. The managed adapter accepts `.spec.js`, `.spec.ts`, `.test.js`, `.test.ts`, and CommonJS/ESM variants. JSX/TSX *test files* and unsupported dynamic assertion patterns are reported as unsupported for reviewed requirement evidence. The application itself may contain JSX/TSX.
- Each scenario title in a spec must be distinct so live events and artifacts can be attributed without guessing. Rename duplicate titles and sync again before review.
- Frontend execution runs real Chromium. Vite source coverage is measured when instrumentation and the application runtime are compatible. Other web frontend stacks may run their tests, but their source coverage remains unmeasured unless an adapter proves it.
- Full Stack execution uses the existing configured Node application runtime and real API. Node JS source instrumentation supports ESM/CJS; unsupported server stacks or database setup failures are blockers, not a passing result. API mocks are excluded from Full Stack evidence.
- Cypress keeps its existing legacy path. It is not admitted into the new reviewed Playwright workflow.
- The project must provide working install/start/test prerequisites and reachable browser dependencies. Importing arbitrary JS/TS source alone cannot establish a valid business expectation or a runnable application.

## Operator setup

1. Review and apply `server/prisma/migrations/20261021090000_system_test_workflow/migration.sql` to the intended database through the normal deployment process. The migration adds scenario, event and artifact tables; it does not remove old assessments.
   - The configured Railway database on 2026-10-21 already contained the application tables but had no Prisma migration ledger. The new migration was applied in one transaction and recorded with `prisma migrate resolve --applied 20261021090000_system_test_workflow`. The 23 older repository migrations remain pending in Prisma history. Reconcile that baseline against the live schema before using `prisma migrate deploy` on this database; do not deploy all pending migrations over existing tables.
2. Run `npx.cmd prisma validate` and `npx.cmd prisma generate` from `server/`. Start PostgreSQL, Redis, the API and the client. Keep Firebase and Gemini configuration for import, AI preparation and improvement features.
3. Enable `SYSTEM_ASSESSMENT_ENABLED=true` and `SYSTEM_MEASURED_COVERAGE_ENABLED=true` only in a runtime with verified Playwright/browser and coverage prerequisites. Enable `SYSTEM_AI_IMPROVEMENT_ENABLED=true` only when Gemini and the improvement worker are configured. Mutation testing remains a separate opt-in capability.
4. Import a web project. In System Test, enter a brief, add criteria with a source reference and exact expected outcome, and confirm the revision. Sync existing tests or prepare new tests. A manual scenario creates a deliberately failing Playwright scaffold; implement the actual interaction and assertion before review.
5. For each scenario, review Flow/Input/Expected, link criteria, approve direct awaited outcome assertions, and review the scenario. Run is enabled only when every selected scenario matches the confirmed revision and current source hash.
6. Run Frontend or Full Stack. The service records two independent runs, ordered scenario/step events, screenshots when captured, failing traces, requirement evidence, measured coverage status, quality and gaps. FAIL leaves the original test intact. Socket events can be replayed with the event cursor after reconnect.
7. Review AI proposals against the exact candidate file hash. Applying a reviewed proposal stores new scenario metadata and assertion bindings. Existing scenarios whose file changed become stale and require review before the next official run. Export the completed assessment PDF from persisted data.

## Evidence and recovery

- Every catalog, assessment, event, artifact, proposal and PDF endpoint checks ownership through the snapshot's project owner. Artifact reads check containment, file signature, size and recorded SHA-256. The report stores artifact IDs and hashes.
- The runner emits progress to a bounded JSONL stream. The database event sequence is the replay source of truth; socket delivery is best effort. The final Playwright JSON report determines execution verdicts.
- Browser screenshots and traces are stored under `.covai-system-test/` in the snapshot. Existing assessment cleanup rules may remove expired local files; the API then reports the artifact unavailable rather than presenting stale evidence. Back up required audit reports and artifacts according to the project's retention policy.
- If setup or measurement fails, inspect the owned job log and the assessment's explicit status. Do not interpret an unmeasured tier, missing artifact, or blocked run as zero coverage or PASS. Recheck the confirmed revision and rerun after fixing the app or test configuration.
- Rollback: disable the feature flags to stop new reviewed assessments. Keep the additive tables and existing reports until retention and export obligations are satisfied; reverse the migration only through a separately reviewed database change.

## Verification fixtures

- Focused service and route suites: `npm test --prefix server -- --runInBand src/tests/systemWorkflowEndpoints.test.js src/tests/systemScenarioCatalog.service.test.js src/tests/systemScenarioVerdict.service.test.js`.
- Disposable PostgreSQL integration: set `COVAI_DISPOSABLE_DATABASE_URL` to the isolated fixture database, then run `src/tests/systemWorkflowDatabase.integration.test.js`. The test intentionally skips for any non-fixture URL.
- Real browser fixture: set `COVAI_RUN_REAL_SYSTEM_FIXTURE=true` and run `src/tests/systemWorkflowRun.integration.test.js` with isolated PostgreSQL and Redis. It verifies PASS and FAIL, repeated runs, live checkpoint PNG, failure trace retention, and a configured Full Stack Node API with observed browser requests. Never point these fixtures at a configured user database.
