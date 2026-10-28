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
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
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

    describe('Task 6.1: 4 Library Permutations via detectSupertest', () => {
        test('Permutation 1: Có test + có lib (HAS_TESTS_AND_DEPS)', async () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ devDependencies: { supertest: '^6.3.3', jest: '^29.0.0' } })
            );
            fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });
            fs.writeFileSync(
                path.join(tempDir, 'tests', 'users.test.js'),
                'const request = require("supertest");\ndescribe("Users", () => { it("get", async () => {}); });'
            );

            const result = await detectSupertest(tempDir);
            expect(result.detected).toBe(true);
            expect(result.permutation).toBe('HAS_TESTS_AND_DEPS');
            expect(result.permutationDetails.readyForExecution).toBe(true);
            expect(result.permutationDetails.needsInstall).toBe(false);
        });

        test('Permutation 2: Không test + không lib (ZERO_TESTS_NO_DEPS)', async () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ dependencies: { express: '^4.18.2' } })
            );

            const result = await detectSupertest(tempDir);
            expect(result.permutation).toBe('ZERO_TESTS_NO_DEPS');
            expect(result.permutationDetails.isZeroTestProject).toBe(true);
            expect(result.permutationDetails.needsUserSelection).toBe(true);
            expect(result.permutationDetails.proposedFrameworks.length).toBeGreaterThanOrEqual(1);
        });

        test('Permutation 3: Có lib + không test (HAS_DEPS_NO_TESTS)', async () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ devDependencies: { supertest: '^6.3.3' } })
            );

            const result = await detectSupertest(tempDir);
            expect(result.detected).toBe(true);
            expect(result.permutation).toBe('HAS_DEPS_NO_TESTS');
            expect(result.permutationDetails.isZeroTestProject).toBe(true);
            expect(result.permutationDetails.needsUserSelection).toBe(false);
            expect(result.permutationDetails.targetFramework).toBe('supertest');
        });

        test('Permutation 4: Có test + thiếu lib (HAS_TESTS_NO_DEPS)', async () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ dependencies: { express: '^4.18.2' } })
            );
            fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });
            fs.writeFileSync(
                path.join(tempDir, 'tests', 'orders.test.js'),
                'import request from "supertest";\ntest("orders", async () => {});'
            );

            const result = await detectSupertest(tempDir);
            expect(result.detected).toBe(true);
            expect(result.permutation).toBe('HAS_TESTS_NO_DEPS');
            expect(result.permutationDetails.needsInstall).toBe(true);
            expect(result.permutationDetails.inferredFramework).toBe('supertest');
            expect(result.permutationDetails.missingPackages).toContain('supertest');
        });
    });
});
