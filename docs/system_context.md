# C4 Level 1 — System Context Components

## 1. Person

### Developer / QA Engineer
Role:
- Manages projects, triggers test execution, views coverage reports, and interacts with AI-generated suggestions.

Interactions with CovAI:
- Authenticates via Auth service.
- Imports GitHub repositories.
- Triggers test/coverage jobs.
- Views analysis results (CFG, Cyclomatic Complexity, AI suggestions).

## 2. CovAI System

Purpose:
- Automated testing, coverage analysis, and AI-driven code quality improvement platform.

Main responsibilities:
- Repository cloning and project ingestion.
- Automated test execution (Jest, Vitest, Cypress, Playwright).
- Coverage analysis and reporting.
- AI-powered code analysis and test generation (Gemini).
- Notification management.

## 3. External Systems

### GitHub
Purpose:
- Source code hosting and repository management.

Interaction:
- CovAI → GitHub: Clone repository (via `git clone`).
- GitHub → CovAI: Repository source code.

### Gemini / LLM
Purpose:
- AI-driven code analysis and test generation.

Interaction:
- CovAI → Gemini: Source code context, coverage metrics, CFG data.
- Gemini → CovAI: AI suggestions, generated test cases.

### Firebase Cloud Storage
Purpose:
- Object storage for project artifacts and coverage reports.

Interaction:
- CovAI ↔ Firebase: Upload/Download coverage artifacts and project snapshots.

### SMTP Service
Purpose:
- Email notification delivery (e.g., password reset).

Interaction:
- CovAI → SMTP: Send system notifications (e.g., password reset links).
- Implementation: Uses `nodemailer` with Gmail SMTP (configured via `EMAIL_USERNAME` and `EMAIL_APP_PASSWORD`).

### PostgreSQL
Purpose:
- Relational database for project metadata, snapshots, and analysis results.

Interaction:
- CovAI ↔ PostgreSQL: Read/Write project data, coverage results, and AI suggestions.

### Docker Execution Environment
Purpose:
- Isolated environment for running tests and analysis jobs.

Interaction:
- CovAI → Docker: Execute test/coverage jobs.
- Docker → CovAI: Test results and coverage artifacts.

---

## Verification Table

| Component | Exists in CovAI? | Evidence | Source File | Notes |
|---|---|---|---|---|
| Developer / QA Engineer | Yes | User interaction implied by auth/project routes. | `server/src/controllers/auth.controller.js` | Actor. |
| GitHub | Yes | API keys and service files present. | `.env`, `server/src/services/github.service.js` | Used for repo integration. |
| Docker Execution Environment | Yes | Docker configuration files present. | `docker-compose.yml`, `server/Dockerfile`, `server/src/services/dockerRunner.service.js` | Used for running services and test execution. |
| Google Gemini AI Service | Yes | API key and service file present. | `.env`, `server/src/services/gemini.service.js` | Used for AI features. |
| Firebase Cloud Storage | Yes | Storage bucket and config file present. | `.env`, `server/src/config/firebase.js` | Used for artifact storage. |
| Email Service / SMTP | Yes | Email credentials and service file present. | `.env`, `server/src/services/notification.service.js` | Used for notifications. |
| WebSocket / Socket.IO | No | NOT FOUND / NOT VERIFIED IN SOURCE CODE | N/A | |

## Testing Framework Interactions

| Framework | Detection | Execution | Coverage | Evidence |
|---|---|---|---|---|
| Jest | Yes | Yes | Yes | `server/src/utils/jestDetector.js` |
| Supertest | Yes | Yes | Yes | `server/src/services/supertestRunner.service.js` |
| Vitest | Yes | Yes | Yes | `server/src/services/vitestRunner.service.js` |
| Cypress | Yes | Yes | Yes | `server/src/utils/cypressDetector.js` |
| Playwright | Yes | Yes | Yes | `server/src/services/playwrightRunner.service.js` |

---

## Interactions for draw.io

| From | To | Interaction / Data | Direction | Evidence |
|---|---|---|---|---|
| Developer | CovAI | Login / Project Management | → | `auth.controller.js` |
| Developer | CovAI | Upload/Import Project | → | `project.controller.js` |
| CovAI | Developer | Test Results / Reports | → | `coverage.controller.js` |
| CovAI | GitHub | Clone Repository | → | `githubClone.service.js` |
| GitHub | CovAI | Source Code | → | `githubClone.service.js` |
| CovAI | Gemini | Code Context / Metrics | → | `gemini.service.js` |
| Gemini | CovAI | AI Suggestions / Tests | → | `aiSuggestion.service.js` |
| CovAI | Firebase | Store Artifacts | → | `upload.controller.js` |
| CovAI | SMTP | Send Notifications | → | `notification.service.js` |
| CovAI | PostgreSQL | Persist Data | ↔ | `prisma.config.ts` |

---

## Recommended Diagram

```text
                    [GitHub]
                       |
                       |
[Developer]  <-----> [CovAI System]  <-----> [Gemini / LLM]
                       |        |
                       |        |
                    [Firebase Storage]  [SMTP Service]
                       |        |
                       |        |
                 [PostgreSQL] [Docker]
