import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import prisma from '../config/prisma.js';
import { ServiceError } from '../utils/serviceError.js';
import { snapshotWorkspaceRoot, normalizeDiskPath } from '../utils/snapshotWorkspace.js';
import { resolveSnapshotRootDir } from '../utils/projectRootResolver.js';
import { resolveSystemRepositoryRoot } from './fullSystemConfig.service.js';
import { withProjectGuard } from './projectAccess.service.js';
import { rememberProjectFileRead } from './projectFileReadCache.service.js';
import { randomUUID } from 'node:crypto';

export const MAX_PROJECT_FILE_BYTES = 1024 * 1024;
export const hashFileContent = content => createHash('sha256').update(content).digest('hex');
export const fileVersion = row => ({ revision: row.revision, sha256: row.sha256 });
export const projectFileError = (code, message, statusCode = 409, details) =>
    Object.assign(new ServiceError(message, statusCode), { code, details });

export const projectEditableWorkspaceRoot = snapshot => {
    const root = snapshotWorkspaceRoot(snapshot);
    if (!root) throw projectFileError('SNAPSHOT_NOT_READY','Project snapshot is not ready',409);
    try {
        return resolveSystemRepositoryRoot(root);
    } catch (_) {
        return root;
    }
};

export const sanitizeRawProjectPath = (value) => {
    if (!value || typeof value !== 'string') return '';
    let clean = value.replaceAll('\\', '/').trim();
    // Strip absolute container or root prefixes: e.g. /app/ or app/
    clean = clean.replace(/^(?:\/?app\/)?\.?covai-temp\/collaboration-operations\/[^/]+\//i, '');
    clean = clean.replace(/^(?:\/?app\/)?\.?covai-temp\/[^/]+\//i, '');
    clean = clean.replace(/^(?:\/?app\/)?storage\/projects\/[^/]+\/(?:snapshots\/[^/]+\/)?/i, '');
    clean = clean.replace(/^(?:\/?app\/)/i, '');
    clean = clean.replace(/^[a-zA-Z]:\//i, '');
    clean = clean.replace(/^\/+/, '');
    return clean;
};

export const normalizeProjectPath = (value,{allowGitMetadata = false} = {}) => {
    // Accept only the known legacy container prefixes, not arbitrary absolute
    // host paths. Keep the strict editor boundary when merging path fallback.
    if (typeof value !== 'string' || /^[a-z]:/i.test(value) || value.startsWith('\\')
        || (path.isAbsolute(value) && !/^\/(?:app\/|storage\/projects\/|\.?covai-temp\/)/i.test(value))) {
        throw projectFileError('INVALID_FILE_PATH', 'A project-relative path is required', 400);
    }
    const sanitized = sanitizeRawProjectPath(value);
    if (!sanitized || sanitized.includes('\0') || path.isAbsolute(sanitized)
        || /^[a-z]:/i.test(sanitized) || sanitized.startsWith('\\')) {
        throw projectFileError('INVALID_FILE_PATH', 'A project-relative path is required', 400);
    }
    const parts = sanitized.split('/');
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
    let root = rootDir;
    try {
        root = await fs.realpath(rootDir);
    } catch (_) {
        root = rootDir;
    }
    const rawAnalysisRoot = snapshot.rootDir;
    const normalizedSnapRoot = normalizeDiskPath(rawAnalysisRoot) || resolveSnapshotRootDir(rawAnalysisRoot) || rawAnalysisRoot;
    let analysis;
    try {
        analysis = await fs.realpath(normalizedSnapRoot);
    } catch (_) {
        analysis = root;
    }
    if (analysis !== root && !options.canonicalPath) {
        const analysisRelative = path.relative(root,analysis).replaceAll('\\','/');
        if (!analysisRelative.startsWith('../') && analysisRelative !== '..' && !path.isAbsolute(analysisRelative)) {
            const exists = target => fs.lstat(target).then(()=>true,error=>{if(error.code === 'ENOENT')return false;throw error;});
            const directExists = await exists(path.join(root,relativePath));
            const legacyExists = await exists(path.join(analysis,relativePath));
            const rootPrefixExists = await exists(path.join(root,relativePath.split('/')[0]));
            if (!directExists && (legacyExists || snapshot.source !== 'GITHUB' && !rootPrefixExists)) relativePath = `${analysisRelative}/${relativePath}`;
        }
    }
    const exists = target => fs.lstat(target).then(()=>true,error=>{if(error.code === 'ENOENT')return false;throw error;});
    if (!(await exists(path.join(root, relativePath)))) {
        const rootBase = path.basename(root);
        if (relativePath.startsWith(rootBase + '/')) {
            const trimmed = relativePath.slice(rootBase.length + 1);
            if (await exists(path.join(root, trimmed))) {
                relativePath = trimmed;
            }
        }
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
    let effectiveSnapshotId = snapshotId;
    if (!effectiveSnapshotId) {
        const project = await tx.project.findUnique({
            where: { id: projectId },
            select: { activeSnapshotId: true },
        });
        if (project?.activeSnapshotId) {
            effectiveSnapshotId = project.activeSnapshotId;
        }
    }
    const snapshot = await tx.projectSnapshot.findFirst({
        where: { projectId, ...(effectiveSnapshotId ? { id: effectiveSnapshotId } : {}) },
        orderBy: effectiveSnapshotId ? undefined : { createdAt: 'desc' },
    });
    if (!snapshot?.rootDir) throw projectFileError('SNAPSHOT_CHANGED', 'Project snapshot is unavailable; select it again', 409);
    return snapshot;
};

export const readVersionedProjectFile = async ({ projectId, snapshotId, userId, path: filePath, db = prisma }) => {
    if (!userId) throw projectFileError('AUTH_REQUIRED', 'Authentication required', 401);
    const relativePath = normalizeProjectPath(filePath);
    if (db.$queryRaw) {
        const [row] = await db.$queryRaw`
            SELECT s.*, p."workspaceRevision", p."accessRevision", v.sha256 AS "versionHash", v.revision AS "versionRevision", v.deleted AS "versionDeleted"
            FROM (SELECT * FROM "ProjectSnapshot" WHERE "projectId" = ${projectId}
                AND (${snapshotId || null}::text IS NULL OR id = ${snapshotId || null}) ORDER BY "createdAt" DESC LIMIT 1) s
            JOIN "Project" p ON p.id = s."projectId"
            LEFT JOIN "ProjectMember" m ON m."projectId" = p.id AND m."userId" = ${userId}
            LEFT JOIN "ProjectFileVersion" v ON v."snapshotId" = s.id AND v."relativePath" = ${relativePath}
            WHERE p."ownerId" = ${userId} OR (${process.env.PROJECT_COLLABORATION_ENABLED !== 'false'} AND m.role IN ('EDITOR', 'VIEWER'))`;
        if (row?.rootDir && !row.versionDeleted) {
            const resolved = await resolveContainedProjectPath(row, relativePath);
            const { mutationJournalDirectory } = await import('./projectMutationRecovery.service.js');
            let recovering = false;
            try { recovering = (await fs.readdir(mutationJournalDirectory(resolved.root))).some(name => name.endsWith('.json')); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (!recovering) {
                const stat = await fs.stat(resolved.target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
                if (stat?.isFile() && stat.size <= MAX_PROJECT_FILE_BYTES) {
                    const bytes = await fs.readFile(resolved.target);
                    const sha256 = hashFileContent(bytes);
                    if (resolved.relativePath === relativePath && !row.versionHash) {
                        const [version] = await db.$queryRaw`
                            WITH gate AS MATERIALIZED (
                                SELECT p.id FROM "Project" p WHERE p.id = ${projectId}
                                    AND p."workspaceRevision" = ${row.workspaceRevision} AND p."accessRevision" = ${row.accessRevision}
                                    AND pg_try_advisory_xact_lock_shared(hashtextextended(${projectId}, 0)) FOR SHARE
                            ) INSERT INTO "ProjectFileVersion" (id,"snapshotId","relativePath",revision,sha256,deleted,"updatedAt")
                            SELECT ${randomUUID()},${row.id},${relativePath},0,${sha256},false,NOW() FROM gate
                            ON CONFLICT ("snapshotId","relativePath") DO NOTHING RETURNING revision,sha256`;
                        if (version) { row.versionHash = version.sha256; row.versionRevision = version.revision; }
                    }
                    if (resolved.relativePath === relativePath && sha256 === row.versionHash) return rememberProjectFileRead({ projectId, userId }, {
                        snapshotId: row.id, path: relativePath, content: bytes.toString('utf8'), size: bytes.length,
                        version: { revision: row.versionRevision, sha256: row.versionHash }, workspaceRevision: row.workspaceRevision, accessRevision: row.accessRevision,
                    });
                }
            }
        }
    }
    const file = await withProjectGuard({ projectId, userId, capability: 'project.read', db }, (tx, access) =>
        readVersionedProjectFileInTransaction({ tx, access, projectId, snapshotId, path: relativePath }));
    return rememberProjectFileRead({ projectId, userId }, file);
};

export const readVersionedProjectFileInTransaction = async ({ tx, access, projectId, snapshotId, path: filePath }) => {
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
            version = await tx.projectFileVersion.update({ where, data: { revision: { increment: 1 }, sha256, deleted: false, lineAttributionJson: [], attributionStatus: 'UNKNOWN' } });
            const updatedProject = await tx.project.update({where:{id:projectId},data:{workspaceRevision:{increment:1}}});
            access.project.workspaceRevision = updatedProject.workspaceRevision;
        }
        return { snapshotId: snapshot.id, path: resolved.relativePath, content: bytes.toString('utf8'),
            size: bytes.length, version: fileVersion(version), workspaceRevision: access.project.workspaceRevision, accessRevision: access.project.accessRevision };
};
