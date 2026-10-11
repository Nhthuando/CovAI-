# Automatic Full Stack setup and inline scenario evidence

## Requested behavior

When an imported repository does not contain `.covai/system-test.json`, CovAI prepares the Full Stack setup from repository evidence and uses Gemini to fill supported gaps. Users can see captured screenshots directly beneath their scenarios without opening a modal first.

## Existing behavior and problems

- `readFullSystemConfig` synchronously rejects a missing setup file. The run endpoint now calls it before enqueueing, so an unconfigured project never reaches background preparation.
- Full Stack provisions a disposable MySQL or PostgreSQL database through Docker, loads SQL, starts the backend and frontend, and stops its resources afterward.
- The current todoapp snapshot points at the `server` package. Its frontend is a sibling `client` package under the imported Git repository. Stack setup must distinguish the repository boundary, application directories, and the test execution directory.
- The five recent screenshots exist and the authenticated PNG endpoint works. Scenario actions currently open a modal; screenshots are not displayed inline.
- The recent frontend run produced four passing scenarios and one flaky scenario. Its screenshots show that MySQL is unavailable; browser-only success does not verify persistence.

## Chosen approach

Prefer existing configuration and repository detection, then use AI for missing supported setup information. Pure AI generation would obscure useful source evidence and cause repeated model calls. Requiring every user to author configuration manually would preserve the current obstacle.

### Full Stack preparation

1. Validate snapshot ownership before inspecting source or generating files.
2. Resolve the imported repository boundary from snapshot metadata and existing repository structure. Keep the test execution directory separate from the stack root. Never traverse into unrelated sibling repositories or follow an escaping symlink.
3. Reuse and validate an existing user-authored configuration. Do not overwrite it or existing schema files.
4. For missing configuration, enqueue a preparation phase before Full Stack execution or full-system test generation. Emit progress such as inspecting source, preparing configuration, and starting the stack.
5. Inspect bounded application source, package scripts, database adapters, schema files and migrations. Exclude credentials, `.env` files, dependencies, generated artifacts and repository instructions from executable authority.
6. Detect frontend/backend directories and a supported database engine. Reuse compatible existing SQL initialization when available. Use the existing Gemini service and its current model to generate structured setup JSON and, only when needed, initialization SQL from source evidence.
7. Require evidence for the selected engine, directories, startup scripts, backend readiness endpoint and database tables/columns. Return a clear missing-information result when evidence is insufficient; do not report fabricated configuration as runnable.
8. Validate the generated object against a strict schema, constrain all paths to the imported repository, confirm startup scripts already exist, and validate initialization SQL for the disposable test database. AI output cannot introduce arbitrary shell commands, credentials, external database URLs or access to host files.
9. Write validated generated files atomically under the imported snapshot repository, including `.covai/system-test.json` and `.covai/system-test-schema.sql` when SQL generation is needed. Serialize concurrent preparation for the same snapshot. Subsequent runs reuse these artifacts; invalid existing configuration produces an actionable error rather than being overwritten.
10. Start the real frontend, backend and disposable database using the validated setup. Missing Docker or failed readiness is an explicit infrastructure failure. Preserve the original exception while cleaning up resources.

The configuration remains an implementation artifact. The user flow is Run Full Stack → Preparing environment → Running tests → Results or an explanation of missing prerequisites.

### Inline evidence

- Render a screenshot preview directly beneath each visible scenario that has screenshot evidence, including passed, failed and flaky scenarios. Keep the existing file grouping and table columns.
- Load authenticated PNGs as blobs when previews enter the viewport, with bounded concurrent requests. Revoke object URLs when scenarios change or previews unmount.
- Keep a compact preview with its scenario caption and allow clicking it to open the existing evidence modal at full size.
- Show a loading state and an explicit unavailable-image state. Do not silently display JSON responses as images or retain another scenario's image after an error.
- Retain breakpoint/editor actions. Hide the redundant Evidence action when a preview is present.
- Reuse the preview component in the report view so the displayed report also contains scenario evidence. Print only loaded images and show an honest unavailable/loading state for images not ready.

## Validation

- Existing valid configuration bypasses AI and remains byte-for-byte unchanged.
- Missing configuration with adequate source evidence produces a valid setup; inadequate evidence reports the missing prerequisites.
- Test malformed AI JSON, unsupported engines, missing scripts, escaping paths/symlinks, unsafe SQL, model failure and concurrent preparation.
- Verify monorepo setup can start a frontend sibling while running tests from the backend package directory.
- Verify the run endpoint accepts missing configuration for background preparation instead of returning the old preflight error; explicit invalid configuration still fails clearly.
- Verify progress, failure finalization and cleanup for missing Docker, database startup failure and application readiness failure.
- Verify screenshots load inline for passing and flaky scenarios, use authenticated image requests, support enlargement, and release object URLs.
- Run relevant backend tests, frontend lint/build, and inspect the rendered scenario list and report.
- Full Stack runtime acceptance requires Docker and a supported application schema. If those are unavailable, report that limitation without claiming a successful full-system execution.

## Scope

Keep Gemini 3.8 Flash as configured. Support the lifecycle's existing MySQL/PostgreSQL engines. Do not add a new database engine, weaken full-system test assertions, mock backend/database behavior, overwrite user setup, or migrate the CovAI database.
