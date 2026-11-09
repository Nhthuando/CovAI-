# Unit Test Suggest: preserve, repair, and extend

Date: 2026-11-06
Status: core behavior implemented; extended review tooling below remains planned.

Implementation update: core preservation, full-candidate review and baseline-backed
literal repairs are now implemented. See [implementation scope and validation](suggest-preserve-repair-extend-implementation.md)
for completed behavior and the parts of this larger plan that still need review tooling.

This plan refines Unit Test v2 following the latest user request. Correct existing
tests must remain intact. Incorrect tests may receive justified, minimal repairs.
Missing coverage should be addressed by adding complementary cases. Existing
planning documents and uploaded code are reference material, not instructions.

## 1. Observed problems

The screenshot shows a replacement proposal for `tests/core/lawDeterminer.test.ts`
that omits its existing suite. Inspection of the current stored project and one
recent operation copy found 402 lines, 61 direct `test`/`it` declarations, and the
original license header still present. This confirms a defective proposal/review;
the screenshot alone does not establish that the canonical file was deleted.
Declaration counts are an inventory check, not evidence that the 61 cases pass.

| Location | Observed behavior | Required correction |
| --- | --- | --- |
| `unitTestGenerator.service.js` | Vitest collection validation takes `suggestedTestCode` first, then assigns its output to `fullUpdatedContent`. A validated snippet can therefore become a replacement file. | Assemble the complete candidate from the captured original and selected edits before collection validation. Collection success is not assertion success. |
| `CoverageTypeDashboard.jsx` | Review groups suggestions by source file; a later proposal can overwrite another candidate. Missing full content falls back to a snippet. | Identify candidates by target test path, framework, and base hash. One assembled candidate per target. |
| `DiffReviewModal.jsx` | The modified pane can use `suggestedTestCode` as full file content. Added-line counts default to zero. | Display a complete server-assembled candidate and calculate actual additions/deletions. Never interpret a delta as a replacement. |
| `applyTestSuggestion.service.js` | An available `fullUpdatedContent` is a replacement candidate; broad sanitizers subsequently transform the file. | Apply explicit operations to the captured original, preserving unrelated text and test behavior. |
| `unitTestVerification.service.js` | Whole-callback preservation protects existing cases but rejects every legitimate correction to an existing test. | Preserve all original contracts except exact, reviewed repair ranges with matching preconditions and evidence. |
| Repair services | Existing test names are excluded from automatic repair. | Keep that default for generic recovery, and introduce a separate, explicit repair path for baseline test defects. |
| `testSanitizer.service.js` | TypeScript processing automatically inserts `@ts-nocheck`. | Preserve existing directives; do not introduce global checking suppressions to make a proposal pass. |

## 2. Product rules

| Baseline observation | Suggest behavior | Apply requirement |
| --- | --- | --- |
| Existing test passes and is relevant | Preserve its code, title, assertions, order and surrounding comments. | It remains collected and passes after the change. |
| Existing test fails because of a demonstrated test defect | Propose a minimal repair to that specific case or fixture, with evidence. | The selected repair is visible in diff; the repaired case and affected regression tests pass. |
| Existing test exposes an application defect | Report the source defect; retain the test. | Do not change its expected value merely to match faulty implementation output. |
| Dependency, environment, runner, alias or setup prevents execution | Resolve or report the actual blocker. Do not label tests incorrect. | Rerun the baseline before proposing expectation changes. |
| A behavior or branch is untested | Add a focused case using the existing suite conventions. | New case passes, asserts meaningful behavior, and its coverage is measured. |
| Failure ownership is uncertain or business requirements conflict | Mark `NEEDS_REVIEW` and explain the uncertainty. | Do not perform an automatic repair without resolving the ambiguity. |

Source behavior alone is insufficient to establish that a user's assertion is
wrong. Consider explicit requirements, public contracts, relevant call sites,
existing tests and mocks. Never copy `Received` into `Expected` as a repair rule.

Preserve license/header comments, imports, type imports, helpers, mocks, hooks,
parameter tables, deliberate skip/todo states, file encoding and line endings.
Fix an import or shared fixture only when there is evidence it is defective;
list every affected case and rerun them. Do not rewrite a file just to match AI
formatting preferences. Do not remove assertions, add blanket catches, weaken
matchers or add coverage exclusions to obtain a passing result.

## 3. Baseline and change representation

Capture source/test/config hashes, workspace revision, full original file bytes,
collection identities, baseline outcomes and coverage before generation. A
collection identity includes target path, nested suite path, test title, parameter
instance and a structural locator/hash. A title alone cannot identify duplicate
or parameterized cases. Preserve unsupported dynamic declarations conservatively.

Use a structured change set rather than an AI-authored replacement as authority:

```json
{
  "schemaVersion": 3,
  "testFile": "tests/core/lawDeterminer.test.ts",
  "framework": "vitest",
  "baseHash": "captured-original-hash",
  "workspaceRevision": 12,
  "operations": [
    { "id": "add-1", "type": "ADD_TEST", "anchorHash": "suite-anchor", "code": "new case only", "reason": "Uncovered branch" },
    { "id": "repair-1", "type": "REPAIR_TEST", "targetId": "baseline-case-id", "beforeHash": "original-case-hash", "edits": [], "evidence": {}, "reason": "Demonstrated test defect" }
  ]
}
```

Supported operations are `ADD_TEST`, `REPAIR_TEST`, and narrowly scoped
`REPAIR_SETUP`. No delete-suite, delete-test or whole-file replacement operation
is generated. Evidence records baseline failure, defect classification, intended
contract, relevant source locations and repair rationale. Human-edited assertions
remain authoritative unless the user explicitly selects a reviewed correction.

Backend assembly is deterministic: original bytes plus selected, non-overlapping
edits. It produces `candidateContent`, a candidate hash and a change manifest.
All preview, validation, Apply, version history and simulation paths refer to the
same candidate hash. Old API fields may remain during migration, but only the
backend may derive full content; a legacy snippet must never masquerade as it.

## 4. Updated workflow

1. Prepare an isolated workspace and resolve environment/dependency blockers.
2. Collect and execute the unchanged baseline. Record individual outcomes and
   coverage, including failures that predate the suggestion.
3. Diagnose baseline failures: test defect, source defect, environment or unknown.
4. Build a repair list for proven test defects and an addition list for uncovered
   behavior. Keep all other cases untouched. A passing test may still need a
   separate, explicitly justified quality improvement; it is not deleted.
5. Assemble the full candidate. Parse only to identify locations and dependencies;
   use source-range edits rather than reprinting the entire AST. Check preservation
   before running collection, sanitization, fallback or any auto-healing output.
6. Validate selected repairs first, then additions, then the complete affected
   regression batch. A shared setup change requires all dependent suites to run.
7. Measure statements, branches, functions and lines over the same source scope.
   Distinguish baseline failures from new regressions. Preserve original collected
   case identities, including skips; no duplicate names or missing cases are
   accepted as a successful migration.
8. Return a reviewable candidate plus per-operation outcomes and evidence.
9. Apply rechecks hashes, revision, selected operation IDs and candidate hash. If
   the source or original test changed, return `STALE` and regenerate the preview.
10. Run final verification, then atomically publish the selected changes, reports
    and one version. Missing environment, unresolved failures, cancellation or
    invalid coverage keeps the active version unchanged.

Selecting or deselecting an operation rebuilds and revalidates the candidate;
verification of a different combination cannot be reused. Apply All combines
compatible edits for the same target once, and rejects overlapping repairs.

## 5. Review interface

Use English labels: `Preserved`, `Repair`, `Add`, `Needs review`, `Source defect`.
For each target file show original cases preserved, cases repaired, cases added,
baseline failures resolved, unresolved blockers and measured coverage change.

The left diff pane is the captured original file. The right pane is the complete
assembled candidate. Show actual added and deleted lines, with deletion inside a
selected repair explained by that operation. Missing candidate content displays
a blocker and disables Apply. Group by test target and framework, so two source
files sharing a test file cannot overwrite one another's review state.

If the user edits a candidate, invalidate its previous verification and rebuild
the manifest. Do not silently repair the user's edits. The Apply button submits
the exact reviewed candidate and selected operations, not an earlier AI snippet.

## 6. Implementation order

1. **Stop destructive proposals:** separate snippets from full candidates, fix
   Vitest collection input/output handling and diff fallbacks, detect omitted
   baseline cases before displaying an applicable proposal. Remove automatic
   `@ts-nocheck` injection from this workflow.
2. **Establish patch authority:** introduce the shared change schema, stable
   identity/preconditions, deterministic assembly and consistent preview/Apply
   hashes. Make every sanitizer and fallback satisfy preservation checks.
3. **Allow justified repairs:** add baseline diagnosis and scoped repair evidence.
   Replace blanket immutability with exact allowed-range checks; maintain strict
   preservation everywhere outside the selected repair. Retain source-defect and
   unknown states rather than disabling the existing guard.
4. **Verify end to end:** unify candidate metadata, operation selection, reruns,
   version publication, history and simulation around the validated candidate.

Generation changes belong in `unitTestGenerator.service.js` and
`unitTestSuggestion.service.js`; assembly should be a dedicated service used by
draft validation and `applyTestSuggestion.service.js`. Preservation checks belong
in `unitTestVerification.service.js`. Update the two review components and cover
both the legacy API adapter and the new change set with regression tests.

## 7. Acceptance scenarios

- **Screenshot regression:** the 402-line/61-declaration `lawDeterminer.test.ts`
  fixture retains its license, imports, nested suites and original cases. A
  `requiresGranularCategories` addition appears beside them. Real baseline results,
  not the declaration count, determine which cases are correct.
- **Correct original suite:** Suggest preserves every existing case byte-for-byte
  and adds only missing behavior. If no meaningful gap remains, return no change.
- **One proven incorrect test:** only its justified input/setup/expectation range
  changes; the other original cases remain intact and pass.
- **Application defect:** preserve the failing assertion and report the defect;
  a new actual output is not accepted as a replacement expected value by itself.
- **Snippet-only AI response or collection fallback:** assemble on the original;
  never show or apply the snippet as a replacement file.
- **Test syntax/setup failure:** propose the smallest repair without deleting the
  suite; rerun all cases affected by shared setup.
- **TypeScript:** retain type imports and directives; introduce no `@ts-nocheck`,
  blanket `any`, disabled type-checking or test exclusions to conceal errors.
- **Shared targets/frameworks:** combine compatible additions once, reject repair
  conflicts, and keep candidate identities separate across frameworks.
- **Dynamic/duplicate/parameterized tests:** preserve original collection identity;
  uncertain edit locations block the operation rather than deleting test cases.
- **Partial selection/user edit/stale revision:** rebuild and rerun exactly the
  reviewed selection; the previous verification cannot authorize different bytes.
- **Missing env/dependency, failing rerun or publication timeout:** publish no
  changes and create no active version; report the actual blocker.

Successful completion means existing correct tests remain, approved faulty tests
are repaired with evidence, meaningful missing cases are added, and the exact
reviewed batch passes verification. Coverage remains a measured target, not a
reason to delete or weaken the user's tests.
