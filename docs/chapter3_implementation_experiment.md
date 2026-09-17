# CHAPTER 3. IMPLEMENTATION AND EXPERIMENT

## 3.1 Allocation View

CovAI functionality is distributed across a client-server architecture. The backend manages project ingestion, test execution, and analysis, while the frontend provides the user interface.

| Responsibility | Implementation Component | Technology |
|---|---|---|
| API Routing | `server/src/routes/*` | Express.js |
| Business Logic | `server/src/services/*` | Node.js |
| Job Queueing | `server/src/services/queue.service.js` | BullMQ / Redis |
| Database | `server/prisma/schema.prisma` | PostgreSQL / Prisma |
| AI Integration | `server/src/services/gemini.service.js` | Google Gemini API |
| Test Execution | `server/src/services/*Runner.service.js` | Node.js (child_process) |

## 3.2 Project Ingestion

Project ingestion follows a structured workflow:
1. **Upload**: `controllers/upload.controller.js` receives the project archive.
2. **Snapshot Creation**: `services/job.service.js` creates a `ProjectSnapshot` record.
3. **Job Creation**: An `INGEST` job is queued via `services/job.service.js`.
4. **Worker Processing**: `services/ingestJob.service.js` extracts the archive and resolves the project root.

## 3.3 Test Framework Detection

Framework detection is implemented via dedicated services:

| Framework | Detection Service | Main Function | Detection Method |
|---|---|---|---|
| Jest | `services/jestDetection.service.js` | `detectJest` | Checks `package.json` dependencies |
| Vitest | `services/vitestDetection.service.js` | `detectVitest` | Checks `package.json` dependencies |
| Cypress | `services/cypressDetection.service.js` | `detectCypress` | Checks `package.json` dependencies |
| Supertest | `services/supertestDetection.service.js` | `detectSupertest` | Checks `package.json` dependencies |

## 3.4 Test Execution Pipeline

The pipeline is managed by BullMQ jobs:
1. **Job Creation**: `services/job.service.js` creates a job (e.g., `RUN_TESTS`).
2. **Worker**: `services/runTestsJob.service.js` picks up the job.
3. **Execution**: The worker invokes the appropriate runner (e.g., `services/supertestRunner.service.js`).
4. **Result**: Output is captured, parsed, and stored in the database.

## 3.5 Coverage Analysis

Coverage is parsed from LCOV reports:
1. **Generation**: Test runners generate coverage reports.
2. **Parsing**: `services/coverageFinalParser.service.js` parses the report.
3. **Storage**: Results are stored in `CoverageSummary`, `CoverageFile`, and `CoverageFunction` models.

## 3.6 CFG Generation

CFG generation uses `services/cfgBuilder.service.js` and `services/babelParser.service.js` to parse source code into an AST and build the control flow graph.

## 3.7 Cyclomatic Complexity Analysis

Calculated using `services/cyclomaticCalculator.service.js`. The implementation counts decision points (if, else, for, while, etc.) and adds 1. Results are stored in the `Cyclomatic` model.

## 3.8 AI Test Generation

Implemented in `services/aiTestsJob.service.js` and `services/aiTest.service.js`. It constructs context from source code and coverage data, sends it to the Gemini API, and parses the generated test code.

## 3.9 Snapshot Management

Snapshots (`ProjectSnapshot` model) represent a specific state of a project (e.g., a commit or upload). They are used to associate jobs, coverage, and analysis results with a specific version of the code.

## 3.10 Notification System

Notifications are managed by `services/notification.service.js`. Types include `JOB_FINISHED`, `AI_READY`, and `SYSTEM`.

## 3.11 Experimental Setup

The environment uses Node.js, PostgreSQL, and Redis. Test projects are ingested as ZIP archives or via GitHub URLs.

## 3.12 Evaluation and Results

The system provides the capability for automated testing, coverage analysis, and AI test generation. Quantitative evaluation data is not currently available in the repository.