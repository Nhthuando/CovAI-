# Source-guided repair of generated expectations

An assertion mismatch does not establish an application bug. New generated tests
can incorrectly assert an intermediate result while overlooking later filtering,
merging or cleanup steps. Generation now explicitly reviews the complete return
path and contradictions between sibling tests.

During draft validation and Apply, dependency recovery and input repair run first.
If assertions still fail, CovAI can review exact literal expectations in new
generated cases. The review receives full source and sibling tests, deliberately
without the runner's Received values. Each proposed correction must identify a
generated expectation error, explain the path through the source, and cite exact
executable snippets from the imported exported function.

Only literal arguments to `toEqual`, `toStrictEqual` and primitive `toBe` are
editable. Inputs, matcher methods, assertion counts, mocks and application code
remain unchanged. Existing tests and suggestions marked as user edited are
excluded. Unsupported imports, mocked implementations, ambiguous multi-assertion
cases, missing source evidence and concurrent edits are left for review.

All edits remain proposals until the complete batch runs again. The existing
coverage, source-preservation and version-publication gates still apply. A failed
rerun cannot publish a new active version. Repair reasons and rerun status are
included in validation metadata; the preview uses the exact validated content.

This is a source-guided characterization mechanism, not proof that an application
satisfies its business requirements. The reviewer is instructed to leave conflicts
with documented requirements or existing contracts unresolved. If AI review is
unavailable or uncertain, the original failure remains visible.

Regression fixtures reproduce missing model-content filtering, merging a new user
prompt, and pruning a trailing user turn. Tests run real Vitest before and after
repair and exercise Apply rejection of an incorrect proposal. AI review responses
are controlled in these tests; they do not measure live model accuracy.
