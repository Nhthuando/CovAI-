import { capabilitiesForRole, roleAllows, PROJECT_CAPABILITIES } from '../../../shared/projectAccess.js';
import { resolveProjectAccess, resolveSnapshotAccess, membershipWhere } from '../services/projectAccess.service.js';
import { jest } from '@jest/globals';

test('roles deny unknown capabilities and do not leak mutable policy arrays', () => {
    expect(capabilitiesForRole('OWNER')).toEqual([...PROJECT_CAPABILITIES]);
    expect(roleAllows('VIEWER', 'files.write')).toBe(false);
    expect(roleAllows('EDITOR', 'files.write')).toBe(true);
    expect(roleAllows('EDITOR', 'members.manage')).toBe(false);
    expect(roleAllows('VIEWER', 'project.export')).toBe(true);
    expect(capabilitiesForRole('admin')).toEqual([]);
    const values = capabilitiesForRole('VIEWER'); values.push('files.write');
    expect(roleAllows('VIEWER', 'files.write')).toBe(false);
});
test('missing identity never becomes an unfiltered project query', async () => {
    const db = { project: { findFirst: jest.fn() } };
    await expect(resolveProjectAccess({ projectId: 'p', capability: 'project.read', db })).rejects.toMatchObject({ statusCode: 401 });
    expect(db.project.findFirst).not.toHaveBeenCalled();
    expect(() => membershipWhere(undefined)).toThrow('Authentication required');
});
test.each(['EDITOR', 'VIEWER'])('existing %s member gets only their role capabilities', async role => {
    const db = { project: { findFirst: jest.fn().mockResolvedValue({ id: 'p', ownerId: 'owner' }) },
        projectMember: { findUnique: jest.fn().mockResolvedValue({ role }) } };
    const access = await resolveProjectAccess({ projectId: 'p', userId: 'member', capability: 'project.read', db });
    expect(access.role).toBe(role);
    expect(access.capabilities).toEqual(capabilitiesForRole(role));
    await expect(resolveProjectAccess({ projectId: 'p', userId: 'member', capability: 'members.manage', db })).rejects.toMatchObject({ statusCode: 403, code: 'CAPABILITY_DENIED' });
});
test('cross-project snapshot identity is rejected', async () => {
    const db = { projectSnapshot: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(resolveSnapshotAccess({ projectId: 'p', snapshotId: 'other', userId: 'member', capability: 'project.read', db })).rejects.toMatchObject({ statusCode: 404 });
    expect(db.projectSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'other', projectId: 'p' } }));
});
