export default function MemberTabs({ tab, onChange, membersTotal, invitationsTotal, canManage }) {
  const tabs = [{ id: "members", label: `Members (${membersTotal})` }, ...(canManage ? [{ id: "pending", label: `Pending invitations (${invitationsTotal})` }] : [])];
  return <div role="tablist" aria-label="Project access" className="members-tabs">
    {tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`members-tab-${item.id}`} aria-controls={`members-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className={`members-button ${tab === item.id ? "members-button-primary" : ""}`} onClick={() => onChange(item.id)} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      onChange(tabs[next].id);
      document.getElementById(`members-tab-${tabs[next].id}`)?.focus();
    }}>{item.label}</button>)}
  </div>;
}
