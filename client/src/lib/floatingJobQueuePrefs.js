export const FLOATING_QUEUE_VISIBLE_KEY = "covai_floating_job_queue_visible";
export const FLOATING_QUEUE_POS_KEY = "covai_floating_job_queue_pos";
export const FLOATING_QUEUE_VISIBILITY_EVENT = "covai:floating-job-queue-visibility";
export const FLOATING_QUEUE_OPEN_EVENT = "covai:floating-job-queue-open";

export const JOB_DOMAIN_TABS = Object.freeze([
  { id: "all", label: "All Tasks" },
  { id: "import", label: "Import & Setup" },
  { id: "unit", label: "Unit" },
  { id: "integration", label: "Integration" },
  { id: "system", label: "System" },
  { id: "ai_eval", label: "AI Chatbot" },
]);

export const JOB_DOMAIN_BADGES = Object.freeze({
  import: {
    label: "Import",
    textClass: "text-[var(--color-text-secondary)]",
    bgClass: "bg-[var(--color-surface-secondary)] border-[var(--color-border)]",
  },
  unit: {
    label: "Unit",
    textClass: "text-[var(--color-text-secondary)]",
    bgClass: "bg-[var(--color-surface-secondary)] border-[var(--color-border)]",
  },
  integration: {
    label: "Integration",
    textClass: "text-[var(--color-text-secondary)]",
    bgClass: "bg-[var(--color-surface-secondary)] border-[var(--color-border)]",
  },
  system: {
    label: "System",
    textClass: "text-[var(--color-text-secondary)]",
    bgClass: "bg-[var(--color-surface-secondary)] border-[var(--color-border)]",
  },
  ai_eval: {
    label: "AI Chatbot",
    textClass: "text-[var(--color-text-secondary)]",
    bgClass: "bg-[var(--color-surface-secondary)] border-[var(--color-border)]",
  },
});

/** Map every backend Prisma JobType enum value into unified project domains. */
export const JOB_TYPE_META = Object.freeze({
  INGEST: {
    domain: "import",
    label: "Project Ingest",
    description: "Extracting and indexing imported source files",
  },
  INSTALL_DEPS: {
    domain: "import",
    label: "Install Dependencies",
    description: "Installing project packages via package manager",
  },
  ANALYSIS: {
    domain: "import",
    label: "Project Analysis",
    description: "Analyzing repository structure and codebase graph",
  },
  QUALITY_ANALYSIS: {
    domain: "import",
    label: "Quality Analysis",
    description: "Computing maintainability and code quality metrics",
  },
  SECURITY_ANALYSIS: {
    domain: "import",
    label: "Security Analysis",
    description: "Scanning repository for potential security issues",
  },
  CODE_HYGIENE: {
    domain: "import",
    label: "Code Hygiene",
    description: "Analyzing linter and hygiene diagnostics",
  },
  BUILD_CFG: {
    domain: "import",
    label: "Build CFG",
    description: "Building Control Flow Graphs from source AST",
  },
  PERFORMANCE_ANALYSIS: {
    domain: "import",
    label: "Performance Analysis",
    description: "Analyzing runtime performance metrics",
  },
  RUN_TESTS: {
    domain: "unit",
    label: "Unit Test Coverage",
    description: "Running unit tests and measuring coverage",
  },
  RUN_VITEST_TESTS: {
    domain: "unit",
    label: "Vitest Unit Tests",
    description: "Running Vitest unit test suite",
  },
  VITEST_COVERAGE: {
    domain: "unit",
    label: "Vitest Coverage",
    description: "Collecting Vitest unit coverage metrics",
  },
  PARSE_COVERAGE: {
    domain: "unit",
    label: "Parse Coverage",
    description: "Parsing coverage report and AST mapping data",
  },
  UNIT_TEST_SUGGEST: {
    domain: "unit",
    label: "Unit Test AI Suggest",
    description: "Generating unit test scenarios for business functions",
  },
  UNIT_TEST_APPLY: {
    domain: "unit",
    label: "Apply Unit Tests",
    description: "Applying generated unit tests to repository",
  },
  AI_SUGGEST: {
    domain: "unit",
    label: "AI Suggestions",
    description: "Generating AI test & improvement suggestions",
  },
  AI_TESTS: {
    domain: "integration",
    label: "Integration AI Tests",
    description: "Synthesizing API integration test scenarios and assertions",
  },
  SUPERTEST_COVERAGE: {
    domain: "integration",
    label: "Integration Coverage",
    description: "Running Supertest integration coverage analysis",
  },
  PLAYWRIGHT_API_COVERAGE: {
    domain: "integration",
    label: "API Integration Coverage",
    description: "Running API integration coverage suite",
  },
  SYSTEM_TEST_ANALYSIS: {
    domain: "system",
    label: "System Test Discovery",
    description: "Inspecting system test scenarios and user journeys",
  },
  SYSTEM_TEST_ASSESSMENT: {
    domain: "system",
    label: "System Test Assessment",
    description: "Running E2E tests and measuring system coverage",
  },
  SYSTEM_TEST_IMPROVEMENT: {
    domain: "system",
    label: "AI System Improvement",
    description: "Synthesizing E2E system tests and verifying coverage gains",
  },
  SYSTEM_TEST_MUTATION: {
    domain: "system",
    label: "System Mutation Testing",
    description: "Executing mutation analysis against E2E test suites",
  },
  CYPRESS_SYSTEM_TEST: {
    domain: "system",
    label: "Cypress System Test",
    description: "Executing Cypress end-to-end test run",
  },
  CYPRESS_SYSTEM_COVERAGE: {
    domain: "system",
    label: "Cypress Coverage",
    description: "Collecting Cypress system test coverage",
  },
  PLAYWRIGHT_SYSTEM_TEST: {
    domain: "system",
    label: "Playwright System Test",
    description: "Executing Playwright end-to-end test run",
  },
  PLAYWRIGHT_SYSTEM_COVERAGE: {
    domain: "system",
    label: "Playwright Coverage",
    description: "Collecting Playwright system test coverage",
  },
  AI_EVALUATION: {
    domain: "ai_eval",
    label: "AI Chatbot Evaluation",
    description: "Evaluating project chatbot accuracy and trustworthiness",
  },
  AI_EVALUATION_PREPARE: {
    domain: "ai_eval",
    label: "Chatbot Eval Preparation",
    description: "Preparing evaluation dataset and benchmark profile",
  },
});

export function getJobTypeMeta(type) {
  return (
    JOB_TYPE_META[type] || {
      domain: "import",
      label: String(type || "Background Job")
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (ch) => ch.toUpperCase()),
      description: "Background project task",
    }
  );
}

export function isFloatingJobQueueVisible() {
  try {
    return localStorage.getItem(FLOATING_QUEUE_VISIBLE_KEY) !== "false";
  } catch (err) {
    console.warn("[floatingJobQueuePrefs] Failed reading visibility:", err);
    return true;
  }
}

export function setFloatingJobQueueVisible(visible) {
  const next = Boolean(visible);
  try {
    localStorage.setItem(FLOATING_QUEUE_VISIBLE_KEY, next ? "true" : "false");
  } catch (err) {
    console.warn("[floatingJobQueuePrefs] Failed saving visibility:", err);
  }
  window.dispatchEvent(
    new CustomEvent(FLOATING_QUEUE_VISIBILITY_EVENT, { detail: { visible: next } }),
  );
}

export function openFloatingJobQueue({ domain = "all", autoShow = true } = {}) {
  if (autoShow) {
    setFloatingJobQueueVisible(true);
  }
  window.dispatchEvent(
    new CustomEvent(FLOATING_QUEUE_OPEN_EVENT, { detail: { domain } }),
  );
}

export function clampFloatingPos(
  pos,
  widgetWidth = 196,
  widgetHeight = 42,
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 720,
  margin = 12,
) {
  const maxX = Math.max(margin, viewportWidth - widgetWidth - margin);
  const maxY = Math.max(margin, viewportHeight - widgetHeight - margin);
  return {
    x: Math.min(maxX, Math.max(margin, Math.round(pos?.x ?? maxX))),
    y: Math.min(maxY, Math.max(margin, Math.round(pos?.y ?? maxY))),
  };
}

export function getDefaultFloatingPos() {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 720;
  return clampFloatingPos({ x: vw - 220, y: vh - 68 }, 196, 42, vw, vh, 16);
}

export function loadFloatingJobQueuePos() {
  try {
    const raw = localStorage.getItem(FLOATING_QUEUE_POS_KEY);
    if (!raw) return getDefaultFloatingPos();
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return clampFloatingPos(parsed);
    }
  } catch (err) {
    console.warn("[floatingJobQueuePrefs] Failed reading position:", err);
  }
  return getDefaultFloatingPos();
}

export function saveFloatingJobQueuePos(pos) {
  try {
    localStorage.setItem(FLOATING_QUEUE_POS_KEY, JSON.stringify(pos));
  } catch (err) {
    console.warn("[floatingJobQueuePrefs] Failed saving position:", err);
  }
}
