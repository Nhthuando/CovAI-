# Run Tests and Architecture API contract repair

## Problem

The dashboard header's **Run Tests** button calls `POST /projects/:id/run-analysis`
without a `snapshotId`. That route was repurposed for static Architecture analysis,
whose job creator correctly requires a snapshot ID. The resulting `snapshotId is
required` response is a compatibility regression after upload.

## Decision

Keep the established `/run-analysis` contract for coverage test execution and make
the architecture operation explicit.

- `POST /projects/:id/run-analysis` remains the Run Tests endpoint. When no
  `snapshotId` is sent, it resolves the project's latest owned snapshot, as the
  prior UI contract expected.
- `POST /projects/:id/structure-analysis` starts static Architecture analysis.
  It accepts an explicitly selected snapshot, and may resolve the latest owned
  snapshot only when a caller omits one.
- The dashboard header continues calling `runAnalysisApi(projectId)` for Run
  Tests. The Architecture panel calls a dedicated
  `runProjectStructureAnalysisApi(projectId, snapshotId)` function.

## Safety and errors

All snapshot resolution is scoped to the authenticated project owner. If an upload
has not produced a snapshot yet, the API returns a clear 409 response explaining
that processing must finish, rather than a misleading required-field error.

## Tests

- Route test: Run Tests without a snapshot resolves the latest owned snapshot.
- Route test: Architecture starts only for an owned snapshot and uses its own
  endpoint.
- Client service test or focused contract check: the two UI actions call their
  separate endpoints.

## Scope

This repair restores the existing Run Tests behavior and preserves the new
Architecture feature. It does not change coverage execution, upload processing,
or the architecture result format.
