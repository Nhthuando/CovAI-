/**
 * Unified Dashboard Mock Fixtures & Fallbacks
 * Clearly labeled as Demo Data in UI when live API endpoints are not yet available.
 */

export const MOCK_TRACE_MATRIX_ROWS = [
  {
    id: "mod-auth",
    moduleName: "Authentication & Sessions",
    description: "JWT login, token refresh, OAuth callback, and role-based permissions",
    unit: { status: "pass", label: "8/8 passed", passed: 8, total: 8, path: "server/src/services/auth.service.js" },
    integration: { status: "pass", label: "6/6 endpoints", passed: 6, total: 6, endpoint: "POST /api/auth/login" },
    system: { status: "pass", label: "3/3 journeys", passed: 3, total: 3, scenarioId: "e2e-auth-flow" },
    rootCause: {
      diagnosis: "All layers verified & passing consistently.",
      suspectLayer: "none",
      summary: "Stable",
    },
    items: [
      { type: "unit", name: "auth.service.js", path: "server/src/services/auth.service.js", status: "pass" },
      { type: "integration", name: "POST /api/auth/login", status: "pass" },
      { type: "system", name: "User Login Journey", status: "pass" },
    ],
  },
  {
    id: "mod-orders",
    moduleName: "Order Processing & Checkout",
    description: "Cart checkout, order creation, transaction validation, and state machine",
    unit: { status: "pass", label: "12/12 passed", passed: 12, total: 12, path: "server/src/services/order.service.js" },
    integration: { status: "fail", label: "1/4 failed", passed: 3, total: 4, endpoint: "POST /api/orders/checkout" },
    system: { status: "fail", label: "1/2 failed", passed: 1, total: 2, scenarioId: "e2e-checkout-journey" },
    rootCause: {
      diagnosis: "Unit tests pass but API & UI fail: Root cause is in API route/controller communication or database transaction handling.",
      suspectLayer: "integration",
      summary: "API / DB communication layer failure",
    },
    items: [
      { type: "unit", name: "order.service.js", path: "server/src/services/order.service.js", status: "pass" },
      { type: "integration", name: "POST /api/orders/checkout (HTTP 500)", status: "fail" },
      { type: "system", name: "E2E Checkout Flow (Timeout at step 3)", status: "fail" },
    ],
  },
  {
    id: "mod-payment",
    moduleName: "Payment & Gateway Webhooks",
    description: "Stripe webhook handling, refund calculations, invoice generation",
    unit: { status: "pass", label: "9/9 passed", passed: 9, total: 9, path: "server/src/services/payment.service.js" },
    integration: { status: "pass", label: "4/4 endpoints", passed: 4, total: 4, endpoint: "POST /api/payments/charge" },
    system: { status: "fail", label: "1/2 failed", passed: 1, total: 2, scenarioId: "e2e-payment-modal" },
    rootCause: {
      diagnosis: "Unit and API tests pass but E2E fails: Root cause is a frontend UI selector error or modal state timing issue.",
      suspectLayer: "system",
      summary: "UI component / selector issue",
    },
    items: [
      { type: "unit", name: "payment.service.js", path: "server/src/services/payment.service.js", status: "pass" },
      { type: "integration", name: "POST /api/payments/charge", status: "pass" },
      { type: "system", name: "Pay Button Modal (#stripe-submit not found)", status: "fail" },
    ],
  },
  {
    id: "mod-users",
    moduleName: "User Profile & Membership",
    description: "Account settings, avatar uploads, security preference updates",
    unit: { status: "fail", label: "2/6 failed", passed: 4, total: 6, path: "server/src/services/user.service.js" },
    integration: { status: "fail", label: "1/3 failed", passed: 2, total: 3, endpoint: "PUT /api/users/profile" },
    system: { status: "fail", label: "1/1 failed", passed: 0, total: 1, scenarioId: "e2e-profile-edit" },
    rootCause: {
      diagnosis: "All 3 layers fail simultaneously: Root cause lies in core business logic inside user.service.js propagating upward.",
      suspectLayer: "unit",
      summary: "Core service logic defect",
    },
    items: [
      { type: "unit", name: "validateProfileUpdate() failed", path: "server/src/services/user.service.js", status: "fail" },
      { type: "integration", name: "PUT /api/users/profile", status: "fail" },
      { type: "system", name: "Profile Update Journey", status: "fail" },
    ],
  },
  {
    id: "mod-catalog",
    moduleName: "Product Catalog & Search",
    description: "Fuzzy search, category filtering, inventory status, price sorting",
    unit: { status: "pass", label: "15/15 passed", passed: 15, total: 15, path: "server/src/services/product.service.js" },
    integration: { status: "pass", label: "8/8 endpoints", passed: 8, total: 8, endpoint: "GET /api/products/search" },
    system: { status: "pass", label: "4/4 journeys", passed: 4, total: 4, scenarioId: "e2e-catalog-filter" },
    rootCause: {
      diagnosis: "Comprehensive coverage across all layers without regression.",
      suspectLayer: "none",
      summary: "Stable",
    },
    items: [
      { type: "unit", name: "product.service.js", path: "server/src/services/product.service.js", status: "pass" },
      { type: "integration", name: "GET /api/products", status: "pass" },
      { type: "system", name: "Catalog Search & Filter Journey", status: "pass" },
    ],
  },
  {
    id: "mod-notifications",
    moduleName: "Notification Service & Webhooks",
    description: "In-app notifications, email queue dispatcher, Discord/Slack webhooks",
    unit: { status: "untested", label: "Missing tests", passed: 0, total: 0, path: "server/src/services/notification.service.js" },
    integration: { status: "warn", label: "1/2 untested", passed: 1, total: 2, endpoint: "POST /api/webhooks/trigger" },
    system: { status: "untested", label: "No E2E journey", passed: 0, total: 0 },
    rootCause: {
      diagnosis: "Coverage gap: Unit test suite is missing for notification dispatcher logic.",
      suspectLayer: "unit",
      summary: "Uncovered testing gap",
    },
    items: [
      { type: "unit", name: "notification.service.js (0% coverage)", path: "server/src/services/notification.service.js", status: "untested" },
      { type: "integration", name: "POST /api/webhooks/slack", status: "untested" },
    ],
  },
];

export const MOCK_TREND_SERIES = [
  { runLabel: "Run #1", timestamp: Date.now() - 7 * 86400000, unitCoverage: 62.0, integrationCoverage: 48.0, systemCoverage: 35.0, overallCoverage: 51.5, passRate: 74.0 },
  { runLabel: "Run #2", timestamp: Date.now() - 5 * 86400000, unitCoverage: 68.5, integrationCoverage: 54.0, systemCoverage: 41.0, overallCoverage: 57.8, passRate: 80.5 },
  { runLabel: "Run #3", timestamp: Date.now() - 4 * 86400000, unitCoverage: 71.0, integrationCoverage: 59.5, systemCoverage: 47.0, overallCoverage: 62.4, passRate: 83.0 },
  { runLabel: "Run #4", timestamp: Date.now() - 3 * 86400000, unitCoverage: 74.2, integrationCoverage: 65.0, systemCoverage: 52.0, overallCoverage: 66.8, passRate: 87.5 },
  { runLabel: "Run #5", timestamp: Date.now() - 2 * 86400000, unitCoverage: 79.0, integrationCoverage: 68.2, systemCoverage: 56.5, overallCoverage: 71.2, passRate: 89.0 },
  { runLabel: "Run #6 (Current)", timestamp: Date.now() - 1 * 3600000, unitCoverage: 83.4, integrationCoverage: 72.8, systemCoverage: 61.0, overallCoverage: 75.7, passRate: 92.4 },
];

export const MOCK_RECENT_RUNS = [
  { id: "run-9842", type: "system", status: "fail", passed: 11, failed: 2, total: 13, coveragePct: 61.0, durationMs: 48200, startedAt: Date.now() - 28 * 60000, commitSha: "7b4c921" },
  { id: "run-9841", type: "integration", status: "pass", passed: 24, failed: 1, total: 25, coveragePct: 72.8, durationMs: 14500, startedAt: Date.now() - 45 * 60000, commitSha: "7b4c921" },
  { id: "run-9840", type: "unit", status: "pass", passed: 142, failed: 2, total: 144, coveragePct: 83.4, durationMs: 4200, startedAt: Date.now() - 72 * 60000, commitSha: "7b4c921" },
  { id: "run-9839", type: "system", status: "pass", passed: 13, failed: 0, total: 13, coveragePct: 59.0, durationMs: 45000, startedAt: Date.now() - 120 * 60000, commitSha: "a12d844" },
  { id: "run-9838", type: "integration", status: "pass", passed: 25, failed: 0, total: 25, coveragePct: 71.0, durationMs: 13800, startedAt: Date.now() - 180 * 60000, commitSha: "a12d844" },
  { id: "run-9837", type: "unit", status: "pass", passed: 140, failed: 0, total: 140, coveragePct: 81.2, durationMs: 3900, startedAt: Date.now() - 240 * 60000, commitSha: "a12d844" },
  { id: "run-9836", type: "unit", status: "fail", passed: 135, failed: 5, total: 140, coveragePct: 79.0, durationMs: 4100, startedAt: Date.now() - 360 * 60000, commitSha: "f03b291" },
  { id: "run-9835", type: "integration", status: "fail", passed: 20, failed: 5, total: 25, coveragePct: 68.0, durationMs: 15100, startedAt: Date.now() - 420 * 60000, commitSha: "f03b291" },
  { id: "run-9834", type: "system", status: "pass", passed: 12, failed: 1, total: 13, coveragePct: 56.0, durationMs: 46200, startedAt: Date.now() - 500 * 60000, commitSha: "c389f11" },
  { id: "run-9833", type: "unit", status: "pass", passed: 138, failed: 0, total: 138, coveragePct: 80.1, durationMs: 3800, startedAt: Date.now() - 600 * 60000, commitSha: "c389f11" },
];

export const MOCK_AI_STATS = {
  aiGenerated: 38,
  aiRepaired: 12,
  gaps: 7,
};

export const MOCK_INTEGRATION_FAILURE_LAYERS = {
  route: 1,
  middlewareAuth: 2,
  controller: 3,
  database: 1,
};

export const MOCK_SYSTEM_FAILURE_KINDS = {
  selectorNotFound: 2,
  networkTimeout: 1,
  assertion: 3,
  flaky: 1,
};

export function getEmptyMockData() {
  return {
    matrix: [],
    trend: [],
    recentRuns: [],
    aiStats: { aiGenerated: 0, aiRepaired: 0, gaps: 0 },
  };
}
