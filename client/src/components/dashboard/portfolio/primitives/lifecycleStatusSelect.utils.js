export const LIFECYCLE_MENU_WIDTH = 224;
export const LIFECYCLE_MENU_ESTIMATED_HEIGHT = 276;
export const VIEWPORT_EDGE_MARGIN = 8;
export const MENU_OFFSET = 6;

const LIFECYCLE_STATUS_LABELS = {
  DOING: "Doing",
  NOT_STARTED: "Not Started",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const EXCLUDED_LIFECYCLE_STATUSES = new Set([
  "COMPLETED",
  "PAUSED",
  "CANCELLED",
]);

/**
 * Determine whether a project lifecycle status excludes it from Active Portfolio KPIs.
 */
export function isExcludedLifecycleStatus(status) {
  return EXCLUDED_LIFECYCLE_STATUSES.has(status);
}

/**
 * Compute viewport-clamped fixed coordinates for a portaled LifecycleStatusSelect dropdown menu.
 */
export function computeLifecycleMenuPosition(
  triggerRect,
  viewport,
  {
    align = "right",
    menuWidth = LIFECYCLE_MENU_WIDTH,
    menuHeight = LIFECYCLE_MENU_ESTIMATED_HEIGHT,
    offset = MENU_OFFSET,
    margin = VIEWPORT_EDGE_MARGIN,
  } = {},
) {
  const vw = Math.max(0, Number(viewport?.width) || 0);
  const vh = Math.max(0, Number(viewport?.height) || 0);
  const topRect = Number(triggerRect?.top) || 0;
  const bottomRect = Number(triggerRect?.bottom) || 0;
  const leftRect = Number(triggerRect?.left) || 0;
  const rightRect = Number(triggerRect?.right) || 0;

  const fitsBelow = bottomRect + offset + menuHeight <= vh - margin;
  const fitsAbove = topRect - offset - menuHeight >= margin;

  let placement = "bottom";
  let rawTop = bottomRect + offset;
  if (!fitsBelow && fitsAbove) {
    placement = "top";
    rawTop = topRect - offset - menuHeight;
  }

  const maxTop = Math.max(margin, vh - menuHeight - margin);
  const top = Math.min(Math.max(margin, rawTop), maxTop);

  const rawLeft = align === "left" ? leftRect : rightRect - menuWidth;
  const maxLeft = Math.max(margin, vw - menuWidth - margin);
  const left = Math.min(Math.max(margin, rawLeft), maxLeft);

  return { top, left, placement };
}

/**
 * Build user toast feedback explaining active KPI inclusion/exclusion after a status update.
 */
export function formatLifecycleUpdateToast(nextStatus) {
  const label =
    LIFECYCLE_STATUS_LABELS[nextStatus] || String(nextStatus || "Updated");

  if (isExcludedLifecycleStatus(nextStatus)) {
    return {
      type: "info",
      title: `Marked as ${label}`,
      message: `Project moved out of Active KPIs. Switch Scope to ${label} or All States to view it.`,
    };
  }

  return {
    type: "success",
    title: `Status set to ${label}`,
    message:
      nextStatus === "DOING"
        ? "Project is now included in Active Portfolio KPIs."
        : "Project is in Active scope and will auto-transition to Doing on test activity.",
  };
}
