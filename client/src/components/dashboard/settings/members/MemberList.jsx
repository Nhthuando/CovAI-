import { disciplineLabel, accessLabel } from '../../../../../../shared/projectRoles.js';
import MemberRoleBadge from "./MemberRoleBadge";
import MemberActionsMenu from "./MemberActionsMenu";

export function MemberAvatar({ name }) {
  const initials = (name || "?").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return <span className="members-avatar" aria-hidden="true">{initials}</span>;
}
export default function MemberList({ rows, userId, canManage, onRole, onRemove, busy }) {
  return <table className="members-table" aria-label="Project members"><thead><tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Access</th><th scope="col">Actions</th></tr></thead><tbody>
    {rows.map(row => {
      const user = row.user || row;
      return <tr key={row.id}><td className="members-cell-identity"><div className="members-identity"><MemberAvatar name={user.name || user.email} /><div className="members-identity-copy"><div className="members-name">{user.name || user.email}{(row.userId || user.id) === userId ? " (you)" : ""}</div><div className="members-muted" title={user.email}>{user.email}</div></div></div></td><td data-label="Role" title={row.role !== "OWNER" && !row.disciplineRole ? "No role assigned. The project owner can set one from Manage." : undefined}>{disciplineLabel(row.role === "OWNER" ? "PM" : row.disciplineRole)}</td><td data-label="Access"><MemberRoleBadge role={row.role} label={accessLabel(row.role)} /></td><td data-label="Actions">{row.role === "OWNER" ? <span className="members-muted members-owner-note">Project owner</span> : canManage ? <MemberActionsMenu member={row} onRole={onRole} onRemove={onRemove} disabled={busy} /> : <span className="members-muted">—</span>}</td></tr>;
    })}
  </tbody></table>;
}
