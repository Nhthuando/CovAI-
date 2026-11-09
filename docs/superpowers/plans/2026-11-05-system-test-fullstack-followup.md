# System Test follow-up

User-authorized implementation: restore test-level navigation to the sidebar; show a compact generation entry screen until actual spec files exist; use concise, meaningful Expected outcomes; keep Full Stack as the only new execution/generation mode. Preserve historical Frontend records and existing Unit/Integration behavior. Also address the pictured version-history failure without silently migrating or resetting the normal database.

## Delivery steps

- [x] Restore CoveragePanel, remove duplicate header test-level navigation, preserve URL state and mobile selection.
- [x] Use authoritative file discovery for the empty state; distinguish loading/error/empty; show one Generate tests action and enter the dashboard only after Apply creates files.
- [x] Make new UI/API execution, generation and historical checks Full Stack only; keep legacy report reads and low-level compatibility. Explain mocked legacy tests and missing Full Stack setup without offering removed modes.
- [x] Preserve subject, expected values and negation in assertion-derived Expected text; resolve local locator variables where possible. Refresh vague imported metadata with review invalidation, never silently approve it. Require review for unsupported descriptions.
- [x] Give version-history failures a completed error state with Retry and a specific migration message for missing schema. Read migration status only.
- [x] Run compact behavior tests, targeted lint and client build. No browser E2E/live AI/AUT. Update handoff with the new click path and any outstanding DB setup.

Design: reuse the existing sidebar and theme; empty state is one centered bordered panel with an English title, one explanatory sentence and one primary button. The populated workspace keeps Scenarios / Live run / Results. No decorative dimensions or capability promises in the empty screen. Full Stack remains explicit in the toolbar; Docker/backend/database setup failures remain actionable errors.

## Completion evidence and limits

- Restored CoveragePanel and removed header test-level navigation. Sidebar navigation owns URL updates, including legacy tab=system links; mobile selection closes the panel.
- Empty/workspace transitions use actual file counts. Framework config and old assessments do not unlock an empty workspace.
- New generation, Run, measured assessment, improvement and historical-check HTTP operations require Full Stack. Historical data and low-level parsers remain compatible; no Frontend records were deleted.
- Assertion descriptions retain subjects, values and negation, resolving local locator aliases without executing code. Vague imported outcomes are refreshed with review invalidation. Metadata validation rejects bare outcomes.
- Mocked legacy files remain viewable and selectable for review; incompatible selections are blocked from Run by both UI and server readiness. Their semantics are not silently converted.
- Version history stops loading on errors and offers Retry. Missing schema returns 503 / SYSTEM_VERSION_SCHEMA_REQUIRED without raw SQL details.
- Read-only database inspection confirmed three version tables are missing and migration history lists 26 pending migrations including init. No normal database migration or repair was performed; this environment gate remains explicit in the handoff.
- Checks: first focused 8 suites / 78 tests passed; final relevant 7 suites / 37 tests passed; four Node model tests passed; targeted System Test/CoveragePanel lint and client build passed. Layout has the same 3 errors / 2 warnings as committed HEAD (verified using stdin). Offline PGlite migration/Apply/Restore/historical-copy/recovery passed after updating draft generation to the Full Stack path. Backend/shared syntax passed.
- No browser E2E, live AI requests, AUT startup, normal DB writes, commit or push.

Missing-storage preflight is also checked before AI generation. The offline database check temporarily renames the suite-state table in PGlite and proves generation returns SYSTEM_VERSION_SCHEMA_REQUIRED without calling the provider. Normal database tables are untouched.

Selection follow-up: compatibility no longer disables checkboxes. The count includes all file-backed scenarios; incompatible rows show a status label and selected-count explanation. Run still requires current readiness and zero incompatible selections.

Confirm All follow-up: stale reviews with readable current Expected outcomes are now eligible for explicit renewed confirmation. The action confirms visible outcomes, keeps API hash checks, reports actual confirmed/skipped/failed counts, continues after individual failures, and places feedback above the table. Added two compact Node behavior cases and extended the backend stale/hash case; both Node tests and all five catalog tests pass. Targeted lint and client build passed. No live project outcomes were approved by the agent.
