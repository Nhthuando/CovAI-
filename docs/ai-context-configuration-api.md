# AI Context Configuration

Studio's **Context** button opens Conversations, Memory & rules and Current context.

- **New conversation** keeps previous chats and starts an empty transcript. Saved project memory is optional. Approved project rules still apply.
- **Continue** loads an existing owned conversation. The selected conversation (or intentional new state) is restored per user/project on reload.
- **Create branch** previews the source context and materializes an independent copy. Deleting the source does not delete the branch. Summary cursors are mapped to copied message IDs; source snapshot provenance remains visible.
- **Automatic project memory** defaults off. Turning it off stops extraction and recall, while retaining saved notes. A per-conversation switch can exclude memory while keeping its own transcript.
- Notes can be added, edited, pinned, forgotten or cleared. Extracted notes are exact quotes of explicit user decisions with a source conversation. Potential conflicts remain excluded until reviewed. Saving a review note explicitly accepts it and forgets its conflicting predecessor.
- **Current context** shows snapshot, saved coverage, approved rules, summaries, selected notes, omissions and maintenance status. Relevance can change with the next question.

## API

All routes are under `/api/projects/:id`, require authentication and verify project ownership using the authenticated user. Explicit foreign sessions, snapshots and note IDs are rejected. Client-supplied history is ignored; persisted server messages are authoritative.

| Method | Route | Body / behavior |
| --- | --- | --- |
| GET / PUT | `/ai-context` | PUT `{ automaticMemory, guidance, revision }`; stale revision returns 409 |
| GET / POST / DELETE | `/ai-context/memories` | POST `{ content, pinned }`; DELETE forgets all notes, retains chat and rules |
| PATCH / DELETE | `/ai-context/memories/:memoryId` | PATCH `{ content, pinned, revision }`; DELETE forgets one note |
| POST | `/ai-context/preview` | `{ sessionId?, snapshotId?, useMemory?, message? }` |
| GET / POST | `/chat/sessions` | POST `{ title?, snapshotId?, useMemory? }` |
| GET / PATCH / DELETE | `/chat/sessions/:sessionId` | GET returns `{ session, messages, truncated }`; PATCH `{ title }` |
| POST | `/chat/sessions/:sessionId/branch` | `{ throughMessageId?, title?, snapshotId?, useMemory? }`; omitted boundary copies through the latest message |
| POST | `/chat` | `{ message, sessionId?, snapshotId?, useMemory?, model?, attachments? }`; returns reply, session ID/title and context metadata |

Responses preserve `{ success, data }`. A message pair is saved atomically only after successful AI generation. A ten-minute scoped lease prevents overlapping turns in one conversation. Provider failure returns 503 without persisting the turn. Maintenance failure never converts a saved reply into a failed chat.

## Storage and lifecycle

Two additive migrations introduce context settings, memories, session summaries/leases, conflict references and branch snapshot provenance. Run `npx.cmd prisma validate`, `npx.cmd prisma generate` and `npx.cmd prisma migrate deploy` from `server/` before starting a deployed API. Restart existing API processes after generating the client. No new environment variables, SDK or external services are required.

Existing Gemini and the `CHAT_CONTEXT` BullMQ job maintain summaries and memory after successful turns. Redis-unavailable development environments use the existing in-memory fallback; fallback jobs are not durable across process restarts. The inspector distinguishes READY, PENDING and FAILED. A settings memory-generation guard prevents delayed extractions from resurrecting cleared/edited notes. Forgotten-note hashes remain as tombstones; forgotten content is erased. Removing a source chat cascades its extracted memories. Branch copies have independent message IDs and summary state.

## Limits and scope

- Guidance: 8,000 characters. Notes: 1,000 characters, 100 active/review notes; recall at most eight notes within 6,000 UTF-8 bytes.
- Recent prompt history: at most 24 turns within 40,000 content bytes, plus an available summary (8,000 characters). Stored history remains intact.
- Message: 16,000 characters. Five attachments; referenced source files at most 100 KB. Current referenced files are resolved from the owned snapshot, with path traversal protection and credential-file exclusion. Earlier images are not automatically resent.
- Total prompt: 180,000 UTF-8 bytes, attachment payload: 2.5 MB. These are bounds, not exact token counts.
- Session listing: latest 100; transcript UI: latest 2,000 messages with a truncation flag. Branching rejects transcripts above 2,000 messages or 5 MB inherited attachments.
- Current saved coverage and snapshot metadata are included. Historical code claims and attachments are not proof about a changed snapshot. No vector search, arbitrary repository-wide indexing, provider migration or changes to structured test-generation contracts are included.

## Verification

From `server/`, run the focused Jest suites `aiContext.test.js`, `chatContextPrompt.test.js`, `chatMemoryMaintenance.test.js`, `projectExport.test.js` and `projectStructure.route.test.js`. The feature suites verify auth/scope, revisions, memory lifecycle, conflicts, branching/summary provenance, actual prompt assembly, cursor bounds, leases and failure handling.

With Vite running, execute `node tools/verify_ai_context_ui.mjs` from the root (`CONTEXT_UI_URL` defaults to `http://127.0.0.1:5175`). It uses controlled API responses to test settings, notes, keyboard focus, resume/reload, branch, new-chat reload, memory exclusion, clear, error recovery and mobile rendering. Screenshots are local ignored artifacts under `output/context-preview/`.

With the local API running, `node tools/verify_ai_context_live.mjs` verifies the real database/API/Gemini/maintenance path and production UI restore. It creates and cleans a dedicated temporary user/project, uses real model calls and never changes existing project data. `CONTEXT_API_URL` defaults to `http://127.0.0.1:5000/api`. Add `--ui-only` to seed a clearly labelled fixture and verify the production UI/API/database independently of the model provider; this mode does not claim extraction or Gemini generation was tested.

Extraction requests use a bounded JSON output schema, followed by strict Zod validation and exact user-quote checks, as supported by the [Gemini Generate Content API](https://ai.google.dev/api/generate-content).

Verified locally: both migrations applied to the configured development database; Prisma validate/generate, 59 focused/regression tests, production client build, browser scenarios, actual Gemini memory recall and production UI/API restore passed. Redis was unavailable for the live check, so maintenance exercised the in-memory fallback rather than a live Redis worker. A later provider interruption produced FAILED maintenance while preserving the saved reply; model availability is external and the UI exposes the failure. The repository still has pre-existing frontend lint findings; the new dialog/client service are lint-clean.
