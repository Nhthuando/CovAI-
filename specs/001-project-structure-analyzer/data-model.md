# Data Model: Project Structure Analyzer

**Feature**: [spec.md](./spec.md)

## Existing entities and authorization boundary

### Project and ProjectSnapshot

- `Project.ownerId` is the authorization authority for every analysis, file, and job read/write.
- `ProjectSnapshot.id` identifies the source version; `rootDir` is an internal worker-only boundary and is never returned to clients.
- Add optional `ProjectSnapshot.structureAnalysis` relation. `storagePath` is also internal and is never returned by snapshot APIs because GitHub snapshots may store a local path there.
- A supplied snapshot must be selected through `{ id: snapshotId, projectId, project: { ownerId: userId } }`; an omitted snapshot selects the newest matching owned snapshot.

## Existing entity changes

### Job

- Add `ANALYSIS` to `JobType`.
- Keep the established persisted/API status enum: `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELED`. The UI label for `SUCCESS` is “completed”.
- Analysis jobs require `snapshotId`; their compact `resultJson` contains analysis record id, snapshot id, summary counts, and completion timestamp. The full graph is stored only in `ProjectStructureAnalysis.resultJson`.
- Add an ordinary query index for `(projectId, snapshotId, type, status)`.
- Add a PostgreSQL partial unique index on `(projectId, snapshotId, type)` with predicate `type = 'ANALYSIS' AND snapshotId IS NOT NULL AND status IN ('QUEUED', 'RUNNING')`.

State transitions:

```text
QUEUED -> RUNNING -> SUCCESS
                  \-> FAILED
```

- Duplicate requests only reuse an active job for the same project, snapshot, and type.
- A generic project/type active-job guard remains for job types whose current semantics require it; analysis uses its own snapshot-scoped lookup.
- On a partial-index unique violation, re-read the active analysis job and return it. A queued/running/failed replacement never overwrites the previous successful result.

## New entity

### ProjectStructureAnalysis

One persisted latest read model per analyzed snapshot.

| Field | Type | Rules |
|---|---|---|
| `id` | String | Primary key, generated like existing Prisma entities. |
| `snapshotId` | String | Required, unique foreign key to `ProjectSnapshot`. |
| `schemaVersion` | Int | Required, starts at `1`. |
| `resultJson` | String | Required serialized graph; excludes secrets and absolute paths. |
| `createdAt` | DateTime | Required creation timestamp. |
| `updatedAt` | DateTime | Updated only after a newer successful result replaces it. |

`ProjectSnapshot 1 — 0..1 ProjectStructureAnalysis`; deleting a snapshot cascades to its result. Historical graph rows are out of scope.

## Serialized result and API-safe values

- `resultJson` follows [contracts/structure-analysis-api.md](./contracts/structure-analysis-api.md): schema version, snapshot id, analysis timestamp, summary, graph, tree, function catalog, and diagnostics.
- Every result path uses `/`-normalized snapshot-relative paths. Node/function IDs derive deterministically from those paths and source locations.
- Diagnostics are data, not exceptions. Package names are deduplicated but retain declared origin/category metadata.
- Snapshot API metadata may include id, source, checksum, commit SHA, created time, `hasStructureAnalysis`, and schema version. It must omit `rootDir` and `storagePath`.

## Migration, deployment, and recovery

1. **Enum expansion**: Commit a standalone reviewed migration that runs `ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ANALYSIS'`. Do not use `ANALYSIS` in that transaction.
2. **Schema expansion**: After the enum is committed, apply the Prisma migration for the model, relation, and non-concurrent supporting indexes. Existing projects/snapshots/jobs remain valid and receive no analysis row.
3. **Active-job index**: Before enabling application code, preflight active analysis duplicates. Then run reviewed `CREATE UNIQUE INDEX CONCURRENTLY` for the partial unique index outside Prisma’s migration transaction. Monitor its result and validate the index.
4. **Deployment order**: enum migration -> schema migration -> concurrent index success -> Prisma generation/application deploy -> feature enablement. Previous code must remain running until the database operations are complete.
5. **Failure recovery**: A committed enum addition is harmless if later steps fail. Keep the feature disabled; inspect partial schema/index state and complete or forward-fix it. A failed concurrent index may leave an invalid index; drop that invalid index, resolve duplicates, and retry.
6. **Rollback**: Roll back code or disable the feature; do not remove `ANALYSIS` from the PostgreSQL enum automatically. Do not remove the new table/index as part of operational rollback. Any destructive cleanup requires a separately reviewed migration, backup, and explicit enum-recreation plan.
