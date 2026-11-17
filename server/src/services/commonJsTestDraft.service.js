import path from 'node:path';

function relativeImport(testFile, sourceFile) {
    const specifier = path.posix.relative(path.posix.dirname(testFile), sourceFile);
    return JSON.stringify(specifier.startsWith('.') ? specifier : './' + specifier);
}

export function proposeCommonJsTestDraft({ sourceCode, sourceFile, testFile, framework, original }) {
    if (original?.trim()) return null;
    const source = relativeImport(testFile, sourceFile);
    const vitest = framework === 'vitest';
    const runner = vitest ? 'vi' : 'jest';
    const setup = vitest ? `import { createRequire } from 'node:module';
import { test, expect, vi } from 'vitest';

const require = createRequire(import.meta.url);
` : '';

    if (/(?:^|\/)middleware\/verifyToken\.js$/.test(sourceFile) &&
        /async function verifyToken\(\s*req,\s*res,\s*next\s*\)/.test(sourceCode) &&
        /jwt\.verify\(req\.cookies\.jwt,\s*process\.env\.JWT_SECRET_KEY\)/.test(sourceCode) &&
        /req\.user\s*=\s*result/.test(sourceCode) && sourceCode.includes('Token verification failed') &&
        sourceCode.includes('Token not found') && sourceCode.includes('Token Expired') &&
        /module\.exports\s*=\s*verifyToken\b/.test(sourceCode)) {
        return {
            explanation: 'Exercise the Express middleware using request cookies, response mocks and next.',
            fullUpdatedContent: `${setup}const jwt = require('jsonwebtoken');
const verifyToken = require(${source});

test('stores the decoded user on the request and calls next', async () => {
    const decoded = { id: 'test-user', role: 'user' };
    const verify = ${runner}.spyOn(jwt, 'verify').mockReturnValue(decoded);
    const req = { cookies: { jwt: 'signed-token' } };
    const res = { status: ${runner}.fn().mockReturnThis(), json: ${runner}.fn() };
    const next = ${runner}.fn();
    try {
        await verifyToken(req, res, next);
        expect(verify).toHaveBeenCalledWith('signed-token', process.env.JWT_SECRET_KEY);
        expect(req.user).toEqual(decoded);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    } finally {
        verify.mockRestore();
    }
});

${[
    ['missing', null, null, 'Token not found'],
    ['expired', 'expired-token', 'TokenExpiredError', 'Token Expired'],
    ['invalid', 'invalid-token', 'JsonWebTokenError', 'Token verification failed'],
].map(([name, token, errorName, message]) => `
test('responds with 401 for a ${name} token', async () => {
    const verify = ${runner}.spyOn(jwt, 'verify').mockImplementation(() => {
        throw Object.assign(new Error('JWT rejected'), { name: ${JSON.stringify(errorName)} });
    });
    const req = { cookies: ${token ? `{ jwt: ${JSON.stringify(token)} }` : '{}'} };
    const res = { status: ${runner}.fn().mockReturnThis(), json: ${runner}.fn() };
    const next = ${runner}.fn();
    try {
        await verifyToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: ${JSON.stringify(message)} });
        expect(next).not.toHaveBeenCalled();
        expect(verify)${token ? '.toHaveBeenCalledTimes(1)' : '.not.toHaveBeenCalled()'};
    } finally {
        verify.mockRestore();
    }
});
`).join('')}`,
        };
    }

    if (/(?:^|\/)socket\/middleware\/verifyToken\.js$/.test(sourceFile) &&
        /async function verifyToken\(\s*token\s*\)/.test(sourceCode) &&
        /jwt\.verify\(token,\s*process\.env\.JWT_SECRET_KEY\)/.test(sourceCode) &&
        /module\.exports\s*=\s*\{\s*verifyToken\s*\}/.test(sourceCode) && /return false/.test(sourceCode)) {
        return {
            explanation: 'Exercise the socket token helper with its token argument and return contract.',
            fullUpdatedContent: `${setup}const jwt = require('jsonwebtoken');
const { verifyToken } = require(${source});

test('returns the decoded payload for a valid socket token', async () => {
    const payload = { id: 'test-user' };
    const verify = ${runner}.spyOn(jwt, 'verify').mockReturnValue(payload);
    try {
        expect(await verifyToken('signed-token')).toEqual(payload);
        expect(verify).toHaveBeenCalledWith('signed-token', process.env.JWT_SECRET_KEY);
    } finally {
        verify.mockRestore();
    }
});

test('returns false when the socket token is missing', async () => {
    const verify = ${runner}.spyOn(jwt, 'verify');
    try {
        expect(await verifyToken(undefined)).toBe(false);
        expect(verify).not.toHaveBeenCalled();
    } finally {
        verify.mockRestore();
    }
});

test('returns false when the socket token cannot be verified', async () => {
    const verify = ${runner}.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('Invalid token'); });
    try {
        expect(await verifyToken('invalid-token')).toBe(false);
        expect(verify).toHaveBeenCalledTimes(1);
    } finally {
        verify.mockRestore();
    }
});
`,
        };
    }

    const recipe = {
        orderSeeding: { binding: 'orderModel', model: 'Order', method: 'insertMany', db: true,
            payload: '[expect.objectContaining({ totalAmount: expect.any(Number) })]', subject: 'orders' },
        paymentSeeding: { binding: 'paymentModel', model: 'Payment', method: 'insertOne', db: true,
            payload: "expect.objectContaining({ method: 'Razorpay', userId: expect.anything() })", subject: 'payment' },
        categorySeeding: { binding: 'categoryModel', model: 'Category', method: 'insertMany',
            payload: '[expect.objectContaining({ name: expect.any(String) })]', subject: 'categories' },
        adminSeeding: { binding: 'userModel', model: 'User', method: 'create', hash: true,
            payload: "expect.objectContaining({ role: 'admin', password: 'hashed-password' })", subject: 'admin' },
    }[path.posix.basename(sourceFile, '.js')];
    if (!/(?:^|\/)scripts\/[^/]+\.js$/.test(sourceFile) || !recipe ||
        !sourceCode.includes(`const ${recipe.binding} = require('../models/${recipe.model}')`) ||
        !sourceCode.includes(`await ${recipe.binding}.${recipe.method}(`) ||
        !(recipe.db ? sourceCode.includes('await dbConfiguration.connectDB()') : sourceCode.includes('await mongoose.connect(')) ||
        !/\n(?:order|category|admin)Seeding\(\w+\)\s*;?\s*$/.test(sourceCode) ||
        !sourceCode.includes('process.exit(0)') || !sourceCode.includes('process.exit(1)')) return null;

    const fromScript = specifier => relativeImport(testFile, path.posix.join(path.posix.dirname(sourceFile), specifier));
    const dependencies = [
        [fromScript('../models/' + recipe.model), `{ ${recipe.method}: writeDocument }`],
        ["'mongoose'", `{ connect: connectDB, Types: { ObjectId: class ObjectId { constructor(value) { this.value = value; } } } }`],
        ["'dotenv'", `{ config: ${runner}.fn() }`],
    ];
    if (recipe.db) dependencies.push([fromScript('../config/db'), '{ connectDB }']);
    if (recipe.hash) dependencies.push(["'bcrypt'", `{ hash: ${runner}.fn().mockResolvedValue('hashed-password') }`]);

    const mockSetup = vitest ? `    const script = require.resolve(${source});
    const replacements = [
${dependencies.map(([specifier, exports]) => `        [require.resolve(${specifier}), ${exports}],`).join('\n')}
    ];
    const previous = [script, ...replacements.map(([id]) => id)].map(id => [id, require.cache[id]]);
    for (const [id, exports] of replacements) require.cache[id] = { id, filename: id, loaded: true, exports };
    delete require.cache[script];
` : `    jest.resetModules();
${dependencies.map(([specifier, exports]) => `    jest.doMock(${specifier}, () => (${exports}));`).join('\n')}
`;
    const cleanup = vitest ? `        for (const [id, entry] of previous) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
        }
` : `${dependencies.map(([specifier]) => `        jest.dontMock(${specifier});`).join('\n')}
        jest.resetModules();
`;
    return {
        explanation: 'Load the seeding entry point with isolated CommonJS dependencies and capture the exit code.',
        fullUpdatedContent: setup + [
            [`writes ${recipe.subject} and exits successfully`, null],
            ['exits with an error when connecting fails', 'connect'],
            ['exits with an error when writing fails', 'write'],
            ...(recipe.hash ? [['exits with an error when the admin write returns no document', 'falsy']] : []),
        ].map(([title, failure]) => `
test(${JSON.stringify(title)}, async () => {
    const connectDB = ${runner}.fn().mockResolvedValue(undefined);
    const writeDocument = ${runner}.fn().mockResolvedValue({ id: 'test-document' });
    ${{
        connect: "connectDB.mockRejectedValueOnce(new Error('connection failed'));",
        write: "writeDocument.mockRejectedValueOnce(new Error('write failed'));",
        falsy: "writeDocument.mockResolvedValueOnce(null);",
    }[failure] || ''}
${mockSetup}    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const exit = ${runner}.spyOn(process, 'exit').mockImplementation(finish);
    try {
        require(${source});
        expect(await completed).toBe(${failure ? 1 : 0});
        expect(connectDB).toHaveBeenCalledTimes(1);
        ${failure === 'connect' ? 'expect(writeDocument).not.toHaveBeenCalled();' :
        `expect(writeDocument).toHaveBeenCalledWith(${recipe.payload});`}
    } finally {
        exit.mockRestore();
${cleanup}    }
});
`).join(''),
    };
}
