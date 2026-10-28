import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Users, Loader2 } from "lucide-react";
import AuthLayout from "../components/auth/AuthLayout";
import { useAuth } from "../hooks/useAuth";
import { inspectInvitationApi, acceptInvitationApi, declineInvitationApi } from "../services/projectInvitation.service";
import { rememberAuthReturn } from "../lib/authReturn";
import { queryClient } from "../lib/queryClient";

export default function InvitationPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const [invitation, setInvitation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const previous = document.querySelector('meta[name="referrer"]');
    const meta = document.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer"; document.head.appendChild(meta);
    return () => { meta.remove(); if (previous) document.head.appendChild(previous); };
  }, []);
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    let alive = true;
    inspectInvitationApi(token).then(data => { if (alive) { setInvitation(data.invitation || data); setError(null); } }).catch(err => { if (alive) setError(err); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, isLoading, isAuthenticated, attempt]);
  const act = async accept => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await (accept ? acceptInvitationApi(token) : declineInvitationApi(token));
      queryClient.clear();
      const projectId = result.projectId || result.project?.id || invitation?.projectId || invitation?.project?.id;
      navigate(accept && projectId ? `/main-editor?projectId=${encodeURIComponent(projectId)}&tab=settings&setting=members` : "/projects", { replace: true });
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  if (!isLoading && !isAuthenticated) {
    rememberAuthReturn(`/invitations/${token}`);
    return <AuthLayout invitationNotice="Sign in or create an account with the invited email address to join this project." />;
  }
  return <AuthLayout><div className="max-w-[380px] mx-auto">
    <Users size={24} className="text-[var(--color-primary)] mb-4" />
    <h1 className="text-xl font-bold">Project invitation</h1>
    {loading || isLoading ? <p role="status" className="flex items-center gap-2 text-sm mt-4"><Loader2 size={16} className="animate-spin" />Checking invitation…</p> : <>
      {error && <div role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{error.message}{![403, 404, 410].includes(error.status) && <button className="underline ml-2" type="button" disabled={busy} onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Retry</button>}</div>}
      {invitation && <><p className="text-sm mt-3 text-[var(--color-text-secondary)]">You have been invited to <strong className="text-[var(--color-text)]">{invitation.project?.name || invitation.projectName || "a CovAI project"}</strong> as {String(invitation.role || "member").toLowerCase()}.</p><p className="text-xs text-[var(--color-text-muted)] mt-3">Project files, test results, all chat history and AI memory are shared with project members.</p><div className="flex gap-3 mt-6"><button type="button" disabled={busy} onClick={() => act(true)} className="h-10 px-4 bg-[var(--color-primary)] text-white rounded-md text-sm disabled:opacity-50">{busy ? "Please wait…" : "Accept invitation"}</button><button type="button" disabled={busy} onClick={() => act(false)} className="h-10 px-4 border border-[var(--color-border)] rounded-md text-sm">Decline</button></div></>}
      <p className="text-xs text-[var(--color-text-muted)] mt-6">Signed in as {user?.email}.</p><button type="button" className="text-xs text-[var(--color-primary)] mt-2 underline" disabled={busy} onClick={() => { rememberAuthReturn(`/invitations/${token}`); logout(); window.location.assign("/login"); }}>Use another account</button>
    </>}
  </div></AuthLayout>;
}
