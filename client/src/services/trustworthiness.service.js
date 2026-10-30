const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export async function evaluationRequest(projectId, suffix = '', { method = 'GET', body, signal, download = false } = {}) {
  const form = body instanceof FormData;
  const response = await fetch(`${BASE}/projects/${encodeURIComponent(projectId)}/ai-evaluations${suffix}`, {
    method, signal, headers: { ...(!form ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}),
  });
  if (download && response.ok) return response.blob();
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || 'Không thể xử lý yêu cầu đánh giá.'), { status: response.status, code: result.code });
  return result.data;
}
export async function downloadEvaluation(projectId, runId, format) {
  const blob = await evaluationRequest(projectId, `/runs/${runId}/report?format=${format}`, { download: true });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `chatbot-evaluation-${runId}.${format}`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
