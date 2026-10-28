import ConfirmDialog from "../../../common/ConfirmDialog";

export default function MemberManagementDialogs({ action, projectName, busy, onClose, onConfirm }) {
  const identity = action?.row?.user?.name || action?.row?.user?.email || action?.row?.canonicalEmail || action?.row?.email || "this member";
  return <ConfirmDialog isOpen={!!action} onClose={onClose} onConfirm={onConfirm} loading={busy} title={action?.type === "leave" ? "Leave project" : action?.type === "revoke" ? "Revoke invitation" : "Remove member"} confirmText={action?.type === "leave" ? "Leave project" : action?.type === "revoke" ? "Revoke invitation" : "Remove member"} message={action?.type === "leave" ? `Leave ${projectName}? Your project contributions and shared history will remain available to the team.` : action?.type === "revoke" ? `Revoke the invitation for ${identity}? Its invitation link will stop working.` : `Remove ${identity} from ${projectName}? Their access will end. Existing files, results and shared AI history will be preserved.`} />;
}
