# Background AI test improvement implementation plan

**Goal:** Run bounded AI improvement independently of the browser, recover progress after navigation, and show honest timing and usage in English.

**Architecture:** Keep BullMQ as execution owner. Persist request usage on the existing proposal JSON, expose snapshot-scoped latest proposal and timing, and publish the already verified candidate assessment on the server after apply. Reuse existing completion notifications and job cancellation. No schema migration or new dependency.

**Global constraints:** Preserve original tests and measured improvement gates; at most three rounds and six actual provider requests including retries; no fabricated token totals or countdown; responsive English UI matching existing tokens and spacing.

- [x] Add request-scoped AI budget using AsyncLocalStorage, count actual provider attempts and provider-reported token metadata, persist on success/failure, reject request seven before network dispatch. Test isolation, missing usage and retries.
- [x] Add historical runtime estimates from recent same-snapshot successful jobs. Insufficient history and overruns return unknown rather than zero. Add owner-scoped latest-proposal recovery and terminal cancellation reconciliation; test authorization and timing.
- [x] Persist verified candidate runs and a completed assessment server-side after saving tests, reusing assessment persistence. Test saved hashes and no browser dependency; retain failure evidence if publication fails.
- [x] Add reusable progress details with elapsed time, remaining range, requests, reported tokens, background explanation and cancellation. Restore latest proposal on mount; refresh on focus/visibility; avoid automatic client rerun for server-published assessments.
- [x] Run scoped backend suites, frontend ESLint/build and render desktop/mobile running, complete and failure states. Record actual results and limits.

Execute inline in the existing workspace; preserve unrelated changes and do not create commits.

## Verification

- Backend: 20 relevant suites / 122 tests passed before the final cancellation case; final focused rerun after cancellation/timing adjustments: 9 suites / 63 tests passed.
- Frontend: three improvement components pass ESLint. Production build passes with existing chunk-size/dynamic-import warnings. JobQueue retains an existing `react-hooks/set-state-in-effect` failure at its initial fetch effect; only its type-label configuration changed here.
- Browser: actual React assessment/review components with a local simulated API, dark desktop and 390px mobile. Navigation unmount/remount restores progress (48 -> 72); focus refresh switches to APPLIED and removes pending progress/cancel. Document width equals viewport width at 390px. Screenshots in ignored `tmp/background-*.png`.
- No live AI requests made for this feature verification. Provider metadata and request retries tested through the real Gemini service with a fake SDK.
- Server/worker/Redis must remain available for background execution. Browser closure does not cancel the job. Worker process restart recovery is outside this change; existing queue behavior remains.
- ETA uses at least three recent same-snapshot successful durations and shows an approximate range; insufficient history/overruns explicitly show unknown. Six requests is a request ceiling, not a billing or exact token cap. Failed provider requests may not report token usage.
