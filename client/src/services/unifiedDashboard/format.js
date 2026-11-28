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
 * Format duration in milliseconds to human-readable format (e.g. 450ms, 2.4s, 3m 15s, 1h 12m).
 */
export function fmtDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms)) || ms < 0) {
    return "—";
  }
  const roundedMs = Math.round(ms);
  if (roundedMs < 1000) {
    return `${roundedMs}ms`;
  }
  const totalSeconds = ms / 1000;
  if (Number(totalSeconds.toFixed(1)) < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.round(totalSeconds % 60);
  const effectiveMinutes =
    totalSeconds < 60
      ? 1
      : totalMinutes + (remainingSeconds === 60 ? 1 : 0);
  if (effectiveMinutes < 60) {
    const displaySeconds = totalSeconds < 60 || remainingSeconds === 60 ? 0 : remainingSeconds;
    return `${effectiveMinutes}m ${displaySeconds}s`;
  }
  const hours = Math.floor(effectiveMinutes / 60);
  const remMinutes = effectiveMinutes % 60;
  return `${hours}h ${remMinutes}m`;
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
