import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashOperationInput } from '../utils/projectOperationIdentity.js';
import prisma from '../config/prisma.js';
import { withProjectGuard } from './projectAccess.service.js';
import { deliverProjectEvent, publishProjectEvent } from './projectEvent.service.js';
import { fileVersion, findEditableSnapshot, hashFileContent, MAX_PROJECT_FILE_BYTES,
    projectFileError, resolveContainedProjectPath } from './projectFileVersion.service.js';
import { durableWrite, hashWorkspaceEntry, mutationJournalDirectory, mutationKey, recoverProjectMutationMarkers } from './projectMutationRecovery.service.js';

const kinds = new Set(['WRITE_FILE', 'CREATE_FILE', 'CREATE_FOLDER', 'RENAME_ENTRY', 'DELETE_ENTRY', 'APPLY_TEST']);

export const mutateProjectWorkspace = async ({ projectId, snapshotId, userId, capability = 'files.write',
    kind, path: filePath, newPath, content, expectedVersion, expectedWorkspaceRevision,
    requestId = randomUUID(), db = prisma, afterMutation }) => {
    if (!snapshotId) throw projectFileError('FILE_VERSION_REQUIRED', 'An explicit snapshot is required', 428);
    if (!kinds.has(kind)) throw projectFileError('UNSUPPORTED_MUTATION', 'Unsupported workspace mutation', 400);
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) throw projectFileError('INVALID_REQUEST_ID', 'Invalid mutation request identifier', 400);
    const writesContent = ['WRITE_FILE', 'CREATE_FILE', 'APPLY_TEST'].includes(kind);
    if (writesContent && (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_PROJECT_FILE_BYTES)) {
        throw projectFileError('FILE_TOO_LARGE', 'File must be text no larger than 1 MiB', typeof content === 'string' ? 413 : 400);
    }
    if (['WRITE_FILE', 'APPLY_TEST'].includes(kind) && (!Number.isSafeInteger(expectedVersion?.revision) || typeof expectedVersion?.sha256 !== 'string')) {
        throw projectFileError('FILE_VERSION_REQUIRED', 'Read the current file version before saving', 428);
    }
    if (!['WRITE_FILE', 'APPLY_TEST'].includes(kind) && !Number.isSafeInteger(expectedWorkspaceRevision)) {
        throw projectFileError('FILE_VERSION_REQUIRED', 'Read the current workspace revision before changing its structure', 428);
    }
    const inputHash = hashOperationInput({snapshotId,kind,path:filePath,newPath,content,expectedVersion,expectedWorkspaceRevision});
    let recoveryContext;
    let result;
    try {
    result = await withProjectGuard({ projectId, userId, capability, db }, async (tx, access) => {
        const snapshot = await findEditableSnapshot(tx, projectId, snapshotId);
        const latest = await tx.projectSnapshot.findFirst({where:{projectId},orderBy:{createdAt:'desc'},select:{id:true}});
        if (latest?.id !== snapshot.id) throw projectFileError('SNAPSHOT_CHANGED','The active snapshot changed; select it again before editing');
        const resolved = await resolveContainedProjectPath(snapshot, filePath,{canonicalPath:kind === 'CREATE_FILE' || kind === 'CREATE_FOLDER'});
        const project = access.project;
        await recoverProjectMutationMarkers({ tx, project, snapshot, root: resolved.root });
        const previous = await tx.projectMutation.findUnique({ where: { projectId_requestId: { projectId, requestId } } });
        if (previous) {
            if (previous.actorId !== userId || previous.inputHash !== inputHash) throw projectFileError('REQUEST_ID_REUSED', 'Mutation identifier was already used for different input');
            if (previous.state !== 'APPLIED') throw projectFileError('RECOVERY_REQUIRED', 'Previous mutation is not complete');
            if (project.workspaceRevision !== previous.nextWorkspaceRevision) throw projectFileError('FILE_VERSION_CONFLICT', 'The saved request completed, but the workspace changed afterward. Reload before editing again.');
            // A retry returns the committed identity; it never reapplies bytes.
            const currentVersion = await tx.projectFileVersion.findUnique({ where: { snapshotId_relativePath: { snapshotId, relativePath: resolved.relativePath } } });
            return { mutationId: previous.id, snapshotId, path: resolved.relativePath, version: currentVersion ? fileVersion(currentVersion) : undefined,
                workspaceRevision: previous.nextWorkspaceRevision, reused: true };
        }
        if (expectedWorkspaceRevision !== undefined && expectedWorkspaceRevision !== project.workspaceRevision) {
            throw projectFileError('SNAPSHOT_CHANGED', 'Workspace changed; refresh its file tree', 409, { workspaceRevision: project.workspaceRevision });
        }
        let stat;
        try { stat = await fs.lstat(resolved.target); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const creating = kind === 'CREATE_FILE' || kind === 'CREATE_FOLDER';
        if (creating && stat) throw projectFileError('FILE_ALREADY_EXISTS', 'A file or folder already exists at this path');
        if (!creating && !stat) throw projectFileError('RESOURCE_NOT_FOUND', 'File or folder not found', 404);
        if (['WRITE_FILE', 'APPLY_TEST'].includes(kind) && !stat.isFile()) throw projectFileError('INVALID_FILE_PATH', 'Path is not a regular file', 400);
        const versionWhere = { snapshotId_relativePath: { snapshotId, relativePath: resolved.relativePath } };
        const current = await tx.projectFileVersion.findUnique({ where: versionWhere });
        let before;
        if (['WRITE_FILE', 'APPLY_TEST'].includes(kind)) {
            before = await fs.readFile(resolved.target);
            if (!current || current.deleted || current.revision !== expectedVersion.revision
                || current.sha256 !== expectedVersion.sha256 || hashFileContent(before) !== expectedVersion.sha256) {
                throw projectFileError('FILE_VERSION_CONFLICT', 'This file changed. Your draft has been kept; reload or compare before saving.', 409,
                    { version: current ? fileVersion(current) : null, snapshotId, path: resolved.relativePath });
            }
        }
        let destination;
        if (kind === 'RENAME_ENTRY') {
            destination = await resolveContainedProjectPath(snapshot, newPath,{canonicalPath:resolved.relativePath === filePath.replaceAll('\\','/')});
            if (destination.target === resolved.target || destination.target.startsWith(`${resolved.target}${path.sep}`)) throw projectFileError('INVALID_FILE_PATH', 'Invalid rename destination', 400);
            try { await fs.lstat(destination.target); throw projectFileError('FILE_ALREADY_EXISTS', 'Destination already exists'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        const journalDir = mutationJournalDirectory(resolved.root);
        try {
            const journalStat = await fs.lstat(journalDir);
            if (journalStat.isSymbolicLink()) throw projectFileError('RECOVERY_REQUIRED', 'Invalid recovery directory');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await fs.mkdir(journalDir, { recursive: true });
        const key = mutationKey(requestId);
        const markerPath = path.join(journalDir, `${key}.json`);
        const beforePath = path.join(journalDir, `${key}.before`);
        const afterPath = path.join(journalDir, `${key}.after`);
        if (before) await durableWrite(beforePath, before);
        if (writesContent) await durableWrite(afterPath, content);
        const marker = { projectId, snapshotId, requestId, kind: kind === 'APPLY_TEST' ? 'WRITE_FILE' : kind,
            path: resolved.relativePath, newPath: destination?.relativePath,
            beforeHash: before ? hashFileContent(before) : stat ? await hashWorkspaceEntry(resolved.target) : null, afterHash: writesContent ? hashFileContent(content) : null,
            expectedWorkspaceRevision: project.workspaceRevision, stagingNames: [`${key}.before`, `${key}.after`] };
        await durableWrite(markerPath, JSON.stringify(marker));
        recoveryContext = {snapshot,root:resolved.root};
        const mutation = await tx.projectMutation.create({ data: { projectId, snapshotId, requestId, actorId: userId,
            kind, inputHash, expectedWorkspaceRevision: project.workspaceRevision, nextWorkspaceRevision: project.workspaceRevision + 1,
            journalPath: markerPath, state: 'PREPARED' } });
        if (writesContent) {
            await fs.mkdir(path.dirname(resolved.target), { recursive: true });
            await fs.rename(afterPath, resolved.target);
        } else if (kind === 'CREATE_FOLDER') await fs.mkdir(resolved.target, { recursive: true });
        else if (kind === 'RENAME_ENTRY') {
            await fs.mkdir(path.dirname(destination.target), { recursive: true });
            await fs.rename(resolved.target, destination.target);
        } else if (kind === 'DELETE_ENTRY') await fs.rename(resolved.target, beforePath);
        const upsertVersion = async (relativePath, sha256, deleted) => tx.projectFileVersion.upsert({
            where: { snapshotId_relativePath: { snapshotId, relativePath } },
            create: { snapshotId, relativePath, sha256, deleted, revision: 1, updatedByUserId: userId },
            update: { sha256, deleted, revision: { increment: 1 }, updatedByUserId: userId },
        });
        const updated = await upsertVersion(resolved.relativePath, writesContent ? hashFileContent(content) : null, kind === 'DELETE_ENTRY' || kind === 'RENAME_ENTRY');
        if (destination) await upsertVersion(destination.relativePath, stat.isFile() ? hashFileContent(await fs.readFile(destination.target)) : null, false);
        // Invalidate descendant versions as well: delete/recreate and directory
        // renames cannot accidentally revive an old client's revision.
        if (stat?.isDirectory() && ['DELETE_ENTRY', 'RENAME_ENTRY'].includes(kind)) await tx.projectFileVersion.updateMany({
            where: { snapshotId, relativePath: { startsWith: `${resolved.relativePath}/` } },
            data: { deleted: true, sha256: null, revision: { increment: 1 }, updatedByUserId: userId },
        });
        const mutationResult = afterMutation ? await afterMutation(tx) : undefined;
        const nextProject = await tx.project.update({ where: { id: projectId }, data: { workspaceRevision: { increment: 1 } } });
        await tx.projectMutation.update({ where: { id: mutation.id }, data: { state: 'APPLIED' } });
        const event = await publishProjectEvent({ tx, projectId, type: 'workspace.changed', actorId: userId,
            resourceId: snapshotId, revision: nextProject.workspaceRevision,
            payload: { path: destination?.relativePath || resolved.relativePath, kind } });
        return { mutationId: mutation.id, snapshotId, path: destination?.relativePath || resolved.relativePath,
            size: writesContent ? Buffer.byteLength(content) : undefined, version: fileVersion(updated), workspaceRevision: nextProject.workspaceRevision,
            mutationResult,_cleanup: { markerPath, beforePath, afterPath }, _event: event };
    });
    } catch(error) {
        if (recoveryContext) {
            try {
                await withProjectGuard({projectId,userId,capability,db},(tx,access)=>recoverProjectMutationMarkers({tx,project:access.project,...recoveryContext}));
            } catch { /* Retain the durable marker and fail closed until recovery. */ }
        }
        throw error;
    }
    // Only remove recovery evidence after the transaction is confirmed committed.
    if (result._cleanup) {
        for (const target of Object.values(result._cleanup)) await fs.rm(target, { recursive: true, force: true }).catch(() => {});
        delete result._cleanup;
        await deliverProjectEvent(result._event).catch(() => {});
        delete result._event;
    }
    return result;
};
