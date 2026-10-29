import { useRef, useState } from "react";

export default function InviteMemberForm({ onInvite, busy }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [error, setError] = useState("");
  const request = useRef(null);
  const submitting = useRef(false);
  const submit = async event => {
    event.preventDefault();
    if (submitting.current || busy) return;
    const canonicalEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(canonicalEmail)) { setError("Enter a valid email address."); return; }
    const identity = `${canonicalEmail}:${role}`;
    if (request.current?.identity !== identity) request.current = { identity, id: crypto.randomUUID() };
    submitting.current = true;
    setError("");
    try { await onInvite({ email: canonicalEmail, role, requestId: request.current.id }); setEmail(""); request.current = null; }
    catch (err) { setError(err.message); }
    finally { submitting.current = false; }
  };
  return <section className="members-card members-invite" aria-labelledby="invite-member-title">
    <h2 id="invite-member-title">Invite a collaborator</h2>
    <form className="members-invite-form" onSubmit={submit}>
      <label className="members-email"><span className="sr-only">Email address</span><input type="email" autoComplete="email" placeholder="name@example.com" required maxLength={254} value={email} disabled={busy} aria-invalid={!!error} aria-describedby={error ? "invite-error" : "invite-role-help"} onChange={event => { setEmail(event.target.value); setError(""); }} /></label>
      <label><span className="sr-only">Invitation role</span><select aria-label="Invitation role" className="members-button" value={role} disabled={busy} onChange={event => setRole(event.target.value)}><option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option></select></label>
      <button className="members-button members-button-primary" disabled={busy} type="submit">{busy ? "Sending…" : "Send invitation"}</button>
    </form>
    <p id="invite-role-help" className="members-muted">{role === "EDITOR" ? "Editors can edit files, run tests and contribute to shared AI." : "Viewers can view project files, results and shared AI, and export reports."}</p>
    {error && <p id="invite-error" role="alert" className="members-error">{error}</p>}
  </section>;
}
