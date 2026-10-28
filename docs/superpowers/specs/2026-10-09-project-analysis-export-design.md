# Project & Analysis Export

Approved by the user on 2026-10-09, with a requirement for professional document formatting.

## Outcomes

The Studio toolbar opens an export dialog. Users select a project snapshot and download either its source ZIP, a structured analysis JSON, or a professionally typeset A4 PDF. The default is the latest snapshot. Exports use existing persisted analysis and never trigger a new analysis.

## Contract

- `GET /api/projects/:id/export?type=project&snapshotId=...` returns ZIP.
- `GET /api/projects/:id/export?type=analysis&format=pdf|json&snapshotId=...` returns an attachment.
- Authentication and project ownership are mandatory; snapshot selection is scoped to that project. Unknown projects/snapshots return 404. No ready source for ZIP returns 409. Invalid parameters return 400.
- JSON includes explicit schema version, export time, safe project/snapshot metadata, coverage, complexity, structure, quality, and test runs. No host paths, account credentials, job payloads, or raw execution logs are exported.
- ZIP includes workspace source and tests, excluding dependencies, VCS metadata, environment/credential files, build caches, and symlinks. File count and aggregate byte limits reject oversized exports before allocation.
- PDF uses embedded Noto Sans regular/bold for Vietnamese, restrained navy/teal styling, an overview with coverage bars, provenance metadata, quality score table, test execution summary, file coverage and complexity tables, structure overview, and page numbering. Missing analyses are labeled, not represented as zero. Tables repeat headings and wrap long paths. Large reports summarize detail with explicit counts; JSON retains detail.
- UI follows existing Studio tokens, supports keyboard focus and mobile widths, permits snapshot selection, prevents duplicate downloads, and displays download errors.

## Implementation

Dedicated export controller, validation module, collection service, archive service, and PDF renderer keep the existing project controller small. PDFKit supplies embedded fonts and buffered page numbering without browser or Python requirements in production. Existing adm-zip creates source archives. No database migration.

## Verification

Jest/supertest checks auth, ownership, snapshot isolation, input validation, content types, disposition, missing data, and safe projections. Archive tests inspect entries, credential exclusions, symlink handling, and limits. Render representative multi-page and empty PDFs to inspect Vietnamese glyphs, wrapping, headers, and footers. Build frontend and run lint; record any pre-existing failures.
