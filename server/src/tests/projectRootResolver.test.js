import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveProjectRoot } from '../utils/projectRootResolver.js';

describe('projectRootResolver', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-root-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('returns snapshot root when a package.json exists at the root', () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'app' }));
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });

        expect(resolveProjectRoot(tempDir)).toBe(tempDir);
    });

    test('returns the single nested project directory when package.json is nested', () => {
        const projectDir = path.join(tempDir, 'my-project');
        fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'nested-app' }));

        expect(resolveProjectRoot(tempDir)).toBe(projectDir);
    });

    test('fails cleanly when no package.json exists anywhere in the snapshot', () => {
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'module.exports = 1;');

        expect(resolveProjectRoot(tempDir)).toBe(tempDir);
    });

    test('does not blindly choose a package.json in a monorepo', () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'workspace-root' }));
        const apiDir = path.join(tempDir, 'packages', 'api');
        const webDir = path.join(tempDir, 'packages', 'frontend');
        fs.mkdirSync(apiDir, { recursive: true });
        fs.mkdirSync(webDir, { recursive: true });
        fs.writeFileSync(path.join(apiDir, 'package.json'), JSON.stringify({ name: 'api' }));
        fs.writeFileSync(path.join(webDir, 'package.json'), JSON.stringify({ name: 'frontend' }));

        expect(resolveProjectRoot(tempDir)).toBe(tempDir);
    });

    test('prefers the server package in a monorepo when the repository root has no package.json', () => {
        const serverDir = path.join(tempDir, 'server');
        const clientDir = path.join(tempDir, 'client');
        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(clientDir, { recursive: true });
        fs.mkdirSync(path.join(serverDir, 'src'), { recursive: true });
        fs.mkdirSync(path.join(serverDir, 'tests'), { recursive: true });
        fs.mkdirSync(path.join(clientDir, 'src'), { recursive: true });

        fs.writeFileSync(path.join(serverDir, 'package.json'), JSON.stringify({
            name: 'server',
            dependencies: { supertest: '^7.0.0' },
            scripts: { test: 'jest' },
        }));
        fs.writeFileSync(path.join(clientDir, 'package.json'), JSON.stringify({
            name: 'client',
            dependencies: { react: '^19.0.0' },
            scripts: { dev: 'vite' },
        }));

        expect(resolveProjectRoot(tempDir)).toBe(serverDir);
    });
});
