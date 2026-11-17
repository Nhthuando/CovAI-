import { DISCIPLINE_ROLES, disciplineLabel } from '../../../../../../shared/projectRoles.js';
import { useCallback, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import AnchoredPopover from '../../../common/AnchoredPopover';

export default function MemberActionsMenu({ member, onRole, onRemove, disabled }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const menu = useRef(null);
  const trigger = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const choose = action => { setOpen(false); trigger.current?.focus(); action(); };
  return <div className="members-menu" onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    if (event.key === "Tab") { setOpen(false); trigger.current?.focus(); }
    if (["ArrowDown", "ArrowUp"].includes(event.key) && open) {
      event.preventDefault();
      const items = [...menu.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const current = items.indexOf(document.activeElement);
      items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="members-button" aria-label={`Manage ${member.user?.name || member.name || member.user?.email || member.email}`} aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>Manage <ChevronDown size={11} /></button>
    {open && !disabled && <AnchoredPopover anchorRef={trigger} onClose={close} focusFirst className="members-menu-items" id={menuId} role="menu" aria-label="Manage member"><div ref={menu}>
      <button role="menuitem" type="button" onClick={() => choose(() => onRole(member, { role: member.role === "EDITOR" ? "VIEWER" : "EDITOR" }))}>Change to {member.role === "EDITOR" ? "View" : "Edit"}</button>
      <div className="members-menu-label">Role</div>{DISCIPLINE_ROLES.map(value => <button key={value} role="menuitem" type="button" disabled={member.disciplineRole === value} onClick={() => choose(() => onRole(member, { disciplineRole: value }))}>{disciplineLabel(value)}</button>)}
      <button role="menuitem" type="button" className="members-error" onClick={() => choose(() => onRemove(member))}>Remove member</button>
    </div></AnchoredPopover>}
  </div>;
}
