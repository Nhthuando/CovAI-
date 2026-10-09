# Project & Analysis Export Implementation Plan

**Goal:** Download snapshot source ZIP and analysis JSON/PDF from CovAI Studio.

**Architecture:** An authenticated project route delegates to dedicated export services. Analysis is collected from snapshot-scoped Prisma projections and rendered with PDFKit. ZIP walks the snapshot workspace with bounded file reads and credential exclusions. A focused React dialog owns snapshot and format selection.

**Tech Stack:** Express, Prisma, adm-zip, PDFKit, bundled Noto Sans, React 19, Jest/supertest.

## Global constraints

Preserve route -> controller -> service layering. Authenticate and verify `ownerId` against `req.user.id`. Use existing persisted snapshot data. Do not export secrets or server filesystem paths. No schema changes. Support Vietnamese names and professional paginated PDF layout.

## Task 1: Snapshot-scoped analysis collection and HTTP contract

Files: `server/src/services/projectExport.service.js`, `server/src/controllers/projectExport.controller.js`, `server/src/validators/projectExport.validation.js`, `server/src/routes/project.route.js`, `server/src/tests/projectExport.test.js`.

- [x] Validate `type=project|analysis`, `format=pdf|json`, and optional scalar snapshot ID; reject unknown query keys.
- [x] Collect owned project metadata and snapshot-scoped analysis through explicit Prisma selections.
- [x] Serialize `schemaVersion`, `exportedAt`, `project`, `snapshot`, and `analysis` with relative paths and explicit nulls for unavailable results.
- [x] Verify unknown/foreign project and snapshot failures before loading analysis.
- [x] Return attachments with safe deterministic filenames and `Cache-Control: no-store`.

## Task 2: Safe source archive

Files: `server/src/services/projectArchive.service.js`, `server/src/tests/projectArchive.test.js`.

- [x] Walk real snapshot root using `lstat`; skip symlinks, node_modules, .git, environment files, credentials, and caches.
- [x] Limit files to 10,000 and uncompressed bytes to 100 MiB, checking reads against remaining capacity.
- [x] Add normalized relative names to adm-zip and return Buffer plus exported/excluded counts.
- [x] Test source/test inclusion, private-file exclusions, traversal containment, symlinks, and limits.

## Task 3: Professional PDF

Files: `server/src/services/analysisPdf.service.js`, `server/src/assets/fonts/`, `server/src/tests/analysisPdf.test.js`, `tools/preview_export_report.mjs`.

- [x] Install PDFKit and bundle regular/bold Noto Sans with OFL license.
- [x] Render A4 overview, provenance, coverage bars, quality, test runs, structure, coverage details, and complexity tables.
- [x] Use measured row heights, repeated headers, continuation pages, embedded Unicode fonts, and page numbering.
- [x] Cap printed table detail with visible counts and a JSON detail note.
- [x] Generate empty and representative multi-page PDFs, extract text, and render pages for visual review.

## Task 4: Studio export dialog and verification

Files: `client/src/services/export.service.js`, `client/src/components/dashboard/ProjectExportDialog.jsx`, `client/src/components/dashboard/Layout.jsx`.

- [x] Add toolbar Export button and portal dialog following current theme tokens.
- [x] Fetch snapshot list, select snapshot and PDF/JSON/ZIP, show pending and error states, manage focus and Escape, and download authenticated Blob.
- [x] Run export tests, relevant existing auth tests, full server suite, frontend build and lint.
- [x] Inspect rendered dialog at desktop/mobile and PDF sample pages; document final limits and endpoint usage.
