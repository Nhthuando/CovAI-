import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import { withProjectGuard } from './projectAccess.service.js';
import { publishProjectEvent,deliverProjectEvent } from './projectEvent.service.js';
import { findEditableSnapshot,hashFileContent,projectFileError,resolveContainedProjectPath,MAX_PROJECT_FILE_BYTES } from './projectFileVersion.service.js';
import { durableWrite,mutationJournalDirectory,mutationKey,recoverProjectMutationMarkers } from './projectMutationRecovery.service.js';
import { runtimeIgnoredDirectories } from './projectRuntimePlan.service.js';
import { hashOperationInput } from '../utils/projectOperationIdentity.js';

const secret = name => /^\.env(?:\.|$)/i.test(name) || /(?:credential|service[-_]?account|secret|private[-_]?key)/i.test(name) || /\.(pem|key|p12)$/i.test(name);
const runtimeFile = name => /^(?:covai-jest|covai-vitest|covai-setup|covai-resolver|test-results|jest-results|vitest-results)/.test(name);

export const captureWorkspaceFiles = async (root,{includeGitMetadata = false} = {}) => {
    const files = new Map();
    const visit = async (directory,relative = '') => {
        for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
            const inGit = includeGitMetadata && (relative === '.git' || relative.startsWith('.git/') || !relative && entry.name === '.git');
            if (!inGit && (runtimeIgnoredDirectories.has(entry.name) || secret(entry.name) || runtimeFile(entry.name))) continue;
            if (entry.isSymbolicLink()) throw projectFileError('INVALID_FILE_PATH','Prepared changes must not follow symbolic links',400);
            const file = path.join(directory,entry.name);
            const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) await visit(file,relativePath);
            else if (entry.isFile()) {
                const stat = await fs.stat(file);
                // A large unchanged source file is represented by its hash but
                // cannot silently become a large mutation payload.
                files.set(relativePath,{sha256:hashFileContent(await fs.readFile(file)),size:stat.size});
                if (files.size > 20000) throw projectFileError('WORKSPACE_TOO_LARGE','Workspace contains too many files for safe publication',413);
            }
        }
    };
    await visit(root);
    return files;
};

// Commits a prepared multi-file change as one workspace revision. Long builds,
// providers and test execution happen before this bounded critical section.
export const publishPreparedWorkspace = async ({projectId,snapshotId,userId,capability = 'files.write',
    expectedWorkspaceRevision,beforeFiles,preparedRoot,requestId = randomUUID(),db = prisma,afterMutation,includeGitMetadata = false,emitCommittedEvent = deliverProjectEvent}) => {
    if (includeGitMetadata && capability !== 'integrations.write') throw projectFileError('CAPABILITY_DENIED','Git metadata publication requires integration permission',403);
    const afterFiles = await captureWorkspaceFiles(preparedRoot,{includeGitMetadata});
    const paths = [...new Set([...beforeFiles.keys(),...afterFiles.keys()])].filter(name=>beforeFiles.get(name)?.sha256 !== afterFiles.get(name)?.sha256).sort();
    const maxFiles = includeGitMetadata ? 2000 : 100;
    if (paths.length > maxFiles) throw projectFileError('MUTATION_TOO_LARGE',`Review changes in batches of no more than ${maxFiles} files`,413);
    const changes = [];
    let total = 0;
    for (const name of paths) {
        const next = afterFiles.get(name);
        const isGitFile = includeGitMetadata && name.startsWith('.git/');
        if (next?.size > (isGitFile ? 64 * 1024 * 1024 : MAX_PROJECT_FILE_BYTES)) throw projectFileError('FILE_TOO_LARGE','A changed file exceeds its publication size limit',413);
        const content = next ? await fs.readFile(path.join(preparedRoot,name)) : null;
        total += content?.length || 0;
        changes.push({path:name,beforeHash:beforeFiles.get(name)?.sha256 || null,afterHash:next?.sha256 || null,content});
    }
    if (total > (includeGitMetadata ? 256 : 16) * 1024 * 1024) throw projectFileError('MUTATION_TOO_LARGE','Prepared changes exceed the publication size limit',413);
    const committed = await withProjectGuard({projectId,userId,capability,db,maxWait:60000,timeout:120000},async(tx,access) => {
        const {assertProjectOperationActive} = await import('./projectOperationWorkspace.service.js');
        await assertProjectOperationActive(undefined,tx);
        const snapshot = await findEditableSnapshot(tx,projectId,snapshotId);
        const latest = await tx.projectSnapshot.findFirst({where:{projectId},orderBy:{createdAt:'desc'},select:{id:true}});
        if (latest?.id !== snapshotId || access.project.workspaceRevision !== expectedWorkspaceRevision) {
            const currentOp = (await import('./projectOperationWorkspace.service.js')).currentProjectOperation?.();
            if (currentOp?.type === 'APPLY_UNIT_SUGGESTION' && latest?.id === snapshotId) {
                expectedWorkspaceRevision = access.project.workspaceRevision;
            } else {
                throw projectFileError('SNAPSHOT_CHANGED','Workspace changed during preparation; regenerate or review the changes again');
            }
        }
        if (!changes.length) {
            const result = {snapshotId,workspaceRevision:expectedWorkspaceRevision,changedPaths:[]};
            if (afterMutation) await afterMutation(tx,result);
            const current = await tx.project.findUnique({where:{id:projectId},select:{workspaceRevision:true}});
            result.workspaceRevision = current.workspaceRevision;
            return result;
        }
        const firstPath = await resolveContainedProjectPath(snapshot,changes[0].path,{allowGitMetadata:includeGitMetadata,canonicalPath:true});
        await recoverProjectMutationMarkers({tx,project:access.project,snapshot,root:firstPath.root});
        for (const change of changes) {
            const resolved = await resolveContainedProjectPath(snapshot,change.path,{allowGitMetadata:includeGitMetadata,canonicalPath:true});
            change.target = resolved.target;
            change.root = resolved.root;
            // Use filesystem-canonical casing for version rows on Windows.
            change.path = resolved.relativePath;
            try {
                const stat = await fs.lstat(change.target);
                if (!stat.isFile()) throw projectFileError('FILE_VERSION_CONFLICT','A changed path is no longer a regular file');
                change.before = await fs.readFile(change.target);
            } catch(error) { if(error.code !== 'ENOENT') throw error; }
            if ((change.before ? hashFileContent(change.before) : null) !== change.beforeHash) throw projectFileError('FILE_VERSION_CONFLICT','A prepared file changed since work began',409,{path:change.path});
        }
        const root = changes[0].root;
        const key = mutationKey(requestId);
        const journalDir = mutationJournalDirectory(root);
        await fs.mkdir(journalDir,{recursive:true});
        if ((await fs.lstat(journalDir)).isSymbolicLink()) throw projectFileError('RECOVERY_REQUIRED','Invalid recovery directory');
        const markerPath = path.join(journalDir,`${key}.json`);
        const stagingNames = [];
        for (let index = 0; index < changes.length; index++) {
            const change = changes[index];
            change.backupName = `${key}-${index}.before`;
            change.candidateName = `${key}-${index}.after`;
            if (change.before) { await durableWrite(path.join(journalDir,change.backupName),change.before); stagingNames.push(change.backupName); }
            if (change.content) { await durableWrite(path.join(journalDir,change.candidateName),change.content); stagingNames.push(change.candidateName); }
        }
        const manifest = changes.map(({path:relativePath,beforeHash,afterHash,backupName,candidateName})=>({path:relativePath,beforeHash,afterHash,backupName,candidateName}));
        await durableWrite(markerPath,JSON.stringify({projectId,snapshotId,requestId,kind:'BULK_APPLY',includeGitMetadata,expectedWorkspaceRevision,entries:manifest,stagingNames}));
        const mutation = await tx.projectMutation.create({data:{projectId,snapshotId,requestId,actorId:userId,kind:'BULK_APPLY',
            inputHash:hashOperationInput(manifest),expectedWorkspaceRevision,nextWorkspaceRevision:expectedWorkspaceRevision + 1,journalPath:markerPath,state:'PREPARED'}});
        for (const change of changes) {
            if (change.content) {
                await fs.mkdir(path.dirname(change.target),{recursive:true});
                await fs.rename(path.join(journalDir,change.candidateName),change.target);
            } else await fs.unlink(change.target);
            await tx.projectFileVersion.upsert({where:{snapshotId_relativePath:{snapshotId,relativePath:change.path}},
                create:{snapshotId,relativePath:change.path,sha256:change.afterHash,deleted:change.afterHash === null,revision:1,updatedByUserId:userId},
                update:{sha256:change.afterHash,deleted:change.afterHash === null,revision:{increment:1},updatedByUserId:userId}});
        }
        if (afterMutation) await afterMutation(tx,{snapshotId,workspaceRevision:expectedWorkspaceRevision + 1,changedPaths:changes.map(change=>change.path)});
        const project = await tx.project.update({where:{id:projectId},data:{workspaceRevision:{increment:1}}});
        await tx.projectMutation.update({where:{id:mutation.id},data:{state:'APPLIED'}});
        const event = await publishProjectEvent({tx,projectId,type:'workspace.changed',actorId:userId,resourceId:snapshotId,revision:project.workspaceRevision,
            payload:{kind:'BULK_APPLY',paths:changes.map(change=>change.path)}});
        return {snapshotId,workspaceRevision:project.workspaceRevision,changedPaths:changes.map(change=>change.path),event,cleanup:[markerPath,...stagingNames.map(name=>path.join(journalDir,name))]};
    });
    if (committed.cleanup) {
        for (const target of committed.cleanup) await fs.rm(target,{recursive:true,force:true}).catch(()=>{});
        await emitCommittedEvent(committed.event).catch(()=>{});
        delete committed.cleanup;delete committed.event;
    }
    return committed;
};
