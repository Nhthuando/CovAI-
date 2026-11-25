/**
 * Shared calm, harmonious Sleek Industrial UI tokens for Unit & Integration Test workspaces.
 * Avoids loud rainbow colors, gradients, and high-contrast neon badges in favor of
 * neutral monochrome hierarchy with restrained semantic dots/tints.
 */

export const TEST_UI = {
  // Buttons
  btnPrimary:
    "inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-text)] text-[var(--color-bg)] hover:opacity-90 text-xs font-medium transition-all duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-45 disabled:pointer-events-none",
  btnSecondary:
    "inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-45 disabled:pointer-events-none",
  btnSecondaryActive:
    "inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-muted)] text-[var(--color-text)] border border-[var(--color-border-strong)] text-xs font-medium transition-colors duration-150 cursor-pointer",
  btnGhost:
    "inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md bg-transparent hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs font-medium transition-colors duration-150 cursor-pointer disabled:opacity-45 disabled:pointer-events-none",
  btnDangerSubtle:
    "inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-xs font-medium transition-colors duration-150 cursor-pointer disabled:opacity-45 disabled:pointer-events-none",

  // Underline navigation tabs
  tabBase:
    "relative inline-flex items-center gap-1.5 py-2.5 text-xs font-medium transition-colors duration-150 cursor-pointer select-none outline-none border-b-2 -mb-px",
  tabActive: "border-[var(--color-text)] text-[var(--color-text)] font-semibold",
  tabInactive:
    "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",

  // Segmented sub-tabs / filter pills
  segmentedWrap:
    "inline-flex items-center p-0.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] gap-0.5",
  segmentedActive:
    "px-2.5 py-1 rounded text-[11px] font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer",
  segmentedInactive:
    "px-2.5 py-1 rounded text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent transition-colors cursor-pointer",

  // Badges (clean monochrome)
  badgeNeutral:
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]",
  badgeMuted:
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)]",
  badgePass:
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]",
  badgeFail:
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border-strong)]",
  badgeWarn:
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]",

  // Banners (calm flat monochrome surface)
  bannerError:
    "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2.5 text-xs text-[var(--color-text)] flex items-center justify-between gap-3",
  bannerSuccess:
    "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] flex items-center justify-between gap-3",
  bannerWarn:
    "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] flex items-center justify-between gap-3",

  // Progress bar track & fills (monochrome)
  progressTrack:
    "bg-[var(--color-surface-secondary)] h-1.5 rounded-sm overflow-hidden",
  progressFillNeutral: "h-full bg-[var(--color-text-muted)]/60 transition-all duration-300",
  progressFillPass: "h-full bg-[var(--color-text)]/80 transition-all duration-300",
  progressFillWarn: "h-full bg-[var(--color-text-secondary)]/70 transition-all duration-300",
  progressFillFail: "h-full bg-[var(--color-text-muted)]/50 transition-all duration-300",
};

export function calmPctTextClass(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return "text-[var(--color-text-muted)]";
  const n = Number(pct);
  if (n >= 80) return "text-[var(--color-text)]";
  if (n >= 50) return "text-[var(--color-text-secondary)]";
  return "text-[var(--color-text-muted)]";
}

export function calmProgressFillClass(pct) {
  const n = Number(pct || 0);
  if (n >= 80) return TEST_UI.progressFillPass;
  if (n >= 50) return TEST_UI.progressFillWarn;
  return TEST_UI.progressFillNeutral;
}
