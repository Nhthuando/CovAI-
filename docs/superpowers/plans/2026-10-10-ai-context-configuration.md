# AI Context Configuration Implementation Plan

**Goal:** Durable project chat context with resume, independent branches, inspectable memory and snapshot-aware prompts.

**Architecture:** Authenticated context routes use focused chat/context/memory services. PostgreSQL stores settings, notes, summary cursors and fixed branch transcripts; existing Gemini and BullMQ perform generation and asynchronous memory extraction. Studio retains its existing conversation drawer and adds a context dialog.

**Tech Stack:** Express, Prisma/PostgreSQL, Zod, Gemini, BullMQ, React/Vite, Jest/Supertest, Playwright.

## Constraints

- User-approved design: `docs/ai-context-configuration-design.md`.
- Every read/write validates project ownership and session/message scope before model calls.
- Preserve existing routes and response shapes; generation runners retain their verified contracts.
- Existing projects default automatic memory off. Explicit project guidance and selected current analysis are independent from cross-session memory.
- A new chat with memory off receives no old transcript or saved notes. Branches copy a fixed transcript, never a live parent reference.
- Source/commit facts are snapshot-bound; byte limits are not advertised as exact token counts.
- No secrets in logs, memory, migrations or test evidence. No model training, embeddings, vector DB or SDK migration.

## Task 1: Storage and contracts

- [x] Add project context settings, memory notes/provenance/tombstones and session context/summary/lease fields to Prisma with additive SQL.
- [x] Validate migration SQL, Prisma schema and generate client. Apply only the reviewed additive migration to the configured development DB.
- [x] Add strict validators for settings, note CRUD, branch boundaries and bounded chat requests.
- [x] Tests reject unknown fields, invalid revisions, secrets and excessive attachments/text.

Files: `server/prisma/schema.prisma`, `server/prisma/migrations/20261010000100_ai_context_memory/migration.sql`, `server/src/validators/aiContext.validation.js`.

## Task 2: Owned sessions and memory APIs

- [x] Implement owner-scoped list/create/load/rename/delete and fixed-boundary branch operations.
- [x] Implement revision-aware settings/notes, pin/edit/forget/clear and evidence projections without raw credentials.
- [x] Retain forgotten-note tombstones and a settings memory generation to prevent delayed work from resurrecting cleared notes.
- [x] Add authenticated routes/controllers and real route tests for auth, source cursors and independent branches.

Files: `server/src/services/chatContext.service.js`, `server/src/services/projectMemory.service.js`, `server/src/controllers/aiContext.controller.js`, `server/src/routes/project.route.js`, `server/src/tests/aiContext.test.js`.

## Task 3: Actual prompt context and maintenance

- [x] Assemble prompts from stored session summary/recent turns, bounded guidance/selected memory and current owned snapshot metadata/available coverage.
- [x] Serialize a chat turn with a recoverable session lease; persist a successful user/assistant pair atomically.
- [x] Compact old turns with a cursor and guarded update; expose missing context/attachment/snapshot warnings.
- [x] Extract bounded explicit user decisions asynchronously through existing BullMQ infrastructure; validate user quotes, provenance, generation and tombstones before saving.
- [x] Treat summary/extraction failures as context maintenance failures, not chat failures; disclose status.
- [x] Tests inspect prompts, memory-off behavior, current snapshots, compaction, lease conflicts and delayed extraction/deletion.

Files: `server/src/services/chat.service.js`, `server/src/services/chatMemoryMaintenance.service.js`, `server/src/services/queue.service.js`, `server/src/tests/chatContextPrompt.test.js`, `server/src/tests/chatMemoryMaintenance.test.js`.

## Task 4: Studio conversation controls

- [x] Add client context APIs and a responsive Context & Memory dialog: settings, approved guidance, inspect included context, note CRUD/pinning/evidence and clear confirmation.
- [x] Integrate new/continue/branch controls, memory toggle, current snapshot and context status into AIPanel without a broad rewrite.
- [x] Persist selected session and intentional-new state per user/project, guard stale async responses and prevent send while restoring/switching.
- [x] Show branch origin, snapshot mismatch, context omissions and failed maintenance honestly.
- [x] Run changed-file lint, build and browser tests for refresh/new/continue/branch/memory on/off/error recovery/mobile.

Files: `client/src/services/aiContext.service.js`, `client/src/components/dashboard/AIContextDialog.jsx`, `client/src/components/dashboard/AIPanel.jsx`, `tools/verify_ai_context_ui.mjs`.

## Task 5: Verify integrated delivery

- [x] Run focused backend suites and relevant existing chat/route regressions.
- [x] Inspect rendered UI desktop/mobile and resolve observable defects.
- [x] Exercise live UI/API/database with dedicated project data; verify real Gemini only when credentials/quota permit, reporting exact scope.
- [x] Document API/configuration/deletion/context limits and update completion evidence.

Files: `docs/ai-context-configuration-api.md` and this plan.

## Completion evidence

- Prisma validate/generate passed; both additive migrations deployed to the configured development database.
- 59 tests across the feature and export/structure regression suites passed.
- Client production build passed. New dialog/service and modified client API service lint passed. AIPanel retains 15 pre-existing errors and one warning (committed baseline: 16 errors, one warning).
- Browser checks passed: settings, notes, keyboard containment, resume/reload, branch, intentional-new reload, memory exclusion, clear, error recovery, mobile and no uncaught page errors.
- Real Gemini chat, asynchronous extraction with source evidence, new-chat recall, independent branch and source deletion/clear passed against dedicated temporary data. Redis was unavailable, so this exercised the existing in-memory fallback. A later intermittent provider failure correctly exposed FAILED maintenance without losing the successful reply.
- Production browser UI with real API/database verified sourced memory and session restore/reload using a labelled seeded fixture; no model calls were claimed for this separate UI check.
- API/lifecycle/limits and reproducible verification commands: `docs/ai-context-configuration-api.md`.
