# Feature Specification: Project Structure Analyzer

**Feature Branch**: `001-project-structure-analyzer`

**Created**: 2026-08-04

**Status**: Draft

**Input**: User description: "Technical Specification: Project Structure Analyzer"

## Clarifications

### Session 2026-08-04

- Q: Bạn muốn kết quả phân tích được lưu và quản lý theo mô hình nào? → A: Lưu kết quả phân tích mới nhất cho mỗi project/snapshot; lần chạy thành công mới thay thế kết quả cũ.
- Q: Những ai được phép tạo phân tích và đọc kết quả mới nhất của một project? → A: Chỉ chủ project được tạo phân tích và đọc kết quả.
- Q: Khi chủ project yêu cầu phân tích, API nên xử lý kết quả theo cách nào? → A: Xử lý bất đồng bộ; API trả trạng thái/job ID và giao diện theo dõi tiến trình.
- Q: Mỗi lần phân tích nên chạy trên snapshot nào của project? → A: Mặc định dùng snapshot mới nhất nhưng cho phép chủ project chọn snapshot cụ thể.
- Q: Nếu chủ project yêu cầu phân tích mới trong khi một job phân tích khác đang chạy, hệ thống nên xử lý thế nào? → A: Không tạo job mới; API trả về job đang chạy hiện tại.

### Session 2026-08-04 — Compatibility and boundary decisions

- `POST /projects/:id/run-analysis` remains the start URL. It returns legacy `data.job`, `needsTests: false`, and `snapshotId` fields together with top-level `job` and `reused`; static analysis never requires Jest.
- Database and API job status values are `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, and `CANCELED`. Consumers display `SUCCESS` as “completed”.
- `GET /api/files` accepts `projectId` and optional `snapshotId`, never `rootDir`; the server resolves an owned snapshot and returns normalized relative paths only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Analyze a project snapshot (Priority: P1)

As a platform operator, I want to analyze a project snapshot and receive a complete, structured description of its source files so that downstream CovAI features can reason about the project's architecture without inspecting files independently.

**Why this priority**: A reliable project-wide inventory is the foundation for every other analyzer capability and provides value even when role detection or dependency resolution is incomplete.

**Independent Test**: Run the analyzer against a fixture containing JavaScript and TypeScript files, ignored directories, external packages, and nested folders. Verify that the result contains the expected source inventory, summary, hierarchy, and per-file analysis status.

**Acceptance Scenarios**:

1. **Given** a readable project snapshot containing supported source files and ignored directories, **When** analysis is requested, **Then** every supported source file is represented in the result and ignored directories and excluded files are absent.
2. **Given** a snapshot containing no supported source files, **When** analysis is requested, **Then** the analyzer returns an empty but valid result with zero counts and a user-readable warning rather than failing.
3. **Given** a source file that cannot be read, **When** analysis is requested, **Then** the result records that file as unresolved with an actionable reason and continues analyzing other files.

---

### User Story 2 - Explore architecture and dependencies (Priority: P1)

As a developer onboarding to an unfamiliar project, I want each file and folder classified by architectural role and connected to its internal and external dependencies so that I can understand system boundaries, common patterns, and the impact of a change quickly.

**Why this priority**: Architecture context is the main user-facing value of the feature and is required for visual onboarding and safe impact analysis.

**Independent Test**: Analyze a fixture with route, controller, service, component, hook, and utility files using both module formats. Verify role labels, module-format labels, architecture summary, forward dependency edges, and reverse dependency edges.

**Acceptance Scenarios**:

1. **Given** files whose names, locations, and contents indicate recognized backend or frontend roles, **When** analysis completes, **Then** each applicable file and folder has a role label and files with insufficient evidence are labeled `unknown` rather than assigned a misleading role.
2. **Given** a project containing both supported module formats, **When** analysis completes, **Then** the result identifies the format per file and reports the project as mixed.
3. **Given** a file with a resolvable relative import or require reference, **When** analysis completes, **Then** the result contains an internal edge from the importing file to the imported file and a reverse `importedBy` relationship.
4. **Given** a file referencing an installed package, **When** analysis completes, **Then** the result classifies the package as an external dependency and distinguishes production use from testing/tooling use when the project manifests provide that information.
5. **Given** a literal dynamic import or a non-literal dynamic import, **When** analysis completes, **Then** the literal reference is resolved using the same project rules as static imports, while the non-literal reference is retained as unresolved context with its reason.

---

### User Story 3 - Inspect functions and their test context (Priority: P2)

As an AI test-generation workflow, I want a complete function catalog with stable source locations, export visibility, and direct dependency context so that generated unit tests can target the right public or internal function and mock known dependencies.

**Why this priority**: Function-level context turns the project graph into useful input for accurate test generation, but it depends on the project inventory and dependency graph from the higher-priority stories.

**Independent Test**: Analyze a fixture containing declarations, expressions, arrow functions, methods, asynchronous functions, exported functions, and private helpers. Verify that each function record has a deterministic identifier, name or generated label, source range, parameters, asynchronous status, export status, and containing file.

**Acceptance Scenarios**:

1. **Given** a supported source file containing named and unnamed function forms, **When** analysis completes, **Then** every recognized function has one catalog entry with a deterministic identifier and source line range.
2. **Given** an asynchronous or synchronous function, **When** analysis completes, **Then** its catalog record reports the corresponding asynchronous status.
3. **Given** an exported function and a private helper, **When** analysis completes, **Then** their records distinguish public export visibility from internal visibility.
4. **Given** a cataloged function in a file with known dependencies, **When** a consumer requests its context, **Then** the context can identify the containing file and that file's direct internal and external dependencies without requiring a second source scan.

---

### User Story 4 - Consume a stable project graph (Priority: P2)

As a frontend or AI consumer, I want one consistent hierarchical graph with summary metadata so that I can render an architecture map, provide onboarding context, and identify files affected by a dependency change from the same analysis result.

**Why this priority**: A unified result prevents consumers from rebuilding inconsistent views from separate partial analyses.

**Independent Test**: Compare the output of the analyzer with a known fixture and verify that folder nodes contain nested file nodes, node identifiers are unique, file metadata is attached to the correct node, and summary counts agree with the graph contents.

**Acceptance Scenarios**:

1. **Given** a nested project structure, **When** analysis completes, **Then** the result contains a hierarchical tree preserving the relative folder and file relationships.
2. **Given** a file node, **When** a consumer reads the node metadata, **Then** it can access the file role, language, function count, imports, reverse dependents, and analysis warnings.
3. **Given** dependency edges and a selected file, **When** a consumer follows reverse relationships, **Then** it can identify direct dependents for impact analysis.
4. **Given** any valid analysis result, **When** a consumer validates its summary against the graph, **Then** total file, function, and exported-function counts are internally consistent.
5. **Given** a project/snapshot with a completed analysis, **When** an authorized consumer requests the project structure again, **Then** the latest stored result is returned without requiring a new scan.
6. **Given** an authenticated user who does not own the project, **When** that user attempts to start an analysis or read its stored result, **Then** the request is denied and no project structure, snapshot details, or analysis status is disclosed.
7. **Given** the project owner starts an analysis, **When** the request is accepted, **Then** the API returns an analysis job identifier and status, and the consumer can observe `queued`, `running`, `completed`, or `failed` until the job reaches a terminal state.
8. **Given** a new analysis is queued or fails, **When** the owner requests the project's stored result, **Then** the previous completed result remains available until a newer analysis completes successfully.
9. **Given** a project has multiple snapshots, **When** the owner starts analysis without specifying a snapshot, **Then** the newest available snapshot is used; **When** the owner specifies a valid snapshot, **Then** the job and stored result are associated with that selected snapshot.
10. **Given** an active analysis job already exists for the requested project/snapshot target, **When** the owner requests the same analysis again, **Then** the API returns the existing job identifier and does not create duplicate processing.

### Edge Cases

- The analyzer must ignore `node_modules`, `.git`, build artifacts, coverage output, framework caches, lock files, environment files, binary files, and media archives according to the supported exclusion rules.
- A malformed source file must not prevent analysis of the remaining snapshot; it must produce a file-level diagnostic with path and reason.
- A relative dependency that cannot be mapped to a physical file must remain visible as unresolved, including the original specifier and resolution reason.
- A dependency with an unsupported alias, package export condition, or non-literal path must not be guessed; it must be marked unresolved.
- An unauthenticated request or a request from a user who does not own the project must not access, start, or infer the existence of an analysis result for that project.
- A new analysis may be running while a previous completed result is still available; a failed job must expose an actionable failure state without deleting the previous result.
- A requested snapshot that does not exist or does not belong to the project must be rejected before an analysis job is created.
- Repeated requests for the same project/snapshot target while an analysis job is active must be idempotent and must not create duplicate work.
- A project may contain several package manifests, such as separate client and server applications. External dependencies must be aggregated without duplicate names and retain enough origin information to distinguish where they were declared.
- A project may use ESM, CommonJS, or both. The result must report `ESM`, `CommonJS`, `Mixed`, or `Unknown` at project level and the applicable format at file level.
- Files with no detectable architectural role must use `unknown`; ambiguous role evidence must not be presented as a high-confidence classification.
- Anonymous or otherwise unnamed functions must receive deterministic generated names based on their containing construct and source location.
- Repeated analysis of the same unchanged snapshot must produce stable node, edge, and function identifiers.
- Symbolic or computed imports that cannot be resolved statically must be reported as unresolved context rather than causing analysis to fail.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The analyzer MUST accept a project snapshot root and inspect its nested directories without executing project source code.
- **FR-002**: The analyzer MUST include JavaScript and TypeScript source files with the supported extensions `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, and `.tsx`.
- **FR-003**: The analyzer MUST exclude configured generated, dependency, cache, environment, lock-file, binary, and media content from the source inventory.
- **FR-004**: The analyzer MUST produce a valid result for an empty or partially unreadable snapshot and MUST expose file-level warnings or errors instead of silently dropping failures.
- **FR-005**: The analyzer MUST classify files and folders using the recognized backend and frontend architectural roles: route, controller, service, middleware, model or repository, validator, config, utility, test, component, page or view, hook, context, layout, and style.
- **FR-006**: The analyzer MUST support ESM and CommonJS syntax and MUST report module format at both file level and project level.
- **FR-007**: The analyzer MUST inspect static imports, re-exports, CommonJS require references, and literal dynamic imports.
- **FR-008**: The analyzer MUST resolve supported relative references to the corresponding physical source file using extension and index-file rules, and MUST record unresolved references with their original specifier and reason.
- **FR-009**: The analyzer MUST identify external package references from all relevant package manifests and distinguish production dependencies from development, testing, or tooling dependencies where declared.
- **FR-010**: The analyzer MUST expose both forward dependencies (`imports`) and reverse dependencies (`importedBy`) for each analyzed file.
- **FR-011**: The analyzer MUST create a dependency graph whose nodes identify analyzed files and whose edges identify the relationship type, including internal imports and external package references.
- **FR-012**: The analyzer MUST catalog every recognized function-like construct in supported source files, including declarations, expressions, arrow functions, and methods.
- **FR-013**: Each function record MUST include a deterministic identifier, name or generated label, containing file path, start and end lines, parameter names or patterns, asynchronous status, and export visibility.
- **FR-014**: The analyzer MUST distinguish exported functions from internal helpers for both ESM and CommonJS export patterns that can be established statically.
- **FR-015**: The analyzer MUST combine inventory, role, dependency, function, and diagnostic data into one hierarchical project tree and summary.
- **FR-016**: Folder and file identifiers MUST be unique within one result, and identifiers for the same unchanged snapshot MUST be stable across repeated analyses.
- **FR-017**: The summary MUST expose total files, total functions, exported-function count, detected architecture pattern when evidence is sufficient, project module format, and external dependency names.
- **FR-018**: The result MUST make unresolved references, parse failures, unsupported syntax, and classification uncertainty distinguishable from successfully analyzed data.
- **FR-019**: The result MUST be serializable and consumable by downstream visualization, onboarding, AI test-generation, and impact-analysis workflows without requiring those consumers to rescan source files.
- **FR-020**: The analyzer MUST preserve relative paths within the snapshot and MUST NOT expose environment-file contents, credentials, tokens, or other secret values in the result or diagnostics.
- **FR-021**: The system MUST persist the latest completed analysis result for each project/snapshot association and MUST replace that stored result when a newer analysis completes successfully.
- **FR-022**: Every operation that starts an analysis or reads project-derived analysis, file, snapshot, or job data MUST require an authenticated user and MUST verify `req.user.id` against the owning project server-side; `Job.userId` alone is insufficient authorization.
- **FR-023**: Authorization failures MUST return a user-safe not-found error without exposing project existence, snapshot metadata, `rootDir`, `storagePath`, file paths, dependency data, job status, or analysis status to a non-owner.
- **FR-024**: Starting an analysis MUST enqueue an asynchronous analysis job and return a job identifier/status queryable by the owning user. `POST /projects/:id/run-analysis` MUST retain legacy `data.job`, `needsTests: false`, and `snapshotId` fields while also returning top-level `job` and `reused`.
- **FR-025**: An analysis job API MUST expose the stable persisted states `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, and `CANCELED`, together with safe completion/failure information. Consumers display `SUCCESS` as completed.
- **FR-026**: The system MUST NOT replace the latest completed stored result when a new job is merely queued, running, or failed.
- **FR-027**: An analysis request MUST accept an optional snapshot identifier; when omitted, the system MUST select the newest available snapshot for the project, and when supplied, MUST verify that the snapshot belongs to the authorized project before creating the job.
- **FR-028**: Each analysis job and stored analysis result MUST identify the snapshot that was analyzed so consumers can distinguish results from different project versions.
- **FR-029**: When an active analysis job already exists for the requested project and snapshot target, a repeated request MUST return the existing job identifier and MUST NOT create a second active job for that target.
- **FR-030**: `GET /api/files` MUST require a project identifier and resolve an owned selected/newest snapshot server-side. It MUST reject client-supplied filesystem paths and return only normalized relative source paths.

### Analysis Result Contract

The result MUST contain the following conceptual sections, with names and relationships stable enough for downstream consumers:

- **Summary**: aggregate counts, detected architecture pattern, module-format summary, and deduplicated external dependency list.
- **Dependency graph**: file and package nodes plus typed edges for internal imports, reverse dependents, external package references, and unresolved references where applicable.
- **Hierarchical tree**: nested folder and file nodes. File nodes include path, display name, role, language, function records, imports, imported-by relationships, and diagnostics.
- **Function catalog**: stable function records with source location, parameters, asynchronous status, and export visibility.
- **Diagnostics**: non-fatal warnings and errors with affected path or reference, category, and actionable explanation.

The first release does not infer runtime execution paths or guarantee a function-to-function call graph. It provides the module dependency graph and function metadata required for consumers to build richer views when additional evidence is available.

### Key Entities

- **Project Snapshot**: The bounded source tree being analyzed, including its root and discovered package manifests.
- **Source File**: A supported source file with path, language, module format, architectural role, functions, dependency references, and diagnostics.
- **Package Manifest**: A project manifest that declares production or development external dependencies used for dependency classification.
- **Dependency Edge**: A directed relationship from a source file to an internal source file, external package, or unresolved reference, including relationship type and resolution status.
- **Function Record**: A function-like construct associated with one source file, identified by stable source location and annotated with parameters, async status, and export visibility.
- **Project Tree Node**: A folder or file node that preserves hierarchy and carries analysis metadata for consumer rendering.
- **Analysis Summary**: Aggregate project-level counts and detected architecture information derived from the analyzed nodes.
- **Diagnostic**: A non-fatal explanation of a read, parse, resolution, or classification limitation associated with the affected path or reference.
- **Stored Analysis Result**: The latest completed project graph associated with a project and its analyzed snapshot, including its completion status and creation time.
- **Analysis Job**: An asynchronous execution record associated with an owning project and selected snapshot, including a stable identifier, lifecycle status, timestamps, and failure information when applicable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a representative fixture of up to 1,000 supported source files, the analyzer returns a complete result within 30 seconds on the project's standard analysis environment.
- **SC-002**: 100% of supported, readable source files in a fixture are represented either as successfully analyzed nodes or as nodes with an explicit diagnostic; no file is silently omitted.
- **SC-003**: At least 95% of literal relative dependency references in the conformance fixture resolve to the correct physical source file, including extension and index-file variants.
- **SC-004**: At least 95% of named functions in the conformance fixture are represented with correct source ranges, asynchronous status, and export visibility; unsupported or ambiguous constructs are explicitly diagnosed.
- **SC-005**: In a mixed-format fixture, 100% of files with detectable ESM or CommonJS syntax receive the correct file-level format, and the project-level format is reported as `Mixed`.
- **SC-006**: The counts in the summary match the corresponding nodes and function records in 100% of valid conformance results.
- **SC-007**: At least 90% of test users can locate a selected file's role, direct dependencies, direct dependents, and exported functions within five minutes using a consumer view built from the result alone.
- **SC-008**: Re-running analysis on an unchanged snapshot produces identical identifiers and equivalent graph relationships in 100% of repeatability checks.
- **SC-009**: A malformed or unreadable file does not prevent successful analysis of at least 99% of other readable supported files in the same fixture.

### Verification Commitments

- SC-001 uses a 1,000-file benchmark with a 30-second ceiling.
- SC-004 and SC-005 use checked fixture oracles for the stated percentages.
- SC-007 uses a ten-user task protocol; at least nine users must complete the specified discovery tasks within five minutes.
- SC-008 compares identifiers and graph relationships from repeated unchanged runs while excluding timestamps.
- SC-009 uses malformed/unreadable fixture input and verifies the stated remaining-file percentage plus diagnostics.

## Assumptions

- The first release analyzes one bounded snapshot at a time and does not execute source code, install dependencies, or inspect files outside the snapshot root.
- JavaScript and TypeScript are the only supported source languages for this release; other languages are ignored rather than partially interpreted.
- Relative imports, conventional extension resolution, and index-file resolution are the primary internal dependency cases. Arbitrary aliases and runtime-generated paths are reported as unresolved unless the snapshot provides explicit resolution evidence.
- Package manifests may exist at the root and at application boundaries such as `client/` and `server/`; their declared dependency categories are the source of truth for external dependency classification.
- Role detection is heuristic and evidence-based. Consumers must be able to distinguish a confident role from `unknown` or ambiguous classification.
- A stable relative path plus source location is sufficient for deterministic identifiers; identifiers do not need to remain stable if a file or function moves.
- The downstream CovAI platform will provide authentication and snapshot retrieval. Analysis operations enforce project ownership, and only the owning user may start or read an analysis.
- This feature includes persistence of one latest completed analysis result per project/snapshot association.
- A newly completed analysis replaces the prior stored result for the same project/snapshot association; retaining historical results is outside the first release.
- Analysis execution is asynchronous; the API exposes job status while the consumer presents loading, success, and failure states to the project owner.
- The consumer defaults to the newest available snapshot while allowing the project owner to select an older available snapshot for repeatable analysis.
- At most one active analysis job exists for a given project/snapshot target; repeated requests for that target reuse the active job.
- Runtime call tracing, code execution, semantic type checking, and automatic alias configuration discovery are outside the first-release scope.
