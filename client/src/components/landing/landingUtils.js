/** Shared, non-component helpers for the landing page. */

export const EASE = [0.16, 1, 0.3, 1];

/** Feeds the cursor position to the CSS spotlight (--sx / --sy). */
export function trackSpot(event) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--sx", `${event.clientX - rect.left}px`);
  el.style.setProperty("--sy", `${event.clientY - rect.top}px`);
}
