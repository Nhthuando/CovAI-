# Dashboard refresh and screenshot recovery

Fix authorized regressions in the existing background improvement feature.

- [x] Confirm the reload loop at the full dashboard boundary, not just the review component. Keep framework discovery scoped to project/snapshot and deduplicate completion refreshes by proposal ID. Preserve loaded results during background refresh and transient errors.
- [x] Inspect the affected real snapshot. Seven saved PNGs exist at repository root, but stored root points to its backend. Resolve both recognized evidence locations inside the owned repository, retain path containment and ownership checks.
- [x] Bound evidence fetches to 15 seconds, handle invalid image decoding, and expose an English retry action.
- [x] Run backend regressions plus browser end-to-end tests using the full production dashboard, authenticated API, real stored scenario records and real PNGs. Cover delayed refresh, search/filter state retention, enlarge/report/navigation, error/retry and unauthorized evidence access.
- [x] Record verification and clean temporary test infrastructure. Do not consume AI quota or change the user's test source.

## Evidence and results

Two independent causes were confirmed: refreshKey was part of discovery identity, unmounting the review and resetting its completion guard on each completion refresh; seven saved PNGs were repository-relative while snapshot.rootDir pointed to the backend package. Before the fix, all seven authenticated evidence downloads returned 404. After the fix, all seven returned 200 image/png with valid signatures (324–346 KB).

Affected snapshot: `cmv7olxsq0002ys7kjsw5nsu7`. Saved run: `cmv9jk9yw001yac7k7rr3a3ml` (7 passing scenarios). Existing screenshots recovered without regenerating tests or consuming AI quota.

Browser regression: **4/4 passed**, using the full production SystemTestDashboard and real authenticated API/PostgreSQL/file storage, with a development-only entry point. Only the deliberate 503 retry case injects a failure; the successful retry uses the real API. The slow-refresh case delays requests while preserving their real responses. Initial readiness waits allow for real database latency.

1. All seven real PNGs download; anonymous access is 401 and unrelated owner is 404.
2. After one initial discovery and one legitimate completion refresh, three delayed manual refreshes preserve the same image URL and EDIT filter. An 11-second observation window spanning the status poll interval detects no discovery flashes or additional framework requests.
3. Actual image decoding succeeds in preview, enlarged modal, printable report, after leaving/returning, and after browser reload.
4. A failed screenshot download shows English error/retry; retry decodes the real PNG. At 390px mobile width, document width is exactly 390px.

No unhandled browser page errors in the passing suite. Screenshots: ignored `tmp/dashboard-stable-evidence.png` and `tmp/dashboard-evidence-mobile.png`. The Vite test server closes in afterAll; the user's existing API stays running.

Backend: **101/101 tests, 13 suites passed**, including path containment, legacy package evidence, owned endpoints, assessment and improvement regressions. Scoped ESLint passes. Frontend production build passes with existing large-chunk/dynamic-import warnings.

Reproduce from server/ with both applications' dependencies installed and the local API running:

```powershell
$env:COVAI_E2E_JOB_ID='cmv9jbauq0000ns7k6hl7zy87'
node node_modules/playwright/cli.js test --config e2e/system-dashboard.config.mjs
```

For another local dataset, select an owned APPLIED improvement job with a saved Full Stack run containing screenshots. The suite uses a short-lived test JWT in memory; it does not submit AI generation or execution jobs.
