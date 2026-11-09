# Suggest preservation and baseline-backed repair

Implemented on 2026-11-06 following the preserve/repair/extend plan.

## Behavior

- A model delta is composed on the captured original file. Original comments,
  licenses, imports, helpers and test bodies retain their source bytes. Matching
  nested suites receive additions in place. Conflicting helper changes require
  review; empty additional suites do not replace an existing suite.
- Vitest collection receives the complete candidate. Its returned code is composed
  again against the original so a collection fallback cannot become a replacement
  file. Global `@ts-nocheck` is no longer injected automatically.
- Existing assertion failures are diagnosed from an unchanged baseline during
  draft validation. Literal expectations may be repaired only when source evidence
  and a documented contract or baseline-passing sibling support a test defect.
  Source behavior alone is insufficient. AI review proposes edits without writing
  them into the baseline.
- Existing repairs are exact source ranges bound to original test and source hashes,
  project, snapshot and target path. A server signature protects that evidence from
  client modification. Apply runs a fresh baseline and rejects altered, stale,
  overlapping or no-longer-failing repairs.
- Preservation compares the final candidate to the original plus only those verified
  repair ranges. Existing assertions outside the repair cannot be weakened by generic
  recovery. Source immutability is checked before returning a verified draft or
  publishing a version.
- Baseline dependency recovery is bounded and runs in the operation workspace. A
  baseline failure is reported separately from candidate failures. Providers and
  tests remain outside database publication transactions.
- The review uses a complete server candidate, actual added/deleted line counts,
  target-file/framework identity and the exact reviewed hash. Missing candidates
  and conflicting shared-target proposals block Apply instead of showing a snippet
  as the replacement file. Editing a candidate invalidates prior verification.
- A successful no-op preserves the existing suite and creates no new version.

## Scope and remaining review cases

Automatic existing-test repair currently supports exact literal expectations in
unambiguous, directly imported named-function tests. The engine preserves matcher
strength, inputs and setup for this path. Mocked implementations, ambiguous dynamic
cases, unsupported syntax and uncertain business contracts remain failures or need
review; they are not fixed by deleting tests or changing application code.

Generic existing setup/hook rewrites and per-operation selection controls from the
larger plan are not implemented here. Different candidates sharing a target are
blocked pending a combined review; identical batch candidates are deduplicated.

`TEST_PROPOSAL_SECRET` or the configured `JWT_SECRET` provides signing stability
across processes. Without either, proposals use a process-local key and must be
regenerated after a restart. No secret is included in a proposal.

## Validation

Regression fixtures cover 61 preserved original declarations, nested-suite insertion,
license/type-import preservation, source-range repair, full-candidate collection,
real review diff counts and missing/conflicting candidate blockers. Real Vitest
and V8 coverage runs verify a passing existing case, a contract-backed correction,
a missing additional case and no-op version behavior. Tests reject modified or
stale repair records and repairs to cases that no longer fail baseline.

AI responses are controlled in these regression tests. They establish orchestration,
preservation and publication behavior, not perfect live-model diagnosis for every
project or an end-to-end test against the user's database.
