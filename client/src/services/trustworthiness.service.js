import { editorAwareFetch } from './editorAwareRequest';
import { getAIModelHeaders } from './aiModel.service.js';
import { handleUnauthorizedResponse } from '../lib/authSession.js';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function getAuthHeaders() {
  const user = localStorage.getItem('user');
  const userToken = user ? JSON.parse(user).token : null;
  const token = localStorage.getItem('token') || userToken;
  return {
    'Content-Type': 'application/json',
    ...getAIModelHeaders(),
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

export async function evaluationRequest(projectId, suffix = '', {
  method = 'GET', body, signal, download = false,
} = {}) {
  const form = body instanceof FormData;
  const headers = getAuthHeaders();
  if (form) delete headers['Content-Type'];
  const url = `${BASE_URL}/projects/${encodeURIComponent(projectId)}/ai-evaluations${suffix}`;
  const response = await editorAwareFetch(url, {
    method,
    signal,
    headers,
    ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}),
  });
  if (download && response.ok) return response.blob();
  const result = await response.json().catch(error => {
    console.error('Could not parse the evaluation response.', error);
    return {};
  });
  if (!response.ok) {
    if (response.status === 401) await handleUnauthorizedResponse();
    throw Object.assign(new Error(result.message || 'Could not complete the evaluation request.'), {
      status: response.status,
      code: result.code,
      data: result,
    });
  }
  return result.data;
}

export async function downloadEvaluation(projectId, runId, format) {
  const blob = await evaluationRequest(projectId, `/runs/${runId}/report?format=${format}`, {
    download: true,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `chatbot-evaluation-${runId}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadDesignAudit(projectId, format) {
  const blob = await evaluationRequest(projectId, `/design-audit/report?format=${format}`, {
    download: true,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `chatbot-design-audit-${projectId}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
