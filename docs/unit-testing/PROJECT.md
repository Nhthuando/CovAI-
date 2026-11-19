# Project: CovAI Coverage Calculation & Bulk Version History Reversion

## Architecture
- **Backend (`server/`)**:
  - Test runner pipeline & discovery: `server/src/services/runTestsJob.service.js`, `server/src/services/vitestRunner.service.js`, `server/src/services/unitTestBatchRunner.service.js`, `server/src/services/applyTestSuggestion.service.js`.
  - Path normalization & coverage persistence: `server/src/utils/pathSanitizer.js`, `server/src/services/coverageSummaryParser.service.js`, `server/src/services/coverageFileParser.service.js`, `server/src/controllers/coverage.controller.js`.
  - Version history & rollback: `server/src/services/unitTestVersion.service.js`, `server/src/services/unitTestVersionRollback.service.js`, `server/src/controllers/coverage.controller.js`.
- **Frontend (`client/`)**:
  - Dashboard & Version History: `client/src/components/dashboard/CoverageTypeDashboard.jsx`, `client/src/components/dashboard/UnitTestVersionHistoryView.jsx`, `client/src/components/dashboard/UnitTestBatchVersions.jsx`, `client/src/components/dashboard/UnitTestTraceabilityMatrix.jsx`.

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | Restrict Post-Merge Unit Test Execution | Restrict post-merge test execution specifically to relevant unit test suites (`server/tests/**/*.vitest.test.js`) and exclude unrelated E2E test suites (`tier4-workloads.test.js`, `e2e/tests/*`) | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 2 | Subproject Coverage Path Mapping | Map subproject coverage report paths (e.g. `src/...` to `server/src/...`) back to project source files in database and state | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 3 | Accurate Non-Zero Coverage Display | Ensure statement, branch, function, and line coverage percentages update accurately and display non-zero metrics in Traceability Matrix and dashboard banners | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 4 | Bulk Version History Reversion UI | Provide visible "Revert all files to this version" action on historical versions in Version History view, eliminating the `activeBatchId` hijack | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 5 | Bulk Version Snapshot Atomic Restoration | Atomically restore all modified test and source files to their state in selected snapshot (including baseline Version 1 and batch versions) | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 6 | Post-Rollback Automated Verification & Updates | Automatically re-run verification after bulk rollback, recalculate coverage metrics, and update version badges and dashboard statistics | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 7 | Full Verification & Regression Testing | Comprehensive unit and integration test verification of coverage pipeline and version rollback | M3 | Acceptance Criteria | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Post-Merge Coverage Execution & Path Mapping | Test discovery/filtering in `runTestsJob.service.js` & `applyTestSuggestion.service.js`; subproject path canonicalization in `pathSanitizer.js`, `coverageSummaryParser.service.js`, and `coverage.controller.js` | none | DONE |
| 2 | Bulk Version History Reversion UI & Logic | Frontend "Revert all files to this version" action in `UnitTestVersionHistoryView.jsx` (remove line 181 hijack); backend bulk rollback support for Baseline (v1) and batch versions in `unitTestVersionRollback.service.js` and `unitTestVersion.service.js` | M1 | DONE |
| 3 | Verification & E2E Acceptance | Regression tests and end-to-end acceptance checks across all requirements | M1, M2 | DONE |

## Interface Contracts
### Coverage Pipeline ↔ Database & Dashboard
- When Vitest runs in `server/`, files like `src/controllers/chatController.js` must be mapped to `server/src/controllers/chatController.js` whenever `<rootDir>/server/src/controllers/chatController.js` exists.
- `CoverageFile` records in Prisma must store canonical project-relative paths (e.g. `server/src/...`).
- `CoverageSummary` and `CoverageFile` upserts must preserve non-zero metrics (stmts, branches, funcs, lines).

### Version History Rollback ↔ Dashboard
- `POST /api/coverage/:snapshotId/unit-test-versions/switch`:
  - Request body: `{ targetVersion: number, allFiles: true, projectId?: string }`
  - Response payload: `{ success: true, targetVersion: number, message: string, coverage: { ... } }`
- Rollback must atomically restore files, run test verification via `runUnitTestBatch`, update `CoverageSummary` and `CoverageFile`, and return updated coverage data.
- Frontend `handleSwitchVersion` calls `loadUnitTestVersions()` and `refetchCoverage()`, updating version badges and dashboard statistics.

## Code Layout
- `server/src/services/runTestsJob.service.js`: Test runner discovery, `IGNORED_DIRS`, `findUnitFiles`
- `server/src/services/applyTestSuggestion.service.js`: Regression test file scoping, post-merge coverage
- `server/src/utils/pathSanitizer.js`: `canonicalizeFilePath`, subproject path prefixing
- `server/src/services/coverageSummaryParser.service.js`: Coverage file path canonicalization
- `server/src/controllers/coverage.controller.js`: Coverage reconciliation & version rollback controller
- `server/src/services/unitTestVersionRollback.service.js`: `switchVerifiedUnitTestBatch` implementation
- `server/src/services/unitTestVersion.service.js`: Version history manifest management
- `client/src/components/dashboard/UnitTestVersionHistoryView.jsx`: Version timeline cards, bulk revert action
- `client/src/components/dashboard/CoverageTypeDashboard.jsx`: Version history tab & state management
