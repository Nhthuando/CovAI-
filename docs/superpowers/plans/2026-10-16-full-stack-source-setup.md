# Full Stack source setup repair

Goal: repair the actual Food Ordering Full Stack failure, job `cmvacc4p00000gk7krfjw2lf9`, without confusing Frontend success with Full Stack verification.

Design: when one frontend/backend and a supported Prisma schema are unambiguous, select source-backed readiness routes and schema directly. Retain AI only for unresolved SQL-driver setup. Keep explicit existing configuration. Publish configuration atomically; report service, engine and readiness validation failures separately. Auto-created disposable Prisma databases use the current schema, while existing explicitly configured migration behavior remains intact. Never fabricate third-party credentials or convert mocked UI tests into evidence of backend correctness.

Alternatives: retrying AI alone leaves deterministic facts vulnerable to guessing; bypassing route validation could probe invented paths. Prefer validated source setup and precise failures.

- [x] Add regression for Prisma setup without model calls, root route precedence, schema containment, explicit-config compatibility and actionable validation.
- [x] Implement source-backed setup/config and isolated Prisma schema strategy.
- [ ] Complete Food Ordering Full Stack browser verification. Real execution passed MySQL creation and Prisma preparation, then stopped on missing Stripe test configuration. Awaiting the actual test credential in the imported backend's `.env.test`.
- [x] Run relevant regression tests and record exact evidence, including backend coverage limitations of existing mocked browser tests.

## Verification and remaining prerequisite

Final selected backend regression: **27 suites / 246 tests passed**, exit code 0. Syntax checks and `git diff --check` passed. Food acceptance fixture static intent/quality validation reports three valid scenarios. These checks are separate from its pending runtime verification.

The original affected job is `cmvacc4p00000gk7krfjw2lf9`. Setup now uses the existing `server/prisma/schema.prisma` and source-verified `GET /` without a provider call or generated SQL. The auto-created disposable database uses `schemaStrategy: push`; explicit existing migration setups retain their prior behavior. Workspace-hoisted Prisma CLI resolution is also covered.

A real isolated Food Ordering startup progressed through MySQL provisioning, dependency installation and Prisma generation/schema setup, then exited at the application's eager Stripe constructor because `STRIPE_SECRET_KEY` was unavailable. The new preflight catches this known unconditional imported SDK requirement before database provisioning/install. Assessment job `cmvad0cqd0000907kxsaq6fu3` verifies the actionable `SYSTEM_TEST_ENVIRONMENT_REQUIRED` failure. It does not establish a passing Food Full Stack suite.

All six original Food Playwright scenarios mock API calls. Their earlier Frontend passes do not prove backend/database behavior. Discovery retains these files for Frontend mode and explains that compatible Full Stack tests are needed; it does not bypass the prohibition on mocks.

`server/e2e/fixtures/food-full-stack.spec.ts` adds three source-grounded acceptance cases for real food read/update/delete behavior through API, database and the reloaded UI. It passes static intent/quality validation. It has NOT passed runtime verification yet. No original imported tests were replaced. After the owner configures the actual test credential, execute from `server/`:

```powershell
node e2e/food-full-stack-verification.mjs
```

The helper checks prerequisites, takes the snapshot lease, runs two fresh measured Full Stack executions in disposable copies, and publishes the separate acceptance test and measurements only if all three cases pass twice and source hashes remain unchanged. It does not generate credentials or call AI. Tests cover food behavior; they do not establish payment correctness.

Todo Full Stack regression: job `cmvacvtiz0000007k86a42h4j`, assessment `cmvacvu0n0002007k18ivwphy`, **7/7 in each of two independent runs**, both source tiers measured. Frontend lines remain 83.82%, backend lines 80.77%. Disposable database containers were confirmed cleaned after the checks.

Required environment location: `server/uploads/snapshots/cmv9moqkg0001l07khnnzojqe/Online-Food-Ordering-System-main/server/.env.test`. Only the original snapshot's explicit test environment is read into assessment process memory. Production `.env` credentials are not used as a substitute and credential files are excluded from execution copies and AI setup context.

Research: Express mounted routes https://expressjs.com/en/guide/routing/ ; Prisma schema synchronization https://docs.prisma.io/docs/orm/v6/prisma-migrate/workflows/prototyping-your-schema . Schema push here is restricted to a newly created, owned test database, never an application database.

Stripe confirms that eager SDK construction without a key can fail at import time: https://github.com/stripe/stripe-node . Test-key authentication is documented at https://docs.stripe.com/api/authentication .
