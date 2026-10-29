/**
 * Unified Dashboard Comprehensive Mock Dataset & Presets
 * 100% Mathematically Coherent across all 5 Dashboard Zones:
 * - Zone 2 Total Executed = 144 (Unit) + 25 (Integration) + 13 (System) = 182 tests
 * - Zone 2 Passed = 142 (Unit) + 23 (Integration) + 10 (System) = 165 passed (90.7% pass rate)
 * - Zone 2 Failed = 2 (Unit) + 2 (Integration) + 3 (System) = 7 failed, plus 2 Uncovered APIs
 * - Zone 3 Breakdowns match Zone 4 Traceability Matrix & Zone 5 Recent Runs 1-to-1.
 */

export const MOCK_SNAPSHOT_PRESETS = [
  {
    id: "cmvs3749",
    label: "cmvs3749",
    branch: "main • current",
    description: "Current HEAD — 7 failures across 3 modules",
  },
  {
    id: "a12d844",
    label: "a12d844",
    branch: "release/v1.4.2",
    description: "Clean Release Candidate — All Quality Gates Passing",
  },
  {
    id: "f03b291",
    label: "f03b291",
    branch: "feat/checkout-tx",
    description: "Pre-fix Checkpoint — High Integration & Unit Regressions",
  },
];

export const MOCK_DEMO_PILLARS = {
  unit: {
    id: "unit",
    label: "Unit Test",
    framework: "Jest",
    totalTests: 144,
    passedTests: 142,
    failedTests: 2,
    skippedTests: 0,
    flakyTests: 0,
    passRate: 98.6,
    durationMs: 4200,
    avgDurationMs: 29,
    coverageMetrics: {
      lines: 83.4,
      branches: 76.5,
      functions: 88.0,
      statements: 84.1,
    },
    lowCoverageItems: [
      {
        filePath: "server/src/services/notification.service.js",
        name: "notification.service.js",
        branchesPct: 0.0,
        linesPct: 18.5,
        line: 14,
      },
      {
        filePath: "server/src/services/user.service.js",
        name: "user.service.js",
        branchesPct: 54.2,
        linesPct: 68.0,
        line: 42,
      },
      {
        filePath: "server/src/services/order.service.js",
        name: "order.service.js",
        branchesPct: 62.5,
        linesPct: 78.4,
        line: 88,
      },
    ],
    failureDistribution: {},
    source: "demo",
    errorMessage: null,
  },
  integration: {
    id: "integration",
    label: "Integration Test",
    framework: "Supertest",
    totalTests: 25,
    passedTests: 23,
    failedTests: 2,
    skippedTests: 0,
    flakyTests: 0,
    passRate: 92.0,
    durationMs: 14500,
    avgDurationMs: 580,
    coverageMetrics: {
      lines: 78.2,
      branches: 71.0,
      functions: 82.5,
      statements: 79.0,
      apiEndpoint: 85.2,
      uncoveredApis: 2,
      totalApis: 27,
    },
    lowCoverageItems: [
      {
        filePath: "/api/webhooks/slack",
        name: "POST /api/webhooks/slack",
        branchesPct: 0.0,
        linesPct: 0.0,
        line: 1,
      },
      {
        filePath: "/api/notifications/purge",
        name: "DELETE /api/notifications/purge",
        branchesPct: 0.0,
        linesPct: 0.0,
        line: 1,
      },
    ],
    // Exactly 2 failed tests: 1 in Controller (mod-users), 1 in Database (mod-orders)
    failureDistribution: {
      route: 0,
      middlewareAuth: 0,
      controller: 1,
      database: 1,
    },
    source: "demo",
    errorMessage: null,
  },
  system: {
    id: "system",
    label: "System Test (E2E)",
    framework: "Playwright",
    totalTests: 13,
    passedTests: 10,
    failedTests: 3,
    skippedTests: 0,
    flakyTests: 1,
    passRate: 76.9,
    durationMs: 48200,
    avgDurationMs: 3708,
    coverageMetrics: {
      lines: 68.5,
      flow: 68.5,
    },
    lowCoverageItems: [],
    // Exactly 3 failed tests + 1 flaky:
    // 1 Selector Not Found (mod-payment), 1 Network Timeout (mod-orders), 1 Assertion (mod-users), 1 Flaky (mod-catalog)
    failureDistribution: {
      selectorNotFound: 1,
      networkTimeout: 1,
      assertion: 1,
      flaky: 1,
    },
    source: "demo",
    errorMessage: null,
  },
};

export const MOCK_INTEGRATION_FAILURE_LAYERS = {
  route: 0,
  middlewareAuth: 0,
  controller: 1,
  database: 1,
};

export const MOCK_SYSTEM_FAILURE_KINDS = {
  selectorNotFound: 1,
  networkTimeout: 1,
  assertion: 1,
  flaky: 1,
};

/**
 * 6 Modules whose Unit (142/144), Integration (23/25 + 2 uncovered), and System (10/13) counts
 * sum 100% identically to MOCK_DEMO_PILLARS and Executive KPI Totals.
 */
export const MOCK_TRACE_MATRIX_ROWS = [
  {
    id: "mod-auth",
    moduleName: "Authentication & Sessions",
    description: "JWT login, token refresh, OAuth callback, and role-based permissions",
    unit: {
      status: "pass",
      label: "28/28 passed",
      passed: 28,
      failed: 0,
      total: 28,
      path: "server/src/services/auth.service.js",
    },
    integration: {
      status: "pass",
      label: "6/6 endpoints",
      passed: 6,
      failed: 0,
      total: 6,
      endpoint: "POST /api/auth/login",
    },
    system: {
      status: "pass",
      label: "3/3 journeys",
      passed: 3,
      failed: 0,
      total: 3,
      scenarioId: "e2e-auth-flow",
    },
    rootCause: {
      diagnosis: "All layers verified & passing consistently.",
      suspectLayer: "none",
      summary: "Stable",
    },
    layerDetails: {
      unit: {
        file: "server/src/services/auth.service.js",
        branchCoveragePct: 94.2,
        failingFunctions: [],
        summaryText: "28/28 unit assertions passing (verifyJwtToken, issueRefreshToken, validateOAuthState)",
      },
      integration: {
        method: "POST",
        endpoint: "/api/auth/login",
        httpStatus: 200,
        failureLayer: "none",
        summaryText: "6/6 endpoints returning expected 200/201/401 contracts",
      },
      system: {
        flowName: "User Login & OAuth Redirect Journey",
        failedStep: "None — All 5 journey steps verified",
        failureKind: "none",
        scenarioId: "e2e-auth-flow",
      },
    },
    items: [
      { type: "unit", name: "auth.service.js (94.2% branch cov)", path: "server/src/services/auth.service.js", status: "pass" },
      { type: "integration", name: "POST /api/auth/login (HTTP 200)", endpoint: "POST /api/auth/login", status: "pass" },
      { type: "system", name: "User Login Journey (3/3 steps pass)", scenarioId: "e2e-auth-flow", status: "pass" },
    ],
  },
  {
    id: "mod-orders",
    moduleName: "Order Processing & Checkout",
    description: "Cart checkout, order creation, transaction validation, and state machine",
    unit: {
      status: "pass",
      label: "32/32 passed",
      passed: 32,
      failed: 0,
      total: 32,
      path: "server/src/services/order.service.js",
    },
    integration: {
      status: "fail",
      label: "1/4 failed",
      passed: 3,
      failed: 1,
      total: 4,
      endpoint: "POST /api/orders/checkout",
    },
    system: {
      status: "fail",
      label: "1/2 failed",
      passed: 1,
      failed: 1,
      total: 2,
      scenarioId: "e2e-checkout-journey",
    },
    rootCause: {
      diagnosis: "Unit tests pass (32/32) but API & UI fail: Unhandled Prisma foreign-key deadlock in POST /api/orders/checkout causes HTTP 500 and E2E timeout.",
      suspectLayer: "integration",
      summary: "Database transaction failure (HTTP 500)",
    },
    layerDetails: {
      unit: {
        file: "server/src/services/order.service.js",
        branchCoveragePct: 62.5,
        failingFunctions: [],
        summaryText: "calculateOrderTotals() & validateCartItems() pass with mocked repository",
      },
      integration: {
        method: "POST",
        endpoint: "/api/orders/checkout",
        httpStatus: 500,
        failureLayer: "database",
        summaryText: "PrismaClientKnownRequestError P2003 on order_items foreign key constraint",
      },
      system: {
        flowName: "E2E Checkout Flow (e2e-checkout-journey)",
        failedStep: "Step 3: Click 'Place Order' & await /checkout/confirmation redirect",
        failureKind: "networkTimeout",
        scenarioId: "e2e-checkout-journey",
      },
    },
    diagnostics: {
      summary: "Database Transaction Rollback in POST /api/orders/checkout",
      suspectLayer: "integration",
      failureCategory: "database",
      filePath: "server/src/controllers/order.controller.js",
      endpoint: "POST /api/orders/checkout",
      httpStatus: 500,
      scenarioName: "Order Processing & Checkout (Cross-Layer)",
      failedStep: "Prisma $transaction commit in createOrderTransaction()",
      stackTrace: `PrismaClientKnownRequestError: Foreign key constraint failed on the field: \`inventory_reservation_id\` (Code: P2003)\n  at RequestHandler.handleRequestError (node_modules/@prisma/client/runtime/library.js:121:70)\n  at OrderRepository.commitCheckout (server/src/repositories/order.repo.js:78:11)\n  at OrderController.checkout (server/src/controllers/order.controller.js:54:5)`,
      testCases: [
        { name: "GET /api/orders — list user orders", status: "pass", durationMs: 310, step: "HTTP 200 OK" },
        { name: "POST /api/orders/validate — cart pre-check", status: "pass", durationMs: 280, step: "HTTP 200 OK" },
        { name: "POST /api/orders/checkout — commit transaction", status: "fail", durationMs: 1420, step: "HTTP 500 (Database Layer)" },
        { name: "E2E Checkout Flow — Step 3 confirmation", status: "fail", durationMs: 15020, step: "API/Net Timeout waiting for 201" },
      ],
      aiPrompt: `Diagnose the cross-layer failure in "Order Processing & Checkout":\n- Unit Layer: server/src/services/order.service.js (32/32 passed, 62.5% branch coverage)\n- Integration Layer: POST /api/orders/checkout fails with HTTP 500 at Database layer (Prisma P2003 foreign key constraint on inventory_reservation_id)\n- System E2E Layer: e2e-checkout-journey fails at Step 3 with API/Net Timeout\nPlease provide the fix for the Prisma transaction in order.controller.js / order.repo.js and add a regression test.`,
    },
    items: [
      { type: "unit", name: "order.service.js (32/32 passed)", path: "server/src/services/order.service.js", status: "pass" },
      { type: "integration", name: "POST /api/orders/checkout (HTTP 500 • Database)", endpoint: "POST /api/orders/checkout", status: "fail" },
      { type: "system", name: "E2E Checkout Flow (Timeout at Step 3)", scenarioId: "e2e-checkout-journey", status: "fail" },
    ],
  },
  {
    id: "mod-payment",
    moduleName: "Payment & Gateway Webhooks",
    description: "Stripe webhook handling, refund calculations, invoice generation",
    unit: {
      status: "pass",
      label: "24/24 passed",
      passed: 24,
      failed: 0,
      total: 24,
      path: "server/src/services/payment.service.js",
    },
    integration: {
      status: "pass",
      label: "4/4 endpoints",
      passed: 4,
      failed: 0,
      total: 4,
      endpoint: "POST /api/payments/charge",
    },
    system: {
      status: "fail",
      label: "1/2 failed",
      passed: 1,
      failed: 1,
      total: 2,
      scenarioId: "e2e-payment-modal",
    },
    rootCause: {
      diagnosis: "Unit (24/24) and API (4/4) tests pass, but E2E fails: Frontend PaymentModal renamed submit button testId from #stripe-submit to [data-testid='pay-confirm-btn'].",
      suspectLayer: "system",
      summary: "UI Selector Not Found (#stripe-submit)",
    },
    layerDetails: {
      unit: {
        file: "server/src/services/payment.service.js",
        branchCoveragePct: 86.0,
        failingFunctions: [],
        summaryText: "computeRefundAmount() & verifyStripeSignature() 24/24 passing",
      },
      integration: {
        method: "POST",
        endpoint: "/api/payments/charge",
        httpStatus: 200,
        failureLayer: "none",
        summaryText: "4/4 payment & webhook endpoints passing (HTTP 200 OK)",
      },
      system: {
        flowName: "Stripe Payment Modal Journey (e2e-payment-modal)",
        failedStep: "Step 2: Locate & click '#stripe-submit' inside PaymentModal.jsx",
        failureKind: "selectorNotFound",
        scenarioId: "e2e-payment-modal",
      },
    },
    diagnostics: {
      summary: "Playwright Selector Not Found (#stripe-submit) in Payment Modal",
      suspectLayer: "system",
      failureCategory: "selectorNotFound",
      filePath: "e2e/payment-modal.spec.ts",
      endpoint: "POST /api/payments/charge",
      httpStatus: 200,
      scenarioName: "Stripe Payment Modal Journey (e2e-payment-modal)",
      failedStep: "Step 2: page.click('#stripe-submit') — Locator resolved to 0 elements",
      stackTrace: `TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('#stripe-submit') to be visible\n  - DOM snapshot shows button has [data-testid="pay-confirm-btn"]\n  at runPaymentModalTest (e2e/payment-modal.spec.ts:41:18)`,
      testCases: [
        { name: "Invoice PDF Download Journey", status: "pass", durationMs: 3400, step: "Verified download stream" },
        { name: "Stripe Payment Modal Journey — Card Submit", status: "fail", durationMs: 10450, step: "Selector #stripe-submit not found" },
      ],
      aiPrompt: `Diagnose the E2E failure in "Payment & Gateway Webhooks" (e2e-payment-modal):\n- Unit (24/24) and Integration (POST /api/payments/charge HTTP 200) both pass.\n- System E2E fails at Step 2 with Selector Not Found for '#stripe-submit'.\nPlease update the Playwright locator in e2e/payment-modal.spec.ts to use resilient role/testId selectors.`,
    },
    items: [
      { type: "unit", name: "payment.service.js (24/24 passed)", path: "server/src/services/payment.service.js", status: "pass" },
      { type: "integration", name: "POST /api/payments/charge (HTTP 200)", endpoint: "POST /api/payments/charge", status: "pass" },
      { type: "system", name: "Pay Button Modal (#stripe-submit not found)", scenarioId: "e2e-payment-modal", status: "fail" },
    ],
  },
  {
    id: "mod-users",
    moduleName: "User Profile & Membership",
    description: "Account settings, avatar uploads, security preference updates",
    unit: {
      status: "fail",
      label: "2/20 failed",
      passed: 18,
      failed: 2,
      total: 20,
      path: "server/src/services/user.service.js",
    },
    integration: {
      status: "fail",
      label: "1/3 failed",
      passed: 2,
      failed: 1,
      total: 3,
      endpoint: "PUT /api/users/profile",
    },
    system: {
      status: "fail",
      label: "1/1 failed",
      passed: 0,
      failed: 1,
      total: 1,
      scenarioId: "e2e-profile-edit",
    },
    rootCause: {
      diagnosis: "All 3 layers fail simultaneously: Null-pointer defect in validateProfileUpdate() inside user.service.js propagates to PUT /api/users/profile (Controller) and Profile Edit UI.",
      suspectLayer: "unit",
      summary: "Core service logic defect (user.service.js)",
    },
    layerDetails: {
      unit: {
        file: "server/src/services/user.service.js",
        branchCoveragePct: 54.2,
        failingFunctions: ["validateProfileUpdate()", "sanitizeBioInput()"],
        summaryText: "2/20 failed: TypeError reading .trim() on optional socialLinks field",
      },
      integration: {
        method: "PUT",
        endpoint: "/api/users/profile",
        httpStatus: 422,
        failureLayer: "controller",
        summaryText: "Controller threw unhandled validation exception (expected 200, got 422)",
      },
      system: {
        flowName: "Profile Update Journey (e2e-profile-edit)",
        failedStep: "Step 4: Assert 'Profile saved successfully' toast banner",
        failureKind: "assertion",
        scenarioId: "e2e-profile-edit",
      },
    },
    diagnostics: {
      summary: "Core Service Defect in user.service.js Propagating Across All 3 Layers",
      suspectLayer: "unit",
      failureCategory: "controller",
      filePath: "server/src/services/user.service.js",
      endpoint: "PUT /api/users/profile",
      httpStatus: 422,
      scenarioName: "User Profile & Membership (Full-Stack Propagation)",
      failedStep: "validateProfileUpdate() throws when payload.socialLinks is undefined",
      stackTrace: `TypeError: Cannot read properties of undefined (reading 'trim')\n  at validateProfileUpdate (server/src/services/user.service.js:64:29)\n  at UserController.updateProfile (server/src/controllers/user.controller.js:39:18)\n  at Object.<anonymous> (server/src/services/__tests__/user.service.test.js:92:14)`,
      testCases: [
        { name: "Unit: validateProfileUpdate() handles partial profile", status: "fail", durationMs: 14, step: "TypeError at line 64" },
        { name: "Unit: sanitizeBioInput() strips unsafe HTML tags", status: "fail", durationMs: 11, step: "Assertion mismatch" },
        { name: "Integration: PUT /api/users/profile (Controller Layer)", status: "fail", durationMs: 490, step: "HTTP 422 instead of 200" },
        { name: "System E2E: Profile Update Journey toast assertion", status: "fail", durationMs: 6800, step: "Visual/Assertion error" },
      ],
      aiPrompt: `Diagnose the full-stack failure in "User Profile & Membership" (@server/src/services/user.service.js):\n- Failing Unit Functions: validateProfileUpdate(), sanitizeBioInput() (54.2% branch coverage)\n- Failing API Endpoint: PUT /api/users/profile returns HTTP 422 in Controller layer\n- Failing E2E Flow: e2e-profile-edit fails at Step 4 (Visual/Assertion)\nPlease fix the null-safety bug in validateProfileUpdate() and sanitizeBioInput() in server/src/services/user.service.js.`,
    },
    items: [
      { type: "unit", name: "validateProfileUpdate() & sanitizeBioInput() failed", path: "server/src/services/user.service.js", status: "fail" },
      { type: "integration", name: "PUT /api/users/profile (HTTP 422 • Controller)", endpoint: "PUT /api/users/profile", status: "fail" },
      { type: "system", name: "Profile Update Journey (Assertion failed at Step 4)", scenarioId: "e2e-profile-edit", status: "fail" },
    ],
  },
  {
    id: "mod-catalog",
    moduleName: "Product Catalog & Search",
    description: "Fuzzy search, category filtering, inventory status, price sorting",
    unit: {
      status: "pass",
      label: "40/40 passed",
      passed: 40,
      failed: 0,
      total: 40,
      path: "server/src/services/product.service.js",
    },
    integration: {
      status: "pass",
      label: "7/7 endpoints",
      passed: 7,
      failed: 0,
      total: 7,
      endpoint: "GET /api/products/search",
    },
    system: {
      status: "pass",
      label: "5/5 journeys (1 flaky)",
      passed: 5,
      failed: 0,
      total: 5,
      scenarioId: "e2e-catalog-filter",
    },
    rootCause: {
      diagnosis: "All functional assertions pass; 1 E2E search debounce scenario passed on retry #2 (flaky timing).",
      suspectLayer: "none",
      summary: "Stable (1 Flaky Retry)",
    },
    layerDetails: {
      unit: {
        file: "server/src/services/product.service.js",
        branchCoveragePct: 91.0,
        failingFunctions: [],
        summaryText: "40/40 unit tests passing (fuzzyMatchProducts, sortCatalogByPrice)",
      },
      integration: {
        method: "GET",
        endpoint: "/api/products/search",
        httpStatus: 200,
        failureLayer: "none",
        summaryText: "7/7 catalog & inventory endpoints passing (avg 210ms)",
      },
      system: {
        flowName: "Catalog Search & Filter Journey (e2e-catalog-filter)",
        failedStep: "Step 2: Debounced search input required 1 retry (Flaky)",
        failureKind: "flaky",
        scenarioId: "e2e-catalog-filter",
      },
    },
    items: [
      { type: "unit", name: "product.service.js (40/40 passed)", path: "server/src/services/product.service.js", status: "pass" },
      { type: "integration", name: "GET /api/products/search (HTTP 200)", endpoint: "GET /api/products/search", status: "pass" },
      { type: "system", name: "Catalog Search & Filter Journey (Passed on retry)", scenarioId: "e2e-catalog-filter", status: "pass" },
    ],
  },
  {
    id: "mod-notifications",
    moduleName: "Notification Service & Webhooks",
    description: "In-app notifications, email queue dispatcher, Discord/Slack webhooks",
    unit: {
      status: "untested",
      label: "0/0 (Missing)",
      passed: 0,
      failed: 0,
      total: 0,
      path: "server/src/services/notification.service.js",
    },
    integration: {
      status: "warn",
      label: "1/3 covered",
      passed: 1,
      failed: 0,
      total: 1,
      uncovered: 2,
      endpoint: "POST /api/webhooks/slack",
    },
    system: {
      status: "untested",
      label: "0/0 journeys",
      passed: 0,
      failed: 0,
      total: 0,
      scenarioId: "e2e-notifications",
    },
    rootCause: {
      diagnosis: "Coverage gap: Unit test suite is missing (0% branch cov) and 2 webhook/purge API endpoints have no Supertest coverage.",
      suspectLayer: "unit",
      summary: "Uncovered testing gap (2 APIs + Unit)",
    },
    layerDetails: {
      unit: {
        file: "server/src/services/notification.service.js",
        branchCoveragePct: 0.0,
        failingFunctions: ["dispatchWebhookPayload() — Untested", "purgeExpiredAlerts() — Untested"],
        summaryText: "0 unit tests executed — 0.0% branch coverage",
      },
      integration: {
        method: "POST",
        endpoint: "/api/webhooks/slack",
        httpStatus: null,
        failureLayer: "uncovered",
        summaryText: "1/3 covered (GET /api/notifications pass; POST /api/webhooks/slack & DELETE /api/notifications/purge uncovered)",
      },
      system: {
        flowName: "Notification Center & Webhook Settings Flow",
        failedStep: "No Playwright E2E spec authored yet",
        failureKind: "untested",
        scenarioId: "e2e-notifications",
      },
    },
    items: [
      { type: "unit", name: "notification.service.js (0% branch coverage)", path: "server/src/services/notification.service.js", status: "untested" },
      { type: "integration", name: "POST /api/webhooks/slack (Uncovered API)", endpoint: "POST /api/webhooks/slack", status: "untested" },
      { type: "integration", name: "DELETE /api/notifications/purge (Uncovered API)", endpoint: "DELETE /api/notifications/purge", status: "untested" },
    ],
  },
];

export const MOCK_TREND_SERIES = [
  { runLabel: "Run #1", timestamp: Date.now() - 7 * 86400000, unitCoverage: 62.0, integrationCoverage: 54.0, systemCoverage: 42.0, overallCoverage: 52.7, passRate: 76.0 },
  { runLabel: "Run #2", timestamp: Date.now() - 5 * 86400000, unitCoverage: 68.5, integrationCoverage: 62.0, systemCoverage: 48.0, overallCoverage: 59.5, passRate: 81.5 },
  { runLabel: "Run #3", timestamp: Date.now() - 4 * 86400000, unitCoverage: 72.0, integrationCoverage: 70.4, systemCoverage: 53.5, overallCoverage: 65.3, passRate: 84.2 },
  { runLabel: "Run #4", timestamp: Date.now() - 3 * 86400000, unitCoverage: 76.4, integrationCoverage: 77.8, systemCoverage: 59.0, overallCoverage: 71.1, passRate: 87.5 },
  { runLabel: "Run #5", timestamp: Date.now() - 2 * 86400000, unitCoverage: 80.1, integrationCoverage: 81.5, systemCoverage: 64.0, overallCoverage: 75.2, passRate: 91.2 },
  { runLabel: "Run #6 (Current)", timestamp: Date.now() - 1 * 1680000, unitCoverage: 83.4, integrationCoverage: 85.2, systemCoverage: 68.5, overallCoverage: 79.0, passRate: 96.2 },
];

export const MOCK_RECENT_RUNS = [
  {
    id: "run-9842",
    type: "system",
    status: "fail",
    passed: 10,
    failed: 3,
    total: 13,
    coveragePct: 68.5,
    durationMs: 48200,
    startedAt: Date.now() - 28 * 60000,
    commitSha: "cmvs3749",
    failureLayer: "System (Playwright E2E — Selector & Timeout)",
    stackTrace: `Playwright Suite Summary (run-9842):\n  1) [chromium] › e2e/checkout.spec.ts:58:5 › Order Checkout Flow\n     TimeoutError: page.waitForURL('**/checkout/confirmation') timed out (15000ms)\n     Caused by HTTP 500 from POST /api/orders/checkout\n\n  2) [chromium] › e2e/payment-modal.spec.ts:41:3 › Stripe Payment Modal\n     Error: locator('#stripe-submit') resolved to 0 elements\n\n  3) [chromium] › e2e/profile-edit.spec.ts:74:7 › User Profile Update\n     AssertionError: Expected toast 'Profile saved' to be visible`,
    testCases: [
      { name: "Auth: User Login & Session Persistence", status: "pass", durationMs: 2840, step: "All 4 steps passed" },
      { name: "Auth: OAuth GitHub Callback Redirect", status: "pass", durationMs: 3120, step: "All 3 steps passed" },
      { name: "Auth: Role-Based Protected Route Guard", status: "pass", durationMs: 1950, step: "All 3 steps passed" },
      { name: "Checkout: Guest Cart to Address Step", status: "pass", durationMs: 3420, step: "All 4 steps passed" },
      { name: "Checkout: Full Order Placement & Receipt", status: "fail", durationMs: 15020, step: "Step 3: API/Net Timeout (HTTP 500)" },
      { name: "Payment: Invoice PDF Download Stream", status: "pass", durationMs: 3400, step: "All 3 steps passed" },
      { name: "Payment: Stripe Modal Submit Confirmation", status: "fail", durationMs: 10450, step: "Step 2: Selector #stripe-submit not found" },
      { name: "Profile: Update Bio & Social Links", status: "fail", durationMs: 6800, step: "Step 4: Toast assertion failed (HTTP 422)" },
      { name: "Catalog: Debounced Keyword Search (Retry #2)", status: "pass", durationMs: 1200, step: "Passed on retry (Flaky)" },
    ],
    aiPrompt: `Analyze test execution run-9842 (Playwright System E2E Suite, 10/13 passed, 3 failed):\n1. e2e/checkout.spec.ts failed with timeout due to HTTP 500 on POST /api/orders/checkout\n2. e2e/payment-modal.spec.ts failed because selector '#stripe-submit' was not found\n3. e2e/profile-edit.spec.ts failed asserting toast banner due to HTTP 422 on PUT /api/users/profile\nProvide a step-by-step remediation plan for these 3 failures.`,
  },
  {
    id: "run-9841",
    type: "integration",
    status: "fail",
    passed: 23,
    failed: 2,
    total: 25,
    coveragePct: 85.2,
    durationMs: 14500,
    startedAt: Date.now() - 45 * 60000,
    commitSha: "cmvs3749",
    failureLayer: "Integration (Supertest — Database & Controller)",
    stackTrace: `Supertest Suite Summary (run-9841):\n  ● POST /api/orders/checkout › commits order & decrements inventory\n    expected 201 "Created", got 500 "Internal Server Error"\n    PrismaClientKnownRequestError P2003: Foreign key constraint failed on \`inventory_reservation_id\`\n    at server/src/controllers/order.controller.js:54:5\n\n  ● PUT /api/users/profile › updates profile bio when socialLinks is omitted\n    expected 200 "OK", got 422 "Unprocessable Entity"\n    at server/src/controllers/user.controller.js:39:18`,
    testCases: [
      { name: "POST /api/auth/login — valid credentials -> 200", status: "pass", durationMs: 420, step: "200 OK + JWT cookie" },
      { name: "POST /api/auth/refresh — rotates token -> 200", status: "pass", durationMs: 380, step: "200 OK" },
      { name: "POST /api/orders/checkout — valid cart -> 201", status: "fail", durationMs: 1420, step: "500 Internal Server Error (Database)" },
      { name: "POST /api/payments/charge — Stripe mock -> 200", status: "pass", durationMs: 610, step: "200 OK" },
      { name: "PUT /api/users/profile — partial payload -> 200", status: "fail", durationMs: 490, step: "422 Unprocessable (Controller)" },
      { name: "GET /api/products/search?q=keyboard -> 200", status: "pass", durationMs: 290, step: "200 OK (14 items)" },
    ],
    aiPrompt: `Diagnose Supertest Integration run-9841 (23/25 passed, 2 failed):\n- POST /api/orders/checkout returned HTTP 500 (Prisma P2003 foreign key constraint)\n- PUT /api/users/profile returned HTTP 422 when socialLinks is omitted\nSuggest code fixes for order.controller.js and user.service.js.`,
  },
  {
    id: "run-9840",
    type: "unit",
    status: "fail",
    passed: 142,
    failed: 2,
    total: 144,
    coveragePct: 83.4,
    durationMs: 4200,
    startedAt: Date.now() - 72 * 60000,
    commitSha: "cmvs3749",
    failureLayer: "Unit (Jest — Service Logic Layer)",
    stackTrace: `FAIL server/src/services/__tests__/user.service.test.js\n  ● UserService › validateProfileUpdate() › accepts payload without socialLinks\n    TypeError: Cannot read properties of undefined (reading 'trim')\n      62 | export function validateProfileUpdate(payload) {\n      63 |   const bio = (payload.bio || "").trim();\n    > 64 |   const github = payload.socialLinks.github.trim();\n         |                                      ^\n      at validateProfileUpdate (server/src/services/user.service.js:64:38)\n\n  ● UserService › sanitizeBioInput() › strips script tags while preserving markdown\n    expect(received).toBe(expected)\n    Expected: "Hello **world**"\n    Received: "Hello world"`,
    testCases: [
      { name: "auth.service.test.js (28 tests)", status: "pass", durationMs: 810, step: "28/28 passed" },
      { name: "order.service.test.js (32 tests)", status: "pass", durationMs: 960, step: "32/32 passed" },
      { name: "payment.service.test.js (24 tests)", status: "pass", durationMs: 740, step: "24/24 passed" },
      { name: "user.service.test.js › validateProfileUpdate()", status: "fail", durationMs: 14, step: "TypeError at line 64" },
      { name: "user.service.test.js › sanitizeBioInput()", status: "fail", durationMs: 11, step: "Expected markdown preserved" },
      { name: "product.service.test.js (40 tests)", status: "pass", durationMs: 1120, step: "40/40 passed" },
    ],
    aiPrompt: `Fix the 2 failing Jest unit tests in run-9840 (server/src/services/user.service.js):\n1. validateProfileUpdate() throws TypeError reading 'trim' on undefined socialLinks\n2. sanitizeBioInput() strips markdown formatting unexpectedly.`,
  },
  {
    id: "run-9839",
    type: "system",
    status: "pass",
    passed: 13,
    failed: 0,
    total: 13,
    coveragePct: 78.0,
    durationMs: 44100,
    startedAt: Date.now() - 180 * 60000,
    commitSha: "a12d844",
    failureLayer: "None — All 13 E2E Journeys Passed",
    stackTrace: `Playwright Suite Summary (run-9839 — commit a12d844):\n  ✓ 13 passed (44.1s)\n  0 failed • 0 flaky • Flow Coverage: 78.0%`,
    testCases: [
      { name: "Auth: User Login & OAuth Flow (3 journeys)", status: "pass", durationMs: 7900, step: "3/3 passed" },
      { name: "Checkout: End-to-End Order Flow (2 journeys)", status: "pass", durationMs: 11200, step: "2/2 passed" },
      { name: "Payment: Stripe Modal & Invoice (2 journeys)", status: "pass", durationMs: 8400, step: "2/2 passed" },
      { name: "Profile & Catalog Journeys (6 journeys)", status: "pass", durationMs: 16600, step: "6/6 passed" },
    ],
    aiPrompt: `Summarize the test coverage and performance metrics of clean E2E run-9839 (commit a12d844, 13/13 passing).`,
  },
  {
    id: "run-9838",
    type: "integration",
    status: "pass",
    passed: 25,
    failed: 0,
    total: 25,
    coveragePct: 88.9,
    durationMs: 13800,
    startedAt: Date.now() - 210 * 60000,
    commitSha: "a12d844",
    failureLayer: "None — All 25 API Endpoints Passed",
    stackTrace: `Supertest Suite Summary (run-9838 — commit a12d844):\n  ✓ 25 passed (13.8s)\n  API Endpoint Coverage: 88.9%`,
    testCases: [
      { name: "Auth & Session Endpoints (6 APIs)", status: "pass", durationMs: 2400, step: "6/6 passed" },
      { name: "Order & Checkout Endpoints (4 APIs)", status: "pass", durationMs: 3600, step: "4/4 passed" },
      { name: "Payment, User & Catalog Endpoints (15 APIs)", status: "pass", durationMs: 7800, step: "15/15 passed" },
    ],
    aiPrompt: `Compare integration run-9838 (a12d844, 25/25 pass) with run-9841 (cmvs3749, 23/25 pass) to identify what regressed.`,
  },
  {
    id: "run-9837",
    type: "unit",
    status: "pass",
    passed: 144,
    failed: 0,
    total: 144,
    coveragePct: 84.5,
    durationMs: 3900,
    startedAt: Date.now() - 240 * 60000,
    commitSha: "a12d844",
    failureLayer: "None — All 144 Unit Tests Passed",
    stackTrace: `PASS server/src/services/__tests__/* (run-9837 — commit a12d844)\n  Test Suites: 5 passed, 5 total\n  Tests:       144 passed, 144 total\n  Time:        3.9s`,
    testCases: [
      { name: "All 5 Service Unit Suites (144 tests)", status: "pass", durationMs: 3900, step: "144/144 passed" },
    ],
    aiPrompt: `Review unit test run-9837 (144/144 passing) and suggest tests for the remaining uncovered branches in notification.service.js.`,
  },
  {
    id: "run-9836",
    type: "unit",
    status: "fail",
    passed: 136,
    failed: 8,
    total: 144,
    coveragePct: 76.4,
    durationMs: 4100,
    startedAt: Date.now() - 360 * 60000,
    commitSha: "f03b291",
    failureLayer: "Unit (Jest — Order & User Services)",
    stackTrace: `FAIL server/src/services/__tests__/order.service.test.js\n  ● 6 tax calculation & discount rounding assertions failed\nFAIL server/src/services/__tests__/user.service.test.js\n  ● 2 profile validation assertions failed`,
    testCases: [
      { name: "order.service.test.js — tax rounding", status: "fail", durationMs: 920, step: "6 failed" },
      { name: "user.service.test.js — profile validation", status: "fail", durationMs: 640, step: "2 failed" },
    ],
    aiPrompt: `Analyze historical unit test failure in run-9836 (commit f03b291, 8 failed tests).`,
  },
  {
    id: "run-9835",
    type: "integration",
    status: "fail",
    passed: 20,
    failed: 5,
    total: 25,
    coveragePct: 74.1,
    durationMs: 15100,
    startedAt: Date.now() - 420 * 60000,
    commitSha: "f03b291",
    failureLayer: "Integration (Middleware/Auth & Database)",
    stackTrace: `FAIL server/src/tests/integration.test.js (run-9835 — commit f03b291)\n  ● 3 Auth Middleware JWT expiration failures\n  ● 2 Order Database transaction failures`,
    testCases: [
      { name: "Middleware JWT Verification (3 endpoints)", status: "fail", durationMs: 1800, step: "401 Unauthorized regression" },
      { name: "Order Checkout Transaction (2 endpoints)", status: "fail", durationMs: 2900, step: "500 Database error" },
    ],
    aiPrompt: `Analyze historical integration test failure in run-9835 (commit f03b291, 5 failed endpoints).`,
  },
];

export const MOCK_AI_STATS = {
  aiGenerated: 38,
  aiRepaired: 12,
  gaps: 3, // Matches: 2 uncovered APIs + 1 completely untested notification.service.js module
};

/**
 * Snapshot-aware Demo Showcase data builder so switching Snapshot Dropdown in Header
 * dynamically updates the entire dashboard state (e.g. a12d844 = READY TO RELEASE).
 */
export function getDemoShowcaseBySnapshot(snapshotId = "cmvs3749") {
  const normId = String(snapshotId || "cmvs3749").slice(0, 8);

  if (normId === "a12d844") {
    const cleanPillars = {
      unit: {
        ...MOCK_DEMO_PILLARS.unit,
        totalTests: 144,
        passedTests: 144,
        failedTests: 0,
        passRate: 100.0,
        durationMs: 3900,
        avgDurationMs: 27,
        coverageMetrics: { lines: 86.2, branches: 79.4, functions: 91.0, statements: 87.0 },
        lowCoverageItems: [],
      },
      integration: {
        ...MOCK_DEMO_PILLARS.integration,
        totalTests: 27,
        passedTests: 27,
        failedTests: 0,
        passRate: 100.0,
        durationMs: 13800,
        avgDurationMs: 511,
        coverageMetrics: { lines: 82.5, branches: 78.0, functions: 86.0, statements: 83.1, apiEndpoint: 100.0, uncoveredApis: 0, totalApis: 27 },
        lowCoverageItems: [],
        failureDistribution: { route: 0, middlewareAuth: 0, controller: 0, database: 0 },
      },
      system: {
        ...MOCK_DEMO_PILLARS.system,
        totalTests: 13,
        passedTests: 13,
        failedTests: 0,
        flakyTests: 0,
        passRate: 100.0,
        durationMs: 44100,
        avgDurationMs: 3392,
        coverageMetrics: { lines: 78.0, flow: 78.0 },
        failureDistribution: { selectorNotFound: 0, networkTimeout: 0, assertion: 0, flaky: 0 },
      },
    };

    const cleanMatrix = MOCK_TRACE_MATRIX_ROWS.map((row) => ({
      ...row,
      unit: { ...row.unit, status: "pass", failed: 0, passed: row.unit.total || 12, total: row.unit.total || 12, label: `${row.unit.total || 12}/${row.unit.total || 12} passed` },
      integration: { ...row.integration, status: "pass", failed: 0, passed: row.integration.total || 3, total: row.integration.total || 3, label: `${row.integration.total || 3}/${row.integration.total || 3} endpoints` },
      system: { ...row.system, status: "pass", failed: 0, passed: row.system.total || 2, total: row.system.total || 2, label: `${row.system.total || 2}/${row.system.total || 2} journeys` },
      rootCause: {
        diagnosis: "All layers verified & passing consistently in release candidate a12d844.",
        suspectLayer: "none",
        summary: "Stable",
      },
    }));

    return {
      pillars: cleanPillars,
      matrixRows: cleanMatrix,
      recentRuns: MOCK_RECENT_RUNS.filter((r) => r.commitSha === "a12d844").concat(MOCK_RECENT_RUNS.filter((r) => r.commitSha !== "a12d844")),
      trendSeries: MOCK_TREND_SERIES.map((pt, idx) =>
        idx === MOCK_TREND_SERIES.length - 1
          ? { ...pt, unitCoverage: 86.2, integrationCoverage: 100.0, systemCoverage: 78.0, overallCoverage: 88.1, passRate: 100.0 }
          : pt
      ),
      aiStats: { aiGenerated: 44, aiRepaired: 15, gaps: 0 },
      healthDelta: 6.4,
    };
  }

  if (normId === "f03b291") {
    const legacyPillars = {
      unit: {
        ...MOCK_DEMO_PILLARS.unit,
        totalTests: 144,
        passedTests: 136,
        failedTests: 8,
        passRate: 94.4,
        durationMs: 4100,
        coverageMetrics: { lines: 76.4, branches: 68.0, functions: 80.2, statements: 77.0 },
      },
      integration: {
        ...MOCK_DEMO_PILLARS.integration,
        totalTests: 25,
        passedTests: 20,
        failedTests: 5,
        passRate: 80.0,
        durationMs: 15100,
        coverageMetrics: { lines: 70.1, branches: 63.5, functions: 74.0, statements: 71.2, apiEndpoint: 74.1, uncoveredApis: 2, totalApis: 27 },
        failureDistribution: { route: 0, middlewareAuth: 3, controller: 0, database: 2 },
      },
      system: {
        ...MOCK_DEMO_PILLARS.system,
        totalTests: 13,
        passedTests: 8,
        failedTests: 5,
        flakyTests: 2,
        passRate: 61.5,
        durationMs: 52400,
        coverageMetrics: { lines: 59.0, flow: 59.0 },
        failureDistribution: { selectorNotFound: 2, networkTimeout: 2, assertion: 1, flaky: 2 },
      },
    };

    return {
      pillars: legacyPillars,
      matrixRows: MOCK_TRACE_MATRIX_ROWS,
      recentRuns: MOCK_RECENT_RUNS.filter((r) => r.commitSha === "f03b291").concat(MOCK_RECENT_RUNS.filter((r) => r.commitSha !== "f03b291")),
      trendSeries: MOCK_TREND_SERIES,
      aiStats: { aiGenerated: 29, aiRepaired: 6, gaps: 7 },
      healthDelta: -4.8,
    };
  }

  return {
    pillars: MOCK_DEMO_PILLARS,
    matrixRows: MOCK_TRACE_MATRIX_ROWS,
    recentRuns: MOCK_RECENT_RUNS,
    trendSeries: MOCK_TREND_SERIES,
    aiStats: MOCK_AI_STATS,
    healthDelta: 4.2,
  };
}

export function getEmptyMockData() {
  return {
    matrix: [],
    trend: [],
    recentRuns: [],
    aiStats: { aiGenerated: 0, aiRepaired: 0, gaps: 0 },
  };
}
