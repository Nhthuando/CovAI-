# AI Context Configuration - Conversation Memory

Date: 2026-10-10
Status: Revised proposal for user review; implementation has not started.

## User intent

The user clarified that the task should let AI remember prior conversations, similar to Copilot in VS Code. The earlier file/category configuration proposal is superseded. The task title alone is not an authoritative specification: no matching task description was found in the repository or readable backlog artifacts.

Outcome: reopening a chat continues its context, and starting another chat in the same project can recall useful prior decisions without sending every historical conversation to the model.

## Research and existing behavior

VS Code documents session, repository and user memory separately. Repository memory persists across conversations in a workspace. Session history is a record that can be reopened; memory stores selected reusable knowledge. GitHub's separate Copilot Memory feature also stores facts/preferences with evidence and validation. These are design references, not a claim that all Copilot products share one implementation.

CovAI already has ChatSession and ChatMessage tables with project/user scoping, persisted messages, history search and session selection. AIPanel loads an old session into frontend state and sends that state as history. The backend chat handler trusts this supplied history rather than reconstructing authoritative context from stored messages. There is no persistent cross-session memory, session summary or automatic restoration of the selected session after reload.

Sources:
- https://code.visualstudio.com/docs/agents/run/memory
- https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions
- https://docs.github.com/en/copilot/concepts/agents/copilot-memory
- https://ai.google.dev/gemini-api/docs/tokens

## Options

1. **History + session summaries + project memory (recommended).** Supports continuing a session and recalling decisions in a new chat, while keeping context bounded and inspectable.
2. **History only.** Reopening an old chat works, but new chats do not recall useful decisions. Too narrow for the clarified outcome.
3. **Semantic search over every historical message.** Useful at larger scale, but introduces embeddings/indexing, retrieval tuning and additional infrastructure. Not needed for the first version.

## First-version behavior

### Continue conversations

Remember the last explicitly selected chat per authenticated user/project in the browser. Restore that owned session on reload; if it was deleted or inaccessible, open an empty chat with an understandable state. An intentional New Chat action clears the selected-session pointer and starts a fresh transcript.

Backend loads the owned session's persisted messages, ordered deterministically, and constructs history itself. Do not accept client-supplied history as authoritative. Validate ownership of both project and explicit session before quota use, attachments or model calls; an invalid supplied session must not silently become another chat.

Keep recent turns verbatim. Compact older turns into a persisted session summary when the configured context budget would be exceeded. Summaries have a through-message cursor and preserve goals, accepted decisions, outstanding questions and unresolved work. They do not replace the stored transcript. If summarization fails, use bounded recent history and disclose that older context was omitted rather than pretending complete recall.

### Remember across chats

Persist memory scoped to the project AND authenticated user. Candidate memories come from explicit user requirements, decisions and stated preferences in successful chat interactions; generated assistant claims alone are not authoritative facts. Examples: preferred test framework, an agreed business rule, response language, and an accepted testing approach.

With automatic memory enabled, extract structured notes asynchronously after a successful exchange. Validate schema, length, source message ownership and deduplicate before storing. Each memory retains evidence links to its originating chat/messages, creation/update timestamps and status. Failures in extraction do not turn a successful chat into an error.

Retrieve a small relevant subset for subsequent chats in the same project using a bounded deterministic relevance policy (explicit pinned notes first, then textual relevance and recency). Insert them as separately labeled historical preferences/decisions, not as overriding system instructions. Do not claim exact recollection of an entire older conversation.

A conflicting new requirement supersedes an older note when explicit; ambiguity is shown for review rather than silently merging contradictory facts. Current source and current user instructions take precedence over remembered descriptions. Snapshot-derived implementation facts must be revalidated before reuse; first-version automatic extraction does not promote arbitrary assistant source-code claims into persistent facts.

### Configure and inspect

Add a Context & Memory entry within the AI panel for the selected project. Show automatic-memory enabled state, saved notes, origin chat, and last update. Allow adding a note explicitly, editing, pinning, forgetting one, and clearing all saved memories with a concrete confirmation.

Automatic memory defaults off for existing projects until the owner enables it. Session continuation and bounded history work independently. Turning automatic memory off disables both automatic extraction and automatic cross-session injection; stored notes remain viewable until deleted. The UI explains this behavior.

Deleting a chat removes summaries and memories derived solely from that chat. Manually created notes are independent; notes with surviving evidence may remain. Clearing memory removes derived notes and any retrieval cache but does not delete transcripts. Previously sent prompt context cannot be removed retrospectively from old replies.

## Architecture and persistence

Extract chat orchestration from project.controller.js into a focused service, retaining existing routes and response shape. Add focused history/summary, memory persistence/retrieval and extraction services. Reuse existing Gemini generation and BullMQ infrastructure; no new vector database or provider SDK migration.

Add additive Prisma models/fields for user-project memory settings, bounded memory records with source relations, and session summary/cursor. Foreign keys and cascades enforce deletion semantics. Use optimistic concurrency for edited notes/settings. Serialize or conflict-detect summary/extraction work per session so delayed jobs cannot resurrect deleted memories or overwrite newer choices.

Every settings/memory/context endpoint verifies project ownership and session/message provenance. Scope every query to user and project; never mix context across projects or users. Validate lengths, roles and supported attachments; omit unsupported expired attachments rather than treating old browser object URLs as recoverable files. Do not persist API keys or credentials as memory.

Bound history, summaries, selected notes, attachments and final prompt size. Byte limits are safety guards, not exact token counts; Gemini counts system instructions and other input toward its context window. Preserve task-specific output and validation contracts.

This version integrates memory with conversational chat. Automatically injecting conversational memories into every test-generation runner is deferred: generated tests must continue to use current verified code/analysis. A later extension can apply explicitly approved testing preferences to those consumers.

## Acceptance and verification

- A persisted session reopens after refresh and continues correctly without a client history payload.
- A new session can use enabled relevant memory from earlier sessions of the same user/project.
- Memory is disabled when configured off; unrelated projects/users never retrieve it.
- Owner can inspect evidence, edit/pin/forget notes and clear memory; unauthorized reads/writes fail.
- Summaries preserve important early decisions while history stays bounded and full transcripts remain available.
- Failed summarization/extraction does not falsely claim memory saved or fail an otherwise successful chat.
- Deleting chats/notes while jobs run does not resurrect their contents; concurrent summary updates preserve cursor correctness.
- Tests assert actual prompts with mocked model responses, not just database persistence. Browser checks cover restore, New Chat, memory management, errors and mobile layout.
- Run focused Jest suites, Prisma validation/generation, changed-file lint and frontend build. Verify live UI/API/database flows with dedicated data. Report explicitly whether live Gemini generation/extraction was exercised.

## CovAI-specific scope refinement (research proposal)

The user asked what else would make this task appropriate for CovAI. The following is a proposed refinement, not approval to implement every addition.

| Priority | Capability | CovAI-specific value |
| --- | --- | --- |
| Essential | Authoritative persisted chat history and selected-session restoration | Continue work after refresh without depending on frontend-supplied history. |
| Essential | Inspectable cross-session memory and session compaction | Preserve accepted decisions and outstanding work without replaying all conversations. |
| Essential | Explicit project guidance | Store approved business rules, testing conventions and language separately from inferred memories. |
| Essential | Snapshot provenance and fresh analysis context | Bind technical observations to snapshot/commit, analysis timestamp and target package; avoid using old coverage or source facts after import/restore/edit. |
| Essential | Context inspection and controls | Show which notes, files and analyses a request uses, where they came from, and what was omitted; expose forget/reset controls. |
| Next | Focused file/function context | Resolve the user's selected file/function on the server, attach current coverage gaps, related tests and bounded dependencies; support full-workspace client/server paths. |
| Next | Explicit testing guidance in generation consumers | Apply approved framework/business/testing rules to unit/integration/system prompts while preserving current-code evidence and mandatory validation. |
| Later | Semantic history/code retrieval | Consider embeddings only after deterministic bounded selection demonstrably fails on realistic projects. |

Keep three kinds of information distinct: conversation history/summary; durable user-approved guidance or sourced memories; and current source/analysis evidence. Suggested precedence is server contracts, the current user request, explicit approved guidance, current verified evidence for factual questions, then historical memory. A preferred future framework is a requirement, not proof that the current snapshot already uses that framework.

For snapshot changes, retain durable preferences and business requirements. Revalidate technical facts against the selected snapshot; omit mismatches from authoritative context and expose them as stale in memory management. Do not erase all project memory on every commit. Source edits also require content fingerprints because snapshot identity alone does not guarantee unchanged files. Existing aiContextBuilder cache reuse before freshness checks is a concrete integration risk.

Project guidance should be curated rather than copying every chat answer. Example fields: project purpose, approved business rules, test framework preference (Auto/Jest/Vitest where applicable), test style and explanation language. Unknown or undetected runtime facts stay unknown. Conflicting guidance is shown explicitly, and inferred memory does not silently rewrite approved project rules.

Context inspection should display the selected snapshot/commit, analysis package, included file paths and analysis availability, selected memories with evidence, and any compaction/omissions. Token counts are labeled exact only when counted for the actual effective model and assembled input using provider support; otherwise use clearly labeled estimates or byte counts. Reserve space for the model output. Do not equate the current 20 MiB payload guard with a token-window guarantee.

Acceptance examples:
- Earlier chat: user specifies that completed todo items must not be edited. New chat in that project recalls this as a user-stated business rule with an origin link.
- The same user opens another project: the todo rule is not injected.
- A new snapshot changes server/index.js: old line references and coverage observations are revalidated/omitted, while response-language preference remains.
- User generates a unit test: approved business rules may guide expected behavior, but the current source and AST determine imports, signatures and actual reachable behavior.
- User asks about client code in a monorepo currently analyzed under server: context selection reports the package and unavailable client analysis rather than inventing coverage.

Additional references:
- https://code.visualstudio.com/docs/agents/concepts/context
- https://code.visualstudio.com/docs/agent-customization/custom-instructions
- https://code.visualstudio.com/docs/agents/reference/workspace-context

## Explicit conversation/context selection (2026-10-10 proposal)

The user requested a context choice similar to selecting a new or previous Codex conversation. Official OpenAI documentation distinguishes resume (continue the saved conversation) from fork (create a new conversation from the old one without changing the original): https://learn.chatgpt.com/docs/developer-commands?surface=cli . CovAI should make these semantics explicit.

Use three primary actions:

| Action | Session behavior | Conversation context |
| --- | --- | --- |
| New conversation | Create a new session; keep existing sessions | Empty transcript; optional enabled project memory, explicitly shown |
| Continue conversation | Reopen the selected owned session and append to it | Its persisted summary and recent turns |
| Branch from conversation | Create an independent session with a source reference and fixed fork boundary | A copy of the selected source transcript through the boundary; budgeted summary/recent turns for model input |

The New conversation flow includes a clearly labeled Use saved project memory toggle. Off means no prior conversation summaries or saved memories are injected. Approved project guidance and explicitly selected current files/analysis remain separate context sources and are visible. This is a clean conversational start, not a contextless model request. The toggle cannot bypass globally disabled memory; extraction/read settings remain explicit.

Provide a searchable conversation picker restricted to the authenticated user and selected project. Each row shows title, last activity, a short preview and snapshot metadata when available. Separate Continue and Branch actions prevent accidentally appending an unrelated task to an old transcript. One source conversation per branch in the first version; no implicit merging of multiple histories.

Keep a compact header showing session title, new/continued/branched state, source conversation when relevant, selected snapshot, and memory enabled/disabled. A context inspector shows inherited context and omissions. Show the source summary before confirming a branch if input needs compaction; label summarized context rather than promising every historical detail will fit.

Branching copies persisted messages up to an explicit deterministic cursor, or materializes equivalent inherited context with durable provenance. It must not be a live reference that silently changes when the source receives new messages. Source edits/deletion cannot corrupt the branch; copied evidence and subsequent memory deletion policies must be reconciled in the delivery plan. Branch deletion affects only that branch. Forked historical context is not automatically extracted again as newly stated memory.

For a mid-conversation branch, the selected message cursor is the boundary. Branch-from-latest is sufficient for the initial UI; a per-message branch action can follow. Historical attachments are inherited only when their data is durably available and supported; expired browser object URLs are explicitly omitted.

Creating/resuming/branching a session does not modify repository files, restore a checkpoint, run tests or generate code. The target request uses the currently selected snapshot and revalidates historical code facts; any mismatch between the source conversation snapshot and the current snapshot is visible. All source session/cursor/snapshot IDs are verified server-side against ownership and project scope.

Acceptance additions:
- Continue appends to the same session; New and Branch receive new IDs without deleting old sessions.
- New with memory off sends no historical conversation or saved-memory content.
- Branch inherits only the authorized source up to its boundary, leaves the source unchanged and does not absorb later source turns.
- Unauthorized sources, cursors outside a session and cross-project sources are rejected before model calls.
- Refresh restores the selected mode/session; an intentional New choice does not silently resume the previous one.
- Snapshot mismatch, missing attachments and context compaction are visible.
