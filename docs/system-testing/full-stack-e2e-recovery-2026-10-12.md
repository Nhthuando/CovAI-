# Full Stack generation and execution recovery

The observed 22% pause was a Gemini 503 retry during setup generation. The original job eventually failed because it selected mocked frontend tests for full-system execution.

## Changes

- Fixed default-model `generateText` forwarding: its fifth-argument generation configuration was discarded when the selected model was null. JSON MIME type, response schemas and output limits now reach the SDK.
- Requests have an abortable timeout and overall retry deadline. Setup uses 60 seconds per attempt / 150 seconds total; verified test generation uses 120 / 300 seconds. Both allow three provider attempts. Waiting messages publish every 15 seconds; retry messages identify attempt and delay. Exhausted requests finalize the job as failed instead of leaving running progress indefinitely.
- Transient 503, network failures and minute-level 429 retry the preferred model. Only explicit daily quota exhaustion marks a model exhausted. The configured preferred model remains Gemini 3.8 Flash.
- Full-system execution prefers `tests/system`. If only frontend mocks or no runnable suite exist, it generates a separate real-backend suite and requires two successful fresh-database verification runs before saving it. Explicitly selected mocked tests remain rejected. Existing frontend files stay intact.
- Setup instructions accept source-supported SQL queries as schema evidence even when the repository contains no DDL file. Generated tables/columns still require backend source evidence and schema-only SQL validation.

## Actual verification

- All 142 regression tests passed across 13 backend suites, including SDK configuration forwarding, transient model retention, abort/deadline handling, heartbeat cleanup, suite selection, job finalization, parsing and owned endpoints.
- Source-only setup verification on a disposable todoapp copy with no configuration generated `.covai/system-test.json` and a MySQL schema using Gemini 3.8. Environment files and credentials were excluded; the copy was removed afterward.
- Production job `cmv4s574t0000jg7k06es9uhu` on snapshot `cmv4qt1fk0001aw7kmyjzrmjg` completed SUCCESS 100%. Gemini 3.8 generated four user journeys: add/reload/delete, completion toggle persistence, edit/cancel/persistence and input/button validation. All passed two verification runs with fresh MySQL databases and the final analysis run.
- Stored run `cmv4s8oll001ojg7k5ixvqk23` has 4 passed / 0 failed, named execution steps and four screenshots. The verified suite is saved at `tests/system/ai-generated.spec.js` in the imported server snapshot.
- Two real HTTP tests exercised authenticated production handlers with real PostgreSQL data: summary/scenarios returned the stored full run, all four PNGs downloaded, frontend mode selected a different run, anonymous access returned 401 and a different owner returned 404. Queue scheduling was isolated for this read-only verification; database, auth, handlers and evidence files were real.
- Earlier verification attempts exposed the discarded-config bug and exercised 503 exhaustion. They finalized as FAILED; no report was presented as passed. A remote provider outage can still prevent new generation, but saved valid configuration/suites are reused on subsequent runs.
