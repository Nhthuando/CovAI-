import { expect, test } from '@jest/globals';
import { proposeCommonJsTestDraft } from '../services/commonJsTestDraft.service.js';
import { testBlocks } from '../services/generatedTestInputRepair.service.js';
import { preserveMongooseSchemaInDraft } from '../services/mongooseModelDraft.service.js';

test('replaces a generated Mongoose proxy without changing the validation assertion or an authored setup', () => {
    const sourceCode = "const mongoose = require('mongoose'); const schema = new mongoose.Schema({}); module.exports = mongoose.model('fixture', schema);";
    const stub = "jest.mock('mongoose', () => ({ model: jest.fn() }));";
    const assertion = "test('validates', () => expect(document.validateSync()).toBeUndefined());";
    const code = stub + "\n" + assertion;
    const migrated = preserveMongooseSchemaInDraft({ code, sourceCode, framework: 'jest' });
    expect(migrated).toContain("jest.requireActual('mongoose')");
    expect(migrated).toContain(assertion);
    expect(preserveMongooseSchemaInDraft({ code, sourceCode, framework: 'jest', original: stub })).toBe(code);
});

const middleware = `async function verifyToken(req, res, next) {
    try {
        if (!req.cookies.jwt) return res.status(401).json({ message: 'Token not found' });
        const result = jwt.verify(req.cookies.jwt, process.env.JWT_SECRET_KEY);
        req.user = result;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') return res.status(401).json({ message: 'Token Expired' });
        return res.status(401).json({ message: 'Token verification failed' });
    }
}
module.exports = verifyToken;`;

const middlewareInput = {
    sourceCode: middleware,
    sourceFile: 'server/middleware/verifyToken.js',
    testFile: 'server/tests/verifyToken.test.js',
};

test('uses the Express contract and leaves the same-named socket helper and existing suites alone', () => {
    const draft = proposeCommonJsTestDraft(middlewareInput).fullUpdatedContent;
    expect(testBlocks(draft)).toHaveLength(4);
    expect(draft).toContain('await verifyToken(req, res, next)');
    expect(draft).toContain('expect(req.user).toEqual(decoded)');
    expect(draft).toContain('require("../middleware/verifyToken.js")');
    expect(proposeCommonJsTestDraft({ ...middlewareInput, original: "test('existing', () => {});" })).toBeNull();
    expect(proposeCommonJsTestDraft({ ...middlewareInput, sourceFile: 'server/socket/middleware/verifyToken.js',
        sourceCode: 'async function verifyToken(token) { return token; }\nmodule.exports = { verifyToken };' })).toBeNull();
});

test('uses scoped CommonJS cache replacements for the Vitest seeding suite', () => {
    const { fullUpdatedContent } = proposeCommonJsTestDraft({
        sourceFile: 'scripts/orderSeeding.js',
        testFile: 'tests/orderSeeding.vitest.test.js',
        framework: 'vitest',
        sourceCode: `const dbConfiguration = require('../config/db');
const orderModel = require('../models/Order');
async function orderSeeding(orders) {
    try {
        await dbConfiguration.connectDB();
        await orderModel.insertMany(orders);
        process.exit(0);
    } catch (error) { process.exit(1); }
}
orderSeeding(orders);`,
    });
    expect(testBlocks(fullUpdatedContent)).toHaveLength(3);
    expect(fullUpdatedContent).toContain('[require.resolve("../config/db"), { connectDB }]');
    expect(fullUpdatedContent).toContain("vi.spyOn(process, 'exit')");
    expect(fullUpdatedContent).toContain('if (entry) require.cache[id] = entry');
    expect(fullUpdatedContent).not.toContain('vi.mock(');
});
