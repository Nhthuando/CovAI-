import MemberRoleBadge from "./MemberRoleBadge";
import { MemberAvatar } from "./MemberList";
import { useState } from "react";

export default function InvitationList({ rows, onResend, onRevoke, busy }) {
  const [now] = useState(() => Date.now());
  if (!rows.length) return <p className="members-muted members-empty">No pending invitations. Invite a collaborator using their email address.</p>;
  return <div className="members-invitations">{rows.map(row => {
    const email = row.canonicalEmail || row.email;
    const expires = new Date(row.expiresAt);
    const days = Math.max(0, Math.ceil((expires.getTime() - now) / 86400000));
    const sender = row.invitedBy?.name || row.invitedByUser?.name || row.invitedBy?.email || "project owner";
    const delivery = row.delivery?.status || row.deliveries?.[0]?.status || row.deliveryStatus;
    return <article key={row.id} className="members-invitation">
      <div className="members-invitation-identity"><MemberAvatar name={email} /><div className="members-identity-copy"><p className="members-name">{email}</p><p className="members-muted">Invited by {sender} · {days ? `Expires in ${days} day${days === 1 ? "" : "s"}` : "Expired"}</p></div><MemberRoleBadge role={row.role} /></div>
      <p className="members-pending-status">{delivery === "FAILED" ? "Email delivery failed — resend to retry" : delivery && !["SENT"].includes(delivery) ? "Email queued · Pending acceptance" : "Pending acceptance"}</p>
      <div className="members-row-actions"><button type="button" className="members-button" disabled={busy} onClick={() => onResend(row)}>Resend invitation</button><button type="button" className="members-button" disabled={busy} onClick={() => onRevoke(row)}>Revoke invitation</button></div>
      <p className="members-muted members-resend-hint">Resending replaces the previous invitation link.</p>
    </article>;
  })}</div>;
}
