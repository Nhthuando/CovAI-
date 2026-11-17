# Collaborative editor: manual acceptance checklist

Status: implementation integrated on 2026-11-04. Automated checks: 10 focused suites / 75 tests passed; 13 existing integration tests skipped. Client build, Prisma validation/generation and backend syntax passed. No new changed-file lint findings; existing editor lint errors remain. Database migration, Docker execution and the browser flows below have not been executed. The user owns browser end-to-end acceptance.

## Setup

- Apply the reviewed additive migration to the intended development database. Do not reset the database.
- Start the normal server/client using the project's normal development commands; no additional collaboration daemon is planned.
- After the implementing agent reports integration checks passed, set `PROJECT_EDITOR_ENABLED=true` in the server's development configuration and restart the server. The client reads availability from the access API.
- Use three separate browser profiles/accounts: project owner, Edit member and View member. Avoid sharing one localStorage session across accounts.
- Create one small project with a JS file containing several distinct lines and a test. Use a GitHub-imported project separately for Git provenance, and a ZIP project without history for the unknown baseline.

### Windows activation

The migration is `server/prisma/migrations/20261104090000_project_editor_collaboration/migration.sql`. It adds tables/columns/checks; it does not reset data. Membership changes require this schema even with live editing disabled. In the intended development environment, inspect pending migrations before applying:

```powershell
cd server
npx.cmd prisma migrate status
npx.cmd prisma migrate deploy
npx.cmd prisma generate
cd ..
```

`migrate deploy` applies every pending committed migration, so check the status output against that environment's expected history. The agent has not connected to or changed the current database.

Set `PROJECT_EDITOR_ENABLED=true` in the server's development configuration, then run `npm.cmd run dev` from the repository root. Keep the existing API origin and Socket.IO CORS origins aligned. The editor uses `VITE_SOCKET_URL` when present, otherwise `http://localhost:5000`; use the same authenticated origin as the existing application. No extra port/service is required. Compose development mounts `shared/` read-only for both apps. Docker itself was not run.

Roll back UI activation by checkpointing/recovering dirty documents first, then disabling `PROJECT_EDITOR_ENABLED` and restarting. Keep additive tables/history. File publication still protects persisted dirty drafts when the flag is off.

Supported initial deployment: one application server. Live editing accepts UTF-8 text up to 1 MiB/20,000 logical lines; oversized files are reported explicitly. Acknowledged shared drafts are durable; Save publishes them to the filesystem workspace used by runners.

## 1. Membership and ownership

- [ ] A new project's creator displays PM, Full access and Project owner.
- [ ] Owner invites Developer + Edit; invite page/email and accepted member show the same values.
- [ ] Owner invites Tester + View; that user can view but cannot edit, run tests or use write/AI actions.
- [ ] Change only Role from Tester to Tech Lead: access stays View.
- [ ] Invite someone with Role PM + View: they cannot manage members or become owner.
- [ ] Upload another snapshot into the same project: ownership remains unchanged.
- [ ] Resize the existing Members screen: Role/Access controls remain usable, English and within the current layout.

## 2. Presence and live editing

- [ ] Owner and Edit member open the same file: avatars and distinct named cursors appear.
- [ ] Type on different lines; both users see both changes without pressing Save.
- [ ] Type near the same position; both views converge without losing text.
- [ ] Select a region while the other person inserts earlier lines: selection/cursor stays attached to the intended text.
- [ ] Undo on one account does not remove unrelated edits by the other account.
- [ ] One user changes files: presence updates, the other person's tab and scroll position stay unchanged.
- [ ] Open the same account in a second tab: no duplicate user count, leaked cursor or duplicate text.
- [ ] Switch theme and reopen an editor/modal: content is not seeded twice or reset.

## 3. Saving, reconnect and access changes

- [ ] Changes saved refers to durable shared draft; Save updates workspace used by tests.
- [ ] Refresh after a durable receipt: accepted text remains available.
- [ ] Disconnect a browser: Reconnecting appears, editing freezes and pending content is preserved.
- [ ] Reconnect: original pending changes are acknowledged once and views converge.
- [ ] Owner changes an editor to View while the file is open: further typing/saving is blocked, reads continue if permitted.
- [ ] Owner removes a member: access is revoked and new source updates stop; pending local recovery remains copyable/downloadable.
- [ ] Restart the server after Changes saved: accepted text survives. Do not treat text typed without acknowledgment as saved.

## 4. Other writers and conflicts

- [ ] Run tests with shared drafts: the run uses a checkpoint of accepted text; the operation record captures its workspace revision (no additional revision badge is added to every results panel).
- [ ] Type after the run starts: typing does not automatically restart tests or change the operation's input copy.
- [ ] AI preview does not overwrite the shared file before explicit Apply.
- [ ] Apply or scenario-fragment save against a dirty conflicting draft reports a recoverable conflict and preserves input.
- [ ] Save draft, then Apply: clean replacement updates other views; delayed old-session edits cannot restore old contents.
- [ ] A versioned legacy save conflict shows Your draft and Server version; merged save uses the latest version and may conflict again safely.
- [ ] Rename/delete a dirty file is refused with an actionable message; a saved file can be renamed/deleted without another client recreating it.
- [ ] Git pull/checkout/restore or snapshot replacement invalidates the old editor generation safely.
- [ ] View user's export uses the saved workspace; it cannot publish someone else's draft.

## 5. Line history

- [ ] Account A changes line 2; hover identifies A after acknowledgment.
- [ ] Account B inserts a line above: A's existing line attribution shifts to the correct line.
- [ ] B changes that same line: hover identifies the last accepted edit by B.
- [ ] Owner clicks Save for A/B changes: attribution does not become Owner for every line.
- [ ] Unchanged imported Git lines show commit author/message; edited uncommitted lines do not inherit a wrong HEAD author.
- [ ] ZIP baseline without history says No line history available instead of crediting uploader.
- [ ] AI-applied lines distinguish AI generation from the person applying it.
- [ ] Rapid tab switching does not put another file's cached hover on the current file.

## 6. UI finish

- [ ] No new top-level page/tab is required for any of these actions.
- [ ] Tooltips, errors, popovers, email copy and accessibility names are English.
- [ ] Coverage gutters, function jump, code-copy, minimap, syntax tools and Ctrl/Cmd+S still work.
- [ ] Light/dark themes remain readable; cursor labels and avatar overflow do not obscure code or Save.
- [ ] Existing unit/integration/system whole-file editors share changes appropriately; scenario fragment and diff previews keep their intended behavior.

## Report a failure

Provide the checklist item, each account's Role/Access, file/snapshot, exact steps and visible error. Include whether the change had received Changes saved and whether Save to workspace had occurred. Never send tokens, credentials or `.env` content.

## Activation record: 2026-11-04

User explicitly confirmed configured Railway is dev/test and authorized applying only the collaboration migration despite historical migration drift. Reviewed additive SQL applied successfully inside one transaction via Prisma db execute; migration 20261104090000_project_editor_collaboration marked applied. No historical migrations were baselined or replayed; unrelated database schema was preserved. Post-apply schema diff contains no missing collaboration tables/columns. PROJECT_EDITOR_ENABLED=true configured in server/.env; Prisma Client regenerated. Local frontend http://localhost:5173 and API http://localhost:5000/api/health responded HTTP 200. Redis startup checked separately below; browser E2E still user-owned.

Redis: Docker Desktop started; existing compose Redis container started successfully. Redis PING returned PONG. Socket.IO polling handshake and local Monaco module returned HTTP 200.

### Blank-page fix and dev restart

Vite dependency optimization incorrectly prebundled Monaco `?worker` imports, dropping their default worker exports. Excluded monaco-editor from optimizeDeps so Vite handles worker imports. Restarted via root npm run dev (background process 2096); client 5173, API 5000 and Redis connected. Actual headless Chromium render of the landing page passed with zero pageerror events, screenshot inspected; production build and changed Vite config lint passed. Browser E2E after login remains user-owned.

### UI audit and corrections

Corrected four-column member sizing (previous three widths totalled 100%, leaving Actions outside the card). Narrow containers use labelled stacked rows; long identities/invitations wrap. Role/Access invite selectors have visible labels. Manage menus and collaborator lists use viewport-positioned portals, flip/scroll when necessary and close on outside interaction/Escape; menu arrows skip disabled items. Pending mutation disables invitation controls; member-change toast now covers both role/access updates. Legacy Unassigned roles are preserved with explanatory tooltip. Presence labels use theme text contrast, read-only previews say View only and editor errors are readable inline. Invitation-page content/actions wrap; conflict/confirmation dialogs fit short screens and retain keyboard focus.

Verification: isolated local render harness using actual UI components and synthetic data at 1200x800, 760x800, 560x800, 390x800 and 390x480. No horizontal overflow or JavaScript page errors; menus/popovers/dialogs remain within viewport. Changed a role and confirmed View access remained; checked Escape focus return and dialog focus containment. Inspected dark/light screenshots of members, invitation, presence and conflict states. Client build and lint for all changed UI files pass. No live account/membership edits or invitation emails were performed for this UI check; full logged-in acceptance remains user-owned. Evidence is in outputs/collaboration-*.png; temporary harness is ignored under client/.evidence-review/.

### Editor initialization crash regression

Fixed useCollaborativeFile initial render: provider?.scope.userId and userId could both be undefined, making the first equality true and evaluating an unguarded provider.scope. Explicitly reject missing provider/scope/user and disabled editing before comparing identities. Also prevents a disabled feature returning the previous provider. Verified actual hook under React StrictMode in a headless browser with a mocked registry: initial auth loading, sign-in, file/project/snapshot switching, disabling/re-enabling, account switching and logout. No page errors or stale returned file scopes. Changed-hook lint and client build passed. No live project data was changed.

### Live editor Joining/read-only regression

Reproduced with actual browser Monaco, actual provider/hook under React StrictMode and an isolated real Socket.IO server. Server binary state arrives as ArrayBuffer in Chromium; passing it directly to Yjs caused Unexpected end of array and prevented opening. Normalize incoming state, document sync/update and awareness bytes to Uint8Array (preserving view offsets); malformed committed updates freeze with a recoverable error instead of an uncaught page exception. The hook now publishes initial Joining/Reconnecting/error state as well as ready state. Read-only guards and server authorization remain intact.

After fix: Viewer opens read-only; PM and Dev open editable; both type through the actual Monaco keyboard interface and both receive the other's accepted text. The test uses synthetic accounts and temporary Socket.IO state, not Railway source changes. Ran 11 focused protocol/document tests (including browser ArrayBuffer and sliced-view regression) successfully. Changed-file lint and client build passed. Read-only inspection of the user's active snapshot confirms Developer + EDITOR access; no member permissions changed. Reload existing browser tabs to replace old provider instances.


### Collaboration performance follow-up

Supersedes the blanket Monaco optimizeDeps exclusion described above: prebundle Monaco but exclude its five worker entries. Existing dev process serves this configuration; reload both browser windows to replace old providers and drain/compact recovered pending updates.

Quick manual acceptance: sign in as PM and Developer with Edit access in separate browser sessions; open Projects -> the same project -> Explorer -> the same text file. Wait for Online, then type a long comment in each window. Confirm both converge without a growing tail of missing characters and both show Changes saved. Switch to another file and back; repeat. Set Developer to View in Members and verify it becomes read-only; restore Edit. Save to workspace, refresh both and confirm persisted content. Briefly disconnect/reconnect one session and check pending text recovers. Run full business E2E separately as planned.

Controlled 60-character benchmark with 300 ms per durable write: final remote lag after typing reduced from 18.8 seconds / 60 writes to 0.36 seconds / 4 writes. Actual Railway warm durable SQL measured 326 ms / one query; canonical read and existing open each 331 ms / one query (service timing excludes HTTP/auth/browser). Results describe these fixtures, not a many-user capacity guarantee. No additional migration or live project edits were needed for these checks. See the performance plan for scripts, permissions/retry/race verification and scaling limits.


### Save performance follow-up

Checkpoint queries are batched and Save no longer waits for post-commit subscriber delivery or unrelated files' pending edits. Source bytes, versions, attribution and checkpoint/event metadata still commit before success. Measured dirty-file checkpoint is about 2-3 seconds on Railway (seven database roundtrips including transaction boundaries); status lookup adds about 0.33 seconds. Browser/auth, pending edits and lock contention are additional time. This is fixture timing, not a production latency guarantee.

Reload both sessions, edit the same file, wait for Changes saved, then click Save. Confirm Saving ends, refresh and verify contents. Repeat with Save immediately after typing. Test an edit followed by undo and Save, and verify a View member cannot save. A forced-database-failure check on private temporary tables verified checkpoint metadata rollback, journal restoration and successful retry. Browser fixture Save and 30 focused tests passed; full real-account E2E remains user-owned.


### Running process context hot-update regression

The reported stack had Provider timestamp 1793806435859 and consumer timestamp 1793806435862. Preserve the React Context object in Vite hot.data across module evaluations; do not suppress the missing-provider exception or create a second provider. Isolated browser fixture deliberately imports those two timestamps, renders a hook consumer inside the other version of the provider, and confirms shared state updates with no page errors. Production client build passes. Existing file lint remains 20 errors / 2 warnings, unchanged by this fix. Refresh existing error-boundary pages once to adopt the stable context. Evidence: outputs/running-context-regression.mjs. Vite reference: https://vite.dev/guide/api-hmr#hot-data.


### Line-history hover latency

Reload the editor, wait for Changes saved and hover a recently edited line. Move to nearby edited lines: they should reuse the small attribution range cache. Edit again and wait for sync, then hover: new revision must show the current author. Switch accounts/projects and ensure previous attribution is not reused. Unsynced text says Unsynced edit. Existing Git-only lines still fall back to read-only blame; unknown provenance is never assigned a guessed author. New first lookup measured 283 ms server query time on Railway, adjacent authored hover 1 ms in synthetic browser fixture. Cache expires after five seconds and invalidates naturally with document revision; these measurements are not a production concurrency guarantee.
