# Automatic imported-project setup verification — 16 October 2026

The change is in the shared runtime/preparation path, without a Food/Todo project-name branch. Existing configurations remain authoritative. Unambiguous source facts take precedence over AI-invented service directories, database engines and readiness paths. AI is retained for source-grounded SQL schema derivation and verified test generation.

## Resulting behavior

- Recognize split, nested, frontend-only and backend-only/unified applications. No database is required when none is declared.
- Provision fresh local MySQL/PostgreSQL, MongoDB replica-set, Redis or SQLite resources when selected by supported source adapters. Supply real allocated addresses and connection variables; tear down only owned resources.
- Synchronize source Prisma schemas in the disposable database, resolve local/hoisted Prisma CLI binaries, and run declared `seed`, `db:seed` or Prisma package seed commands with the owned database environment.
- Generate internal JWT/session/cookie/encryption secrets from secure randomness, honor explicitly configured test values, and wire frontend API URLs, backend ports and CORS origins from actual allocated runtime ports.
- Detect mandatory startup inputs through reachable module imports, SDK constructors and explicit throw/exit guards, including aliases/destructuring and immediately invoked async initialization. Defer lazy, optional, guarded and defaulted inputs instead of demanding unnecessary ENV. Supported SDK patterns include Stripe, OpenAI, Anthropic, Gemini, Resend, Twilio and SendGrid; this is not a complete catalog of every SDK.
- Remove fabricated third-party API keys, remote database credentials and generic mock values from frontend environment preparation.
- When automatic Full Stack discovery finds no compatible tests, generate tests in an execution copy, validate them, require two independent passing verification runs, then add a separate test file without replacing original tests. A failed or canceled candidate is not published. Automatic setup plus generation shares a six-provider-request budget, including retries; reported usage is retained on the assessment report.

Missing mandatory external input uses `SYSTEM_TEST_ENVIRONMENT_REQUIRED` with variable names and source evidence. Docker failure uses `SYSTEM_RUNTIME_INFRASTRUCTURE_UNAVAILABLE`. Runtime/source/test failures remain failures; they are not mislabeled as missing ENV or converted into skips.

## Real application/service matrix

`server/e2e/automatic-setup-matrix.mjs` installs each fixture's actual dependencies, provisions its resources, starts its application, checks real API data and checks browser-rendered output. The complete 12-case run passed 12/12. Two subsequently added seed cases also passed after fixing Prisma CLI resolution: **14 distinct cases passed across the final verification runs**.

| Case | Evidence exercised |
| --- | --- |
| no-database-jwt | Missing internal JWT secret generated automatically; no Docker database |
| fastify-no-health | Fastify without a dedicated health route; actual API and browser output |
| unified-node-app | One server process instead of invented split services |
| frontend-only | Vite app without an invented database/backend |
| postgres-schema | Existing source SQL, real PostgreSQL insert/read |
| mysql-schema | Existing source SQL, real MySQL insert/read |
| prisma-sqlite | Local Prisma 6 schema/client and persisted SQLite data |
| prisma-sqlite-seed | Declared package Prisma seed before API/browser reads |
| node-sqlite | Application-managed schema using direct SQLite |
| mongodb | Real MongoDB/Mongoose insert/read |
| mongodb-seed | Declared seed against the fresh MongoDB resource |
| redis | Real isolated Redis set/get |
| required-external-env | Expected early rejection naming the mandatory external credential; not an application pass |
| optional-external-env | Optional Stripe integration does not block an unrelated journey |

The mandatory-ENV case counts as a passing negative acceptance check, not a successful application launch. The fixtures supply application source and valid CORS behavior, not fake backend responses.

`server/e2e/project-runtime-matrix.mjs` was also rerun after shared environment changes: **13/13 passed**. This covers Vite 7/8, Next.js 15/React 19, Astro 5, CommonJS HTTP, build-before-preview and standalone/nested workspace installs using npm, pnpm, Yarn and Bun. This is runtime/browser evidence, not source-coverage support for every framework.

## Actual automatic generation and measurement

`server/e2e/automatic-generation-flow.mjs` started with a new application containing no configuration, test files or user-supplied JWT secret. The production automatic Run preparation path inferred setup, generated the internal secret, observed the running app and called the real Gemini provider. Generated tests passed two fresh runtime verifications before publication. A subsequent independent measured assessment passed **2/2 tests in each of two runs**.

Published candidate name in that disposable fixture: `tests/e2e/covai-auto-full-e38c38ee0964.spec.mjs`. Backend measured counters: lines 100% (one eligible source line), branches 50%, functions 75%, statements 80%. Frontend was `NOT_MEASURED` because this was a backend-only application serving inline HTML; no frontend coverage was fabricated. The fixture and its temporary artifacts were cleaned after verification.

Todo imported-project regression: job `cmvaeajms0000mg7kksdp09ab`, assessment `cmvaeak420002mg7k8i4m7ah2`. **7/7 tests passed in both independent Full Stack runs**, frontend/backend source tiers measured. Existing line coverage remains frontend 83.82%, backend 80.77%.

Food Ordering still genuinely requires an owner-provided Stripe test credential because its source eagerly constructs Stripe. This repair does not invent that credential or claim Food Full Stack has passed without it. Once configured, automatic Run can generate compatible real-backend tests instead of requiring the owner to replace the existing mocked tests manually.

## Concurrency and defects exposed by live checks

`server/e2e/concurrent-setup.mjs`: **4/4 projects started concurrently on four distinct allocated ports**, despite identical hard-coded source ports. Each returned its own expected response. Kernel port leases now remain held during dependency preparation, closing the earlier race where multiple projects selected a free preferred port before starting.

Windows Prisma SQLite initially failed to create a missing database file. Explicitly creating the owned file fixed actual schema synchronization. Each preparation uses a new UUID database directory and removes it after the app stops, including when multiple verifications reuse one generation workspace.

Prisma 6 exposes its CLI through a package `bin` entry without a module `main`. Module-name resolution incorrectly rejected an installed seed CLI. The shared resolver now finds the contained local/hoisted CLI file and the real seed check passes.

Early failed matrix/generation runs were retained in session evidence and followed by passing reruns. No assertions were weakened, failing cases skipped, or imported application business logic rewritten to obtain the final results.

## Reproduction

Final selected backend regression: **33 suites / 286 tests passed**, exit code 0, on the final implementation. Tests cover resource ownership/cleanup, concurrent port reservations, partial dependency installs, package/workspace managers, config safety, environment requirements/defaults/aliases, generation publication/cancellation, existing assessment/improvement/evidence and coverage truthfulness. `git diff --check` passed. Docker reported no remaining containers with the system-test label after verification. This turn changes backend orchestration and tests; it does not claim a fresh visual UI redesign check.

From `server/`, with a compatible worker Node version, available public package network access, Chromium cache and Docker for service cases:

```powershell
node e2e/project-runtime-matrix.mjs
node e2e/automatic-setup-matrix.mjs
node e2e/concurrent-setup.mjs
# Explicit real-provider check; consumes bounded configured Gemini quota:
node e2e/automatic-generation-flow.mjs
```

The setup matrix supports comma-separated `COVAI_SETUP_CASES`; the runtime matrix supports `COVAI_RUNTIME_CASES`. The provider check accepts `COVAI_E2E_MODEL`. Do not put private credentials in these fixtures or command-line arguments.

## Boundaries

No finite matrix proves that every arbitrary JS repository will run successfully. Missing/broken application source, inaccessible private packages, incompatible Node/runtime requirements, ambiguous multi-app/database topology, unsupported services and genuine failing assertions remain possible. The implementation does not automatically install a different host Node version, synthesize absent external schemas, or provide adapters for every ORM/cloud/non-web program. Those must remain explicit capability/source/infrastructure failures, rather than asking for invented ENV values or claiming a successful run.

Source coverage still uses the existing Vite frontend and direct Node JavaScript backend collectors. Next/Astro/TypeScript startup does not imply measured source-coverage support. No schema migration, global package-manager installation or merge/deployment was introduced.

Research: [Express routing](https://expressjs.com/en/guide/routing/), [Prisma connection URLs](https://docs.prisma.io/docs/orm/v6/reference/connection-urls), [Redis Docker](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/docker/), [MongoDB Docker](https://www.mongodb.com/docs/v7.0/tutorial/install-mongodb-community-with-docker/), [Node randomness](https://nodejs.org/api/crypto.html#cryptorandombytessize-callback), [OpenAI SDK configuration](https://github.com/openai/openai-node/blob/main/docs/configuration.md), [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript), [Resend SDK constructor](https://github.com/resend/resend-node/blob/canary/src/resend.ts).
