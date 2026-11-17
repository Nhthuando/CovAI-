import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readGitLineBlame } from '../services/projectGitBlame.service.js';
const execute = promisify(execFile);
test('Git provenance is read-only, maps the current line and never borrows parent history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-line-blame-'));
    const git = (...args) => execute('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, windowsHide: true });
    try {
        await git('init', '-q'); await git('config', 'user.name', 'Dev A'); await git('config', 'user.email', 'dev-a@example.test');
        await fs.writeFile(path.join(root, 'a.js'), 'alpha\nbeta\n'); await git('add', '--', 'a.js'); await git('commit', '-q', '-m', 'Initial source');
        const committed = await readGitLineBlame({ root, path: 'a.js', content: 'alpha\nbeta\n', line: 2 });
        expect(committed.author).toBe('Dev A');
        const dirty = await readGitLineBlame({ root, path: 'a.js', content: 'new\nalpha\nbeta\n', line: 1 });
        expect(dirty).toBeNull();
        const shifted = await readGitLineBlame({ root, path: 'a.js', content: 'new\nalpha\nbeta\n', line: 3 });
        expect(shifted.author).toBe('Dev A');
        const child = path.join(root, 'nested'); await fs.mkdir(child);
        expect(await readGitLineBlame({ root: child, path: 'a.js', content: 'alpha\n', line: 1 })).toBeNull();
        expect((await git('status', '--porcelain')).stdout).toBe('');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
