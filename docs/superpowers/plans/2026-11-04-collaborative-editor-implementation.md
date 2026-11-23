# CovAI Collaborative Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution override for this request:** work sequentially and inline with the same agent, to conserve tokens. Those named superpowers runners are not installed in this workspace; the explicit checklist below is the execution procedure. Do not install runners or delegate just to satisfy that header. Implementation is authorized and runs inline; no delegation.

**Goal:** Deliver PM ownership, job roles plus View/Edit, collaborative code editing with presence/cursors, conflict recovery and line-level CovAI/Git provenance within the existing interface.

**Architecture:** PostgreSQL is the authoritative shared-draft store; Yjs 13 merges updates and y-monaco binds the existing editor. A narrow Socket.IO adapter authenticates every operation, persists before acknowledging/broadcasting, and recovers missed updates. Existing workspace mutation journals checkpoint shared drafts for runners and coordinate all non-editor writers.

**Tech Stack:** existing React 19/Vite/Monaco, Express, Prisma/PostgreSQL, Socket.IO 4; stable Yjs 13, y-monaco, y-protocols and jsdiff. No new runtime service.

**Design contract:** [2026-11-04-collaborative-editor-design.md](../specs/2026-11-04-collaborative-editor-design.md). Read it once at execution start; subsequently read only the task's dependencies and touched files.

## Global Constraints

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

## Progress, decisions and resumption

Implementation integrated on 2026-11-04. The task table and execution notes below describe actual delivery. Original detailed steps are retained as a design audit: checked means implemented/inspected; unchecked means the exact proposed proof or refinement was not performed. They are not claims of browser acceptance.

**Execution adjustments:**
- Task 4 retained the existing guarded mutation/publication wrappers and journal lifecycle. Internal `beforeMutation`/`afterMutation` hooks keep checkpoint metadata in the same transaction, avoiding a larger transaction-core extraction.
- Operation checkpoint revision is carried by request-scoped AsyncLocalStorage to the existing admission guard; no client-supplied bypass. The operation records its captured revision. A dedicated revision badge in every run-result surface was not added.
- Rename closes the old document identity, copies attribution to the destination version and opens a fresh document there; delete/recreate increments generation. Dirty documents block snapshot replacement under the final guard as well as HTTP policy.
- Recovery for an obsolete shared generation offers Download draft and Reload latest (which downloads pending content first). The existing legacy conflict dialog supports explicit compare/merge/CAS. An inline merge directly from obsolete Yjs recovery was not added.
- Scenario conflicts preserve the existing form and return actionable conflict text; no additional Open file shortcut was added. Existing navigation opens the file.
- Hover uses a bounded client cache; Git lookup has a timeout/output cap and no server cache. No new frontend test framework or separate queue harness was introduced; provider lifecycle was inspected in source and remains on the user's manual checklist.
- New tests use a serialized Prisma test double, real temporary filesystem/Git and real Socket.IO clients. They do not prove PostgreSQL locking/migration or browser Monaco behavior. No database migration, Docker run or browser E2E was performed.

| Task | Dependency | Deliverable | Status |
| --- | --- | --- | --- |
| 0 | none | Baseline and file/write inventory | Implemented (adjustments above) |
| 1 | 0 | Compatible Yjs/Monaco/Socket proof | Implemented (adjustments above) |
| 2 | 1 | Additive schema and job-role API | Implemented (adjustments above) |
| 3 | 2 | Members UI and invitation copy | Implemented (adjustments above) |
| 4 | 1 | Transaction-aware file/publication seams | Implemented (adjustments above) |
| 5 | 2,4 | Durable document/update service | Implemented (adjustments above) |
| 6 | 5 | Checkpoints and external-writer bridge | Implemented (adjustments above) |
| 7 | 5,6 | Authenticated Socket.IO gateway and revocation | Implemented (adjustments above) |
| 8 | 7 | Frontend provider, recovery and presence | Implemented (adjustments above) |
| 9 | 6,8 | Main/whole-file editor and operation integration | Implemented (adjustments above) |
| 10 | 6,9 | Scenario/proposal/Git/structure writer coordination | Implemented (adjustments above) |
| 11 | 5,6 | Durable line attribution and safe Git lookup | Implemented (adjustments above) |
| 12 | 9,10,11 | English hover, cursors and conflict UI finish | Implemented (adjustments above) |
| 13 | all | Focused verification and manual handoff | Automated pass; DB/browser acceptance pending |

At each stopping point update the row, the task checkboxes and this compact resumption record:

```yaml
last_completed_task: 12
next_task: apply_reviewed_migration_and_user_manual_acceptance
changed_files: see_git_status_and_implementation_notes
checks_run_this_execution:
  - 10_focused_suites_75_passed_13_existing_skipped
  - client_build_pass
  - changed_frontend_lint_no_new_findings
  - prisma_validate_and_generate_pass
  - backend_syntax_and_git_diff_check_pass
active_blocker: no_verified_disposable_database_migration_target
manual_e2e: not_started_user_owned
```

Do not re-read the entire repo or repeat passing checks after every continuation. A task's completion evidence is a short command/result and its relevant behavior, not a transcript. Never mark all done while only the pilot/presence is implemented.

**Decision log:** roles describe work, not authority; PM ownership remains ownerId; use existing Socket.IO instead of the research's Hocuspocus candidate to avoid a Node/container/service migration; shared drafts and workspace checkpoints are distinct; last-line attribution uses accepted server changes, not the person clicking Save; no full offline or multi-server scope. Implementation follows these decisions with the execution adjustments above.

**Known discoveries:** actual dashboard Editor uses controlled `value` and a React key including theme; binding must not fight React `setValue` or remount away a shared model. Monaco currently resolves locally as 0.56.0 in lockfile but the wrapper may load from CDN unless configured. Prepared/Git/AI writers already have safe-publication boundaries worth retaining. Research baseline: 6 focused suites/57 tests passed; those results do not cover this new code.

## Common contracts and file responsibilities

Public role data remains `{ role: 'OWNER'|'EDITOR'|'VIEWER', disciplineRole: string|null }`. Canonical job-role values and English labels belong in `shared/projectRoles.js`; capability policy stays in `shared/projectAccess.js`.

Document DTO and event identity:

```js
// shared/editorProtocol.js
// Bytes are Uint8Array/Buffer on Socket.IO; JSON recovery serializes them as base64.
const documentIdentity = { documentId, projectId, snapshotId, path, generation };
const documentState = {
  ...documentIdentity, revision, contentHash, stateBytes,
  checkpointRevision, fileVersion: { revision: fileRevision, sha256: fileHash },
  workspaceRevision, capabilities,
};
const receipt = { requestId, updateHash, revision, contentHash };
// These are schema shapes, not runtime variables to paste as-is.
```

New focused backend modules:

| File | Responsibility |
| --- | --- |
| `server/src/services/projectEditorDocument.service.js` | Open/sync/apply updates against DB and current membership |
| `server/src/services/projectEditorCheckpoint.service.js` | Shared draft → existing guarded filesystem publication |
| `server/src/services/projectEditorBridge.service.js` | Refuse dirty replacement; reset generations for safe external writes |
| `server/src/services/projectEditorPresence.service.js` | Ephemeral socket/document/presence registry and expiry |
| `server/src/services/projectLineAttribution.service.js` | Pure line mapping and current-line lookup |
| `server/src/services/projectGitBlame.service.js` | Bounded read-only Git provenance |
| `server/src/realtime/projectEditor.gateway.js` | Socket namespace, authorization, receipts, scoped delivery |
| `server/src/controllers/projectEditor.controller.js` | HTTP checkpoint, status, attribution and recovery endpoints |
| `server/src/routes/projectEditor.route.js` | Explicit route/capability boundaries |
| `server/src/validators/projectEditor.validation.js` | Identifier/path/range/request and size validation |

New focused frontend modules:

| File | Responsibility |
| --- | --- |
| `client/src/lib/monacoSetup.js` | One local Monaco instance/worker setup |
| `client/src/lib/editor/ProjectEditorProvider.js` | Yjs transport, ordered pending queue, sync and acknowledgment |
| `client/src/lib/editor/editorRecovery.js` | User/document/generation scoped pending recovery |
| `client/src/lib/editor/editorModelRegistry.js` | Shared model/provider reference counts across editor surfaces |
| `client/src/hooks/useCollaborativeFile.js` | React lifecycle wrapper and state/action contract |
| `client/src/hooks/useEditorPresence.js` | Project presence subscription/current-file updates |
| `client/src/services/projectEditor.service.js` | HTTP endpoints; no fetch inside components |
| `client/src/components/dashboard/editor/CollaboratorPresence.jsx` | Compact avatar stack and existing-style popover |
| `client/src/components/dashboard/editor/editorCollaboration.css` | Token-based cursor/selection/name flag styles |
| `client/src/lib/editor/registerLineHistoryHover.js` | Disposable Monaco provider with identity/revision guards |

Do not move the giant Editor or coverage controller into a new architecture; add narrowly scoped imports/delegates. New functions below are owned by the task that introduces them.

## Task 0: Record a small baseline and writer inventory

**Files:** read `AGENTS.md`, both package files, this design/plan, existing editor, member, mutation, publication and Git modules. Modify only this plan's progress/decision records.

**Consumes:** current checkout and existing uncommitted changes. **Produces:** exact touched-file baseline and a writer checklist linked to Tasks 6/9/10.

- [x] Record `git status --short`, Node version and relevant lockfile versions. Do not stash or reset the user's edits.
- [x] Map source/test saves from `project.controller.js`, `fileManager.controller.js`, `coverage.controller.js`, `scenarioManager.service.js`, `systemTestImprovementJob.service.js`, `projectWorkspacePreparation.service.js`, `projectWorkspacePublish.service.js`, `git.service.js` and create/restore/upload in `project.service.js`.
- [x] Run the existing focused baseline once; save only summary/failing names. Run client build and existing lint once; identify failures already present.

```powershell
git status --short
node --version
npm.cmd test --prefix server -- --runInBand --runTestsByPath src/tests/projectAccess.test.js src/tests/projectEndpointPolicy.test.js src/tests/projectFileVersion.test.js src/tests/projectOperation.test.js src/tests/gitCollaborationSafety.test.js src/tests/snapshotWorkspace.test.js
npm.cmd run build --prefix client
npm.cmd run lint --prefix client
```

- [x] Mark which existing dirty hunks may intersect later tasks; do not include them as new feature work.

**Done when:** baseline exists and every known canonical writer has a Task 6/9/10 destination. Do not spend tokens fixing unrelated lint failures.

## Task 1: Prove dependency and binding compatibility before full implementation

**Files:** modify `client/package.json`, `client/package-lock.json`, `server/package.json`, `server/package-lock.json`; create `shared/editorProtocol.js`, `client/src/lib/monacoSetup.js`, `server/src/tests/editorProtocol.test.js`. Modify `client/src/main.jsx` only to import the single Monaco setup.

**Consumes:** Socket.IO 4, Node 20 floor, Monaco lockfile baseline. **Produces:** pinned compatible libraries, `EDITOR_LIMITS`, `EDITOR_ERROR_CODES`, `normalizeEditorIdentity(input)`; binding runtime selected once.

- [x] Resolve stable Yjs 13, y-monaco compatible with Yjs 13, y-protocols 1, jsdiff and the already-resolved Monaco version. Record exact resolved versions in this plan. Do not install `@y/y` or RC packages; verify peer dependencies with npm metadata before installing. Pin exact resolved versions and use the same Yjs version in both apps.

```powershell
npm.cmd view y-monaco@0.1.6 peerDependencies --json
npm.cmd view yjs dist-tags engines --json
# Install stable compatible versions with --save-exact after examining metadata.
```

- [x] Configure `@monaco-editor/react` loader with the imported local Monaco module and Vite worker imports; choose editor/json/css/html/typescript workers by language. Do not load a second Monaco from CDN. Use that same module for y-monaco and existing DiffEditor.
- [x] Write one dependency proof with two Y.Doc instances starting from the same binary seed. Apply concurrent insertions and duplicate updates in different orders; assert equal text. Assert local undo scope does not remove the other client's insertion.

```js
import * as Y from 'yjs';
const seed = new Y.Doc(); seed.getText('content').insert(0, 'ab');
const a = new Y.Doc(), b = new Y.Doc();
for (const doc of [a, b]) Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
a.getText('content').insert(1, 'A');
b.getText('content').insert(1, 'B');
const ua = Y.encodeStateAsUpdate(a), ub = Y.encodeStateAsUpdate(b);
Y.applyUpdate(a, ub); Y.applyUpdate(b, ua); Y.applyUpdate(b, ua);
expect(a.getText('content').toString()).toBe(b.getText('content').toString());
```

- [x] Verify an in-process Socket.IO binary request/ack can roundtrip a Uint8Array on the existing server/client dependency versions. Stop both temporary servers/clients after the test.
- [x] Build the client to validate local Monaco and binding imports. No new user-visible demo page. Record whether multi-instance binding/model disposal works from source/prototype checks.

**Done when:** the small proof passes and exact dependency/runtime assumptions are recorded. Fix incompatibility here, not after writing the full frontend.

## Task 2: Add schema and membership responsibility data

**Files:** modify `server/prisma/schema.prisma`; create `server/prisma/migrations/20261104090000_project_editor_collaboration/migration.sql`, `shared/projectRoles.js`; modify `server/src/validators/projectMember.validation.js`, `server/src/controllers/projectMember.controller.js`, `server/src/services/projectMember.service.js`, `server/src/services/projectInvitation.service.js`, `server/src/services/invitationDelivery.service.js`, `server/src/utils/projectInvitationEmail.js`. Create `server/src/tests/projectDisciplineRoles.test.js`; update `server/src/tests/projectInvitationEmail.test.js` for changed email labels.

**Consumes:** current `role`, ownerId, revision and invitation lifecycle. **Produces:** backward-compatible `{role, disciplineRole}` throughout API/invitation acceptance plus document tables used by Task 5.

- [x] Add nullable disciplineRole and CHECK allowlist to membership/invitation. Keep EDITOR/VIEWER CHECK and ownerId invariant. Return owner as role OWNER, disciplineRole PM. Do not infer existing member job titles; null means Unassigned.
- [x] Add these models with project/snapshot/document cascades and actor references SetNull. Review cascade SQL explicitly; no data-destructive migration:

```text
ProjectEditorDocument
  id; projectId; snapshotId; relativePath; generation default 1
  revision default 0; stateBytes Bytes; text String @db.Text; contentHash
  baseFileRevision; baseFileHash; checkpointRevision default 0
  lineAttributionJson Json; attributionStatus default AVAILABLE
  active default true; createdAt; updatedAt
  UNIQUE(snapshotId, relativePath); INDEX(projectId, active)

ProjectEditorUpdate
  id; documentId; generation; actorId?; requestId; updateHash
  resultRevision; resultContentHash; createdAt
  UNIQUE(documentId, generation, actorId, requestId)

ProjectCodeChange
  id; projectId; snapshotId; actorId?; source; createdAt
  optional metadata Json (only server-produced provenance)

ProjectFileVersion additions
  lineAttributionJson Json?; attributionStatus String?
```

- [x] Add necessary relation collections to User/Project/ProjectSnapshot. The migration directory must be new; if this exact name exists, record the actual next timestamp rather than modifying an applied migration.
- [x] Extend member PATCH to permit role, disciplineRole or both, require one attribute plus expectedRevision, serialize under the existing guard and increment revision once. Include before/after access/discipline in the event payload. Owner row cannot be changed through membership APIs.
- [x] Extend invitation identity/projection/delivery/acceptance to preserve disciplineRole. `dispatchInvitationDeliveries` must pass the stored disciplineRole into `createProjectInvitationEmail`; email labels distinguish Role from Access. Old requests omitting it remain valid. Reusing requestId with a changed job role yields IDEMPOTENCY_CONFLICT.
- [ ] Add a focused test covering invited PM + VIEWER still cannot manage members, a job-role-only PATCH does not grant permissions, old invitation input is accepted, and invalid role values are rejected.

```js
expect(roleAllows('VIEWER', 'members.manage')).toBe(false);
expect(memberChangeSchema.safeParse({
  disciplineRole: 'TECH_LEAD', expectedRevision: 2,
}).success).toBe(true);
expect(invitationCreateSchema.safeParse({
  email: 'dev@example.test', role: 'VIEWER', disciplineRole: 'ROOT',
}).success).toBe(false);
```

- [x] Run Prisma validate/generate and inspect generated diff. Generate/review additive SQL without applying against the developer's live DB. Apply only to an explicitly verified local/disposable DB for a smoke check if already available; otherwise hand off the reviewed migration command to the user and report that application is pending.

```powershell
# From server/
npx.cmd prisma validate
npx.cmd prisma generate
```

**Done when:** schema is valid, compatible member/invitation paths carry both attributes, and no new capability depends on disciplineRole.

## Task 3: Extend existing Members UI without another page

**Files:** modify `client/src/services/projectMember.service.js`, `client/src/services/projectInvitation.service.js`, `client/src/hooks/useProjectMembers.js`, `client/src/components/dashboard/settings/ProjectMembersSettings.jsx`, `client/src/components/dashboard/settings/members/{InviteMemberForm,MemberList,MemberActionsMenu,MemberRoleBadge,InvitationList}.jsx`, `members.css`, `client/src/pages/InvitationPage.jsx`.

**Consumes:** Task 2 attributes and shared labels. **Produces:** English Role/Access selectors and rows; View/Edit remain mapped to VIEWER/EDITOR.

- [x] Invite defaults to Developer and View. Include disciplineRole in the frontend request fingerprint/idempotency key identity, not just the payload. Submit remains protected against double click.
- [x] Add Access column, display PM + Full access + Project owner on owner row; show Unassigned for legacy job roles. Invite inspection/accept page and email must agree on Role and Access.
- [x] Manage menu changes Role and Access separately using current popover/dialog styling, one expectedRevision-aware PATCH. Keep remove/revoke confirmation behavior.
- [x] Preserve disabled/loading/error/retry states, keyboard focus and narrow-screen wrapping; no new top-level tabs/routes. Update copy without changing shared-context semantics.

```js
const invitationIdentity = JSON.stringify({
  email: canonicalEmail, role, disciplineRole,
});
const accessLabel = role === 'OWNER' ? 'Full access' : role === 'EDITOR' ? 'Edit' : 'View';
```

- [x] Build once after this coherent frontend slice. Do not add a React test framework for selectors.

**Done when:** existing screens expose both concepts clearly and user-facing strings/labels are English.

## Task 4: Expose transaction-aware file seams without changing behavior

**Files:** modify `server/src/services/projectFileVersion.service.js`, `projectMutation.service.js`, `projectWorkspacePublish.service.js`, `projectMutationRecovery.service.js`; extend `server/src/tests/projectFileVersion.test.js` and `snapshotWorkspace.test.js` only where a behavior changes.

**Consumes:** existing guard/journal/recovery implementation. **Produces:** callable in-transaction read/mutation/publication cores and post-commit completion helpers, preserving public wrappers.

- [ ] Extract `readVersionedProjectFileInTransaction({tx, access, projectId, snapshotId, userId, path})` from the current read body; wrapper still resolves access/guard first.
- [ ] Extract `mutateProjectWorkspaceInTransaction({tx, access, ...mutationInput})` and `publishPreparedWorkspaceInTransaction({tx, access, ...publicationInput})`. They return result plus cleanup/event metadata; they do not commit, broadcast or delete journal evidence themselves.
- [ ] Keep public `mutateProjectWorkspace` and `publishPreparedWorkspace` owning guard/recovery/post-commit cleanup. Export `finishCommittedProjectMutation(result)` for checkpoint wrappers to use after their transaction commits. No nested Prisma transactions/advisory guards.
- [x] Allow a server-owned `afterMutation(tx, result)` callback to persist checkpoint metadata/line maps in that same transaction. Never accept callbacks/provenance from HTTP input.
- [x] For a single ordinary file save, keep snapshot and file revision/hash checks but do not reject solely because an unrelated file changed workspaceRevision. Structure/bulk mutations still require exact workspaceRevision. Incompatible or ambiguous writes remain conflicts.

```js
// Internal seam used only after access was resolved in the caller's guard.
const result = await mutateProjectWorkspaceInTransaction({
  tx, access, projectId, snapshotId, userId, path,
  kind: 'WRITE_FILE', content, expectedVersion,
});
// finishCommittedProjectMutation(result) runs only after transaction success.
```

- [x] Rerun existing path/recovery/workspace tests. Preserve original crash behavior and never delete backups before DB commit. Review only this extraction before adding new bridge logic.

**Done when:** existing callers still work with unchanged response envelopes; checkpoints can compose file and document updates atomically.

## Task 5: Implement durable shared documents and idempotent update receipts

**Files:** create `server/src/services/projectEditorDocument.service.js`, `server/src/validators/projectEditor.validation.js`; extend `shared/editorProtocol.js`; create `server/src/tests/projectEditorDocument.test.js`.

**Consumes:** Task 2 models, Task 4 read seam. **Produces:** these service contracts:

```js
openEditorDocument({ projectId, snapshotId, path, userId, clientId, db })
// -> documentState
applyEditorUpdate({ documentId, generation, requestId, updateBytes, userId, db })
// -> { receipt, documentIdentity, committedUpdate, changed }
syncEditorDocument({ documentId, generation, stateVector, userId, db })
// -> { documentIdentity, revision, contentHash, updateBytes }
```

- [x] Open resolves actual snapshot/project/file, enforces latest editable snapshot, recovers pending filesystem journal, initializes Y.Text from file once and records exact baseline. Viewer may read; initialization records UNKNOWN provenance rather than crediting opener/upload owner for all lines.
- [x] Apply derives project from stored document, enters withProjectGuard(files.write), validates generation/active state and receipt before any mutation. Load binary DB state into a fresh Y.Doc, apply the update, validate only `content` root/type, then store binary/text/hash/revision atomically. No filesystem write here.
- [x] New receipt with identical Yjs state is a no-op; no authorship change. Exact request retry returns its stored receipt even if document has since advanced. Reused requestId with different bytes returns REQUEST_ID_REUSED. Preserve pending draft on failures.
- [x] Add strict sizes/rate input validation and stable codes: EDITOR_DOCUMENT_CLOSED, EDITOR_GENERATION_CHANGED, EDITOR_DRAFT_CONFLICT, EDITOR_LIMIT_EXCEEDED, EDITOR_SYNC_REQUIRED. Use existing AUTH_REQUIRED/CAPABILITY_DENIED/RESOURCE_NOT_FOUND as appropriate.
- [x] Add server flag `PROJECT_EDITOR_ENABLED`, off by default until Task 13 integration passes. Existing `/access` exposes `features.liveEditing`; UI uses this server value, not a second independent build flag. Disabled open/update returns EDITOR_UNAVAILABLE with English copy. External-writer protection of existing dirty persisted documents remains active even when opening new live sessions is disabled.
- [x] Sync uses Y.encodeStateAsUpdate(doc, vector) after membership validation. Document existence does not reveal another project's source.
- [x] Focused tests: two accepted concurrent updates converge; replay does not attribute/revise twice; viewer/removed member/old generation cannot write; update state survives service re-instantiation. Use existing Jest and a small transaction fake; the later protocol check covers a real socket.

```js
const first = await applyEditorUpdate(input);
const replay = await applyEditorUpdate(input);
expect(replay.receipt).toEqual(first.receipt);
await expect(applyEditorUpdate({ ...input, userId: viewerId }))
  .rejects.toMatchObject({ statusCode: 403 });
```

**Done when:** accepted acknowledgment can be defined as durable, source bytes never depend on an uncommitted in-memory cache, and retries are safe.

## Task 6: Add checkpoints and mandatory external-writer coordination

**Files:** create `server/src/services/projectEditorCheckpoint.service.js`, `projectEditorBridge.service.js`, `server/src/controllers/projectEditor.controller.js`, `server/src/routes/projectEditor.route.js`; modify `server/index.js`, transaction cores from Task 4, `project.service.js`; create `server/src/tests/projectEditorCheckpoint.test.js`.

**Consumes:** persisted documents, receipt service, transaction cores. **Produces:**

```js
checkpointEditorDocuments({ projectId, snapshotId, userId, documents, expectedWorkspaceRevision, requestId })
// documents: [{ documentId, generation, revision }]; -> { checkpointId, workspaceRevision, documents }
assertEditorReplacementAllowed({ tx, projectId, snapshotId, paths })
// throws EDITOR_DRAFT_CONFLICT for dirty affected documents/descendants
reconcileEditorReplacement({ tx, projectId, snapshotId, changes, actorId, source })
// updates text/state/baselines/line-map; increments generation for changed/replaced documents
```

- [x] Add explicit auth/capability routes in projectEditor.route.js, mounted before generic `/:id`: `GET /:id/editor/status`, `POST /:id/editor/checkpoint`, `GET /:id/editor/documents/:documentId/recovery`, `GET /:id/editor/line-history`. Do not let the generic path regex misclassify checkpoint as tests.run.
- [x] Status returns authorized document IDs/generations/revisions/dirty status, never absolute paths. Recovery requires project.read on that document; downloading one's pending local recovery must still work without server access.
- [x] Checkpoint compares requested document identities, freezes those accepted revisions under guard, publishes text with current journal and stamps baseline/checkpoint revision + ProjectFileVersion line map in the same transaction. Batch all requested dirty files within existing bulk limits; identical clean checkpoint is a no-op.
- [x] Insert external-writer checks inside both canonical transaction cores, before file side effects. Checkpoint origin is internal/server-owned, not a client bypass flag. Ordinary saves use file CAS; bulk apply checks both file and workspace identity.
- [x] Dirty external replacements reject with document IDs/relative paths sufficient for recovery. Clean replacements update the durable document before commit and emit reset only afterwards. Rename/delete check descendants, preserve tombstones and invalidate old generations. Snapshot restore/upload/import closes old sessions, retains drafts and records new active identity.
- [ ] Focused tests: a batch writes the intended revision; draft changes after checkpoint stay dirty; failure does not mark checkpoint saved; dirty external write is rejected; clean reset rejects an old client update. Do not silently discard recovery content.

```js
await expect(assertEditorReplacementAllowed({ tx, projectId, snapshotId, paths: ['src/a.js'] }))
  .rejects.toMatchObject({ code: 'EDITOR_DRAFT_CONFLICT' });
expect(checkpointed.checkpointRevision).toBe(capturedDocumentRevision);
expect(checkpointed.baseFileHash).toBe(hashFileContent(capturedText));
```

**Done when:** all filesystem writes through the central paths respect drafts and state cannot claim saved while publication failed.

## Task 7: Wire the authenticated gateway, presence and revocation

**Files:** create `server/src/realtime/projectEditor.gateway.js`, `server/src/services/projectEditorPresence.service.js`; modify `server/index.js`, `server/src/services/projectSubscription.service.js`, `projectMember.service.js`; create `server/src/tests/projectEditorGateway.test.js`.

**Consumes:** Task 5 services and Task 6 post-commit resets. **Produces:** the socket protocol from the design, `attachProjectEditorGateway(io)` and `revokeEditorAccess({projectId,userId,accessRevision})`.

- [x] Register `/editor` namespace on existing io, set appropriate bounded binary packet size and same allowed origins. Validate token and bind verified identity; never accept userId/role from event payloads.
- [x] Implement open/update/sync/leave via service calls and post-commit receipts. Catch/reply stable errors once; a failed transaction cannot emit committed update. On reconnect the client opens/syncs again; no reliance on built-in event replay.
- [x] Source delivery must recheck recipient membership and event document generation; revocation and final writes follow the existing guard ordering. Extend removal/downgrade notifications to this namespace. Downgraded users retain read streams if allowed, but writes are denied immediately at the authoritative handler.
- [x] Bind each claimed Yjs clientId to an authenticated connection; validate awareness and overwrite user/name/color. Use y-protocols encoder/decoder utilities, not hand-rolled relative-position arithmetic. Reject impersonation attempts affecting another client's presence.
- [x] Add project presence with 15-second heartbeat/45-second expiry and distinct-user counts across tabs. Enforce the rate/open-document limits from design. Expiry cleanup timers unref and dispose in tests.
- [x] One focused Node test starts a real temporary Socket.IO server with injected service/store dependencies and two clients: edit+ack+peer update, dropped delivery followed by sync, and downgrade denies a further write. It is not a browser E2E or a new infrastructure stack.

```js
await first.emitWithAck('editor:update', packet);
expect(store.lastReceipt.requestId).toBe(packet.requestId);
await revokeEditorAccess({ projectId, userId: editorId, accessRevision: 3 });
const denied = await first.emitWithAck('editor:update', nextPacket);
expect(denied.code).toBe('CAPABILITY_DENIED');
```

**Done when:** transport delivers durable updates, catches up safely and does not permit read-only clients to forge edits.

## Task 8: Implement the frontend provider and recovery lifecycle

**Files:** create `ProjectEditorProvider.js`, `editorRecovery.js`, `editorModelRegistry.js` under `client/src/lib/editor/`, `client/src/hooks/useCollaborativeFile.js`, `useEditorPresence.js`, `client/src/services/projectEditor.service.js`. Extend Task 1 protocol tests with pure frontend queue tests under existing server Jest if import-safe.

**Consumes:** Task 7 event contract, Task 6 HTTP. **Produces:**

```js
// useCollaborativeFile({ projectId, snapshotId, path, enabled })
// -> { model, bindEditor, status, canEdit, revision, generation, dirtyWorkspace,
//      flushPending, saveToWorkspace, recovery, error }
// Registry identity: userId/projectId/snapshotId/canonicalPath/generation.
```

- [x] Seed from server binary before binding, not concurrently from React value/defaultValue. Queue only locally generated Yjs updates, mark remote origin and do not echo them back.
- [x] Batch at 150 ms, one in-flight request/doc. Receipt clears only its own pending batch; subsequent edits stay queued. Retry uses original requestId/bytes. Receipt revision must never regress current local revision after receiving newer server state.
- [x] Reconnect opens current identity, syncs state vectors, retries pending batches in order and preserves identity-scoped sessionStorage recovery. For stale generation, stop replay, detach and offer copy/download. For access loss freeze pending and avoid retaining readable remote cache in unrelated user sessions.
- [x] Model registry refcounts providers/models across mounted editors; StrictMode mount/unmount must not double-subscribe, seed twice or delete another surface's model. Logout/project/snapshot changes dispose matching resources. Theme changes do not reset documents.
- [x] Use Y.UndoManager scoped to the local binding origin; disable/confine native model undo interception as needed so Ctrl/Cmd+Z is local, and restore controls on disposal.
- [x] Configure awareness sanitation and current-file presence. Use relative selections from binding, not raw line numbers stored forever. Throttle and clear presence on tab-close/project switch.
- [ ] Queue test proves an acknowledgment for batch A cannot clear later batch B, and recovered batch keeps the original requestId.

```js
expect(queue.pending.map(item => item.requestId)).toEqual(['batch-b']);
expect(recovered[0].requestId).toBe(original[0].requestId);
```

**Done when:** provider owns synchronization without React/native undo loops, and no UI status claims durability before receipt.

## Task 9: Bind existing editors and checkpoint operation entry points

**Files:** modify `client/src/components/dashboard/Editor.jsx`, `Layout.jsx`, `FileCodeExecutionView.jsx`, `TestFileViewerPanel.jsx`, `system/SystemTestEditorModal.jsx`, relevant actual whole-file source editor under `integration/SourceCodeViewerModal.jsx`; modify `client/src/services/project.service.js`, coverage/system/integration service wrappers; modify `server/src/services/projectOperation.service.js` and operation admission callers identified in Task 0.

**Consumes:** common hook/models, checkpoint API. **Produces:** live whole-file editing in current surfaces, deterministic Save/Run behavior and no background React overwrite.

- [x] Replace controlled value/onChange only for active collaborative whole-file models. Preserve existing legacy fallback when feature flag is off; unsupported/oversized live documents explain the limit rather than silently losing protection. Never fall back to direct writes after a realtime error.
- [x] Remove theme from model identity; update theme via Monaco APIs. Keep coverage and function-navigation decorations in separate collections so cursor decorations do not erase them.
- [x] Save/Ctrl+S calls flushPending then checkpoint selected file; keep current Save control. Add compact shared-draft status and preserve original file-level draft recovery for feature-off conflict flows.
- [x] Run/AI/source-export for edit-capable users: flush own pending batches; fetch snapshot draft status; checkpoint all currently accepted dirty documents within bounds; pass resulting expectedWorkspaceRevision into admission. Membership is rechecked; viewers only export the last saved version and cannot flush.
- [ ] Extend `admitProjectOperation` to reject an explicit mismatching expectedWorkspaceRevision. Keep existing prepared/operation workspace isolation and stale publication protection. Expose captured revision on run status/results; never re-run automatically on every remote edit.
- [x] Whole-file editors share registry identities and receive others' changes even when they are different UI surfaces. Read-only preview/diff models remain independent; do not bind a candidate proposal to the live file accidentally.
- [x] Client build and focused operation tests only for this slice. Inspect all touched UI strings including hotkey/error paths.

```js
await collaboration.flushPending();
const checkpoint = await checkpointCurrentSnapshot({ projectId, snapshotId });
await runAnalysisApi(projectId, {
  snapshotId, expectedWorkspaceRevision: checkpoint.workspaceRevision,
});
```

`checkpointCurrentSnapshot` is a frontend service helper introduced here: it reads `/editor/status`, posts dirty document IDs/generations/revisions and returns the checkpoint response; if there are none it returns the current saved workspaceRevision.

**Done when:** collaboration and runners agree on saved content, and every whole-file editor listed in Task 0 has a shared-model or explicit read-only reason.

## Task 10: Close non-editor writer paths and structural edge cases

**Files:** modify `server/src/services/scenarioManager.service.js`, `integrationApiService.service.js`, `applyTestSuggestion.service.js`, `aiTestsJob.service.js`, `aiSuggestJob.service.js`, `systemTestImprovementJob.service.js`, `git.service.js`, `projectWorkspacePreparation.service.js`, `projectOperationWorkspace.service.js`, `server/src/controllers/coverage.controller.js`, relevant project create/restore/upload handlers; modify `client/src/components/dashboard/integration/IntegrationScenarioEditorModal.jsx`, `IntegrationApplyTestsModal.jsx`, `GitPanel.jsx`, AI/apply controls in their existing surfaces. Extend checkpoint tests instead of creating per-file mirror tests.

**Consumes:** mandatory bridge and the writer inventory. **Produces:** no silent direct writer can overwrite live drafts.

- [x] Trace each inventory item to the central transaction cores. Prepared-only writes remain in isolated workspaces until final guarded publish; central bridge validates canonical paths immediately before publication.
- [ ] Scenario fragment saves keep their current form; if whole-file draft is dirty show an actionable EDITOR_DRAFT_CONFLICT in that modal, preserve fragment input and offer Open file in editor through existing navigation. A fragment is never incorrectly bound to the whole-file Y.Text.
- [x] AI generation previews are private proposals, not immediate shared edits. Apply checks the original source/test/workspace identity, refuses dirty conflicting drafts and creates AI_APPLY provenance only from the trusted server call.
- [x] Git actions checkpoint/require saved drafts before mutating source; stage/commit only show saved workspace files. Keep existing Git author metadata distinct from CovAI line authors. Do not globally change Git identity or auto-commit per keystroke.
- [x] Restore, branch switch, import and rename/delete correctly invalidate sessions and preserve recovery; delayed old-generation packets cannot recreate an obsolete file. Whole project deletion disconnects document rooms.
- [x] Reconcile apply-system-proposal HTTP and service capability requirements explicitly: this scope retains owner-only authoritative review/apply semantics where currently required; job roles never bypass evidence.approve. Do not show Edit users an enabled action the final service denies.
- [x] Add two boundary cases to checkpoint/gateway tests: dirty draft blocks AI/Git replacement; clean replacement resets clients and rejects delayed edits. Document any intentional remaining direct writer as a blocker, not a completed item.

**Done when:** Task 0 inventory has no uncoordinated canonical writer and no user loses a fragment/proposal due to a late conflict.

## Task 11: Implement truthful line attribution and Git fallback

**Files:** create `server/src/services/projectLineAttribution.service.js`, `projectGitBlame.service.js`; modify Task 5/6/10 to record provenance, `server/src/controllers/projectEditor.controller.js` and validators; create `server/src/tests/projectLineAttribution.test.js`, `projectGitBlame.test.js`.

**Consumes:** durable before/after text, authenticated actor, ProjectCodeChange, checkpointed version/hash. **Produces:** `advanceLineAttribution({before, after, ranges, changeId})`, `lookupLineHistory({projectId,snapshotId,path,line,documentId,generation,revision,userId})`, `readGitLineBlame({root,path,content,line,timeoutMs})`.

- [x] Use maintained line diff with bounded time/input, preserve newline style and exact unchanged lines; run-length ranges shift as lines insert/delete. Persist changed lines with the real accepted actor/source; do not label untouched lines as edited because Save/Commit happened.
- [x] Same-line edits report last accepted server change, explicitly not exclusive authorship. Copy/move/reformat is treated as a new textual edit unless known; unresolved mapping becomes UNKNOWN and English hover states unavailable.
- [x] Deduplicate no-op/replayed updates before creating provenance; checkpoint copies map without rewriting actor. For AI apply use actor + AI_APPLY; Git replacement baseline maps to Git/unknown instead of crediting PM for original authors.
- [x] GET line-history validates exact snapshot/root/path and requested document generation/revision or saved file hash. Return line, contentHash, source, actor display, timestamp, optional commit metadata. A stale query yields EDITOR_SYNC_REQUIRED; no arbitrary host paths or other-project lookup.
- [ ] Git lookup uses spawn/execFile argument arrays, read-only repository verification, range limit, --line-porcelain, timeout/output cap and -- path terminator. Cache by root identity/HEAD/file-content hash/range. No init/fetch/config. Dirty content mapping may use `--contents -`; never show the HEAD line's author on a different inserted current line.
- [ ] Focused tests cover insertion shifting an existing author's line, deletion, two people on one line, replay/no-op, unknown baseline and newline handling. One temporary Git repo test with two authors and an uncommitted line proves commit fallback; no user repo or remote calls.

```js
const ranges = advanceLineAttribution({
  before: 'alpha\nbeta\n', after: 'new\nalpha\nbeta\n',
  ranges: [{ start: 1, end: 2, changeId: 'change-a' }], changeId: 'change-b',
});
expect(ranges).toEqual([
  { start: 1, end: 1, changeId: 'change-b' },
  { start: 2, end: 3, changeId: 'change-a' },
]);
```

**Done when:** last-change information is correct for tracked edits and honest when unavailable, including uncommitted code and ZIP imports.

## Task 12: Finish cursors, hover and conflict recovery in existing UI

**Files:** create `client/src/components/dashboard/editor/CollaboratorPresence.jsx`, `editorCollaboration.css`, `client/src/lib/editor/registerLineHistoryHover.js`; modify `Editor.jsx`, `Layout.jsx`, existing editor status surfaces and `FileConflictDialog.jsx`; update service wrapper with line-history lookup. Reuse current ConfirmDialog/DiffEditor styling.

**Consumes:** Task 8 presence/session hook, Task 11 line-history response, original draft recovery. **Produces:** finished English experience with no extra page/tab.

- [x] Put collaborator avatars beside current editor controls, with a small overflow popover. Deduplicate users with multiple tabs; show current file in the popover. Do not auto-follow another user.
- [x] Render y-monaco relative selections/cursors with deterministic server colors and escaped short-name labels. Keep coverage markers, theme contrast and hit targets intact; no fixed giant presence panel.
- [x] Register one disposable Monaco hover provider. Scope it to registered model URI, generation and revision; debounce/cache range queries. Mark pending local lines Unsynced edit; discard stale responses. Escape commit messages/names and use plain text/controlled Markdown without command links.
- [x] Extend existing conflict modal to compare Your draft and Server version with optional Original; use an editable result and explicit Save merged version. Save submits latest file CAS or a current shared-document replacement transaction; repeated concurrent change returns conflict again. Do not accept a blind overwrite.
- [ ] When a previous-generation local draft is recovered, keep it separate until explicit compare/merge; copy/download must work even if the member lost server access. No reload/discard control can erase the only recoverable copy.
- [x] English copy audit on all touched JSX, helpers and backend public errors. Check the exact design status labels and invitation text; no Vietnamese UI strings are introduced. Preserve keyboard access, light/dark colors and narrow-width behavior.

```js
const hoverTitle = history.source === 'AI_APPLY'
  ? `AI-generated · Applied by ${history.actorName}`
  : history.actorName ? `Last edited by ${history.actorName}`
  : 'No line history available';
```

- [x] Build and changed-file lint. A single lightweight rendered inspection may check layout/copy if a local app is available; do not run the user's multi-account E2E suite.

**Done when:** same-line editing presence and actual tracked line history are visible within the old editor and conflict recovery is usable.

## Task 13: Verify narrowly, document rollout and hand off manual acceptance

**Files:** update this plan, design only for decisions actually changed, and `docs/runbooks/collaborative-editor-manual-check.md`.

**Consumes:** task evidence and actual changed files. **Produces:** final summary of what shipped, commands/results, migration/start instructions, known limits and user-owned E2E checklist.

- [x] Run only new behavior tests and the six-suite baseline once at final integration. Broadly rerun only if a failure or subsequent change justifies it. Do not introduce snapshot tests that merely restate JSX.

```powershell
$env:COVAI_OFFLINE_TESTS='true'
npm.cmd test --prefix server -- --runInBand --runTestsByPath src/tests/editorProtocol.test.js src/tests/projectDisciplineRoles.test.js src/tests/projectInvitationEmail.test.js src/tests/projectEditorDocument.test.js src/tests/projectEditorCheckpoint.test.js src/tests/projectEditorGateway.test.js src/tests/projectLineAttribution.test.js src/tests/projectGitBlame.test.js src/tests/projectAccess.test.js src/tests/projectEndpointPolicy.test.js src/tests/projectFileVersion.test.js src/tests/projectOperation.test.js src/tests/gitCollaborationSafety.test.js src/tests/snapshotWorkspace.test.js
npm.cmd run build --prefix client
git diff --check
```

- [x] Lint changed frontend files explicitly, list any remaining existing full-lint failures separately. Prisma validate/generate only when schema has changed since last pass. Do not call migration applied if only SQL was generated.
- [x] Ensure feature flag off falls back to existing versioned save, not an unprotected writer. Before switching off on an environment with dirty shared drafts, checkpoint/recover them; a hidden persisted draft is not a successful rollback. Keep additive tables on rollback; do not drop history/drafts.
- [ ] Check route/session resource disposal, server timer cleanup and no local test process remains running. Verify normal npm dev still starts both apps with no extra daemon; document API/socket origins for deployment.
- [x] Provide the user the exact migration/start steps for their environment, no secrets; mark manual multi-account flows pending. Use the prewritten runbook and update it with actual UI labels.
- [x] Mark complete only when all promised capabilities are implemented; distinguish automated checks passed from manual E2E pending. If a gate failed, report the specific incomplete feature and the preserved working scope.

**Done when:** user receives a runnable integrated change and a concise manual acceptance checklist, with honest verification limits.

## Token and iteration discipline

Execute one task or a tightly coupled pair per work segment. Read bounded relevant files; use rg for discovery. Retain chosen contracts and exact function names rather than redesigning at each continuation. Keep task summary to result, evidence and next task. Do not launch agents, repeatedly research settled decisions, run browser E2E, reinstall dependencies, or run every test suite after each small edit. Do retain the small concurrency/idempotency/permission tests: dropping those would increase rework risk precisely where the feature is hardest.

No token/time budget or finish guarantee is inferred from the model name. GPT-6.1 Sol Medium can execute this workflow, but a durable plan and focused checks remain necessary. The first proof should expose integration mistakes before large UI/backend changes.

## Outcomes and retrospective

Delivered roles/access, durable shared documents, authenticated realtime editor/cursors/presence, save checkpoints, external-writer protection, CovAI/Git line history and legacy merge recovery in existing surfaces. UI additions are English. Preserved prior user changes; the only additional hunk in the already-dirty SystemTestDashboard passes projectId to the review permission check.

Exact packages: client yjs 13.6.33, y-monaco 0.1.6, y-protocols 1.0.7, diff 8.0.4, monaco-editor 0.56.0; server yjs 13.6.33, y-protocols 1.0.7, lib0 0.2.119, diff 8.0.4; test socket.io-client 4.8.3.

Final evidence: 10 suites / 75 tests passed; 13 tests in one existing integration suite skipped. Client build passes (large-bundle and ineffective dynamic-import warnings). Prisma validate and generate passed; migration SQL is additive and reviewed, not applied. Changed frontend lint adds no findings: existing Editor 4 errors/1 warning, FileCodeExecutionView 12/3, TestFileViewerPanel 8/0; original full lint baseline 382 errors/47 warnings. These existing findings remain. Build and focused checks ran on host Node 24.12.0; Node 20 container compatibility was preserved in dependencies/configuration but not executed.

Rollout and manual acceptance: [runbook](../../runbooks/collaborative-editor-manual-check.md). Live flag remains off unless already configured externally. Apply the migration before starting the changed membership API even when live editing is off. Do not discard dirty drafts during rollback. Single application server only; multi-server/offline-first remain outside scope.

## Activation follow-up

User explicitly authorized configured Railway dev/test on 2026-11-04. Applied only the reviewed collaboration migration in a transaction and marked that migration applied; historical drift left untouched. Regenerated Prisma Client, enabled PROJECT_EDITOR_ENABLED in server/.env, started localhost frontend/API and compose Redis. Health, Socket.IO and Monaco module HTTP checks passed; Redis PONG. Browser manual acceptance remains pending. See activation record in runbook.
