# Unit Test workflow audit — 2026-11-06

Reviewed analysis/dependency recovery, source selection, generated-test repair,
review/apply preservation, environment blockers, mixed-runner verification,
source integrity, version publication/rollback and simulation integration.

## Changes from this audit

- Batch retries remove the known JSON reports from the current run and each
  framework output directory before execution. A previous successful report
  cannot satisfy a later run that produces no report.
- Every framework must produce fresh test and coverage JSON. One framework's
  coverage cannot hide missing reports from another. Unknown frameworks and
  empty batches return failed verification.
- Jest receives the project's configured Jest command. Runner initialization
  errors are recorded while other framework groups continue collecting results.
- Version switching returns a failed verification result for missing/malformed
  coverage, retaining the existing active version. Coverage rows are prepared
  before publication and persisted in database batches of 500.
- Client refresh errors are isolated from the Apply result. Once publication
  succeeds, a failed coverage/file refresh cannot mark the committed draft as
  FAILED. The interface asks the user to reload affected views. Browser storage
  cleanup is also independent of successful batch publication.

## Validation

- 26 backend Unit Test/dependency/runtime/publication suites: 262 tests passed.
  Fixtures include real Jest/Vitest execution for existing repair/trace scenarios;
  AI and database behavior use controlled doubles where the suite specifies them.
- 6 adjacent environment/simulation/publication suites: 153 assertions passed.
  This group completed assertions but retained its Jest process after completion;
  an open-handle diagnostic run also completed all assertions without identifying
  a handle. The remaining test process was interrupted after collecting results.
  This is a test-process cleanup limitation, not evidence of a clean process exit.
- Client queue/refresh tests: 6 passed, including query errors returned as data.
- Production client build passed. Existing bundle-size and dynamic-import
  warnings remain.

## Practical limits

No end-to-end run against the user's live project, AI provider, PostgreSQL or
Docker was performed. This local environment ran host-based test fixtures.
Deployment/restart and a fresh Analysis → Suggest → Review → Apply run with the
project's configured environment are still required to confirm those external
services. The checks above do not guarantee 100% coverage for arbitrary projects.
