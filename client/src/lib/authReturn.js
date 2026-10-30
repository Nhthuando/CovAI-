const RETURN_KEY = "covai.invitationReturn";
export function safeAuthReturn(value) {
  return typeof value === "string" && /^\/invitations\/[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
}
export function rememberAuthReturn(value) {
  const path = safeAuthReturn(value);
  if (path) sessionStorage.setItem(RETURN_KEY, path);
}
export function consumeAuthReturn() {
  const path = safeAuthReturn(sessionStorage.getItem(RETURN_KEY));
  sessionStorage.removeItem(RETURN_KEY);
  return path || "/projects";
}
