export default function MemberRoleBadge({ role, label: displayLabel }) {
  const label = displayLabel || (role ? `${role[0]}${role.slice(1).toLowerCase()}` : "Unknown");
  return <span className={`members-role ${role === "OWNER" ? "members-role-owner" : ""}`}>{label}</span>;
}
