const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

async function contextRequest(projectId, suffix = "", method = "GET", body) {
  if (!projectId || projectId === "undefined" || projectId === "null") throw new Error("Select a project before loading AI context.");
  const token = localStorage.getItem("token");
  const response = await fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}${suffix}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Could not load context. Please try again.");
  return result.data;
}
export const getAiContext = projectId => contextRequest(projectId, "/ai-context");
export const saveAiContext = (projectId, settings) => contextRequest(projectId, "/ai-context", "PUT", settings);
export const getAiMemories = projectId => contextRequest(projectId, "/ai-context/memories");
export const addAiMemory = (projectId, input) => contextRequest(projectId, "/ai-context/memories", "POST", input);
export const editAiMemory = (projectId, id, input) => contextRequest(projectId, `/ai-context/memories/${encodeURIComponent(id)}`, "PATCH", input);
export const forgetAiMemory = (projectId, id) => contextRequest(projectId, `/ai-context/memories/${encodeURIComponent(id)}`, "DELETE");
export const clearAiMemories = projectId => contextRequest(projectId, "/ai-context/memories", "DELETE");
export const previewAiContext = (projectId, input) => contextRequest(projectId, "/ai-context/preview", "POST", input);
export const branchAiConversation = (projectId, sessionId, input) => contextRequest(projectId, `/chat/sessions/${encodeURIComponent(sessionId)}/branch`, "POST", input);
