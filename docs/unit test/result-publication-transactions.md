# Result publication transactions

An expired transaction reported by `jobLog.create` can originate earlier in the
same result-publication transaction. The log is written after result persistence,
so its failure does not by itself identify the slow query.

Coverage summary parsing and Unit Test Apply now use parameterized PostgreSQL
bulk upserts of at most 500 files. Existing CoverageFile IDs and rows outside the
submitted set are preserved. Duplicate file keys are resolved before insertion.
An SQL failure propagates; queries are never retried on an expired transaction.

CFG computation and serialization run before publication. CFG and cyclomatic
records are inserted in linked batches, replacing two sequential writes per
function. Snapshot replacement remains inside the guarded publication scope.

The bounded result commit uses a shared 120-second budget for worker publication,
immediate operation publication and draft-validation completion. Project
admission retains its existing 60-second budget. Dependency installation, AI
requests and test execution are outside result-commit transactions. The redundant
outer transaction around Vitest summary parsing has been removed.

No schema migration is required. Restart backend and worker processes to load
the changes. Database failures still abort publication; this does not mark an
uncommitted batch successful.

Regression checks cover large batches, parameter binding, deduplication, CFG
relationships, deferred publication and the absence of query retries after an
expired transaction. These checks use controlled database clients. Live database
latency and transaction behavior require a configured disposable PostgreSQL
database; the current shell has no initialized Prisma/DATABASE_URL connection.
