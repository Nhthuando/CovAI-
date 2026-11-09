# System Test redesign: source and technical research

Date: 2026-10-21. Scope: research and planning only. The current working tree contains extensive pre-existing changes; this audit reads that state and does not claim a clean baseline.

## Inputs and interpretation

The owner confirmed that the attached `Chi_tiet_System_Test.png` defines business behavior; [Figma](https://www.figma.com/design/8CiK65mRXGvo0N2vTqGQ19/CovAI-%E2%80%94-System-Test-Workflow-Redesign?node-id=0-1) defines the interface. Figma page `0:1` contains seven frames: `16:2` no tests, `16:112` scenarios, `17:2` live browser, `17:149` results, `17:290` coverage/gaps, and `53:2`/`53:211` live code/API detail. The Figma screenshots contain example values, not runtime evidence.

The repository inventory contains 619 JS/JSX/TS/TSX/Prisma source and test files under `client/src`, `server/src`, `server/prisma` and `shared` (139 client, 478 server, 2 shared). The audit mapped entrypoints, routes, schema, services, UI and related tests, then read the System Test path in detail. It does not assert that every line of every unrelated file was manually examined.

## Current architecture

| Layer | Current evidence | Consequence for redesign |
| --- | --- | --- |
| SPA | `client/src/components/dashboard/Layout.jsx` mounts `SystemTestDashboard.jsx`; `systemTest.service.js` calls coverage/assessment APIs. | Retain workspace context and client service boundary. Recompose the System Test screen into Figma's tabs. |
| Admission | `server/src/routes/systemAssessment.route.js` uses `authMiddleware`; controller `owned()` queries snapshot through `project.ownerId=req.user.id`. Redis lease and active-job check serialize evidence operations. | Extend existing ownership and lease checks to catalog, live events, artifacts and PDF. |
| Discovery | `systemAssessmentDiscovery.service.js` scans Playwright files, rejects ambiguous roots and suites over 20 files, and excludes API-mocking specs from Full Stack. `systemTestDetection.service.js` discovers Playwright/Cypress configs. | Discovery exists, but pre-run scenario Input/Expected and per-scenario review do not. Preserve explicit unsupported states. |
| Generation | `systemGenerationContext.service.js`, `verifiedSystemGeneration.service.js`, `automaticSystemTests.service.js` and `systemTestQuality.service.js` generate/validate Playwright candidates. | Generated tests require a new owner review gate; static structure does not verify business outcomes. |
| Execution | `systemAssessmentJob.service.js` creates disposable workspaces, runs Playwright twice, parses JSON, persists results, and checks source/test/runtime identity. `systemTestRunner.service.js` starts AUT and executes test command. | Reuse; add ordered scenario/step events and review-aware admission. Current progress is stage-level. |
| Coverage | `systemCoverageInstrumentation.service.js` and `systemCoverageCollector.service.js` instrument frontend/backend source, include zero-hit files, validate run/map identity and emit `MEASURED`/`PARTIAL`/`INVALID` states. | Sound aggregate basis. It includes startup and cannot be copied to each scenario. |
| Assertions | `systemRequirement.service.js` stores confirmed criteria and reviewed assertion bindings. `systemAssertionEvidence.service.js` instruments supported sites. | Reuse criterion proof, add a user-facing brief and scenario review workflow. Custom fixtures/dynamic tests need explicit unsupported handling. |
| Result evidence | `systemTestResultParser.service.js` extracts scenario status, errors, screenshot and steps after the run. `systemTestEvidence.service.js` captures browser coverage and some failure interaction evidence. | Extend to live events, bounded preview, API/trace manifest and authenticated artifact retrieval. |
| Quality/gaps | `systemTestStaticAnalysis.service.js` flags fixed waits, constant/smoke assertions and selective execution. `systemAssessment.service.js` reports uncovered source and unverified criteria. | Add explicit verdict derivation and distinguish application failure, weak test, missing business flow and unexecuted code. |
| AI improvement | `systemTestImprovementJob.service.js` verifies candidate runs and can `autoApply`; `SystemTestAssessmentPanel.jsx` currently sends `autoApply:true`. | This conflicts with the diagram's user review of added Input/Expected. Require explicit proposal review before apply in the redesigned flow. |
| Reporting | `SystemTestReportView.jsx` prints browser HTML and exports JSON; server report routes serve Integration reports only. | Add selected-assessment PDF from persisted server data and evidence manifest. |

## Material gaps against the workflow

1. The current zero state offers only AI generation; Figma shows writing and importing a scenario as equal entry points.
2. Pre-run scenarios are not a durable catalog with Flow, Input, Expected, criterion link and review hash. `TestScenario` is an execution result record.
3. The default Run can auto-discover and start without approved business Expected/assertion mapping. Requirement APIs exist but the main UI hides that workflow.
4. Live progress is job/stage-level, not a browser/step/event timeline with replay after reconnect. A static Figma screenshot is not evidence that runtime screencast exists.
5. Screenshots and steps are mostly post-run. API response traces, DB changes and executed backend path attribution are not generalized scenario evidence. Existing coverage is aggregate across the AUT lifecycle.
6. Flaky/weak classification is incomplete for the requested meaning. Existing parser detects retry flakiness and static findings, but no unified owner-reviewed verdict policy.
7. AI improvement can save automatically, while the requested loop requires the owner to review new Input/Expected and approve each proposed scenario.
8. There is no immutable System Test PDF endpoint tied to a selected assessment.

## Technical decisions supported by primary sources

- Use Playwright's [custom reporter callbacks](https://playwright.dev/docs/test-reporters) to emit test and step progress; retain JSON result and [trace](https://playwright.dev/docs/trace-viewer-intro) for diagnosis. Reporter progress is an observation stream, not the final truth; reconcile with the stored report.
- Use Playwright [web-first assertions](https://playwright.dev/docs/test-assertions) for expected UI outcomes. A screenshot, locator action or source coverage hit cannot replace an assertion.
- Run independent repeats with fresh test data and zero retries for the measurement. Playwright [parallel isolation guidance](https://playwright.dev/docs/test-parallel) warns that shared backend data can still race even with isolated browser contexts. A retry-pass should retain the first failure as a weak/flaky signal.
- Prefer existing Istanbul [line/branch/function/statement counters](https://istanbul.js.org/docs/advanced/alternative-reporters/) and provenance checks. Playwright's raw [JS coverage API](https://playwright.dev/docs/api/class-coverage) is Chromium-only and may reset across navigation, so it is not a substitute for the existing source-instrumented frontend/backend contract.
- For Code paths/Data & DB/API calls, use explicit request correlation and allowlisted instrumentation. OpenTelemetry [context propagation](https://opentelemetry.io/docs/languages/js/propagation/) can link browser request to backend spans; static route maps alone cannot show which branch executed. Uninstrumented tiers must say `NOT_CAPTURED`.
- Generate the PDF on the server with existing PDFKit; it supports [streaming directly to an HTTP response](https://pdfkit.org/docs/getting_started.html). Render persisted assessment values, not a browser recomputation.
- A new test can verify a previously missing confirmed business criterion while executing no new source line. The acceptance policy therefore needs two explicit success bases: verified criterion closure or comparable measured coverage gain. Neither permits an existing regression or a changed Expected without owner approval.
- The requested quality score should be a disclosed rubric over verified criteria, strong reviewed assertions, clean independent runs and required evidence completeness. It is a heuristic for the tested suite, not a correctness probability; absent prerequisites make it unavailable.

## Baseline verification and environment limits

Focused test command on 2026-10-21: `npm test --prefix server -- --runInBand --cacheDirectory "D:\HuuThuan - Project\NCKH\CovAI\tmp\jest-system-research" src/tests/systemAssessment.service.test.js src/tests/systemAssessment.route.test.js src/tests/systemCoverageCollector.test.js src/tests/systemTestRunner.service.test.js src/tests/systemTestDetection.service.test.js`.

Four suites passed, 23 tests passed. `systemAssessment.route.test.js` recorded nine `connect EACCES 127.0.0.1` failures before exercising route behavior because the sandbox denied Supertest's localhost bind. A first run using the default Jest cache also failed with `EPERM` in Windows Temp; placing cache in the workspace resolved that cache issue. No DB migration, AUT launch, live Gemini call, browser E2E or full server suite was run for this research.

## Plan

See [implementation plan](superpowers/plans/2026-10-21-system-test-workflow-redesign.md) and [approved design contract](superpowers/specs/2026-10-21-system-test-workflow-redesign-design.md). The plan is divided into durable catalog, brief/review gate, live evidence, verdict/gaps, proposal review, UI, PDF and acceptance slices. Execution begins only after migration/database and current working-tree review.
