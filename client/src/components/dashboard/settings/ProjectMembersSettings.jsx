import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Loader2 } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";
import { useProjectMembers } from "../../../hooks/useProjectMembers";
import { useToast } from "../ToastContext";
import MemberTabs from "./members/MemberTabs";
import InviteMemberForm from "./members/InviteMemberForm";
import MemberList from "./members/MemberList";
import InvitationList from "./members/InvitationList";
import MemberManagementDialogs from "./members/MemberManagementDialogs";
import "./members/members.css";

export default function ProjectMembersSettings({ projectId, projectName, access, loading, error: accessError, onRetry, tab = "members", onTabChange }) {
  const { userId } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const canManage = !!access?.capabilities?.includes("members.manage");
  const state = useProjectMembers(access ? projectId : null, canManage);
  const [action, setAction] = useState(null);
  const [error, setError] = useState("");
  const rows = state.members.data?.pages.flatMap(page => page.members || []) || [];
  const invitations = state.invitations.data?.pages.flatMap(page => page.invitations || []) || [];
  const selectedTab = canManage && tab === "pending" ? "pending" : "members";
  const query = selectedTab === "pending" ? state.invitations : state.members;
  const busy = [state.invite, state.changeRole, state.remove, state.resend, state.revoke, state.leave].some(item => item.isPending);
  const run = async (mutation, input, message) => {
    setError("");
    try { await mutation.mutateAsync(input); showToast({ type: "success", title: message }); return true; }
    catch (err) { setError(err.status === 409 ? `${err.message} The list has been refreshed. Review it before retrying.` : err.message); return false; }
  };
  const confirm = async () => {
    const success = await run(state[action.type], action.row, action.type === "leave" ? "You left the project" : action.type === "revoke" ? "Invitation revoked" : "Member removed");
    if (success) { setAction(null); if (action.type === "leave") navigate("/projects", { replace: true }); }
  };
  return <section className="project-members-settings" aria-label="Members and access settings">
    <header className="members-heading"><h1><Users size={20} className="text-[var(--color-primary)]" />Members &amp; access</h1><p>Manage access to {projectName || "this project"}, invitations and project permissions.</p></header>
    {loading ? <p role="status" className="members-loading"><Loader2 size={16} className="animate-spin" />Loading project access…</p> : accessError ? <div role="alert" className="members-error">{accessError.message}<button type="button" className="members-button" onClick={onRetry}>Retry</button></div> : access ? <>
      {canManage && <InviteMemberForm busy={state.invite.isPending} onInvite={async input => { await state.invite.mutateAsync(input); showToast({ type: "success", title: "Invitation created", message: "The email has been queued for delivery." }); }} />}
      <div className="members-card members-directory">
        <MemberTabs tab={selectedTab} onChange={onTabChange} membersTotal={state.members.data?.pages[0]?.total ?? rows.length} invitationsTotal={state.invitations.data?.pages[0]?.total ?? invitations.length} canManage={canManage} />
        {error && <p role="alert" className="members-error members-action-error">{error}</p>}
        <div role="tabpanel" id={`members-panel-${selectedTab}`} aria-labelledby={`members-tab-${selectedTab}`}>
          {query.isPending ? <p role="status" className="members-loading"><Loader2 size={16} className="animate-spin" />Loading…</p> : query.error ? <div role="alert" className="members-error">{query.error.message}<button type="button" className="members-button" onClick={() => query.refetch()}>Retry</button></div> : selectedTab === "members" ? <MemberList rows={rows} userId={userId} canManage={canManage} busy={busy} onRemove={row => setAction({ type: "remove", row })} onRole={(row, role) => run(state.changeRole, { memberId: row.id, role, expectedRevision: row.revision }, "Member role updated")} /> : <InvitationList rows={invitations} busy={busy} onResend={row => run(state.resend, row, "Invitation resent")} onRevoke={row => setAction({ type: "revoke", row })} />}
          {query.hasNextPage && <button type="button" className="members-button members-more" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading…" : "Load more"}</button>}
        </div>
      </div>
      <p className="members-muted members-footer">Members share project files, test results, chat history and AI memory.</p>
      {access.role !== "OWNER" && <button type="button" className="members-button members-leave" disabled={busy} onClick={() => setAction({ type: "leave" })}>Leave project</button>}
      <MemberManagementDialogs action={action} projectName={projectName} busy={busy} onClose={() => { if (!busy) setAction(null); }} onConfirm={confirm} />
    </> : null}
  </section>;
}
