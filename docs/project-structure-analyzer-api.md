# Project Structure Analyzer API

All endpoints require authentication and resolve ownership through the current project owner. Non-owners receive a safe `404`.

- `POST /api/projects/:projectId/run-analysis` accepts optional `{ "snapshotId": "..." }`, returns `201` for a new job or `200` when an active job is reused. `job` and `data.job` contain the same safe job fields; `needsTests` is always `false`.
- `GET /api/projects/:projectId/structure-analysis?snapshotId=...` returns the stored completed graph and never starts work.
- `GET /api/projects/:projectId/snapshots` omits filesystem paths. `GET /api/files?projectId=...&snapshotId=...` returns normalized relative source paths and rejects `rootDir`.
- Job APIs use upper-case persisted statuses: `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELED`; clients may present `SUCCESS` as completed.
