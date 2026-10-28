# Full system execution and scenario evidence

Implement the user's requested full-system mode and screenshots in the existing System dashboard. Keep the existing frontend/mock mode explicitly selectable; never silently downgrade full-system execution.

1. Add an isolated full-stack lifecycle service: read `.covai/system-test.json`, validate contained paths, provision a per-job Docker MySQL/PostgreSQL database, initialize only that database, start backend/frontend with separate available ports, require backend readiness, clean up owned resources on success/failure.
2. Run Playwright in a per-job report directory with screenshot capture for all tests. In full mode transparently forward frontend API requests to the actual backend and forbid test mocks. Preserve original source/spec files by running prepared copies that import a managed fixture.
3. Persist execution mode and validated screenshot attachment paths per TestRun/scenario. Serve PNG evidence through authenticated ownership checks and contained real paths; UI loads images through the API service as blobs.
4. Carry execution mode from the System mode selector through AI generation/dry-run and analysis. Full-mode prompts forbid mock responses and require reload/persistence checks. Reject mocks before saving full-system generated tests.
5. Add scenario thumbnails and an enlarged image viewer. Label the actual last run's mode and preserve historical runs without screenshots.
6. Configure the imported todoapp with an explicit disposable MySQL schema. Verify real create/reload/edit/toggle/delete through its backend, inspect saved evidence in the authenticated browser, and run regression/build checks.

Use the official Playwright screenshot/attachment and Docker database interfaces. No production database credentials are used for provisioned databases. Resource cleanup targets only containers/processes created by the current run.
