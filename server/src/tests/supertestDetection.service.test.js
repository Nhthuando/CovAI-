import { detectSupertest } from '../services/supertestDetection.service.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('supertestDetection.service', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('detects Supertest dependency in devDependencies', async () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ devDependencies: { supertest: '^7.2.2' } }));

        const result = await detectSupertest(tempDir);
        expect(result.detected).toBe(true);
        expect(result.version).toBe('^7.2.2');
        expect(result.framework).toBe('jest');
    });

    test('detects Supertest imports and require calls', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'src', 'api.test.js'), "import request from 'supertest';");
        fs.writeFileSync(path.join(tempDir, 'src', 'user.spec.ts'), 'const request = require("supertest");');

        const result = await detectSupertest(tempDir);
        expect(result.detected).toBe(true);
        expect(result.supertestFiles).toHaveLength(2);
        expect(result.supertestFiles).toEqual(expect.arrayContaining([
            path.join(tempDir, 'src', 'api.test.js'),
            path.join(tempDir, 'src', 'user.spec.ts'),
        ]));
    });

    test('detects Jest configuration from package.json and config files', async () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ jest: { testEnvironment: 'node' } }));

        const result = await detectSupertest(tempDir);
        expect(result.framework).toBe('jest');
        expect(result.configPath).toBe(path.join(tempDir, 'package.json'));
        expect(result.configFile).toBe('package.json');
    });

    test('detects common test file patterns and ignores ignored directories', async () => {
        fs.mkdirSync(path.join(tempDir, '__tests__'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'coverage'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'node_modules', 'lib'), { recursive: true });

        fs.writeFileSync(path.join(tempDir, '__tests__', 'auth.spec.js'), 'require("supertest");');
        fs.writeFileSync(path.join(tempDir, 'src', 'app.test.js'), "import request from 'supertest';");
        fs.writeFileSync(path.join(tempDir, 'coverage', 'ignored.test.js'), 'require("supertest")');
        fs.writeFileSync(path.join(tempDir, 'node_modules', 'lib', 'bundle.test.js'), 'require("supertest")');

        const result = await detectSupertest(tempDir);
        expect(result.testFiles).toHaveLength(2);
        expect(result.supertestFiles).toHaveLength(2);
    });

    test('returns not detected when Supertest is absent', async () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({}));

        const result = await detectSupertest(tempDir);
        expect(result.detected).toBe(false);
        expect(result.supertestFiles).toEqual([]);
    });

    test('handles missing package.json gracefully', async () => {
        const result = await detectSupertest(tempDir);
        expect(result.detected).toBe(false);
        expect(result.detectionReasons).toEqual(expect.arrayContaining(['package.json not found']));
    });

    test('handles invalid package.json gracefully', async () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), '{ invalid json');

        const result = await detectSupertest(tempDir);
        expect(result.detected).toBe(false);
        expect(result.detectionReasons).toEqual(expect.arrayContaining([expect.stringContaining('Unable to read package.json')]));
    });
});