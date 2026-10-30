import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { projectFileError, hashFileContent, resolveContainedProjectPath } from './projectFileVersion.service.js';

export const mutationJournalDirectory = root => path.join(root, '.covai-collaboration');
export const mutationKey = requestId => createHash('sha256').update(requestId).digest('hex');

export const durableWrite = async (target, content) => {
    const handle = await fs.open(target, 'w', 0o600);
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
};

export const hashWorkspaceEntry = async target => {
    const stat = await fs.lstat(target);
    if (stat.isFile()) return hashFileContent(await fs.readFile(target));
    if (stat.isSymbolicLink()) return hashFileContent(`symlink:${await fs.readlink(target)}`);
    const hash = createHash('sha256');
    for (const name of (await fs.readdir(target)).sort()) {
        hash.update(JSON.stringify([name,await hashWorkspaceEntry(path.join(target,name))]));
    }
    return hash.digest('hex');
};

const exists = async target => {
    try { await fs.lstat(target); return true; }
    catch(error) { if(error.code === 'ENOENT') return false; throw error; }
};

export const readMutationMarkers = async root => {
    const directory = mutationJournalDirectory(root);
    let entries;
    try {
        const stat = await fs.lstat(directory);
        if (stat.isSymbolicLink()) throw projectFileError('RECOVERY_REQUIRED', 'Invalid workspace recovery directory');
        entries = await fs.readdir(directory);
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const markers = [];
    for (const entry of entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
        const markerPath = path.join(directory, entry);
        try { markers.push({ ...JSON.parse(await fs.readFile(markerPath, 'utf8')), markerPath }); }
        catch { throw projectFileError('RECOVERY_REQUIRED', 'A workspace journal needs recovery'); }
    }
    return markers;
};

// Must run while holding the same project guard as mutation. A marker survives
// a process/SQL transaction failure; absence of a committed mutation row alone
// does not justify restoring over a newer revision.
export const recoverProjectMutationMarkers = async ({ tx, project, snapshot, root }) => {
    for (const marker of await readMutationMarkers(root)) {
        if (marker.projectId !== project.id || marker.snapshotId !== snapshot.id) {
            throw projectFileError('RECOVERY_REQUIRED', 'Workspace journal scope does not match');
        }
        const committed = await tx.projectMutation.findUnique({
            where: { projectId_requestId: { projectId: project.id, requestId: marker.requestId } },
        });
        if (committed?.state === 'APPLIED') {
            await fs.rm(marker.markerPath, { force: true });
            for (const name of marker.stagingNames || []) {
                if (/^[a-f0-9]{64}(?:-\d+)?\.(before|after)$/.test(name)) await fs.rm(path.join(mutationJournalDirectory(root), name), { recursive: true, force: true });
            }
            continue;
        }
        if (project.workspaceRevision !== marker.expectedWorkspaceRevision) {
            throw projectFileError('RECOVERY_REQUIRED', 'Interrupted workspace change requires recovery before editing');
        }
        const containedSnapshot = {...snapshot,rootDir:root,storagePath:root,source:'ZIP'};
        if (marker.kind === 'BULK_APPLY') {
            if (!Array.isArray(marker.entries) || marker.entries.length > (marker.includeGitMetadata ? 2000 : 100)) throw projectFileError('RECOVERY_REQUIRED','Invalid bulk recovery manifest');
            const key = mutationKey(marker.requestId);
            for (let index = marker.entries.length - 1; index >= 0; index--) {
                const entry = marker.entries[index];
                if (entry.backupName !== `${key}-${index}.before` || entry.candidateName !== `${key}-${index}.after`) throw projectFileError('RECOVERY_REQUIRED','Invalid bulk recovery staging paths');
                const {target} = await resolveContainedProjectPath(containedSnapshot,entry.path,{allowGitMetadata:marker.includeGitMetadata === true});
                const present = await exists(target);
                const actual = present ? await hashWorkspaceEntry(target) : null;
                if (actual === entry.beforeHash) continue;
                if (actual !== entry.afterHash) throw projectFileError('RECOVERY_REQUIRED','Prepared file changed after an interrupted publication');
                if (entry.beforeHash === null) { if (present) await fs.unlink(target); }
                else {
                    const bytes = await fs.readFile(path.join(mutationJournalDirectory(root),entry.backupName));
                    if (hashFileContent(bytes) !== entry.beforeHash) throw projectFileError('RECOVERY_REQUIRED','Bulk backup integrity failed');
                    await fs.mkdir(path.dirname(target),{recursive:true});
                    await durableWrite(target,bytes);
                }
            }
            await fs.rm(marker.markerPath,{force:true});
            for (const entry of marker.entries) {
                await fs.rm(path.join(mutationJournalDirectory(root),entry.backupName),{force:true});
                await fs.rm(path.join(mutationJournalDirectory(root),entry.candidateName),{force:true});
            }
            continue;
        }
        const {target} = await resolveContainedProjectPath(containedSnapshot,marker.path);
        const backup = path.join(mutationJournalDirectory(root),`${mutationKey(marker.requestId)}.before`);
        const actualExists = await exists(target);
        const actual = actualExists ? await hashWorkspaceEntry(target) : null;
        if (marker.kind === 'WRITE_FILE') {
            if (actual === marker.afterHash) {
                const bytes = await fs.readFile(backup);
                if (hashFileContent(bytes) !== marker.beforeHash) throw projectFileError('RECOVERY_REQUIRED', 'Workspace backup integrity failed');
                await durableWrite(target,bytes);
            } else if (actual !== marker.beforeHash) throw projectFileError('RECOVERY_REQUIRED','Workspace changed after an interrupted save');
        } else if (marker.kind === 'CREATE_FILE') {
            if (actualExists) {
                if (actual !== marker.afterHash) throw projectFileError('RECOVERY_REQUIRED','Created file changed after interruption');
                await fs.unlink(target);
            }
        } else if (marker.kind === 'CREATE_FOLDER') {
            if (actualExists) {
                if ((await fs.readdir(target)).length) throw projectFileError('RECOVERY_REQUIRED','Created folder changed after interruption');
                await fs.rmdir(target);
            }
        } else if (marker.kind === 'RENAME_ENTRY') {
            const destination = await resolveContainedProjectPath(containedSnapshot,marker.newPath);
            const destinationExists = await exists(destination.target);
            if (!actualExists && destinationExists && await hashWorkspaceEntry(destination.target) === marker.beforeHash) {
                await fs.rename(destination.target,target);
            } else if (!(actual === marker.beforeHash && !destinationExists)) {
                throw projectFileError('RECOVERY_REQUIRED','Renamed paths changed after interruption');
            }
        } else if (marker.kind === 'DELETE_ENTRY') {
            const backupExists = await exists(backup);
            if (!actualExists && backupExists && await hashWorkspaceEntry(backup) === marker.beforeHash) await fs.rename(backup,target);
            else if (!(actual === marker.beforeHash && !backupExists)) throw projectFileError('RECOVERY_REQUIRED','Deleted path changed after interruption');
        } else throw projectFileError('RECOVERY_REQUIRED','Unsupported recovery operation');
        await fs.rm(marker.markerPath, { force: true });
        for (const suffix of ['before', 'after']) await fs.rm(path.join(mutationJournalDirectory(root), `${mutationKey(marker.requestId)}.${suffix}`), { recursive:true,force: true });
    }
};
