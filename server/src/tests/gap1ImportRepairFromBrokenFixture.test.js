import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runSupertest } from '../services/supertestRunner.service.js';
import { parseJestResults } from '../services/testResultParser.service.js';
import { transformTestCodeForProject } from '../services/supertestCoverageJob.service.js';

// Optional replay of a developer-owned snapshot; regular tests use committed fixtures.
const externalSnapshot = process.env.COVAI_EXTERNAL_SNAPSHOT || "D:/NCKH/CovAI-/server/uploads/snapshots/cmv96a09k0001r87dy9bs65g4/Online-Food-Ordering-System-main";
const replaySnapshot = fs.existsSync(externalSnapshot) ? describe : describe.skip;
replaySnapshot('Verification Gap 1: Import-Path Repair Without Pre-Healing the Fixtures', () => {
    const originalSnapshotDir = externalSnapshot;
    let disposableRootDir;
    const testFilesRel = [
        'server/__tests__/integration/generated_api-76cbcebb.test.js',
        'server/__tests__/integration/productDelete-5d6403b9.test.js',
        'server/__tests__/integration/productEndpoints-20b217a2.test.js',
        'tests/integration/cart-4546ded5.test.js',
        'tests/integration/cart-ce674710.test.js',
        'tests/integration/payment-24083753.test.js',
        'tests/integration/productRoutes-1c4cede1.test.js'
    ];

    beforeAll(() => {
        // 1. Create a fresh, disposable test fixture outside the persisted snapshot
        disposableRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-gap1-fixture-'));

        // Copy package.json
        fs.copyFileSync(path.join(originalSnapshotDir, 'package.json'), path.join(disposableRootDir, 'package.json'));

        // Copy server directory (excluding node_modules, coverage, .covai-temp)
        const copyDirRecursive = (src, dest) => {
            fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });
            for (const entry of entries) {
                if (['node_modules', 'coverage', '.covai-temp'].includes(entry.name)) continue;
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                    copyDirRecursive(srcPath, destPath);
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        };

        copyDirRecursive(path.join(originalSnapshotDir, 'server'), path.join(disposableRootDir, 'server'));

        // Create junction for server/node_modules and root node_modules so dependencies resolve
        const origServerModules = path.join(originalSnapshotDir, 'server', 'node_modules');
        const targetServerModules = path.join(disposableRootDir, 'server', 'node_modules');
        fs.symlinkSync(origServerModules, targetServerModules, 'junction');
        fs.symlinkSync(origServerModules, path.join(disposableRootDir, 'node_modules'), 'junction');

        // Copy tests folder
        copyDirRecursive(path.join(originalSnapshotDir, 'tests'), path.join(disposableRootDir, 'tests'));

        // 2. Seed fixture with original BROKEN import paths (DO NOT pre-heal!)
        // In server/__tests__/integration/ (depth 3), seed with broken ../../server/index.js
        const deepFiles = [
            'server/__tests__/integration/generated_api-76cbcebb.test.js',
            'server/__tests__/integration/productDelete-5d6403b9.test.js',
            'server/__tests__/integration/productEndpoints-20b217a2.test.js'
        ];
        for (const rel of deepFiles) {
            const p = path.join(disposableRootDir, rel);
            let content = fs.readFileSync(p, 'utf8');
            content = content.replace(/require\(['"]\.\.\/\.\.\/index(\.js)?['"]\)/g, 'require("../../server/index.js")');
            content = content.replace(/from\s+['"]\.\.\/\.\.\/index(\.js)?['"]/g, 'from "../../server/index.js"');
            fs.writeFileSync(p, content, 'utf8');
        }

        // In tests/integration/ (depth 2), seed with broken ../../index (resolves to non-existent root index.js)
        const shallowFiles = [
            'tests/integration/cart-4546ded5.test.js',
            'tests/integration/cart-ce674710.test.js',
            'tests/integration/payment-24083753.test.js',
            'tests/integration/productRoutes-1c4cede1.test.js'
        ];
        for (const rel of shallowFiles) {
            const p = path.join(disposableRootDir, rel);
            let content = fs.readFileSync(p, 'utf8');
            content = content.replace(/require\(['"]\.\.\/\.\.\/server\/index(\.js)?['"]\)/g, 'require("../../index")');
            content = content.replace(/from\s+['"]\.\.\/\.\.\/server\/index(\.js)?['"]/g, 'from "../../index"');
            fs.writeFileSync(p, content, 'utf8');
        }
    });

    afterAll(() => {
        // Keep existing snapshot intact and clean up disposable test fixture
        try {
            if (disposableRootDir && fs.existsSync(disposableRootDir)) {
                fs.rmSync(disposableRootDir, { recursive: true, force: true });
            }
        } catch (_) {}
    });

    test('1. Confirm fixture is seeded with original broken import paths before execution', () => {
        // Deep files must contain the broken import path
        for (const rel of [
            'server/__tests__/integration/generated_api-76cbcebb.test.js',
            'server/__tests__/integration/productDelete-5d6403b9.test.js',
            'server/__tests__/integration/productEndpoints-20b217a2.test.js'
        ]) {
            const content = fs.readFileSync(path.join(disposableRootDir, rel), 'utf8');
            expect(content).toContain('../../server/index');
            // This path inside server/__tests__/integration/ would resolve to server/server/index.js which does not exist
            const badResolved = path.resolve(path.dirname(path.join(disposableRootDir, rel)), '../../server/index.js');
            expect(fs.existsSync(badResolved)).toBe(false);
        }

        // Shallow files must contain ../../index which resolves to rootDir/index.js (does not exist)
        for (const rel of [
            'tests/integration/cart-4546ded5.test.js',
            'tests/integration/cart-ce674710.test.js',
            'tests/integration/payment-24083753.test.js',
            'tests/integration/productRoutes-1c4cede1.test.js'
        ]) {
            const content = fs.readFileSync(path.join(disposableRootDir, rel), 'utf8');
            expect(content).toContain('../../index');
            const badResolved = path.resolve(path.dirname(path.join(disposableRootDir, rel)), '../../index.js');
            expect(fs.existsSync(badResolved)).toBe(false);
        }
    });

    test('2. Actual service execution path transforms broken fixtures dynamically and runs all 18 scenarios to PASS', async () => {
        const supertestFiles = [];

        // Invoke the actual service transformation logic used by Integration Testing
        // (transformTestCodeForProject which calls resolveAppImportPath and Babel CommonJS transform)
        for (const rel of testFilesRel) {
            const fullPath = path.join(disposableRootDir, rel);
            const rawCode = fs.readFileSync(fullPath, 'utf8');
            const transformed = await transformTestCodeForProject(rawCode, disposableRootDir, fullPath);
            fs.writeFileSync(fullPath, transformed, 'utf8');
            supertestFiles.push(fullPath);
        }

        // Verify that after transformation, the broken imports have been repaired by the service
        for (const rel of [
            'server/__tests__/integration/generated_api-76cbcebb.test.js',
            'server/__tests__/integration/productDelete-5d6403b9.test.js',
            'server/__tests__/integration/productEndpoints-20b217a2.test.js'
        ]) {
            const transformed = fs.readFileSync(path.join(disposableRootDir, rel), 'utf8');
            expect(transformed).not.toContain('../../server/index');
            expect(transformed).toContain('../../index');
        }

        for (const rel of [
            'tests/integration/cart-4546ded5.test.js',
            'tests/integration/cart-ce674710.test.js',
            'tests/integration/payment-24083753.test.js',
            'tests/integration/productRoutes-1c4cede1.test.js'
        ]) {
            const transformed = fs.readFileSync(path.join(disposableRootDir, rel), 'utf8');
            expect(transformed).toContain('../../server/index');
        }

        // Execute runner through the real runSupertest pipeline
        const runResult = await runSupertest('gap1-job-verification', disposableRootDir, null, supertestFiles);
        expect(runResult).toBeDefined();
        expect(runResult.coverageDir).toBeDefined();

        // Parse actual runner output via parseJestResults
        const parsed = parseJestResults(runResult.coverageDir);
        expect(parsed).not.toBeNull();

        // Verify all 18 scenarios are accounted for and passed
        expect(parsed.totalTests).toBe(18);
        expect(parsed.passedTests).toBe(18);
        expect(parsed.failedTests).toBe(0);
        expect(parsed.skippedTests).toBe(0);
        expect(parsed.status).toBe('PASSED');
        expect(parsed.scenarios).toHaveLength(18);

        // Verify no module-not-found errors occurred in any scenario
        for (const sc of parsed.scenarios) {
            expect(sc.status).toBe('passed');
            const failText = (sc.failureMessages || []).join('\n');
            expect(failText).not.toContain("Cannot find module '../../server/index.js'");
            expect(failText).not.toContain('MODULE_NOT_FOUND');
        }
    }, 45000);
});
