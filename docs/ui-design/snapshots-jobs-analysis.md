# COVAI Snapshots & Jobs UI — Implementation Analysis

## 1. Introduction

This report provides an in-depth, code-level architectural and visual analysis of the **Snapshots & Jobs** module (titled **Pipelines & Version Hub**) in the COVAI platform. The primary objective is to produce a rigorous, evidence-backed UI specification and technical implementation analysis for the COVAI Capstone documentation.

The analysis is grounded in an exhaustive examination of the actual source code across the client application, backend REST APIs, background queue workers, and PostgreSQL database schemas, directly verified against two production reference screenshots:
1. **Screenshot 1 (`media_1791993271602.png`):** Displays the **Code Snapshots & Checkpoints** tab, presenting the snapshot history timeline, the active version indicator, the quick checkpoint creation form, and the version overview metrics card.
2. **Screenshot 2 (`media_1791993294651.png`):** Displays the **Pipelines & Job Queue** tab, presenting the job execution list, category filter buttons, job execution cards with real-time progress indicators, completed/failed summary cards, and the queue and worker resource metrics.

### Verification Principles
- **Documentation Integrity:** Every claim, component name, route, model, and workflow is verified against the actual repository files. No imagined features, placeholder schemas, or unverified behaviors are documented as facts.
- **Strict Distinction:** Visual layout observations from the reference screenshots are systematically distinguished from verified runtime behaviors in the codebase.
- **Standardized Implementation Statuses:** Controls, workflows, and integrations are categorized as `IMPLEMENTED`, `PARTIALLY IMPLEMENTED`, `NOT IMPLEMENTED`, or `UNVERIFIED`.

---

## 2. Module Overview

The **Snapshots & Jobs** module serves as COVAI's centralized control center for project versioning, filesystem rollbacks, and asynchronous pipeline execution. Within the user interface, it is titled **Pipelines & Version Hub** with the subtitle badge *Checkpoints & AI Queues*.

```
+------------------------------------------------------------------------------------------------------------------+
| COVAI Studio / <project-name> / <path>                                                     [Projects] [Export] ()|
+------------------------------------------------------------------------------------------------------------------+
| Pipelines & Version Hub [Checkpoints & AI Queues]                                       [Create Snapshot] [Refresh]|
| Capture project checkpoints, restore previous code versions, and monitor active test generation pipelines.        |
+------------------------------------------------------------------------------------------------------------------+
| [Layers] Code Snapshots & Checkpoints (N)    [Cpu] Pipelines & Job Queue (M)                                      |
+------------------------------------------------------------------------------------------------------------------+
| TAB 1: CODE SNAPSHOTS & CHECKPOINTS              | TAB 2: PIPELINES & JOB QUEUE                                   |
| - Snapshot History (List + Search)               | - All Jobs (Filter: All | Active | Done)                       |
| - Active Version Badge & Metadata                | - Job Execution Cards (Progress, Duration, Status)             |
| - Quick Checkpoint Form                          | - Completed / Failed Summary Counters                          |
| - Version Overview & Restoration Safety Policy   | - Queue & Resources (Pending, Running, Total, Worker Load)     |
+------------------------------------------------------------------------------------------------------------------+
```

### Module Responsibilities
1. **Code Snapshots & Checkpoints (Tab 1):**
   - Captures point-in-time filesystem snapshots of project source code into dedicated server storage directories.
   - Generates persistent on-disk metadata (`.covai-checkpoint.json`) alongside PostgreSQL records (`prisma.projectSnapshot`).
   - Tracks the active project version and associates checkpoints with GitHub commit SHAs or manual tags.
   - Provides snapshot search filtering and rollback/restoration capabilities to previous checkpoints.
2. **Pipelines & Job Queue (Tab 2):**
   - Monitors background tasks including test suite runs (`RUN_TESTS`, `RUN_VITEST_TESTS`), dependency installation (`INSTALL_DEPS`), coverage calculations (`PARSE_COVERAGE`, `SUPERTEST_COVERAGE`, `VITEST_COVERAGE`), AST analysis (`ANALYSIS`, `BUILD_CFG`), and AI test generation (`AI_TESTS`, `AI_SUGGEST`).
   - Renders animated progress meters, execution start times, and elapsed durations.
   - Displays real-time job state transitions (`QUEUED`, `RUNNING`, `SUCCESS` -> `COMPLETED`, `FAILED`, `CANCELED`).
   - Aggregates queue metrics: pending tasks, running tasks, total tasks, and worker load utilization percentage.

### Navigation and Placement
The module is encapsulated in [JobQueue.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx) (2012 lines). In the primary layout [Layout.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/Layout.jsx#L945-L946), the component is mounted in the main content pane when `activeActivity === "jobs"`, corresponding to the **Snapshots & Jobs** icon button (`Layers`) in [ActivityBar.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/ActivityBar.jsx#L18). Additionally, it can be triggered as an overlay modal directly from [CoverageTypeDashboard.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/CoverageTypeDashboard.jsx#L5232-L5306) during test suite runs.

---

## 3. Implementation Architecture

The module spans frontend React components, REST client services, Express controllers, modular background services, a BullMQ Redis queue with direct in-memory fallback execution, and Prisma ORM schemas.

| File Path | Component, Function, or Model | Responsibility | Evidence |
|---|---|---|---|
| [JobQueue.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx) | `JobQueue` Component | Renders the primary Pipelines & Version Hub view, tab switcher, snapshot timeline, quick checkpoint form, version overview, job cards, queue metrics, and modal dialogs. | Lines 1–2012 |
| [Layout.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/Layout.jsx) | Main Layout Integration | Mounts `<JobQueue projectId={project?.id} onSync={handleGitSync} />` when `activeActivity === "jobs"`. | Lines 945–946 |
| [ActivityBar.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/ActivityBar.jsx) | `ActivityBar` Navigation | Provides the navigation tab `{ id: "jobs", icon: Layers, label: "Snapshots & Jobs" }`. | Line 18 |
| [CoverageTypeDashboard.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/CoverageTypeDashboard.jsx) | Modal Consumer | Hosts `JobQueue` inside an interactive modal during test execution pipelines. | Lines 5232–5306 |
| [job.service.js](file:///d:/NCKH/CovAI-/client/src/services/job.service.js) | Frontend Job API Client | Provides `getUserJobsApi()`, `getProjectJobsApi()`, and `cancelJobApi()`. | Lines 1–160 |
| [project.service.js](file:///d:/NCKH/CovAI-/client/src/services/project.service.js) | Frontend Snapshot API Client | Provides `getProjectSnapshotsApi()`, `createProjectSnapshotApi()`, and `restoreProjectSnapshotApi()`. | Lines 30–65 |
| [project.route.js](file:///d:/NCKH/CovAI-/server/src/routes/project.route.js) | Snapshot Express Routes | Exposes `GET /:id/snapshots`, `POST /:id/snapshots`, and `POST /:id/snapshots/:snapshotId/restore`. | Lines 25–30 |
| [project.controller.js](file:///d:/NCKH/CovAI-/server/src/controllers/project.controller.js) | Snapshot Controllers | Handles HTTP validation and dispatch for `listSnapshots`, `createSnapshot`, and `restoreSnapshot`. | Lines 231–305 |
| [project.service.js](file:///d:/NCKH/CovAI-/server/src/services/project.service.js) | Snapshot Backend Service | Implements `listProjectSnapshots`, `createProjectCheckpoint`, and `restoreProjectCheckpoint`, managing filesystem copying and metadata. | Lines 493–760 |
| [job.route.js](file:///d:/NCKH/CovAI-/server/src/routes/job.route.js) | Job Express Routes | Exposes `GET /user`, `GET /:projectId/jobs`, `GET /:jobId`, `POST /:jobId/cancel`, and `GET /:jobId/stream` (SSE). | Lines 1–16 |
| [job.controller.js](file:///d:/NCKH/CovAI-/server/src/controllers/job.controller.js) | Job Controllers | Handles HTTP requests for listing user/project jobs, canceling active jobs, and streaming SSE status. | Lines 60–180, 310–360 |
| [job.service.js](file:///d:/NCKH/CovAI-/server/src/services/job.service.js) | Core Job Lifecycle Service | Manages job persistence, state transitions (`QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELED`), progress clamping, and stale job timeouts. | Lines 1–836 |
| [queue.service.js](file:///d:/NCKH/CovAI-/server/src/services/queue.service.js) | BullMQ & Fallback Executor | Manages BullMQ `Queue` and `Worker` on Redis; provides direct asynchronous in-memory execution fallback (`executeJobDirectly`). | Lines 1–372 |
| [runTestsJob.service.js](file:///d:/NCKH/CovAI-/server/src/services/runTestsJob.service.js) | Test Runner Service | Executes Jest and Vitest test suites, updates intermediate progress (`10%`, `25%`, `50%`, `75%`, `100%`), and records output logs. | Lines 1–2734 |
| [schema.prisma](file:///d:/NCKH/CovAI-/server/prisma/schema.prisma) | PostgreSQL Database Models | Defines `ProjectSnapshot`, `Job`, `JobLog`, `JobOutput`, `SnapshotSource`, `JobType`, and `JobStatus`. | Lines 77–205, 502–536 |

---

## 4. UI Specification Table

The following table documents every interface element visible in the reference screenshots and implemented in [JobQueue.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx).

| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | Page Header Title | Text Heading (`h1`) | Visible text: `Pipelines & Version Hub`, font size 22px, font-weight 700, tracking -0.01em, color `var(--color-text)`. | Displays the primary title of the module. |
| 2 | Header Subtitle Badge | Pill Badge (`span`) | Visible text: `Checkpoints & AI Queues`, font size 11px, surface secondary background, border `var(--color-border)`. | Categorizes the view as both version checkpointing and task execution hub. |
| 3 | Page Header Description | Text (`p`) | Visible text: `Capture project checkpoints, restore previous code versions, and monitor active test generation pipelines.`, text-secondary color, font size 13px. | Summarizes user capabilities in the hub. |
| 4 | Create Snapshot Button | Action Button (`motion.button`) | Background `var(--color-primary)`, text `#ffffff`, BookmarkPlus icon (14px), font size 12px, font-weight 500, padding 7px 14px. Click handler: `setShowCreateModal(true)`. | Opens the full modal dialog to capture a new code checkpoint. |
| 5 | Refresh Button | Action Button (`motion.button`) | Background `var(--color-surface)`, border `var(--color-border)`, RefreshCw icon (13px), label `Refresh`. Rotates icon when `loadingSnapshots \|\| loadingJobs` is true. Click handler: `handleRefreshAll()`. | Triggers concurrent reload of both snapshots (`fetchSnapshots`) and jobs (`fetchJobs`). |
| 6 | Feedback Alert Notice | Alert Banner (`motion.div`) | AnimatePresence banner, success (green) or error (red) palette with CheckCircle2 or AlertCircle icon and dismiss button `✕`. Automatically dismisses after 4–5s. | Informs user of checkpoint creation, rollback, or failure results. |
| 7 | Tab 1: Code Snapshots & Checkpoints | Tab Button (`button`) | Layers icon (13px), label `Code Snapshots & Checkpoints`, count badge `{snapshots.length}`. Active state: surface secondary background, border `var(--color-border)`. Click handler: `setActiveTab("snapshots")`. | Switches the main workspace view to the snapshot timeline and checkpoint forms. |
| 8 | Tab 2: Pipelines & Job Queue | Tab Button (`button`) | Cpu icon (13px), label `Pipelines & Job Queue`, count badge `{jobs.length}` or animated pill with pulsating dot `{activeJobs.length} active`. Click handler: `setActiveTab("jobs")`. | Switches the main workspace view to the background jobs list and queue metrics. |
| 9 | Snapshot History Heading | Text Heading (`h2`) | History icon (15px) in primary color, label `Snapshot History ({filteredSnapshots.length})`, font size 15px, font-weight 600. | Displays total count of snapshots matching current search filter. |
| 10 | Search Checkpoints Input | Search Input (`input[type="text"]`) | Search icon (13px), placeholder `Search checkpoints...`, fixed width 240px, surface background, clear button `✕`. Value bound to `snapshotSearch`. | Filters snapshot list client-side across `label`, `message`, `source`, and `commitSha`. |
| 11 | Snapshot Entry Card | Container Card (`motion.div`) | Surface background, rounded 12px, padding 16px 20px. Left vertical accent stripe (3px) and primary border if `isCurrent === true`. | Represents an immutable code checkpoint in the timeline. |
| 12 | Active Version Badge | Status Pill (`span`) | Green background (`rgba(22, 163, 74, 0.12)`), green border, pulsating green dot (6px), label `ACTIVE VERSION`, font size 10px, font-weight 700. Rendered only when `snap.isCurrent === true`. | Visually identifies the snapshot currently loaded in the project workspace. |
| 13 | Current Workspace Indicator | Static Text (`span`) | Visible text: `Current Workspace`, font size 11px, font-weight 500, color `var(--color-text-muted)`. Rendered on active snapshot card in place of restore button. | Clarifies that the active snapshot corresponds to the current working directory. |
| 14 | Snapshot Restore Button | Action Button (`motion.button`) | RotateCcw icon (12px), label `Rollback to this`, surface secondary background, border `var(--color-border)`. Rendered only when `!snap.isCurrent`. Click handler: `setConfirmRestoreSnapshot(snap)`. | Opens the rollback confirmation modal for a historical snapshot. |
| 15 | Snapshot Metadata Row | Data Row (`div`) | Monospace font, font size 12px, border top divider. Contains: Clock icon + timestamp (`dd/MM/yyyy HH:mm:ss`), Tag icon + source (`GitHub`, `Archive`, or `Checkpoint`), Commit label + 7-char SHA (`31a16d5`), file count, and byte size. | Displays provenance and physical metrics of the checkpoint. |
| 16 | Quick Checkpoint Form Card | Container Card (`div`) | Surface background, rounded 12px, border `var(--color-border)`, padding 20px. BookmarkPlus icon + title `Quick Checkpoint`, subtitle `Save the current code state to easily revert anytime.`. | Houses the quick checkpoint creation form in the right sidebar column. |
| 17 | Checkpoint Name Input | Text Input (`input[type="text"]`) | Label `Checkpoint Name` (font size 11px, weight 600). Placeholder `e.g. Before refactoring auth...`. Bound to `newLabel` state. Optional (defaults to timestamp on backend). | Captures user-defined tag or label for the new checkpoint. |
| 18 | Checkpoint Description Input | Textarea (`textarea`) | Label `Description / Notes (Optional)` (font size 11px, weight 600). Placeholder `Brief description of current changes...`, 2 rows, non-resizable. Bound to `newMessage` state. | Captures optional contextual notes describing the checkpoint. |
| 19 | Capture Snapshot Now Button | Submit Button (`motion.button`) | Full-width, primary background, Sparkles icon (13px), label `Capture Snapshot Now`. Disabled and displays spinner (`Loader2`) + `Capturing Checkpoint...` during submission. | Submits the quick checkpoint form via `handleCreateSnapshot()`. |
| 20 | Version Overview Card | Container Card (`div`) | Surface background, rounded 12px, border `var(--color-border)`, padding 20px. Header `Version Overview` (font size 14px, weight 600). | Displays high-level version statistics and the safety policy note. |
| 21 | Total Checkpoints Metric | Metric Row (`div`) | Label `Total Checkpoints` (text-secondary), value `{snapshots.length}` in bold monospace text. | Shows total number of snapshots stored for the current project. |
| 22 | Active Version Metric | Metric Row (`div`) | Label `Active Version` (text-secondary), value `{activeSnapshot?.label \|\| "None"}` in primary color, truncated to 150px. | Displays the name/tag of the currently active snapshot. |
| 23 | Last Captured Metric | Metric Row (`div`) | Label `Last Captured` (text-secondary), value `{formatTime(activeSnapshot.createdAt)}` in monospace text. | Displays the time of the most recent snapshot capture. |
| 24 | Version Safety Notice | Info Banner (`div`) | ShieldCheck icon (14px) in primary color, surface secondary background, border `var(--color-border)`. Text: *"All checkpoints are immutable. Restoring a previous version automatically creates a new checkpoint of your current code first, ensuring zero data loss."* | Informs user of immutability and data safety during rollbacks. |
| 25 | All Jobs Heading & Count | Text Heading (`h2`) | Font size 15px, weight 600. Dynamic text: `All Jobs ({jobs.length})`, `Active Jobs ({activeJobs.length})`, or `Completed ({completedJobs.length + failedJobs.length})`. | Displays total jobs matching the active category filter. |
| 26 | Job Filter Buttons | Segmented Buttons (`button[]`) | Three buttons: `All`, `Active`, `Done`. Active selection has surface secondary background, border `var(--color-border)`, and text color `var(--color-text)`. State bound to `filterJobs` (`ALL`, `ACTIVE`, `COMPLETED`). | Filters the jobs list client-side based on lifecycle status. |
| 27 | Job Execution Card | Container Card (`motion.div`) | Surface background, rounded 12px, border `var(--color-border)`, padding 16px 20px. Left vertical accent stripe (3px) reflecting status color. | Renders individual job task metadata, progress, and actions. |
| 28 | Job Type Icon & Title | Header Group (`div`) | Square icon container (38x38px) with task-specific Lucide icon (TestTube2 for test jobs). Title `{visual.typeLabel}` (e.g. `Run Tests`), project badge `{job.project.name}`, task description `{visual.taskLabel}`. | Identifies the task type, target project, and high-level description. |
| 29 | Job Timestamp & Duration | Monospace Text (`p`) | Visible text: `Started: HH:mm:ss · Duration: Xm Ys` (or `Xs`). Calculated via `formatTime` and `formatDuration(job.startedAt, job.finishedAt)`. | Displays real-time or historical execution timing. |
| 30 | Job Stop / Cancel Button | Action Button (`button`) | Ban icon (11px), label `Stop Job` (or `Stopping...`), red palette (`rgba(239, 68, 68, 0.1)`). Visible only when job status is `QUEUED` or `RUNNING`. Click handler: `handleCancelJob(job.id)`. | Requests immediate cancellation of the active job via `cancelJobApi()`. |
| 31 | Job Status Badge | Status Pill (`div`) | Rounded-full pill with background, border, and text mapped from status (`QUEUED` amber, `RUNNING` info blue, `COMPLETED` success green, `FAILED` danger red, `CANCELED` slate). Includes animated pulsating dot during active states. | Indicates the current lifecycle status of the job. |
| 32 | Job Progress Meter | Progress Bar (`div`) | Header row: `Progress` label and `{job.progress}%` monospace percentage. Bar: 6px height, rounded full, background fill width `${job.progress}%` with `0.4s ease-out` transition. Status-colored fill. | Displays execution completion percentage (0–100%). |
| 33 | Job Error Message Box | Error Box (`div`) | Rendered only when `job.status === "FAILED" && job.errorMessage`. Danger background, monospace text, word-break. Displays failure exception or test failure summary. | Provides debugging diagnostics directly on the job card. |
| 34 | Completed / Failed Summary Card | Split Metric Card (`div`) | Surface background, rounded 12px, padding 14px 20px. Left column: `COMPLETED` label (green uppercase) + large count `{completedJobs.length}`. Vertical divider. Right column: `FAILED` label (danger uppercase) + count `{failedJobs.length}`. | Summarizes final outcomes across all loaded jobs. |
| 35 | Queue & Resources Card | Metric Card (`div`) | Surface background, rounded 12px, padding 20px. Title `Queue & Resources`. Contains 4 divider-separated rows: `Pending Jobs`, `Running Jobs`, `Total Jobs`, and `WORKER LOAD`. | Displays queue depth and computed worker saturation. |
| 36 | Pending Jobs Counter | Metric Row (`div`) | Label `Pending Jobs` (text-secondary), value `{jobs.filter(j => j.status === "QUEUED").length}` in amber monospace font. | Displays count of queued jobs waiting for execution. |
| 37 | Running Jobs Counter | Metric Row (`div`) | Label `Running Jobs` (text-secondary), value `{jobs.filter(j => j.status === "RUNNING").length}` in blue monospace font. | Displays count of jobs currently actively running. |
| 38 | Total Jobs Counter | Metric Row (`div`) | Label `Total Jobs` (text-secondary), value `{jobs.length}` in bold text. | Displays total count of loaded jobs. |
| 39 | Worker Load Meter | Metric & Bar (`div`) | Header row: `WORKER LOAD` uppercase label and `{workerLoad}%` value. Bar: 6px height, fill color green (<=50%), warning amber (51–80%), or red (>80%). Calculated as `round((activeJobs / totalJobs) * 100)`. | Visualizes the ratio of active jobs to total jobs. |
| 40 | Create Snapshot Modal Dialog | Modal Overlay (`AnimatePresence`) | Fixed overlay with backdrop blur. Card with BookmarkPlus icon, title `Capture Code Snapshot`, description, Checkpoint Name input, Notes textarea, `Cancel` button, and `Create Checkpoint` primary button. | Provides dedicated modal interface for checkpoint creation. |
| 41 | Rollback Confirmation Modal | Modal Overlay (`AnimatePresence`) | Fixed overlay with backdrop blur. Card with RotateCcw icon, title `Rollback to Checkpoint?`, target checkpoint summary, warning callout, `Cancel` button, and `Confirm & Rollback` danger button. | Guards against accidental workspace overwrites with explicit confirmation. |
| 42 | Loading Skeletons | Skeleton Loaders | SnapshotsListSkeleton (3 cards) and JobsListSkeleton (3 cards) displayed while `loadingSnapshots` or `loadingJobs` is true and data is empty. | Prevents layout shift during initial data loading. |

---

## 5. Code Snapshots & Checkpoints

### 5.1 Snapshot History
Snapshot history is fetched from the backend via `GET /api/projects/:id/snapshots` by `fetchSnapshots()` in [JobQueue.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L241-L256).

```
+------------------------------------------------------------------------------------------------------------------+
| Snapshot History (1)                                                            [ Q Search checkpoints...    ]   |
+------------------------------------------------------------------------------------------------------------------+
| |  [+] Git: 31a16d5  [ ACTIVE VERSION ]                                                       Current Workspace  |
| |      Imported from GitHub repository                                                                           |
| |      -------------------------------------------------------------------------------------------------         |
| |      (clock) 15:56:21 13/10/2026   (tag) GitHub   Commit: 31a16d5                                              |
+------------------------------------------------------------------------------------------------------------------+
```

#### Verified Implementation Mechanics:
1. **Database Query:** In [project.service.js](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L499-L503), snapshots are queried via Prisma:
   ```javascript
   const snapshots = await prisma.projectSnapshot.findMany({
     where: { projectId },
     orderBy: { createdAt: "desc" },
     include: { ProjectStructureAnalysis: { select: { schemaVersion: true } } },
   });
   ```
2. **Metadata Augmentation:** For each snapshot, the backend inspects the on-disk directory `snapshotWorkspaceRoot(snapshot)/.covai-checkpoint.json`. If present, it extracts `label`, `message`, `fileCount`, and `sizeBytes` (lines 507–514).
3. **Default Fallback Naming:** If metadata is absent:
   - If `commitSha` exists: `Git: ${commitSha.slice(0, 7)}` (as observed in Screenshot 1: `Git: 31a16d5`).
   - If it is the oldest snapshot: `Initial Ingest`.
   - Otherwise: `Checkpoint #${snapshots.length - idx}`.
4. **Active Version Selection:** The backend flags `isCurrent: idx === 0` (line 536), assigning the most recently created or restored snapshot as the active version. In the frontend, line 401 computes:
   ```javascript
   const activeSnapshot = snapshots.find((s) => s.isCurrent) || snapshots[0];
   ```
5. **Search Filtering:** Filtering is implemented purely on the client side (lines 390–399). Entering text in the `Search checkpoints...` field tests whether the search query matches `label`, `message`, `source`, or `commitSha` (case-insensitive).
6. **Project Scoping:** The query is strictly scoped to `where: { projectId }` and enforces user authorization via `findFirst({ where: { id: projectId, ownerId: userId } })` (lines 494–498). Snapshots from other projects or users are never returned.

---

### 5.2 Create Snapshot
The interface provides two entry points for checkpoint creation:
- The **Create Snapshot** button in the top header (opens the `showCreateModal` modal dialog).
- The **Quick Checkpoint** form in the right sidebar column (always visible on Tab 1).

Both entry points invoke the same handler `handleCreateSnapshot(e)` in [JobQueue.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L308-L336), dispatching `createProjectSnapshotApi(projectId, { label, message })`.

#### Verified Capture Pipeline:
1. **Validation & Active Root Discovery:** In [project.service.js](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L547-L566), the service locates the most recent active snapshot for the project to determine the current working directory (`activeSnapshot.rootDir`). If the directory does not exist on disk, it rejects with `400: Current project source code is not available to snapshot`.
2. **ID & Storage Path Generation:** A new unique snapshot identifier is created:
   ```javascript
   const newSnapshotId = `snap_${Date.now()}_${randomUUID().slice(0, 8)}`;
   const baseStorage = path.resolve("storage/projects", projectId, "snapshots", newSnapshotId);
   fs.mkdirSync(baseStorage, { recursive: true });
   ```
3. **Filesystem Copying:** Source files are copied recursively using `copyDirRecursive(workspaceRoot, baseStorage)`. Crucially, `.git` and `node_modules` are excluded from the snapshot copy, keeping snapshot sizes compact.
4. **On-Disk Metadata File:** The service writes `.covai-checkpoint.json` inside `baseStorage` containing:
   ```json
   {
     "id": "snap_1791993271602_a1b2c3d4",
     "label": "Before refactoring auth...",
     "message": "Manual snapshot checkpoint",
     "createdAt": "2026-10-14T16:15:49.000Z",
     "source": "GITHUB",
     "fileCount": 42,
     "sizeBytes": 1048576
   }
   ```
5. **Testing Framework Re-detection:** The backend executes `detectJest(checkpointAnalysisRoot)` to preserve Jest configuration metadata, commands, and options.
6. **Prisma Record Insertion:** A new record is inserted into `prisma.projectSnapshot` with `source: activeSnapshot.source`, `storagePath: baseStorage`, and testing framework detection metadata.
7. **Immediate UI Update:** Upon HTTP 201 response, `handleCreateSnapshot` triggers `fetchSnapshots()` and `onSync?.()`, causing the new checkpoint to appear immediately at the top of the history list with the `ACTIVE VERSION` badge.

---

### 5.3 Version Overview
The right sidebar displays the **Version Overview** card:
- **Total Checkpoints:** Computed as `snapshots.length` (line 1128). In Screenshot 1, this shows `1`.
- **Active Version:** Computed as `activeSnapshot?.label || "None"` (lines 401, 1143). In Screenshot 1, this displays `Git: 31a16d5`.
- **Last Captured:** Formatted time string `formatTime(activeSnapshot.createdAt)` (line 1160). In Screenshot 1, this renders `16:44:21`.
- **Safety Policy Callout:** Renders the text:
  > *"All checkpoints are immutable. Restoring a previous version automatically creates a new checkpoint of your current code first, ensuring zero data loss."*

---

### 5.4 Snapshot Restoration (Critical Safety Audit)
The rollback operation is initiated by clicking the **Rollback to this** button on any inactive snapshot card (`!isCurrent`). This opens the confirmation modal [JobQueue.jsx:1871-2008](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L1871-L2008). Upon confirmation, `restoreProjectSnapshotApi(projectId, snapshotId)` dispatches `POST /api/projects/:id/snapshots/:snapshotId/restore`.

#### Critical Code Finding — Restoration Safety Rule:
In [project.service.js:680-716](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L680-L716):
```javascript
// Stage the target before changing the working tree, including when restoring
// the active snapshot itself.
const restoreCheckpointId = `snap_${Date.now()}_${randomUUID().slice(0, 8)}`;
const restoreStorage = path.resolve("storage/projects", projectId, "snapshots", restoreCheckpointId);
fs.mkdirSync(restoreStorage, { recursive: true });
const { fileCount, sizeBytes } = copyDirRecursive(targetWorkspace, restoreStorage, [".git", "node_modules"]);
cleanWorkingDir(workingDir, [".git", "node_modules"]);
copyDirRecursive(restoreStorage, workingDir, [".git", "node_modules"]);
```

> [!CAUTION]
> **Safety Rule Verification Result: `PARTIALLY IMPLEMENTED` with Data Loss Risk on Dirty Workspace.**
> - **What is Implemented:** A new checkpoint record (`Restored: <targetLabel>`) is created in the database and disk storage, ensuring historical snapshots remain completely immutable.
> - **What is NOT Implemented:** The implementation copies `targetWorkspace` into `restoreStorage`, then immediately calls `cleanWorkingDir(workingDir, ...)`. **It does NOT create a backup checkpoint of the current uncommitted changes in `workingDir` before wiping it.** Any uncommitted edits present in the working tree when restoring an older snapshot are permanently deleted.
> - **Conclusion:** The safety claim in the UI (*"Restoring a previous version automatically creates a new checkpoint of your current code first, ensuring zero data loss"*) is an aspirational UI description that does not match the actual code behavior.

---

## 6. Pipelines & Job Queue

Screenshot 2 displays Tab 2: **Pipelines & Job Queue**.

```
+------------------------------------------------------------------------------------------------------------------+
| All Jobs (2)                                                                          [ All ] [ Active ] [ Done ]|
+------------------------------------------------------------------------------------------------------------------+
| | (flask) Run Tests [test2]                                                           [ COMPLETED (v) ]          |
| |         Running test suite with coverage                                                                       |
| |         Started: 16:02:30 . Duration: 1m 36s                                                                   |
| |         Progress                                                                                 100%          |
| |         [===========================================================================================]          |
+------------------------------------------------------------------------------------------------------------------+
| | (flask) Run Tests [test2]                                                           [ COMPLETED (v) ]          |
| |         Running test suite with coverage                                                                       |
| |         Started: 16:07:44 . Duration: 12s                                                                      |
| |         Progress                                                                                 100%          |
| |         [===========================================================================================]          |
+------------------------------------------------------------------------------------------------------------------+
```

### 6.1 Job Discovery and Persistence
1. **Creation Operations:** Jobs are instantiated by operations across COVAI:
   - Project import (`INGEST` via `ingestJob.service.js`).
   - Dependency installation (`INSTALL_DEPS` via `installDeps.service.js`).
   - Test execution (`RUN_TESTS` and `RUN_VITEST_TESTS` via `runTestsJob.service.js`, `runVitestJob.service.js`).
   - Coverage analysis (`PARSE_COVERAGE`, `SUPERTEST_COVERAGE`, `VITEST_COVERAGE`).
   - AST / Structure analysis (`ANALYSIS`, `BUILD_CFG`).
   - AI generation (`AI_TESTS`, `AI_SUGGEST`).
2. **Persistence Storage:** Jobs are permanently persisted in PostgreSQL tables:
   - `prisma.job`: Core job metadata, type, status, progress, start/finish timestamps, compute time, and result JSON.
   - `prisma.jobLog`: Incremental execution logs with timestamps and log levels (`INFO`, `WARN`, `ERROR`).
   - `prisma.jobOutput`: Raw captured stdout and stderr streams from child processes or test runners.
3. **User Scoping & Filtering:** In `JobQueue.jsx:263-267`, jobs are loaded via `getUserJobsApi()`. The frontend explicitly filters out internal background jobs:
   ```javascript
   const visibleJobs = (data.jobs || []).filter(
     (job) => !["PERFORMANCE_ANALYSIS", "CODE_HYGIENE"].includes(job.type),
   );
   ```
4. **Adaptive Polling:** The frontend maintains real-time synchronization through an adaptive polling mechanism ([JobQueue.jsx:280-300](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L280-L300)):
   - **Fast Polling (`POLL_FAST = 3000ms`):** Active when any job has status `QUEUED` or `RUNNING`.
   - **Slow Polling (`POLL_SLOW = 15000ms`):** Active when all jobs are in terminal states (`SUCCESS`, `FAILED`, `CANCELED`).

---

### 6.2 Job Status Lifecycle

The backend schema defines five distinct job statuses in `JobStatus` ([schema.prisma:530-536](file:///d:/NCKH/CovAI-/server/prisma/schema.prisma#L530-L536)).

```
                       +-----------------------+
                       |        QUEUED         |
                       +-----------------------+
                        /          |          \
           (cancelJob) /           |           \ (markQueuedJobFailed)
                      v            v            v
              +----------+   (markJobRunning)  +----------+
              | CANCELED |         |           |  FAILED  |
              +----------+         v           +----------+
                      ^    +---------------+    ^
                       \---|    RUNNING    |---/
               (cancelJob) +---------------+ (markJobFailed)
                                   |
                                   | (markJobSuccess)
                                   v
                           +---------------+
                           |    SUCCESS    |
                           |  (COMPLETED)  |
                           +---------------+
```

| Status | Meaning in COVAI | Entry Condition | Exit Condition | Source Evidence |
|---|---|---|---|---|
| `QUEUED` | Task is created and waiting in queue for worker availability. | Initial status upon `createSnapshotJob` or `createProjectJob`. | Transitions to `RUNNING` when picked up by worker, or `CANCELED` / `FAILED` if aborted before start. | [job.service.js:505](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L505) |
| `RUNNING` | Worker process has started execution and acquired resources. | Worker calls `markJobRunning(jobId)`. Sets `startedAt = new Date()`. | Transitions to `SUCCESS`, `FAILED`, or `CANCELED`. Terminal once exited. | [job.service.js:554-575](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L554-L575) |
| `SUCCESS` | Task completed all steps without unhandled exceptions. Displayed as `COMPLETED` in UI. | Worker calls `markJobSuccess(jobId, result)`. Sets `progress = 100`, `finishedAt`, and `computeTimeMs`. | Terminal state. Cannot be mutated. | [job.service.js:577-625](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L577-L625) |
| `FAILED` | Task encountered an unhandled exception, assertion crash, or fatal error. | Handler catches exception and calls `markJobFailed(jobId, err)` or `markQueuedJobFailed`. | Terminal state. | [job.service.js:627-695](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L627-L695) |
| `CANCELED` | Task was manually terminated by user or aborted by stale job timeout reaper. | User clicks `Stop Job` (`cancelJob(jobId)`) or reaper detects inactivity > 6m. | Terminal state. | [job.service.js:697-717](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L697-L717) |

---

### 6.3 Job Cards and Progress
For each job card ([JobQueue.jsx:1297-1524](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L1297-L1524)):
1. **Type & Label:** Visual mapping via `JOB_TYPE_CONFIG[job.type]`. For `RUN_TESTS`, it renders `TestTube2` icon, title `Run Tests`, and description `Running test suite with coverage`.
2. **Project Badge:** If `job.project?.name` exists, renders a purple tag (e.g. `test2` in Screenshot 2).
3. **Execution Timing:** Formats start time (`Started: 16:02:30`) and total elapsed duration (`Duration: 1m 36s`). If the job is currently running, `formatDuration` calculates duration from `startedAt` to current client time.
4. **Progress Calculation:** Progress is updated by backend workers using `updateJobProgress(jobId, pct)`.
   - In `runTestsJob.service.js`, progress advances through explicit execution milestones:
     - `10%`: Test runner environment initialization.
     - `25%`: Testing framework and configuration detection.
     - `50%` / `70%`: Test execution in isolated runner.
     - `75%` / `85%`: Coverage file parsing and function extraction.
     - `100%`: Final report storage and database persistence.
   - When `markJobSuccess` is invoked, it unconditionally clamps `progress: 100`.
   - **Important:** `100%` progress indicates that the execution pipeline completed successfully; it does not indicate that all test assertions passed. Individual test failures (failing unit test assertions) are recorded inside `resultJson` and summary reports without marking the pipeline job itself as `FAILED` unless the runner process crashes.

---

### 6.4 Job Filters
The filter bar contains three buttons: `All`, `Active`, and `Done` ([JobQueue.jsx:1209-1237](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L1209-L1237)).
- `ALL`: Displays all retrieved jobs (`filteredJobs = jobs`).
- `ACTIVE`: Displays jobs where `status === "QUEUED" || status === "RUNNING"`.
- `COMPLETED` (`Done` button): Displays jobs where `["SUCCESS", "FAILED", "CANCELED"].includes(status)`.
- **Implementation Note:** Filtering occurs entirely client-side on the in-memory `jobs` array.

---

### 6.5 Completed and Failed Summary
The top-right summary card in Screenshot 2 displays:
- **`COMPLETED`:** `completedJobs.length = jobs.filter(j => j.status === "SUCCESS").length` (line 372). In Screenshot 2, this is `2`.
- **`FAILED`:** `failedJobs.length = jobs.filter(j => j.status === "FAILED").length` (line 373). In Screenshot 2, this is `0`.
- **Aggregation Scope:** These counts are aggregated across all loaded user jobs (excluding performance/hygiene tasks) and update immediately on every polling interval.

---

### 6.6 Queue & Resources
The **Queue & Resources** card displays 4 metrics ([JobQueue.jsx:1601-1716](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L1601-L1716)):
1. **`Pending Jobs`:** `{jobs.filter(j => j.status === "QUEUED").length}`. In Screenshot 2, this displays `0`.
2. **`Running Jobs`:** `{jobs.filter(j => j.status === "RUNNING").length}`. In Screenshot 2, this displays `0`.
3. **`Total Jobs`:** `{jobs.length}`. In Screenshot 2, this displays `2`.
4. **`WORKER LOAD`:** In Screenshot 2, this displays `0%` with an empty meter.
   - **Critical Formula Finding:** Line 386 defines:
     $$\text{workerLoad} = \text{round}\left(\frac{\text{activeJobs.length}}{\max(\text{jobs.length}, 1)} \times 100\right)$$
     where $\text{activeJobs}$ are jobs in `QUEUED` or `RUNNING` status.
   - **Conclusion:** `WORKER LOAD` is **not** a hardware CPU or RAM utilization metric from the operating system or Docker host. It is a mathematical ratio representing queue saturation (the percentage of loaded jobs that are currently active).

---

## 7. Frontend-Backend Workflows

```
[User Action] ---> [JobQueue.jsx] ---> [project.service.js / job.service.js]
                          |                             |
                          v                             v
                   [React State]                [Express Routes]
                          ^                             |
                          |                             v
                    (Fast Poll)                 [Controllers]
                          |                             |
                          +--- [PostgreSQL / FS] <------+ (Service / Queue)
```

### Traceability Matrix of End-to-End Workflows

| Workflow | Frontend Entry Point | API/Service | Backend Handler | Persistence/Queue | UI Result |
|---|---|---|---|---|---|
| **Workflow A: Create Snapshot** | User inputs name/notes in Quick Checkpoint form and clicks `Capture Snapshot Now` ([JobQueue.jsx:1018](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L1018)). | `createProjectSnapshotApi(projectId, payload)` in [project.service.js](file:///d:/NCKH/CovAI-/client/src/services/project.service.js#L42). | `createSnapshot` in [project.controller.js:255](file:///d:/NCKH/CovAI-/server/src/controllers/project.controller.js#L255) -> `createProjectCheckpoint` in [project.service.js:541](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L541). | Copies directory to `storage/projects/<id>/snapshots/<snapId>/`; writes `.covai-checkpoint.json`; inserts `prisma.projectSnapshot`. | Form resets, success notice displayed, snapshot list re-fetched, and new card appears with `ACTIVE VERSION`. |
| **Workflow B: Load Snapshot History** | Tab 1 mounts or user clicks `Refresh` ([JobQueue.jsx:241](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L241)). | `getProjectSnapshotsApi(projectId)` in [project.service.js](file:///d:/NCKH/CovAI-/client/src/services/project.service.js#L32). | `listSnapshots` in [project.controller.js:231](file:///d:/NCKH/CovAI-/server/src/controllers/project.controller.js#L231) -> `listProjectSnapshots` in [project.service.js:493](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L493). | Reads `prisma.projectSnapshot` sorted by `createdAt: 'desc'`; reads on-disk `.covai-checkpoint.json`. | Renders snapshot cards with `isCurrent: idx === 0`; updates Total Checkpoints and Last Captured counters. |
| **Workflow C: Load Jobs** | Tab 2 mounts, user clicks `Refresh`, or periodic interval fires ([JobQueue.jsx:259](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L259)). | `getUserJobsApi()` in [job.service.js](file:///d:/NCKH/CovAI-/client/src/services/job.service.js#L14). | `listUserJobs` in [job.controller.js:140](file:///d:/NCKH/CovAI-/server/src/controllers/job.controller.js#L140). | Queries `prisma.job` for authenticated `userId`, ordering by `createdAt: 'desc'`. | Renders job execution cards, updates Completed/Failed counters, updates Queue & Resources, and sets Worker Load meter. |
| **Workflow D: Run Tests Pipeline** | Triggered from Unit Test dashboard or test generation flow. | `createRunTestsJob` in [job.service.js:228](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L228). | `addJobToQueue("RUN_TESTS", jobId)` in [queue.service.js:290](file:///d:/NCKH/CovAI-/server/src/services/queue.service.js#L290). | Enqueued in BullMQ Redis queue `covai-jobs` (or direct in-memory fallback `executeJobDirectly`). | Job appears in `Pipelines & Job Queue` with status `QUEUED`, transitions to `RUNNING` (pulsating dot), and advances progress to `100%`. |
| **Workflow E: Refresh** | User clicks `Refresh` button in top header ([JobQueue.jsx:512](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L512)). | Concurrent `Promise.all([fetchSnapshots(), fetchJobs()])`. | Dispatches both `GET /api/projects/:id/snapshots` and `GET /api/jobs/user`. | Reloads PostgreSQL records and metadata files. | Re-renders both tabs with spinning `RefreshCw` icon during loading. |
| **Workflow F: Restore Snapshot** | User clicks `Rollback to this` on historical card and confirms in modal ([JobQueue.jsx:339](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L339)). | `restoreProjectSnapshotApi(projectId, snapshotId)` in [project.service.js](file:///d:/NCKH/CovAI-/client/src/services/project.service.js#L54). | `restoreSnapshot` in [project.controller.js:283](file:///d:/NCKH/CovAI-/server/src/controllers/project.controller.js#L283) -> `restoreProjectCheckpoint` in [project.service.js:643](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L643). | Copies target snapshot to new restore path; cleans working directory; copies target to working directory; creates new `ProjectSnapshot` record. | Modal closes, success banner displayed, active version switches to the newly restored checkpoint. |

---

## 8. Data Persistence and Queue Integration

### 8.1 Database Schema Reference
The module relies on three core Prisma models in [schema.prisma](file:///d:/NCKH/CovAI-/server/prisma/schema.prisma):

```prisma
model ProjectSnapshot {
  id                          String                    @id @default(cuid())
  projectId                   String
  source                      SnapshotSource            // ZIP | GITHUB
  checksum                    String?
  commitSha                   String?
  storagePath                 String
  rootDir                     String?
  createdAt                   DateTime                  @default(now())
  hasJest                     Boolean                   @default(false)
  hasVitest                   Boolean                   @default(false)
  hasPlaywright               Boolean                   @default(false)
  hasCypress                  Boolean                   @default(false)
  jobs                        Job[]
  coverageSummaries           CoverageSummary?
  project                     Project                   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  ProjectStructureAnalysis    ProjectStructureAnalysis?
  QualityReport               QualityReport?
}

model Job {
  id            String           @id @default(cuid())
  projectId     String
  snapshotId    String?
  userId        String?
  type          JobType          // RUN_TESTS, INGEST, INSTALL_DEPS, AI_TESTS, etc.
  status        JobStatus        // QUEUED, RUNNING, SUCCESS, FAILED, CANCELED
  progress      Int              @default(0)
  payloadJson   String?
  resultJson    String?
  errorMessage  String?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime         @default(now())
  computeTimeMs Int?
  logs          JobLog[]
  output        JobOutput?
}
```

### 8.2 Filesystem Storage Layout
Checkpoints and temporary project files are stored on disk according to a strict hierarchical pattern:
```
storage/
  projects/
    <projectId>/
      workspace/                                 <-- Current active working tree
        src/
        tests/
        package.json
      snapshots/
        snap_1791993271602_a1b2c3d4/             <-- Immutable checkpoint folder
          .covai-checkpoint.json                 <-- Checkpoint metadata
          src/
          tests/
          package.json
        snap_1791995821000_f9e8d7c6/             <-- Restored checkpoint folder
          .covai-checkpoint.json
          ...
```

### 8.3 BullMQ & Redis Queue with In-Memory Fallback
Queue dispatch is implemented in [queue.service.js](file:///d:/NCKH/CovAI-/server/src/services/queue.service.js).
1. **Primary Queue (BullMQ + Redis):** Creates `jobQueue = new Queue('covai-jobs', { connection })` using `ioredis`. When Redis is connected, tasks are submitted with deduplication keys `${type}-${jobId}` (lines 298–300).
2. **Automatic In-Memory Fallback Execution:** If Redis is unavailable or throws a connection error, COVAI does **not** fail the job creation request. Instead, it logs a warning and dispatches direct asynchronous in-memory execution (line 293):
   ```javascript
   if (!isRedisConnected && process.env.NODE_ENV !== 'test') {
     console.warn(`[Queue] Redis unavailable. Executing Job ${jobId} (${type}) directly in-memory...`);
     setTimeout(() => executeJobDirectly(type, jobId, customData), 10);
     return;
   }
   ```
   This ensures that developer workflows, test executions, and snapshot ingest jobs continue to function seamlessly even in local environments without a running Redis server.

---

## 9. Concurrency and Error Handling

| Scenario | Actual Handling | User Feedback | Data Consistency Protection | Source Evidence | Status |
|---|---|---|---|---|---|
| **Empty Checkpoint Name** | Backend defaults `label` to timestamp: `Checkpoint HH:mm` if omitted or whitespace. | Input accepted; snapshot created with default label. | Sanitized via `label?.trim() \|\| defaultLabel`. | [project.service.js:585](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L585) | `IMPLEMENTED` |
| **Missing Project Source Directory** | Backend checks `fs.existsSync(activeSnapshot.rootDir)`. Throws `ServiceError("Current project source code is not available to snapshot", 400)`. | Red error banner displayed in UI (`errorSnapshots`). | Aborts before filesystem creation or database insertion. | [project.service.js:557-566](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L557-L566) | `IMPLEMENTED` |
| **Disk Storage / Copy Failure** | Uncaught exceptions during `copyDirRecursive` or `fs.writeFileSync` abort the request before Prisma creation. | UI displays red error alert with error message. | Database record is not created if disk write fails. Partial directory may remain on disk. | [project.service.js:575-608](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L575-L608) | `PARTIALLY IMPLEMENTED` |
| **Concurrent Duplicate Job Creation** | `assertNoActiveJob` checks for active jobs of same type; Prisma unique partial index `Job_active_singleton_per_snapshot_key` catches race conditions. | Returns HTTP 409: `A <type> job is already queued or running for this project`. | Prevents duplicate running pipelines on same snapshot. | [job.service.js:194-209](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L194-L209), [schema.prisma:180](file:///d:/NCKH/CovAI-/server/prisma/schema.prisma#L180) | `IMPLEMENTED` |
| **Redis Server Down** | `addJobToQueue` catches Redis error or checks `isRedisConnected === false`; falls back to `executeJobDirectly`. | Job transitions to `RUNNING` normally; user unaware of queue failure. | Execution order maintained in-process via Node event loop. | [queue.service.js:290-308](file:///d:/NCKH/CovAI-/server/src/services/queue.service.js#L290-L308) | `IMPLEMENTED` |
| **Worker / Job Crash** | Worker catch block captures error and calls `markJobFailed(jobId, error)`. Clamps `computeTimeMs`. | Job card displays red `FAILED` badge and red diagnostic error box. | Status marked terminal `FAILED`; prevents worker deadlock. | [queue.service.js:250-273](file:///d:/NCKH/CovAI-/server/src/services/queue.service.js#L250-L273), [job.service.js:627](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L627) | `IMPLEMENTED` |
| **Stale Inactive Jobs** | `cleanupStaleJobsForProject` runs before new job creation or every poll; detects jobs with no log activity for > 6m. | Job marked `CANCELED` with message `Job became inactive for ... and was automatically stopped`. | Frees blocked project job slots. | [job.service.js:89-139](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L89-L139) | `IMPLEMENTED` |
| **Manual Job Cancellation** | User clicks `Stop Job`; frontend invokes `cancelJobApi(jobId)`. Service updates status to `CANCELED`. | Button changes to `Stopping...`; card transitions to gray `CANCELED` badge. | Job process termination signaled; status made terminal. | [JobQueue.jsx:228-238](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L228-L238), [job.service.js:697](file:///d:/NCKH/CovAI-/server/src/services/job.service.js#L697) | `IMPLEMENTED` |
| **Snapshot Restore Target Missing** | Backend verifies `targetSnapshot && fs.existsSync(targetSnapshot.rootDir)`. Throws 404 if missing. | Red error notification banner displayed; rollback aborted. | Current working directory is left untouched. | [project.service.js:654-666](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L654-L666) | `IMPLEMENTED` |
| **Snapshot Restore Working Directory Overwrite** | `cleanWorkingDir(workingDir)` empties workspace before copying target snapshot files. | Workspace reverted to historical state. | Uncommitted modifications in the working tree are lost without prior safety backup. | [project.service.js:686-688](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L686-L688) | `PARTIALLY IMPLEMENTED` |

---

## 10. Screenshot-to-Code Comparison

The visual elements in the two reference screenshots were compared against the rendered JSX, styling classes, and state bindings in [JobQueue.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx).

| UI Element | Screenshot Observation | Actual Implementation | Status | Notes |
|---|---|---|---|---|
| **Header Title & Badge** | `Pipelines & Version Hub` with `Checkpoints & AI Queues` badge. | Matches exact text, font weights, and pill styling in [JobQueue.jsx:464-484](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L464-L484). | `MATCH` | Identical text and design tokens. |
| **Create Snapshot Button** | Purple primary button with BookmarkPlus icon in header. | Verified in lines 493–507. Triggers `setShowCreateModal(true)`. | `MATCH` | Visual styling and click interaction match. |
| **Refresh Button** | White surface button with RefreshCw icon in header. | Verified in lines 510–528. Spins during `loadingSnapshots \|\| loadingJobs`. | `MATCH` | Triggers simultaneous reload of snapshots and jobs. |
| **Tab 1: Snapshots Tab** | `Code Snapshots & Checkpoints (1)` with Layers icon. | Verified in lines 584–626. Renders Layers icon, title, and count `{snapshots.length}`. | `MATCH` | Layout, badge count, and active styling match. |
| **Tab 2: Jobs Tab** | `Pipelines & Job Queue (2)` with Cpu icon. | Verified in lines 629–678. Renders Cpu icon and total count or active count pill. | `MATCH` | Matches inactive state in Screenshot 1 and active state in Screenshot 2. |
| **Snapshot Card (Active)** | Card with purple border, `Git: 31a16d5`, `ACTIVE VERSION` badge, `Current Workspace` text. | Verified in lines 808–975. Renders purple left accent stripe, BookmarkPlus icon, active version badge, and metadata. | `MATCH` | Matches card layout in Screenshot 1 exactly. |
| **Snapshot Metadata Row** | Clock + `15:56:21 13/10/2026`, Tag + `GitHub`, Commit + `31a16d5`. | Verified in lines 922–974. Formats timestamp via `formatDateTime` and displays commit SHA. | `MATCH` | Exact visual and data match. |
| **Quick Checkpoint Form** | Right sidebar form with Checkpoint Name, Description, and `Capture Snapshot Now` button. | Verified in lines 985–1096. Matches input placeholders and purple Sparkles button. | `MATCH` | Identical layout and field structure. |
| **Version Overview Card** | `Total Checkpoints: 1`, `Active Version: Git: 31a16d5`, `Last Captured: 16:44:21`. | Verified in lines 1100–1164. Computes metrics from `snapshots` array. | `MATCH` | Matches metrics displayed in Screenshot 1. |
| **Safety Policy Note** | Text asserting checkpoints are immutable and restoration creates a new checkpoint first. | Verified in lines 1166–1184. Displays ShieldCheck icon and identical text. | `MATCH` (Visual) / `MISMATCH` (Logic) | Visual layout matches, but code does not backup dirty workspace prior to rollback. |
| **Job Cards (Run Tests)** | 2 completed cards with TestTube2 icon, `Run Tests`, `test2` badge, duration, `COMPLETED` badge, and 100% green progress bar. | Verified in lines 1297–1524. `JOB_TYPE_CONFIG.RUN_TESTS` matches labels and icons; status `SUCCESS` maps to `COMPLETED`. | `MATCH` | Matches both job cards in Screenshot 2. |
| **Job Filter Buttons** | Segmented `All`, `Active`, `Done` buttons on right of job header. | Verified in lines 1209–1237. Filters client-side between `ALL`, `ACTIVE`, and `COMPLETED`. | `MATCH` | Matches segmented filter controls in Screenshot 2. |
| **Completed / Failed Summary** | `COMPLETED: 2` (green) and `FAILED: 0` (gray) horizontal split card. | Verified in lines 1532–1598. Matches typography, dividers, and counts. | `MATCH` | Matches summary card in Screenshot 2. |
| **Queue & Resources Card** | `Pending Jobs: 0`, `Running Jobs: 0`, `Total Jobs: 2`, `WORKER LOAD: 0%`. | Verified in lines 1601–1716. Matches rows, font colors, and progress bar meter. | `MATCH` | Matches card in Screenshot 2. |
| **Stop Job Button** | Not visible in Screenshot 2 because all jobs are completed. | Implemented in lines 1402–1427. Visible only when `status === "QUEUED" \|\| status === "RUNNING"`. | `IMPLEMENTED` | Conditional visibility verified; hidden when no jobs active. |

---

## 11. Findings and Limitations

1. **Worker Load is Queue Saturation, Not Hardware Utilization:**
   - The label `WORKER LOAD` suggests hardware CPU or memory utilization. In reality, [JobQueue.jsx:386](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L386) calculates the mathematical ratio of active jobs to total jobs. If there are 0 running jobs and 2 completed jobs, the load is `0%`, regardless of server CPU usage.
2. **Restoration Safety Discrepancy:**
   - The informational note claims: *"Restoring a previous version automatically creates a new checkpoint of your current code first, ensuring zero data loss."*
   - Code verification in [project.service.js:680-688](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L680-L688) reveals that the server stages the *target* snapshot into a new directory, then calls `cleanWorkingDir(workingDir)` before copying the files into `workingDir`. If the user has uncommitted, dirty modifications in the workspace when triggering a rollback, those changes are wiped and permanently lost.
3. **Dynamic Active Version Flagging:**
   - The PostgreSQL `ProjectSnapshot` table does not contain an `isActive` or `isCurrent` boolean column. Active version status is dynamically assigned by the backend ([project.service.js:536](file:///d:/NCKH/CovAI-/server/src/services/project.service.js#L536)) to the first item (`idx === 0`) in the array when sorted by `createdAt: 'desc'`.
4. **Dual Snapshot Creation Interfaces:**
   - The user can create snapshots either through the always-visible `Quick Checkpoint` form in Tab 1 or the `Create Snapshot` modal dialog. Both call `createProjectSnapshotApi` with identical parameters, providing convenient dual-path access.
5. **Robust BullMQ & Direct In-Memory Fallback:**
   - The background queue implementation in [queue.service.js:290-308](file:///d:/NCKH/CovAI-/server/src/services/queue.service.js#L290-L308) features an automatic fallback to asynchronous in-memory execution via `setTimeout(() => executeJobDirectly(...), 10)` if Redis is offline. This ensures high local development resilience.
6. **Polling vs Server-Sent Events (SSE):**
   - While the backend exposes a dedicated SSE streaming endpoint `GET /api/jobs/:jobId/stream` ([job.route.js:14](file:///d:/NCKH/CovAI-/server/src/routes/job.route.js#L14)), the frontend [JobQueue.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L280-L300) relies on HTTP polling (`POLL_FAST = 3s`, `POLL_SLOW = 15s`). This reduces WebSocket/SSE connection complexity while providing near real-time updates.
7. **Client-Side Filtering and Search:**
   - Both snapshot search and job category filtering (`All`, `Active`, `Done`) are executed entirely in the React client on the loaded arrays, ensuring immediate search responsiveness without network latency.
8. **Internal Background Job Exclusion:**
   - `JobQueue.jsx:264-266` filters out `PERFORMANCE_ANALYSIS` and `CODE_HYGIENE` jobs from the user interface. These jobs execute silently in the background without cluttering the user's primary pipeline queue.
9. **Progress vs Test Assertion Success:**
   - Job cards display `Progress: 100%` and `COMPLETED` when the test runner finishes execution. If unit test assertions fail, the job still completes with `100%` progress and `COMPLETED` status, while the failure details are stored inside `resultJson` and displayed in the coverage/test reporting views.
10. **Interactive Cancellation:**
    - Active jobs render a red `Stop Job` button ([JobQueue.jsx:1402-1427](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx#L1402-L1427)) that dispatches `POST /api/jobs/:jobId/cancel`, allowing users to terminate long-running or runaway test runs.

---

## 12. Source References

The findings in this report were verified against the following repository source files:

1. [client/src/components/dashboard/JobQueue.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/JobQueue.jsx) (Lines 1–2012): Primary UI component rendering Pipelines & Version Hub, snapshot history, checkpoint forms, job list, queue metrics, and modal dialogs.
2. [client/src/components/dashboard/Layout.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/Layout.jsx) (Lines 945–946): Main workspace dashboard mounting `JobQueue`.
3. [client/src/components/dashboard/ActivityBar.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/ActivityBar.jsx) (Line 18): Activity bar navigation registration for `Snapshots & Jobs`.
4. [client/src/components/dashboard/CoverageTypeDashboard.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/CoverageTypeDashboard.jsx) (Lines 5232–5306): Modal invocation of `JobQueue` during test runs.
5. [client/src/services/job.service.js](file:///d:/NCKH/CovAI-/client/src/services/job.service.js) (Lines 1–160): REST API client methods for user jobs and job cancellation.
6. [client/src/services/project.service.js](file:///d:/NCKH/CovAI-/client/src/services/project.service.js) (Lines 30–65): REST API client methods for snapshot listing, creation, and restoration.
7. [server/src/routes/project.route.js](file:///d:/NCKH/CovAI-/server/src/routes/project.route.js) (Lines 25–30): Express routes for project snapshots and restoration.
8. [server/src/controllers/project.controller.js](file:///d:/NCKH/CovAI-/server/src/controllers/project.controller.js) (Lines 231–305): Controller dispatch for snapshot CRUD and rollback operations.
9. [server/src/services/project.service.js](file:///d:/NCKH/CovAI-/server/src/services/project.service.js) (Lines 493–760): Core backend service for snapshot listing, checkpoint capture, on-disk metadata writing, and workspace rollback.
10. [server/src/routes/job.route.js](file:///d:/NCKH/CovAI-/server/src/routes/job.route.js) (Lines 1–16): Express routes for job listing, detail retrieval, cancellation, and SSE status streaming.
11. [server/src/controllers/job.controller.js](file:///d:/NCKH/CovAI-/server/src/controllers/job.controller.js) (Lines 60–180, 310–360): Controller handlers for job queries and cancellations.
12. [server/src/services/job.service.js](file:///d:/NCKH/CovAI-/server/src/services/job.service.js) (Lines 1–836): Core job lifecycle service managing status transitions (`QUEUED` -> `RUNNING` -> `SUCCESS` / `FAILED` / `CANCELED`), progress clamping, and stale job reaper timeouts.
13. [server/src/services/queue.service.js](file:///d:/NCKH/CovAI-/server/src/services/queue.service.js) (Lines 1–372): BullMQ Redis queue manager, worker event listeners, and automatic in-memory direct executor fallback.
14. [server/src/services/runTestsJob.service.js](file:///d:/NCKH/CovAI-/server/src/services/runTestsJob.service.js) (Lines 1–2734): Test execution runner updating intermediate progress stages and logs.
15. [server/prisma/schema.prisma](file:///d:/NCKH/CovAI-/server/prisma/schema.prisma) (Lines 77–205, 502–536): Database definitions for `ProjectSnapshot`, `Job`, `JobLog`, `JobOutput`, `SnapshotSource`, `JobType`, and `JobStatus`.
