# CovAI project collaboration — implementation contract

Date: 2026-10-28, Asia/Saigon. User approved the current Figma UI and requested a detailed frontend-to-backend implementation plan. This document freezes the selected UI and translates the prior research into explicit implementation defaults. It does not assert that the feature is implemented or that tests have passed.

## 1. Sources of truth

- Approved Members screen: https://www.figma.com/design/90x2yOO5uDc5u9lTOpgWOY/Untitled?node-id=3-52.
- Approved Pending screen: same file, node `16:112`.
- Existing-FE baseline: node `28:576`; mapping: node `16:322`.
- Current page: `0:1`; source components page: `32:1378`. Archive `32:1377` is historical exploration, not a UI specification.
- Source fidelity ledger: `docs/research/2026-10-27-collaboration-frontend-fidelity.json`.
- Prior decisions/evidence: `docs/research/2026-10-27-project-collaboration-report.md`.
- Route inventory refreshed on planning day: `docs/research/2026-10-28-collaboration-route-inventory.csv`: 195 declarations, 194 mounted, 22 route files; it is a static inventory, not a passing authorization audit.
- Working-tree baseline: HEAD `66cbdb0` plus existing tracked/untracked work. Preserve that work; do not assume HEAD alone describes the current application.

## 2. Product scope

Projects have one Owner and invited Editors/Viewers. They share project files, snapshots, analysis/test results, all project chat sessions, and AI memory. Editing detects stale versions. Concurrent users see shared operation state. Invitations are email-bound and accepted while logged in. No Organization/Team hierarchy, live keystroke collaboration, ownership transfer, public share links, or unrelated dashboard redesign.

### Role defaults for implementation

These details resolve the defaults left explicit in the research; they are not represented as separate historical user approvals.

| Capability | Owner | Editor | Viewer |
|---|:---:|:---:|:---:|
| `project.read`, `project.export`, `members.read` | yes | yes | yes |
| `files.write`, `tests.run`, `ai.use`, `memory.write`, `chat.write` | yes | yes | no |
| `members.manage`, `evidence.approve`, `integrations.write`, `snapshot.restore`, `project.delete`, `chat.delete` | yes | no | no |

- Creating/drafting scenarios uses write/run capability; confirming authoritative requirements/expected outcomes/bindings uses `evidence.approve`. Existing Owner behavior stays available.
- Owner can cancel any project job. Editor can cancel only their own job while still holding the relevant write/run capability. Viewer cannot cancel.
- Editor/Viewer can leave a project. Owner cannot leave, remove themselves or become a non-owner in v1.
- All members can see the active member list. Pending invitations and their email addresses are Owner-only. Editor/Viewer do not see invitation-management controls.
- Ordinary source deletion is an Editor operation; deleting a project, restoring a whole workspace, and Git mutations remain Owner-only.
- Git read endpoints must not initialize repositories or update project metadata as a side effect for readers.
- AI quota is reserved against the initiating user, once per admitted request. A reused project job does not charge its second observer.
- All historical chats/memory in a project become readable to accepted members. Keep the approved disclosure about shared files, results, chat history and memory beside the feature; do not add an unapproved modal redesign.

## 3. Approved UI contract

Keep `DashboardPage`, `Layout`, `ActivityBar`, header, resizers, `AIPanel`, status bar and existing five Settings entries. Add one Project group with the current project name and **Members & access** to `SettingsSidebar`. Render new content in the existing central Settings area.

- At 1440×900 with default panels: header 44px; activity bar 60px; Settings sidebar 260px; center about 775px after borders/resizers; COV panel 340px; status bar 24px.
- Follow existing 32px desktop Settings page padding, 24px card padding, 8px card radius, Inter text and JetBrains Mono code/status typography. Heading 18px, card headings 14px, body/control text 12px, metadata 11px. Use CSS tokens, not a second color system.
- Preserve existing header buttons/icons, COV label, Quick Capabilities, What AI knows, History, New, model selector and composer. Shared-chat additions are attribution/status within existing components, not a replacement AI panel.
- Members card: stable tab order **Members (n)** then **Pending invitations (n)**. Pending count is not an active-member count. Pending selected changes the same card, not the shell.
- Owner row has fixed Owner status and “Project owner”; no self-management menu. Other rows have role and Manage menu. Menus provide Editor/Viewer change and remove; remove requires the existing confirmation pattern.
- Invite form uses email, Editor/Viewer selection (Editor default), Send invitation. Render busy, invalid email, already-member, pending-duplicate, delivery-failed and resend/revoke outcomes inline/toast without changing shell geometry.
- Non-owner members see the list with role explanations and a leave action; no disabled fake owner form. Empty/unselected project, loading, retryable failure, zero pending, pagination/overflow and revoked-access states must be functional.
- Mobile uses the existing Settings navigation variant; preserve current responsive panel controls. Do not use the archived mobile mockup as a new shell design.
- URL: `/main-editor?projectId=<id>&tab=settings&setting=members&membersTab=members|pending`. Existing Settings links without `setting` continue to open Profile. Invalid subtabs fall back safely. Browser back/forward and switching project update selected context.
- Invitation page is an added route `/invitations/:token`; it uses existing auth layout/style. It is outside the authenticated-only route wrapper so login/register can return to it. It does not expose project source before acceptance.
- File conflict uses the existing diff/confirmation visual language; preserve draft, offer compare/copy/download/reload and never silently overwrite. Clipboard failure cannot discard draft.

## 4. Backend boundaries

### Access

`shared/projectAccess.js` defines roles/capability constants and the pure role matrix. `projectAccess.service.js` resolves membership from current DB state; `projectAccess.middleware.js` adapts HTTP inputs. Resource resolvers map snapshot/job/proposal/session/artifact IDs to a project and verify parent-child consistency. Services performing writes recheck access under a project transaction guard. Authentication remains `authMiddleware`.

Use 401 for no/invalid identity; 404 for nonexistent/inaccessible resources outside a user's projects; 403 for an accessible project with an insufficient capability. No client-provided owner/user/room/role is an authority. Admin analytics, personal profile and personal notifications retain their existing scope.

### Storage and consistency

Owner remains `Project.ownerId`; `ProjectMember` stores only Editor/Viewer with unique project/user and monotonic revision. Mutations and revocation serialize at a short PostgreSQL project advisory transaction guard. No model call, email send, package install or test run may execute inside that DB transaction.

Shared file updates require exact `snapshotId` and `expectedVersion` including a monotonic file revision and SHA-256. Do not silently select latest on a write. Record path tombstones so delete/recreate is distinguishable from an old draft. Multi-file operations use a snapshot workspace revision. Use canonical contained paths and reject symlinks/traversal.

All canonical filesystem writes use one mutation service with a recovery journal. Prepare temporary output, acquire the short project guard, recheck actor/versions, record PREPARED, atomically replace the file, record DB/APPLIED state, then emit an invalidation event. PostgreSQL and filesystem are not one atomic transaction: unresolved journals block mutations until recovery. Never restore over a newer successful write during compensation.

Long jobs run in operation-specific workspaces; installation, sanitization, instrumentation and generated output must not modify the canonical snapshot behind the mutation service. Existing system-test workspace/lease code is reused through explicit operation context. Redis leases control admission/resources; final canonical writes also use the DB guard. Redis failure must not silently bypass a required lock.

### Invitations

7-day lifetime; cryptographically random 32-byte secret; SHA-256 token lookup; Editor/Viewer only. Pending uniqueness is per project and canonicalized email. Token generation/version changes invalidate old links. Token is never logged or returned in normal member-management responses.

Send asynchronously through a persistent delivery outbox using existing AES-256-GCM encryption (`utils/crypto.js`) for the retryable email payload. Clear encrypted secret payload when no longer needed. SMTP happens after DB commit. Delivery failure leaves an accurate pending invitation with retry state. Sending is at least once; duplicate delivery of one current token grants no extra permission.

Acceptance verifies the email from the current User record matches the invited mailbox and consumes the emailed secret atomically while authenticated. This token provides mailbox-possession evidence; the existing registration email string alone is insufficient. Concurrent accept/revoke/resend/role-change operates under the same project guard. Accept is idempotent for the same account; a revoked/expired token never resurrects access.

### Shared chat and memory

Session creator is attribution, not access scope. Add sender attribution and request/reply correlation to messages. Preserve creator and AI provenance during migration. A single session admits one active AI request; busy requests retain the client draft and do not reserve quota. A repeated client request ID returns the persisted pair or its in-flight status without another provider call.

Memory is unique per project/fingerprint; createdBy/updatedBy are optional audit identities, not access filters. Revision, generation, forgotten tombstones and delayed-maintenance guards survive the conversion. Set creator FKs to SetNull where shared history must survive a removed/deleted user. Do not expose raw tokens, credentials or server filesystem paths in chat, memory/events or exports.

### Realtime and revocation

Server-authenticated project subscriptions complement existing user notification rooms. Events contain identifiers/revisions, not full source/prompts. On reconnect the client revalidates membership and refetches authoritative state. On removal/downgrade evict project subscriptions, stop SSE, cancel requests and shared caches. Background jobs recheck capability at admission, execution and publish. A revoke racing a final write is ordered by the short project guard; no unauthorized publish after revoke wins that ordering. Already-downloaded bytes cannot be remotely erased.

## 5. Data changes to plan and test

Add: `ProjectMember`, `ProjectInvitation`, `InvitationDelivery`, `ProjectEvent`, `ProjectFileVersion`, `ProjectMutation`, `ProjectOperation`, `ChatRequest`, `AiQuotaReservation`. Keep enum/string lifecycle states and indexes specified in the implementation plan. Add project access/workspace revision fields; add job operation attribution and chat sender correlation. Prefer additive migrations and mapped column names for existing creator columns; preserve old IDs and timestamps.

Migration tests cover existing owner-only projects, existing sessions/messages/memory/settings, duplicate memory fingerprints, cascade behavior, repeatable backfill and rollback rehearsal against a disposable copy. Do not use schema push or destructive reset on the developer's actual database.

## 6. Definition of done

1. Approved Members/Pending screens match source/Figma at 1440×900, with unchanged shell and working small-width behavior.
2. Owner invites through real SMTP capture, invitee accepts through actual login, Editor writes/runs, Viewer reads/exports and Outsider is denied through HTTP and realtime.
3. Concurrent saves, duplicate runs, request retries, membership changes, shared chat and memory conflicts behave as specified.
4. Local E2E uses the actual app/backend/PostgreSQL/Redis/worker/storage path. The design HTML fixture, fake JWTs, intercepted browser API responses or seeded member rows cannot substitute for invite acceptance tests.
5. External AI response may use a clearly labeled test-only provider adapter in deterministic E2E. Live Gemini/GitHub/Firebase/SMTP smoke results are reported separately; never claim those integrations passed from stubs.
6. Existing baseline owner workflows, backend tests and frontend build/lint are rerun. Any pre-existing failure is recorded before implementation and cannot become an excuse for new failures. Evidence compares baseline and final commands/screenshots.
7. Restore/recovery, key uniqueness, privacy, worker cancellation and cross-project negative tests pass. No unrelated work is overwritten; commits stage explicit feature files/hunks only.

## 7. Reference principles

The design applies [Prisma transaction/OCC guidance](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions), [PostgreSQL advisory-lock semantics](https://www.postgresql.org/docs/current/explicit-locking.html), [Socket.IO server-side rooms](https://socket.io/docs/v4/rooms/), and [Playwright multiple web servers](https://playwright.dev/docs/test-webserver). The DB guard, filesystem journal, role defaults and E2E profile are CovAI-specific design decisions rather than guarantees supplied by those tools.
