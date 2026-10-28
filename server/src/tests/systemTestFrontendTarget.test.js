import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from '@jest/globals';
import { resolveFrontendAutDirectory } from '../services/systemTestRunner.service.js';

const roots = [];
const root = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-frontend-target-'));
    roots.push(directory);
    return directory;
};
const app = (directory, command) => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ scripts: { dev: command } }));
};
afterEach(() => { for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

it('selects the sibling frontend inside the imported Git repository when the snapshot points at its backend', () => {
    const directory = root();
    fs.mkdirSync(path.join(directory, '.git'));
    app(path.join(directory, 'server'), 'nodemon index.js');
    app(path.join(directory, 'client'), 'vite');
    expect(resolveFrontendAutDirectory(path.join(directory, 'server'))).toBe(path.join(directory, 'client'));
});

it('selects a nested frontend before a root backend script', () => {
    const directory = root();
    app(directory, 'node server.js');
    app(path.join(directory, 'frontend'), 'next dev');
    expect(resolveFrontendAutDirectory(directory)).toBe(path.join(directory, 'frontend'));
});

it('does not traverse outside a standalone snapshot to an unrelated sibling app', () => {
    const directory = root();
    app(path.join(directory, 'server'), 'node index.js');
    app(path.join(directory, 'client'), 'vite');
    expect(resolveFrontendAutDirectory(path.join(directory, 'server'))).toBe(path.join(directory, 'server'));
});

it('keeps standalone frontend projects as the app root', () => {
    const directory = root();
    app(directory, 'vite');
    expect(resolveFrontendAutDirectory(directory)).toBe(directory);
});
