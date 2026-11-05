import { useCallback, useId, useRef, useState } from 'react';
import AnchoredPopover from '../../common/AnchoredPopover';
import { disciplineLabel } from '../../../../../shared/projectRoles.js';

export default function CollaboratorPresence({ users = [] }) {
  const people = [...new Map(users.map(user => [user.userId, user])).values()];
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  if (!people.length) return null;
  return <div className="covai-live-people" aria-label="Project collaborators">
    {people.slice(0, 4).map(user => <span key={user.userId} className="covai-live-avatar" style={{ '--peer-color': user.color }} title={`${user.name} · ${user.path}`}>{user.name.slice(0, 2).toUpperCase()}</span>)}
    <button ref={trigger} type="button" className="covai-live-popover-trigger" aria-label={`Show ${people.length} online collaborator${people.length === 1 ? '' : 's'}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>{people.length > 4 ? `+${people.length - 4}` : 'Online'}</button>
    {open && <AnchoredPopover anchorRef={trigger} onClose={close} className="covai-live-popover" id={id} role="region" aria-label="Online collaborators">
      {people.map(user => <p key={user.userId}><strong>{user.name}</strong><span title={`${disciplineLabel(user.disciplineRole)} · ${user.path}`}>{disciplineLabel(user.disciplineRole)} · {user.path}</span></p>)}
    </AnchoredPopover>}
  </div>;
}
