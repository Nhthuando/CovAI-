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

    test('should detect supertest dependency', async () => {
        const pkg = { dependencies: { supertest: '^7.0.0' } };
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

        const result = await detectSupertest(tempDir);
        expect(result.detected).toBe(true);
        expect(result.version).toBe('^7.0.0');
    });

    test('should detect supertest usage in files', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'));
        const testFile = path.join(tempDir, 'src', 'api.test.js');
        fs.writeFileSync(testFile, "import request from 'supertest';");

        const result = await detectSupertest(tempDir);
        expect(result.detected).toBe(true);
        expect(result.supertestFiles).toContain(testFile);
    });

    test('should return not detected when missing', async () => {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({}));

        const result = await detectSupertest(tempDir);
        expect(result.detected).toBe(false);
    });
});