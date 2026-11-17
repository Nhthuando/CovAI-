# CovAI collaborative editing and project access design

Date: 2026-11-04, Asia/Saigon. Status: proposed execution contract, prepared at the user's request; application implementation has not started.

## 1. Outcome and scope

Deliver project job roles, PM ownership, View/Edit access, presence, shared editing with cursors, safe conflict recovery, and trustworthy line attribution within CovAI's current interface. The same agent executes sequentially with durable task checkpoints. The user performs browser end-to-end acceptance.

This supersedes the earlier suggestion that job titles directly determine module permissions. A member's job role describes responsibility; their access level determines authority. All requested capabilities remain in the delivery scope; the early collaboration prototype is a compatibility gate, not permission to call presence-only work complete.

## 2. Global constraints

- All new product UI, hover text, errors, email copy, tooltips and accessibility labels are English.
- Keep the existing dashboard shell, Members/Pending tabs, editor tabs, Git panel, theme tokens, fonts, icons and responsive navigation.
- Do not add a collaboration page, role-management page, history page or new top-level navigation tab.
- Use React 19, Vite, Monaco, Express, Prisma/PostgreSQL and the existing Socket.IO server. Preserve the current Node 20 container floor.
- Use stable Yjs 13, compatible y-monaco and y-protocols; do not adopt the separately named Yjs 14 release candidate from a repository's main branch.
- Do not add Hocuspocus, a second realtime daemon, a paid collaboration service or an organization hierarchy in this delivery.
- One application server is the supported initial deployment; PostgreSQL is durable authority. Horizontal scaling and offline-first editing are outside scope.
- File size remains at most 1 MiB for editing. Live editing additionally limits text to 20,000 logical lines, encoded document state to 8 MiB and one inbound update to 2 MiB.
- Automatic checks are focused service/protocol tests plus build, changed-file lint and schema validation; the user owns E2E browser flows. No Playwright suite, external AI calls or broad performance campaign.
- Preserve unrelated working-tree changes. No broad refactor, automatic commit, merge, deployment, database reset or secret output.

## 3. Ownership, responsibility and access

Keep `Project.ownerId` and the existing `OWNER`, `EDITOR`, `VIEWER` policy. Add nullable `disciplineRole` to ProjectMember and ProjectInvitation with values `PM`, `DEVELOPER`, `TECH_LEAD`, `TESTER`, `AI_ENGINEER`, `QA_ENGINEER`. Display labels: PM, Developer, Tech Lead, Tester, AI Engineer, QA Engineer. Null displays Unassigned.

The owner always displays PM and Project owner. The account creating/importing a new project owns it; uploading another snapshot does not transfer ownership. An invited PM still has only View or Edit. Ownership transfer is not added.

Member rows have Member, Role, Access and Actions columns. Access display values are View, Edit and Full access; API role values remain compatible. New invitations initially select Developer + View, requiring an explicit choice for Edit. Existing invitations retain their chosen access and get Unassigned if no job role was recorded.

Only the owner can change either attribute, invite/remove members or manage sensitive project configuration. Job-role changes never change capability. Profile `jobTitle` never controls membership. UI helper text explains that Edit also includes existing test/AI/chat/memory contribution rights, while View includes current source/results/shared-context reading and export. Do not quietly turn View into report-only access.

Invitation idempotency identity includes email, access and disciplineRole. Update both invitation projection/acceptance and email content so the recipient sees the same role/access the owner selected. Member PATCH accepts either or both changed attributes and requires expectedRevision; old PATCH requests containing role remain valid.

## 4. Chosen realtime architecture

Use **Yjs for merging, y-monaco for editor binding and an explicit Socket.IO transport adapter**. This is a revision of the research's Hocuspocus candidate: existing Socket.IO, Node 20 and project locks make one server and one authorization boundary preferable here. A custom transport does not implement a custom CRDT; it must implement durable acknowledgments, catch-up and access control described below.

The first execution task proves this contract using two Node clients and an isolated Monaco build entry, without a new product page. If it fails, record the concrete failure and adjust the contract before implementing dependent UI. Do not switch libraries speculatively or conceal a fallback as completed shared editing.

Rollout uses one server flag, `PROJECT_EDITOR_ENABLED`, initially off. The existing access response exposes `features.liveEditing` so clients do not depend on a separate build flag. Disabling new live sessions never disables protection/recovery of already-persisted dirty shared drafts.

### Durable shared draft

`ProjectEditorDocument` stores one active shared draft per project/snapshot/canonical relative path. It contains Yjs binary state, text, content hash, monotonic document revision, generation, baseline file revision/hash and last checkpointed document revision. PostgreSQL serializes accepted edits under the existing project guard; reconstruct a fresh Y.Doc from DB for each accepted batch initially. No mutable global Y.Doc cache is a second authority.

Each document has one shared Y.Text named `content`. Reject unsupported root types, invalid binary state, excessive text/state, stale generation and access loss before persisting. Client generation is context, not authority.

`ProjectEditorUpdate` stores receipt identity `(documentId, generation, actorId, requestId)`, update hash and resulting document revision. Retrying exactly the same request returns its prior receipt and never reapplies or reattributes it. Reusing its ID for different bytes is a conflict. Missing receipt plus a no-op Yjs replay does not create a new author for existing content.

Clients batch local changes for 150 ms, retain one in-flight batch per document and queue subsequent batches. Broadcast only after DB commit. A successful acknowledgment means the draft state and authorship are durable; it does not mean the files used by runners have been updated. Reconnect opens current DB state, applies missing remote state and retries original local batches in order. Do not send a new full-document replacement as a retry.

On disconnection make editing read-only, keep pending content/batches in sessionStorage scoped by user/project/document/generation and say Reconnecting. Do not claim support for continued offline editing. On generation mismatch or lost edit access preserve pending content for copy/download and do not merge it silently into the replacement.

### Workspace checkpoint

Save keeps its existing button/location and means save the current shared file to the workspace. All currently accepted edits in that file are included, not just changes by the person clicking Save. Unsynchronized local batches must be acknowledged first.

Run/AI operations and source export need a deterministic workspace checkpoint. Before a write-capable user starts an operation, checkpoint all dirty shared documents in the selected snapshot in one guarded multi-file publication, with limits matching the current bulk publisher. Refuse an oversized dirty batch with a clear message to save files in smaller groups. Do not keep the project DB lock while executing tests, installing packages, calling AI or Git network operations.

Checkpoint persists files through the current journal/recovery path and updates document baselines and line metadata in the same DB transaction. Keep draft revision distinct from `Project.workspaceRevision`; typing does not increment workspaceRevision or trigger tests. Typing after checkpoint remains in shared draft; a later explicit Save may make a long-running operation stale according to existing safety rules.

Operation admission receives expectedWorkspaceRevision from the checkpoint response and rejects a mismatch; it must not silently run a newer version. Run status identifies the saved workspace revision. Viewers may export the last saved workspace with its revision, but cannot flush somebody else's draft or start a job.

### Other writers and structural changes

Every canonical writer must participate: ordinary HTTP saves, file manager, coverage editors, scenario edit/apply, AI proposals, prepared bulk publication, Git, rename/delete, upload and restore.

Conservative rule: an external replacement touching a dirty shared document returns `EDITOR_DRAFT_CONFLICT`; it cannot overwrite live draft. If the document is clean, replacement creates a new generation from committed file content and refreshes connected clients. Publish the new generation atomically with the canonical mutation. Changing Git metadata only does not reset unchanged text documents.

Rename/delete touching dirty descendants is refused until saved or explicitly recovered. Clean rename moves the document's canonical path, increments generation and directs clients to reopen it; delete closes it. A new active snapshot deactivates old sessions but retains durable draft data for recovery. Do not let an old connection recreate a deleted path or publish into a newer snapshot.

Source export uses saved workspace; viewer exports never mutate state. Commit/branch switch/pull/discard/restore/import first require a clean checkpoint or refuse with a recovery action; they do not auto-merge unsaved collaboration drafts. AI apply retains expected source/test/workspace hashes and uses the same external-writer rule.

## 5. Socket contract

Use the existing server under namespace `/editor`; namespace room joins are server-controlled. Validate JWT at connection and in each sensitive handler, including expiry. User ID is derived from the verified token, then membership is rechecked. CORS/origin configuration matches the existing app.

| Client event | Input | Durable/result contract |
| --- | --- | --- |
| `editor:open` | projectId, snapshotId, path, clientId | canonical documentId, generation, revision, binary state, fileVersion, workspaceRevision, role/capabilities |
| `editor:update` | documentId, generation, requestId, update bytes | receipt with requestId, updateHash, revision, contentHash after commit |
| `editor:sync` | documentId, generation, stateVector | missing update bytes + current revision; authorization required |
| `editor:awareness` | documentId, generation, awareness update | transient validated selection; no authority or durable content |
| `editor:leave` | documentId | unregister connection and awareness |
| `editor:presence` | projectId, snapshotId, activeDocumentId or null | transient active file, server-verified identity |

Server events: `editor:update` with committed revision and bytes; `editor:reset` with new generation/path/status; `editor:access-changed`; `editor:presence`; `editor:error` with an English message and stable code.

On a revision gap request sync rather than assuming Socket.IO recovered all messages. Recheck recipients' project read access before emitting source-bearing payloads. Reuse the project guard ordering with removals; extend revocation to the new namespace, not just existing root project rooms.

Presence heartbeat is 15 seconds; remove entries after 45 seconds or disconnect. Separate tabs have separate connection IDs; avatar counts aggregate distinct users. The server binds Yjs client IDs to authenticated connections, validates awareness size (4 KiB), drops unknown fields and overwrites user/name/color from trusted state. Relative selections follow insertions. Do not trust a Yjs client ID as a CovAI user ID.

Limits: at most 20 accepted content batches/second/connection; at most 100 awareness messages/second with client throttling to 50 ms; bounded open documents per socket (10). Rate-limit errors keep pending draft and do not close unrelated project connections.

## 6. Authorship and hover

Store a compact run-length line map on both the shared document and checkpointed `ProjectFileVersion`. Each range refers to a `ProjectCodeChange` containing authenticated actor, timestamp and source `HUMAN_EDIT`, `AI_APPLY`, `GIT_UPDATE` or `UNKNOWN`. Keep source metadata server-owned.

On accepted Yjs changes compare old/new text using a maintained line-diff library; unchanged lines retain references and shifted line numbers, changed/inserted lines reference the accepted change. Deletions remove ranges. On one line with contributions from several people, display the last accepted change to that line; do not claim sole authorship of the whole line. Undo counts as an edit by the person undoing. Use exact whitespace, preserve actual newline style and avoid a phantom trailing empty line.

Bound diff time; if attribution cannot be resolved, mark the affected result unknown rather than guessing. Retry, no-op or checkpoint do not reassign authorship. Save after edits by A/B does not assign their lines to the person saving. AI-applied lines show AI-generated · Applied by <name> when the server knows that origin.

Hover priority: pending local change → Unsynced edit; accepted CovAI line map → Last edited by <name> + time/source; unchanged imported line with Git history → Git author + commit/time/message; no source → No line history available. A line-level revision/hash accompanies queries, and stale responses are discarded. User names and commit messages are escaped, not trusted Markdown/HTML.

Git blame is a read-only new route scoped by actual snapshot/root/path/revision. Use argument arrays, timeout, output limit, range bounds, `--line-porcelain` and input content mapping where needed. Do not initialize a repository, fetch, mutate Git config or match Git email to a user automatically. Committed authorship and CovAI edit attribution are separate facts; both may be shown in one compact hover.

This delivery promises last-change attribution from the time tracking starts, not a full per-keystroke replay/history browser. ZIP baseline has unknown original authors. Existing file-level updatedByUserId never masquerades as a line author.

## 7. UI contract inside existing surfaces

Members & access retains two tabs. Invite row: Email, Role, Access, Send invitation. Manage menu changes Role and Access separately using the existing popover/dialog language. On narrow widths wrap controls and allow table overflow; do not compress labels into unreadable icons.

Editor toolbar: compact collaborator avatar stack, overflow popover with name/role/current file, and existing Save action. Presence never automatically changes another user's active tab or scroll position. Cursor flags show a short name on hover/near caret without covering code.

Editor footer/status area uses Joining, Live, Saving changes, Changes saved, Reconnecting, View only, Changes not saved and Saved to workspace. Tooltips explain shared-draft versus workspace status only where the distinction matters. Existing coverage gutter, function navigation, syntax tooling, minimap, theme, Ctrl/Cmd+S and code-copy remain functional.

FileConflictDialog becomes an inline existing-modal comparison with Server version and Your draft, optional Original, a result text editor and Save merged version. No automatic ambiguous merge. Every reload/discard action preserves recovery first. Server version changing again returns the same conflict flow.

Main editor and existing writable file editors use a common model/session hook. IntegrationScenarioEditorModal edits a scenario fragment, so it keeps its existing form while its save uses the external writer bridge and shows conflict safely; it is not falsely presented as a collaborative whole-file buffer. Coverage source/test and SystemTestEditorModal can bind whole-file models. Diff/proposal previews remain read-only.

## 8. Minimal verification and handoff

Use a small number of behavior-focused tests for identity/permissions, receipt replay, Yjs convergence/reconnect, checkpoint ordering, external writer conflicts, line-map behavior and Git argument safety. At least one two-client in-process protocol test is necessary for this feature; it is not browser E2E. The existing 57-test focused baseline passed during research; it is not evidence that new behavior already works.

Schema validate/generate, client build and changed-file lint are required. Document broad lint baseline separately; do not fix unrelated files. A lightweight rendered inspection may check layout and English copy, but leave multi-account browser workflow acceptance to the user.

The implementation is not complete until shared editing, cursor/presence, CovAI line hover, Git fallback and other-writer coordination are all integrated. Manual E2E remains explicitly pending until the user reports it.

## 9. Research sources and execution boundaries

- [Yjs document updates](https://docs.yjs.dev/api/document-updates): merge, idempotence and state-vector synchronization.
- [y-monaco source](https://github.com/yjs/y-monaco): shared text binding, relative selection and Yjs 13 peer compatibility.
- [Monaco React local package setup](https://github.com/suren-atoyan/monaco-react#use-monaco-editor-as-an-npm-package): configure the wrapper and binding against the same editor module.
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees): application-level receipts and sync are required.
- [Git blame](https://git-scm.com/docs/git-blame): commit provenance, not an authenticated record of uncommitted typing.
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): supports coding work and medium reasoning; this does not guarantee a particular implementation will be correct without checks.
- [Codex execution plans](https://developers.openai.com/cookbook/articles/codex_exec_plans): durable progress/decision records for long tasks.

No application changes, dependency installation or migration application were performed while writing this contract. New library versions are resolved/pinned and tested at Task 1 before dependent implementation.
