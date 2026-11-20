import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@jest/globals';
import { buildIsolationMockContracts } from '../services/unitTestContextEngineering.service.js';
import { healMissingDependencyMocks } from '../services/testSanitizer.service.js';
import { inspectUnitTestQuality } from '../services/unitTestQualityGate.service.js';

test('generated bcrypt and JWT factories compile under babel-jest and keep stable export identities', () => {
    const require = createRequire(import.meta.url);
    const parent = fileURLToPath(new URL('../../.covai-temp/', import.meta.url));
    fs.mkdirSync(parent, { recursive: true });
    const rootDir = fs.mkdtempSync(path.join(parent, 'auth-mock-hoisting-'));
    try {
        const { mockPreambleCode } = buildIsolationMockContracts({
            sourceCode: "const bcrypt = require('bcrypt'); const jwt = require('jsonwebtoken');",
            framework: 'jest',
        });
        const tests = [
            "const bcrypt = require('bcrypt');",
            "const bcryptjs = require('bcryptjs');",
            "const jwt = require('jsonwebtoken');",
            "test('configures the same functions through named and default exports', async () => {",
            "  bcrypt.default.compare.mockResolvedValueOnce(false);",
            "  await expect(bcrypt.compare('wrong', 'hash')).resolves.toBe(false);",
            "  expect(bcryptjs.default.hash).toBe(bcryptjs.hash);",
            "  jwt.default.verify.mockReturnValueOnce({ id: 'custom-user' });",
            "  expect(jwt.verify('fixture-token')).toEqual({ id: 'custom-user' });",
            "});",
        ].join('\n');
        const recoveryTest = "const jwt = require('jsonwebtoken');\n" +
            "test('recovers a missing JWT module', () => expect(jwt.verify('fixture-token').id).toBe('mock_user_1'));";
        const files = {
            'auth.test.js': mockPreambleCode + '\n' + tests,
            'jwt-recovery.test.js': healMissingDependencyMocks(recoveryTest, "Cannot find module 'jsonwebtoken'", { framework: 'jest' }),
        };
        for (const [file, code] of Object.entries(files)) {
            expect(inspectUnitTestQuality({ rootDir, testFile: file, code, framework: 'jest' }).findings).toEqual([]);
            fs.writeFileSync(path.join(rootDir, file), code);
        }
        const config = { rootDir, transform: { '^.+\\.js$': [require.resolve('babel-jest'), { configFile: false, babelrc: false }] } };
        const output = execFileSync(process.execPath, [
            require.resolve('jest/bin/jest'), '--config', JSON.stringify(config), '--runInBand', '--json',
        ], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
        expect(JSON.parse(output)).toMatchObject({ success: true, numPassedTests: 2, numPassedTestSuites: 2 });
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
}, 40000);
