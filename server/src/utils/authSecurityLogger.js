import logger from "./logger.js";

const SENSITIVE_KEY_RE =
  /password|token|secret|cookie|authorization|encryption|stack|hash/i;

function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return undefined;
  const [local, domain] = email.split("@");
  if (!domain) return undefined;
  const prefix = local ? local.slice(0, 2) : "";
  return `${prefix}***@${domain}`;
}

function sanitizeMeta(meta = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (value === undefined) continue;
    if (key === "email") {
      sanitized.emailMasked = maskEmail(value);
      continue;
    }
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (value instanceof Date) {
      sanitized[key] = value.toISOString();
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Emit structured security audit logs without exposing secrets, tokens, or stack traces.
 */
export function logAuthSecurityEvent(event, meta = {}, level = "warn") {
  const payload = {
    timestamp: new Date().toISOString(),
    category: "AUTH_SECURITY",
    event,
    ...sanitizeMeta(meta),
  };

  const serialized = `[AUTH_SECURITY] ${JSON.stringify(payload)}`;
  if (level === "error") {
    logger.error(serialized);
  } else if (level === "info") {
    logger.info(serialized);
  } else {
    logger.warn(serialized);
  }
  return payload;
}
