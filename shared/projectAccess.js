export const PROJECT_ROLES = Object.freeze(['OWNER', 'EDITOR', 'VIEWER']);
export const PROJECT_CAPABILITIES = Object.freeze([
  'project.read', 'project.export', 'members.read', 'files.write',
  'tests.run', 'evidence.approve', 'ai.use', 'memory.write', 'chat.write',
  'chat.delete', 'members.manage', 'integrations.write', 'snapshot.restore', 'project.delete',
]);
const READ = ['project.read', 'project.export', 'members.read'];
const EDIT = [...READ, 'files.write', 'tests.run', 'ai.use', 'memory.write', 'chat.write'];
export function capabilitiesForRole(role) {
  if (role === 'OWNER') return [...PROJECT_CAPABILITIES];
  if (role === 'EDITOR') return [...EDIT];
  if (role === 'VIEWER') return [...READ];
  return [];
}
export function roleAllows(role, capability) {
  return capabilitiesForRole(role).includes(capability);
}
