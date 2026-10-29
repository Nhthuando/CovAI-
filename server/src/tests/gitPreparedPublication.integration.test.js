import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import prisma from '../config/prisma.js';
import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';
import { GitService } from '../services/git.service.js';
import { readVersionedProjectFile } from '../services/projectFileVersion.service.js';
import { mutateProjectWorkspace } from '../services/projectMutation.service.js';

const execute = promisify(execFile);
const suite = process.env.COLLABORATION_INTEGRATION === 'true' ? describe : describe.skip;
suite('actual Git commands publish through the collaboration mutation boundary', () => {
    let root, owner, editor, project, snapshot;
    const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true })).stdout.trim();
    beforeAll(() => assertCollaborationTestDatabase(process.env.DATABASE_URL));
    beforeEach(async () => {
        project = undefined;
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-git-publication-'));
        await git('init', '--initial-branch=main');
        await git('config', 'user.name', 'Test author');
        await git('config', 'user.email', 'git@covai.test');
        await fs.writeFile(path.join(root, 'a.js'), 'main content');
        await git('add', 'a.js');
        await git('commit', '-m', 'main');
        await git('checkout', '-b', 'feature');
        await fs.writeFile(path.join(root, 'a.js'), 'feature content');
        await git('commit', '-am', 'feature');
        await git('checkout', 'main');
        const suffix = randomUUID();
        [owner, editor] = await Promise.all([
            prisma.user.create({ data: { email: `owner-${suffix}@git.test`, name: 'Owner "quoted"; literal' } }),
            prisma.user.create({ data: { email: `editor-${suffix}@git.test`, name: 'Editor' } }),
        ]);
        project = await prisma.project.create({ data: { name: 'Git publication', ownerId: owner.id, defaultBranch: 'main' } });
        snapshot = await prisma.projectSnapshot.create({ data: { projectId: project.id, source: 'GITHUB', storagePath: root, rootDir: root } });
        await prisma.projectMember.create({ data: { projectId: project.id, userId: editor.id, role: 'EDITOR' } });
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        if (project) {
            const operations = await prisma.projectOperation.findMany({ where: { projectId: project.id }, select: { id: true } });
            await prisma.project.deleteMany({ where: { id: project.id } });
            const parent = path.resolve('.covai-temp/collaboration-operations');
            for (const operation of operations) {
                if (!/^[A-Za-z0-9_-]+$/.test(operation.id)) throw new Error('Invalid owned operation ID');
                const target = path.resolve(parent, operation.id);
                if (!target.startsWith(parent + path.sep)) throw new Error('Invalid operation cleanup target');
                await fs.rm(target, { recursive: true, force: true });
            }
        }
        if (owner && editor) await prisma.user.deleteMany({ where: { id: { in: [owner.id, editor.id] } } });
        if (root) await fs.rm(root, { recursive: true, force: true });
    });
    afterAll(async () => prisma.$disconnect());
    test('Owner checkout commits source and Git HEAD together; Editor cannot mutate Git', async () => {
        await expect(GitService.checkout(project.id, editor.id, 'feature')).rejects.toMatchObject({ statusCode: 403 });
        await GitService.checkout(project.id, owner.id, 'feature');
        expect(await git('branch', '--show-current')).toBe('feature');
        expect(await fs.readFile(path.join(root, 'a.js'), 'utf8')).toBe('feature content');
        expect(await git('config', 'user.name')).toBe(owner.name);
        expect((await prisma.project.findUnique({ where: { id: project.id } })).workspaceRevision).toBe(1);
        const result = await GitService.getStatus(project.id, editor.id);
        expect(result).toBeTruthy();
    });
    test('a concurrent Editor save prevents prepared checkout from overwriting source or Git metadata', async () => {
        let ready, release;
        const prepared = new Promise(resolve => { ready = resolve; });
        const resume = new Promise(resolve => { release = resolve; });
        const original = GitService.runCommand;
        jest.spyOn(GitService, 'runCommand').mockImplementation(async function (directory, command, ...args) {
            const result = await original.call(this, directory, command, ...args);
            if (String(command).includes('git checkout "feature"')) { ready(); await resume; }
            return result;
        });
        const checkout = GitService.checkout(project.id, owner.id, 'feature');
        const outcome = checkout.then(value => ({ value }), error => ({ error }));
        try {
            await prepared;
            const base = await readVersionedProjectFile({ projectId: project.id, snapshotId: snapshot.id, userId: editor.id, path: 'a.js' });
            await mutateProjectWorkspace({ projectId: project.id, snapshotId: snapshot.id, userId: editor.id,
                kind: 'WRITE_FILE', path: 'a.js', content: 'concurrent editor content', expectedVersion: base.version });
        } finally { release(); }
        expect((await outcome).error).toMatchObject({ code: expect.stringMatching(/SNAPSHOT_CHANGED|OPERATION_STALE/) });
        expect(await git('branch', '--show-current')).toBe('main');
        expect(await fs.readFile(path.join(root, 'a.js'), 'utf8')).toBe('concurrent editor content');
    });
});
