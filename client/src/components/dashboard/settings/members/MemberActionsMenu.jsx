import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export default function MemberActionsMenu({ member, onRole, onRemove, disabled }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector('[role="menuitem"]')?.focus();
    const close = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const choose = action => { setOpen(false); trigger.current?.focus(); action(); };
  return <div className="members-menu" ref={root} onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    if (event.key === "Tab") setOpen(false);
    if (["ArrowDown", "ArrowUp"].includes(event.key) && open) {
      event.preventDefault();
      const items = [...root.current.querySelectorAll('[role="menuitem"]')];
      const current = items.indexOf(document.activeElement);
      items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="members-button" aria-label={`Manage ${member.user?.name || member.name || member.user?.email || member.email}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>Manage <ChevronDown size={11} /></button>
    {open && <div className="members-menu-items" role="menu" aria-label="Manage member">
      <button role="menuitem" type="button" onClick={() => choose(() => onRole(member, member.role === "EDITOR" ? "VIEWER" : "EDITOR"))}>Change to {member.role === "EDITOR" ? "Viewer" : "Editor"}</button>
      <button role="menuitem" type="button" className="members-error" onClick={() => choose(() => onRemove(member))}>Remove member</button>
    </div>}
  </div>;
}
