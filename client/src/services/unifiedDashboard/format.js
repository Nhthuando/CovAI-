import { formatDistanceToNow } from "date-fns";

/**
 * Format percentage to a fixed number of decimals with "%" suffix.
 * Returns "—" if value is null, undefined, or NaN.
 */
export function fmtPct(val, decimals = 1) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) {
    return "—";
  }
  return `${Number(val).toFixed(decimals)}%`;
}

/**
 * Format numbers with thousand separators (e.g. 12,345).
 */
export function fmtCount(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) {
    return "0";
  }
  return Number(val).toLocaleString("en-US");
}

/**
 * Format duration in milliseconds to human-readable format (e.g. 450ms, 2.4s, 3m 15s).
 */
export function fmtDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms)) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format delta value with sign (+1.2% or -0.5%).
 */
export function fmtDelta(val, decimals = 1) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) {
    return null;
  }
  const num = Number(val);
  const sign = num > 0 ? "+" : num < 0 ? "−" : "";
  return `${sign}${Math.abs(num).toFixed(decimals)}%`;
}

/**
 * Format timestamp into relative time string ("5 minutes ago").
 */
export function fmtRelativeTime(date) {
  if (!date) return "Never";
  try {
    const d = typeof date === "number" || typeof date === "string" ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return "Unknown date";
    return `${formatDistanceToNow(d, { addSuffix: true })}`;
  } catch {
    return "Unknown date";
  }
}

/**
 * Format string or number, returning "—" if empty/null.
 */
export function fmtOrDash(val) {
  if (val === null || val === undefined || val === "") {
    return "—";
  }
  return String(val);
}
