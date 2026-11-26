import { API_BASE, authAwareFetch, getAccessToken, handleUnauthorizedResponse } from "../lib/authSession.js";
const BASE_URL = API_BASE;

export async function downloadProjectExportApi(projectId, { snapshotId, format, signal }) {
  const query = new URLSearchParams({ type: format === "zip" ? "project" : "analysis", snapshotId });
  if (format !== "zip") query.set("format", format);
  const token = getAccessToken();
  const response = await authAwareFetch(fetch, `${BASE_URL}/projects/${encodeURIComponent(projectId)}/export?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      await handleUnauthorizedResponse();
    }
    throw new Error(data.message || "Could not download export. Please try again.");
  }
  const blob = await response.blob();
  if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
  const disposition = response.headers.get("Content-Disposition") || "";
  const candidate = disposition.match(/filename="([^"]+)"/)?.[1];
  const filename = candidate && /^[a-zA-Z0-9_.-]+$/.test(candidate) ? candidate : `covai-export.${format}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click(); anchor.remove();
  // Browsers may start consuming the object URL after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return filename;
}
