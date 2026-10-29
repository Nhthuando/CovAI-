# CovAI Project Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement project membership, email invitations, shared project/AI access and safe concurrent work, matching the user-approved CovAI Settings Figma, and prove the result on a real isolated localhost stack without regressions in existing Owner workflows.

**Architecture:** Preserve `Project.ownerId`, add Editor/Viewer membership and a common capability boundary. Keep the existing frontend shell and insert Members in Settings; coordinate canonical writes through one guarded mutation boundary, run long work in isolated workspaces, and publish revisioned project events. Exercise the complete application through real users, database, queue, SMTP capture and browser contexts.

**Tech Stack:** Existing React 19/Vite, Express 5 ES modules, Prisma 7/PostgreSQL, Redis/ioredis/BullMQ, Socket.IO, Zod, Nodemailer, Jest/Supertest and installed `@playwright/test`. No replacement auth, UI kit, CRDT, or new application framework.

## Global Constraints

- Contract: `docs/superpowers/specs/2026-10-28-project-collaboration-design.md`; user-approved current Figma nodes `3:52` and `16:112`. Baseline `28:576`; archived screens are not current UI specifications.
- Roles: Owner / Editor / Viewer. All project chat and AI memory are shared. No Organization, ownership transfer, live keystroke coediting or public access link.
- `Settings → Project → Members & access`; keep existing Profile, Appearance, Security, Notifications, Billing, header, activity bar, COV panel and status bar.
- 1440×900 reference: header 44px, activity bar 60px, Settings sidebar 260px, center approximately 775px, COV 340px, status 24px. Existing responsive/resizing behavior takes precedence over forcing fixed widths at smaller sizes.
- Protected endpoints use `authMiddleware` and authorize the current `req.user.id` against the resource's project. The user-authorized membership feature extends the repository's former Owner-only rule; it does not bypass authentication or allow unrelated users.
- Use ES modules; client 2 spaces, server local formatting commonly 4 spaces. Client API requests remain in `client/src/services/`.
- Preserve existing tracked/untracked work. Never reset/stash/clean it or stage the entire dirty working tree. Stage only task files and intended hunks.
- Migrations only against a verified disposable collaboration DB during execution; never run `db push`, `migrate reset`, or broad destructive test cleanup on the developer DB.
- The design-reference HTML, synthetic JWT and browser fetch fixture from the Figma work are not E2E evidence.
- No claim of success until the final real-stack tests, regression comparison and visual verification pass. External-service stub results and live-provider results are reported separately.
- Execution was subsequently authorized by the user, including the choice of inline/delegated work. Implementation and verification are now in progress; the original granular checklist below remains the acceptance reference rather than an assertion that every release scenario has been exercised.

### Execution-method availability

The header preserves the writing-plans skill's required format. The named `superpowers:*` execution skills are not listed in this session's skill catalog and were not invoked. Execution uses the available implementation/test tools and three delegated workstreams with independent review. The authoritative record of completed checks, commands, limitations and remaining release checks is `docs/research/2026-10-28-project-collaboration-verification.md`.

### Execution checkpoint — 2026-10-28

Membership/invitation APIs, shared access boundaries, concurrent file/scenario publication, operation workspaces, shared chat/memory, Settings integration and the guarded localhost stack are implemented. Final backend verification: 195 suites / 1,493 tests PASS; real PostgreSQL/file/Git integration: 9 suites / 47 tests PASS; integrated browser bundle: 5/5 PASS; real Supertest: 1/1 PASS; real System runtime fixtures: 3/3 PASS. Detailed commands and provider boundaries are in the verification record; unchecked live/release scenarios must not be inferred as passing from these totals.

- [x] M0: guarded disposable stack and preserved working tree.
- [x] M1: migration/backfill, membership and invitation lifecycle verified.
- [x] M2: versioned source/artifact writes, shared AI, operation publication and durable request aliases verified.
- [x] M3: approved Settings shell integrated; actual UI role/draft/account tests pass.
- [x] M4 localhost: real browser, upload/Jest/CFG/performance/export, Supertest and regression evidence recorded.
- [ ] Release/live-provider checks remain separate: Gemini/Firebase/GitHub/Internet SMTP, multi-server failover and historical migration repair are not asserted complete.

---

## 1. Delivery order and gates

| Milestone | Tasks | Gate before continuing |
|---|---|---|
| M0 — safe baseline | 01 | Isolated DB/Redis/SMTP; source status and existing-test results captured |
| M1 — access and membership | 02–07 | Migration rehearsal, member/invitation lifecycle and all affected HTTP boundaries tested |
| M2 — concurrency and shared AI | 08–12 | Race, worker, revoke, chat, memory and quota tests pass |
| M3 — exact frontend integration | 13–18 | Approved Settings visuals, real API interactions, capability states and drafts work |
| M4 — real localhost proof | 19–21 | Actual upload/run/export, four users, realtime, visual diff and regression evidence |

Execution is dependency-ordered, not a promise that every task may be deployed independently. Keep `PROJECT_COLLABORATION_ENABLED=false` until migrations and M1/M2 are complete; enable it in the isolated test stack first. Failure of a gate is repaired within its task before proceeding.

## 2. Interfaces frozen across tasks

### 2.1. Shared access API

Create `shared/projectAccess.js` with exact exported names:

```js
export const PROJECT_ROLES = ['OWNER', 'EDITOR', 'VIEWER'];
export const PROJECT_CAPABILITIES = [
  'project.read', 'project.export', 'members.read', 'files.write',
  'tests.run', 'evidence.approve', 'ai.use', 'memory.write',
  'chat.write', 'chat.delete', 'members.manage', 'integrations.write',
  'snapshot.restore', 'project.delete',
];
const READ_CAPABILITIES = ['project.read', 'project.export', 'members.read'];
const EDITOR_CAPABILITIES = [
  ...READ_CAPABILITIES, 'files.write', 'tests.run', 'ai.use',
  'memory.write', 'chat.write',
];
export function capabilitiesForRole(role) {
  if (role === 'OWNER') return [...PROJECT_CAPABILITIES];
  if (role === 'EDITOR') return [...EDITOR_CAPABILITIES];
  if (role === 'VIEWER') return [...READ_CAPABILITIES];
  return [];
}
export function roleAllows(role, capability) {
  return capabilitiesForRole(role).includes(capability);
}
```

Task 03 owns this pure policy and its exhaustive role/capability tests. Return fresh arrays so callers cannot mutate the policy. Do not add role inheritance from arbitrary strings.

Service signatures, all asynchronous unless marked pure:

```js
resolveProjectAccess({ projectId, userId, capability, db = prisma })
// => { project: { id, ownerId, name, accessRevision, workspaceRevision }, role, capabilities }
resolveSnapshotAccess({ projectId, snapshotId, userId, capability, db = prisma })
// => { ...AccessContext, snapshot }
resolveJobAccess({ jobId, userId, capability, db = prisma })
// => { ...AccessContext, job, snapshot }
withProjectGuard({ projectId, userId, capability, db = prisma }, run)
// run(tx, access); serializes membership/final publish using project advisory transaction lock
```

All `userId`/`capability` inputs are required. Never omit a user predicate when identity is absent. Internal system jobs require an explicit trusted operation context, not an absent identity that means “allow”.

### 2.2. HTTP conventions

Keep existing successful response shapes; add fields rather than silently replacing them. New endpoints use `{ success: true, data }`; errors use `{ success: false, code, message, details? }`. Extend existing client errors to preserve `status/code/details`.

| New method/path under `/api` | Capability / purpose |
|---|---|
| GET `/projects/:id/access` | `project.read`; current role/capabilities/revisions |
| GET `/projects/:id/members?cursor=&limit=50` | `members.read`; Owner first, then stable name/ID order |
| PATCH `/projects/:id/members/:memberId` | `members.manage`; `{ role, expectedRevision }` |
| DELETE `/projects/:id/members/:memberId` | `members.manage`; revision in `If-Match` |
| POST `/projects/:id/leave` | current Editor/Viewer; Owner forbidden |
| GET `/projects/:id/invitations?cursor=&limit=50` | `members.manage`; pending/delivery state, no secret |
| POST `/projects/:id/invitations` | `members.manage`; `{ email, role }`, `Idempotency-Key` header |
| POST `/projects/:id/invitations/:invitationId/resend` | `members.manage`; expected revision, rotates token |
| DELETE `/projects/:id/invitations/:invitationId` | `members.manage`; expected revision, revoke |
| POST `/invitations/inspect` | auth + `{ token }`; minimal valid-invite preview for matching account |
| POST `/invitations/accept` | auth + `{ token }`; one atomic acceptance |
| POST `/invitations/decline` | auth + `{ token }`; consumes matching pending invitation without membership |
| GET `/projects/:id/events?after=&limit=100` | `project.read`; replay invalidation metadata |
| GET `/projects/:id/chat/requests/:requestId` | `project.read`; current shared AI request status/result IDs |

Use POST bodies rather than token-bearing GET URLs to the backend. The browser route has the secret in its path because the email link requires navigation; do not log that path in client telemetry or HTTP access logs, and set `Referrer-Policy: no-referrer` on its page responses.

Status/code contract: 401 `AUTH_REQUIRED`; 404 `PROJECT_NOT_FOUND`/`RESOURCE_NOT_FOUND`; 403 `CAPABILITY_DENIED`/`OWNER_REQUIRED`; 409 `MEMBERSHIP_CHANGED`, `INVITATION_PENDING`, `ALREADY_MEMBER`, `FILE_VERSION_CONFLICT`, `SNAPSHOT_CHANGED`, `OPERATION_BUSY`, `CHAT_BUSY`, `MEMORY_CHANGED`, `RECOVERY_REQUIRED`; 410 `INVITATION_EXPIRED`/`INVITATION_REVOKED`; 428 `FILE_VERSION_REQUIRED`; 429 existing AI app/provider quota codes; 503 `DEPENDENCY_UNAVAILABLE`. Inspect returns only the minimum needed for the matching recipient; wrong-account failure does not reveal project details.

### 2.3. Versioned file/operation API

```js
readVersionedProjectFile({ projectId, snapshotId, userId, path })
// => { snapshotId, path, content, size, version: { revision, sha256 }, workspaceRevision }
mutateProjectWorkspace({ projectId, snapshotId, userId, capability,
  kind, path, newPath, content, expectedVersion, expectedWorkspaceRevision, requestId })
// => { mutationId, snapshotId, path, version?, workspaceRevision }
admitProjectOperation({ projectId, snapshotId, userId, type, input, requestId })
// => { operationId, jobId, reused, status, snapshotId }
publishProjectEvent({ tx, projectId, type, actorId, resourceId, revision, payload })
// => { id, projectId, sequence, type, actorId, resourceId, revision, payload, createdAt }
```

`path` is always a project-relative path. Write APIs require an explicit snapshot. Keep existing `file-content` URL and add the exact version fields; callers are upgraded in Tasks 08/17. No unconditional overwrite escape hatch for a stale client.

### 2.4. Schema and lifecycle inventory

Task 02 provides complete Prisma relations/indexes; these fields are the minimum data contract:

| Entity | Fields / integrity |
|---|---|
| Project additions | `accessRevision Int=0`, `workspaceRevision Int=0`, `eventSequence Int=0`; owner remains source of truth |
| ProjectMember | ID, projectId, userId, role EDITOR/VIEWER, revision, addedByUserId?, joinedAt; unique project/user; project cascade; audit actor SetNull |
| ProjectInvitation | ID, projectId, canonicalEmail, role, tokenHash unique, revision, status PENDING/ACCEPTED/DECLINED/REVOKED/EXPIRED, invitedByUserId?, acceptedByUserId?, expiresAt, createdAt, acceptedAt?; one PENDING per project/email via partial index |
| InvitationDelivery | ID, invitationId, invitationRevision, encryptedPayload?, status QUEUED/SENDING/SENT/FAILED/CANCELED, attempts, nextAttemptAt, lockedUntil?, lastErrorCode?, createdAt; unique invite/revision; no raw token column |
| ProjectEvent | ID, projectId, sequence, type, actorId?, resourceId?, revision?, safe payload Json, createdAt; unique project/sequence |
| ProjectFileVersion | ID, snapshotId, relativePath, revision, sha256?, deleted Boolean, updatedByUserId?, updatedAt; unique snapshot/path; preserve tombstone |
| ProjectMutation | ID/requestId, projectId, snapshotId, actorId?, kind, expected/next workspace revision, journalPath, state PREPARED/APPLIED/RECOVERY_REQUIRED/ABORTED, createdAt; unique project/requestId |
| ProjectOperation | ID, projectId, snapshotId?, actorId?, capability, type, requestId, semanticKey, capturedWorkspaceRevision, status ADMITTED/QUEUED/RUNNING/PUBLISHING/SUCCESS/FAILED/CANCELED/STALE, primaryJobId? unique, timestamps; unique project/actor/requestId; active partial unique project/semanticKey |
| ChatRequest | ID, sessionId, actorId?, clientRequestId, inputHash, status PROCESSING/SUCCEEDED/FAILED/CANCELED, userMessageId?, assistantMessageId?, timestamps; unique session/actor/clientRequestId |
| AiQuotaReservation | ID, userId, requestKey, usageDate, status RESERVED/CONSUMED/RELEASED, createdAt; unique user/requestKey |
| Chat additions | optional senderUserId on user messages, replyToMessageId?, requestId?; creator is not an access filter; retain session processingToken/processingUntil |
| Memory/settings additions | project/fingerprint uniqueness; createdBy/updatedBy attribution; keep revision, memoryGeneration, status/source message tombstones |

Use mapped existing `userId` columns where practical when renaming creator fields in Prisma. Keep historical IDs/timestamps. Soft-forgotten duplicate memory must remain a tombstone; deterministic backfill prefers a tombstone over an active duplicate so extraction does not resurrect deleted content. Write a mapping for any deduplicated memory IDs referenced by conflicts/source metadata.

## 3. Task ledger

### Task 01: Isolated baseline and reproducible evidence

**Files:** Create `docker-compose.collaboration-test.yml`, `server/scripts/collaboration-local.mjs`, `server/src/tests/helpers/collaborationDb.js`, `docs/runbooks/project-collaboration-localhost.md`. Modify `.gitignore` only for generated collaboration artifacts and local test env. Do not edit existing credentials.

**Interfaces:** `collaboration-local.mjs prepare|baseline|start|test|stop|smoke-live`; helper `assertCollaborationTestDatabase(url)` rejects non-loopback hosts and database names other than `covai_collaboration_test`. `createCollaborationFixture({ api, db, withMembers })` returns Owner/Editor/Viewer/Outsider accounts, project/snapshot IDs and a cleanup function limited to those created IDs. `api` is an APIRequestContext or Supertest client against the isolated server.

- [ ] Save `git status --porcelain`, HEAD, relevant source hashes, installed Node/npm/package versions and route inventory in `tmp/collaboration-evidence/baseline/`. Record changed files already present. Obtain actual UI screenshots using the real app/profile flow, not the design harness.
- [ ] Add the test-DB guard first and exercise meaningful rejection:

```js
expect(() => assertCollaborationTestDatabase('postgresql://u:p@db.example.com/main'))
  .toThrow('Disposable collaboration database required');
expect(() => assertCollaborationTestDatabase('postgresql://u:p@127.0.0.1:55432/covai_collaboration_test'))
  .not.toThrow();
```

- [ ] Define PostgreSQL `postgres:16-alpine` at 55432, Redis `redis:7-alpine` at 56379 and SMTP capture `axllent/mailpit:latest` at SMTP 51025/HTTP 58025, with project-scoped volumes and health checks. Record actual image digests after pulling; do not silently update them mid-run. Use Compose project name `covai-collaboration-test` and no fixed global container names. No production volume mounts.
- [ ] Runner creates child-process environment in memory: app `127.0.0.1:55000`, UI `127.0.0.1:55173`, DB above, Redis above, CLIENT_URL/UI/socket URLs aligned; random test JWT/encryption secrets. It must not print the environment or overwrite `server/.env`. `dotenv` must not override these supplied variables. Initial profile/project baseline can run before archive ingestion is enabled.
- [ ] Run baseline frontend build/lint and existing Jest suite against the disposable DB. Capture individual test names/errors/exit codes. Existing failures are enumerated; a new failure or skipped previously-passing test blocks final signoff.

```powershell
node server/scripts/collaboration-local.mjs prepare
node server/scripts/collaboration-local.mjs baseline
npm.cmd run build --prefix client
npm.cmd run lint --prefix client
```

**Gate/commit:** `test: establish isolated collaboration baseline`. Runner `stop` stops only processes/Compose resources it started; cleanup validates absolute paths inside its test workspace. No reset of developer DB.

### Task 02: Add schema and migration/backfill tests

**Files:** Modify `server/prisma/schema.prisma`; create `server/prisma/migrations/<generated_timestamp>_project_collaboration/migration.sql`, `server/src/tests/projectCollaborationMigration.integration.test.js`. Migration timestamp is generated by Prisma at execution; the suffix and contents are fixed by this task.

**Consumes:** Section 2.4, Task 01 disposable DB. **Produces:** models/indexes above, compatible existing Owner data and new creator/audit relations.

- [ ] Seed an old-schema fixture containing Owner project, snapshot, job, user/assistant messages, settings and memory. Write assertions that migration preserves their IDs/content and derives sender identity only for role=`user` from the session creator; assistant identity remains AI/null.
- [ ] Write schema models and all reverse User/Project/ProjectSnapshot/Job relations, explicit delete behavior and partial SQL indexes. Do not create Owner membership rows. Make shared creator fields nullable with SetNull, not cascade-deleting shared history when a creator account is removed. Keep current per-user private notification ownership.

```sql
CREATE UNIQUE INDEX "ProjectInvitation_pending_email_key"
  ON "ProjectInvitation" ("projectId", "canonicalEmail")
  WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "ProjectOperation_active_semantic_key"
  ON "ProjectOperation" ("projectId", "semanticKey")
  WHERE "status" IN ('ADMITTED', 'QUEUED', 'RUNNING', 'PUBLISHING');
```

- [ ] Expire stale pending invitations before creating a replacement; time-based expiry is not encoded as `now()` in an index predicate. Backfill shared memory collisions deterministically with tombstone preference and reference remapping. Do not drop old creator columns or lose memory generation/revision.
- [ ] Generate migration SQL with `--create-only` against the guarded DB, review every drop/cascade and replay on both fresh and old-schema disposable databases. Add required CHECK constraints rejecting role=`OWNER` in membership/invitation. Keep the old Job singleton index until Task 09 replaces its admission path safely.

```powershell
# Workdir server; DATABASE_URL must be the guarded disposable DB from Task 01.
npx.cmd prisma validate
npx.cmd prisma migrate dev --name project_collaboration --create-only
npx.cmd prisma migrate deploy
npx.cmd prisma generate
npm.cmd test -- --runInBand --runTestsByPath src/tests/projectCollaborationMigration.integration.test.js
```

**Gate/commit:** fresh install and legacy backfill pass; explicit `onDelete` tests prove removing a member/user does not delete project test/chat history. `feat: add project collaboration data model`.

### Task 03: Capability policy and central resource resolvers

**Files:** Create `shared/projectAccess.js`, `server/src/services/projectAccess.service.js`, `server/src/middlewares/projectAccess.middleware.js`, `server/src/services/projectGuard.service.js`, `server/src/tests/projectAccess.test.js`, `server/src/tests/projectAccess.integration.test.js`. Modify `server/src/services/projectScope.service.js` as a compatibility seam and `server/src/utils/serviceError.js` for structured codes if needed.

**Produces:** Section 2.1 signatures and pure `roleAllows`. `getProjectById` and resource writes later consume these; no optional-user authorization.

- [ ] Write table-driven positive/negative behavior tests before wiring routes, including absent identity, owner without membership, removed member, role downgrade and cross-project child IDs.

```js
expect(roleAllows('OWNER', 'members.manage')).toBe(true);
expect(roleAllows('EDITOR', 'files.write')).toBe(true);
expect(roleAllows('VIEWER', 'files.write')).toBe(false);
expect(roleAllows('INVALID', 'project.read')).toBe(false);
expect(roleAllows('OWNER', 'unrecognized.action')).toBe(false);
```

- [ ] Implement explicit matrix: Owner receives all listed capabilities; Editor receives read/export/member-read/file-write/test-run/AI-use/memory-write/chat-write; Viewer receives read/export/member-read. Unknown roles/capabilities deny. Return immutable capability arrays.
- [ ] Resolve project + Owner/member in one narrow projection. Resolve children by their DB relation and verify any supplied parent ID equals the resolved project/snapshot. Existing `resolveOwned*` wrappers delegate read resolution only; mutation callers must supply their own explicit action check.
- [ ] Implement `withProjectGuard` with a transaction-scoped advisory lock derived from project ID, then re-read current access inside that same tx. Use parameterized SQL; bounded transaction timeout, lock timeout and retry only serialization/deadlock conflicts up to 3 attempts. A retry must not repeat an already-published filesystem mutation; Task 08 supplies the journal/request-ID guard.

```js
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`;
const access = await resolveProjectAccess({ projectId, userId, capability, db: tx });
return run(tx, access);
```

- [ ] Run new access suites and existing `projectStructure.authorization`, export and socket tests. Ensure database errors are 503/500, never accidentally converted into “authorized”.

**Gate/commit:** `feat: centralize project capability checks`. No route is assumed covered merely because this service exists.

### Task 04: Member lifecycle, revisions and public projections

**Files:** Create `server/src/routes/projectMember.route.js`, `server/src/controllers/projectMember.controller.js`, `server/src/services/projectMember.service.js`, `server/src/services/projectEvent.service.js`, `server/src/validators/projectMember.validation.js`, `server/src/tests/projectMember.route.test.js`; modify `server/index.js` to mount before generic project routes. Implement the DB-only `publishProjectEvent` signature from Section 2.3 here: increment project eventSequence and insert the unique sequence event in the supplied transaction. Task 10 extends this service with delivery/replay; transport never runs before commit.

**Interfaces:** `listProjectMembers({projectId,userId,cursor,limit})`, `changeProjectMemberRole({projectId,userId,memberId,role,expectedRevision})`, `removeProjectMember({projectId,userId,memberId,expectedRevision})`, `leaveProject({projectId,userId})`. Return `{members,total,nextCursor,accessRevision}`; owner row ID is `owner:<ownerId>`, never a mutable membership ID.

- [ ] Assert Owner/Editor/Viewer can list active members but only Owner can change another member. Owner row mutation always returns `OWNER_REQUIRED`/409 and never touches `ownerId`.
- [ ] Validate IDs, role enum, limit 1–100 and cursor format; `.strict()` bodies reject userId/ownerId/extra capability input. PATCH requires expected revision; DELETE parses `If-Match`, not an unversioned delete.
- [ ] Under `withProjectGuard`, CAS-update/delete member and increment project accessRevision, recording the event in the same tx. Concurrent role change/remove with the same revision produces one success and one `MEMBERSHIP_CHANGED`. Rejoining creates a new member identity so an old stale menu cannot alter the new membership.

```js
const results = await Promise.all([changeRoleAtRevision(0), removeAtRevision(0)]);
expect(results.filter(r => r.status === 200 || r.status === 204)).toHaveLength(1);
expect(results.filter(r => r.body?.code === 'MEMBERSHIP_CHANGED')).toHaveLength(1);
```

The test's `changeRoleAtRevision` and `removeAtRevision` are local closures sending PATCH/DELETE to this task's routes with the same seeded membership revision; no special application helper is needed.

- [ ] Member removal leaves snapshots/jobs/results/chat/memory intact. Return narrow user projection `{id,name,email,avatarUrl}` only; do not include password hashes/OAuth tokens/AI usage/private settings. Leave is idempotent for a former member but forbidden for Owner.
- [ ] Run member route/access tests; commit only these files and event persistence seam.

**Gate/commit:** `feat: add revisioned project member management`.

### Task 05: Invitation state machine, encrypted delivery and acceptance

**Files:** Create `server/src/routes/projectInvitation.route.js`, `server/src/routes/invitation.route.js`, `server/src/controllers/projectInvitation.controller.js`, `server/src/services/projectInvitation.service.js`, `server/src/services/invitationDelivery.service.js`, `server/src/services/invitationDeliveryJob.service.js`, `server/src/validators/projectInvitation.validation.js`, tests `projectInvitation.test.js`, `invitationDelivery.test.js`, `invitationAcceptance.integration.test.js`. Modify `server/index.js`, `server/src/services/queue.service.js`, `server/src/utils/sendEmail.js`; reuse `utils/crypto.js`.

**Interfaces:** `createProjectInvitation`, `resendProjectInvitation`, `revokeProjectInvitation`, `inspectInvitation`, `acceptInvitation`, `declineInvitation` take object arguments matching Section 2.2 plus actor userId. `processInvitationDelivery(deliveryId,{send=sendEmail})` is injectable for unit tests. HTTP invitation DTO exposes email/role/expiry/revision/deliveryState, never token/hash/encryptedPayload.

- [ ] Write lifecycle tests for duplicate pending, already-member, expired/revoked, wrong account, same-account repeat accept and concurrent accept/revoke/resend. Assert an expired secret cannot create a member even before a sweeper marks EXPIRED.
- [ ] Generate `randomBytes(32).toString('base64url')`, hash SHA-256, canonicalize with the same email normalization as auth (trim/lowercase; no provider-specific alias rewriting). Store only hash on invitation and encrypted `{recipient,token,clientUrl}` on its delivery row. Use canonical configured CLIENT_URL; reject external return destinations.
- [ ] Create invitation + delivery atomically; after commit kick the delivery worker. Persisted queued rows are also recovered by a bounded dispatcher on startup/timer, so a lost queue notification does not lose email. Claim rows with a lock/lease; skip delivery whose invitation revision/status no longer matches. Retry 1m/5m/30m then FAILED; resend rotates token and cancels old queued delivery.
- [ ] Acceptance under project guard checks current User email, token hash, pending status, expiry and invitation revision, creates unique membership and marks ACCEPTED. Roll back both if either write fails. Check the original invite before treating an existing membership as an idempotent repeat; a revoked token must not be accepted just because a member was separately re-added.

```js
const [a, b] = await Promise.all([
  recipient.post('/api/invitations/accept').send({ token }),
  recipient.post('/api/invitations/accept').send({ token }),
]);
expect([a.status, b.status]).toEqual([200, 200]);
expect(await db.projectMember.count({where:{projectId,userId:recipientId}})).toBe(1);
expect(JSON.stringify(ownerInviteResponse.body)).not.toContain(token);
```

Here `recipient`/`ownerInviteResponse` are the actual HTTP clients/response created in the local integration test; obtain token from the test SMTP capture, not a production API that reveals it.

- [ ] Extend email transport with explicit SMTP_HOST/PORT/SECURE/FROM support for localhost capture while preserving existing Gmail configuration when SMTP_HOST is absent. Sanitize delivery errors into codes; do not log tokens, addresses plus full URLs or provider credentials. Unit failure injection proves pending+FAILED response and recoverable resend. Run invitation/member suites.

**Gate/commit:** `feat: add email-bound project invitations`. Real SMTP acceptance is repeated in Task 20; no actual external emails during unit tests.

### Task 06: Read access across every project-derived surface

**Files:** Modify `project.controller.js`, `coverage.controller.js`, `job.controller.js`, `report.controller.js`, `cyclomatic.controller.js`, `codeHygiene.controller.js`, `performance.controller.js`, `aiSuggestion.controller.js`, `aiTest.controller.js`, `systemAssessment.controller.js`, `file.controller.js` in `server/src/controllers/`; `project.service.js`, `projectScope.service.js`, `projectExport.service.js`, `projectSourceFiles.service.js`, `fileCoverage.service.js`, `coverageFileParser.service.js`, `coverageFunctionParser.service.js`, `frameworkDetection.service.js`, `missingTestDetection.service.js`, `aiSuggestion.service.js`, `aiTest.service.js`, `qualityAnalysis.service.js`, `architectureAiSummary.service.js`, `integrationWorkspace.service.js` in services as their public reads require. Tests: create `projectCollaborationReadAccess.test.js`; extend existing export/coverage/report/structure authorization suites.

**Produces:** member-aware reads with unchanged data contracts and Parent→child consistency. `getProjectById(projectId,userId)` now requires actor and returns safe project fields + effective role/capabilities. `listProjects` includes owned OR membership projects; its Owner project limit still counts only owned projects.

- [ ] Make a row-by-row policy map from the 194 mounted baseline inventory entries. For project reads, assert Owner/Editor/Viewer success and Outsider/cross-project-child denial. Personal/auth/admin routes have named exemptions preserving current scope. Include aliases (`/api/files/files`), query/body project IDs and generated PDF/artifact downloads.
- [ ] Replace Owner equality only at the appropriate access boundary; do not globally search/replace every `ownerId` predicate (deletion, integration writes and ownership data remain Owner-based). Job detail/list/history/streams authorize by project access, not `job.userId`.
- [ ] Verify `getProjectById` checks actor, and pipeline/other callers pass it. Narrow public projections so list/detail do not leak server root/storage paths or credentials. Do not alter coverage/CFG/test metric computations.

```js
for (const actor of [owner, editor, viewer]) {
  expect((await actor.get(`/api/projects/${projectId}`)).status).toBe(200);
  expect((await actor.get(`/api/job/${jobStartedByAnotherMember}`)).status).toBe(200);
}
expect((await outsider.get(`/api/projects/${projectId}`)).status).toBe(404);
expect((await viewer.get(`/api/coverage/${otherProjectSnapshot}/summary`)).status).toBe(404);
```

- [ ] SSE performs access checks before sending headers and again during delivery/revision changes. Keep connection handles available to Task 10 revocation. Read Git status/log/diff without invoking `ensureGitRepo`, changing origins, or updating metadata; Task 07 covers writes.
- [ ] Run new read suite plus all existing affected authorization/export suites; record inventory coverage by route test IDs.

**Gate/commit:** `refactor: authorize project reads through membership`.

### Task 07: Write boundaries, legacy APIs and full route-policy coverage

**Files:** Modify `server/src/routes/project.route.js`, `pipeline.route.js`, `coverage.route.js`, `systemAssessment.route.js`, `github.route.js`, `git.route.js`, `fileManager.route.js`, `file.routes.js`, `upload.route.js`, `job.route.js`, `webhook.route.js`; affected controllers/services from Task 06 plus `git.controller.js`, `github.controller.js`, `upload.controller.js`, `fileManager.controller.js`, `notification.controller.js`, `git.service.js`, `webhook.service.js`, `applyTestSuggestion.service.js`, `unitTestSuggestion.service.js`, `testSanitizer.service.js`. Update legacy `client/src/services/file.service.js` and its `components/editor/EditorContainer.jsx` callers only if they are still reachable. Create `server/src/tests/projectEndpointPolicy.test.js`, `projectCollaborationWriteAccess.test.js`, `legacyFileManagerAuthorization.test.js`.

**Produces:** an explicit per-action policy map, no reachable raw host-path file endpoint, and all mutations passing actor + capability into the service. Current live route imports are authoritative; editing only unused `jobSafe.controller.js` is not a fix.

- [ ] Write negative tests proving Viewer/Outsider cannot start any test/AI/generator job, apply tests, save files, edit scenarios, alter memory, cancel jobs, change Git state or change membership by direct HTTP. Assert queue/model/filesystem spies are untouched on rejection.
- [ ] Map POST semantics explicitly: context preview is a read; framework detection that persists data is a write; approve/confirm expected outcomes uses `evidence.approve`; run/generate uses test/AI capability. Keep public GitHub webhook HMAC verification; resolve its actor as the explicit project integration/Owner identity, never request body userId.
- [ ] Replace raw `/api/file-manager` rootDir/filePath access with projectId/snapshotId/relative-path contracts through the same scope/mutation seam. Host paths return 400 before filesystem access. If an older consumer is unreachable, keep a controlled 400/410 compatibility response rather than mounting its insecure implementation. Cover `/api/pipeline` and alternate upload/import paths.
- [ ] Leave Git mutations Owner-only; disallow arbitrary unreviewed shell command interpolation in the shared boundary. Use argument-vector execution and an explicit supported command allowlist. Preserve existing valid Owner stage/commit/push/pull/checkout flows; credential use stays with the integration Owner, never silently borrowed by another member.
- [ ] Give personal notification create/update endpoints their own user check; an arbitrary `body.userId` must not become a cross-user notification writer. Admin analytics/broadcast retain existing admin behavior.

```js
const denied = await viewer.post('/api/file-manager/save').send({
  projectId, snapshotId, path:'src/a.js', content:'changed', expectedVersion,
});
expect(denied.status).toBe(403);
expect(writeFileSpy).not.toHaveBeenCalled();
expect((await owner.post('/api/file-manager/read').send({filePath:'C:\\outside\\secret'})).status)
  .toBe(400);
```

- [ ] Route-policy test parses actual mounted declarations with installed Babel parser; every current project route has a named policy and a test covering its resource resolver. New routes without a policy fail. Do not freeze 194 as a forever-valid count: new feature routes intentionally increase it. Run the complete access matrix and baseline authorization suites.

**Gate/commit:** `fix: enforce project capabilities on all mutation paths`. File/version handling continues in Task 08; do not expose the feature between these two tasks.

### Task 08: Versioned workspace mutations and crash recovery

**Files:** Create `server/src/services/projectFileVersion.service.js`, `projectMutation.service.js`, `projectMutationRecovery.service.js`, `server/src/validators/projectFile.validation.js`; modify `project.service.js`, `coverage.controller.js`, `systemTestImprovementJob.service.js`, `applyTestSuggestion.service.js`, `aiTestStorage.service.js`, `integrationWorkspace.service.js`, `systemScenarioCatalog.service.js`, `git.service.js`, `server/src/services/projectRuntimePlan.service.js` and canonical publication call sites identified in Task 07; reuse `utils/snapshotWorkspace.js`/contained-path helpers. Tests: `projectFileVersion.test.js`, `projectMutation.integration.test.js`, `projectMutationRecovery.test.js`; extend runtime identity/discovery tests.

**Produces:** Section 2.3 read/mutate signatures. Writes return 428 without expected version; an authorized client can read a new version, not force an overwrite. Rename/delete create destination/source tombstones and validate the expected snapshot workspace revision.

- [ ] Test two HTTP saves from the same version: exactly one updates content; the other returns `FILE_VERSION_CONFLICT` with current version metadata, not the other person's draft. Test unrelated projects/snapshots, delete/recreate ABA, rename race, missing expectedVersion, traversal/symlink and 1 MiB size boundary.

```js
const base = await owner.get(`/api/projects/${projectId}/file-content`)
  .query({snapshotId,path:'src/a.js'});
const save = (actor, content) => actor.put(`/api/projects/${projectId}/file-content`).send({
  snapshotId,path:'src/a.js',content,expectedVersion:base.body.data.version,
});
const outcomes = await Promise.all([save(owner,'owner edit'),save(editor,'editor edit')]);
expect(outcomes.map(r=>r.status).sort()).toEqual([200,409]);
expect(outcomes.find(r=>r.status===409).body.code).toBe('FILE_VERSION_CONFLICT');
```

- [ ] Implement read-time version initialization under the short project guard for existing files, preserving a tombstone if a path was deleted. Compare both DB revision and current disk SHA-256 at save. Select the exact supplied snapshot; increment Project.workspaceRevision on canonical content/topology changes.
- [ ] Keep operation workspaces and backups outside the source tree where possible. Reserve `.covai-collaboration` for any in-tree recovery metadata; add it to `runtimeIgnoredDirectories` in `projectRuntimePlan.service.js` and propagate that existing ignore policy to tree/discovery/hash consumers. Assert that adding journal/backup files leaves source identity, visible source paths and coverage denominator unchanged, while editing `src/a.js` changes source identity. Reject user file mutations targeting the reserved directory.
- [ ] Implement single mutation dispatch for WRITE_FILE/CREATE_FILE/CREATE_FOLDER/RENAME_ENTRY/DELETE_ENTRY/APPLY_TEST/RESTORE/GIT_PUBLICATION. Multi-file operations prepare a staged directory plus manifest; validate every path and affected base revision before publication. Whole-project restore/delete/import acquires the project-level guard and invalidates the snapshot selection. Git can prepare in its own worktree; it cannot bypass the guard for final source changes.
- [ ] Journal contains mutation/request ID, before/after hashes, before backup location, target path, expected workspace revision and state. Use request-specific same-directory temporary filenames, flush/close before atomic rename, and never accept user-supplied journal paths. In the short guarded tx: recheck current role and version, persist PREPARED metadata, publish file, update versions/workspace revision and APPLIED metadata. Write a durable filesystem recovery marker before touching target because an uncommitted SQL row may vanish on DB failure.
- [ ] On failure reconcile journal + actual hashes: if target matches candidate and DB commit is known absent, repair/restore only if no newer revision has committed; if uncertain mark RECOVERY_REQUIRED and block further mutation for that snapshot. Startup recovery is idempotent. No unconditional compensation that overwrites a later user's successful save.
- [ ] Inject failures before rename, after rename/before commit, on DB failure, lease loss, process termination and retrying the same requestId. Verify content, versions and response agree after recovery. Redis unavailability cannot select the former unguarded write fallback. Existing proposal intent/hash checks remain intact.

**Gate/commit:** mutation/race/recovery suites and existing proposal-apply/editor tests pass. `feat: prevent concurrent project file overwrites`.

### Task 09: Operation admission, isolated runs and safe result publication

**Files:** Create `server/src/services/projectOperation.service.js`, `projectOperationWorkspace.service.js`, `projectOperationRecovery.service.js`; modify `job.service.js`, `queue.service.js`, `runTestsJob.service.js`, `supertestCoverageJob.service.js`, `supertestRunner.service.js`, `aiTestsJob.service.js`, `systemAssessmentJob.service.js`, `systemTestImprovementJob.service.js`, `systemMutationJob.service.js`, `systemAssessmentWorkspace.service.js`, `testSanitizer.service.js`, `coverageStorage.service.js`, `integrationWorkspace.service.js`, `autLifecycle.service.js`, `automaticSystemTests.service.js`, `verifiedSystemGeneration.service.js` where they run against/publish canonical state. Add migration suffix `_collaboration_operation_admission` when replacing the old Job singleton index. Tests: `projectOperation.test.js`, `projectOperationWorkspace.test.js`, `projectOperationPublish.integration.test.js`.

**Interfaces:** `admitProjectOperation` (Section 2.3), `withOperationWorkspace(operationId, run)` provides `{rootDir,originalRootDir,snapshotId,workspaceRevision,signal,assertActive}`, `publishOperationResults({operationId,result,expectedWorkspaceRevision})`. Existing worker processors accept an optional explicit operation context so Owner baseline tests can be upgraded without losing their meaning.

- [ ] Write concurrent admission tests: same semantic input reuses one active operation/job; differing runner/model/config/scope/source revision does not merge. Actor/request retry is idempotent. A requestId reused with a different input hash returns 409. Semantic key excludes initiating user so equivalent project work can be shared; normal request-id uniqueness includes actor.
- [ ] Canonicalize supported input recursively with sorted object keys, preserving meaningful array order. Hash project/snapshot/workspace revision/source-test-config identity + job type + runner/mode/model + selected test/scenario scope + shared memory/settings revision where consumed. Do not hash credentials or nondeterministic timestamps into the semantic identity.
- [ ] Create operation + primary job in one DB transaction, let the partial unique index arbitrate concurrent admission, then enqueue after commit. Recovery dispatcher retries queued DB rows if enqueue fails. Preserve current job status fields/result shape. When the new path is tested, replace the old ANALYSIS/SUPERTEST per-snapshot index; serialize incompatible configurations instead of accidentally coalescing them.

```js
const calls = await Promise.all([admit(sameInput,'request-a'),admit(sameInput,'request-b')]);
expect(new Set(calls.map(r=>r.jobId)).size).toBe(1);
expect(calls.filter(r=>r.reused)).toHaveLength(1);
```

In this test `admit` is a local closure around the exported `admitProjectOperation` with a seeded actor/project/snapshot. Verify uniqueness against real PostgreSQL, not only a mocked `findFirst`.

- [ ] Copy canonical source to an operation-specific workspace while holding a consistent snapshot revision. Reuse existing dependency cache/resource allocation and system workspace preparation; keep runtime .env/credentials only in controlled runtime provisioning, never copy arbitrary host secrets. Run installs, test sanitization, instrumentation and generated files inside this workspace. Persist artifacts/results with operation/job identity. Audit all direct fs writers listed by the research so none still writes canonical source while pretending to be a read job.
- [ ] Worker start rechecks current actor capability. Before publishing, use project guard and current access/snapshot revision; changed revision yields STALE and preserves old-run evidence without overwriting the current summary. Canonical AI apply goes through Task 08. Removed actors cannot publish even if a provider/process finishes later. Kill spawned process trees on cancellation with bounded cleanup.
- [ ] Queue fallback may run isolated read-only computation when safe, but never bypass operation admission, DB integrity or mandatory locks. Dependency failure becomes explicit FAILED/503, not a second in-memory untracked execution. Test duplicate deliveries, worker restart, revoked initiator, two API instances, canceled children and stale result publication.

**Gate/commit:** old unit/integration/system worker suites plus new real-DB concurrency suites pass. `feat: coordinate shared project operations safely`.

### Task 10: Project events, subscriptions, replay and immediate revocation

**Files:** Create `server/src/services/projectSubscription.service.js`, `projectStreamRegistry.service.js`, `server/src/routes/projectEvent.route.js`; extend `server/src/services/projectEvent.service.js` from Task 04; modify `server/index.js`, `utils/socketSubscription.js`, `services/systemLiveEvent.service.js`, `services/notification.service.js`, `controllers/job.controller.js`. Tests: `projectSubscription.test.js`, `projectEventReplay.integration.test.js`, `projectRevocation.integration.test.js`; extend `socketSubscription.test.js`.

**Interfaces:** `publishProjectEvent` already declared; `subscribeToProjectRoom(socket,{projectId})`; `revokeProjectSubscriptions({projectId,userId,accessRevision})`; stream registry `registerProjectStream({projectId,userId,close}) => unregister`. Socket events: `project:subscribe` with acknowledgment, `project:event`, `project:access-changed`; preserve existing user notification/system event channels.

- [ ] Test unauthenticated/wrong-user subscribe, removed user reconnect, room-name spoofing, Viewer read subscription, multi-tab sockets, stale sequence replay and revoked SSE. Subscription uses verified JWT identity and current DB access; never joins a client-supplied arbitrary room.
- [ ] Increment project.eventSequence under the mutation transaction, insert safe event row and emit only after commit. Sequence is a JS-safe integer within configured bounds; event replay is ordered/paginated after cursor, with one consistent schema. If an emitted event is missed, persistent replay/refetch repairs it.
- [ ] Membership mutation persists accessRevision/event before removing target sockets from project rooms and closing registered SSE. Reauthenticate/revalidate on reconnect; room recovery must not restore revoked access. In the supported localhost deployment, API+workers share one Socket.IO owner. Document multi-host scaling requires a compatible shared adapter; do not claim distributed eviction from a single-process registry.

```js
await revokeMember(owner,editorMemberId);
expect(await editorSocketSubscription(projectId)).toMatchObject({ok:false,code:'PROJECT_NOT_FOUND'});
expect(await nextSseEventForRemovedUser()).toMatchObject({type:'ACCESS_REVOKED'});
expect(await collectLaterSourceEvents(editorSocket)).toEqual([]);
```

The test defines its socket/SSE collectors with bounded timeouts; it must not use a timeout as the only proof of denial—assert rejected acknowledgment, closed stream and server-side absence from authorized membership/subscription state.

- [ ] Send project events with ID/revision/resource only; keep full source, prompts, tokens, stderr and host paths out. Job-finished personal notification goes to the initiator as before; project progress is a separate shared update and does not spam every member with duplicated toasts.
- [ ] Run user-room regression and project event/revoke suites, including permission downgrade while a write/worker publish is waiting on the guard.

**Gate/commit:** `feat: synchronize shared project events and revocation`.

### Task 11: Atomic AI quota and shared conversation requests

**Files:** Modify `services/aiQuota.service.js`, `chatContext.service.js`, `chat.service.js`, `controllers/aiContext.controller.js`, `validators/aiContext.validation.js`, `routes/project.route.js`; create `services/chatRequest.service.js`, tests `aiQuotaConcurrency.test.js`, `sharedChatAuthorization.test.js`, `sharedChatRequest.integration.test.js`.

**Interfaces:** `reserveAiQuota({userId,requestKey,now})`, `consumeAiQuota(reservationId)`, `releaseAiQuota(reservationId)`; keep existing `checkAndIncrementQuota` as a compatible wrapper until all callers use reservation IDs. `sendContextChat(projectId,userId,input,deps)` adds required `clientRequestId`, returns existing `{reply,sessionId,context}` plus requestId/committed message IDs, or 202 request status for an already-processing same request. `getChatRequest` reads project-scoped status.

- [ ] Test shared session read for Viewer and Editor even when created by Owner; Viewer cannot send, rename, branch or call provider directly. One sender's removed membership cannot hide the rest of the session history. Session delete requires Owner; rename/branch uses chat.write.
- [ ] Remove creator equality as a read/write access filter; preserve creator attribution. Every user message records senderUserId; AI reply records requestId/replyToMessageId. Do not send historical credentials in shared prompts/attachments. Exports/DTOs omit processingToken and quota internals.
- [ ] Within a short transaction claim session processing token and insert ChatRequest with unique session/actor/clientRequestId + input hash. If busy with a different request, return `CHAT_BUSY` without storing a user turn or reserving quota. Extend/verify the lease during a long response; check token/access again before committing the message pair.
- [ ] Quota reservation locks the User row, resets usage day in `Asia/Ho_Chi_Minh`, creates one unique reservation and increments atomically only if below configured limit. Retry the same requestKey returns its existing reservation. Release only when the provider has definitely not been called; provider failure after dispatch remains consumed/recorded as ambiguous, not an invented guaranteed refund.

```js
const results = await Promise.allSettled(Array.from({length:10},(_,i)=>
  reserveAiQuota({userId,requestKey:`chat-${i}`,now:fixedNow})));
expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(remainingQuota);
expect((await db.user.findUnique({where:{id:userId}})).aiUsageCount).toBe(dailyLimit);
```

- [ ] Call Gemini outside DB transactions. On successful response, enter guarded transaction, verify request ownership/session/access, atomically save user+assistant pair and finish request. A retry returns that pair, not another provider call. Failure preserves the client draft; completed work followed by lost HTTP response is recoverable through request status. Emit message-committed event only after commit.
- [ ] Test two actors sending concurrently, same request retry, different payload on reused request ID, lease expiry/loss, revoke during provider call, delete session while generating, empty reply, provider/app quota errors and branch history attribution. Preserve model selection and context budgeting tests.

**Gate/commit:** shared chat/quota concurrency and existing selected-model/Gemini/context suites pass. `feat: share project conversations with request idempotency`.

### Task 12: Shared AI memory, settings and delayed maintenance

**Files:** Modify `services/projectMemory.service.js`, `chatContext.service.js`, `chatMemoryMaintenance.service.js`, `controllers/aiContext.controller.js`, `validators/aiContext.validation.js`; create `server/src/tests/sharedProjectMemory.test.js`, `sharedMemoryMaintenance.integration.test.js`; extend current memory/context tests.

**Interfaces:** Preserve existing public memory/settings endpoint signatures and optimistic `revision`. Creator/updater are audit fields. `ensureContextSettings(projectId,userId,db)` requires access/capability at its caller and cannot use `settings.userId` as exclusive ownership.

- [ ] Test every member reads the same project notes/settings; Editor edits with current revision; Viewer write attempts do not touch DB/provider; wrong-project memory ID is denied. Clear-all and session-wide destructive changes are Owner-only; individual note edit/forget uses memory.write.
- [ ] Replace per-user fingerprint lookup with project/fingerprint uniqueness; createdBy/updatedBy comes from the authenticated actor. Preserve exact quote provenance, status ACTIVE/REVIEW/FORGOTTEN, pinned selection, limit 100 active/review notes and revision. No hidden per-user retrieval remains in context builder or maintenance.
- [ ] Two concurrent note edits at revision r yield one update and one `MEMORY_CHANGED`. Forget/clear increments memoryGeneration so old extraction jobs cannot resurrect tombstones. In-memory context caches include project settings/memory generation in identity and are invalidated on events.

```js
const oldGeneration = settings.memoryGeneration;
await forgetProjectMemory(projectId,editorId,noteId);
await processChatContextMaintenance({...queuedData,memoryGeneration:oldGeneration},deps);
expect(await db.projectMemory.count({where:{projectId,status:'ACTIVE',fingerprint}})).toBe(0);
```

- [ ] Maintenance verifies current project/session/message relationships and the initiating actor's capability before work and before write. Summary CAS is session-scoped; it cannot overwrite a summary from a later turn. Settings revision and memoryGeneration checks occur under the same guarded tx as insertion; API read previews are shared but remain bounded/sanitized.
- [ ] Record memory change events without quote bodies. Test stale extraction after off/edit/forget/clear, conflicting notes, deleted author, branch/source-message deletion and project isolation. Preserve existing context byte limits and credential filters.

**Gate/commit:** `feat: share project memory with revision safeguards`.

### Task 13: Frontend collaboration API, capabilities and cache isolation

**Files:** Create `client/src/services/projectMember.service.js`, `projectInvitation.service.js`, `client/src/hooks/useProjectAccess.js`, `useProjectMembers.js`, `useProjectEvents.js`; modify `client/src/services/project.service.js`, `aiContext.service.js`, `job.service.js`, `lib/queryClient.js`, `hooks/useAuth.js`, `hooks/useSocket.js`. Use existing React Query; do not add a second networking library.

**Interfaces:** API exports `getProjectAccessApi`, `listProjectMembersApi`, `updateProjectMemberApi`, `removeProjectMemberApi`, `leaveProjectApi`, `listProjectInvitationsApi`, `inviteProjectMemberApi`, `resendProjectInvitationApi`, `revokeProjectInvitationApi`, `inspectInvitationApi`, `acceptInvitationApi`, `declineInvitationApi`. Hooks return data/loading/error/mutations based on these exact names.

- [ ] API wrappers encode path IDs, pass bearer auth and expected revision/idempotency headers, preserve status/code/details; do not handle a 403 by logging out a valid account. 401 uses existing auth recovery. Invite token is sent in POST body and never stored in general localStorage/query keys/logs.
- [ ] Define query keys with session identity: `['projectAccess',userId,projectId]`, `['projectMembers',userId,projectId]`, `['projectInvitations',userId,projectId]`, and user+project+snapshot for project-derived caches. Clear relevant queries on logout/account switch and on revoke; abort stale in-flight reads to avoid repopulating revoked caches.
- [ ] Hooks derive role/capabilities from the backend, not localStorage role or hidden button state. Failure to load access denies actions until retry; do not fall back to Owner. `useProjectEvents` validates sequence, refetches on gaps/reconnect and invalidates only relevant project/resource queries.

```js
const memberKeys = {
  access: (userId,projectId) => ['projectAccess',userId,projectId],
  members: (userId,projectId) => ['projectMembers',userId,projectId],
  invites: (userId,projectId) => ['projectInvitations',userId,projectId],
};
```

- [ ] Keep existing user notification socket behavior and model headers. Shared project subscription is separate, cleaned up when changing project. Revoke/downgrade updates capabilities immediately, preserves a private draft for recovery and navigates away from inaccessible project content.
- [ ] Add browser behavior checks in `server/e2e/collaboration-client.spec.mjs` for account switch/cache and structured 409 handling (executed by Task 20). Build/lint after this task; no brittle implementation-mirroring hook tests.

**Gate/commit:** API contract smoke checks + client build/lint. `feat: add client collaboration services and access state`.

### Task 14: Source-faithful Settings placement and navigation

**Files:** Create `client/src/components/dashboard/settings/ProjectMembersSettings.jsx`, `members/MemberTabs.jsx`, `members/MemberList.jsx`, `members/MemberRoleBadge.jsx`; modify `settings/SettingsSidebar.jsx`, `dashboard/Layout.jsx`. Reuse existing common buttons/confirm/toast styling where geometry matches; use local component classes only when the common default differs from approved Settings controls. No new header/activity/COV/status component implementation.

**Consumes:** approved Figma `3:52`, `16:112`, current source baseline, hooks from Task 13. **Produces:** real Members screen in existing shell, Owner/non-owner states, stable URL subtabs and project context.

- [ ] Before coding, take fresh Figma screenshots and read component context through the required Figma design-to-code skill. Check approved nodes, not archived variants. Save 1440×900 visual references and capture current FE baseline at the same viewport/theme. Runtime user/project rows are not required to equal fixture sample text.
- [ ] Extend `SettingsSidebar` props with `{project,access}`; keep old props compatible. Preserve every existing Account row/icon/description/logout and add one Project group only when a project is selected. No new top-level Team/Members icon in ActivityBar.
- [ ] In `Layout`, synchronize selected setting and Members subtab with URL/back/forward/project switch. Render Members content centrally and keep the existing resizers/AIPanel visibility. Keep initial Profile fallback and existing coverage/system/logic URL handling intact.

```jsx
{activeSetting === 'members' && project?.id && (
  <ProjectMembersSettings
    projectId={project.id}
    access={projectAccess}
    tab={membersTab}
    onTabChange={setMembersTabInUrl}
  />
)}
```

`setMembersTabInUrl` is implemented in Layout in this task: clone current URLSearchParams, set tab=settings/setting=members/membersTab to an allowlisted value, preserve projectId, then navigate. Access loading/error is handled before rendering actionable controls.

- [ ] Build Members table with Owner first, correct active total, role and actions. Pending invitations never count as active. Use source typography/padding/tokens; fit long names/emails with readable wrapping/truncation. Include loading skeleton, retry, zero-state and bounded pagination. Non-owner list hides management form/pending tab.
- [ ] Add mobile entry via existing SettingsSidebar `variant="tabs"`; maintain label/focus/keyboard operation. No fixed 775px overflow on small screens. Preserve browser zoom and existing panel resize bounds.
- [ ] Build/lint, then compare Settings Profile before/after and Members/Pending against Figma. Any changed unrelated shell geometry, icon, COV copy or model-selector behavior is a defect, not an aesthetic improvement.

**Gate/commit:** `feat: add project members to existing Settings UI`. Actions are wired in Task 15 before feature signoff.

### Task 15: Invite form, management menu and Pending actions

**Files:** Create `settings/members/InviteMemberForm.jsx`, `MemberActionsMenu.jsx`, `InvitationList.jsx`, `MemberManagementDialogs.jsx`; modify `ProjectMembersSettings.jsx` and member hooks. Reuse existing `ConfirmDialog`, toast provider and focus/escape conventions. Add cases to `server/e2e/collaboration-members.spec.mjs`.

**Interfaces:** Invite callback takes `{email,role,requestId}`; role/remove/resend/revoke callbacks take the row's current revision. Mutations return authoritative row/counts and invalidate scoped keys rather than editing unrelated cached projects.

- [ ] Implement email field label/error, role dropdown with Editor/Viewer only, busy submit protection and idempotency key stable across an in-flight retry. Clear email only after accepted server response; retain it on failure. Pending send and email delivery are distinct UI states.
- [ ] Owner menu cannot target their own Owner row. Change role uses expectedRevision; remove opens the existing confirmation style with member/project name and history-preservation explanation. A 409 refetches the changed row and asks the user to retry deliberately, not overwrite the new role.
- [ ] Pending view has expiry, invited-by and delivery status; resend/revoke have independent row-level loading. Resend updates token revision/expiry and gives clear feedback; failed email retains the row and Retry/Resend affordance. Tab order stays Members then Pending even when selected state changes.
- [ ] Use backend totals and pending permission. User without members.manage never issues invitation queries. The same role restrictions hold when a cached Owner screen receives a downgrade event mid-dialog; close/disable actionable dialog and preserve any unsent input safely.

```js
await ownerPage.getByRole('textbox',{name:'Email address'}).fill(editorEmail);
await ownerPage.getByRole('button',{name:'Send invitation',exact:true}).click();
await ownerPage.getByRole('tab',{name:/Pending invitations/}).click();
await expect(ownerPage.getByText(editorEmail,{exact:true})).toBeVisible();
await expect(viewerPage.getByRole('button',{name:'Send invitation',exact:true})).toHaveCount(0);
```

The tabs use semantic tab roles and selected state; the visual button style remains the approved Figma control. `ownerPage`/`viewerPage` are separately authenticated contexts from Task 20, not role values injected in the browser.

- [ ] Verify 0/1/many members, zero pending, long addresses, retry, double click, menu keyboard/focus and remove cancellation; run client build/lint and the member browser cases on the real API.

**Gate/commit:** `feat: wire member invitations and management actions`.

### Task 16: Invitation landing, login/register return and acceptance

**Files:** Create `client/src/pages/ProjectInvitationPage.jsx`, `client/src/utils/invitationReturn.js`; modify `App.jsx`, `LoginPage.jsx`, `RegisterPage.jsx`, `GithubCallbackPage.jsx` and auth navigation helpers only to carry an allowlisted invite return path. Reuse `components/auth/AuthLayout.jsx`. Tests: `server/e2e/collaboration-invitations.spec.mjs`, server acceptance tests from Task 05.

**Produces:** genuine email-link-to-membership flow; no public source access or fabricated login state.

- [ ] Add `/invitations/:token` outside authenticated-only and redirect-if-authenticated wrappers. Logged-out user gets login/register paths carrying a validated local invitation return, never an arbitrary external return URL. OAuth callback also restores only that allowed path.
- [ ] After login, inspect via token POST. Matching account sees minimal project/inviter/role/expiry; wrong account sees a switch-account action without protected source. Invalid/expired/revoked have separate recovery copy. Read project details/source only after successful acceptance.
- [ ] Accept/Decline have busy/retry protection. Accept navigates to the shared project with access/list invalidation. Decline leaves the project absent. A repeat accept by the same recipient resolves successfully; changed role is read from the server. Do not offer an expired invite retry that silently creates a new invitation.

```js
await inviteePage.goto(inviteUrlFromSmtp);
await inviteePage.getByRole('button',{name:/sign in/i}).click();
await loginThroughUi(inviteePage,inviteeCredentials);
await expect(inviteePage).toHaveURL(/\/invitations\//);
await inviteePage.getByRole('button',{name:'Accept invitation'}).click();
await expect(inviteePage).toHaveURL(/\/main-editor\?projectId=/);
```

Task 20 defines `loginThroughUi` using actual LoginPage form labels; it fills credentials and submits the existing login flow. The SMTP link is fetched from Mailpit by the test runner and never printed into an unredacted report.

- [ ] Test pending URL through login, register and existing GitHub callback navigation seam. Deterministic OAuth unit/browser tests stub only the external OAuth provider; live GitHub confirmation is a separate smoke gate. Invite UI does not rewrite existing normal `/projects` login landing behavior.
- [ ] Ensure no-referrer and token redaction; remove stale saved invite return after use. Run App navigation/auth regression cases plus invite E2E.

**Gate/commit:** `feat: support invitation acceptance through existing auth flows`.

### Task 17: File conflict UX, exact snapshot selection and action guards

**Files:** Create `client/src/components/dashboard/ProjectFileConflictDialog.jsx`, `client/src/utils/projectDraftStore.js`; modify `Editor.jsx`, `Sidebar.jsx`, `Layout.jsx`, `AIPanel.jsx`, `CFGCalculator.jsx`, `FileCodeExecutionView.jsx`, `TestFileViewerPanel.jsx`, relevant `system/SystemTestEditorModal.jsx`/generation-review call sites, `services/project.service.js`, `coverage.service.js`, `systemTest.service.js`, `job.service.js`, `contexts/RunningProcessContext.jsx`, `hooks/useCoverageQuery.js`. Preserve existing panels; only change access/version/attribution plumbing. Tests: `server/e2e/collaboration-workspace.spec.mjs`.

**Interfaces:** `getFileContentApi(projectId,path,{snapshotId})`; `updateFileContentApi(projectId,path,content,{snapshotId,expectedVersion,requestId})`; topology mutations pass expectedWorkspaceRevision. `projectDraftStore` keys include authenticated user, project, snapshot and path, and never reads another user's draft.

- [ ] Store each file's base content/version/snapshot separately from draft. Capture values at request start so switching tab during save cannot mark the wrong file saved. On project switch, discard file caches from the previous project; a dirty file prompt protects the draft.
- [ ] Pass versions from the source read/generation base, not a fresh just-before-save read that would disguise a stale AI candidate as current. Search every `updateFileContentApi`/file save/generation apply caller; no legacy three-argument unconditional save remains in reachable code. Backend rejects omission, so missed callers are visible test failures.
- [ ] On conflict keep editor draft and display latest/base/draft comparison using existing diff language. Offer Keep editing, Copy/download draft, then reload latest; never silently overwrite. Clipboard denial keeps the draft and exposes download; current server snapshot change is handled separately from a same-file conflict.
- [ ] On file-changed event: clean buffer may reload; dirty buffer shows a non-destructive changed indicator. Rename/delete events preserve unsaved work under original identity and explain recovery. On revoke retain only the user's own recoverable draft, cancel shared queries and navigate out; do not keep live source/analysis access under a stale cache.

```js
await openSameFileInContexts(ownerPage,editorPage,'src/calc.js');
await editAndSave(ownerPage,'return 2;');
await editAndSave(editorPage,'return 3;');
await expect(editorPage.getByRole('dialog',{name:/file.*changed/i})).toBeVisible();
await expect(editorPage.getByText('return 3;', {exact:false}).first()).toBeVisible();
expect(await readFileThroughApi(ownerApi,'src/calc.js')).toContain('return 2;');
```

Task 20's workspace helper sets Monaco content through the editor's existing keyboard behavior, not through a fake save endpoint. The read helper calls the real versioned API as Owner.

- [ ] Capability-gate editing, create/rename/delete, run/generate/apply/approve, Git writes, restore/delete project, exports and cancel buttons in all reachable panels. Backend remains authoritative. Existing Owner actions remain enabled; job cards show initiator/reused-operation state without reworking their design. Viewer Monaco is readOnly and hotkeys cannot submit writes.
- [ ] Ensure old localStorage latestSnapshot is only a cache hint, never authority for a write. Test two projects with the same relative path, two snapshots, two accounts in one browser over logout/login, two browser contexts, detached AI proposal, permission downgrade and interrupted saves. Run all existing frontend build/lint plus workspace E2E.

**Gate/commit:** `feat: protect shared editor drafts and project actions`.

### Task 18: Shared COV history/memory within the existing component

**Files:** Modify `client/src/components/dashboard/AIPanel.jsx`, `AIContextDialog.jsx`, `services/project.service.js`, `services/aiContext.service.js`, `hooks/useProjectEvents.js`; create a small `dashboard/ChatMessageAttribution.jsx` only if it avoids repeating sender formatting. Add `server/e2e/collaboration-ai.spec.mjs`.

**Consumes:** shared session/message/memory DTOs, Task 11 request IDs/busy responses, Task 12 revision semantics. Existing COV header, Quick Capabilities, model dropdown, history drawer, composer and context dialog retain their source layout.

- [ ] List sessions by project; show who sent user messages and which request an AI reply answers. Session creator is not used to hide other members' sessions. Preserve branch/history UI and model forwarding.
- [ ] Composer uses a stable clientRequestId for one send/retry. Busy from another actor keeps text/attachments and shows waiting state. Completed reply persists after reconnect/refetch and is not appended twice when both HTTP and Socket event arrive. A timed-out HTTP request checks request status before attempting another generation.
- [ ] Viewer can read all shared chat/context but cannot send, generate, edit memory or branch/rename. Owner can delete a shared session/clear all memory using current confirmation pattern; individual note revision conflicts keep the editor text and offer reload/compare.
- [ ] Context dialog labels memory as shared; attribution is unobtrusive within existing rows. Do not reintroduce private-chat copy from archived Figma. Memory generation events invalidate context preview and shared notes without resetting the current draft/model selection.

```js
await sendSharedChatThroughUi(editorPage,'Check payment retry behavior');
await expect(ownerPage.getByText('Check payment retry behavior',{exact:true})).toBeVisible();
await expect(viewerPage.getByText('Check payment retry behavior',{exact:true})).toBeVisible();
await expect(viewerPage.getByRole('textbox',{name:/Ask COV/i})).toBeDisabled();
expect(await providerCallCountForRequest(requestId)).toBe(1);
```

The composer needs an accessible label while keeping its current placeholder/appearance. `providerCallCountForRequest` reads the test-only transport boundary evidence, not browser request interception.

- [ ] Cover simultaneous chat, memory edit/forget race, revoked author while AI responds, new member reading existing history, wrong-project session/message references, account switch and unchanged model-selector behavior. Build/lint and run shared-AI browser cases.

**Gate/commit:** `feat: connect shared project AI to existing COV UI`.

### Task 19: Real localhost adapters and application startup profile

**Files:** Create `server/src/services/projectStorage.service.js`, `server/src/services/aiProviderTransport.service.js` only at the external-provider boundary, `server/e2e/fixtures/collaboration-project/` containing source/package-lock/test fixture, `server/e2e/collaboration.config.mjs`, `server/e2e/helpers/collaborationFixture.mjs`; complete `server/scripts/collaboration-local.mjs`. Modify `server/src/config/firebase.js` only for explicit provider selection, `controllers/job.controller.js`, `services/project.service.js`, `ingestJob.service.js`, `zipExtraction.service.js`, `coverageStorage.service.js`, `integrationWorkspace.service.js`, `gemini.service.js` at adapter call sites; `client/vite.config.js` for explicit `VITE_PROXY_TARGET`; `server/index.js` adds a readiness endpoint before SPA fallback; environment example docs list new options without credentials.

**Interfaces:** storage `putArchive({projectId,buffer,filename}) => {storageKey}`, `materializeArchive({storageKey,destination})`, `deleteArchive(storageKey)`, `deleteProjectPrefix(projectId)`, `putArtifact({projectId,operationId,relativePath,buffer,mimeType})`. Drivers `firebase` (current default) and `local` (explicit localhost/E2E). Local keys resolve only under the configured validated test root. AI transport default is current Gemini; fixture response mode is rejected outside explicit local test mode and emits a clearly labeled test evidence record.

- [ ] Implement a driver-selection test proving default behavior still uses Firebase and normal Gemini. Local test mode must not read or require actual Firebase/Gemini credentials, and cannot be switched by HTTP input. The test AI adapter produces deterministic valid responses for chat/memory/generation scenarios but does not bypass auth, queue, persistence or UI.
- [ ] Route all six current `getBucket()` consumers through the storage abstraction with compatible Firebase behavior. Coverage/evidence export/download still reads real stored files. Exercise upload-to-ingest-to-snapshot through multipart HTTP; a directly seeded snapshot is not a substitute for this path.
- [ ] Build a tiny real JS project fixture with Jest 29.7.0, a pure `calc.js` function, tests and committed lockfile. Runtime installation/execution uses existing dependency cache/runner against an isolated workspace, producing actual Jest results/coverage. Warm dependencies with real npm; record unavailable external package/network dependencies as a failure/preflight limitation, not a fabricated successful job.
- [ ] Configure readiness: DB reachable, feature migration present, Redis/worker available and correct storage/email mode; return safe booleans/status, never URLs/secrets. E2E runner waits for readiness and actual SPA response before testing. Do not reuse an arbitrary existing server just because a port is open.

```js
// collaboration.config.mjs: actual Playwright test runner, no UI fixture routes.
export default defineConfig({
  testDir: '.', testMatch: 'collaboration-*.spec.mjs',
  workers: 1, fullyParallel: false, timeout: 120000,
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:55173', viewport: {width:1440,height:900},
    trace:'retain-on-failure', screenshot:'only-on-failure' },
  reporter: [['list'],['html',{outputFolder:'../../tmp/collaboration-evidence/playwright',open:'never'}]],
});
```

`defineConfig` is imported from installed `@playwright/test`. The runner starts the stack before this config is invoked and stops its owned processes afterward; do not let a Playwright webServer command reconnect to a developer DB. Multiple webServer entries are an alternative only when they preserve the same guarded environment/process ownership.

- [ ] Set app 55000/UI 55173 and absolute VITE_API_URL/VITE_SOCKET_URL plus proxy target 55000; test relative legacy service URLs too. SMTP uses Mailpit, credentials are generated for the test DB only. Spawn Node/server and Vite with explicit child env and working directories; fail on occupied owned ports rather than killing unrelated processes.
- [ ] Add final commands to runbook:

```powershell
node server/scripts/collaboration-local.mjs prepare
node server/scripts/collaboration-local.mjs start
node server/scripts/collaboration-local.mjs test
node server/scripts/collaboration-local.mjs stop
```

**Gate/commit:** real readiness, multipart ingestion, one real worker test run and report export succeed. `test: run collaboration on a real isolated localhost stack`.

### Task 20: Multi-user browser E2E and concurrency evidence

**Files:** Complete `server/e2e/collaboration-members.spec.mjs`, `collaboration-invitations.spec.mjs`, `collaboration-workspace.spec.mjs`, `collaboration-ai.spec.mjs`, `collaboration-client.spec.mjs`, `collaboration-regression.spec.mjs`, `helpers/collaborationFixture.mjs`; add test artifacts only under `tmp/collaboration-evidence`, not tracked server storage or personal tokens.

**Fixture contract:** `createBrowserCollaborationFixture({browser,request})` registers four unique accounts through the real auth API, creates isolated browser contexts, logs each in through existing LoginPage, creates an Owner project through real API/UI and uploads the fixture archive. Return `{ownerPage,editorPage,viewerPage,outsiderPage,ownerApi,accounts,projectId,snapshotId,smtp,cleanup}`. Editor/Viewer membership is created by invitations+SMTP+acceptance, never by DB insertion in these browser tests.

Helpers used in earlier task examples are implemented here: `loginThroughUi`, `openSameFileInContexts`, `editAndSave`, `readFileThroughApi`, `sendSharedChatThroughUi`. They exercise semantic labels and keyboard/Monaco controls. API fixture tools prepare/check data but cannot replace the user action being tested. Any direct API call uses actual signed-in credentials from the existing auth flow, not synthetic JWTs.

- [ ] E2E-A: Owner opens Settings using the bottom activity icon, sees original five settings entries and adds Editor invitation. Retrieve its email from Mailpit, open link as invitee, log in, accept and reach the shared project. Shared member count updates in the Owner context without page reload. Repeat for Viewer.
- [ ] E2E-B: Owner changes Editor↔Viewer, removes, resends/revokes a pending invitation and tests expiry/duplicate acceptance/wrong account. Same account logs out/in without stale project cache. Removed user cannot refetch source/results/chat or keep receiving project/SSE events.
- [ ] E2E-C: Editor opens a source file, changes content and saves; Owner sees the change. Two contexts save from the same base: one success/one preserved-draft conflict. Test rename/delete/new snapshot and delayed AI apply against changed content. Viewer cannot write via UI, keyboard or forged API call.
- [ ] E2E-D: Editor runs the fixture's real Jest analysis. Owner/Viewer see initiator/progress/results; a simultaneous equivalent request reuses one job; a distinct configuration is not merged incorrectly. Verify one primary operation/actual worker execution and no duplicate quota reservation. Export as Viewer yields a real downloadable report with safe content.
- [ ] E2E-E: Shared COV chat/memory is visible across contexts; sender is correct, two simultaneous sends are serialized/busy without losing draft, retry is idempotent, stale memory edit conflicts, forgotten note remains forgotten after queued maintenance. Label AI transport as fixture mode in evidence; do not claim live Gemini behavior.
- [ ] E2E-F: Outsider guesses project/snapshot/job/session/artifact/legacy paths; all denied without touching providers/files. Revoke during queued/running/publish/chat phases; assert no unauthorized canonical write after revoke is committed. Trigger Redis loss and worker restart: explicit recovery/error, no unguarded fallback.
- [ ] E2E-G: Existing Owner-only project still creates/uploads, opens Explorer, runs analysis, views CFG/architecture/coverage, uses COV model selection, opens What AI knows, navigates Profile/Appearance/Security/Notifications/Billing, resizes/closes panels, exports and uses notifications/logout. System/integration generation/approval/apply retain existing test evidence contracts; their established backend suites and available real runtime fixtures are rerun, not presumed covered by the Jest sample alone.
- [ ] E2E-H: Capture Members/Pending and Profile at 1440×900 in dark/light; mobile at 390×844; two project names and long member/email content. Compare unrelated header/ActivityBar/Settings rows/COV/status geometry against Task 01 baseline. Mask only dynamic timestamps/test-generated identities where necessary, never the whole COV or sidebar.

```powershell
node server/scripts/collaboration-local.mjs test
# Equivalent direct test command after guarded stack startup:
node server/node_modules/@playwright/test/cli.js test --config server/e2e/collaboration.config.mjs
```

**Gate/commit:** all E2E-A–H are green with browser traces/screenshots, persisted DB assertions and worker evidence. Existing fixture HTML or browser fetch mocking causes the runner to reject an E2E case. `test: verify multi-user collaboration end to end`.

### Task 21: Regression, migration rehearsal and release handoff

**Files:** Update `docs/runbooks/project-collaboration-localhost.md`, `api.http`, environment examples, `docs/research/2026-10-28-project-collaboration-verification.md`; add focused test/script fixes only if a gate exposes a defect. Do not include generated tokens, real user email links, raw prompts, DB dumps or runtime storage in commits.

- [ ] Run all changed-area tests, then the full existing server suite in the guarded test environment, frontend build/lint, real localhost E2E and existing runtime fixture suites whose dependencies are present. Compare against Task 01 results test-by-test. Newly failing checks are repaired; unavailable required dependencies remain an explicit unpassed gate.
- [ ] Review rendered Members/Pending against the current Figma nodes, actual FE baseline and both themes. Verify keyboard tab/focus, menu Escape, remove confirmation and screen-reader names without changing approved component appearance. No speculative redesign during polish.
- [ ] Rehearse applying migrations/backfill to a disposable copy of old data. Take a scoped backup first and exercise mutation recovery. Rollback strategy is feature-off/read-only on the new schema-aware app; do not automatically downgrade schema or old binaries after shared data is written. Restore a backup only to a reviewed disposable/staging copy during rehearsal.
- [ ] Stop new invitation/write admission before rollback; drain/cancel active operations, preserve mutation journals, reconcile uncertain publishes, retain shared history and disable Editor/Viewer access with the feature flag while Owner diagnostics remain available. Retain a report of changed API preconditions: version-required saves and removal of unsafe raw-host file access are intentional compatibility changes; existing FE callers must all be upgraded before release.
- [ ] With configured credentials, run explicit `smoke-live` for actual Gemini, GitHub import/webhook/Git, Firebase and outgoing SMTP as needed. It requires a deliberately named test project/repository/recipient and reports those results separately. Do not send real invitations or push commits to unrelated repositories as a generic regression check.
- [ ] Produce verification report with exact commands/exit codes, environment versions, baseline failures, fixed/new failure comparison, migration result, role matrix, concurrency results, screenshots/trace locations and live-vs-fixture provider status. Stage explicit feature files/hunks, inspect `git diff --cached` and verify no pre-existing unrelated edits/secrets are included.

```powershell
npm.cmd run build --prefix client
npm.cmd run lint --prefix client
node server/scripts/collaboration-local.mjs baseline
node server/scripts/collaboration-local.mjs test
git diff --check
git diff --cached --stat
```

The second `baseline` invocation is the same guarded command set as Task 01, saved as the final run rather than overwriting original baseline evidence. Implementation must name its report directory by phase/run ID.

**Gate/commit:** `docs: document collaboration validation and recovery`. Feature is “done” only when all required local gates pass; a plan, screenshot or passing mocked unit suite alone cannot satisfy the user's E2E requirement.

## 4. Coverage map: requirement → tasks → proof

| Requirement | Implementation | Proof |
|---|---|---|
| Preserve current CovAI shell; approved Members/Pending | 13–15 | E2E-A/H, source/Figma geometry comparisons |
| Three project roles; no owner duplication/escalation | 02–04,06–07 | access/member route matrix, E2E-B/F |
| Email invitation and actual auth acceptance | 05,15–16,19 | SMTP capture + real UI auth, E2E-A/B |
| Shared projects/results/export | 06,09–10,13,17 | Editor run/Viewer export, E2E-D |
| Shared all chat/memory | 02,11–12,18 | migration, sender/request/generation tests, E2E-E |
| No silent file overwrite; correct snapshot | 08–09,17 | real save race/ABA/recovery, E2E-C |
| No duplicate jobs/quota/AI request | 09,11 | DB concurrency + worker counts, E2E-D/E |
| Realtime and revoke/downgrade | 04,09–10,13,17–18 | socket/SSE/guard ordering, E2E-B/F |
| Unrelated features remain functional | 01,06–07,14,19–21 | baseline-to-final tests, E2E-G/H |
| Actual localhost E2E, not design fixture | 01,19–21 | real app/PostgreSQL/Redis/worker/SMTP/upload evidence |

## 5. Existing route families requiring explicit policy review

The CSV lists exact current route declarations/line anchors. Extend it with new feature endpoints and per-route test IDs during execution; the table below sets the minimum semantics rather than replacing route-level tests.

| Family | Read semantics | Write semantics / important exceptions |
|---|---|---|
| projects | project.read/export/member access | create is own project; delete/restore Owner; source edits versioned; runs test/AI capability |
| coverage, systemAssessment | snapshot→project; evidence/report/artifact scoped | draft/run vs Owner approve explicitly separated; proposal apply version/guard |
| job, pipeline | project membership for details/history/SSE | admission via operation; cancellation current actor/Owner rule |
| files, file-manager | project/snapshot relative scope; aliases covered | raw host paths denied; same mutation/version seam |
| upload, github | source/project information is scoped | Owner integrations; no client identity trust; upload capability explicit |
| git | read-only status/diff/log/branches without mutation | Owner for stage/discard/commit/push/pull/checkout/init/remote/command |
| ai-tests, ai-suggestions, AI context/chat | project/snapshot/session scope | ai.use/chat.write/memory.write; destructive shared-chat/clear Owner |
| report, cyclomatic, code-hygiene | all resources trace to project | recalculation/persistence uses test/write capability; no parser-only auth shortcut |
| notifications, users | personal identity preserved | cannot send/write another user's notification by body.userId |
| auth, refresh | existing public/auth lifecycle | invitation return allowlisted; no broad weakening |
| analytics | existing admin-only semantics | no membership-based privilege escalation |
| webhook | HMAC-authenticated external event; private config Owner | integration actor explicit; config/secret/branch mutation Owner |
| unmounted performance route | inventory explicitly marks unmounted | do not accidentally expose it while adding feature |

## 6. Local configuration and external boundaries

New documented variables: `PROJECT_COLLABORATION_ENABLED`, `PROJECT_STORAGE_DRIVER`, `PROJECT_STORAGE_ROOT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `EMAIL_FROM`, `COLLABORATION_E2E_ENABLED`, `AI_PROVIDER_MODE`, `VITE_PROXY_TARGET`. Existing DATABASE_URL/JWT/REDIS/ENCRYPTION/CLIENT_URL/VITE_API_URL/VITE_SOCKET_URL stay the same interfaces. Validate combinations on startup: fixture AI/local test credentials cannot silently activate for a public deployment.

| Local profile | Real components | External service treatment |
|---|---|---|
| Deterministic LOCAL-E2E, required | Actual React/Express/auth/Prisma/Postgres/Redis/BullMQ/Socket/storage/Jest/SMTP | Mailpit captures real SMTP; AI transport fixture clearly labeled; no fake HTTP browser API |
| LIVE-INTEGRATION, separately reported | Same app and boundaries | Real Gemini/Firebase/GitHub/SMTP when intentionally configured and authorized |

Do not hard-code real email credentials or read them into the verification report. Keep application-enforced quota separate from provider quota. Local E2E must fail if the backend/worker never ran or the browser loaded `.evidence-review`/`e2e-fixtures` instead of the actual application route.

## 7. Completed plan review (not implementation verification)

- [x] Requirement coverage traced in Section 4; Tasks 06–07 require per-route policy tests against the route inventory. Those tests still need implementation and execution.
- [x] Cross-task access/version/event signatures reconciled with Section 2; Task 04 owns event persistence and Task 10 extends delivery.
- [x] Schema/policy plan keeps Owner in Project.ownerId; creator attribution never substitutes for membership authorization.
- [x] Tasks 08–09 put final authorization/version checks inside the guarded publish boundary and long operations outside its transaction.
- [x] Task 08 explicitly excludes journal/runtime metadata from source hashing/discovery and defines a regression assertion.
- [x] Tasks 11–13/17–18 include shared chat, memory maintenance, exports, cache clearing and conflict drafts.
- [x] Tasks 14–16/20 cover approved Figma, preserved shell, mobile, Owner regression and actual SMTP invitation acceptance.
- [x] Placeholder scan completed; implementation tasks remain unchecked. No migration, application build, feature test or browser E2E was executed as part of writing this plan.

### References used to validate the approach

- [Prisma transaction/OCC guidance](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions): DB atomicity/idempotency mechanisms; it does not make filesystem/provider actions atomic.
- [PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html): use transaction-level scope and bounded critical sections.
- [Socket.IO rooms](https://socket.io/docs/v4/rooms/) and [middleware](https://socket.io/docs/v4/middlewares): room transport still requires application membership checks/revocation.
- [Playwright web servers](https://playwright.dev/docs/test-webserver): actual frontend/backend startup and browser testing; the guarded runner owns test environment isolation here.
