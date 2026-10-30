# COVAI Architecture Module — Implementation Analysis

## 1. Introduction

### 1.1 Objective and Purpose
This document provides a comprehensive, code-verified technical analysis of the **Architecture** module within the **COVAI Studio** software testing and quality platform. Prepared as part of the official Capstone technical documentation for the COVAI system, this report details the architectural design, frontend visualization engine, backend static analysis pipeline, data modeling, role classification heuristics, dependency extraction algorithms, and asynchronous job workflows that power the interactive Architecture Network Graph.

The primary objective of the Architecture module is to provide software engineers, QA leads, and architects with an automated, static representation of an imported codebase's internal structure. It reveals how files, functions, and modules interact, identifies entry points and architectural layers, computes structural metrics (lines of code, function counts, incoming/outgoing dependencies), and surfaces AI-assisted architectural summaries on demand without executing untrusted repository code.

### 1.2 Scope of Analysis
The scope of this investigation includes:
1. **Frontend Presentation and Interaction Engine:** Component architecture, DAG graph visualization with Dagre, dynamic SVG edge routing, canvas pan/zoom mechanics, multi-select role filtering, domain/module partitioning, inspector drawer inspection, and responsive layout state management.
2. **Backend Analysis Pipeline:** The multi-stage static analysis pipeline triggered by user request, including file discovery, AST parsing via Babel, function and method extraction, file role and domain inference, internal and external dependency resolution, and layer/flow construction.
3. **AI Architecture Summarization:** Integration with Google Gemini generative models to generate architectural file summaries and per-function purpose descriptions, including token truncation, JSON contract normalization, and fallback mechanisms.
4. **State Management, Jobs, and Persistence:** Job queueing via Redis and BullMQ, database persistence via Prisma ORM (PostgreSQL), snapshot isolation, and client polling lifecycles.
5. **Screenshot-to-Implementation Audit:** Rigorous cross-comparison between visual evidence captured in system screenshots and the underlying source code implementation.

### 1.3 Methodology and Verification Standards
In strict accordance with the Capstone verification guidelines:
- Every architectural claim, data flow, algorithm, and UI behavior documented herein is verified directly against active source files in the repository.
- File paths and line numbers are recorded for every verified statement.
- Unverified behaviors or incomplete features are explicitly classified as `UNVERIFIED` or `PARTIALLY IMPLEMENTED`.
- Implementation statuses are categorized strictly using the four approved levels: `IMPLEMENTED`, `PARTIALLY IMPLEMENTED`, `NOT IMPLEMENTED`, and `UNVERIFIED`.
- Screenshot observations are explicitly separated from verified code facts; numeric values visible in screenshots (e.g., 339 files, 10 dependencies, 2086 functions) are treated as snapshot-specific instance data rather than hardcoded system constants.

---

## 2. Module Overview

### 2.1 Role in COVAI Studio
Within the COVAI Studio integrated workspace (`client/src/components/dashboard/Layout.jsx`), the Architecture module is accessible through the primary **Activity Bar** via the `Network` icon (`id: "architecture"`). When selected, the IDE renders `ProjectArchitecturePanel.jsx` as the central workspace viewport, allowing developers to visually explore code dependencies alongside other activities such as the File Explorer, Git Control, Coverage Analysis, and Snapshots & Jobs.

```
+----------------------------------------------------------------------------------------------------+
| Header: CovAI Studio / {project.name} / {activeFilePath}                                           |
+----+-----------------------------------------------------------------------------------------------+
| A  | Breadcrumb: Architecture / Network Graph  [Status Badge] [Progress Bar]    [Overview|Module]  |
| c  | Sub-bar: [Stats Summary | Domain Pills]  [Role Filters: Other, Test, Utility, Config, Route]   |
| t  +-------------------------------------------------------------+---------------------------------+
| i  |                                                             | Inspector Drawer (Resizable)    |
| v  |              INTERACTIVE GRAPH CANVAS                       | - Role & Domain Tags            |
| i  |                                                             | - File Name & Relative Path     |
| t  |   +-------------------+          +-------------------+      | - LOC, Fn, Out, In Metrics      |
| y  |   | File Node Card    | -------> | File Node Card    |      | - AI Architecture Summary       |
|    |   +-------------------+          +-------------------+      | - Functions & Methods (List)    |
| B  |                                                             | - Outgoing Dependencies (Jump)  |
| a  |                                                             | - Incoming Dependencies (Jump)  |
| r  +-------------------------------------------------------------+---------------------------------+
|    | Floating Controls: [-] [+] [100%] [Fit] | [Horizontal/TB] [Scale]                             |
+----+-----------------------------------------------------------------------------------------------+
```

### 2.2 Core Capabilities
1. **Zero-Execution Static AST Parsing:** Uses `@babel/parser` to parse JavaScript/TypeScript files into Abstract Syntax Trees without executing untrusted repository code.
2. **Deterministic Topological Graph Layout:** Uses `dagre` (graphlib) to calculate directed acyclic graph layouts with configurable rank directions (Left-to-Right `LR` vs. Top-to-Bottom `TB`).
3. **Dual Exploration Modes:**
   - **System Overview:** Displays the entire project graph with global metrics (files, internal dependencies, functions).
   - **Module View:** Partitions nodes by domain/module chips, allowing developers to isolate and inspect specific functional domains (e.g., `handlers`, `tools`, `client`, `scripts`).
4. **Context-Aware Dynamic Filtering:** Real-time multi-select filtering by file role (`Route`, `Controller`, `Service`, `Component`, `Page`, `Hook`, `Model`, `Validator`, `Utility`, `Config`, `Test`, `Other`).
5. **Deep Node Inspector:** Displays granular file metrics, function signatures, exported statuses, jumpable outgoing imports, and reverse incoming dependencies.
6. **On-Demand AI Architectural Insights:** Integrates with Google Gemini to generate high-level architectural responsibility narratives for individual files and their constituent functions.
7. **Snapshot Association & Idempotent Analysis:** Associates analysis results directly with immutable project snapshots (`ProjectSnapshot`), ensuring reproducibility and preventing duplicate background jobs.

### 2.3 Technology Stack
The Architecture module spans both client and server tiers:
- **Frontend Framework:** React 19, Vite, Framer Motion (drawer transitions), Tailwind CSS v4 design tokens.
- **Graph & Visualization:** `dagre` (layout calculation), custom SVG rendering layer (dynamic Bezier/polyline paths and directional arrow markers).
- **Icons & UI:** `lucide-react` (icons: `Network`, `Play`, `RefreshCw`, `Box`, `LayoutGrid`, `Filter`, `Sparkles`, etc.).
- **Backend Runtime:** Node.js, Express.
- **Code Analysis & AST:** `@babel/parser` (syntax parser), `@babel/traverse` (AST traversal).
- **Database & Persistence:** PostgreSQL via Prisma ORM (`ProjectStructureAnalysis`, `ProjectSnapshot`, `Job`, `Project`).
- **Asynchronous Task Queue:** BullMQ with Redis backing, fallback in-memory execution executor.
- **AI Service:** `@google/generative-ai` (Google Gemini SDK) via `gemini.service.js`.

---

## 3. Architecture Module UI

### 3.1 Visual Zones and Layout Structure
The Architecture user interface is composed of five tightly integrated zones:

1. **Workspace Header (Top Bar):**
   - Rendered by `Layout.jsx:695-736`.
   - Displays the purple COVAI Studio terminal brand emblem, brand title `"CovAI Studio"`, active project root breadcrumb (e.g., `"/ test2"`), and the relative path of the file active in the code editor (e.g., `"/ dist / helpers / attachable-file-source.js"`).
   - Note: The file path in this header reflects the Monaco editor tab state from the Explorer activity; it does not represent the currently selected node in the Architecture graph canvas.

2. **Module Navigation & Action Toolbar:**
   - Rendered by `ProjectArchitecturePanel.jsx:625-765`.
   - Left side: Static breadcrumb `Network` icon + `"Architecture / Network Graph"`.
   - Status badge (e.g., `"Completed"`, `"Analyzing"`, `"Queued"`) with colored dot and pulse animations.
   - Analysis progress bar with percentage indicator (e.g., `100%`, `55%`).
   - Right side: View mode toggle pill (`System Overview` vs. `Module View`), snapshot Git commit selector dropdown, data refresh button (`RefreshCw`), primary analysis button (`Run Analysis` / `Re-analyze`), and an inspector drawer collapse/expand toggle button.

3. **Sub-Bar Filter & Metrics Strip:**
   - Rendered by `ProjectArchitecturePanel.jsx:768-892`.
   - In **System Overview**: Left area displays live graph metrics: `{files} files · {dependencies} dependencies · {functions} functions`.
   - In **Module View**: Left area displays horizontal scrolling module chips: `All Modules ({totalFiles})` followed by individual domain chips (e.g., `handlers 313`, `tools 162`, `jest 1`).
   - Right area: Multi-select role filter chips with colored status indicators (e.g., `Other (294)`, `Test (30)`, `Utility (12)`, `Config (1)`, `Route (2)`), and an `All ({totalFiles})` toggle chip.

4. **Interactive Graph Canvas:**
   - Rendered by `ProjectArchitecturePanel.jsx:977-1325`.
   - Infinite pan and zoom canvas backed by mouse dragging and wheel listeners.
   - SVG background pattern with subtle dot grid (`#arch-dot-grid`).
   - SVG edge layer rendering polyline paths (`pointsToSvgPath`) between nodes with directional arrowheads.
   - Developer node cards rendering role badges, domain tags, filenames, lines of code (`L`), and function counts (`fn`).
   - Floating canvas toolbar at the bottom left containing: Zoom In (`+`), Zoom Out (`-`), Reset View (`100%`), Fit to Screen (`Maximize2`), Orientation toggle (`Horizontal` / `Vertical`), and Card Size toggle (`Normal` / `Large`).

5. **File Details Panel (Inspector Drawer):**
   - Rendered by `ProjectArchitecturePanel.jsx:1328-1718`.
   - Resizable right sidebar (280px to 700px width) with interactive drag handle.
   - Contains file header metadata, 4-column metric grid (`Lines`, `Functions`, `Calls Out`, `Called In`), AI Architecture Summary card with `Re-analyze` button, collapsible Functions & Methods catalog with parameter lists and export tags, Outgoing Dependencies (internal imports), and Incoming Dependencies (reverse dependents) with node jump navigation.

### 3.2 Visual State Analysis (Screenshot Observations)

#### Screenshot 1: Empty State (No Analysis Available)
- **Top Controls:** View mode toggle is present; snapshot dropdown displays `31a1dd5`; the primary button reads `Run Analysis` with a `Play` icon.
- **Center Canvas:** Renders an empty state placeholder consisting of a purple network icon inside a rounded surface container, the header `"Architecture map not available for this snapshot"`, descriptive text explaining that running analysis will generate the interactive network, and a centered purple `Run Analysis` button.
- **Verified Code State:** Corresponds to `ProjectArchitecturePanel.jsx:948-971`, when `!analysis && !loading && !["QUEUED", "RUNNING"].includes(status)`.

#### Screenshot 2: Completed State (System Overview)
- **Status & Progress:** Header displays a green `Completed` badge and a 100% filled progress bar (`ProjectArchitecturePanel.jsx:636-670`).
- **Sub-Bar:** Displays `"339 files · 10 dependencies · 2086 functions"`. Role filters show `Other (294)`, `Test (30)`, `Utility (12)`, `Config (1)`, `Route (2)`, and `All (339)`.
- **Canvas:** Renders file cards in a vertical column layout (with `Horizontal` layout mode selected in bottom controls). The node `eslint.config.js` is selected with a purple focus ring and active scale.
- **Inspector Drawer:** Displays `eslint.config.js` with `#Config` and `eslint` tags, metrics: `Lines: 37`, `Functions: 0`, `Calls Out: 0`, `Called In: 0`.
- **AI Summary Observation:** Displays the text `"Module eslint.config.js handles logic operations in the system architecture."`.
  - *Verified Implementation Fact:* This string exactly matches the hardcoded fallback template in `architectureAiSummary.service.js:172`, proving that in this instance, Gemini was either not configured, rate-limited, or returned an error, activating the graceful degradation fallback.
- **Dependencies & Functions:** Shows `"No functions detected in this file."`, `"This file does not import any internal source files."`, and `"No internal source files import this file."`.

#### Screenshot 3: In-Progress / Module View State
- **Status & Progress:** Header displays an amber `Analyzing` badge with pulse animation and an active progress bar at ~55% progress.
- **Sub-Bar:** Displays two rows of chips:
  - Top row: `Module:` chips starting with active `All Modules (339)`, followed by domain chips: `attachable-file-source 1`, `auth-server 1`, `build-quickbooks-search-criteri... 1`, `client 1`, `cone 1`, `eclet 1`, `format-error 1`, `handlers 313`, `jest 1`, `mocks 1`, `qbo-mcp-server 1`, `register-tool 1`, `scripts 3`, `tools 162`, `types 6`, `Unit 34`.
  - Bottom row: `Roles:` chips with `Config (1)` actively selected.
- **Canvas:** Displays the filtered node card `build-quickbooks-search-cri...` (`#Utility`, `build-quickbooks-...`, `111L`, `3 fn`).
- **Inspector Drawer:** Displays `jest.config.js` (`#Config`, `Jest`, `74L`, `0 fn`, `0 Calls Out`, `0 Called In`).
- **AI Summary Observation:** Displays a comprehensive 3-sentence architectural description generated by Gemini:
  > *"This file serves as the central configuration hub for the Jest testing framework, orchestrating TypeScript compilation via ts-jest and enforcing strict quality control through comprehensive code coverage thresholds. It establishes the testing infrastructure, including resolution strategies for ESM modules and specialized coverage exemptions for complex network-bound or branch-limited integration modules."*
  - *Verified Implementation Fact:* Demonstrates active, successful execution of `architectureAiSummary.service.js:89-163` via the Gemini generative AI model.

---

## 4. Implementation Architecture

### 4.1 Implementation Inventory
The following verified table catalogs all frontend and backend source files, models, and controllers comprising the Architecture module:

| File Path | Component, Function, or Model | Responsibility | Evidence |
|---|---|---|---|
| `client/src/components/dashboard/ProjectArchitecturePanel.jsx` | `ProjectArchitecturePanel` | Primary frontend Architecture view; manages graph state, Dagre layout, role/domain filtering, zoom/pan canvas, and inspector drawer. | Lines 136–1722 (`ProjectArchitecturePanel`), lines 326–380 (`Dagre layout`), lines 1328–1718 (`Inspector Drawer`). |
| `client/src/components/dashboard/Layout.jsx` | `Layout` | Global workspace layout; mounts `ProjectArchitecturePanel` when `activeActivity === "architecture"`; renders top breadcrumbs. | Line 18 (`import`), lines 152–167 (`handleOpenArchitecture`), lines 949–954 (conditional mount). |
| `client/src/components/dashboard/ActivityBar.jsx` | `ActivityBar` | Primary 60px navigation rail; renders `Network` icon for Architecture tab navigation. | Line 19 (`{ id: "architecture", icon: Network, label: "Architecture" }`). |
| `client/src/services/project.service.js` | API Client | Centralized HTTP wrapper for snapshots, structure analysis retrieval/execution, and AI file summaries. | Lines 302–307 (`getProjectSnapshotsApi`), lines 309–320 (`getProjectStructureAnalysisApi`), lines 333–343 (`runProjectStructureAnalysisApi`), lines 432–445 (`getArchitectureAiSummaryApi`). |
| `client/src/services/job.service.js` | API Client | Fetches project job queue status for polling in-progress architecture analysis jobs. | Lines 79–91 (`getProjectJobsApi`). |
| `server/src/routes/project.route.js` | Express Router | Authenticated HTTP routes routing architecture endpoints to controller handlers. | Line 25 (`GET /:id/snapshots`), line 31 (`GET /:id/structure-analysis`), line 45 (`POST /:id/structure-analysis`), line 47 (`POST /:id/architecture/ai-summary`). |
| `server/src/controllers/project.controller.js` | `ProjectController` | Controller layer validating inputs, permissions, snapshot resolution, and delegating to services. | Lines 241–252 (`listSnapshots`), lines 310–333 (`getStructureAnalysis`), lines 338–375 (`runStructureAnalysis`), lines 380–403 (`getArchitectureAiSummary`). |
| `server/src/services/project.service.js` | Service Layer | Business logic for owned snapshot resolution, architecture job creation, and persisted analysis retrieval. | Lines 763–777 (`resolveAnalysisSnapshot`), lines 792–807 (`startProjectStructureAnalysis`), lines 809–828 (`getProjectStructureAnalysis`). |
| `server/src/services/analysisJob.service.js` | `processAnalysisJob` | Asynchronous worker executor running `analyzeProjectStructure`, updating job progress (15%, 75%, 85%, 95%, 100%), and upserting DB records. | Lines 24–84 (`processAnalysisJob`). |
| `server/src/services/projectStructureAnalyzer.service.js` | `analyzeProjectStructure` | Main static analysis orchestrator coordinating discovery, parsing, functions, roles, domains, dependencies, and architecture overview. | Lines 32–113 (`analyzeProjectStructure`). |
| `server/src/services/fileDiscovery.service.js` | `discoverSnapshotSourceFiles` | Recursively walks snapshot directory, ignoring build/dependency directories and collecting supported source files. | Lines 52–86 (`discoverSnapshotSourceFiles`). |
| `server/src/services/projectStructure.constants.js` | Constants | Declares supported extensions, ignored directory names, schema version, module formats, and diagnostic categories. | Lines 1–30 (`PROJECT_STRUCTURE_SCHEMA_VERSION`, `SUPPORTED_SOURCE_EXTENSIONS`, `IGNORED_DIRECTORY_NAMES`). |
| `server/src/services/babelParser.service.js` | `parseJavaScriptFile`, `parseJavaScriptCode` | Parses source code into Babel AST with specific syntax plugins; counts lines; handles syntax errors non-fatally. | Lines 4–19 (`parserOptions`), lines 23–26 (`parseJavaScriptCode`), lines 28–56 (`parseJavaScriptFile`). |
| `server/src/services/functionExtraction.service.js` | `extractFunctions` | Traverses Babel AST with `@babel/traverse` to extract functions, methods, arrows, parameters, exported status, and CFG graphs. | Lines 11–34 (`extractFunctions`), lines 77–91 (`functionName`), lines 93–177 (`inferContextualName`), lines 191–230 (`getFunctionMetadata`). |
| `server/src/services/projectStructureRoles.service.js` | `classifyProjectStructureRole`, `classifyProjectStructureDomain` | Regex rule engine classifying file roles (route, controller, test, config, etc.) and assigning domain modules. | Lines 1–30 (`ROLE_RULES`, `classifyProjectStructureRole`), lines 46–129 (`classifyProjectStructureDomain`). |
| `server/src/services/projectStructureDependencies.service.js` | `resolveProjectDependencies` | Extracts import/require declarations, resolves relative and aliased internal paths, and catalogs external package dependencies. | Lines 14–29 (`relativeCandidates`), lines 81–111 (`collectReferences`), lines 149–290 (`resolveProjectDependencies`). |
| `server/src/services/projectArchitectureOverview.service.js` | `buildProjectArchitectureOverview` | Synthesizes architecture layers (Presentation, API, Application, Platform, Quality, Other) and entry point flow graphs. | Lines 1–8 (`LAYER_DEFINITIONS`), lines 46–108 (`buildProjectArchitectureOverview`). |
| `server/src/services/projectStructureTree.service.js` | `buildProjectStructureTree` | Builds a deterministic hierarchical folder-and-file tree structure from the analyzed file set. | Lines 8–39 (`buildProjectStructureTree`). |
| `server/src/services/architectureAiSummary.service.js` | `getArchitectureAiSummary` | Generates architectural narrative summaries for files and functions using Gemini AI; enforces in-memory caching and fallback templates. | Lines 14–185 (`getArchitectureAiSummary`). |
| `server/src/services/gemini.service.js` | `generateText` | Central Google Generative AI client wrapper managing model fallback (`gemini-3.8-flash`, etc.) and quota handling. | Lines 54–186 (`generateText`). |
| `server/src/services/job.service.js` | Job Management | Creates, deduplicates, and manages lifecycle transitions for background jobs (`createAnalysisJob`, `updateJobProgress`). | Lines 314–360 (`createAnalysisJob`), lines 529–550 (`updateJobProgress`). |
| `server/src/services/queue.service.js` | Queue Worker | BullMQ job queue manager with Redis connection; delegates `ANALYSIS` jobs to `processAnalysisJob`; falls back to in-memory execution if Redis is offline. | Lines 161–163 (`case 'ANALYSIS'`), lines 290–309 (`addJobToQueue`). |
| `server/src/utils/projectStructureId.util.js` | Utility | Generates deterministic SHA-256 hash IDs for nodes, edges, and functions. | Lines 6–14 (`createNodeId`, `createEdgeId`, `createFunctionId`). |
| `server/prisma/schema.prisma` | Prisma Models | Database schema defining `ProjectStructureAnalysis`, `ProjectSnapshot`, `Job`, and `Project`. | Lines 77–124 (`ProjectSnapshot`), lines 126–134 (`ProjectStructureAnalysis`). |

---

## 5. Architecture Analysis Pipeline

### 5.1 Pipeline Execution Stages
When a user initiates architecture analysis, the system executes an 11-stage static analysis pipeline. The table below details each stage, its implementation, inputs, outputs, and verified status:

| Stage | Actual Processing | Source File / Function | Input | Output | Status |
|---|---|---|---|---|---|
| **1. Trigger & Job Enqueue** | User clicks `Run Analysis` or `Re-analyze`; frontend calls `runProjectStructureAnalysisApi`; controller validates ownership, deduplicates existing active jobs, and enqueues an `ANALYSIS` job. | `server/src/controllers/project.controller.js:338-375`, `server/src/services/job.service.js:314-360` | `projectId`, `snapshotId`, `userId` | `Job` record (`status: "QUEUED"`, `type: "ANALYSIS"`) | `IMPLEMENTED` |
| **2. Worker Execution & State** | BullMQ worker or in-memory fallback invokes `processAnalysisJob`; sets job status to `RUNNING` and updates progress to 15%. | `server/src/services/analysisJob.service.js:24-50`, `server/src/services/queue.service.js:161-163` | `jobId` | Job state updated to `RUNNING` | `IMPLEMENTED` |
| **3. File Discovery** | Recursively scans snapshot `rootDir`; filters out directories matching `IGNORED_DIRECTORY_NAMES` (`node_modules`, `.git`, `dist`, `build`, etc.); collects files matching `SUPPORTED_SOURCE_EXTENSIONS` (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`). | `server/src/services/fileDiscovery.service.js:52-86`, `server/src/services/projectStructure.constants.js:3-10` | Snapshot `rootDir` path | Array of `{ absolutePath, relativePath }` | `IMPLEMENTED` |
| **4. AST Parsing via Babel** | Reads each source file from disk, counts lines (`split(/\r?\n/)`), and parses code into an AST using `@babel/parser`. Errors are captured as non-fatal diagnostics without failing analysis. | `server/src/services/babelParser.service.js:28-56` | File disk path & file string content | `{ success, ast, lineCount, error }` | `IMPLEMENTED` |
| **5. Function & Method Extraction** | Traverses AST using `@babel/traverse` for function declarations, expressions, arrow functions, class methods, and object methods. Incurs contextual name inference (hooks, updaters, handlers) and builds local CFGs. | `server/src/services/functionExtraction.service.js:11-34, 191-230` | Babel AST & `relativePath` | Array of `FunctionMetadata` objects | `IMPLEMENTED` |
| **6. File Role & Domain Assignment** | Evaluates file path against regex patterns in `ROLE_RULES` to assign architectural roles (`route`, `service`, `config`, etc.). Derives domain modules (`classifyProjectStructureDomain`) using directory segments or cleaned basenames. | `server/src/services/projectStructureRoles.service.js:25-30, 46-129` | File `relativePath` & inferred role | `{ role, evidence, confidence, domain }` | `IMPLEMENTED` |
| **7. Dependency Resolution** | Parses imports, dynamic imports, requires, and re-exports. Resolves relative paths (`./`, `../`) and path aliases (`@/`, `~/`) to internal file nodes; categorizes npm imports as external dependencies. | `server/src/services/projectStructureDependencies.service.js:149-290` | `rootDir`, analyzed file objects with ASTs | Populated `file.imports`, `file.importedBy`, and `edges` array | `IMPLEMENTED` |
| **8. Architectural Overview Construction** | Maps files into architectural layers (Presentation, API, Application, Platform, Quality, Other). Performs BFS path traversal from entry points (`route`, `page`, `main`, `index`) to construct flow paths. | `server/src/services/projectArchitectureOverview.service.js:46-108` | Files, edges, functions | `{ layers, flows, algorithmFlows, onboarding }` | `IMPLEMENTED` |
| **9. Structural Tree Building** | Assembles files into a deterministic hierarchical tree structure with alphabetized folders and files. | `server/src/services/projectStructureTree.service.js:8-39` | Analyzed files | Hierarchical tree object | `IMPLEMENTED` |
| **10. Persistence in PostgreSQL** | Serializes analysis results into JSON and upserts into `ProjectStructureAnalysis` table keyed by unique `snapshotId`. Updates job progress to 100% and marks job `SUCCESS`. | `server/src/services/analysisJob.service.js:55-75`, `server/prisma/schema.prisma:126-134` | Analysis payload, `snapshotId` | Persisted `ProjectStructureAnalysis` DB record | `IMPLEMENTED` |
| **11. Frontend Graph Rendering** | Frontend loads analysis JSON via `getProjectStructureAnalysisApi`, filters nodes by role/domain, executes `dagre` layout calculation, and renders nodes and SVG edges on canvas. | `client/src/components/dashboard/ProjectArchitecturePanel.jsx:192-225, 326-380` | Serialized analysis JSON | Interactive SVG and HTML node graph | `IMPLEMENTED` |

### 5.2 AST and Parsing Verification
Babel parser configuration is explicitly defined in `server/src/services/babelParser.service.js:4-19`:
```javascript
const parserOptions = {
  sourceType: "unambiguous",
  plugins: [
    "jsx",
    "typescript",
    "classProperties",
    "classPrivateMethods",
    "classPrivateProperties",
    "optionalChaining",
    "nullishCoalescingOperator",
    "dynamicImport",
    "objectRestSpread",
    "topLevelAwait",
  ],
  errorRecovery: false,
};
```
- **Syntax Tolerance & Non-Fatal Error Handling:** When a file contains unsupported syntax or syntax errors, `@babel/parser` throws an exception. `parseJavaScriptCode` catches this exception (`server/src/services/babelParser.service.js:23-26`) and sanitizes the error message (`safeError`). In `projectStructureAnalyzer.service.js:58-66`, the file is marked with a diagnostic entry (`category: "parse"`, `severity: "warning"`), its function list remains empty, and the pipeline continues analyzing subsequent files. A parsing failure on one file does not abort the analysis.
- **AST Node Inspection:** Traversal explicitly checks `ImportDeclaration`, `ExportNamedDeclaration`, `ExportDefaultDeclaration`, `ExportAllDeclaration`, `CallExpression` (`require`, `import`), `ImportExpression`, `FunctionDeclaration`, `FunctionExpression`, `ArrowFunctionExpression`, `ClassMethod`, and `ObjectMethod`.

### 5.3 Dependency Resolution Verification
- **Internal Dependencies:**
  - Relative imports (`./` and `../`) are resolved by computing normalized paths against candidate source extensions (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`) and `/index.*` variants (`server/src/services/projectStructureDependencies.service.js:14-29`).
  - Path aliases beginning with `@/` or `~/` are supported via hardcoded prefix candidates (`client/src`, `client`, `server/src`, `server`, `src`, `""`) (`lines 176-205`). Custom path mappings configured in `tsconfig.json` or `jsconfig.json` (such as `@app/*` or arbitrary baseUrl aliases) are **not** parsed dynamically (`PARTIALLY IMPLEMENTED`).
  - Successfully resolved internal imports produce bidirectional relationships: an entry in `file.imports` (`type: "internal"`), an entry in the target file's `file.importedBy`, and an internal edge in `edges` (`{ from: file.id, to: target.id, type: "internal" }`).
- **External Package Dependencies:**
  - Non-relative, non-aliased imports (e.g., `react`, `express`, `@babel/parser`) are recognized as package imports via `packageName()` (`lines 10-13`).
  - The service parses `package.json` files throughout the snapshot directory to classify packages into `production`, `development`, or `peerDependencies` (`lines 31-79`).
  - External dependencies are stored in `file.imports` (`type: "external"`) and recorded in `edges` as `{ from: file.id, package: name, type: "external" }` without a `to` node ID.
- **Unresolved Imports:**
  - Unresolved imports with asset extensions (`.css`, `.scss`, `.png`, `.json`, etc.) are cataloged as `type: "asset"` (`lines 232-252`).
  - Unresolved code imports are retained with `type: "unresolved"` and `reason: "Relative source file was not found"`.

---

## 6. System Overview

### 6.1 View Purpose and Architecture Graph
The **System Overview** view (`viewMode === "overview"`) provides a holistic representation of the entire analyzed codebase. It renders all active source file nodes simultaneously (unless filtered by file role), positioning them using the `dagre` hierarchical layout algorithm.

```
+--------------------------------------------------------------------------------------------------+
| Breadcrumb: Architecture / Network Graph  [Completed] [========== 100% ==========]               |
| Sub-bar: 339 files · 10 dependencies · 2086 functions              Roles: [Other] [Test] ...     |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|   +--------------------------+                                                                   |
|   | #Config         eslint   |                                                                   |
|   | eslint.config.js         | <--- Selected Node                                                |
|   | [FileCode] 37L  [Fn] 0 fn|                                                                   |
|   +--------------------------+                                                                   |
|                 |                                                                                |
|                 v (SVG Edge with Arrowhead)                                                      |
|   +--------------------------+                                                                   |
|   | #Other          scripts  |                                                                   |
|   | build.js                 |                                                                   |
|   | [FileCode] 46L  [Fn] 3 fn|                                                                   |
|   +--------------------------+                                                                   |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+
```

### 6.2 Calculation of Displayed Metrics
In System Overview, the sub-bar renders live computed metrics (`ProjectArchitecturePanel.jsx:817-833`):
- **File Count:** `{visibleNodes.length} files` — Computes the number of nodes currently matching the active role filter.
- **Dependency Count:** `{visibleEdges.length} dependencies` — Computes the count of visible directed edges connecting nodes that are both present in `visibleNodeIds`.
- **Function Count:** `{analysis.summary.totalFunctions} functions` — Reads the static aggregate count computed during analysis (`files.flatMap(f => f.functions).length`).

### 6.3 Discrepancy Investigation: High File Count vs. Low Edge Count
In Screenshot 2, the System Overview sub-bar displays:
`339 files · 10 dependencies · 2086 functions`

This observation raised an essential question: **Why does a project with 339 files show only 10 dependency edges?**

Investigation of the backend and frontend code revealed the exact mathematical and architectural reasons:
1. **Frontend Edge Filtering (`ProjectArchitecturePanel.jsx:315-319`):**
   ```javascript
   const visibleEdges = useMemo(() => {
     return allEdges.filter(
       (e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to),
     );
   }, [allEdges, visibleNodeIds]);
   ```
   The canvas edge renderer strictly requires that **both** `e.from` and `e.to` exist in `visibleNodeIds`. External dependencies (npm packages such as `express`, `react`, `lodash`) are created in `allEdges` without a `to` property (`server/src/services/projectStructureDependencies.service.js:273-280`). Therefore, **all external dependencies are excluded from the graph canvas and from the visible edge counter.**
2. **Project Composition in Screenshot Snapshot:**
   The snapshot in Screenshot 2/3 represents a project with 313 handler files (`domain: "handlers"`), multiple standalone script files (`domain: "scripts"`), configuration files (`eslint.config.js`, `jest.config.js`), and isolated test files. In microservice and serverless handler architectures (such as AWS Lambda, GCP Functions, or MCP servers), individual handler files typically import third-party SDKs directly rather than importing other peer handlers.
3. **Alias Mapping Limitations:**
   Because `projectStructureDependencies.service.js:180-205` only resolves aliases prefixed with `@/` or `~/`, any project-specific imports relying on custom TypeScript paths (e.g., `import { foo } from "helpers/bar"`) fail relative resolution and are marked as unresolved or external, preventing internal edge creation.

### 6.4 Graph Positioning, Pan, Zoom, and Layout
- **Dagre Layout Engine (`ProjectArchitecturePanel.jsx:326-380`):** Nodes and edges are fed into a `dagre.graphlib.Graph` configured with `rankdir` (`orientation`: `"LR"` or `"TB"`), `nodesep` (45px in LR, 60px in TB), and `ranksep` (75px in LR, 65px in TB). Node card dimensions are calculated dynamically based on `cardScale` (230px × 78px for Normal, 265px × 90px for Large).
- **SVG Edge Layer:** Renders connecting lines using SVG `<path>` elements with cubic Bezier curves or polylines calculated by Dagre (`pointsToSvgPath`). Arrowheads are rendered using SVG marker definitions (`#arch-arrow-default`, `#arch-arrow-outgoing`, `#arch-arrow-incoming`).
- **Interactive Controls:** Floating toolbar at `bottom-5 left-5` provides zoom in/out (clamped between 0.25× and 2.5×), 100% reset, screen auto-fit, orientation toggling (`Horizontal` vs. `Vertical`), and card size scaling (`Normal` vs. `Large`).

---

## 7. Module View

### 7.1 Identification and Classification of Modules
In the COVAI Architecture module, **Modules are logical functional domains inferred from file paths**, rather than isolated packages or raw filesystem directories.

The domain classification algorithm is implemented in `server/src/services/projectStructureRoles.service.js:46-129` (`classifyProjectStructureDomain`):
1. **Explicit Module Folders:** Checks if the path contains a directory named `modules`, `features`, or `domains`. If found, the immediate child directory name is used as the domain (e.g., `src/features/billing/invoice.js` -> domain `"Billing"`).
2. **Functional Directory Scanning:** Iterates parent path segments and ignores generic technical directory names (e.g., `src`, `server`, `client`, `app`, `lib`, `controllers`, `routes`, `services`, `models`, `middlewares`, `utils`, `config`, `test`). If a non-technical directory with length > 2 is found, its capitalized name becomes the domain (e.g., `handlers/create-account.js` -> domain `"Handlers"`).
3. **Cleaned Basename Inference:** If no non-technical directory exists, the file basename is cleaned by stripping known technical suffixes (`.controller`, `.service`, `.test`, `Controller`, `Service`, etc.).
   - If the cleaned basename is generic (`index`, `app`, `server`, `main`, `config`), it assigns domain `"Core"`.
   - If the filename uses camelCase or PascalCase, it extracts the leading word token (e.g., `attachable-file-source.js` -> `"Attachable-file-source"`, `jest.config.js` -> `"Jest"`).

### 7.2 Module Chips and Filtering Behavior
When `viewMode === "module"`, the sub-bar renders an interactive domain pill list (`ProjectArchitecturePanel.jsx:771-815`):
- **All Modules Chip:** Displays `All Modules ({allNodes.length})`. Clicking resets `selectedDomain = "All"`, displaying all modules simultaneously.
- **Domain Chips:** Dynamically populated from `availableDomains` (computed via `new Set(allNodes.map(n => n.domain))` sorted alphabetically). Each chip displays the domain name and file count badge (e.g., `handlers 313`, `tools 162`, `jest 1`).
- **Graph Isolation:** Selecting a specific domain sets `selectedDomain = dom`, filtering `visibleNodes` to `node.domain === selectedDomain`. `visibleEdges` automatically updates to show only edges connecting nodes within that domain.
- **Node Selection Independence:** Filtering by module does not clear the currently selected file node in the Inspector drawer unless the user explicitly selects a new node or closes the drawer.

---

## 8. File Details Panel

The **File Details Panel** (Inspector Drawer) is rendered as a resizable right-hand sidebar (`ProjectArchitecturePanel.jsx:1328-1718`). It opens automatically whenever a file node is clicked on the canvas (`selectedNodeId = node.id; setIsDrawerOpen(true);`).

### 8.1 File Header and Metric Grid
- **Header:** Renders the file's role badge (e.g., `#Config`) using theme colors from `ROLE_THEMES`, domain tag (e.g., `Jest`), filename (`fileName`), and relative file path (`relativePath`).
- **4-Metric Grid (`ProjectArchitecturePanel.jsx:1419-1452`):**
  1. `Lines`: Direct line count (`selectedNode.lineCount || 0`) calculated during Babel parsing via `code.split(/\r?\n/).length`.
  2. `Functions`: Total function count (`selectedNode.functions?.length || 0`) extracted from AST.
  3. `Calls Out`: Outgoing internal dependency count (`selectedNodeDeps.outgoing.length`), calculated as edges where `e.from === selectedNodeId`.
  4. `Called In`: Incoming internal dependency count (`selectedNodeDeps.incoming.length`), calculated as edges where `e.to === selectedNodeId`.

### 8.2 AI Architecture Summary
The AI Architecture Summary provides automated natural language explanations of a file's architectural responsibility and individual function roles.

```
+-----------------------------------------------------------------------+
| [*] AI Architecture Summary                              (Re-analyze) |
|                                                                       |
| This file serves as the central configuration hub for the Jest        |
| testing framework, orchestrating TypeScript compilation via ts-jest...|
+-----------------------------------------------------------------------+
```

- **Execution Flow (`architectureAiSummary.service.js:14-185`):**
  1. Triggered automatically via `useEffect` in `ProjectArchitecturePanel.jsx:465-497` when `selectedNode` changes.
  2. Client calls `POST /api/projects/:id/architecture/ai-summary` with `{ snapshotId, filePath, force }`.
  3. Backend checks `memoryCache.has(cacheKey)` (`${snapshotId}:${filePath}`). If cached and `force !== true`, cached JSON is returned immediately.
  4. If uncached or forced, backend reads the file from disk, truncates code to 12,000 characters (`fileContent.slice(0, 12000)`), extracts function positions, and formats an architect-level prompt.
  5. Invokes Google Gemini API (`generateText` in `gemini.service.js`) requesting strict JSON containing `fileSummary` and `functionSummaries`.
  6. Normalizes response keys and stores in `memoryCache`.
- **Fallback Behavior & Evidence from Screenshot 2:**
  If the Gemini API key is missing, network fails, quota is exceeded, or JSON parsing fails, `architectureAiSummary.service.js:165-184` catches the error and returns a deterministic template:
  ```javascript
  fileSummary: `Module ${filePath.split("/").pop()} handles logic operations in the system architecture.`
  ```
  This verifies why Screenshot 2 displays:
  `"Module eslint.config.js handles logic operations in the system architecture."`
  Conversely, Screenshot 3 displays a rich 3-sentence narrative for `jest.config.js`, confirming successful Gemini generation when API connectivity is healthy.
- **Re-analyze Action:** Clicking `Re-analyze` (`ProjectArchitecturePanel.jsx:1481-1493`) calls `handleGenerateAiSummary(selectedNode.relativePath, true)` with `force: true`, bypassing `memoryCache` and prompting Gemini for fresh generation.

### 8.3 Functions & Methods Catalog
Rendered by `ProjectArchitecturePanel.jsx:1522-1612`:
- Lists all functions extracted from the file's AST.
- Displays `displayName`: Function identifier, or smart contextual name inferred by `inferContextualName` (e.g., `arrow function`, `useEffect callback`, `setCart updater`, `map callback`, `onClick handler`).
- Badges: Arrow indicator (`=>`) for arrow functions; green `EXP` badge for exported functions (`fn.exported === true`).
- Position: Start and end line numbers (`L{fn.startLine}–L{fn.endLine}`).
- AI Function Explanations: If `aiSummaryMap[selectedNode.relativePath].functionSummaries` contains an explanation for the function, it renders a subtle text explanation beneath the function row.
- Empty State: If `functions.length === 0`, renders `"No functions detected in this file."`.

### 8.4 Outgoing Dependencies (Imports)
Rendered by `ProjectArchitecturePanel.jsx:1617-1663`:
- Displays internal files imported by the selected node (`selectedNodeDeps.outgoing`).
- Empty State: If 0, renders italic text: `"This file does not import any internal source files."`.
- Connected Rows: Renders target filename and role badge. Clicking any row invokes `jumpToNode(dep.id)`, which selects the target node and automatically pans the canvas to center on it (`lines 589-599`).

### 8.5 Incoming Dependencies (Imported by)
Rendered by `ProjectArchitecturePanel.jsx:1666-1712`:
- Displays internal files that import the selected node (`selectedNodeDeps.incoming`).
- Empty State: If 0, renders italic text: `"No internal source files import this file."`.
- Connected Rows: Renders source filename and role badge. Clicking any row invokes `jumpToNode(dep.id)`.

---

## 9. File Roles and Filtering

### 9.1 Role Classification Engine
File roles are classified by `classifyProjectStructureRole` (`server/src/services/projectStructureRoles.service.js:1-30`). The classification engine evaluates relative file paths sequentially against an ordered array of regular expression rules (`ROLE_RULES`). A file is assigned the first role whose pattern matches.

The table below catalogs all supported roles, classification rules, meanings, and implementation statuses:

| Role | Actual Meaning | Classification Rule (Regex / Path Pattern) | Source Evidence | Status |
|---|---|---|---|---|
| `test` | Unit, integration, or E2E test files | `/(^\|\/)(__tests__\|tests?\|e2e\|cypress)\/\|\.(test\|spec)\.[^.]+$/i` | `projectStructureRoles.service.js:2` | `IMPLEMENTED` |
| `config` | Build, linter, runtime, or framework configuration | `/(^\|\/)(config\|configs)\/\|(\.config\|\.rc)\.[^.]+$...eslint\|vite\|jest.../i` | `projectStructureRoles.service.js:4-6` | `IMPLEMENTED` |
| `route` | HTTP API routes, routers, or server entry scripts | `/(^\|\/)(routes?\|router)\/\|(^\|\/)(server\/)?(index\|server\|app)\.[^.]+$/i` | `projectStructureRoles.service.js:8-10` | `IMPLEMENTED` |
| `controller` | Request handlers / controllers | `/(^\|\/)(controllers?)\//i` | `projectStructureRoles.service.js:11` | `IMPLEMENTED` |
| `service` | Business logic services | `/(^\|\/)(services?)\//i` | `projectStructureRoles.service.js:12` | `IMPLEMENTED` |
| `middleware` | HTTP request/response middlewares | `/(^\|\/)(middlewares?)\//i` | `projectStructureRoles.service.js:13` | `IMPLEMENTED` |
| `model` | Database models, schemas, repositories, ORMs | `/(^\|\/)(models?\|repositories?\|entities\|schemas?\|db\|prisma)\//i` | `projectStructureRoles.service.js:14` | `IMPLEMENTED` |
| `validator` | Schema or input validation files | `/(^\|\/)(validators?)\//i` | `projectStructureRoles.service.js:15` | `IMPLEMENTED` |
| `utility` | Helper functions, utilities, shared libraries | `/(^\|\/)(utils?\|helpers?\|lib)\//i` | `projectStructureRoles.service.js:16` | `IMPLEMENTED` |
| `page` | Frontend UI pages, views, screens | `/(^\|\/)(pages?\|views?\|screens?)\//i` | `projectStructureRoles.service.js:17` | `IMPLEMENTED` |
| `hook` | React custom hooks | `/(^\|\/)hooks?\/\|(^\|\/)use[A-Z][^/]*\.[^.]+$/` | `projectStructureRoles.service.js:18` | `IMPLEMENTED` |
| `context` | React contexts, state stores, providers | `/(^\|\/)(contexts?\|providers?\|stores?)\//i` | `projectStructureRoles.service.js:19` | `IMPLEMENTED` |
| `layout` | UI layout templates | `/(^\|\/)(layouts?)\//i` | `projectStructureRoles.service.js:20` | `IMPLEMENTED` |
| `style` | Stylesheets (CSS, SCSS, SASS, LESS) | `/\.(css\|scss\|sass\|less)$/i` | `projectStructureRoles.service.js:21` | `IMPLEMENTED` |
| `component` | Frontend UI components or root components | `/(^\|\/)(components?)\/\|(^\|\/)(App\|main)\.[^.]+$/i` | `projectStructureRoles.service.js:22` | `IMPLEMENTED` |
| `unknown` | Files not matching any specific pattern; displayed in UI as **`Other`** | Fallback when no pattern in `ROLE_RULES` matches (`confidence: "none"`) | `projectStructureRoles.service.js:28`, `ProjectArchitecturePanel.jsx:111-116` | `IMPLEMENTED` |

### 9.2 Frontend Visual Themes and Role Chips
In `ProjectArchitecturePanel.jsx:44-117`, each role is mapped to an accessible color theme in `ROLE_THEMES` (e.g., `route`: `#3b82f6` blue; `test`: `#f97316` orange; `utility`: `#64748b` slate; `config`: `#f43f5e` rose; `unknown`/`Other`: `#64748b` slate).

- **Multi-Select Filter Behavior (`ProjectArchitecturePanel.jsx:500-514`):**
  - Clicking a role chip toggles its inclusion in `selectedRoles` (`Set`).
  - Safe Guard: A role cannot be deselected if it is the only currently active role (`if (next.size > 1) next.delete(role)`), preventing an accidental completely empty graph state.
  - Clicking `All` invokes `selectAllRoles()`, restoring all detected roles to `selectedRoles`.
  - Filter counts (e.g., `Other (294)`, `Test (30)`) represent the total count of analyzed files assigned that role in the snapshot (`availableRoles`).

---

## 10. Analysis Status and Persistence

### 10.1 Status Model and State Transitions
Architecture analysis is managed asynchronously through the COVAI job subsystem (`Job` table in PostgreSQL). The lifecycle follows a deterministic state machine:

| Current State | Trigger | Next State | User Feedback | Source Evidence |
|---|---|---|---|---|
| `UNINITIALIZED` / `EMPTY` | Initial page load when no analysis record exists in database. | `IDLE` (Empty State) | Centered icon + `"Architecture map not available for this snapshot"` + `Run Analysis` button. | `ProjectArchitecturePanel.jsx:948-971` |
| `IDLE` (Empty or Loaded) | User clicks `Run Analysis` or `Re-analyze`. | `QUEUED` | Header status badge shows `Queued` (15% progress); button disables; spinner starts. | `project.controller.js:338-375`, `analysisJob.service.js:24-33` |
| `QUEUED` | Job picked up by BullMQ worker or in-memory runner. | `RUNNING` | Header badge shows pulsing `Analyzing` badge; progress advances to 65% (frontend fallback) or 75% (backend log). | `analysisJob.service.js:48-53` |
| `RUNNING` | AST analysis, dependency mapping, and DB upsert complete successfully. | `SUCCESS` | Header badge turns green `Completed`; progress bar hits 100%; interactive graph canvas renders. | `analysisJob.service.js:68-75`, `ProjectArchitecturePanel.jsx:604` |
| `QUEUED` or `RUNNING` | Exception occurs during file reading, AST parsing, or DB write. | `FAILED` | Red alert box appears: `"Architecture analysis failed."` or specific error message with a `Retry` button. | `analysisJob.service.js:76-83`, `ProjectArchitecturePanel.jsx:896-910` |
| `QUEUED` or `RUNNING` | Duplicate job request submitted for same project and snapshot. | `QUEUED` or `RUNNING` (Reused) | Existing active job returned (`reused: true`); client attaches polling to existing job ID without duplicate worker execution. | `job.service.js:332-336, 353-359` |

### 10.2 Progress Reporting Mechanics
Progress is computed through a dual backend-frontend mechanism:
1. **Backend Milestone Updates (`analysisJob.service.js`):**
   - 15%: Initial file discovery (`LOAD_SOURCE`).
   - 75%: AST parsing and function extraction complete (`DETECT_ENDPOINTS`).
   - 85%: Dependency graph mapping and database serialization (`MAP_DEPENDENCIES`).
   - 95%: Final log entry written (`COMPLETE`).
   - 100%: Job marked `SUCCESS` in PostgreSQL.
2. **Frontend Smooth Fallback (`ProjectArchitecturePanel.jsx:603-612`):**
   ```javascript
   const analysisProgress = useMemo(() => {
     if (status === "SUCCESS") return 100;
     if (job?.progress !== undefined && job?.progress !== null) {
       return Math.min(100, Math.max(0, Math.round(job.progress)));
     }
     if (status === "RUNNING") return 65;
     if (status === "QUEUED") return 15;
     if (loading) return 40;
     return 0;
   }, [status, job?.progress, loading]);
   ```
   If the backend job object provides a numeric `progress` value (fetched via polling `GET /api/job/:projectId/jobs`), the progress bar reflects that exact number. If intermediate polling responses omit progress, it falls back to 15% (queued) or 65% (running).

### 10.3 Persistence Architecture
- **Database Model (`server/prisma/schema.prisma:126-134`):**
  ```prisma
  model ProjectStructureAnalysis {
    id              String          @id @default(cuid())
    snapshotId      String          @unique
    schemaVersion   Int
    resultJson      String
    createdAt       DateTime        @default(now())
    updatedAt       DateTime        @updatedAt
    ProjectSnapshot ProjectSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  }
  ```
- **Snapshot Immutability:** Analysis results are keyed directly by `snapshotId @unique`. Re-running analysis for an existing snapshot executes an `upsert` (`analysisJob.service.js:56-67`), updating `resultJson` without creating orphan records.
- **Client Polling Lifecycle:** While `job.status` is `"QUEUED"` or `"RUNNING"`, `ProjectArchitecturePanel.jsx:237-256` runs an HTTP polling loop every 2,500ms (`getProjectJobsApi`). When status transitions to `"SUCCESS"`, polling terminates and `loadAnalysis()` fetches the final graph data.

---

## 11. Frontend-Backend Workflows

The following table traces all primary user workflows through the frontend entry points, API contracts, backend controllers, underlying services, and UI rendering results:

| Workflow | Frontend Entry Point | API/Service | Backend Handler | Analysis/Data Source | UI Result |
|---|---|---|---|---|---|
| **Workflow A: Open Architecture** | User clicks `Architecture` icon in ActivityBar or URL contains `?tab=architecture`. | `getProjectSnapshotsApi(projectId)`, `getProjectStructureAnalysisApi(projectId, snapshotId)` | `ProjectController.listSnapshots`, `ProjectController.getStructureAnalysis` | PostgreSQL `ProjectSnapshot` & `ProjectStructureAnalysis` tables. | Renders interactive graph canvas if analysis exists, or empty state with `Run Analysis` button. |
| **Workflow B: Run Analysis** | User clicks `Run Analysis` button in empty state or toolbar. | `runProjectStructureAnalysisApi(projectId, snapshotId)` (`POST /api/projects/:id/structure-analysis`) | `ProjectController.runStructureAnalysis`, `project.service.js:startProjectStructureAnalysis` | BullMQ `ANALYSIS` job dispatched; `analysisJob.service.js:processAnalysisJob`. | Toolbar displays pulsing amber `Analyzing` badge; progress bar activates; client initiates 2.5s polling loop. |
| **Workflow C: Re-analyze** | User clicks `Re-analyze` button in toolbar when analysis is already displayed. | `runProjectStructureAnalysisApi(projectId, snapshotId)` | `ProjectController.runStructureAnalysis` | Overwrites existing `ProjectStructureAnalysis` record via database `upsert`. | Background job executes; existing view remains interactive until fresh analysis completes and seamlessly replaces graph. |
| **Workflow D: Switch View** | User toggles `System Overview` or `Module View` buttons in top toolbar. | Local React state (`setViewMode("overview" \| "module")`); zero network requests. | N/A (Pure frontend operation) | In-memory `allNodes`, `availableDomains`, and `allEdges`. | Sub-bar toggles between live stats summary and domain module pills; visible nodes update according to active domain. |
| **Workflow E: Select File Node** | User clicks a node card on the canvas or an outgoing/incoming dependency button. | Local React state (`setSelectedNodeId(node.id)`); triggers `getArchitectureAiSummaryApi`. | `ProjectController.getArchitectureAiSummary`, `architectureAiSummary.service.js` | In-memory `memoryCache` or on-demand Gemini AI prompt. | Node card highlights with purple ring; Inspector drawer animates open; loads metrics, functions, dependencies, and AI summary. |
| **Workflow F: Filter Roles or Modules** | User clicks a Role chip (e.g., `Test`) or Module chip (e.g., `handlers`). | Local React state (`toggleRole(role)`, `setSelectedDomain(dom)`); zero network requests. | N/A (Pure frontend operation) | In-memory `visibleNodes` and `visibleEdges` recalculation. | Graph canvas recalculates Dagre layout; non-matching nodes disappear; sub-bar file and edge counts update in real time. |
| **Workflow G: Change Snapshot** | User selects a different commit hash in the snapshot dropdown. | `setSnapshotId(newId)` triggers `loadAnalysis()` (`GET /api/projects/:id/structure-analysis?snapshotId=...`). | `ProjectController.getStructureAnalysis` | PostgreSQL `ProjectStructureAnalysis` table for selected snapshot. | Displays architecture graph for selected snapshot if previously analyzed, or renders empty state with `Run Analysis` prompt. |

---

## 12. UI Specification Table

The following formal specification table details all 35 confirmed visible, interactive, structural, and conditional components of the COVAI Architecture interface:

| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `ArchitectureBreadcrumb` | Breadcrumb Text | Icon `Network` (size 14, primary purple) + text `"Architecture / Network Graph"`. Static `<span>` elements (`font-mono text-xs`). | Identifies the active activity module within COVAI Studio. |
| 2 | `AnalysisStatusBadge` | Status Badge | Conditional badge: `Completed` (green, `bg-success/10`), `Analyzing` (amber, `animate-pulse`), `Queued` (gray). Rendered only when job status exists. | Informs user of current architecture analysis processing state. |
| 3 | `AnalysisProgressBar` | Progress Bar | Container (w-20 sm:w-28, h-1.5, rounded-full) + filled bar transitioning width (`0%` to `100%`) + monospace percentage text. | Displays quantified progress of background analysis. |
| 4 | `ViewModeToggle` | Segmented Toggle | Dual-button pill: `System Overview` (icon `LayoutGrid`) and `Module View` (icon `Box`). Active mode highlighted in white with shadow. | Switches between global project network and domain-partitioned module view. |
| 5 | `SnapshotSelector` | Dropdown Select | Monospace select dropdown listing snapshots by truncated commit SHA (`commitSha.slice(0, 7)`) or snapshot ID. | Selects active snapshot/commit for architecture visualization. |
| 6 | `RefreshDataButton` | Icon Button | Button with `RefreshCw` icon (size 13); spins when `loading === true`; disabled during active loading. | Reloads architecture analysis data from backend API. |
| 7 | `AnalysisActionButton` | Action Button | Primary purple button with `Play` icon (size 11). Label dynamically renders `"Run Analysis"` (if no analysis exists) or `"Re-analyze"` (if analysis exists). | Dispatches background architecture static analysis job (`POST /api/projects/:id/structure-analysis`). |
| 8 | `InspectorToggle` | Icon Button | Conditional button with `PanelRightClose` / `PanelRightOpen` (size 14); active when node is selected. | Toggles visibility of the right-hand File Details Panel. |
| 9 | `SystemStatsSummary` | Text Metric Bar | Monospace text bar in System Overview: `{files} files · {dependencies} dependencies · {functions} functions`. | Summarizes overall scale of visible graph components. |
| 10 | `ModuleChipsBar` | Horizontal Scroll Area | Horizontal scroll container in Module View containing `All Modules` button and domain buttons with count badges. | Filters graph nodes by architectural domain. |
| 11 | `RoleFiltersBar` | Filter Group | Multi-select buttons with colored circle dots, role labels (`Other`, `Test`, `Utility`, `Config`, `Route`), and counts. Includes `All` toggle button. | Toggles visibility of nodes by classified architectural role. |
| 12 | `GraphCanvas` | Canvas Container | Infinite pan-and-zoom interactive area with grab/grabbing cursor, drag handlers, and wheel zoom listeners. | Encloses the graph rendering layers and supports spatial navigation. |
| 13 | `DotGridBackground` | SVG Pattern | SVG `<pattern id="arch-dot-grid">` rendering a 24×24px repetitive dot grid using `var(--color-border)`. | Provides subtle spatial depth and orientation cues on canvas. |
| 14 | `GraphEdgeLayer` | SVG Layer | Absolute SVG overlay rendering directional polyline paths (`fill="none"`) with markers (`#arch-arrow-default`, etc.). | Visually depicts internal dependency connections between files. |
| 15 | `FileNodeCard` | HTML Node Card | Card (width 230-265px, height 78-90px) positioned via Dagre coordinates. Contains role badge, domain tag, filename, LOC, and function count. | Represents an individual analyzed source file in the graph. |
| 16 | `NodeRoleBadge` | Tag Badge | Colored badge on node card top-left with dot indicator and role name (e.g., `#Config`). Uses `ROLE_THEMES`. | Identifies classified architectural category of file node. |
| 17 | `NodeDomainTag` | Text Tag | Monospace text on node card top-right displaying domain name (e.g., `eslint`, `Jest`, `handlers`). | Identifies functional module domain of file node. |
| 18 | `NodeMetricsFooter` | Card Footer | Monospace footer with `FileCode` icon + line count (`37L`) and `FunctionSquare` icon + function count (`0 fn`). | Displays granular file-level scale metrics directly on card. |
| 19 | `CanvasControlsBar` | Floating Toolbar | Floating pill at bottom-left containing zoom in, zoom out, 100% reset, fit view, layout orientation, and card scale toggles. | Controls viewport transformations and graph visual configurations. |
| 20 | `CanvasZoomInButton` | Icon Button | Button with `ZoomIn` icon (size 14); increments zoom scale by 1.15× (max 2.5×). | Magnifies graph viewport canvas. |
| 21 | `CanvasZoomOutButton` | Icon Button | Button with `ZoomOut` icon (size 14); decrements zoom scale by 0.85× (min 0.25×). | Demagnifies graph viewport canvas. |
| 22 | `CanvasResetZoomButton` | Text Button | Monospace button displaying rounded zoom percentage (e.g., `"100%"`). Resets zoom to 1.0 and pan to (50, 50). | Restores default 1:1 scale and initial canvas position. |
| 23 | `CanvasFitViewButton` | Icon Button | Button with `Maximize2` icon (size 14). Computes bounding rect scale and auto-fits graph into viewport. | Fits complete graph into the current canvas window. |
| 24 | `LayoutOrientationToggle`| Action Button | Monospace button with `ArrowDownUp` icon displaying `"Horizontal"` (`rankdir: "LR"`) or `"Vertical"` (`rankdir: "TB"`). | Toggles Dagre graph layout direction between horizontal and vertical. |
| 25 | `CardScaleToggle` | Action Button | Monospace button displaying `"Normal"` (scale 1.0) or `"Large"` (scale 1.15). | Adjusts card size scale for improved readability on high-DPI displays. |
| 26 | `InspectorDrawer` | Sidebar Panel | Resizable right-hand panel (280px to 700px) with animated entrance/exit via Framer Motion. | Houses detailed metadata and relationships for selected file node. |
| 27 | `InspectorResizeHandle`| Drag Handle | Absolute 12px wide interactive strip on drawer left edge with `col-resize` cursor and primary color highlight on drag. | Enables mouse drag resizing of the Inspector drawer. |
| 28 | `InspectorHeader` | Drawer Header | Displays role badge, domain badge, filename heading, relative path sub-text, and close button (`X`). | Summarizes selected file identity and provides dismiss trigger. |
| 29 | `InspectorMetricsGrid` | 4-Column Grid | Grid cards displaying `Lines` (`lineCount`), `Functions` (`functions.length`), `Calls Out` (`outgoing.length`), `Called In` (`incoming.length`). | Displays quantified structural statistics for selected file. |
| 30 | `AiSummaryCard` | Content Card | Bordered card featuring `Sparkles` icon, `"AI Architecture Summary"` title, `Re-analyze` button, and narrative paragraph. | Displays Gemini-generated architectural purpose of selected file. |
| 31 | `FunctionsCatalog` | Collapsible List | Section listing all functions in file with names, arrow badges (`=>`), export badges (`EXP`), line ranges, and AI function summaries. | Catalogs internal functions, methods, and closures within the file. |
| 32 | `OutgoingDepsSection` | Dependency List | Section listing internal files imported by current file. Displays target names and role badges with `jumpToNode` navigation. | Visualizes outbound dependencies and allows one-click graph jumping. |
| 33 | `IncomingDepsSection` | Dependency List | Section listing internal files importing current file. Displays source names and role badges with `jumpToNode` navigation. | Visualizes inbound reverse dependencies and allows one-click graph jumping. |
| 34 | `EmptyStatePlaceholder`| View Placeholder | Centered container rendered when no analysis exists; includes network icon, explanation, and `Run Analysis` button. | Prompts user to start static architecture analysis. |
| 35 | `ErrorBanner` | Alert Banner | Red banner (`bg-danger/10 border-danger/20`) rendering alert icon, failure message, and `Retry` action. | Alerts user to API or worker analysis failures and enables recovery. |

---

## 13. Screenshot-to-Code Comparison

The following table provides a rigorous element-by-element cross-comparison between visual observations from the three screenshots and the actual codebase implementation:

| UI Element | Screenshot Observation | Actual Implementation | Status | Evidence / Notes |
|---|---|---|---|---|
| **Breadcrumb Title** | `"Architecture / Network Graph"` | Rendered in `ProjectArchitecturePanel.jsx:627-634` as static text `<span>` elements with a Lucide `Network` icon. | `MATCH` | Matches visual styling. Verified that clicking the breadcrumb does **not** trigger navigation (static text). |
| **System Overview / Module View Toggle** | Dual button segmented control at top right. | Rendered in `ProjectArchitecturePanel.jsx:676-703`. Manages `viewMode` state between `"overview"` and `"module"`. | `MATCH` | Identical layout, icon usage (`LayoutGrid` and `Box`), and active shadow highlight styling. |
| **Snapshot Selector** | Selector showing truncated commit SHA `"31a1dd5"`. | Native `<select>` element in `ProjectArchitecturePanel.jsx:706-716` iterating `snapshots` and formatting `s.commitSha?.slice(0, 7) \|\| s.id`. | `MATCH` | Directly verified against code. `31a1dd5` is a Git commit SHA prefix from PostgreSQL `ProjectSnapshot.commitSha`. |
| **Primary Action Button** | Button reads `"Run Analysis"` in Screenshot 1, and `"Re-analyze"` in Screenshots 2 and 3. | Dynamic label in `ProjectArchitecturePanel.jsx:739`: `<span>{analysis ? "Re-analyze" : "Run Analysis"}</span>`. | `MATCH` | Exactly matches observed button text and `Play` icon across all three screenshot states. |
| **Analysis Status Badge** | Green `"Completed"` badge in Screenshot 2; pulsing amber `"Analyzing"` badge in Screenshot 3. | Badge in `ProjectArchitecturePanel.jsx:636-648` using `STATUS_COPY`: `SUCCESS` -> `"Completed"`, `RUNNING` -> `"Analyzing"`. | `MATCH` | Matches copy, color tokens (`var(--color-success)`, `var(--color-warning)`), and `animate-pulse` behavior. |
| **Progress Bar** | Shows `100%` in Screenshot 2; shows intermediate progress (~55%) in Screenshot 3. | Progress container and filled bar in `ProjectArchitecturePanel.jsx:650-670`, animated to `analysisProgress` percentage. | `MATCH` | Matches visual width, border, percentage label, and transition animations. |
| **Empty State** | Centered network icon, `"Architecture map not available for this snapshot"`, and `"Run Analysis"` button. | Container in `ProjectArchitecturePanel.jsx:948-971` rendered when `!analysis && !loading && !["QUEUED", "RUNNING"].includes(status)`. | `MATCH` | Exact visual match for icon, heading, descriptive text, and centered action button. |
| **Graph Node Cards** | Vertical sequence of cards showing `#Config`, `#Other`, `#Utility`, filename, LOC, and function count. | Node card mapping in `ProjectArchitecturePanel.jsx:1128-1250` styled with `ROLE_THEMES`, displaying `lineCount` and `functions.length`. | `MATCH` | Identical visual appearance, badge colors, typography, and monospace line/function indicators. |
| **Canvas Floating Controls** | Bottom-left toolbar showing `[-] [+] 100% [Maximize] | Horizontal Normal`. | Toolbar in `ProjectArchitecturePanel.jsx:1254-1324` with ZoomIn, ZoomOut, Reset, Fit, Orientation, and Scale buttons. | `MATCH` | Exactly matches icons, labels (`"Horizontal"`, `"Normal"`), and divider styling. |
| **Module Chips (Module View)**| Two rows: `Module:` chips (`All Modules (339)`, `handlers 313`, etc.) and `Roles:` chips. | Sub-bar in `ProjectArchitecturePanel.jsx:771-892` rendering `availableDomains` and `availableRoles` arrays. | `MATCH` | Explains all domain labels (`handlers`, `tools`, `scripts`, `jest`) derived by `classifyProjectStructureDomain`. |
| **File Details Panel Metrics** | 4-column metric grid: `LINES: 37`, `FUNCTIONS: 0`, `CALLS OUT: 0`, `CALLED IN: 0`. | Metric cards in `ProjectArchitecturePanel.jsx:1419-1452` displaying `lineCount`, `functions.length`, `outgoing.length`, and `incoming.length`. | `MATCH` | Exact layout, typography, uppercase headers, and value mapping. |
| **AI Summary (Screenshot 2)** | Displays `"Module eslint.config.js handles logic operations in the system architecture."`. | Hardcoded fallback string in `architectureAiSummary.service.js:172`: `Module ${filePath.split("/").pop()} handles logic operations...`. | `MATCH` | Verifies that Screenshot 2 utilized the deterministic fallback mechanism due to an absent or failed Gemini call. |
| **AI Summary (Screenshot 3)** | Comprehensive architectural description of Jest configuration hub. | Live Gemini generative AI response formatted via prompt in `architectureAiSummary.service.js:89-125`. | `MATCH` | Verifies live Gemini AI integration generating contextual architecture descriptions. |
| **Functions & Methods Section** | Section heading `Functions & Methods (0)` with notice `"No functions detected in this file."`. | Heading and empty notice in `ProjectArchitecturePanel.jsx:1523-1540`. | `MATCH` | Exact wording match for empty function state. |
| **Outgoing Dependencies Section**| Heading `Outgoing Dependencies (Imports) (0)` with subtext `"This file does not import any internal source files."`. | Heading and empty subtext in `ProjectArchitecturePanel.jsx:1618-1632`. | `MATCH` | Exact wording match for zero internal outgoing dependencies. |
| **Incoming Dependencies Section**| Heading `Incoming Dependencies (Imported by) (0)` with subtext `"No internal source files import this file."`. | Heading and empty subtext in `ProjectArchitecturePanel.jsx:1667-1681`. | `MATCH` | Exact wording match for zero internal incoming dependencies. |
| **Global Workspace Breadcrumbs**| Workspace top bar shows `CovAI Studio / test2 / dist / helpers / attachable-file-source.js`. | Rendered by `Layout.jsx:695-736` using `project.name` (`test2`) and `filePathSegments` from Monaco editor buffer. | `MATCH` | Verifies why the workspace header shows `dist/helpers/attachable-file-source.js` while the Architecture graph shows `eslint.config.js`. |

---

## 14. Limitations and Findings

The following table summarizes all architectural limitations, edge cases, and technical findings discovered during code inspection:

| Finding | Evidence | Impact | Status | Recommendation |
|---|---|---|---|---|
| **1. Exclusion of External Packages from Graph View** | `ProjectArchitecturePanel.jsx:315-319` filters edges using `visibleNodeIds.has(e.to)`. External edges lack `to` property. | Graph canvas displays zero npm package dependencies, causing projects with hundreds of packages to display very low edge counts (e.g., 10 edges across 339 files). | `IMPLEMENTED` | Add an optional toggle (`"Show External Packages"`) that renders package nodes as distinct hexagonal or dashed nodes on the canvas. |
| **2. Rigid Path Alias Resolution** | `projectStructureDependencies.service.js:180-205` only checks hardcoded `@/` and `~/` prefixes against candidate folders. | Projects using custom `compilerOptions.paths` in `tsconfig.json` or `jsconfig.json` (e.g., `@services/*`, `~utils/*`) fail internal resolution and are classified as unresolved. | `PARTIALLY IMPLEMENTED` | Implement a `tsconfig.json` / `jsconfig.json` parser that dynamically extracts and resolves `paths` mappings. |
| **3. Non-Persistent AI Summary Storage** | `architectureAiSummary.service.js:9` stores AI summaries in an in-memory `const memoryCache = new Map()`. | Server process restarts or multi-instance load balancing clear all AI-generated summaries, forcing redundant Gemini API calls and token consumption. | `PARTIALLY IMPLEMENTED` | Persist generated AI summaries in PostgreSQL (e.g., in an `AiArchitectureSummary` table or within `ProjectStructureAnalysis.resultJson`). |
| **4. Volatile Frontend Polling State** | `ProjectArchitecturePanel.jsx:140, 237-256` stores `job` in React local state (`useState(null)`). It does not query active jobs on mount. | If a developer refreshes the browser while an analysis job is running, the panel resets to the idle/empty state and stops polling, even though the backend job continues in BullMQ. | `PARTIALLY IMPLEMENTED` | On panel mount, query `GET /api/job/:projectId/jobs` to check for active `ANALYSIS` jobs and automatically resume polling. |
| **5. Static Breadcrumb Navigation** | `ProjectArchitecturePanel.jsx:627-634` renders `Architecture / Network Graph` as static `<span>` elements without `onClick` handlers. | Clicking on the breadcrumbs does not navigate back to a parent dashboard or project overview, diverging from standard breadcrumb UX expectations. | `PARTIALLY IMPLEMENTED` | Convert `"Architecture"` into a clickable link/button that navigates to the project overview or resets active filters. |
| **6. Non-String Dynamic Import Inability** | `projectStructureDependencies.service.js:161-167` checks `reference.literal`; non-literal expressions (e.g., `import(variable)`) are marked unresolved. | Dynamic plugin systems or variable-based imports cannot be linked to target nodes in the static graph. | `IMPLEMENTED` (By Design) | Surface diagnostic warnings in the inspector explaining that runtime dynamic expressions cannot be resolved statically. |
| **7. Lack of Custom User Ignore Rules (.gitignore)** | `fileDiscovery.service.js:32, 74` strictly filters against a static `IGNORED_DIRECTORY_NAMES` Set (`node_modules`, `dist`, etc.). | Custom project ignore rules specified in `.gitignore` or `.covaiignore` are not evaluated, potentially scanning unwanted generator files. | `PARTIALLY IMPLEMENTED` | Incorporate `ignore` library to evaluate `.gitignore` patterns during snapshot discovery. |

---

## 15. Recommendations

Based on the verified findings, the following non-breaking recommendations are proposed for future architectural evolutions of COVAI Studio:

1. **Database Persistence for AI Architecture Summaries:**
   - Migrate from the ephemeral `memoryCache` (`Map`) to a dedicated PostgreSQL table (e.g., `ArchitectureFileSummary` with fields `snapshotId`, `filePath`, `fileSummary`, `functionSummariesJson`, `createdAt`), or append AI summaries into `ProjectStructureAnalysis.resultJson`.
   - *Benefits:* Eliminates duplicate Gemini API token usage, preserves summaries across server restarts, and enables instantaneous inspector drawer rendering.

2. **Dynamic TypeScript / JavaScript Path Mapping Resolver:**
   - Enhance `projectStructureDependencies.service.js` to inspect `tsconfig.json` or `jsconfig.json` at the snapshot root.
   - Utilize a path resolution utility (such as `tsconfig-paths`) to resolve custom aliases before declaring imports unresolved.
   - *Benefits:* Drastically improves internal dependency detection in enterprise React, Vue, NestJS, and Next.js codebases.

3. **External Dependencies Visual Toggle in Graph View:**
   - Provide a toolbar toggle (`"Show External Packages"`) that generates synthetic external package nodes styled distinctly (e.g., pill shape with an npm emblem).
   - *Benefits:* Resolves user confusion regarding sparse dependency counts and highlights critical third-party dependencies (e.g., database drivers, security libraries).

4. **Persistent Job Polling Recovery on Component Mount:**
   - In `ProjectArchitecturePanel.jsx`, execute an initial check against `getProjectJobsApi(projectId)` inside `useEffect` on mount.
   - If a job with `type === "ANALYSIS"` and `status in ["QUEUED", "RUNNING"]` exists for the current `snapshotId`, restore it into `job` state and resume polling immediately.
   - *Benefits:* Guarantees seamless UX resilience against browser reloads or network hiccups during long-running repository analysis.

5. **Bidirectional Monaco Code Editor Navigation:**
   - Add an `"Open in Code Editor"` action button in the File Details Panel header that invokes `handleOpenFileByPath(selectedNode.relativePath)` in `Layout.jsx`.
   - *Benefits:* Unifies the Architecture activity with the Monaco Editor, enabling developers to jump straight from visual structural analysis to direct code editing.

---

## 16. Source References

The findings and technical specifications in this document are based entirely upon inspection of the following active source files within the COVAI repository:

### Client-Side Files
1. `client/src/components/dashboard/ProjectArchitecturePanel.jsx` (Lines 1–1723)
   - Role themes and status copy: Lines 43–125
   - State declarations and snapshot/analysis loading: Lines 136–235
   - Job polling and analysis start: Lines 236–274
   - Domain and role extraction: Lines 275–296
   - Node and edge filtering: Lines 297–320
   - Dagre layout calculation: Lines 325–380
   - Selected node outgoing/incoming derivation: Lines 409–434
   - AI summary fetch and auto-trigger: Lines 436–497
   - Canvas zoom, pan, fit, and orientation handlers: Lines 517–565
   - Header controls, view mode toggle, snapshot select: Lines 624–765
   - Sub-bar domain pills and role chips: Lines 768–892
   - Empty, loading, and progress states: Lines 912–972
   - Canvas SVG edge rendering and node card mapping: Lines 974–1252
   - Floating zoom/layout controls toolbar: Lines 1253–1325
   - Resizable File Details Panel (Inspector Drawer): Lines 1327–1718
2. `client/src/components/dashboard/Layout.jsx` (Lines 18, 150–167, 695–736, 949–954)
   - Architecture mount and context handling: Lines 152–167, 949–954
   - Studio brand and file path breadcrumbs: Lines 695–736
3. `client/src/components/dashboard/ActivityBar.jsx` (Lines 14–24)
   - Architecture activity rail definition (`icon: Network`): Line 19
4. `client/src/services/project.service.js` (Lines 302–343, 432–445)
   - API client functions: `getProjectSnapshotsApi`, `getProjectStructureAnalysisApi`, `runProjectStructureAnalysisApi`, `getArchitectureAiSummaryApi`
5. `client/src/services/job.service.js` (Lines 75–91)
   - API client polling function: `getProjectJobsApi`

### Server-Side Files
6. `server/src/routes/project.route.js` (Lines 25, 31, 44–49)
   - Express route bindings for snapshot listing, structure analysis, and AI summaries
7. `server/src/controllers/project.controller.js` (Lines 254–279, 308–403)
   - Handlers: `listSnapshots`, `getStructureAnalysis`, `runStructureAnalysis`, `getArchitectureAiSummary`
8. `server/src/services/project.service.js` (Lines 763–828)
   - Service functions: `resolveAnalysisSnapshot`, `startProjectStructureAnalysis`, `getProjectStructureAnalysis`
9. `server/src/services/analysisJob.service.js` (Lines 1–85)
   - Worker implementation: `processAnalysisJob`, progress updates (15% -> 75% -> 85% -> 95% -> 100%), and database upsert
10. `server/src/services/projectStructureAnalyzer.service.js` (Lines 1–114)
    - Pipeline coordinator: `analyzeProjectStructure`
11. `server/src/services/fileDiscovery.service.js` (Lines 1–87)
    - Filesystem traversal: `discoverSnapshotSourceFiles`, `discoverSourceFiles`
12. `server/src/services/projectStructure.constants.js` (Lines 1–30)
    - Schema version, supported extensions (`.js`, `.jsx`, `.ts`, etc.), ignored directories (`node_modules`, `dist`, etc.)
13. `server/src/services/babelParser.service.js` (Lines 1–57)
    - AST parsing options, Babel plugins, error handling: `parseJavaScriptFile`, `parseJavaScriptCode`
14. `server/src/services/functionExtraction.service.js` (Lines 1–253)
    - AST traversal for functions and methods: `extractFunctions`, `getFunctionMetadata`, `inferContextualName`
15. `server/src/services/projectStructureRoles.service.js` (Lines 1–130)
    - File classification rules: `ROLE_RULES`, `classifyProjectStructureRole`, `classifyProjectStructureDomain`
16. `server/src/services/projectStructureDependencies.service.js` (Lines 1–291)
    - Import resolution, alias handling, manifest analysis: `resolveProjectDependencies`, `collectReferences`
17. `server/src/services/projectArchitectureOverview.service.js` (Lines 1–109)
    - Architectural layers, entry point discovery, and BFS flow traversal: `buildProjectArchitectureOverview`
18. `server/src/services/projectStructureTree.service.js` (Lines 1–40)
    - Directory tree construction: `buildProjectStructureTree`
19. `server/src/services/architectureAiSummary.service.js` (Lines 1–186)
    - AI summarization engine, prompt template, memory caching, and fallback logic: `getArchitectureAiSummary`
20. `server/src/services/gemini.service.js` (Lines 1–186)
    - Google Generative AI integration and model resolution: `generateText`
21. `server/src/services/job.service.js` (Lines 314–360, 529–550)
    - Job creation and progress management: `createAnalysisJob`, `updateJobProgress`
22. `server/src/services/queue.service.js` (Lines 161–163, 290–309)
    - BullMQ queue registration and job dispatching
23. `server/src/utils/projectStructureId.util.js` (Lines 1–14)
    - SHA-256 stable hashing for node, edge, and function IDs
24. `server/prisma/schema.prisma` (Lines 77–134)
    - Database models: `ProjectSnapshot`, `ProjectStructureAnalysis`, `Job`, `Project`
25. `server/src/tests/projectStructure.route.test.js` (Lines 82–100)
    - Route separation and data contract validation tests for architecture analysis
