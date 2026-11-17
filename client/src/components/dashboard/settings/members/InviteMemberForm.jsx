import { DISCIPLINE_ROLES, disciplineLabel } from '../../../../../../shared/projectRoles.js';
import { useRef, useState } from "react";

export default function InviteMemberForm({ onInvite, busy }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("VIEWER");
  const [disciplineRole, setDisciplineRole] = useState("DEVELOPER");
  const [error, setError] = useState("");
  const request = useRef(null);
  const submitting = useRef(false);
  const submit = async event => {
    event.preventDefault();
    if (submitting.current || busy) return;
    const canonicalEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(canonicalEmail)) { setError("Enter a valid email address."); return; }
    const identity = `${canonicalEmail}:${role}:${disciplineRole}`;
    if (request.current?.identity !== identity) request.current = { identity, id: crypto.randomUUID() };
    submitting.current = true;
    setError("");
    try { await onInvite({ email: canonicalEmail, role, disciplineRole, requestId: request.current.id }); setEmail(""); request.current = null; }
    catch (err) { setError(err.message); }
    finally { submitting.current = false; }
  };
  return <section className="members-card members-invite" aria-labelledby="invite-member-title">
    <h2 id="invite-member-title">Invite a collaborator</h2>
    <form className="members-invite-form" onSubmit={submit}>
      <label className="members-email"><span className="sr-only">Email address</span><input type="email" autoComplete="email" placeholder="name@example.com" required maxLength={254} value={email} disabled={busy} aria-invalid={!!error} aria-describedby={error ? "invite-error" : "invite-role-help"} onChange={event => { setEmail(event.target.value); setError(""); }} /></label>
      <label className="members-select-field"><span>Role</span><select aria-label="Role" className="members-button" disabled={busy} value={disciplineRole} onChange={event => setDisciplineRole(event.target.value)}>{DISCIPLINE_ROLES.map(value => <option key={value} value={value}>{disciplineLabel(value)}</option>)}</select></label>
      <label className="members-select-field"><span>Access</span><select aria-label="Access" className="members-button" value={role} disabled={busy} onChange={event => setRole(event.target.value)}><option value="EDITOR">Edit</option><option value="VIEWER">View</option></select></label>
      <button className="members-button members-button-primary" disabled={busy} type="submit">{busy ? "Sending…" : "Send invitation"}</button>
    </form>
    <p id="invite-role-help" className="members-muted">{role === "EDITOR" ? "Editors can edit files, run tests and contribute to shared AI." : "Viewers can view project files, results and shared AI, and export reports."}</p>
    {error && <p id="invite-error" role="alert" className="members-error">{error}</p>}
  </section>;
}
