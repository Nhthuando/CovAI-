import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashFileContent, normalizeProjectPath, resolveContainedProjectPath } from '../services/projectFileVersion.service.js';
import { durableWrite, mutationJournalDirectory, mutationKey, recoverProjectMutationMarkers } from '../services/projectMutationRecovery.service.js';

describe('collaborative project file paths and recovery', () => {
    let root;
    beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(),'covai-mutation-test-')); });
    afterEach(async () => { await fs.rm(root,{recursive:true,force:true}); });

    test.each(['../secret','src/../../secret','C:\\secret','/etc/passwd','src//a.js',
        '.covai-collaboration/marker.json','.COVAI-COLLABORATION/marker.json','.GIT/config','src/.covai-collaboration-backup','src/a.js:secret','src/CON.txt'])('rejects unsafe path %s', input => {
        expect(() => normalizeProjectPath(input)).toThrow();
    });
    test('normalizes separators while retaining the original source path', () => {
        expect(normalizeProjectPath('src\\a.js')).toBe('src/a.js');
    });
    test('resolves a new nested file only inside its snapshot', async () => {
        const result = await resolveContainedProjectPath({rootDir:root,source:'ZIP'},'src/a.js');
        expect(result.relativePath).toBe('src/a.js');
        expect(path.relative(root,result.target)).toBe(path.join('src','a.js'));
    });
    test('rejects a symlink/junction ancestor even for a nonexistent child', async () => {
        const outside = await fs.mkdtemp(path.join(os.tmpdir(),'covai-outside-'));
        try {
            await fs.symlink(outside,path.join(root,'linked'),process.platform === 'win32' ? 'junction' : 'dir');
            await expect(resolveContainedProjectPath({rootDir:root,source:'ZIP'},'linked/new.js')).rejects.toMatchObject({code:'INVALID_FILE_PATH'});
        } finally { await fs.rm(outside,{recursive:true,force:true}); }
    });
    test('restores an interrupted uncommitted save only at its original workspace revision', async () => {
        const requestId = 'save-crash';
        const directory = mutationJournalDirectory(root);
        await fs.mkdir(directory);
        await fs.writeFile(path.join(root,'a.js'),'candidate');
        await durableWrite(path.join(directory,`${mutationKey(requestId)}.before`),'original');
        await durableWrite(path.join(directory,`${mutationKey(requestId)}.json`),JSON.stringify({
            projectId:'p',snapshotId:'s',requestId,kind:'WRITE_FILE',path:'a.js',
            beforeHash:hashFileContent('original'),afterHash:hashFileContent('candidate'),expectedWorkspaceRevision:3,
        }));
        const tx = {projectMutation:{findUnique:async () => null}};
        await recoverProjectMutationMarkers({tx,project:{id:'p',workspaceRevision:3},snapshot:{id:'s'},root});
        expect(await fs.readFile(path.join(root,'a.js'),'utf8')).toBe('original');
        await expect(fs.access(path.join(directory,`${mutationKey(requestId)}.json`))).rejects.toMatchObject({code:'ENOENT'});
    });
    test('never restores over a later edit or a newer committed workspace revision', async () => {
        const requestId = 'save-newer';
        const directory = mutationJournalDirectory(root);
        await fs.mkdir(directory);
        await fs.writeFile(path.join(root,'a.js'),'newer edit');
        await durableWrite(path.join(directory,`${mutationKey(requestId)}.before`),'original');
        await durableWrite(path.join(directory,`${mutationKey(requestId)}.json`),JSON.stringify({
            projectId:'p',snapshotId:'s',requestId,kind:'WRITE_FILE',path:'a.js',
            beforeHash:hashFileContent('original'),afterHash:hashFileContent('candidate'),expectedWorkspaceRevision:3,
        }));
        const tx = {projectMutation:{findUnique:async () => null}};
        await expect(recoverProjectMutationMarkers({tx,project:{id:'p',workspaceRevision:4},snapshot:{id:'s'},root})).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});
        expect(await fs.readFile(path.join(root,'a.js'),'utf8')).toBe('newer edit');
    });
});
