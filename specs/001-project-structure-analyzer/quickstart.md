# Quickstart Validation: Project Structure Analyzer

## Prerequisites and quality gates

- PostgreSQL and Redis are running; the user owns a project with an extracted snapshot.
- Before deployment, follow the enum/schema/concurrent-index sequence in [data-model.md](./data-model.md). Do not enable the endpoint before the partial unique index is valid.

```powershell
npm test --prefix server -- --runInBand
npm run lint --prefix client
npm run build --prefix client
Push-Location server
npx.cmd prisma validate
Pop-Location
```

## API and compatibility smoke test

1. As owner, list snapshots. Verify no response includes `rootDir` or `storagePath`.
2. Start `POST /api/projects/{projectId}/run-analysis` with `{}`. Verify `201`, `ANALYSIS`, `QUEUED`, `needsTests: false`, top-level `job`, `data.job`, and equal job values.
3. Repeat it. Verify `200`, `reused: true`, and the same job id.
4. Poll `GET /api/job/{jobId}` through `SUCCESS` or `FAILED`; verify uppercase API status and UI maps `SUCCESS` to completed.
5. After success, read the stored result. Verify normalized relative paths, graph/tree/functions/diagnostics, and no host paths or secrets.
6. Start analysis for an owned older snapshot; verify the job/result identify that snapshot. Start analyses for two distinct snapshots concurrently; verify both are permitted.
7. Make an owned snapshot's extracted root unavailable before start. Verify `409`, no analysis job is created, and any previous stored result remains readable.

## Authorization and exposure checks

- For owner/non-owner/anonymous/missing-resource cases, exercise snapshots, tree, file content, `GET /api/files`, job detail, user jobs, project jobs, analysis start, and stored-result read.
- Verify a non-owner always receives safe `404` and cannot infer project, snapshot, job, file, or result existence.
- Verify `GET /api/files` requires `projectId`, defaults its owned snapshot correctly, rejects `rootDir`, rejects a foreign snapshot, and returns relative paths only.
- Verify job lists/detail authorize through the current project owner even if a job has a matching historical `userId`.

## Migration runbook checks

1. Apply enum migration, then schema migration, then preflight and create the partial unique index concurrently.
2. Confirm no invalid index remains and the index prevents two active `ANALYSIS` jobs for one project/snapshot while allowing distinct snapshots.
3. Simulate failure after enum expansion and failed concurrent-index creation; confirm feature remains disabled, legacy data remains readable, recovery is forward-fix, and code rollback does not attempt enum removal.

## Quantitative success criteria

| Criterion | Evidence |
|---|---|
| SC-001 | Benchmark 1,000 supported files; complete in <= 30 seconds. |
| SC-004 | Fixture oracle shows >= 95% correct named-function ranges, async state, and export visibility. |
| SC-005 | Mixed fixture labels 100% detectable ESM/CommonJS files correctly and reports `Mixed`. |
| SC-007 | Ten representative users locate role, direct dependencies/dependents, and exported functions; >= 9 finish within five minutes. |
| SC-008 | Repeated unchanged runs have identical IDs and equivalent graph relationships excluding timestamps. |
| SC-009 | Fixture with malformed/unreadable file analyzes >= 99% of other readable supported files and records diagnostics. |

## Consumer UX checks

- The dashboard defaults to newest snapshot, retains a selection while polling, shows `ANALYSIS` progress, then loads the persisted result without a browser-side scan.
- Failure presents an actionable message and leaves any previous completed result visible.
