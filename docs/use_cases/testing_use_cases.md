# Testing Use Cases Specification

## Common Information
- **Actors**: Developer, QA, AI Engineer
- **Pre-conditions**: 
  - User authenticated.
  - Project source code available in system.
- **Business Rules**: 
  - Supported frameworks: Jest, Vitest, Supertest, Playwright, Cypress.
  - Execution must occur in isolated Docker environment.

---

## UC-04: Detect Testing Framework
- **Description**: Detect testing framework used by project.
- **Trigger**: User opens testing function, clicks "Run Detect".
- **Main Flow**:
  1. Access project.
  2. Open testing interface.
  3. Click "Run Detect".
  4. System scans source code for test files/configs.
  5. System identifies frameworks and associated files.
  6. Display results.
- **Exception**: No test files detected -> Display "No test files were detected in the project."

---

## UC-05: Run Test Analysis
- **Description**: Execute automated tests for project.
- **Pre-condition**: Supported framework and test files detected.
- **Trigger**: User selects "Run Test Analysis".
- **Main Flow**:
  1. Access project.
  2. Select "Run Test Analysis".
  3. Confirm request.
  4. System prepares isolated Docker environment.
  5. System installs dependencies and executes tests.
  6. System collects output/logs.
  7. Display results.
- **Exceptions**:
  - Source code unavailable -> Display error.
  - No supported framework -> Display error.

---

## UC-06: Run Integration Analysis
- **Description**: Execute integration tests for project.
- **Pre-condition**: Supported integration testing framework available.
- **Trigger**: User selects "Integration Testing" -> "Run Integration Analysis".
- **Main Flow**:
  1. Access project.
  2. Select "Integration Testing".
  3. Select "Run Integration Analysis".
  4. Confirm request.
  5. System prepares isolated Docker environment.
  6. System installs dependencies and executes integration tests.
  7. System collects output/logs.
  8. Display results.
- **Exceptions**:
  - No integration test files -> Display "No integration test files were detected."
  - Dependency installation failure -> Display error.