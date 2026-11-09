# Project Structure Analyzer verification

Checked on 2026-08-05:

- Architecture-focused server suite: pass — 13 suites, 29 tests. It covers discovery, parser support, function metadata/CFG, dependency resolution, stable graph output, 1,000-file performance, job creation, worker persistence/failure preservation, routing, authorization, and migration shape.
- Prisma schema generation and validation: pass. `prisma migrate status` against the configured PostgreSQL database reports that all 8 committed migrations are applied.
- Client production build: pass. Vite emits only the pre-existing dynamic-import and large-chunk warnings.
- Feature-scoped client lint: pass for `ProjectArchitecturePanel.jsx` and the Architecture API client.
- Endpoint contract repair: pass. `POST /projects/:id/run-analysis` resolves the latest ready owned snapshot for coverage Run Tests; `POST /projects/:id/structure-analysis` queues static Architecture analysis. A project still being uploaded returns a clear 409 processing response instead of `snapshotId is required`.
- Regression suite for the endpoint contract: pass — 4 suites, 13 tests covering routing, owner-scoped snapshot resolution, Architecture job creation, and worker persistence.
- Full client lint: fails with 60 pre-existing project-wide errors in unrelated components/hooks. The Architecture files introduce none.
- Full server Jest suite: 17 passing suites, 6 failing suites. The remaining failures are existing ESM/Jest mock setup and stale-module-path issues in coverage, snapshot-reuse, notification, AI test, and AI suggestion suites; they are outside the Architecture feature.

## Deployment status

The `Job_active_analysis_per_snapshot_key` PostgreSQL partial unique index has been created after the duplicate preflight returned zero rows. PostgreSQL reports the index as valid and ready, closing concurrent-request races for active `ANALYSIS` jobs on the same snapshot. The reviewed operational SQL remains in `server/prisma/operations/project-structure-analysis-index.sql` for future environments.
