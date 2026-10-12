# Managed Playwright module loading — 2026-10-12

The managed runner previously rewrote every ESM import of `@playwright/test` to a `file://` URL for `fixture.mjs`. Playwright transforms import syntax to `require()` in CommonJS packages, where that URL is not a filesystem module path. The resulting load failure also produced “No tests found.”

The runner now determines module mode from the source extension and closest package.json, uses filesystem paths and the CommonJS fixture for transpiled imports, and retains file URLs and the ESM fixture for native ESM. Copies use explicit `.cjs`/`.mjs` or `.cts`/`.mts` extensions so relocating a spec cannot change its module mode. Source files remain unchanged.

Verification:

- 66 tests passed across evidence, runner, setup, analysis job and report parser suites. Eight regression cases invoke the actual Playwright CLI on paths with spaces, covering nested package boundaries, helpers, JavaScript/TypeScript, ESM/CommonJS and frontend/full execution.
- A disposable copy of todoapp ran actual frontend/backend services and an isolated Docker MySQL database. A browser scenario created, read and deleted a todo through managed real-backend routing: 1 passed, 4 named steps, 1 PNG screenshot.
- The original frontend spec loaded and executed on that copy: 4 passed, 1 timed out (`User Interaction: Display mocked todos and toggle todo status`). No module-load or runner-discovery errors remained. That existing test timeout is unresolved by this module-loading fix.
- The frontend spec contains API mocks, so it is not eligible for full-system execution; full-system tests must use the real backend.
- Temporary copies, links, services and the owned database container were cleaned up. Verification did not regenerate source with Gemini or create project run records.
