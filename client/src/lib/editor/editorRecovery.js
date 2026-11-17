const key = scope => `covai_live_${scope.userId}_${scope.projectId}_${scope.snapshotId}_${scope.path}`;
export const encodeBytes = bytes => {
  let result = ''; for (let offset = 0; offset < bytes.length; offset += 8192) result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
};
export const decodeBytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
export function readRecovery(scope) {
  try { return JSON.parse(sessionStorage.getItem(key(scope)) || 'null'); } catch { return null; }
}
export function writeRecovery(scope, value) {
  try { if (value) sessionStorage.setItem(key(scope), JSON.stringify(value)); else sessionStorage.removeItem(key(scope)); return true; }
  catch { return false; }
}
