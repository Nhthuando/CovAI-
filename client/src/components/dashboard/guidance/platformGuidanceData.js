export const GUIDANCE_TOURS = {
  portfolio: {
    id: "portfolio",
    label: "Projects Portfolio",
    steps: [
      {
        id: "portfolio-add",
        selector: '[data-guide="portfolio-add-project"]',
        placement: "bottom",
        title: "Import a Project",
        description:
          "Click + Project to upload a ZIP/RAR archive (up to 200 MB) or shallow-clone a GitHub repository. Each import creates an immutable snapshot.",
        connections: ["Creates Snapshot → Explorer & Testing Tiers"],
      },
      {
        id: "portfolio-kpis",
        selector: '[data-guide="portfolio-kpis"]',
        placement: "bottom",
        title: "Portfolio Quality KPIs",
        description:
          "Track average Health Score, lifecycle breakdown, 3-tier coverage averages (Unit, Integration, System), and estimated QA hours saved across projects.",
        connections: ["Aggregates from Unified Overview"],
      },
      {
        id: "portfolio-directory",
        selector: '[data-guide="portfolio-directory"]',
        placement: "top",
        title: "Project Cards & Layer Jump",
        description:
          "Filter by lifecycle or missing test layer. Click a project card to open its Unified Overview, or click Unit / API / E2E bars to jump straight to that suite.",
        connections: ["Links → Overview / Unit / Integration / System"],
      },
      {
        id: "portfolio-ai",
        selector: '[data-guide="portfolio-ai-btn"]',
        placement: "bottom",
        title: "Portfolio AI Assistant",
        description:
          "Open the side AI Assistant to compare project health or ask about failing test layers for any selected project.",
        connections: ["Context-aware Gemini Assistant"],
      },
    ],
  },

  explorer: {
    id: "explorer",
    label: "Explorer & Editor",
    steps: [
      {
        id: "exp-activity",
        selector: '[data-guide="activity-bar"]',
        placement: "right",
        title: "Workspace Navigation Bar",
        description:
          "Switch between Explorer, Unified Overview, Version Control, Chatbot Evaluation, Activity Log (BullMQ jobs), Architecture, Logic Analysis (CFG), and Settings.",
        connections: ["Central hub across all modules"],
      },
      {
        id: "exp-sidebar",
        selector: '[data-guide="sidebar-explorer"]',
        placement: "right",
        title: "Project File Explorer",
        description:
          "Browse files, create/rename/delete entries, switch projects, or click files to open them in the collaborative Monaco editor.",
        connections: ["Syncs with Version Control & Test Matrices"],
      },
      {
        id: "exp-editor",
        selector: '[data-guide="editor-workspace"]',
        placement: "left",
        title: "Collaborative Editor & Coverage Gutters",
        description:
          "Edit concurrently with Yjs live cursors. After running tests, Monaco highlights covered (✓), uncovered (⚑), and failed (×) lines directly in the gutter.",
        connections: ["Updated by Unit, Integration & System Runs"],
      },
      {
        id: "exp-top-tests",
        selector: '[data-guide="top-test-levels"]',
        placement: "bottom",
        title: "Test Levels & AI Chatbot",
        description:
          "Switch anytime between Unit Test, Integration Test, and System Test in the top bar, or toggle AI Chatbot on the right for file-aware assistance.",
        connections: ["Unit (50%) + Integration (30%) + System (20%)"],
      },
    ],
  },

  overview: {
    id: "overview",
    label: "Unified Overview",
    steps: [
      {
        id: "ov-header",
        selector: '[data-guide="ud-header"]',
        placement: "bottom",
        title: "Snapshot Control & AI Analyze",
        description:
          "Switch active project snapshots, refresh live telemetry, click AI Analyze to send full cross-layer metrics to the AI Chatbot, or export PDF/JSON reports.",
        connections: ["Sends live summary → AI Chatbot"],
      },
      {
        id: "ov-kpis",
        selector: '[data-guide="ud-kpis"]',
        placement: "bottom",
        title: "Weighted Health Score & Quality Gate",
        description:
          "Combines Unit (50%), Integration (30%), and System (20%) results into one Health Score alongside pass/fail counts and Quality Gate status.",
        connections: ["Auto-updates via Socket.IO on test finish"],
      },
      {
        id: "ov-pyramid",
        selector: '[data-guide="ud-pyramid"]',
        placement: "top",
        title: "Testing Pyramid & 3 Pillar Cards",
        description:
          "Inspect balance across Unit, Integration, and System tiers. Click any pillar card or segment to cross-filter traceability below or jump into that test suite.",
        connections: ["Cross-filters Traceability Matrix"],
      },
      {
        id: "ov-analysis",
        selector: '[data-guide="ud-analysis"]',
        placement: "top",
        title: "Cross-Layer Traceability & History",
        description:
          "Click any module row to open the Slide-Over Inspector Drawer with suspect-layer root cause diagnosis and direct jump links to code or tests.",
        connections: ["Drills down → Unit / API / E2E failures"],
      },
    ],
  },

  unit: {
    id: "unit",
    label: "Unit Testing",
    steps: [
      {
        id: "unit-setup",
        selector: '[data-guide="unit-setup"]',
        placement: "bottom",
        title: "1. Configure Runner & Dependencies",
        description:
          "Open Test Setup to select Auto (Per-File), Jest (Istanbul), or Vitest (V8). If required test packages are missing, install them in one click via the package installer.",
        connections: ["Prepares Jest / Vitest environment"],
      },
      {
        id: "unit-run",
        selector: '[data-guide="unit-run"]',
        placement: "bottom",
        title: "2. Run Baseline Coverage",
        description:
          "Click Run Coverage to execute unit suites in isolation with automatic Prisma/Mongoose/Sequelize DB mocks and stream live execution logs.",
        connections: ["Updates Editor Gutters & Unified Overview (50%)"],
      },
      {
        id: "unit-telemetry",
        selector: '[data-guide="unit-telemetry"]',
        placement: "bottom",
        title: "3. 4D Coverage & Suite Health",
        description:
          "Review Lines, Statements (S), Branches (B), and Functions (F) percentages. Click the Health card on the right to jump straight to root-cause diagnostics.",
        connections: ["Health card → Executive Report"],
      },
      {
        id: "unit-matrix",
        selector: '[data-guide="unit-matrix"]',
        placement: "top",
        title: "4. Matrix: CFG, Simulation & AI Synthesis",
        description:
          "Expand any file to run scoped tests, inspect Branch CFG & Cyclomatic Complexity, launch Simulation Studio, generate AI Test Drafts with Diff Review, stage manual edits (Apply Changes), or click AI Fix on failures.",
        connections: ["Links → CFG Modal · Simulation · Editor Lines"],
      },
      {
        id: "unit-tabs",
        selector: '[data-guide="unit-tabs"]',
        placement: "bottom",
        title: "5. Executive Report Tab",
        description:
          "Switch to Executive Report for file-level failure summaries, peak coverage tracking, and quick re-run or AI repair actions.",
        connections: ["Shares context with AI Chatbot"],
      },
      {
        id: "unit-history",
        selector: '[data-guide="unit-history"], [data-guide="unit-export"]',
        placement: "bottom",
        title: "6. Version History (v1/v2) & Export",
        description:
          "Open History to roll back applied AI test batches (up to 20 versions per file), or click Export to download JSON/PDF Unit Test reports.",
        connections: ["Safe v1/v2 rollback without losing source code"],
      },
    ],
  },

  integration: {
    id: "integration",
    label: "Integration Testing",
    steps: [
      {
        id: "int-setup",
        selector: '[data-guide="int-setup"], [data-guide="int-scan-primary"]',
        placement: "bottom",
        title: "1. Scan APIs & Configure 5-Layer Setup",
        description:
          "Start by scanning your Express/Node AST to discover routes, middleware, controllers, and DB calls. Then use Test Setup for Supertest + Jest and the 5-layer API blueprint (2xx, 400, 401/403, 404, 500).",
        connections: ["AST Scan → Endpoints Matrix & Architecture"],
      },
      {
        id: "int-run",
        selector: '[data-guide="int-run"], [data-guide="int-scan-primary"]',
        placement: "bottom",
        title: "2. Run Coverage (Virtual Test DB)",
        description:
          "Click Run Coverage to execute Supertest assertions inside an isolated runner paired with an ephemeral PostgreSQL 17 test database.",
        connections: ["Maps reverse line coverage per endpoint"],
      },
      {
        id: "int-telemetry",
        selector: '[data-guide="int-telemetry"], [data-guide="int-tabs"]',
        placement: "bottom",
        title: "3. Endpoint Coverage & Health",
        description:
          "Monitor verified route %, uncovered/partial routes, scenario pass rate, and average source file line coverage. Click Health to inspect failures.",
        connections: ["Feeds Unified Overview (30% Integration Pillar)"],
      },
      {
        id: "int-matrix",
        selector: '[data-guide="int-matrix"]',
        placement: "top",
        title: "4. Endpoints Matrix & Request Simulation",
        description:
          "Expand routes to generate 5-layer AI scenarios, apply approved specs, open Simulation Studio (animated Router → Middleware → Controller → DB trace), stage edits (Apply Changes), or run AI Fix.",
        connections: ["Links → Source Viewer · Editor · Architecture"],
      },
      {
        id: "int-history",
        selector: '[data-guide="int-history"], [data-guide="int-tabs"]',
        placement: "bottom",
        title: "5. 5-Layer Diagnostics & Before/After Diff",
        description:
          "Switch to Executive Report for 5-layer root causes (ROUTER_NOT_FOUND, MIDDLEWARE_REJECTED, CONTROLLER_CRASH, DATABASE_FAILURE, ASSERTION_FAILED), or open History for Before/After Comparison.",
        connections: ["Exports standalone Integration Audit Report"],
      },
    ],
  },

  system: {
    id: "system",
    label: "System / E2E Testing",
    steps: [
      {
        id: "sys-framework",
        selector: '[data-guide="sys-framework"]',
        placement: "bottom",
        title: "1. Select E2E Runner",
        description:
          "Switch between Playwright and Cypress runners detected in your project. Spec counts and execution settings adapt to the selected framework.",
        connections: ["Supports Playwright & Cypress suites"],
      },
      {
        id: "sys-setup",
        selector: '[data-guide="sys-setup"]',
        placement: "bottom",
        title: "2. Runtime & External Services Setup",
        description:
          "Open Test Setup to inspect or configure the app start command, server URL, database engine, and External Services keys/stubs (Stripe, AI, OAuth).",
        connections: ["Validates full-stack boot readiness"],
      },
      {
        id: "sys-run",
        selector: '[data-guide="sys-run"]',
        placement: "bottom",
        title: "3. Headed Mode & Run Coverage",
        description:
          "Toggle Headed if you want a visible Chromium browser window on desktop, then click Run Coverage to execute full-stack E2E workflows.",
        connections: ["Streams CDP frames → Live Run tab"],
      },
      {
        id: "sys-telemetry",
        selector: '[data-guide="sys-telemetry"]',
        placement: "bottom",
        title: "4. E2E Telemetry & Suite Health",
        description:
          "Track combined system code coverage or verified scenario rate, covered spec files, and Suite Health (All Passing, flaky, or failed).",
        connections: ["Feeds Unified Overview (20% System Pillar)"],
      },
      {
        id: "sys-matrix",
        selector: '[data-guide="sys-matrix"]',
        placement: "top",
        title: "5. Flows Matrix, Cold-Start AI & Staged Edits",
        description:
          "Click Scan Specs to sync disk tests, Generate All for two-run verified E2E synthesis on target routes, inspect step breakpoints, stage edits (Apply Changes), or run AI Fix.",
        connections: ["Opens .spec files directly in Editor"],
      },
      {
        id: "sys-tabs",
        selector: '[data-guide="sys-tabs"], [data-guide="sys-history"]',
        placement: "bottom",
        title: "6. Live Browser Stream, History & PDF Report",
        description:
          "Switch to Live Run for real-time Chrome DevTools screenshots + virtual cursor, Executive Report for screenshot PDFs, or History to restore immutable v1/v2 suites.",
        connections: ["Real-time Socket.IO browser telemetry"],
      },
    ],
  },

  trustworthiness: {
    id: "trustworthiness",
    label: "AI Chatbot Evaluation",
    steps: [
      {
        id: "eval-toggle",
        selector: '[data-guide="eval-toggle"]',
        placement: "bottom",
        title: "1. Enable Chatbot Evaluation",
        description:
          "Turn Chatbot Evaluation ON or OFF for this project anytime. Turning it OFF preserves all saved targets, business documents, test sets, and past reports.",
        connections: ["Scoped per project"],
      },
      {
        id: "eval-tabs",
        selector: '[data-guide="eval-tabs"], [data-guide="eval-workspace"]',
        placement: "bottom",
        title: "2. Two-Stage Workflow Tabs",
        description:
          "Run Code review (Stage 1 static audit of Node/Python AI SDKs, routes & 9 safety rules) first, then progress through Steps 1 → 4 and calibrate the judge in Check the grading AI.",
        connections: ["Code Review auto-fills Step 1 Target Setup"],
      },
      {
        id: "eval-checklist",
        selector: '[data-guide="eval-checklist"], [data-guide="eval-workspace"]',
        placement: "right",
        title: "3. 4-Step Benchmark Setup",
        description:
          "(1) Connect Managed Local or External HTTPS bot + Probe; (2) Add Business Docs or build a No-Document Profile; (3) Approve versioned Test Questions (Happy, Multi-turn, Refusal, Adversarial); (4) Start Evaluation.",
        connections: ["Checks daily AI quota before running"],
      },
      {
        id: "eval-results",
        selector: '[data-guide="eval-latest"], [data-guide="eval-tools"], [data-guide="eval-workspace"]',
        placement: "left",
        title: "4. Hybrid Reports, Safety Gates & Calibration",
        description:
          "View Wilson 95% CI scores, hard adversarial safety gates, and side-by-side Run Comparisons. Use Check the grading AI for blind human review (Cohen's kappa) and export JSON/PDF reports.",
        connections: ["Separates generation & judging models"],
      },
    ],
  },

  architecture: {
    id: "architecture",
    label: "Architecture",
    steps: [
      {
        id: "arch-main",
        selector: '[data-guide="workspace-main"]',
        placement: "center",
        title: "Interactive Project Architecture",
        description:
          "Explore the Dagre dependency graph mapping Routes → Controllers → Services → Models → Validators. Click any node to inspect connections, generate an AI summary, or jump to Integration Tests.",
        connections: ["Links → Explorer · Integration Endpoints"],
      },
    ],
  },

  "logic-analysis": {
    id: "logic-analysis",
    label: "Logic Analysis (CFG)",
    steps: [
      {
        id: "cfg-main",
        selector: '[data-guide="cfg-calculator"], [data-guide="workspace-main"]',
        placement: "center",
        title: "Control Flow Graph & McCabe Complexity",
        description:
          "Inspect function-level Control Flow Graphs and Cyclomatic Complexity risk tiers (Low 1–4, Moderate 5–10, High 11–20, Critical 21+). Click any node or function to jump straight to that line in the Editor.",
        connections: ["Syncs with Unit Test File Analysis"],
      },
    ],
  },

  "version-control": {
    id: "version-control",
    label: "Version Control",
    steps: [
      {
        id: "vc-main",
        selector: '[data-guide="workspace-main"]',
        placement: "center",
        title: "Git Operations & Project Snapshots",
        description:
          "Review modified/untracked Git files, commit and push/pull with GitHub, switch branches, or create/restore immutable CovAI Snapshots to compare coverage across versions.",
        connections: ["Snapshots power all Testing & Audit views"],
      },
    ],
  },

  jobs: {
    id: "jobs",
    label: "Activity Log",
    steps: [
      {
        id: "jobs-main",
        selector: '[data-guide="workspace-main"]',
        placement: "center",
        title: "BullMQ Jobs & Project Timeline",
        description:
          "Monitor queued, running, completed, and failed background jobs (Source Ingest, Run Tests, Build CFG, AI Suggest, Chatbot Evaluation) along with project audit events.",
        connections: ["Mirrors Floating Job Queue telemetry"],
      },
    ],
  },

  settings: {
    id: "settings",
    label: "Settings & Members",
    steps: [
      {
        id: "settings-main",
        selector: '[data-guide="workspace-main"]',
        placement: "center",
        title: "Workspace Settings, Quota & Team RBAC",
        description:
          "Manage your profile, Dark/Light/System theme, security, daily AI quota usage, and project Members (Owner / Editor / Viewer roles across 14 capabilities and discipline tags).",
        connections: ["Controls write, test-run & AI permissions"],
      },
    ],
  },
};

export function resolveTourKey({
  page = "workspace",
  activeActivity = "explorer",
  coverageType = "unit",
  showCFG = false,
} = {}) {
  if (page === "portfolio") return "portfolio";
  if (showCFG || activeActivity === "logic-analysis") return "logic-analysis";
  if (activeActivity === "overview") return "overview";
  if (activeActivity === "coverage") {
    if (coverageType === "integration") return "integration";
    if (coverageType === "system") return "system";
    return "unit";
  }
  if (activeActivity === "trustworthiness") return "trustworthiness";
  if (activeActivity === "architecture") return "architecture";
  if (activeActivity === "version-control" || activeActivity === "git") {
    return "version-control";
  }
  if (activeActivity === "jobs" || activeActivity === "activity") return "jobs";
  if (activeActivity === "settings") return "settings";
  return "explorer";
}
