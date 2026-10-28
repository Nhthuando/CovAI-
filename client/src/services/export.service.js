const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export async function downloadProjectExportApi(projectId, { snapshotId, format, signal }) {
  const query = new URLSearchParams({ type: format === "zip" ? "project" : "analysis", snapshotId });
  if (format !== "zip") query.set("format", format);
  const token = localStorage.getItem("token");
  const response = await fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/export?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      ["token", "user", "userName", "userEmail"].forEach((key) => localStorage.removeItem(key));
      window.location.href = "/login";
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
