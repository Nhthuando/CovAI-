# Structure Analysis API Contract

**Base path**: `/api`  
**Authentication**: Bearer token through `authMiddleware`.  
**Authorization**: Every route resolves the requested project/snapshot/job through `Project.ownerId = req.user.id`. A non-owner receives the same safe `404` response as a missing resource.

## Start analysis

`POST /projects/:projectId/run-analysis`

Request body:

```json
{ "snapshotId": "optional-snapshot-id" }
```

Behavior:

- Omitted `snapshotId` selects the newest owned snapshot; supplied ids must belong to the owned route project.
- An `ANALYSIS` job is active only when the same project, snapshot, and type is `QUEUED` or `RUNNING`.
- The operation is static; it never checks `hasJest` or starts `RUN_TESTS`/`BUILD_CFG`.
- This URL is retained for product compatibility. The temporary dual response supports current `data.job` callers and new consumers.

New job: `201 Created`; reused active job: `200 OK`.

```json
{
  "success": true,
  "reused": false,
  "needsTests": false,
  "snapshotId": "snapshot-id",
  "job": {
    "id": "job-id",
    "type": "ANALYSIS",
    "projectId": "project-id",
    "snapshotId": "snapshot-id",
    "status": "QUEUED",
    "progress": 0,
    "createdAt": "2026-08-04T12:00:00.000Z"
  },
  "data": {
    "job": {
      "id": "job-id",
      "type": "ANALYSIS",
      "projectId": "project-id",
      "snapshotId": "snapshot-id",
      "status": "QUEUED",
      "progress": 0,
      "createdAt": "2026-08-04T12:00:00.000Z"
    }
  }
}
```

`job` and `data.job` must contain identical safe fields. `needsTests: false` is retained only for current-client compatibility.

Expected errors: `401` missing/invalid token; `404` inaccessible project/snapshot; `409` snapshot exists but has no usable extracted root; `500` unexpected error with no internal path/secret.

## Read job data

### `GET /job/:jobId`

Authorize by joining the job to a project owned by the requesting user, not by comparing `job.userId` alone. Return only safe job fields, compact result, error, timestamps, and safe logs.

### `GET /job/user` and `GET /job/:projectId/jobs`

Both are project-owner-scoped reads. The user list includes only jobs whose project is currently owned by the requester; the project list verifies route-project ownership first. Neither response returns `payloadJson`, raw `resultJson`, absolute paths, or source content.

Status contract: `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELED`. Clients render `SUCCESS` as “completed”; no lower-case alternative is returned.

## Read persisted structure result

`GET /projects/:projectId/structure-analysis?snapshotId=optional-snapshot-id`

Resolve the selected/default snapshot through the owner-scoped resolver. The endpoint never starts analysis. It returns the latest completed stored graph or safe `404` when the project, snapshot, or result is unavailable.

## Safe snapshot and file-list integration

### `GET /projects/:projectId/snapshots`

Return selector-safe metadata only: `id`, `source`, `checksum`, `commitSha`, `createdAt`, `hasStructureAnalysis`, and analysis schema version when present. Never return `rootDir` or `storagePath`.

### `GET /files?projectId=:projectId&snapshotId=:snapshotId`

`projectId` is required; `snapshotId` is optional and defaults to the newest owned snapshot. The server resolves the snapshot and returns only normalized snapshot-relative source paths. The former `rootDir` query parameter is rejected and is never read from the client.

All file/job routes require authentication. Missing, foreign, or mismatched project/snapshot/job identifiers return a safe `404` without file paths, snapshot metadata, status, or result data.
