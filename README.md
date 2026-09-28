# COVAI – Software Testing and AI Chatbot Trustworthiness Evaluation System

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-v5.0-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![React](https://img.shields.io/badge/React-v19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Redis & BullMQ](https://img.shields.io/badge/Queue-Redis%20%26%20BullMQ-DC382D?logo=redis&logoColor=white)](https://bullmq.io/)
[![Docker](https://img.shields.io/badge/Sandbox-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini%202.5-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)

---

## 1. Project Title

**COVAI – Software Testing and AI Chatbot Trustworthiness Evaluation System**

---

## 2. Project Overview

**COVAI** is an AI-driven software quality platform that combines two complementary capabilities in a single engineering workflow:

1. **Automated Software Testing & Code Analysis**: Ingests source code, detects supported testing frameworks, executes tests in isolated sandbox environments, analyzes multi-level test coverage and code structure (CFG & Cyclomatic Complexity), and automatically generates additional unit, integration, and system tests.
2. **AI Chatbot Trustworthiness Evaluation**: Evaluates the trustworthiness, reliability, safety, and compliance of internal AI chatbots according to project-specific knowledge bases, business rules, API contracts, conversation context, and tool permissions.

The platform is designed for **developers, QA engineers, and AI engineers** who require verifiable, repeatable evidence of software and conversational agent quality. COVAI supports local ZIP archive uploads and direct GitHub repository imports, immutable source-code snapshots, distributed background jobs, interactive visual dashboards, and real-time event notifications.

COVAI initially focuses on **JavaScript and TypeScript** ecosystems and supports primary testing frameworks including **Jest, Vitest, Supertest, Playwright, and Cypress**.

---

## 3. Project Background and Motivation

Software testing is essential for ensuring software quality. However, as projects grow larger and more complex, development teams face escalating difficulties in writing, executing, maintaining, and analyzing automated test suites. Engineers often must manually inspect coverage reports, identify insufficiently tested logic, navigate complex control flow paths, and construct edge-case test suites from scratch.

Modern web architectures employ multiple testing levels and frameworks:

- **Unit Testing**: Isolated module validation via **Jest** and **Vitest**.
- **Integration Testing**: API endpoint and database contract validation via **Supertest**.
- **End-to-End & System Testing**: Full browser flow validation via **Playwright** and **Cypress**.

Simultaneously, web applications are rapidly integrating **internal AI chatbots** for user assistance, context-aware guidance, and tool/API execution. These conversational agents cannot be evaluated solely on generic benchmarks or the model's base name; they must adhere to project-specific business logic, maintain conversational context, respect privacy boundaries, refuse unauthorized queries appropriately, and trigger internal tools safely.

### Motivation

- **Reduce manual effort** in software testing, test execution, and coverage analysis.
- **Pinpoint blind spots** by identifying insufficiently tested, high-risk, and cyclomatically complex source-code areas.
- **Harness Generative AI** to assist engineers in synthesizing robust test skeletons and runnable test cases.
- **Unify multi-level, multi-framework testing** (Unit, Integration, E2E) under a single platform.
- **Evaluate internal AI chatbots** against project-specific ground truth, documentation, and confirmed business rules.
- **Deliver verifiable evidence**, quantifiable metrics, risk indicators, and actionable recommendations.
- **Automate continuous analysis** through frictionless GitHub integration and webhooks.

---

## 4. Problem Statement

Modern software teams face two interconnected quality bottlenecks:

### 1. Fragmented Automated Testing and Incomplete Coverage

Automated testing is frequently split across different testing levels and incompatible tools. Developers must manually trigger executions, parse isolated coverage outputs, locate untested branches, map complex execution flows, and author additional test cases. As codebases scale and evolve rapidly, maintaining high coverage and defect detection becomes expensive and error-prone.

### 2. Lack of Contextual Trustworthiness Evaluation for Internal AI Chatbots

Web applications increasingly deploy internal AI chatbots for customer guidance, internal knowledge retrieval, and tool-assisted workflow execution. The reliability of these chatbots cannot be judged merely by the foundational model (e.g., GPT-4 or Gemini) because their operational behavior is heavily governed by:

- System prompts and persona definitions
- Domain knowledge and internal RAG retrieval mechanisms
- Dynamic conversation context and memory retention
- API specifications, parameters, and tool execution privileges
- Refusal logic for restricted, unsafe, or out-of-scope queries

Two chatbots powered by the identical base model can exhibit vastly disparate reliability depending on these system components. Broad generic LLM benchmarks fail here because internal chatbots operate in closed application domains where **source code, API specifications, and business rules serve as the authoritative ground truth**.

> **The Solution**: COVAI bridges this divide by providing a unified engineering platform that analyzes software testing health while rigorously evaluating whether internal AI chatbots behave **correctly, faithfully, safely, consistently, and within policy boundaries**.

---

## 5. Proposed Solution & Engineering Architecture

COVAI provides an end-to-end, reproducible quality pipeline:

```text
                               ┌────────────────────────────────────────────────────────┐
                               │                    COVAI PLATFORM                      │
                               └────────────────────────────────────────────────────────┘
                                                            │
                      ┌─────────────────────────────────────┴─────────────────────────────────────┐
                      ▼                                                                           ▼
        ┌───────────────────────────┐                                               ┌───────────────────────────┐
        │  SOFTWARE TESTING ENGINE  │                                               │ CHATBOT EVALUATION ENGINE │
        └───────────────────────────┘                                               └───────────────────────────┘
                      │                                                                           │
        ┌─────────────┼─────────────┐                                               ┌─────────────┼─────────────┐
        ▼             ▼             ▼                                               ▼             ▼             ▼
   [Framework    [Isolated     [CFG & CC                                        [Profile &     [Scenario &   [Trust Scoring
   Detection]    Sandbox]      Analysis]                                        Ground Truth]  Benchmarks]   & Reporting]
        │             │             │                                               │             │             │
        └─────────────┬─────────────┘                                               └─────────────┬─────────────┘
                      ▼                                                                           ▼
        ┌───────────────────────────┐                                               ┌───────────────────────────┐
        │ AI Test Case Generation   │                                               │ Trustworthiness Auditing  │
        │ (Skeleton & Runnable)     │                                               │ (Safety, Tool, Refusal)   │
        └───────────────────────────┘                                               └───────────────────────────┘
                      │                                                                           │
                      └─────────────────────────────────────┬─────────────────────────────────────┘
                                                            ▼
                                        ┌───────────────────────────────────────┐
                                        │  Interactive Evidence & Reports Hub   │
                                        └───────────────────────────────────────┘
```

1. **Source Ingestion & Immutable Snapshots**: Source code is uploaded via local archive (ZIP/RAR) or imported directly via GitHub. COVAI computes cryptographic checksums and stores an immutable code snapshot.
2. **Framework Detection & Sandbox Execution**: Scans the project manifest and configuration files to auto-detect testing frameworks (Jest, Vitest, Supertest, Playwright, Cypress). Tests run inside isolated Docker containers with strict CPU, memory, and timeout limits.
3. **Multi-Level Coverage & AST Structural Analysis**: Collects line, branch, function, and statement metrics. Parses JavaScript/TypeScript AST via Babel to generate **Control Flow Graphs (CFG)** and calculate **Cyclomatic Complexity (CC)** per function.
4. **AI-Assisted Test Synthesis**: Combines AST structural insights, execution failures, and uncovered branches to prompt Gemini AI to generate structured test skeletons or complete runnable tests.
5. **Chatbot Evaluation Profile & Scenarios**: Ingests project business documents, API contracts, and expected behavioral constraints to generate benchmark evaluation scenarios across:
   - **Knowledge Q&A**: Domain-specific precision and faithfulness.
   - **Usage Guidance**: Step-by-step adherence to application features.
   - **Action & Tool Execution**: Valid argument extraction and tool calling safety.
6. **Trustworthiness Scoring**: Evaluates agent responses across 9 core dimensions: _Correctness, Faithfulness, Relevance, Consistency, Context Retention, Safety, Privacy, Appropriate Refusal, and Tool Execution Accuracy_.

---

## 6. Core System Capabilities

### 📦 1. Project Management & Source Ingestion

- Upload source code archives (ZIP / RAR) with archive-bomb and malicious path filtering.
- Direct GitHub repository import with branch selection and OAuth token security.
- Version Hub / Immutable Snapshots: tracks code revisions, commit hashes, and historical analysis.

### 🧪 2. Multi-Framework Test Execution & Coverage

- Automatic framework discovery: **Jest**, **Vitest**, **Supertest**, **Playwright**, and **Cypress**.
- Isolated execution inside ephemeral Docker sandboxes preventing host pollution.
- Real-time streaming logs (stdout/stderr) and execution timers.
- Granular coverage breakdowns:
  - Global project-level coverage
  - Per-file coverage
  - Per-function coverage & invocation hits
  - Line-by-line Monaco editor code gutter visualizations (Covered, Uncovered, Branch Partial)

### 🕸️ 3. Source Code Structural Analysis (CFG & CC)

- AST parsing using `@babel/parser` and traversal with `@babel/traverse`.
- Interactive **Control Flow Graph (CFG)** node-link visualization.
- **Cyclomatic Complexity (CC)** metric calculation to highlight high-risk, deeply nested functions.

### 🤖 4. AI-Powered Test Case Generation

- **Test Skeleton Mode**: Produces syntactically valid test suites with targeted assertion outlines and edge cases.
- **Runnable Implementation Mode**: Generates full, executable test implementations with mock fixtures and expectations.
- **Coverage Gap Targeting**: Directly targets functions with high Cyclomatic Complexity and 0% branch coverage.
- In-browser code review, inline diffing, and one-click export into project files.

### 🛡️ 5. AI Chatbot Trustworthiness Evaluation

- **Domain-Specific Evaluation Profiles**: Constructs evaluation rules from API specifications, OpenAPI specs, system prompts, and business rules.
- **Automated Benchmark Scenarios**: Synthesizes adversarial and standard test prompts covering edge cases, hallucination traps, and prompt injection attempts.
- **Multi-Dimensional Metrics**:
  - **Correctness & Faithfulness**: Verifies answers against project knowledge without hallucination.
  - **Relevance & Conciseness**: Eliminates superfluous or misleading responses.
  - **Context Retention**: Validates multi-turn memory coherence.
  - **Safety & Privacy**: Audits resistance against PII leakage and malicious prompt jailbreaks.
  - **Appropriate Refusal**: Validates that out-of-scope or unauthorized requests are gracefully declined.
  - **Tool & API Calling**: Validates schema compliance, parameter accuracy, and privilege constraints.

### 📊 6. Evidence, Dashboard & Interactive Reporting

- Comprehensive quality scorecards (Coverage, Maintainability, Performance, Security).
- Executive debug reports and AI recommendations.
- Interactive VS Code-like IDE interface with split views, syntax highlighting, and Monaco coverage glyphs.
- Skeleton loading states and design-token-compliant interfaces matching `COVAI_FRONTEND_AGENT_RULES.md`.

### ⚡ 7. Asynchronous Task Queue & GitHub Automation

- Powered by **Redis & BullMQ** for background job orchestration.
- Granular job states: `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELED`.
- Real-time job progress notifications via Socket.IO.
- GitHub webhook triggers to automatically re-run analysis upon new pull requests or commits.

---

## 7. System Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND CLIENT (REACT)                         │
│  Monaco Editor • ReactFlow CFG • Coverage Dashboards • Notification UI │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ HTTP / REST / WebSocket
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND API (EXPRESS.JS)                        │
│   Auth & RBAC • Project Manager • Ingestion Engine • Analysis Router   │
└────────┬───────────────────────────┬───────────────────────────┬───────┘
         │                           │                           │
         ▼                           ▼                           ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│ POSTGRESQL / ORM │       │ REDIS & BULLMQ   │       │ GOOGLE GEMINI    │
│ Neon Database    │       │ Job Queue Worker │       │ Generative AI    │
│ Prisma Schema    │       │ Distributed Task │       │ Test & Trust Eval│
└──────────────────┘       └─────────┬────────┘       └──────────────────┘
                                     │
                                     ▼
                   ┌──────────────────────────────────┐
                   │       DOCKER SANDBOX RUNNER      │
                   │ Isolated Testing Container       │
                   │ Jest / Vitest / Playwright / Cy  │
                   └──────────────────────────────────┘
```

---

## 8. Technology Stack

| Domain              | Technology / Library                                       | Purpose                                                 |
| :------------------ | :--------------------------------------------------------- | :------------------------------------------------------ |
| **Frontend UI**     | React 19, Vite, Tailwind CSS v4                            | High-performance, token-driven web client               |
| **Editor & Graphs** | Monaco Editor (`@monaco-editor/react`), Lucide React       | In-browser code editing, gutter glyphs, iconography     |
| **Backend API**     | Node.js v20+, Express.js v5                                | REST API gateway, authentication, and orchestration     |
| **Database & ORM**  | PostgreSQL (Neon), Prisma v7                               | Relational persistence, schema migrations, and indexing |
| **Task Queue**      | Redis 7, BullMQ                                            | Asynchronous analysis pipelines and job workers         |
| **Code Analysis**   | Babel Parser (`@babel/parser`, `@babel/traverse`), Esprima | AST traversal, CFG construction, Cyclomatic Complexity  |
| **Testing Engines** | Jest, Vitest, Supertest, Playwright, Cypress               | Unit, Integration, and End-to-End test runners          |
| **Sandbox Runtime** | Docker Engine                                              | Secure containerized execution environment              |
| **AI Evaluation**   | Google Gemini 2.5 (`@google/generative-ai`)                | Test case generation, reasoning, and chatbot auditing   |
| **Security**        | JWT, bcryptjs, Helmet, Zod, express-rate-limit             | Input validation, token encryption, and rate limiting   |

---

## 9. Database Schema Overview

The system uses a normalized PostgreSQL schema managed with Prisma ORM:

- **`User`**: Account identity, GitHub OAuth references, token tracking, and permissions.
- **`Project`**: Repository configurations, framework flags (`hasJest`, `hasVitest`, `hasPlaywright`), and ownership.
- **`ProjectSnapshot`**: Immutable state of a project at an upload/commit, with checksum and storage path.
- **`Job` / `JobLog` / `JobOutput`**: Distributed execution history, status flags, stdout/stderr streams, and metrics.
- **`CoverageSummary` / `CoverageFile` / `CoverageFunction`**: Normalized coverage percentages and hit counters.
- **`Cfg` / `Cyclomatic`**: Serialized control flow graphs and complexity scores mapped to functions.
- **`AiSuggestion` / `AiTest` / `AiTestResult`**: AI-generated suggestions, runnable test suites, and validation logs.
- **`QualityReport` / `Vulnerability`**: Comprehensive quality audit scores and security scan results.
- **`Notification`**: Real-time event notifications for completed analysis jobs.

---

## 10. API Specification Overview

### Authentication

```http
POST /api/auth/register            # Register user
POST /api/auth/login               # Authenticate & obtain JWT
POST /api/auth/logout              # Terminate session
POST /api/auth/forgotPassword      # Request reset token
POST /api/auth/resetPassword/:token# Reset password
GET  /api/auth/github/callback     # OAuth GitHub callback
GET  /api/auth/github/repositories # Fetch accessible GitHub repos
```

### Projects & Repository Ingestion

```http
GET    /api/projects               # List all user projects
POST   /api/projects               # Create project metadata
GET    /api/projects/:id           # Retrieve project details
DELETE /api/projects/:id           # Delete project and storage
POST   /api/projects/:id/upload-zip# Ingest ZIP/RAR source archive
POST   /api/projects/:id/import-github # Import from GitHub repository
GET    /api/projects/:id/snapshots # List snapshots & version checkpoints
```

### Pipelines & Jobs

```http
POST /api/projects/:id/run-analysis# Dispatch full analysis pipeline
GET  /api/job/:projectId/jobs      # List jobs for project
GET  /api/job/:jobId               # Get status, progress, and logs
```

### Coverage & AST Analytics

```http
GET /api/coverage/:snapshotId/summary   # Overall coverage stats
GET /api/coverage/:snapshotId/files     # File-level coverage list
GET /api/coverage/:snapshotId/functions # Function-level coverage hits
GET /api/projects/:id/cfg               # Control Flow Graphs
GET /api/projects/:id/cc                # Cyclomatic Complexity metrics
```

### AI Generation & Trustworthiness Evaluation

```http
GET  /api/ai-suggestions?projectId=:id     # Fetch AI code suggestions
POST /api/ai-suggestions/refresh/:projectId# Refresh recommendations
POST /api/projects/:id/ai-tests            # Generate test skeletons
POST /api/projects/:id/ai/generate-full-test # Generate runnable tests
GET  /api/projects/:id/ai/tests            # Retrieve generated tests
```

---

## 11. Security & Isolation Architecture

- **Docker Sandbox Containment**: Test suites execute inside ephemeral, unprivileged Docker containers with network and resource boundaries to prevent arbitrary code execution on host infrastructure.
- **Malicious Archive Protection**: Uploaded archives are inspected against zip-slip attacks, directory traversal payloads, archive bombs, and restricted system files (`.env`, `.pem`, `.key`, `id_rsa`).
- **Encrypted Secrets**: Sensitive tokens (GitHub Access Tokens) are encrypted at rest using AES-256-GCM.
- **Robust API Hardening**: Every endpoint is protected with `helmet`, `express-rate-limit`, strict Zod schema validation, and stateless JWT authentication.

---

## 12. Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20.x or higher)
- [Docker](https://www.docker.com/) and Docker Compose
- [Redis](https://redis.io/) (v7+ or via Docker)
- PostgreSQL database (or [Neon Postgres](https://neon.tech/))
- Google Gemini API Key

### 🚀 Running with Docker Compose (Recommended)

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Nhthuando/CovAI-.git
   cd CovAI-
   ```

2. **Configure environment variables:**
   Create `./server/.env` based on the template below:

   ```env
   PORT=5000
   DATABASE_URL="postgresql://user:password@host/covai?sslmode=require"
   JWT_SECRET="your-secure-jwt-secret"
   REDIS_URL="redis://redis:6379"
   GEMINI_API_KEY="your-gemini-api-key"
   CLIENT_URL="http://localhost:5173"
   ```

3. **Start services:**
   ```bash
   docker compose up --build
   ```

   - **Frontend**: `http://localhost:5173`
   - **Backend API**: `http://localhost:5000`
   - **Redis**: `localhost:6379`

---

### 💻 Manual Local Development Setup

#### 1. Backend Setup

```bash
cd server
npm install
npx prisma generate
npx prisma db push
npm run dev
```

#### 2. Frontend Setup

```bash
cd ../client
npm install
npm run dev
```

Visit `http://localhost:5173` to access the COVAI platform.

---

## 13. Project & Capstone Information

- **Project Title**: COVAI – Software Testing and AI Chatbot Trustworthiness Evaluation System
- **Academic Context**: Capstone Project 2026 – International School (C1SE.30)
- **Primary Domain**: Software Engineering, Automated Quality Assurance, Static Analysis & Trustworthy Generative AI.

---

## 14. License

This project is developed for educational, academic, and research purposes. All rights reserved © 2026 COVAI Development Team.
