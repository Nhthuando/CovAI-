import {
  FolderKanban,
  FileCode2,
  LayoutDashboard,
  FlaskConical,
  GitBranch,
  Network,
  Layers,
  MonitorPlay,
  Bot,
  ListChecks,
  Compass,
} from "lucide-react";

export const GUIDANCE_TRACKS = [
  { id: "workspace", label: "Workspace & Overview" },
  { id: "unit", label: "Unit Testing" },
  { id: "integration", label: "Integration Testing" },
  { id: "system", label: "System / E2E Testing" },
  { id: "chatbot", label: "AI Chatbot Evaluation" },
  { id: "engineering", label: "Architecture & Governance" },
];

export const GUIDANCE_STEPS = [
  {
    id: "portfolio-import",
    number: 1,
    track: "workspace",
    title: "Portfolio, Project Import & Snapshots",
    shortTitle: "Portfolio & Import",
    icon: FolderKanban,
    location: "Projects Portfolio (/projects) → + Project",
    summary:
      "Start by importing a repository from GitHub or uploading a ZIP/RAR archive. CovAI versions every import into immutable snapshots and tracks Quality Gates across all projects.",
    target: {
      kind: "portfolio",
      label: "Open Projects Portfolio",
    },
    aiPrompt:
      "Summarize the overall quality gate status, active snapshots, and highest-risk layer across my projects.",
    stages: [
      {
        id: "import-source",
        label: "1. Import Source Code",
        action: "+ Project (Top Header)",
        detail:
          "Click + Project on the Portfolio page to upload a local ZIP/RAR archive (up to 200 MB compressed) or shallow-clone a GitHub repository. CovAI automatically strips secrets, skips node_modules/.git, and indexes your workspace tree.",
        tip: "Ensure package.json is at the root (or clear monorepo folders) so framework detection can identify Jest, Vitest, Supertest, Playwright, or Cypress automatically.",
      },
      {
        id: "portfolio-gates",
        label: "2. Monitor Portfolio Quality Gates",
        action: "Portfolio KPI Row & Risk Quadrant",
        detail:
          "The Portfolio dashboard aggregates Health Scores, Quality Gates (Passed, At Risk, Blocked, Untested), and Risk Quadrant scatter plots (70% coverage and 85% pass-rate thresholds) across all active projects.",
        tip: "Click any project card's Unit / API / E2E mini-progress bars to jump straight into that test layer inside the Studio workspace.",
      },
      {
        id: "snapshots-lifecycle",
        label: "3. Snapshots & Lifecycle Status",
        action: "Snapshot Switcher & Lifecycle Select",
        detail:
          "Each import or Version Control publish creates an immutable snapshotId. You can switch project lifecycle status (NOT_STARTED, DOING, DONE, etc.) or open two projects in Side-by-Side Comparison.",
        tip: "Coverage, CFG, and test scenarios are scoped to each snapshot so historical baselines never get overwritten.",
      },
    ],
    connections: [
      {
        label: "Explorer & Editor",
        desc: "Open imported files in the real-time Yjs code editor",
        stepId: "explorer-editor",
        target: { kind: "workspace", activity: "explorer" },
      },
      {
        label: "Unified Overview",
        desc: "Inspect combined Unit + Integration + System health",
        stepId: "unified-overview",
        target: { kind: "workspace", activity: "overview" },
      },
      {
        label: "Version Control",
        desc: "Publish new snapshots or sync Git branches",
        stepId: "arch-cfg-git-rbac",
        target: { kind: "workspace", activity: "version-control" },
      },
    ],
    gotchas: [
      "Environment files (.env, private keys) are blocked during archive ingestion for security. Configure test env vars later in Test Setup.",
      "If source extraction is still running in BullMQ, check the Floating Job Queue or Activity Log before running tests.",
    ],
  },
  {
    id: "explorer-editor",
    number: 2,
    track: "workspace",
    title: "Explorer, Collaborative Editor & AI Chatbot",
    shortTitle: "Editor & AI Chatbot",
    icon: FileCode2,
    location: "Activity Bar → Explorer & Top Right → AI Chatbot",
    summary:
      "Edit code collaboratively with Yjs live cursors, inspect line-by-line 4D coverage gutters directly inside Monaco Editor, and ask the screen-aware AI Chatbot for targeted fixes.",
    target: {
      kind: "workspace",
      activity: "explorer",
      label: "Open Explorer & Editor",
    },
    aiPrompt:
      "Explain the active file's responsibilities, uncovered branches, and what unit or integration tests I should write next.",
    stages: [
      {
        id: "file-tree-yjs",
        label: "1. File Tree & Real-Time Yjs Editing",
        action: "Left Sidebar + Monaco Tabs",
        detail:
          "Create, rename, or delete files/folders in the Explorer sidebar (respecting RBAC permissions). Multiple teammates can edit the same file concurrently with Yjs CRDT synchronization, presence cursors, and shared undo.",
        tip: "Drag editor tabs to reorder them. Unsaved changes show a dot indicator and are protected by conflict detection.",
      },
      {
        id: "coverage-gutters",
        label: "2. Coverage Gutters & Jump Navigation",
        action: "Editor Gutter Markers (✓ / ⚑ / ×)",
        detail:
          "Once Unit, Integration, or System tests run, Monaco displays inline line coverage markers: green ✓ for covered lines, amber ⚑ for uncovered lines, and red × for failed paths.",
        tip: "Clicking 'Open in Editor' from Unit Matrix, CFG Calculator, Integration Source Viewer, or System Specs jumps directly to that file and line.",
      },
      {
        id: "ai-chatbot-bridge",
        label: "3. Context-Aware AI Chatbot",
        action: "Top Header → AI Chatbot (#covai-chatbot)",
        detail:
          "The AI Chatbot reads your active workspace context (current file, active test run metrics, failing scenarios, or Unified Overview summary). You can attach files with @, switch Gemini models, or branch conversations.",
        tip: "Daily AI usage is tracked in the Global AI Quota pill in the top bar (default 50 requests/day per user).",
      },
    ],
    connections: [
      {
        label: "Unit Test Matrix",
        desc: "Jump from uncovered source lines to generate unit tests",
        stepId: "unit-setup-run",
        target: { kind: "workspace", activity: "coverage", coverageType: "unit" },
      },
      {
        label: "Logic Analysis (CFG)",
        desc: "Inspect McCabe complexity & branch paths for any file",
        stepId: "arch-cfg-git-rbac",
        target: { kind: "workspace", activity: "logic-analysis" },
      },
      {
        label: "Activity Log",
        desc: "Track background AI generation and runner jobs",
        stepId: "arch-cfg-git-rbac",
        target: { kind: "workspace", activity: "jobs" },
      },
    ],
    gotchas: [
      "Viewers have read-only access in the Editor; an Owner or Editor must grant files.write permission in Settings → Members.",
      "Press Esc when focused inside the AI Chatbot to collapse the side panel and return focus to the workspace.",
    ],
  },
  {
    id: "unified-overview",
    number: 3,
    track: "workspace",
    title: "Unified Quality Overview & Cross-Layer Trace",
    shortTitle: "Unified Overview",
    icon: LayoutDashboard,
    location: "Activity Bar → Overview",
    summary:
      "See your entire project's quality in one command center: weighted Health Score, 3-Tier Testing Pyramid, Cross-Layer Trace Matrix, and prioritized Smart Actions.",
    target: {
      kind: "workspace",
      activity: "overview",
      label: "Open Unified Overview",
    },
    aiPrompt:
      "Analyze my Unified Quality Overview, explain why the Health Score or Quality Gate is at its current state, and prioritize what to fix first.",
    stages: [
      {
        id: "health-score",
        label: "1. Health Score & Snapshot Selector",
        action: "Global Command Header",
        detail:
          "CovAI computes a weighted Unified Health Score combining Unit (50%), Integration (30%), and System (20%) results. Use the Snapshot selector in the command header to inspect or activate different snapshots.",
        tip: "Click 'AI Analyze' in the Overview header to send the full multi-layer summary, low-coverage files, and failing modules straight into the AI Chatbot.",
      },
      {
        id: "pyramid-pillars",
        label: "2. Testing Pyramid & Pillar Drill-Down",
        action: "Pyramid Visualizer & Pillar Cards",
        detail:
          "Compare Unit, Integration, and System test proportions against a healthy testing pyramid. Clicking any pillar or failure breakdown cross-filters the Trace Matrix and recent runs below.",
        tip: "Use the pillar card action buttons to jump directly to Unit, Integration, or System Test workspaces with focus targets.",
      },
      {
        id: "trace-actions-export",
        label: "3. Trace Matrix, Inspector & Export",
        action: "Cross-Layer Trace Matrix & Export Buttons",
        detail:
          "Click any module row or Smart Action item to open the Slide-Over Inspector Drawer with suspect-layer diagnostics. Export formatted A4 PDF, JSON, or customized Markdown reports from the header.",
        tip: "All three testing levels feed automatically into this Overview whenever a run completes via Socket.IO.",
      },
    ],
    connections: [
      {
        label: "Unit Testing",
        desc: "Contributes 50% weight to Unified Health Score",
        stepId: "unit-setup-run",
        target: { kind: "workspace", activity: "coverage", coverageType: "unit" },
      },
      {
        label: "Integration Testing",
        desc: "Contributes 30% weight + API endpoint traceability",
        stepId: "integration-scan-setup",
        target: { kind: "workspace", activity: "coverage", coverageType: "integration" },
      },
      {
        label: "System / E2E Testing",
        desc: "Contributes 20% weight + user-flow verification",
        stepId: "system-setup-matrix",
        target: { kind: "workspace", activity: "coverage", coverageType: "system" },
      },
    ],
    gotchas: [
      "If a layer shows 'Untested', open that specific tab (Unit, Integration, or System) and run a baseline suite so its telemetry populates here.",
    ],
  },
  {
    id: "unit-setup-run",
    number: 4,
    track: "unit",
    title: "Unit Testing — Runner Setup & Baseline Coverage",
    shortTitle: "Unit: Setup & Baseline",
    icon: FlaskConical,
    location: "Top Bar → Unit Test → Test Setup & Run Coverage",
    summary:
      "Configure Jest or Vitest, install any missing test dependencies automatically, run isolated baseline tests, and inspect 4-dimensional coverage across every source file.",
    target: {
      kind: "workspace",
      activity: "coverage",
      coverageType: "unit",
      label: "Open Unit Test Workspace",
    },
    aiPrompt:
      "Review my current Unit Test 4D coverage metrics (Lines, Branches, Functions, Statements) and tell me which uncovered files to prioritize first.",
    stages: [
      {
        id: "unit-test-setup",
        label: "1. Configure Runner in Test Setup",
        action: "Header → Test Setup",
        detail:
          "Open Test Setup to choose Auto (Per-File), Jest (Node/CJS with Istanbul), or Vitest (ESM/Vite with V8). Auto mode handles mixed monorepos seamlessly by matching each file's test library.",
        tip: "If required packages (jest, vitest, ts-jest, etc.) are missing, an automated UnitTestPackageInstaller banner appears so you can install them in one click.",
      },
      {
        id: "run-baseline",
        label: "2. Run Coverage Baseline",
        action: "Header → Run Coverage",
        detail:
          "Click Run Coverage to queue a BullMQ execution job. Tests run inside an isolated container/runner with automatic database/ORM mocking (Prisma, Mongoose, Sequelize, TypeORM) and stream live logs via SSE.",
        tip: "Watch the live progress bar or click 'View logs' / 'Cancel' if a suite hangs. Suite load/import crashes appear in a dedicated red banner above the matrix.",
      },
      {
        id: "telemetry-matrix",
        label: "3. Read 4D Metrics & Files Matrix",
        action: "Telemetry Strip & Files & Tests Matrix",
        detail:
          "The Telemetry Strip shows Lines %, Statements (S), Branches (B), Functions (F), covered source files, test pass rate, and Health. Below, the Files & Tests Matrix groups test cases under each source file with PASS, PARTIAL, FAIL, or UNCOVERED status.",
        tip: "Click the Health card on the right of the telemetry strip (or the Executive Report tab) to see root-cause diagnostics for failing tests.",
      },
    ],
    connections: [
      {
        label: "Unit CFG, Simulation & AI",
        desc: "Next: inspect CFG branches, simulate paths, and generate tests",
        stepId: "unit-cfg-ai",
      },
      {
        label: "Editor Coverage Gutters",
        desc: "Click any source file in the matrix to inspect uncovered lines",
        stepId: "explorer-editor",
        target: { kind: "workspace", activity: "explorer" },
      },
      {
        label: "Unified Overview",
        desc: "Unit coverage updates the 50% Unit Pillar in Overview",
        stepId: "unified-overview",
        target: { kind: "workspace", activity: "overview" },
      },
    ],
    gotchas: [
      "If zero existing unit tests are detected when generating AI tests, CovAI opens a Framework Picker so you can choose Jest or Vitest before generating.",
      "You can run a scoped subset by checking specific files or individual test cases in the matrix and clicking 'Run Selected'.",
    ],
  },
  {
    id: "unit-cfg-ai",
    number: 5,
    track: "unit",
    title: "Unit Testing — CFG, Simulation, AI Synthesis & Rollback",
    shortTitle: "Unit: CFG, AI & Diff",
    icon: GitBranch,
    location: "Unit Test → Matrix Row Actions / DiffReviewModal / History",
    summary:
      "Go from uncovered branches to verified 100% logic coverage: inspect file CFG and Complexity, simulate symbolic paths, synthesize AI tests with Diff Review, stage manual edits, and roll back safely.",
    target: {
      kind: "workspace",
      activity: "coverage",
      coverageType: "unit",
      label: "Open Unit Test Matrix",
    },
    aiPrompt:
      "How do I resolve failing unit tests or reach 100% branch coverage on my hardest service file using CFG, AI Suggest, and Diff Review?",
    stages: [
      {
        id: "cfg-simulation",
        label: "1. File Analysis (CFG) & Simulation Studio",
        action: "File Row → Analyze / Simulation Studio",
        detail:
          "Click a file's analysis icon to open UnitFileAnalysisModal with 3 tabs: Branch CFG & Paths, Function Call Graph, and Cyclomatic Calculator. From there, launch Simulation Studio to step through symbolic paths across 4 decision categories (Happy Path, Edge, Error, Boundary).",
        tip: "Educational Guidance Cards inside Simulation Studio explain why each branch evaluates True or False so you know what assertions to write.",
      },
      {
        id: "ai-suggest-diff",
        label: "2. AI Suggest & Safe Diff Review",
        action: "Suggest Selected / Uncovered → Review Diff",
        detail:
          "Generate AI unit test drafts for selected files or all uncovered files. Drafts appear as AI_DRAFT items in the matrix. Open DiffReviewModal to inspect side-by-side diffs before applying; CovAI enforces SHA-256 checks so source files stay untouched.",
        tip: "You can edit AI drafts locally or run unapplied drafts with 'includeDrafts' before committing them to your test file.",
      },
      {
        id: "staged-edits-aifix",
        label: "3. Staged Manual Edits & AI Fix",
        action: "Add / Edit / Delete Test → Apply Changes",
        detail:
          "Adding, editing, or deleting a test case stages changes locally in UI (Temp) so you can batch multiple edits without triggering disk writes one by one. Click 'Apply Changes' to persist and re-run, or 'Discard' to revert. Failed tests also have an 'AI Fix' button.",
        tip: "Always check pending staged changes banner before switching snapshots so no temporary edits are forgotten.",
      },
      {
        id: "history-export",
        label: "4. Version History (v1/v2) & Executive Report",
        action: "Header → History / Export / Executive Report Tab",
        detail:
          "Every applied AI test batch saves versioned snapshots (up to 20 versions per test file). Open History to switch between v1 and v2 or roll back. Switch to Executive Report or click Export to download JSON/PDF coverage reports.",
        tip: "If a new AI batch drops pass rate or breaks imports, use History to restore the previous working test version immediately.",
      },
    ],
    connections: [
      {
        label: "Standalone Logic Analysis",
        desc: "Open project-wide CFG & McCabe Complexity explorer",
        stepId: "arch-cfg-git-rbac",
        target: { kind: "workspace", activity: "logic-analysis" },
      },
      {
        label: "Integration Testing",
        desc: "Next tier: test API routes, middleware & DB contracts",
        stepId: "integration-scan-setup",
        target: { kind: "workspace", activity: "coverage", coverageType: "integration" },
      },
      {
        label: "AI Chatbot",
        desc: "Open side chat to debug a specific failed unit assertion",
        stepId: "explorer-editor",
      },
    ],
    gotchas: [
      "Generated tests pass through an AST syntax & hoisting quality gate; if a file has unrepairable syntax, CovAI falls back to a safe placeholder rather than breaking your suite.",
    ],
  },
  {
    id: "integration-scan-setup",
    number: 6,
    track: "integration",
    title: "Integration Testing — AST API Scan & 5-Layer Blueprint",
    shortTitle: "Integration: Scan & Setup",
    icon: Network,
    location: "Top Bar → Integration Test → Scan APIs & Test Setup",
    summary:
      "Discover Express/Node API endpoints automatically via Babel AST, configure Supertest + Jest with an ephemeral PostgreSQL 17 test DB, and synthesize 5-layer API test suites.",
    target: {
      kind: "workspace",
      activity: "coverage",
      coverageType: "integration",
      label: "Open Integration Test",
    },
    aiPrompt:
      "Explain how CovAI's 5-layer API test blueprint works for my discovered routes and which endpoints currently lack integration coverage.",
    stages: [
      {
        id: "scan-apis",
        label: "1. Scan APIs (AST Route Discovery)",
        action: "Header → Scan APIs",
        detail:
          "Click Scan APIs to parse your backend AST and extract HTTP methods (GET/POST/PUT/PATCH/DELETE), mount paths, middleware chains, controllers, services, and database calls into the Endpoints Matrix.",
        tip: "If you add new routes in the Editor later, click Scan again in the Endpoints Matrix toolbar to refresh discovered endpoints.",
      },
      {
        id: "integration-setup",
        label: "2. Configure Test Setup & Dependencies",
        action: "Header → Test Setup",
        detail:
          "Test Setup verifies Supertest + Jest availability, lists any missing packages (auto-installed before execution), and lets you toggle 'Automatically execute coverage runner immediately after generating'.",
        tip: "You can choose 'Run Existing Tests Only' inside Test Setup if your project already has Supertest specs you want measured first.",
      },
      {
        id: "five-layer-generate",
        label: "3. Generate 5-Layer API Test Scenarios",
        action: "Matrix → Generate (All / Selected / Single Endpoint)",
        detail:
          "CovAI synthesizes non-destructive additive scenarios covering 5 standard layers per endpoint: 2xx Happy Path, 400 Validation, 401/403 Auth, 404 Not Found, and 500 Resiliency. Review and apply generated specs via IntegrationApplyTestsModal.",
        tip: "Non-destructive generation preserves your existing manual integration scenarios while filling missing HTTP status layers.",
      },
    ],
    connections: [
      {
        label: "Execution & 5-Layer Diagnostics",
        desc: "Next: run Supertest against virtual DB and inspect failures",
        stepId: "integration-run-diagnose",
      },
      {
        label: "Architecture Map",
        desc: "Jump to visual Route → Controller → Service → Model graph",
        stepId: "arch-cfg-git-rbac",
        target: { kind: "workspace", activity: "architecture" },
      },
      {
        label: "Source Code Viewer",
        desc: "Inspect route handler source directly from any matrix row",
        stepId: "explorer-editor",
        target: { kind: "workspace", activity: "explorer" },
      },
    ],
    gotchas: [
      "Playwright is used only in System/E2E Testing; Integration Testing uses Supertest + Jest for fast in-memory HTTP contract verification.",
    ],
  },
  {
    id: "integration-run-diagnose",
    number: 7,
    track: "integration",
    title: "Integration Testing — Virtual DB Run, Diagnostics & Diff",
    shortTitle: "Integration: Run & Diagnose",
    icon: Layers,
    location: "Integration Test → Run Coverage / Executive Report / History",
    summary:
      "Execute Supertest scenarios against an ephemeral PostgreSQL 17 database, trace reverse API coverage, simulate request lifecycles, and pinpoint failures across 5 architectural layers.",
    target: {
      kind: "workspace",
      activity: "coverage",
      coverageType: "integration",
      label: "Open Integration Matrix",
    },
    aiPrompt:
      "Diagnose my failing Integration Test scenarios across the 5 failure layers (Router, Middleware, Controller, Database, Assertion) and suggest fixes.",
    stages: [
      {
        id: "run-virtual-db",
        label: "1. Run Coverage & Reverse Endpoint Mapping",
        action: "Header → Run Coverage (or Run Endpoint / Selected)",
        detail:
          "Runs Supertest + Jest in an isolated container/runner paired with an ephemeral PostgreSQL 17 test database. Watch real-time progress steps and console logs, then see reverse line/branch coverage mapped back to every API route.",
        tip: "Click any endpoint or scenario's Simulate button to open IntegrationSimulationStudioModal and visualize the request flowing through Router → Middleware → Controller → DB.",
      },
      {
        id: "five-layer-diagnosis",
        label: "2. 5-Layer Root-Cause Diagnostics",
        action: "Endpoints Matrix / Executive Report Tab",
        detail:
          "Failures are automatically classified into 5 diagnostic layers: [ROUTER_NOT_FOUND] (404 mount mismatch), [MIDDLEWARE_REJECTED] (401/403 auth/CORS/validator), [CONTROLLER_CRASH] (500 runtime error), [DATABASE_FAILURE] (ORM/constraint error), or [ASSERTION_FAILED] (status/JSON mismatch).",
        tip: "Use 'AI Fix' on a failed scenario to generate a targeted repair patch, or open the scenario editor to stage edits and batch-apply.",
      },
      {
        id: "history-before-after",
        label: "3. History, Before/After Diff & Reports",
        action: "Header → History / Executive Report Tab",
        detail:
          "Open the History drawer to inspect Snapshot History or switch to Before / After Comparison to compare coverage deltas across runs. Executive Report also supports printing and standalone shareable report view.",
        tip: "If Jest fails to load a suite file before running scenarios, inspect the Suite-Level Load Failure banner at the top of the workspace.",
      },
    ],
    connections: [
      {
        label: "System / E2E Testing",
        desc: "Next tier: verify full-stack browser journeys with Playwright/Cypress",
        stepId: "system-setup-matrix",
        target: { kind: "workspace", activity: "coverage", coverageType: "system" },
      },
      {
        label: "Unified Overview Trace",
        desc: "Integration endpoints link into the Cross-Layer Trace Matrix",
        stepId: "unified-overview",
        target: { kind: "workspace", activity: "overview" },
      },
    ],
    gotchas: [
      "Scenario edits (Add / Edit / Delete) are staged temporarily in the UI until you click 'Apply Changes' — remember to apply before closing or running a full coverage check.",
    ],
  },
  {
    id: "system-setup-matrix",
    number: 8,
    track: "system",
    title: "System / E2E Testing — Runtime Setup & Specs Matrix",
    shortTitle: "System: Setup & Matrix",
    icon: Layers,
    location: "Top Bar → System Test → Test Setup & Flows Matrix",
    summary:
      "Configure Playwright or Cypress full-stack app startup, stub external third-party APIs, generate verified cold-start E2E specs, and manage scenarios in the Flows & Specs Matrix.",
    target: {
      kind: "workspace",
      activity: "coverage",
      coverageType: "system",
      label: "Open System Test",
    },
    aiPrompt:
      "Check my System Test setup readiness, start command, external service dependencies, and recommend which user flows need E2E coverage.",
    stages: [
      {
        id: "system-runtime-setup",
        label: "1. Configure App Runtime & External Services",
        action: "Header → Playwright/Cypress & Test Setup",
        detail:
          "Select Playwright or Cypress in the header, then open Test Setup (SystemTestSetupDialog) to verify the detected runtime start command, server URL, database engine (PostgreSQL/MySQL/SQLite/MongoDB), and any External Services (AI, Stripe, OAuth keys or mocks).",
        tip: "Toggle 'Headed' in the header if running on desktop and you want to see the visible Chromium browser window during Playwright execution.",
      },
      {
        id: "sync-generate-e2e",
        label: "2. Sync Catalog & Cold-Start AI Generator",
        action: "Matrix → Sync Catalog / Generate",
        detail:
          "Click Sync Catalog to scan existing E2E spec files and requirement bindings. If specs are missing, click Generate to open SystemTestGeneratorModal, specify target routes (e.g. /, /login, /dashboard), and launch two-run verified E2E synthesis.",
        tip: "Track generation in the GenerationProgressStrip banner, then click Review to inspect and apply the generated draft.",
      },
      {
        id: "matrix-staged-fix",
        label: "3. Edit Scenarios, Staged Ops & AI Fix",
        action: "Flows & Specs Matrix Table",
        detail:
          "Expand any spec group to run single scenarios, inspect breakpoints, open the spec file in the Editor, or add/edit/delete cases (staged in UI until you click 'Apply Changes'). Use 'AI Fix' on failing E2E steps.",
        tip: "You can run a single failing scenario or selected spec files instead of waiting for the full 20-minute E2E suite.",
      },
    ],
    connections: [
      {
        label: "Live Browser Stream & Reports",
        desc: "Next: watch live CDP browser frames, history & screenshots",
        stepId: "system-live-report",
      },
      {
        label: "Spec Files in Editor",
        desc: "Open any .spec.ts / .cy.js file directly in Monaco Editor",
        stepId: "explorer-editor",
        target: { kind: "workspace", activity: "explorer" },
      },
    ],
    gotchas: [
      "System Test runs your imported app on the host Node runtime; if an app fails to boot due to missing env vars or legacy scripts, check the 'Cause:' hint in Test Setup or SystemTestErrorNotice.",
    ],
  },
  {
    id: "system-live-report",
    number: 9,
    track: "system",
    title: "System / E2E Testing — Live Stream, History & Reports",
    shortTitle: "System: Live Run & Report",
    icon: MonitorPlay,
    location: "System Test → Live Run Tab / History / Executive Report",
    summary:
      "Watch your Playwright tests execute live with Chrome DevTools viewport frames and virtual cursor telemetry, inspect step breakpoints, restore immutable v1/v2 suites, and export screenshot reports.",
    target: {
      kind: "workspace",
      activity: "coverage",
      coverageType: "system",
      label: "Open System Test Workspace",
    },
    aiPrompt:
      "Analyze my latest System Test live run failures, flaky scenarios, and explain how to stabilize them.",
    stages: [
      {
        id: "live-cdp-stream",
        label: "1. Watch Live Run & Virtual Cursor",
        action: "Tab → Live Run",
        detail:
          "When you click Run Coverage, switch to the Live Run tab to observe preparation logs (app install, DB setup, server boot) followed by real-time Chrome DevTools Protocol (CDP) viewport screenshots, virtual cursor clicks, and live pass/fail events.",
        tip: "Authorized runners/owners can click Stop directly inside Live Run to abort a stuck E2E execution safely.",
      },
      {
        id: "breakpoint-history",
        label: "2. Breakpoint Inspector & Suite Versioning",
        action: "Scenario → Inspect / Header → History",
        detail:
          "Click Inspect on a scenario to open SystemTestBreakpointModal and examine step-by-step execution artifacts and failure checkpoints. Open History (SystemTestVersionHistory) to diff immutable v1/v2 suite snapshots and restore any previous version.",
        tip: "Multi-repeat assessments detect flaky E2E tests automatically and flag them in the Suite Health strip.",
      },
      {
        id: "system-report-export",
        label: "3. Executive Report & Screenshot PDF",
        action: "Tab → Executive Report → Open Full Report",
        detail:
          "Review combined frontend/backend code coverage (when instrumented), scenario pass rates, flaky counts, and captured failure screenshots. Open the full printable report to export a PDF embedding key screenshots.",
        tip: "If external third-party keys are missing, ExternalServicesPanel marks affected tests as 'Blocked by external' rather than hiding the root cause.",
      },
    ],
    connections: [
      {
        label: "AI Chatbot Evaluation",
        desc: "Testing an AI chatbot? Use the dedicated Trustworthiness suite",
        stepId: "chatbot-audit-connect",
        target: { kind: "workspace", activity: "trustworthiness", evalView: "home" },
      },
      {
        label: "Unified Overview",
        desc: "System flow rate feeds the 20% System Pillar in Overview",
        stepId: "unified-overview",
        target: { kind: "workspace", activity: "overview" },
      },
    ],
    gotchas: [
      "Normal web apps should be tested here in System Test. Only AI conversational apps with LLMs belong in Chatbot Evaluation.",
    ],
  },
  {
    id: "chatbot-audit-connect",
    number: 10,
    track: "chatbot",
    title: "AI Chatbot Evaluation — Code Review & Connect Target",
    shortTitle: "Chatbot: Audit & Connect",
    icon: Bot,
    location: "Activity Bar → Chatbot Evaluation → Code Review & 1 Connect",
    summary:
      "Evaluate project-owned or external AI chatbots in two stages: first run a static Code Review (Design Audit) for Node.js/Python safety rules, then connect a managed local or HTTPS chatbot target.",
    target: {
      kind: "workspace",
      activity: "trustworthiness",
      evalView: "audit",
      label: "Open Chatbot Code Review",
    },
    aiPrompt:
      "Explain the findings from my Chatbot Static Design Audit (Code Review) and how to configure the Connect Chatbot target settings.",
    stages: [
      {
        id: "enable-code-review",
        label: "1. Enable & Run Static Code Review (Stage 1)",
        action: "Header ON/OFF Switch → Code review Tab",
        detail:
          "Ensure Chatbot Evaluation is switched ON in the workspace header. Open 'Code review' and click 'Scan snapshot' to inspect Node.js or Python code for AI SDKs, conversational routes, request/response schemas, required LLM env vars, and 9 security/reliability rules (0–100 Design Score).",
        tip: "Code review auto-fills your endpoint path, request bindings, response JSON pointer, and env var names for Step 1!",
      },
      {
        id: "connect-managed-external",
        label: "2. Connect Managed Project or External URL",
        action: "Tab → 1 Connect chatbot",
        detail:
          "Choose Managed Project (CovAI boots your imported chatbot on loopback networking with memory-only API keys) or External URL (SSRF-protected HTTPS endpoint on port 443). Configure auth headers, request template, and JSON response pointers (e.g. /answer).",
        tip: "Ephemeral LLM API keys entered here are held in memory only for the test run and are never saved to disk.",
      },
      {
        id: "probe-connection",
        label: "3. Probe & Verify Live Response",
        action: "Target Setup → Save & Probe",
        detail:
          "Run Probe to send a test message and confirm CovAI can extract the chatbot's answer and conversationId cleanly before generating benchmarks.",
        tip: "If no AI SDK was detected in your repo (e.g. your bot is hosted separately), click 'My chatbot runs elsewhere' to switch straight to External URL mode.",
      },
    ],
    connections: [
      {
        label: "Docs, Questions, Run & Calibration",
        desc: "Next: add documents, approve questions, run benchmark & calibrate",
        stepId: "chatbot-benchmark-run",
        target: { kind: "workspace", activity: "trustworthiness", evalView: "documents" },
      },
      {
        label: "Chatbot Home Checklist",
        desc: "Track 4-step readiness status and latest verdict on Home",
        stepId: "chatbot-benchmark-run",
        target: { kind: "workspace", activity: "trustworthiness", evalView: "home" },
      },
    ],
    gotchas: [
      "Turning Chatbot Evaluation OFF preserves all saved targets, documents, question sets, and past evaluation reports.",
      "External URL mode blocks private/loopback IP ranges to prevent SSRF attacks.",
    ],
  },
  {
    id: "chatbot-benchmark-run",
    number: 11,
    track: "chatbot",
    title: "AI Chatbot Evaluation — Docs, Questions, Run & Calibration",
    shortTitle: "Chatbot: Run & Calibrate",
    icon: ListChecks,
    location: "Chatbot Evaluation → Steps 2, 3, 4 & Check the grading AI",
    summary:
      "Upload ground-truth business documents (or build a no-document chatbot profile), approve multi-category test questions, execute hybrid safety/faithfulness benchmarks, and calibrate the grading AI.",
    target: {
      kind: "workspace",
      activity: "trustworthiness",
      evalView: "home",
      label: "Open Chatbot Evaluation Home",
    },
    aiPrompt:
      "Walk me through preparing business documents, approving test questions, interpreting Wilson 95% CI & safety gates, and checking the grading AI.",
    stages: [
      {
        id: "business-docs",
        label: "2. Business Documents (or No-Document Profile)",
        action: "Tab → 2 Business documents",
        detail:
          "Upload PDF/TXT/MD policy docs, paste text, or pick files from your project so CovAI can generate fact-grounded questions. If your bot doesn't rely on docs, select 'No documents' to generate a Chatbot Profile from your README and system prompt.",
        tip: "Wait until document badges transition from 'Processing…' to 'Ready' before generating test questions.",
      },
      {
        id: "review-questions",
        label: "3. Review & Approve Test Questions",
        action: "Tab → 3 Test questions",
        detail:
          "CovAI drafts versioned test questions spanning 4 categories: Happy Path, Multi-turn Conversation, Out-of-scope Refusal, and Adversarial Robustness. Edit prompts/expected facts, check the AI request QuotaMeter, and click Approve to lock a version for execution.",
        tip: "Creating a 'New draft' from an approved version lets you iterate safely without losing your baseline benchmark.",
      },
      {
        id: "run-hybrid-report",
        label: "4. Run Evaluation & Read Hybrid Report",
        action: "Tab → 4 Run and report",
        detail:
          "Start a run and monitor Socket.IO progress. CovAI evaluates replies using deterministic rules, numeric/factual checks, an optional mock tool gateway, and an anchored LLM-as-a-Judge (faithfulness, completeness, context retention, refusal) with separated models. Reports show Wilson 95% CIs, stability across repeats, and side-by-side Run Comparison.",
        tip: "Hard safety gates immediately fail a run on adversarial/policy breaches. If fewer than 80% of checks complete, summary scores are hidden to prevent misleading numbers.",
      },
      {
        id: "blind-calibration",
        label: "5. Check the Grading AI (Blind Human Review)",
        action: "Tab → Check the grading AI",
        detail:
          "Review chatbot transcripts blind ('AI grade hidden') and submit your own pass/fail judgments. Once you grade enough samples (minimum 10), CovAI computes Cohen's kappa agreement and Rogan-Gladen bias calibration so you know how trustworthy the AI judge is.",
        tip: "Export certified PDF or JSON evaluation reports directly from the Run toolbar.",
      },
    ],
    connections: [
      {
        label: "Code Review & Connect",
        desc: "Back to Stage 1 static audit or target connection settings",
        stepId: "chatbot-audit-connect",
        target: { kind: "workspace", activity: "trustworthiness", evalView: "connect" },
      },
      {
        label: "Activity Log",
        desc: "Inspect AI_EVALUATION and AI_EVALUATION_PREPARE background jobs",
        stepId: "arch-cfg-git-rbac",
        target: { kind: "workspace", activity: "jobs" },
      },
    ],
    gotchas: [
      "Check the QuotaMeter in Step 3 before starting large runs — each run estimates min/max/worst-case AI requests against your daily limit.",
    ],
  },
  {
    id: "arch-cfg-git-rbac",
    number: 12,
    track: "engineering",
    title: "Architecture, Logic Analysis, Git, Jobs & Team RBAC",
    shortTitle: "Arch, CFG, Git & RBAC",
    icon: Compass,
    location: "Activity Bar → Architecture / Logic Analysis / Version Control / Activity Log / Settings",
    summary:
      "Round out your engineering workflow with interactive dependency graphs, McCabe Cyclomatic Complexity analysis, Git & Snapshot publishing, BullMQ job monitoring, and role-based team access.",
    target: {
      kind: "workspace",
      activity: "architecture",
      label: "Open Architecture Graph",
    },
    aiPrompt:
      "Summarize my project's architecture hotspots, high cyclomatic complexity functions, and recent background jobs.",
    stages: [
      {
        id: "arch-logic",
        label: "1. Architecture & Logic Analysis (CFG)",
        action: "Activity Bar → Architecture & Logic Analysis",
        detail:
          "Architecture renders an interactive Dagre graph of Routes, Controllers, Services, Components, Models, and Validators with AI summaries. Logic Analysis computes Control Flow Graphs and McCabe Cyclomatic Complexity (Low 1–4, Moderate 5–10, High 11–20, Critical 21+).",
        tip: "Click any CFG node or function in Logic Analysis to jump straight to that exact line in the Monaco Editor.",
      },
      {
        id: "git-snapshots",
        label: "2. Version Control & Immutable Snapshots",
        action: "Activity Bar → Version Control",
        detail:
          "Inspect modified/untracked Git files, stage and commit changes, switch branches, push/pull with GitHub, or create and restore immutable CovAI Project Snapshots.",
        tip: "Creating a new snapshot lets you test major refactors and compare Before/After coverage cleanly.",
      },
      {
        id: "jobs-rbac",
        label: "3. Activity Log & Team Settings (RBAC)",
        action: "Activity Bar → Activity Log & Settings",
        detail:
          "Activity Log tracks every BullMQ job (Ingest, Run Tests, Build CFG, AI Suggest, Chatbot Evaluation) and project timeline events. In Settings → Members, Owners invite teammates with Owner, Editor, or Viewer access across 14 granular capabilities plus discipline tags (PM, Developer, Tester, QA, AI Engineer).",
        tip: "Check Settings → Usage anytime to see daily AI request quotas and token consumption.",
      },
    ],
    connections: [
      {
        label: "Logic Analysis (CFG)",
        desc: "Launch full-screen CFG & Cyclomatic Complexity inspector",
        target: { kind: "workspace", activity: "logic-analysis" },
      },
      {
        label: "Version Control",
        desc: "Open Git status, branches & Snapshot manager",
        target: { kind: "workspace", activity: "version-control" },
      },
      {
        label: "Activity Log",
        desc: "View BullMQ jobs and project audit events",
        target: { kind: "workspace", activity: "jobs" },
      },
      {
        label: "Project Members & Settings",
        desc: "Manage RBAC roles, appearance & AI usage",
        target: { kind: "workspace", activity: "settings" },
      },
    ],
    gotchas: [
      "Only project Owners can delete a project or manage member roles; Viewers cannot edit files, trigger test runs, or invoke AI synthesis.",
    ],
  },
];

export function resolveInitialGuideStep({
  page = "workspace",
  activeActivity = "explorer",
  coverageType = "unit",
  evalView = "home",
  showCFG = false,
} = {}) {
  if (page === "portfolio") return "portfolio-import";
  if (showCFG || activeActivity === "logic-analysis") return "arch-cfg-git-rbac";
  if (activeActivity === "overview") return "unified-overview";
  if (activeActivity === "coverage") {
    if (coverageType === "integration") return "integration-scan-setup";
    if (coverageType === "system") return "system-setup-matrix";
    return "unit-setup-run";
  }
  if (activeActivity === "trustworthiness") {
    if (["audit", "connect"].includes(evalView)) return "chatbot-audit-connect";
    return "chatbot-benchmark-run";
  }
  if (
    ["architecture", "version-control", "git", "jobs", "activity", "settings"].includes(
      activeActivity,
    )
  ) {
    return "arch-cfg-git-rbac";
  }
  return "explorer-editor";
}
