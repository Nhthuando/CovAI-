import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, expect, test } from '@jest/globals';
import { inspectUnitTestQuality, analyzeUnitTestFailures, verifyQualityCoverage } from '../services/unitTestQualityGate.service.js';

let rootDir;
const testFile = 'tests/example.test.ts';
const sourceFile = 'src/example.ts';
const imports = "import { role } from '../src/example';\n";
beforeEach(() => {
    const parent = fileURLToPath(new URL('../../.covai-temp/', import.meta.url));
    fs.mkdirSync(parent, { recursive: true });
    rootDir = fs.mkdtempSync(path.join(parent, 'quality-gate-'));
    fs.mkdirSync(path.join(rootDir, 'src'));
    fs.writeFileSync(path.join(rootDir, sourceFile), "export function role(input: string) { return 'model'; }\n");
});
afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

const inspect = (code, extra = {}) => inspectUnitTestQuality({ rootDir, sourceFile, testFile, code, framework: 'jest', ...extra });

test('uses nested request access evidence and leaves directly forwarded values untyped', () => {
    fs.writeFileSync(path.join(rootDir, sourceFile), `
function addToCart(req, res) { return res.json({ productId: req.params.productId, userId: req.user.id }); }
function forward(req, res) { return res.json(req.user); }
module.exports = { addToCart, forward };`);
    const prefix = "import { addToCart, forward } from '../src/example';\nconst res = { json: jest.fn() };\n";
    const good = inspect(prefix + "test('returns cart', () => { addToCart({params:{productId:'abc'},user:{id:'u1'}},res); expect(res.json).toHaveBeenCalled(); });");
    expect(good.findings).toEqual([]);
    const bad = inspect(prefix + "test('returns cart', () => { addToCart({params:'abc',user:'u1'},res); expect(res.json).toHaveBeenCalled(); });");
    expect(bad.findings).toEqual([expect.objectContaining({ classification: 'SOURCE_CONTRACT_MISMATCH',
        sourceLine: 2, evidence: expect.arrayContaining(['req.params.productId']) })]);
    const forwarded = inspect(prefix + "test('forwards the user', () => { forward({user:'u1'},res); expect(res.json).toHaveBeenCalledWith('u1'); });");
    expect(forwarded.findings).toEqual([]);
});

test('reports a potential source defect when the registered middleware supplies a scalar user', () => {
    const controller = 'controllers/cart.js';
    for (const dir of ['controllers', 'routes', 'middleware']) fs.mkdirSync(path.join(rootDir, dir));
    fs.writeFileSync(path.join(rootDir, controller), 'exports.getCart = (req, res) => res.json(req.user.id);');
    fs.writeFileSync(path.join(rootDir, 'routes/cart.js'), `const controller = require('../controllers/cart');
const auth = require('../middleware/auth');
router.get('/', auth, controller.getCart);`);
    fs.writeFileSync(path.join(rootDir, 'middleware/auth.js'), "module.exports = (req, res, next) => { req.user = 'legacyId'; next(); };");
    const result = inspect("import { getCart } from '../controllers/cart';\ntest('reads a cart', () => getCart({user:{id:'one'}}, {json: jest.fn()}));",
        { sourceFile: controller });
    expect(result.findings).toEqual([expect.objectContaining({ classification: 'POTENTIAL_SOURCE_DEFECT',
        sourceLine: 1, evidence: expect.arrayContaining(['routes/cart.js:3', 'middleware/auth.js:1 assigns string']) })]);
});

test('checks required and enum constraints for positive document fixtures', () => {
    fs.writeFileSync(path.join(rootDir, sourceFile), `const mongoose = require('mongoose');
const schema = new mongoose.Schema({ owner: { type: String, required: true }, status: { type: String, enum: ['Draft'], default: 'Draft' } });
module.exports = mongoose.model('fixture', schema);`);
    const prefix = "const Model = require('../src/example');\n";
    const bad = inspect(prefix + "test('valid document', () => expect(new Model({status:'Other'}).validateSync()).toBeUndefined());");
    expect(bad.findings.map(finding => finding.classification)).toEqual(['INVALID_FIXTURE', 'INVALID_FIXTURE']);
    expect(inspect(prefix + "test('rejects invalid status', () => expect(new Model({owner:'x', status:'Other'}).validateSync()).toBeDefined());").findings).toEqual([]);
    expect(inspect(prefix + "test('valid default', () => expect(new Model({owner:'x'}).validateSync()).toBeUndefined());").findings).toEqual([]);
});

test('classifies a runtime ReferenceError on a proven missing CommonJS export as a source defect', () => {
    fs.writeFileSync(path.join(rootDir, sourceFile), 'function verifyPayment() {}\nmodule.exports = { placeOrder, verifyPayment };');
    const failures = analyzeUnitTestFailures({ rootDir, items: [{ sourceFile, testFile }],
        results: { testResults: [{ name: testFile, status: 'failed',
            message: 'ReferenceError: placeOrder is not defined\n    at Object.placeOrder (/workspace/src/example.ts:2:20)' }] } });
    expect(failures).toEqual([expect.objectContaining({ code: 'C', sourceLine: 2, reason: expect.stringContaining('placeOrder') })]);
});

test('classifies Jest dependency preparation failures before test collection as runner environment errors', () => {
    const failures = analyzeUnitTestFailures({
        rootDir, items: [],
        output: '[jest] Unable to prepare dependencies for Jest in the Docker workspace (server/package.json, @prisma/client). npm error code EUSAGE',
    });
    expect(failures).toEqual([expect.objectContaining({ code: 'E', testFile: null, testCaseId: null })]);
});

test('valid direct expectation passes, while an incorrect literal is shown with source evidence', () => {
    expect(inspect(imports + "test('normalizes role', () => expect(role('assistant')).toBe('model'));").findings).toEqual([]);
    const { findings } = inspect(imports + "test('normalizes role', () => expect(role('assistant')).toBe('user'));");
    expect(findings).toEqual([expect.objectContaining({ code: 'A', expected: 'user', actual: 'model',
        functionName: 'role', sourceLine: 1 })]);
});

test('requires review when a generated error-message assertion conflicts with a proven throw', () => {
    fs.writeFileSync(path.join(rootDir, sourceFile), "export function role() { throw new Error('missing message'); }");
    expect(inspect(imports + "test('rejects missing input', () => expect(() => role()).toThrow('invalid body'));").findings)
        .toEqual([expect.objectContaining({ code: 'A', assertion: 'toThrow', expected: 'invalid body', actual: 'missing message' })]);
});

test('distinguishes a typed fixture mismatch from intentional invalid input and unrelated assertions', () => {
    expect(inspect(imports + "test('converts role', () => expect(role([])).toBe('model'));").findings)
        .toEqual([expect.objectContaining({ code: 'B', functionName: 'role' })]);
    expect(inspect(imports + "test('rejects invalid input', () => expect(() => role([])).toThrow());").findings).toEqual([]);
    expect(inspect("test('converts role', () => expect(1).toBe(1));").findings)
        .toEqual([expect.objectContaining({ code: 'D' })]);
});

test('a matching unchanged test provides independent evidence of a suspected source defect', () => {
    const original = imports + "test('approved behavior', () => expect(role('assistant')).toBe('user'));\n";
    const report = inspect(original + "test('additional case', () => expect(role('assistant')).toBe('user'));", { original });
    expect(report.cases).toHaveLength(1);
    expect(report.findings).toEqual([expect.objectContaining({ code: 'C',
        evidence: expect.arrayContaining(['Existing test: approved behavior']) })]);
});

test.each([
    "jest.mock('../src/example', { virtual: true });",
    "const fixture = makeFixture(); jest.mock('./dependency', () => ({ fixture }));",
])('blocks an invalid Jest mock before execution (%s)', mock => {
    expect(inspect(mock + "\ntest('behavior', () => expect(something()).toEqual('result'));").findings)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'E' })]));
});

test('valid Vitest factory uses the Vitest rules', () => {
    const code = "import { vi, test, expect } from 'vitest';\nvi.mock('dependency', () => ({ invoke: vi.fn() }));\ntest('invokes target', () => expect(target()).toBe('value'));";
    expect(inspect(code, { framework: 'vitest' }).findings).toEqual([]);
    const badCapture = "import { vi } from 'vitest'; const fixture = initialize(); vi.mock('dependency', () => ({ fixture }));";
    expect(inspect(badCapture, { framework: 'vitest' }).findings)
        .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'E', evidence: ['fixture'] })]));
    const safeCapture = "import { vi } from 'vitest'; const {fixture} = vi.hoisted(() => ({fixture: 42})); vi.mock('dependency', () => ({ fixture }));";
    expect(inspect(safeCapture, { framework: 'vitest' }).findings).toEqual([]);
});

test('runtime assertion needs independent requirement evidence and missing module is classified separately', () => {
    const items = [{ testFile, sourceFile }];
    const classify = message => analyzeUnitTestFailures({ rootDir, items, results: { testResults: [
        { name: path.join(rootDir, testFile), status: 'failed', assertionResults: [
            { status: 'failed', title: 'case', failureMessages: [message] },
        ] },
    ] } });
    expect(classify('Expected: "user"\nReceived: "model"')).toEqual([expect.objectContaining({
        code: 'D', classification: 'REQUIREMENT_UNVERIFIED', testCaseId: 'case', expected: '"user"', actual: '"model"',
    })]);
    expect(classify("Cannot find module 'dependency'")).toEqual([expect.objectContaining({ code: 'E' })]);
});

test('coverage for an unrelated branch or already-covered branch does not establish the claimed gain', () => {
    const meta = line => ({ type: 'if', line, loc: { start: { line, column: 0 }, end: { line, column: 9 } },
        locations: [{ start: { line, column: 4 }, end: { line, column: 9 } }] });
    const map = (first, second) => ({ [sourceFile]: { branchMap: { 1: meta(10), 2: meta(20) }, b: { 1: [first], 2: [second] } } });
    const items = [{ testFile, sourceFile, targetBranches: ['if:10'] }];
    expect(verifyQualityCoverage({ items, baseline: map(0, 0), candidate: map(0, 1) })[0].verified).toBe(false);
    expect(verifyQualityCoverage({ items, baseline: map(1, 0), candidate: map(1, 1) })[0].verified).toBe(false);
    expect(verifyQualityCoverage({ items, baseline: map(0, 0), candidate: map(1, 1) })[0])
        .toMatchObject({ verified: true, branches: ['if:10'] });
});
