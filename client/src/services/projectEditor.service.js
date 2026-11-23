import { collaborationRequest, projectPath } from './collaborationHttp';
export const getEditorStatus = (projectId, snapshotId) => collaborationRequest(`${projectPath(projectId)}/editor/status?snapshotId=${encodeURIComponent(snapshotId)}`);
export const getEditorRecovery = (projectId, documentId) => collaborationRequest(`${projectPath(projectId)}/editor/documents/${encodeURIComponent(documentId)}/recovery`);
export const checkpointDocuments = (projectId, input) => collaborationRequest(`${projectPath(projectId)}/editor/checkpoint`, { method: 'POST', body: { ...input, requestId: crypto.randomUUID() } });
export const getLineHistory = (projectId, input, signal) => collaborationRequest(`${projectPath(projectId)}/editor/line-history?${new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined))}`, { signal });
export async function checkpointCurrentSnapshot({ projectId, snapshotId, path }) {
  const { flushProjectEditors } = await import('../lib/editor/editorModelRegistry');
  await flushProjectEditors(projectId, snapshotId, path);
  const status = await getEditorStatus(projectId, snapshotId);
  const documents = status.documents.filter(doc => doc.dirty && (!path || doc.path === path));
  if (!documents.length) return { workspaceRevision: status.workspaceRevision, documents: [] };
  return checkpointDocuments(projectId, { snapshotId, documents: documents.map(({ documentId, generation, revision }) => ({ documentId, generation, revision })), expectedWorkspaceRevision: status.workspaceRevision });
}
