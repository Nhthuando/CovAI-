import { ProjectEditorProvider } from './ProjectEditorProvider';
const registry = new Map();
const key = scope => JSON.stringify([scope.userId, scope.projectId, scope.snapshotId, scope.path]);
export function acquireEditor(scope) {
  const id = key(scope);
  let entry = registry.get(id);
  if (!entry) { entry = { provider: new ProjectEditorProvider(scope), refs: 0 }; registry.set(id, entry); }
  clearTimeout(entry.timer); entry.refs++;
  return { provider: entry.provider, release: () => { entry.refs--; if (!entry.refs) entry.timer = setTimeout(() => { entry.provider.dispose(); registry.delete(id); }, 250); } };
}
export async function flushProjectEditors(projectId, snapshotId, path) {
  await Promise.all([...registry.values()].map(entry => entry.provider)
    .filter(provider => provider.scope.projectId === projectId && provider.scope.snapshotId === snapshotId && (!path || [provider.scope.path, provider.identity?.path].includes(path)))
    .map(provider => provider.flushPending()));
}
export async function flushMatchingEditors(url) {
  for (const { provider } of registry.values()) {
    if (url.includes(provider.scope.projectId) || url.includes(provider.scope.snapshotId)) await provider.flushPending();
  }
}
export async function saveCollaborativeSnapshotFile(snapshotId, path, content) {
  const provider = [...registry.values()].map(entry => entry.provider).find(value => value.scope.snapshotId === snapshotId && [value.scope.path, value.identity?.path].includes(path));
  return provider ? saveActiveCollaborativeFile(provider.scope.projectId, snapshotId, path, content) : null;
}
export async function saveActiveCollaborativeFile(projectId, snapshotId, path, content) {
  const provider = [...registry.values()].map(entry => entry.provider).find(value => value.scope.projectId === projectId && value.scope.snapshotId === snapshotId && [value.scope.path, value.identity?.path].includes(path));
  if (!provider) return null;
  if (provider.doc?.getText('content').toString() !== content) throw new Error('Shared changes arrived. Review the current file before saving.');
  const result = await provider.save();
  return { success: true, data: { snapshotId, path, workspaceRevision: result.workspaceRevision, version: undefined, collaborative: true } };
}
