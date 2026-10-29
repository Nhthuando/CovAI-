import MemberRoleBadge from "./MemberRoleBadge";
import MemberActionsMenu from "./MemberActionsMenu";

export function MemberAvatar({ name }) {
  const initials = (name || "?").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return <span className="members-avatar" aria-hidden="true">{initials}</span>;
}
export default function MemberList({ rows, userId, canManage, onRole, onRemove, busy }) {
  return <table className="members-table"><thead><tr><th>Member</th><th>Role</th><th>Actions</th></tr></thead><tbody>
    {rows.map(row => {
      const user = row.user || row;
      return <tr key={row.id}><td><div className="members-identity"><MemberAvatar name={user.name || user.email} /><div className="members-identity-copy"><div className="members-name">{user.name || user.email}{(row.userId || user.id) === userId ? " (you)" : ""}</div><div className="members-muted" title={user.email}>{user.email}</div></div></div></td><td><MemberRoleBadge role={row.role} /></td><td>{row.role === "OWNER" ? <span className="members-muted">Project owner</span> : canManage ? <MemberActionsMenu member={row} onRole={onRole} onRemove={onRemove} disabled={busy} /> : <span className="members-muted">—</span>}</td></tr>;
    })}
  </tbody></table>;
}
