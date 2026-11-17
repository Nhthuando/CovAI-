# Project & Analysis Export

In CovAI Studio, select **Export** in the top toolbar, choose a snapshot, then download **PDF**, **JSON**, or **ZIP**. The initial selection uses the displayed project's snapshot when available, otherwise the latest snapshot. Exports use saved results and do not start analysis jobs.

## Downloads

| Request | Content |
| --- | --- |
| `GET /api/projects/:id/export?type=analysis&format=pdf&snapshotId=:snapshotId` | A4 PDF with coverage bars, snapshot provenance, quality scores, latest test runs per runner/mode, structure, file coverage, complexity, security findings, and saved recommendations |
| `GET /api/projects/:id/export?type=analysis&format=json&snapshotId=:snapshotId` | Structured analysis including coverage files/functions, complexity, structure, quality, test history/scenarios, suggestions, CFGs, performance and vulnerabilities |
| `GET /api/projects/:id/export?type=project&snapshotId=:snapshotId` | Source and test files currently present in the snapshot workspace |

Use `Authorization: Bearer <token>`. Omitting `snapshotId` chooses the latest snapshot; omitting `type` and `format` chooses analysis PDF. Do not send `format` for a project ZIP. Unknown query keys, duplicate parameters and invalid snapshot IDs are rejected. Responses contain `Content-Disposition: attachment`, `Content-Length`, and `Cache-Control: no-store`. CORS exposes the attachment filename.

For GitHub monorepos, Explorer, file editing, Git commands, source ZIPs and checkpoints use the full cloned repository. The snapshot analysis root remains the selected package (for example `server/`); PDF/JSON contain the saved analyses for that package and do not imply that every package was analyzed. Existing imports already retain the full clone, so they do not need reimporting. Older package-relative analysis links remain readable.

JSON contains `schemaVersion: 1`, `exportedAt`, safe `project` and `snapshot` metadata, `warnings`, and `analysis`. Unavailable singleton analyses are `null`, collections are arrays, and legitimate zero coverage remains zero. Unreadable stored JSON becomes null with a warning. Queued/running analysis jobs add a warning that results may still change. No raw execution output, server storage paths, job payloads or account credentials are included.

## Limits and missing data

- Project ZIP: maximum 10,000 included files, 100 MiB uncompressed source, and 20,000 visited directory entries.
- ZIP excludes dependencies, VCS metadata, caches/build artifacts, test evidence directories, `.env` variants and backups, common credential/key files, private tool configuration and symlinks/junctions. Only exact `.env.example`, `.env.sample` and `.env.template` environment templates are allowed. This is a filename exclusion policy, not a scan for credentials embedded inside application source.
- Analysis: maximum 25 MiB serialized JSON before PDF/JSON generation. Two exports can be prepared concurrently per server process.
- PDF prints up to 60 coverage files, 40 complexity records, 25 security findings, 20 suggestions, 20 runner/mode summaries, 15 failed scenarios, and 10 quality recommendations. Truncated table sets disclose their counts. Long cells are shortened. JSON retains full exported analysis detail.
- PDF uses Noto Sans regular/bold, embedded for Vietnamese. Dates are shown in UTC+7. Missing results are labeled `N/A` or `Chưa có dữ liệu / No saved results`, rather than inferred as zero. Test history is not summed into a misleading cumulative pass rate.

| Status | Meaning |
| --- | --- |
| 400 | Invalid export options |
| 401 | Missing/invalid authentication or user identity |
| 404 | Project is inaccessible or the selected snapshot does not belong to it |
| 409 | No snapshot yet, unavailable/empty source, or source changed while being read |
| 413 | File count, directory count, source bytes or analysis size exceeds limits |
| 429 | Both export preparation slots are busy; retry after 10 seconds |
| 500 | Unexpected export failure; internal details are not returned |

## Implementation and verification

The project router applies existing auth middleware. The export controller validates parameters and resolves ownership before reading source or analysis. Prisma projections scope every analysis query to the resolved snapshot. Dedicated collection, archive and PDF services perform the work. No Prisma schema or migration changes.

[PDFKit](https://pdfkit.org/docs/getting_started.html) creates PDF attachments directly in Node, including buffered page numbering and embedded fonts. Production needs neither Python nor a Chromium installation for export. Bundled fonts and their OFL license are in `server/src/assets/fonts/`.

Run focused backend checks:

```powershell
npm.cmd test --prefix server -- --runInBand src/tests/projectExport.test.js src/tests/projectArchive.test.js src/tests/analysisPdf.test.js src/tests/projectStructure.authorization.test.js src/tests/projectStructure.route.test.js src/tests/snapshotWorkspace.test.js src/tests/projectRootResolver.test.js --silent --forceExit
npm.cmd run build --prefix client
```

For document review, run `node tools/preview_export_report.mjs`. It produces an explicitly labeled demonstration PDF under `output/pdf/` and an empty report under `tmp/pdfs/`. `tools/verify_export_pdf.py` renders both and checks page bounds, Vietnamese extraction, headers and numbering; its review environment needs `pdfplumber` and `pypdfium2`.

For UI smoke checks, start Vite at `127.0.0.1:5175`, then run `node tools/verify_export_ui.mjs`. This uses the existing Playwright dependency with mocked API responses and saves desktop/mobile/dark screenshots under `output/export-preview/`. It checks snapshot selection, authenticated PDF/JSON downloads, focus, Escape, API errors, network failure recovery and duplicate-submit prevention. Set `EXPORT_UI_BASE_URL` to use another local Vite URL. This is a UI check, not live-database validation.

Verified on 2026-10-09: 48 focused tests passed; frontend production build passed; changed frontend files have no lint errors (two existing hook warnings in Layout). The full suite before the last isolated export-test additions had 106 passing and 13 failing suites. Running the original HEAD with the same environment/dependencies confirmed exactly the same 13 failing suites and 50 failed tests; none were introduced by export. Global frontend lint remains blocked by existing errors elsewhere.

Live local verification on the existing GitHub todoapp project also passed: Explorer returned both `client` and `server`, API reads succeeded for a source file in each package, and browser downloads succeeded for PDF, JSON, ZIP and a repeated PDF. The ZIP contained both packages (24 entries). The downloaded three-page PDF was rendered and checked for page bounds, headers and numbering. The reported download-with-error symptom was not reproduced; the dialog now locks submissions synchronously and does not reload snapshots when background project metadata changes. This verifies the export/read journeys, not every analysis runner.
