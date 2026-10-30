import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import prisma from '../config/prisma.js';
import { ServiceError } from '../utils/serviceError.js';
import { snapshotWorkspaceRoot } from '../utils/snapshotWorkspace.js';
import { resolveSystemRepositoryRoot } from './fullSystemConfig.service.js';
import { withProjectGuard } from './projectAccess.service.js';

export const MAX_PROJECT_FILE_BYTES = 1024 * 1024;
export const hashFileContent = content => createHash('sha256').update(content).digest('hex');
export const fileVersion = row => ({ revision: row.revision, sha256: row.sha256 });
export const projectFileError = (code, message, statusCode = 409, details) =>
    Object.assign(new ServiceError(message, statusCode), { code, details });

export const projectEditableWorkspaceRoot = snapshot => {
    const root = snapshotWorkspaceRoot(snapshot);
    if (!root) throw projectFileError('SNAPSHOT_NOT_READY','Project snapshot is not ready',409);
    return resolveSystemRepositoryRoot(root);
};

export const normalizeProjectPath = (value,{allowGitMetadata = false} = {}) => {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0') || path.isAbsolute(value)
        || /^[a-z]:/i.test(value) || value.startsWith('\\')) {
        throw projectFileError('INVALID_FILE_PATH', 'A project-relative path is required', 400);
    }
    const parts = value.replaceAll('\\', '/').split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*]/.test(part)
        || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)
        || (!allowGitMetadata && part.toLowerCase() === '.git') || part.toLowerCase().startsWith('.covai-collaboration'))) {
        throw projectFileError('INVALID_FILE_PATH', 'Invalid or reserved project path', 400);
    }
    return parts.join('/');
};

// Check each existing ancestor, not only the final file: new children beneath
// a symlink/junction must never escape the canonical snapshot workspace.
export const resolveContainedProjectPath = async (snapshot, value, options = {}) => {
    let relativePath = normalizeProjectPath(value,options);
    const rootDir = projectEditableWorkspaceRoot(snapshot);
    if (!rootDir) throw projectFileError('SNAPSHOT_NOT_READY', 'Project snapshot is not ready', 409);
    const root = await fs.realpath(rootDir);
    const analysis = await fs.realpath(snapshot.rootDir);
    if (analysis !== root && !options.canonicalPath) {
        const analysisRelative = path.relative(root,analysis).replaceAll('\\','/');
        if (analysisRelative === '..' || analysisRelative.startsWith('../') || path.isAbsolute(analysisRelative)) throw projectFileError('INVALID_FILE_PATH','Analysis root is outside the project',400);
        const exists = target => fs.lstat(target).then(()=>true,error=>{if(error.code === 'ENOENT')return false;throw error;});
        const directExists = await exists(path.join(root,relativePath));
        const legacyExists = await exists(path.join(analysis,relativePath));
        const rootPrefixExists = await exists(path.join(root,relativePath.split('/')[0]));
        if (!directExists && (legacyExists || snapshot.source !== 'GITHUB' && !rootPrefixExists)) relativePath = `${analysisRelative}/${relativePath}`;
    }
    let candidate = root;
    for (const part of relativePath.split('/')) {
        candidate = path.join(candidate, part);
        try {
            const stat = await fs.lstat(candidate);
            if (stat.isSymbolicLink()) throw projectFileError('INVALID_FILE_PATH', 'Symbolic links are not editable', 400);
            const real = await fs.realpath(candidate);
            const relative = path.relative(root, real);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                throw projectFileError('INVALID_FILE_PATH', 'Path escapes the project', 400);
            }
            candidate = real;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    const canonicalPath = path.relative(root,candidate).replaceAll('\\','/');
    normalizeProjectPath(canonicalPath,options);
    return { root, target: candidate, relativePath: canonicalPath };
};

export const findEditableSnapshot = async (tx, projectId, snapshotId) => {
    const snapshot = await tx.projectSnapshot.findFirst({
        where: { projectId, ...(snapshotId ? { id: snapshotId } : {}) },
        orderBy: snapshotId ? undefined : { createdAt: 'desc' },
    });
    if (!snapshot?.rootDir) throw projectFileError('SNAPSHOT_CHANGED', 'Project snapshot is unavailable; select it again', 409);
    return snapshot;
};

export const readVersionedProjectFile = async ({ projectId, snapshotId, userId, path: filePath, db = prisma }) =>
    withProjectGuard({ projectId, userId, capability: 'project.read', db }, async (tx, access) => {
        const snapshot = await findEditableSnapshot(tx, projectId, snapshotId);
        const resolved = await resolveContainedProjectPath(snapshot, filePath);
        const { recoverProjectMutationMarkers } = await import('./projectMutationRecovery.service.js');
        await recoverProjectMutationMarkers({ tx, project: access.project, snapshot, root: resolved.root });
        let stat;
        try { stat = await fs.stat(resolved.target); }
        catch (error) {
            if (error.code === 'ENOENT') throw projectFileError('RESOURCE_NOT_FOUND', 'File not found', 404);
            throw error;
        }
        if (!stat.isFile()) throw projectFileError('INVALID_FILE_PATH', 'Path is not a regular file', 400);
        if (stat.size > MAX_PROJECT_FILE_BYTES) throw projectFileError('FILE_TOO_LARGE', 'File is too large to display', 413);
        const bytes = await fs.readFile(resolved.target);
        const sha256 = hashFileContent(bytes);
        const where = { snapshotId_relativePath: { snapshotId: snapshot.id, relativePath: resolved.relativePath } };
        let version = await tx.projectFileVersion.findUnique({ where });
        if (!version) version = await tx.projectFileVersion.create({ data: {
            snapshotId: snapshot.id, relativePath: resolved.relativePath, revision: 0, sha256, deleted: false,
        } });
        // Account for a legacy writer/external disk edit without pretending its
        // content still belongs to the old revision. Tombstones are monotonic.
        else if (version.sha256 !== sha256 || version.deleted) {
            version = await tx.projectFileVersion.update({ where, data: { revision: { increment: 1 }, sha256, deleted: false } });
            const updatedProject = await tx.project.update({where:{id:projectId},data:{workspaceRevision:{increment:1}}});
            access.project.workspaceRevision = updatedProject.workspaceRevision;
        }
        return { snapshotId: snapshot.id, path: resolved.relativePath, content: bytes.toString('utf8'),
            size: bytes.length, version: fileVersion(version), workspaceRevision: access.project.workspaceRevision };
    });
