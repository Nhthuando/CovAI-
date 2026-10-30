# System test generation and empty state

User-authorized scope: repair invalid generated tests and simplify the no-test screen. Keep English copy and existing design tokens.

1. Align cold-start prompts with quality rules; include bounded complete application source files and declared omissions. Discover routes by default instead of assuming login/cart routes.
2. Validate generated syntax, safety and Playwright phases before saving. Allow one AI correction using the validation error. Provider failure or two invalid responses must not save a synthetic fallback suite.
3. Make framework discovery an explicit loading/error/empty/ready state. Empty projects show one Generate action; do not render Run, empty metrics, coverage or results. Generation success refreshes discovery.
4. Test correction success, repeated rejection and provider failure without test writes; run existing generator and quality suites, focused lint and frontend build.

Compatibility boundary: browser system tests apply to runnable web applications, not every JavaScript package or CLI. Existing frontend startup discovery supports common web scripts; full-stack execution requires backend/database configuration. Coverage instrumentation has separate framework limits and must report unsupported capabilities honestly.
