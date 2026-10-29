# Automatic project setup implementation plan

**Goal:** Move setup responsibility into CovAI's shared runtime. Infer source-backed services, create disposable local dependencies and internal test configuration, generate missing compatible tests, and request only externally owned mandatory values. Preserve real failures and honest coverage.

**Architecture:** A deterministic repository plan describes frontend/backend/unified applications, optional database and Redis. An isolated resource owner provisions and cleans local services. A source-backed environment resolver supplies internal URLs/secrets and reports mandatory external inputs without inventing credentials. Existing source-local package preparation remains shared. Existing AI generation is used when meaningful tests/schema cannot be derived deterministically, with bounded verification before publication.

**Compatibility contract:** Arbitrary source can be broken, non-web, need unavailable runtimes or genuinely external systems. Those are execution/capability failures, not fabricated ENV requirements. No finite test matrix establishes success for every JS program. Unsupported cases must retain actionable evidence and never be counted as passes. Explicit configurations remain authoritative.

- [x] Infer optional/no database, Prisma SQLite, MongoDB and Redis services as well as existing SQL stacks; handle single/unified applications and readiness without a dedicated health endpoint.
- [x] Provision only required disposable resources; wire generated ports, database/cache addresses and internal secrets into the actual app processes. Keep database operations scoped to owned resources.
- [x] Generalize environment dependency detection beyond a Stripe-specific branch. Respect defaults/lazy/optional use, generate local auth secrets, and report only source-required external input with its source.
- [x] Automatically prepare compatible Full Stack tests when none exist, preserving originals and publishing only independently verified generation. Run work in copies and reuse existing job cancellation/provider budget.
- [x] Verify behavior with negative regressions and a real stack matrix across no-DB, SQL, SQLite, MongoDB, Redis, nested apps, unified apps and required/optional environment cases; rerun existing acceptance flows.

Exact results and compatibility limits: [verification record](2026-10-16-automatic-project-setup-verification.md).

Research references: [Express routing](https://expressjs.com/en/guide/routing/), [Prisma connection URLs](https://docs.prisma.io/docs/orm/v6/reference/connection-urls), [Redis Docker](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/docker/), [MongoDB Docker](https://www.mongodb.com/docs/v7.0/tutorial/install-mongodb-community-with-docker/), [Node crypto](https://nodejs.org/api/crypto.html), [Playwright webServer](https://playwright.dev/docs/test-webserver). Runtime support and source-coverage support are tested and reported separately.
