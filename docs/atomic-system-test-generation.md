# Atomic Playwright system tests

New Playwright generations request one primary behavior per scenario. Create, delete,
update, completion toggle and editing cancellation use separate cases. Each case
creates its own unique prerequisites rather than depending on another case.

Generated cases use awaited Setup, Action, Assert, Evidence and Cleanup steps.
The generation boundary validates one declared Action, outcome assertions and a
PNG checkpoint before cleanup. It rejects compound CRUD titles, constant outcome
assertions, conditional visibility/actionability fallbacks and global button
selection by position. This structural check cannot prove complete business
coverage or infer every semantic behavior from arbitrary JavaScript.

Full Stack candidates must also pass twice against fresh disposable databases
before replacing the saved suite. Normal Playwright AI generation checks the same
structure before its existing dry run. Cold-start syntax/provider fallback remains
a limited smoke template, explicitly marked `fallbackUsed` and `smoke-only`; an AI
candidate failing quality validation is rejected before saving. Cypress generation
does not use this Playwright phase validator.

The Playwright JSON parser prefers the named `evidence` PNG checkpoint, including
inline base64 bodies. Evidence storage validates the PNG signature and size and
writes it under the snapshot's evidence directory. Automatic end-of-test images
remain the fallback when no named checkpoint exists. This prevents cleanup from
replacing a successful-create screenshot with an empty list.

## Todoapp verification, 2026-10-12

Gemini 3.8 Flash generated six independent cases: create/persistence, toggle,
update/persistence, cancel editing, delete/persistence, and invalid blank input.
All six passed two fresh-database verification runs and the production analysis
flow. The saved suite is `tests/system/ai-generated.spec.js` within the imported
snapshot. Source-supported cases do not imply exhaustive business coverage.

Regression tests cover phase validation, separate cases, misleading assertions,
checkpoint ordering, inline evidence preference, PNG validation, and generation
boundaries.
