import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { validateArchiveContainsPackageJson, validateNodeProject } from '../utils/nodeProjectValidator.js';

describe('nodeProjectValidator', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-validator-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('accepts a valid project at the root', async () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'valid-app' }));
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'module.exports = 1;');

        await expect(validateNodeProject(tempDir)).resolves.toMatchObject({
            packageJsonExists: true,
            rootDir: tempDir,
        });
    });

    test('accepts a single nested project directory', async () => {
        const projectDir = path.join(tempDir, 'my-project');
        fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'nested-app' }));
        fs.writeFileSync(path.join(projectDir, 'src', 'index.js'), 'module.exports = 1;');

        await expect(validateNodeProject(tempDir)).resolves.toMatchObject({
            packageJsonExists: true,
            rootDir: projectDir,
        });
    });

    test('rejects a project with no package.json', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'module.exports = 1;');

        await expect(validateNodeProject(tempDir)).rejects.toThrow('Invalid Node.js project: package.json was not found in the uploaded project.');
    });

    test('rejects a project when Supertest files exist but package.json is missing', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'src', 'example.supertest.test.js'), "const request = require('supertest');");

        await expect(validateNodeProject(tempDir)).rejects.toThrow('Invalid Node.js project: package.json was not found in the uploaded project.');
    });

    test('rejects an archive that does not contain any package.json', async () => {
        const zip = new AdmZip();
        zip.addFile('src/index.js', Buffer.from('module.exports = 1;'));
        zip.addFile('src/example.supertest.test.js', Buffer.from("const request = require('supertest');"));

        await expect(validateArchiveContainsPackageJson(zip.toBuffer(), 'project.zip')).rejects.toThrow('Invalid Node.js project: package.json was not found in the uploaded project.');
    });

    test('accepts an archive that contains package.json in the project root', async () => {
        const zip = new AdmZip();
        zip.addFile('package.json', Buffer.from(JSON.stringify({ name: 'valid-app', scripts: { test: 'jest' }, devDependencies: { jest: '^29.0.0', supertest: '^7.0.0' } })));
        zip.addFile('src/index.js', Buffer.from('module.exports = 1;'));
        zip.addFile('src/example.supertest.test.js', Buffer.from("const request = require('supertest');"));

        await expect(validateArchiveContainsPackageJson(zip.toBuffer(), 'project.zip')).resolves.toBe(true);
    });
});
