import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Keep small menus outside scrolling panels while staying inside the viewport.
export default function AnchoredPopover({ anchorRef, onClose, focusFirst = false, children, ...props }) {
  const surface = useRef(null);
  useLayoutEffect(() => {
    const element = surface.current;
    const anchor = anchorRef.current;
    if (!element || !anchor) return;
    const position = () => {
      const bounds = anchor.getBoundingClientRect();
      const gap = 6, edge = 8;
      const below = window.innerHeight - bounds.bottom - gap - edge;
      const above = bounds.top - gap - edge;
      const flip = below < element.scrollHeight && above > below;
      element.style.maxHeight = `${Math.max(0, flip ? above : below)}px`;
      const box = element.getBoundingClientRect();
      element.style.left = `${Math.max(edge, Math.min(bounds.right - box.width, window.innerWidth - box.width - edge))}px`;
      element.style.top = `${Math.max(edge, flip ? bounds.top - gap - box.height : bounds.bottom + gap)}px`;
      element.style.visibility = 'visible';
    };
    const dismiss = event => {
      if (!element.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus(); }
    };
    position();
    if (focusFirst) element.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    element.addEventListener('keydown', keyboard);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const observer = new ResizeObserver(position);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      element.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [anchorRef, onClose, focusFirst]);
  return createPortal(<div {...props} ref={surface} style={{ position: 'fixed', right: 'auto', bottom: 'auto', margin: 0, zIndex: 100, visibility: 'hidden', maxWidth: 'calc(100vw - 16px)', overflowY: 'auto' }}>{children}</div>, document.body);
}
