import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@jest/globals';
import { jestMongooseMockCode } from '../services/jestMongooseMock.js';
import { inspectUnitTestQuality } from '../services/unitTestQualityGate.service.js';
import { suggestUnitTestTarget } from '../services/unitTestFilePolicy.service.js';
import { mergeUnitTestSuggestions } from '../services/unitTestSuggestionBatch.service.js';

const require = createRequire(import.meta.url);
const imported = process.env.COVAI_IMPORTED_SHOPPR;
const integration = imported ? test : test.skip;

integration('runs factory-local Mongoose mocks and conflicting target names against imported Shoppr in Jest', () => {
    const parent = fileURLToPath(new URL('../../.covai-temp/', import.meta.url));
    fs.mkdirSync(parent, { recursive: true });
    const rootDir = fs.mkdtempSync(path.join(parent, 'shoppr-jest-quality-'));
    const sourceFile = 'config/db.js';
    const sources = ['middleware/verifyToken.js', 'socket/middleware/verifyToken.js'];
    try {
        for (const file of ['package.json', sourceFile, ...sources]) {
            const target = path.join(rootDir, file);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(imported, file), target);
        }
        const testFile = suggestUnitTestTarget(rootDir, sourceFile, 'jest', 'tests/db.test.js');
        const code = jestMongooseMockCode + [
            "const { connectDB } = require('../config/db');",
            "const mongoose = require('mongoose');",
            "test('uses the same injected database mock', async () => {",
            "  await connectDB();",
            "  expect(mongoose.connect).toHaveBeenCalledTimes(1);",
            "  expect(mongoose.default.connect).toBe(mongoose.connect);",
            "  const Product = mongoose.model('Product');",
            "  Product.findOne.mockReturnValueOnce('selected');",
            "  expect(mongoose.default.model('Product').findOne()).toBe('selected');",
            "});",
            "const mockValue = { value: 42 };",
            "jest.doMock('runtime-config', () => mockValue, { virtual: true });",
            "test('registers a runtime mock after initialization', () => {",
            "  expect(require('runtime-config')).toBe(mockValue);",
            "});",
        ].join('\n');
        expect(inspectUnitTestQuality({ rootDir, testFile, sourceFile, code, framework: 'jest' }).findings).toEqual([]);
        const rootTest = path.join(rootDir, testFile);
        fs.mkdirSync(path.dirname(rootTest), { recursive: true });
        fs.writeFileSync(rootTest, code);
        const drafts = mergeUnitTestSuggestions(rootDir, sources.map((file, i) => ({
            sourceFile: file, framework: i === 0 ? undefined : 'jest', testFile: 'tests/verifyToken.test.js',
            generatedCode: "const verify = require('../" + file + "');\n" + (i === 0
                ? "test('HTTP middleware rejects a missing cookie', async () => { const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }; await verify({ cookies: {} }, res, jest.fn()); expect(res.status).toHaveBeenCalledWith(401); });"
                : "test('socket middleware rejects a missing token', async () => { expect(await verify.verifyToken()).toBe(false); });"),
        })));
        expect(drafts).toHaveLength(2);
        expect(drafts[0].testFile).not.toBe(drafts[1].testFile);
        for (const draft of drafts) fs.writeFileSync(path.join(rootDir, draft.testFile), draft.fullUpdatedContent);
        const config = {
            rootDir,
            transform: { '^.+\\.js$': [require.resolve('babel-jest'), { configFile: false, babelrc: false }] },
        };
        const output = execFileSync(process.execPath, [
            require.resolve('jest/bin/jest'), '--config', JSON.stringify(config),
            '--runInBand', '--runTestsByPath', rootTest, ...drafts.map(draft => path.join(rootDir, draft.testFile)), '--json',
        ], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
        expect(JSON.parse(output)).toMatchObject({ success: true, numPassedTests: 4, numPassedTestSuites: 3 });
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
}, 60000);
