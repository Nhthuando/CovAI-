import { assembleUnitTestContext, buildIsolationMockContracts } from '../services/unitTestContextEngineering.service.js';
import { buildStandardUnitTestPrompt } from '../services/unitTestGenerator.service.js';
import { healMissingDependencyMocks, healControllerFixturesWithAst } from '../services/testSanitizer.service.js';

describe('R2: Mock Data and Virtual Database Setup for Suggested Tests', () => {
    test('Scenario 1: Mongoose query chain includes thenable methods and resolves to mock data', () => {
        const sourceCode = `const mongoose = require('mongoose');
const Product = mongoose.model('Product');
async function getProducts() {
    return await Product.find().populate('category').sort({ createdAt: -1 });
}
module.exports = { getProducts };`;

        const contracts = buildIsolationMockContracts({ sourceCode, framework: 'jest' });
        expect(contracts.detectedDependencies).toContain('mongoose-db');
        expect(contracts.mockPreambleCode).toContain('then: (resolve, reject)');
        expect(contracts.mockPreambleCode).toContain('catch: (reject)');
        expect(contracts.mockPreambleCode).toContain('finally: (cb)');
        expect(contracts.mockPreambleCode).toContain('populate: jest.fn().mockReturnThis()');
        expect(contracts.mockPreambleCode).toContain('sort: jest.fn().mockReturnThis()');
    });

    test('Scenario 2: Detects JWT and injects jwt.verify, jwt.sign mocks in RAM', () => {
        const sourceCode = `const jwt = require('jsonwebtoken');
async function checkAuth(req, res, next) {
    const user = jwt.verify(req.cookies.jwt, process.env.JWT_SECRET);
    req.user = user;
    next();
}
module.exports = checkAuth;`;

        const contracts = buildIsolationMockContracts({ sourceCode, framework: 'jest' });
        expect(contracts.detectedDependencies).toContain('jwt-auth');
        expect(contracts.mockPreambleCode).toContain("jest.mock('jsonwebtoken'");
        expect(contracts.mockPreambleCode).toContain("verify: jest.fn(");
        expect(contracts.mockPreambleCode).toContain("sign: jest.fn(");
        expect(contracts.mockPreambleCode).toContain("{ virtual: true }");
    });

    test('Scenario 3: Express controller fixtures include cookies.jwt', () => {
        const sourceCode = `async function verifyToken(req, res, next) {
    if (!req.cookies.jwt) return res.status(401).json({ message: 'Token not found' });
    next();
}`;
        const contracts = buildIsolationMockContracts({ sourceCode, framework: 'jest' });
        expect(contracts.mockPreambleCode).toContain("cookies: { jwt: 'mock_token'");
    });

    test('Scenario 4: testSanitizer auto-heals missing jsonwebtoken and mongoose mocks', () => {
        const testCodeWithoutMocks = `describe('VerifyToken Middleware', () => {
  it('authenticates user', () => {
    const res = verifyToken(req, res, next);
  });
});`;

        const healedJwt = healMissingDependencyMocks(testCodeWithoutMocks, "Cannot find module 'jsonwebtoken'", false);
        expect(healedJwt).toContain("jest.mock('jsonwebtoken'");
        expect(healedJwt).toContain("virtual: true");

        const healedMongoose = healMissingDependencyMocks(testCodeWithoutMocks, "Cannot find module 'mongoose'", false);
        expect(healedMongoose).toContain("jest.mock('mongoose'");
        expect(healedMongoose).toContain("virtual: true");
    });

    test('Scenario 5: buildStandardUnitTestPrompt embeds Mongoose and JWT directives', () => {
        const sourceCode = `const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
module.exports = async function(req, res, next) {
    const token = req.cookies.jwt;
    const decoded = jwt.verify(token, 'secret');
    const user = await mongoose.model('User').findById(decoded.id);
    req.user = user;
    next();
};`;

        const prompt = buildStandardUnitTestPrompt({
            sourceCode,
            testFileInfo: { relativePath: 'tests/auth.test.js', content: '' },
            coverageDetails: { summary: { linesPct: 0, branchesPct: 0, funcsPct: 0, stmtsPct: 0 } },
            unitTestContext: {
                mockContracts: {
                    detectedDependencies: ['mongoose-db', 'jwt-auth'],
                    mockPreambleCode: '// mock preamble',
                    mockInstructions: '- Mock instructions'
                }
            },
            framework: 'jest'
        });

        expect(prompt).toContain('CRITICAL DATABASE ISOLATION CONTRACT (MONGOOSE)');
        expect(prompt).toContain('CRITICAL AUTH ISOLATION CONTRACT (JSONWEBTOKEN)');
    });
});
