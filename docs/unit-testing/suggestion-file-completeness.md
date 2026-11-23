# Complete source selection for test suggestions

Bulk suggestions now enumerate every page of the unit source inventory. The
dashboard loads that inventory across pages as well, so generated drafts remain
visible for files beyond the first 200 rows. The unit coverage endpoint no longer
truncates database metrics at 2,000 records before merging source files from disk.

The client and server share a four-metric eligibility check. A gap in statements,
branches, functions or lines requests more tests. Missing metrics remain eligible;
they do not establish 100% coverage. Generating a suggestion does not prove its
coverage: draft validation and Apply retain their runtime verification gates.

The server's all-files path merges the disk inventory even if coverage records
already exist. This includes untouched files absent from the latest run. Individual
generation failures are returned with their paths and reasons in `failedFiles`,
with `status: PARTIAL` and `requestedCount` for the requested inventory.

The dashboard records errors per file, continues the rest of a bulk batch and
reports returned/failed file counts accurately. Failed requests preserve existing
drafts. File rows below full coverage offer Suggest Tests or Retry Suggest Tests,
including files whose earlier drafts were applied but left coverage gaps.

Regression fixtures cover function-only gaps, unknown metrics, 600-file pagination,
later-page errors, missing disk files in a partially populated coverage inventory,
per-file AI failures and coverage database failures. AI generation and draft
validation are controlled test doubles in the source-selection regression tests.
