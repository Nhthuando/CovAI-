import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectEvaluationSourceScope } from '../services/aiEvaluation/projectSourceScope.service.js';
import { freezeProjectSource } from '../services/aiEvaluation/projectSandbox.service.js';

test('a selected cookbook app retains its backend/shared assets without copying another example video', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-source-scope-'));
    try {
        const repo = path.join(root, 'cookbook');
        const app = path.join(repo, 'custom-frontend');
        for (const directory of ['frontend/public', 'backend', 'shared']) await fs.mkdir(path.join(app, directory), { recursive: true });
        await fs.mkdir(path.join(repo, 'other-example'), { recursive: true });
        const video = await fs.open(path.join(repo, 'other-example', 'demo.mp4'), 'w'); await video.truncate(21 * 1048576); await video.close();
        await fs.writeFile(path.join(app, 'frontend/package.json'), '{"scripts":{"dev":"vite"}}');
        await fs.writeFile(path.join(app, 'frontend/public/logo.svg'), '<svg/>');
        await fs.writeFile(path.join(app, 'backend/app.py'), 'from shared import business_rule');
        await fs.writeFile(path.join(app, 'shared/business_rule.py'), 'ANSWER = 7');
        await fs.writeFile(path.join(app, 'README.md'), 'Application knowledge');
        const scope = await projectEvaluationSourceScope({ source: 'GITHUB', rootDir: path.join(app, 'frontend'), storagePath: repo });
        assert.equal(scope.root, await fs.realpath(app)); assert.equal(scope.manifest.repositoryRelativeRoot, 'custom-frontend');
        const target = path.join(root, 'frozen'); await freezeProjectSource(scope.root, target);
        assert.equal(await fs.readFile(path.join(target, 'backend/app.py'), 'utf8'), 'from shared import business_rule');
        assert.equal(await fs.readFile(path.join(target, 'frontend/public/logo.svg'), 'utf8'), '<svg/>');
        assert.equal(await fs.readFile(path.join(target, 'shared/business_rule.py'), 'utf8'), 'ANSWER = 7');
        await assert.rejects(fs.access(path.join(target, 'other-example/demo.mp4')), { code: 'ENOENT' });
        await assert.rejects(freezeProjectSource(repo, path.join(root, 'whole-repo')), error => error.code === 'PROJECT_SOURCE_LIMIT' && error.message.includes('other-example/demo.mp4'));
    } finally {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('covai-source-scope-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('keeps an explicitly declared workspace and its local dependencies inside the imported repository', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-source-workspace-'));
    try {
        const repo = path.join(root, 'repo'); await fs.mkdir(path.join(repo, 'packages/chat'), { recursive: true });
        await fs.writeFile(path.join(repo, 'package.json'), '{"workspaces":["packages/*"]}');
        await fs.writeFile(path.join(repo, 'packages/chat/package.json'), '{}');
        const scope = await projectEvaluationSourceScope({ source: 'GITHUB', storagePath: repo, rootDir: path.join(repo, 'packages/chat') });
        assert.equal(scope.root, await fs.realpath(repo));
        assert.equal(scope.manifest.reason, 'DECLARED_WORKSPACE_OR_BACKEND_PAIR');
    } finally {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('covai-source-workspace-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('never expands source into a workspace outside the imported repository', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-source-boundary-'));
    try {
        const repo = path.join(root, 'repo'); await fs.mkdir(path.join(repo, 'packages/chat'), { recursive: true });
        await fs.writeFile(path.join(root, 'package.json'), '{"workspaces":["repo/packages/*"]}');
        await fs.writeFile(path.join(repo, 'packages/chat/package.json'), '{}');
        await assert.rejects(projectEvaluationSourceScope({ source: 'GITHUB', storagePath: repo, rootDir: path.join(repo, 'packages/chat') }), { code: 'INVALID_SOURCE_SCOPE' });
    } finally {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('covai-source-boundary-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});
