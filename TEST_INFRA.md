# CovAI- Test Infrastructure & E2E Resilience Architecture
## Prisma v7 Initialization & Express Controller Mocking Resilience

## Overview
This document specifies the testing architecture, 4-tier methodology, runner commands, and quality thresholds for **Test Resilience against Prisma v7 Initialization Errors and Null Request Body Destructuring in Express Controllers**.

The CovAI- platform automatically synthesizes and executes unit tests for complex Express and database applications. This test infrastructure guarantees that:
1. Deep database client dependencies (`@prisma/client` and database singletons) are transitively detected, mocked with hoisting-safe in-memory proxies, and protected by pre-flight runner fallbacks.
2. Controller test fixtures are structured with non-null request and chained response objects (`createMockReqResNext`), eliminating `TypeError: Cannot destructure property ... of req.body as it is null` across AI prompt generation, suggestion generation, and AST test healing.

---

## Architecture & Layers

The resilience test harness exercises the four operational layers of the CovAI- test generation and execution pipeline:

```
┌────────────────────────────────────────────────────────────────────────┐
│             Layer 1: Context Engineering & Dependency AST Traversal    │
│   - unitTestContextEngineering.service.js                              │
│     * Transitive 1-hop relative import traversal                       │
│     * Universal In-Memory Prisma Proxy Mock generation (Jest & Vitest) │
│     * Express Controller createMockReqResNext fixture contract         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│             Layer 2: AI Prompt Building & Generation Directives        │
│   - unitTestGenerator.service.js (Rule 7 Isolation & Rule 9 Fixtures)  │
│   - fullTestPromptBuilder.service.js                                   │
│     * Strict prompt mandates for file-top database mocking             │
│     * Explicit non-null req/res object initialization rules            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│             Layer 3: Runner Pre-flight & Global Fallback Harness       │
│   - runTestsJob.service.js (buildSetupContent)                         │
│     * Synthesis of covai-jest-setup.cjs with Fallback Prisma Client    │
│     * Interception of PrismaClientInitializationError in Prisma v7     │
│   - server/src/config/prisma.js & databaseSafetySetup.js               │
│     * Safe setPrismaClient proxy injection & empty DATABASE_URL guard │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│             Layer 4: AST Fixture Sanitization & Diagnostic Healing     │
│   - testSanitizer.service.js (healControllerFixturesWithAst)           │
│   - applyTestSuggestion.service.js (autoHealTestFailures)              │
│     * AST inspection of describe blocks accessing req.body/params      │
│     * Automatic beforeEach injection of complete req/res/next fixtures │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4-Tier Test Suite Structure (`server/src/tests/e2e_resilience_prisma_and_controllers.test.js`)

The test suite enforces full compliance with the 4-tier testing hierarchy defined in the project architecture:

### Tier 1: Feature Coverage & Core Mechanics (15 Tests)
- **Area A: Transitive & Hoisting-Safe Prisma Mocking (Features 1, 2, 3)**
  - `1.1 Transitive Prisma detection via 1-hop relative imports`: Verifies that when a controller imports a local service that references `@prisma/client`, `buildIsolationMockContracts` traverses relative imports, identifies `prisma-db`, and emits the universal mock preamble.
  - `1.2 Direct Prisma detection in source and test code`: Validates detection of direct `@prisma/client` and `../config/prisma` references.
  - `1.3 Hoisting-Safe Universal Prisma Mock syntax generation`: Ensures Jest suites receive `globalThis.__mockPrisma` with virtual mocks, while Vitest suites receive `vi.mock` bindings without Babel hoisting `ReferenceError` crashes.
  - `1.4 Universal Prisma Proxy mock runtime contract`: Verifies in-memory resolution of dynamic models, `$transaction` (array and callback modes), `$queryRaw`, `$executeRaw`, `$connect`, and `$disconnect`.
  - `1.5 assembleUnitTestContext contract integration`: Ensures parameter forwarding (`sourceFile`, `targetTestFile`, `rootDir`) and injection of prompt directives regarding Prisma v7 resilience.

- **Area B: Runner Pre-flight & Fallback Mocking (Features 4, 5, 6, 7)**
  - `1.6 buildSetupContent synthesizes covai-jest-setup.cjs`: Verifies pre-flight script generation containing `createPrismaProxy` wrapping `prismaPkg.PrismaClient`.
  - `1.7 Pre-flight setup intercepts stubbed PrismaClient initialization errors`: Simulates Prisma v7 package stub error ("did not initialize yet") and confirms instantiation returns a functional fallback proxy.
  - `1.8 Virtual mock registration covers relative singleton paths`: Validates registration of virtual mocks for `../lib/prisma`, `../../lib/prisma`, `../config/prisma`, `../../config/prisma`.
  - `1.9 Backend safety setup and setPrismaClient contract`: Verifies that `setPrismaClient` in `server/src/config/prisma.js` allows injecting safe mock proxies during test execution.
  - `1.10 Runner pre-flight Fallback Prisma constructor handling`: Confirms constructor parameters and options are safely accepted by the proxy wrapper.

- **Area C: Structured Controller Request/Response Mocking (Features 8, 9, 10, 11, 12)**
  - `1.11 createMockReqResNext provides safe non-null body and chained res methods`: Ensures `req.body` defaults to an empty object `{}` and `res` provides chained return-this mocks for `status`, `json`, `send`, `setHeader`, etc.
  - `1.12 Preamble generates createMockReqResNext when controller pattern is detected`: Verifies generator preamble includes Express controller mock helpers when `req, res, next` or controller filenames are detected.
  - `1.13 Non-Null Body and Express Controller Contract in AI Prompts`: Verifies `buildStandardUnitTestPrompt` Section 9 mandates `req = { body: {}, params: {}, ... }` before test execution.
  - `1.14 AST Fixture synthesis via healControllerFixturesWithAst`: Validates AST inspection of describe blocks and automatic insertion of `beforeEach` fixtures for controllers.
  - `1.15 healControllerFixturesWithAst preserves existing beforeEach`: Confirms existing `beforeEach` hooks are preserved and augmented with missing fixtures without syntax corruption.

### Tier 2: Boundary & Corner Cases (6 Tests)
- `2.1 createMockReqResNext with unusual or falsy overrides`: Confirms calling `createMockReqResNext(null)`, `createMockReqResNext({})`, or `createMockReqResNext({ body: null })` always results in an empty object `{}` rather than null, preventing destructuring TypeErrors.
- `2.2 Unconfigured DATABASE_URL`: Verifies that missing or unconfigured `DATABASE_URL` environment variables do not crash the runner harness or abort test execution.
- `2.3 Deeply nested unusual destructuring in controllers`: Exercises complex destructuring patterns (`const { items: [{ product: { id, price } = {} } = {}] = [] } = req.body;`) with default fixtures.
- `2.4 Vitest vs Jest framework differences`: Validates correct mocking syntax output (`vi.fn` vs `jest.fn`) across both target testing frameworks.
- `2.5 Resilient transitive dependency traversal`: Tests graceful handling of non-existent files and circular import chains without infinite recursion or crashes.
- `2.6 Concurrency and stress resilience`: Concurrently executes 50 queries and 20 parallel transactions across the Prisma proxy mock without deadlock.

### Tier 3: Cross-Feature Combinations (4 Tests)
- `3.1 Controller with both Prisma queries and req.body.items destructuring`: End-to-end simulation of a batch order controller executing atomic database operations and destructuring collection arrays.
- `3.2 Transitive Prisma detection coupled with AST controller fixture healing`: Exercises the full test healing pipeline from transitive AST dependency detection through AST controller fixture injection.
- `3.3 Express middleware next(err) chaining with Prisma error handling`: Verifies transaction errors are caught, forwarded to `next(err)`, and handled cleanly without unhandled promise rejections.
- `3.4 Mixed CommonJS and ESM syntax resilience`: Validates seamless detection and mocking of both `require()` and `import` syntax styles within the same project.

### Tier 4: Real-World Scenarios (4 Tests)
- `4.1 Real-World cartController scenario`: Full e-commerce cart workflow including `addItem` with collection validation, `getCart` with subtotal calculation, and `clearCart`.
- `4.2 Real-World orderCheckoutController scenario`: Multi-step checkout transaction verifying inventory availability, generating order records, and simulating atomic transaction rollback on stock conflict.
- `4.3 Real-World authRegistrationController scenario`: User authentication flow checking email uniqueness via `prisma.user.findUnique`, hashing passwords, and creating user records with conflict handling (409 Conflict).
- `4.4 End-to-end runner harness simulation with covai-jest-setup`: Validates syntax execution of synthesized `covai-jest-setup.cjs` and proves that uninitialized Prisma references resolve through the fallback proxy.

---

## Runner Commands

### 1. Execute Primary Resilience Test Suite
```powershell
npm --prefix server test -- src/tests/e2e_resilience_prisma_and_controllers.test.js
```

### 2. Execute Combined Runner Verification (Resilience + Concurrency Suites)
```powershell
npm --prefix server test -- src/tests/e2e_resilience_prisma_and_controllers.test.js src/tests/prismaConcurrencyAndTransactions.test.js
```

### 3. Run In Band (Debug / Trace Mode)
```powershell
node --experimental-vm-modules server/node_modules/jest/bin/jest.js --runInBand server/src/tests/e2e_resilience_prisma_and_controllers.test.js
```

---

## Quality Thresholds & Acceptance Status

| Tier | Metric | Target | Actual | Status |
|------|--------|--------|--------|--------|
| **Tier 1 (Area A)** | Transitive & Hoisting-Safe Prisma Mocking | >= 5 tests | 5 / 5 passing | **PASSED** |
| **Tier 1 (Area B)** | Runner Pre-flight & Fallback Mocking | >= 5 tests | 5 / 5 passing | **PASSED** |
| **Tier 1 (Area C)** | Structured Controller Req/Res Mocking | >= 5 tests | 5 / 5 passing | **PASSED** |
| **Tier 2** | Boundary & Corner Cases | >= 5 tests | 6 / 6 passing | **PASSED** |
| **Tier 3** | Cross-Feature Combinations | >= 3 tests | 4 / 4 passing | **PASSED** |
| **Tier 4** | Real-World Application Scenarios | >= 3 tests | 4 / 4 passing | **PASSED** |
| **Total Suite** | All Tiers Combined | 100% pass | **29 / 29 passing** | **PASSED** |
