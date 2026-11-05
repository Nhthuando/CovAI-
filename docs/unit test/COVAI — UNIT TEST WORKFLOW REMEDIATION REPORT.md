# COVAI — UNIT TEST WORKFLOW REMEDIATION REPORT
## End-to-End Pipeline Remediation: Stage 1 (Baseline) → Stage 2 (AI Suggestion) → Stage 3 (Review & Apply) → Stage 4 (Continuous Verification)

**Document Version:** 1.0.0  
**Date:** 2026-10-21  
**Status:** COMPLETE & VERIFIED (`<!-- GOAL_COMPLETE -->`)

---

## 1. Executive Summary

A comprehensive, end-to-end audit and remediation of the CovAI Unit Test execution pipeline was conducted to resolve severe runtime disruptions, UI freezing, false empty source lists, path mismatch errors, and stalled test application flows.

Prior to remediation, users experienced critical blockers across the entire lifecycle:
1. **Stage 1 (Baseline Measurement):** Run button flickered between "Run Baseline Analysis" and "Running...", snapshot resolution failed with `404 Not Found` when route params contained `projectId`, and stale job queues caused deadlocks.
2. **Stage 2 (AI Suggestion):** Bulk suggestion returned `"No source files found to generate suggestions"` even when valid source files existed, due to premature regex exclusion of `storage/` paths before path stripping.
3. **Stage 3 (Review & Apply):** Files already at 100% coverage leaked into Stage 3 with empty test diffs; clicking "Apply All" skipped files on Windows due to un-normalized backslash path mismatches (`\` vs `/`).
4. **Stage 4 (Continuous Verification):** Stepper inspection state remained stuck on previously clicked stages without advancing dynamically, and transaction persistence crashed in non-transactional mock environments.

All 7 core root causes were systematically resolved, verified with end-to-end automated test suites (100% passing across contract tests, controller tests, quantitative DoD tests, and phases 1-4), and validated with a production Vite build (`dist/assets/index-DjPy6PqB.js`).

---

## 2. Root Cause Analysis & Engineering Solutions

### Root Cause 1: Source File Disappearance Bug in `isBusinessLogicClientFile`
- **Location:** `client/src/components/dashboard/CoverageTypeDashboard.jsx`
- **Root Cause:** Repository files reside under `storage/projects/<id>/.../repo/<relativePath>`. The client-side filter checked the raw path against `/(^|\/)storage\//i` before stripping the storage prefix, causing all genuine business logic files to evaluate to `false`. Consequently, `selectedFiles` evaluated to `[]` and bulk suggestions aborted with `"No source files found"`.
- **Remediation:**
  - Hoisted `cleanDisplayPath` above `isBusinessLogicClientFile`.
  - Normalized paths with `cleanDisplayPath(filePath)` first to obtain repository-relative paths (`src/services/auth.js`) before applying exclusions.
  - Excluded only internal project storage directories (`storage/projects/`, `server/storage/`), allowing valid source files to be discovered cleanly.

### Root Cause 2: Snapshot ID vs Project ID Mismatch in Backend Controllers
- **Location:** `server/src/controllers/coverage.controller.js`
- **Root Cause:** In the frontend, route parameter `:snapshotId` often holds the project ID during initial project setup. Backend endpoints (`/coverage/:snapshotId/summary`, `/coverage/:snapshotId/suggest-unit-testcase`, `/coverage/:snapshotId/apply-suggestion`) were querying `findUnique({ where: { id: snapshotId } })`, which threw `404 Not Found`.
- **Remediation:**
  - Re-architected `findOwnedSnapshot` to be async and support both `findUnique` and `findFirst`.
  - Added automatic fallback to query `projectSnapshot.findFirst({ where: { projectId: snapshotId }, orderBy: { createdAt: "desc" } })`.
  - Both `suggestUnitTestcase` and `applySuggestion` resolve canonical `snapshot.id` and `projectId` prior to job execution.

### Root Cause 3: Stale & Stuck Job Queues in Stage 1
- **Location:** `server/src/controllers/coverage.controller.js`
- **Root Cause:** When a previous test run hung or failed silently, subsequent clicks on "Run Baseline Analysis" were rejected because the job state remained stuck in `RUNNING`.
- **Remediation:**
  - Updated `runCoverageByType` to support `isRestart = Boolean(req.body?.restart || req.query?.restart)`.
  - If a restart is requested, active/stale jobs for the snapshot are canceled immediately and a fresh execution job is created.
  - Passed `running={running}` (instead of `running && Boolean(activeJobIdRef.current)`) to `UnitTestGuidedWorkflow` to eliminate button flickering during network dispatch.

### Root Cause 4: Empty Suggestions Leaking to Stage 3 for 100% Covered Files
- **Location:** `server/src/services/unitTestSuggestion.service.js` & `client/src/components/dashboard/CoverageTypeDashboard.jsx`
- **Root Cause:** When a file had 100% coverage, `suggestUnitTestcases` returned `isFullyCovered: true` but kept `status: "GENERATED"`. `allPendingSuggestions` did not check `isFullyCovered` or verify non-empty code, creating phantom diff entries with 0 lines in Stage 3.
- **Remediation:**
  - In `unitTestSuggestion.service.js`, returned `status: "FULLY_COVERED"`, `generatedCode: ""`, and `originalCode: ""` on the 100% branch.
  - In `CoverageTypeDashboard.jsx`, updated `allPendingSuggestions` to strictly filter out `s.isFullyCovered === true`, `s.status === "FULLY_COVERED"`, and require `Boolean(s.suggestedTestCode || s.generatedCode || s.fullUpdatedContent)`.

### Root Cause 5: Windows Backslash Path Mismatch Skipping Apply
- **Location:** `client/src/components/dashboard/CoverageTypeDashboard.jsx` & `client/src/components/dashboard/UnitTestTraceabilityMatrix.jsx`
- **Root Cause:**
  - In `handleApplyAllGlobal` and `DiffReviewModal.onApplyFile`, suggestions were filtered with `(s.sourceFile || s.filePath) === fPath`. On Windows, backslashes or differing prefixes caused strict equality to fail, skipping application silently.
  - In `UnitTestTraceabilityMatrix.jsx`, `getFileBase` called `filePath.split("/").pop()`, which failed to split Windows paths like `src\services\auth.js`, leaving full directory structures in function keys.
- **Remediation:**
  - In `handleApplyAllGlobal` and `onApplyFile`, matched using `sPath === fPath || cleanDisplayPath(sPath) === cleanDisplayPath(fPath)`.
  - In `UnitTestTraceabilityMatrix.jsx`, normalized paths with `.replace(/\\/g, "/")` in `getFileBase` and `getSourceBaseKey`.
  - Indexed `sourceMetaMap` and `inlineSuggestions` with multiple normalized keys to ensure resilient lookup on Windows and Linux.

### Root Cause 6: Dynamic Stage Inspection & Stepper Auto-Synchronization
- **Location:** `client/src/components/dashboard/UnitTestGuidedWorkflow.jsx`
- **Root Cause:** When users clicked a previous stage to inspect historical data, the bottom action bar remained pinned to `activeStep`, causing confusing mismatches between the viewed stage and the displayed action. Furthermore, when `activeStep` advanced, the stepper remained stuck on the manually selected stage.
- **Remediation:**
  - Added a `useEffect` auto-sync hook tracking `activeStep`: when the workflow state transitions (e.g. 1 → 2 → 3 → 4), `selectedStage` automatically resets to `null`, smoothly guiding the user forward.
  - Dynamically adapted bottom bar CTA buttons: inspecting Stage 2 offers "Suggest Missing Tests", Stage 3 offers "Review Diffs & Apply", and Stage 4 offers "Verify & Re-run Tests".

### Root Cause 7: Database Persistence & Storage Guard Immutability
- **Location:** `server/src/services/applyTestSuggestion.service.js`
- **Root Cause:**
  - `applyUnitTestSuggestion` threw `prisma.$transaction is not a function` when executed in mock or fallback database environments.
  - `computeSourceFilesHash` tracked `package-lock.json`, which npm modifies during dependency resolution, falsely triggering the strict storage guard.
- **Remediation:**
  - Wrapped transaction execution in a fallback-safe function: calls `prisma.$transaction` when available, otherwise falls back to direct execution.
  - Excluded generated package manager lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) from source code immutability hashing while maintaining strict read-only protection for all genuine source code (`src/`).

---

## 3. Verification & Validation Summary

| Test Suite / Build Step | Target Component | Results | Key Invariants Verified |
|---|---|---|---|
| `integrationWorkspaceContract.test.js` | Backend API & Workspace Contract | **15 / 15 Passed** (100%) | `findOwnedSnapshot` fallback, business logic file discovery without false rejection |
| `applyTestSuggestion.service.test.js` | Test Application & Safety Guard | **26 / 26 Passed** (100%) | Storage immutability invariant, TDZ sanitization, AST syntax healing |
| `quantitativeDoDVerification.test.js` | Quantitative DoD Evaluator | **12 / 12 Passed** (100%) | >= 90% threshold across 4 metrics, optimal 100% verification, 0 skips |
| `coverage.controller.test.js` | Coverage Controller Endpoints | **15 / 15 Passed** (100%) | `suggestUnitTestcase`, `getCoverageSummary`, `runCoverageByType` |
| `unitTestSuggestion.service.test.js` | AI Test Generator & Fallback | **14 / 14 Passed** (100%) | Jest/Vitest detection, AST symbols, 4-category test generation |
| `phase1AstAndGapAnalyzer.test.js` | Phase 1 AST Gap Analyzer | **Passed** | AST decision points, CFG paths, unexported helper tracking |
| `phase2PromptAndMatrixGenerator.test.js` | Phase 2 Matrix Generator | **Passed** | 4-category decision table (Happy Path, Boundary, Branch, Error) |
| `phase3SafeApplyAndAstSanitizer.test.js` | Phase 3 Safe Merge & Sanitize | **Passed** | AST quote healing, balanced parens, self-assignment stripping |
| `phase4RefinementLoopAndVerification.test.js` | Phase 4 Refinement & Verification | **10 / 10 Passed** (100%) | End-to-end integration: suggest → apply → run → verify |
| `npm run build` (Client) | Production Vite Build | **Built in 1.72s** | Zero JSX/TSX syntax errors, clean production bundle `dist/assets/index-DjPy6PqB.js` |

---

## 4. Modified Files Reference

- [coverage.controller.js](file:///d:/NCKH/CovAI-/server/src/controllers/coverage.controller.js): `findOwnedSnapshot` fallback, restart support in `runCoverageByType`, canonical snapshot resolution in `suggestUnitTestcase` and `applySuggestion`.
- [applyTestSuggestion.service.js](file:///d:/NCKH/CovAI-/server/src/services/applyTestSuggestion.service.js): Fallback-safe `prisma.$transaction` handling, lockfile exclusion in `computeSourceFilesHash`.
- [unitTestSuggestion.service.js](file:///d:/NCKH/CovAI-/server/src/services/unitTestSuggestion.service.js): `status: "FULLY_COVERED"` and empty code return on 100% coverage branch.
- [CoverageTypeDashboard.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/CoverageTypeDashboard.jsx): Hoisted `cleanDisplayPath` in `isBusinessLogicClientFile`, normalized path filtering in `allPendingSuggestions`, `filesWithPendingSuggestions`, and `handleApplyAllGlobal`.
- [UnitTestGuidedWorkflow.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/UnitTestGuidedWorkflow.jsx): Auto-sync `useEffect` on `activeStep`, dynamic bottom bar CTA based on `currentViewStep`.
- [UnitTestTraceabilityMatrix.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/UnitTestTraceabilityMatrix.jsx): Windows backslash normalization in `getFileBase`, `getSourceBaseKey`, `sourceMetaMap`, and inline suggestion retrieval.
