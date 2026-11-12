/**
 * CovAI Admin System Roles & Granular Permissions
 * Single Source of Truth for Client & Server Admin RBAC
 */

export const SYSTEM_ROLES = Object.freeze({
  SUPERADMIN: 'SUPERADMIN',
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  USER: 'USER',
});

export const SYSTEM_ROLE_LABELS = Object.freeze({
  [SYSTEM_ROLES.SUPERADMIN]: 'Super Admin',
  [SYSTEM_ROLES.ADMIN]: 'Administrator',
  [SYSTEM_ROLES.OPERATOR]: 'Operator',
  [SYSTEM_ROLES.USER]: 'Standard User',
});

export const ADMIN_PERMISSIONS = Object.freeze({
  VIEW_DATA: 'admin.data.view',
  MUTATE_DATA: 'admin.data.mutate',
  DELETE_DATA: 'admin.data.delete',
  HARD_DELETE_DATA: 'admin.data.hard_delete',
  EXPORT_DATA: 'admin.data.export',
  MANAGE_USERS: 'admin.users.manage',
  IMPERSONATE_USER: 'admin.users.impersonate',
  MANAGE_QUEUES: 'admin.queues.manage',
  PURGE_QUEUES: 'admin.queues.purge',
  VIEW_TELEMETRY: 'admin.telemetry.view',
  SYSTEM_CONFIG: 'admin.system.config',
  VIEW_AUDIT_LOGS: 'admin.audit.view',
});

export const ROLE_PERMISSIONS_MAP = Object.freeze({
  [SYSTEM_ROLES.SUPERADMIN]: Object.values(ADMIN_PERMISSIONS),
  [SYSTEM_ROLES.ADMIN]: [
    ADMIN_PERMISSIONS.VIEW_DATA,
    ADMIN_PERMISSIONS.MUTATE_DATA,
    ADMIN_PERMISSIONS.DELETE_DATA,
    ADMIN_PERMISSIONS.EXPORT_DATA,
    ADMIN_PERMISSIONS.MANAGE_USERS,
    ADMIN_PERMISSIONS.MANAGE_QUEUES,
    ADMIN_PERMISSIONS.VIEW_TELEMETRY,
    ADMIN_PERMISSIONS.VIEW_AUDIT_LOGS,
  ],
  [SYSTEM_ROLES.OPERATOR]: [
    ADMIN_PERMISSIONS.VIEW_DATA,
    ADMIN_PERMISSIONS.EXPORT_DATA,
    ADMIN_PERMISSIONS.VIEW_TELEMETRY,
    ADMIN_PERMISSIONS.VIEW_AUDIT_LOGS,
  ],
  [SYSTEM_ROLES.USER]: [],
});

export function hasAdminPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS_MAP[role] || [];
  return permissions.includes(permission);
}

export function isAdminRole(role) {
  return [SYSTEM_ROLES.SUPERADMIN, SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.OPERATOR].includes(role);
}
