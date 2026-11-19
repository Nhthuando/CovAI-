import { expect, test } from '@jest/globals';
import { analyzeMongooseSchemas } from '../services/mongooseSchemaAnalyzer.service.js';
import { frameworkCompatibilityFindings } from '../services/testFrameworkCapabilities.service.js';
import { parseJavaScriptCode } from '../services/babelParser.service.js';
import { sourceInputContracts } from '../services/unitTestInputContracts.service.js';
import { classifyReportedFailure } from '../services/testFailureClassifier.service.js';
import { proposeVerifiedFrameworkRepair } from '../services/unitTestQualityGate.service.js';
import { validateAndNormalizeMocks } from '../services/mockValidation.service.js';

test('extracts nested schema metadata and preserves the distinction between absent and dynamic defaults', () => {
    const [model] = analyzeMongooseSchemas(`
        const mongoose = require('mongoose');
        const choices = ['Pending', 'Success'];
        const line = new mongoose.Schema({ name: { type: String, required: [true, 'required'] } });
        const payment = new mongoose.Schema({
            userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
            status: { type: String, default: 'Pending', enum: choices },
            createdAt: { type: Date, default: Date.now },
            paymentId: String,
            lines: [line],
        }, { collection: 'payment-records' });
        module.exports = mongoose.model('Payment', payment);
    `);
    expect(model).toMatchObject({ modelName: 'Payment', collectionName: 'payment-records', complete: true, fields: [
        { path: 'userId', type: 'mongoose.Schema.Types.ObjectId', required: true, reference: { kind: 'ref', value: 'User' } },
        { path: 'status', enum: ['Pending', 'Success'], default: { kind: 'literal', value: 'Pending' } },
        { path: 'createdAt', default: { kind: 'dynamic' } },
        { path: 'paymentId', type: 'String' },
        { path: 'lines', array: true, nested: [{ path: 'name', required: true }] },
    ] });
    const paths = Object.fromEntries(model.fields.map(field => [field.path, field]));
    expect(paths.paymentId).not.toHaveProperty('required');
    expect(paths.paymentId).not.toHaveProperty('default');
    expect(paths).not.toHaveProperty('transactionId');
});

test('keeps collections and incomplete schema paths unverified when source evidence is missing', () => {
    const [model] = analyzeMongooseSchemas("import { Schema, model as build } from 'mongoose'; const spec = new Schema({ ...externalPaths, status: String }); export default build('Audit', spec);");
    expect(model).toMatchObject({ collectionName: null, modelName: 'Audit', complete: false, fields: [{ path: 'status' }] });
});

test('flags wrong runner APIs without rejecting supported matcher or mock bindings', () => {
    const issues = (code, framework) => frameworkCompatibilityFindings(parseJavaScriptCode(code).ast, framework).map(issue => issue.api);
    expect(issues("vi.fn(); expect(1).toBeTypeOf('number');", 'jest')).toEqual(['vi.fn', 'toBeTypeOf']);
    expect(issues("jest.fn(); vi.requireActual('db');", 'vitest')).toEqual(['jest.fn', 'vi.requireActual']);
    expect(issues("import { vi as mock, expect } from 'vitest'; mock.fn(); expect(1).toBeTypeOf('number');", 'vitest')).toEqual([]);
    expect(issues("const vi = { fn() {} }; vi.fn(); expect(1).toBe(1);", 'jest')).toEqual([]);
    expect(issues("expect(promise).resolves.not.toBeTypeOf('number'); jest.mockResolvedValue(1);", 'jest'))
        .toEqual(['toBeTypeOf', 'jest.mockResolvedValue']);
});

test('checks the specific default or named dependency referenced in each spy assertion', () => {
    const code = `import db from '../config/db';
import { create } from '../models/User';
test('checks dependencies', () => {
    jest.spyOn(db, 'disconnect');
    expect(db.connectDB).toHaveBeenCalled();
    expect(db.disconnect).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
});`;
    const diagnostics = validateAndNormalizeMocks({ code, framework: 'jest', filePath: 'tests/seed.test.js' })
        .diagnostics.filter(issue => issue.rule === 'UNMOCKED_SPY_ASSERTION');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(issue => issue.message)).toEqual([
        expect.stringContaining('db.connectDB'), expect.stringContaining('create'),
    ]);
    const hooked = validateAndNormalizeMocks({
        framework: 'jest', filePath: 'tests/seed.test.js',
        code: `import db from '../config/db';
describe('connect', () => {
    beforeEach(() => jest.spyOn(db, 'connectDB'));
    test('connection', () => expect(db.connectDB).toHaveBeenCalled());
});`,
    });
    expect(hooked.diagnostics.find(issue => issue.rule === 'UNMOCKED_SPY_ASSERTION')).toBeUndefined();
});

test('extracts middleware and seeding contracts without executing the source', () => {
    const express = sourceInputContracts(`const jwt = require('jsonwebtoken');
async function verifyToken(req,res,next) {
    if (!req.cookies.jwt) return res.status(401).json({});
    req.user = jwt.verify(req.cookies.jwt);
    next();
}
module.exports = verifyToken;`).functions.get('verifyToken');
    expect(express.parameters.map(parameter => parameter.name)).toEqual(['req', 'res', 'next']);
    expect(express.dependencyCalls).toEqual(['jwt.verify']);
    expect(express.returns).toEqual([{ kind: 'CallExpression' }]);
    const seeding = sourceInputContracts("const db = require('./db'); async function seed(data) { await db.connectDB(); } seed(rows);");
    expect(seeding.entryPoints).toEqual([expect.objectContaining({ name: 'seed', importTime: true, dependencyCalls: ['db.connectDB'] })]);
});

test('repairs only a proven Jest matcher mismatch in generated code', () => {
    const code = "test('checks output', () => expect(get()).toBeTypeOf('object'));";
    const issue = { classification: 'FRAMEWORK_COMPATIBILITY_ERROR', api: 'toBeTypeOf' };
    expect(proposeVerifiedFrameworkRepair(code, '', [issue])).toEqual({
        content: "test('checks output', () => expect(typeof (0, get())).toBe('object'));", action: 'NORMALIZE_JEST_TYPEOF',
    });
    expect(proposeVerifiedFrameworkRepair(code, code, [issue])).toBeNull();
    expect(proposeVerifiedFrameworkRepair(code, '', [{ classification: 'REQUIREMENT_UNVERIFIED' }])).toBeNull();
    expect(classifyReportedFailure("TypeError: Cannot read properties of null (reading 'errors')")).toBeNull();
    expect(classifyReportedFailure('Expected: a\nReceived: b', { hasComparison: true })).toMatchObject({ classification: 'REQUIREMENT_UNVERIFIED' });
    expect(classifyReportedFailure('TypeError: db.connectDB.mockResolvedValueOnce is not a function')).toMatchObject({ classification: 'MOCK_BINDING_ERROR' });
});
