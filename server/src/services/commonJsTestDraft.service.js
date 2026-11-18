import path from 'node:path';
import { builtinModules } from 'node:module';
import traverseModule from '@babel/traverse';
import { parseJavaScriptCode } from './babelParser.service.js';

const traverse = traverseModule.default || traverseModule;
const NODE_BUILTINS = new Set([
    ...builtinModules,
    ...builtinModules.map(m => (m.startsWith('node:') ? m.slice(5) : `node:${m}`)),
]);

function relativeImport(testFile, sourceFile) {
    const specifier = path.posix.relative(path.posix.dirname(testFile), sourceFile);
    return JSON.stringify(specifier.startsWith('.') ? specifier : './' + specifier);
}

function walkNode(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const k of Object.keys(node)) {
        if (['loc', 'comments', 'leadingComments', 'trailingComments'].includes(k)) continue;
        const child = node[k];
        if (Array.isArray(child)) {
            for (const c of child) walkNode(c, visit);
        } else if (child && typeof child === 'object' && child.type) {
            walkNode(child, visit);
        }
    }
}

function unwrapTopLevelCallExpr(expr) {
    let cur = expr;
    while (cur) {
        if (cur.type === 'AwaitExpression' || (cur.type === 'UnaryExpression' && cur.operator === 'void')) {
            cur = cur.argument;
            continue;
        }
        if (cur.type === 'CallExpression' && cur.callee?.type === 'MemberExpression' &&
            ['then', 'catch', 'finally'].includes(cur.callee.property?.name)) {
            cur = cur.callee.object;
            continue;
        }
        break;
    }
    return cur;
}

function nodeCallsProcessExit(node) {
    let found = false;
    walkNode(node, n => {
        if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' &&
            !n.callee.computed && n.callee.object?.name === 'process' &&
            ['exit', 'abort'].includes(n.callee.property?.name)) {
            found = true;
        }
    });
    return found;
}

export function isImportTimeProcessExitScript(sourceCode = '') {
    if (!sourceCode || typeof sourceCode !== 'string') return false;
    const parsed = parseJavaScriptCode(sourceCode);
    if (!parsed.success || !parsed.ast) return false;
    const body = parsed.ast.program.body || [];
    const topLevelFns = new Map();
    for (const stmt of body) {
        if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
            topLevelFns.set(stmt.id.name, stmt);
        } else if (stmt.type === 'VariableDeclaration') {
            for (const d of stmt.declarations || []) {
                if (d.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(d.init?.type)) {
                    topLevelFns.set(d.id.name, d.init);
                }
            }
        }
    }
    for (const stmt of body) {
        if (stmt.type !== 'ExpressionStatement') continue;
        if (nodeCallsProcessExit(stmt.expression)) return true;
        const call = unwrapTopLevelCallExpr(stmt.expression);
        if (call?.type === 'CallExpression') {
            if (['ArrowFunctionExpression', 'FunctionExpression'].includes(call.callee?.type) && nodeCallsProcessExit(call.callee.body)) {
                return true;
            }
            if (call.callee?.type === 'Identifier' && topLevelFns.has(call.callee.name)) {
                if (nodeCallsProcessExit(topLevelFns.get(call.callee.name))) return true;
            }
        }
    }
    return false;
}

export function proposeImportTimeExitScriptDraft({ sourceCode, sourceFile, testFile, framework = 'jest', original = '' } = {}) {
    if (original?.trim() || !sourceCode || !sourceFile || !testFile) return null;
    if (/^\s*(?:import\s+|export\s+)/m.test(sourceCode)) return null;
    if (!isImportTimeProcessExitScript(sourceCode)) return null;

    const parsed = parseJavaScriptCode(sourceCode);
    if (!parsed.success || !parsed.ast) return null;

    const vitest = framework === 'vitest';
    const runner = vitest ? 'vi' : 'jest';
    const cleanSrc = sourceFile.replace(/\\/g, '/');
    const cleanTest = testFile.replace(/\\/g, '/');
    const source = relativeImport(cleanTest, cleanSrc);
    const setup = vitest ? `import { createRequire } from 'node:module';
import { test, expect, vi } from 'vitest';

const require = createRequire(import.meta.url);
` : '';

    // Collect require(...) bindings, member accesses, direct calls, and process.env keys
    const requiresBySpecifier = new Map(); // specifier -> { specifier, isBuiltin, bindings: Map<localName, { kind, importedProp? }>, props: Set<string>, directCalled: boolean, constructed: boolean, memberSubProps: Map<string, Set<string>> }
    const bindingToSpecifier = new Map(); // localName -> { specifier, importedProp? }
    const envKeys = new Set();
    let hasTryCatch = false;

    const ensureReq = (specifier) => {
        if (!requiresBySpecifier.has(specifier)) {
            requiresBySpecifier.set(specifier, {
                specifier,
                isBuiltin: NODE_BUILTINS.has(specifier),
                bindings: new Map(),
                props: new Set(),
                memberSubProps: new Map(),
                directCalled: false,
                constructed: false,
            });
        }
        return requiresBySpecifier.get(specifier);
    };

    traverse(parsed.ast, {
        VariableDeclarator(p) {
            const init = p.node.init;
            if (init?.type !== 'CallExpression' || init.callee?.name !== 'require' || init.arguments?.[0]?.type !== 'StringLiteral') return;
            const spec = init.arguments[0].value;
            const info = ensureReq(spec);
            if (p.node.id?.type === 'Identifier') {
                info.bindings.set(p.node.id.name, { kind: 'whole' });
                bindingToSpecifier.set(p.node.id.name, { specifier: spec, importedProp: null });
            } else if (p.node.id?.type === 'ObjectPattern') {
                for (const prop of p.node.id.properties || []) {
                    if (prop.type !== 'ObjectProperty') continue;
                    const keyName = prop.key?.name || prop.key?.value;
                    const localName = prop.value?.type === 'Identifier' ? prop.value.name : keyName;
                    if (keyName && localName) {
                        info.bindings.set(localName, { kind: 'named', importedProp: keyName });
                        info.props.add(keyName);
                        bindingToSpecifier.set(localName, { specifier: spec, importedProp: keyName });
                    }
                }
            }
        },
        MemberExpression(p) {
            const { object, property, computed } = p.node;
            if (computed) return;
            if (object?.type === 'MemberExpression' && !object.computed &&
                object.object?.name === 'process' && object.property?.name === 'env' && property?.name) {
                envKeys.add(property.name);
            }
            if (object?.type === 'Identifier' && bindingToSpecifier.has(object.name) && property?.name) {
                const { specifier, importedProp } = bindingToSpecifier.get(object.name);
                const info = requiresBySpecifier.get(specifier);
                if (importedProp) {
                    if (!info.memberSubProps.has(importedProp)) info.memberSubProps.set(importedProp, new Set());
                    info.memberSubProps.get(importedProp).add(property.name);
                } else {
                    info.props.add(property.name);
                    if (p.parent?.type === 'MemberExpression' && !p.parent.computed && p.parent.object === p.node && p.parent.property?.name) {
                        if (!info.memberSubProps.has(property.name)) info.memberSubProps.set(property.name, new Set());
                        info.memberSubProps.get(property.name).add(p.parent.property.name);
                    }
                }
            }
        },
        CallExpression(p) {
            if (p.node.callee?.type === 'Identifier' && bindingToSpecifier.has(p.node.callee.name)) {
                const { specifier } = bindingToSpecifier.get(p.node.callee.name);
                requiresBySpecifier.get(specifier).directCalled = true;
            }
        },
        NewExpression(p) {
            if (p.node.callee?.type === 'Identifier' && bindingToSpecifier.has(p.node.callee.name)) {
                const { specifier } = bindingToSpecifier.get(p.node.callee.name);
                requiresBySpecifier.get(specifier).constructed = true;
            }
        },
        TryStatement() {
            hasTryCatch = true;
        },
    });

    const fromScript = specifier => {
        if (!specifier.startsWith('.')) return JSON.stringify(specifier);
        return relativeImport(cleanTest, path.posix.join(path.posix.dirname(cleanSrc), specifier));
    };

    const buildStubMethodExpr = (prop, varIdx) => {
        if (prop === 'connect' || prop === 'connectDB' || prop === 'disconnect') {
            return `${runner}.fn().mockResolvedValue(undefined)`;
        }
        if (prop === 'findOne' || prop === 'exists') {
            return `findOneFn`;
        }
        if (prop === 'find' || prop === 'aggregate') {
            return `${runner}.fn().mockResolvedValue([])`;
        }
        if (prop === 'create' || prop === 'insertMany' || prop === 'insertOne' || prop === 'save') {
            return `writeFn`;
        }
        if (prop === 'deleteMany' || prop === 'deleteOne') {
            return `${runner}.fn().mockResolvedValue({ deletedCount: 1 })`;
        }
        if (prop === 'hash' || prop === 'genSalt') {
            return `hashFn`;
        }
        if (prop === 'compare') {
            return `${runner}.fn().mockResolvedValue(true)`;
        }
        if (prop === 'config') {
            return `${runner}.fn()`;
        }
        if (prop === 'Schema') {
            return `class MockSchema { constructor() {} index() { return this; } pre() { return this; } post() { return this; } static Types = { ObjectId: class ObjectId { constructor(v) { this.value = v; } } }; }`;
        }
        if (prop === 'Types') {
            return `{ ObjectId: class ObjectId { constructor(v) { this.value = v; } } }`;
        }
        return `${runner}.fn().mockResolvedValue({ id: 'mock-id-${varIdx}' })`;
    };

    const cacheEntries = [];
    const builtinSpies = [];
    let hasConnect = false;
    let hasFindOne = false;
    let hasWrite = false;
    let hasHash = false;
    let depCounter = 0;

    for (const info of requiresBySpecifier.values()) {
        if (info.props.has('connect') || info.props.has('connectDB')) hasConnect = true;
        if (info.props.has('findOne') || info.props.has('exists')) hasFindOne = true;
        if (info.props.has('create') || info.props.has('insertMany') || info.props.has('insertOne') || info.props.has('save')) hasWrite = true;
        if (info.props.has('hash')) hasHash = true;

        if (info.isBuiltin) {
            for (const prop of info.props) {
                builtinSpies.push([info.specifier, prop]);
            }
            continue;
        }

        const modExpr = fromScript(info.specifier);
        const propEntries = [];
        for (const prop of info.props) {
            depCounter++;
            if (info.memberSubProps.has(prop) && prop !== 'Types') {
                const subEntries = [...info.memberSubProps.get(prop)].map(sp => `${sp}: ${buildStubMethodExpr(sp, depCounter)}`);
                propEntries.push(`${prop}: { ${subEntries.join(', ')} }`);
            } else {
                propEntries.push(`${prop}: ${buildStubMethodExpr(prop, depCounter)}`);
            }
        }
        let exportsExpr = `{ ${propEntries.join(', ')} }`;
        if (info.directCalled || info.constructed) {
            exportsExpr = `Object.assign(${runner}.fn(function () { return { ${propEntries.join(', ')} }; }), { ${propEntries.join(', ')} })`;
        }
        cacheEntries.push([modExpr, exportsExpr]);
    }

    const envKeysArr = [...envKeys];
    const envBackup = envKeysArr.length
        ? `    const prevEnv = { ${envKeysArr.map(k => `${JSON.stringify(k)}: process.env[${JSON.stringify(k)}]`).join(', ')} };\n` +
          envKeysArr.map(k => `    process.env[${JSON.stringify(k)}] = process.env[${JSON.stringify(k)}] || 'test-value';`).join('\n') + '\n'
        : '';
    const envRestore = envKeysArr.length
        ? envKeysArr.map(k => `        if (prevEnv[${JSON.stringify(k)}] === undefined) delete process.env[${JSON.stringify(k)}]; else process.env[${JSON.stringify(k)}] = prevEnv[${JSON.stringify(k)}];`).join('\n') + '\n'
        : '';

    const mockSetup = vitest ? `    const script = require.resolve(${source});
    const replacements = [
${cacheEntries.map(([spec, ex]) => `        [require.resolve(${spec}), ${ex}],`).join('\n')}
    ];
    const previous = [script, ...replacements.map(([id]) => id)].map(id => [id, require.cache[id]]);
    for (const [id, exports] of replacements) require.cache[id] = { id, filename: id, loaded: true, exports };
    delete require.cache[script];
` : `    jest.resetModules();
${cacheEntries.map(([spec, ex]) => `    jest.doMock(${spec}, () => (${ex}));`).join('\n')}
`;
    const builtinSetup = builtinSpies.map(([spec, prop], i) =>
        `    const builtinSpy${i} = ${runner}.spyOn(require(${JSON.stringify(spec)}), ${JSON.stringify(prop)}).mockImplementation(${runner}.fn());`
    ).join('\n') + (builtinSpies.length ? '\n' : '');
    const builtinRestore = builtinSpies.map((_, i) => `        builtinSpy${i}.mockRestore();`).join('\n') + (builtinSpies.length ? '\n' : '');

    const cleanup = vitest ? `        for (const [id, entry] of previous) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
        }
` : `${cacheEntries.map(([spec]) => `        jest.dontMock(${spec});`).join('\n')}${cacheEntries.length ? '\n' : ''}        jest.resetModules();
`;

    const variants = [['executes import-time script cleanly and intercepts process.exit', null]];
    if (hasFindOne && hasWrite) {
        variants.push(['creates record when existing lookup returns null', 'notFound']);
    }
    if (hasTryCatch && hasConnect) {
        variants.push(['exits with code 1 when database connection fails', 'connect']);
    }
    if (hasTryCatch && (hasWrite || hasHash)) {
        variants.push(['exits with code 1 when persistence operation fails', 'write']);
    }

    const bodyCode = variants.map(([title, mode]) => {
        const overrides = [];
        if (mode === 'notFound') overrides.push(`    findOneFn.mockResolvedValueOnce(null);`);
        if (mode === 'connect') overrides.push(`    connectErr = true;`);
        if (mode === 'write') overrides.push(`    writeFn.mockRejectedValueOnce(new Error('write failed'));`);

        return `
test(${JSON.stringify(title)}, async () => {
    let connectErr = false;
    const findOneFn = ${runner}.fn().mockResolvedValue(${mode === 'notFound' ? 'null' : "{ _id: '507f1f77bcf86cd799439011' }"});
    const writeFn = ${runner}.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' });
    const hashFn = ${runner}.fn().mockResolvedValue('hashed-secret');
${overrides.join('\n')}${overrides.length ? '\n' : ''}${envBackup}${mockSetup.replaceAll(`${runner}.fn().mockResolvedValue(undefined)`, `${runner}.fn(() => connectErr ? Promise.reject(new Error('connect failed')) : Promise.resolve(undefined))`)}${builtinSetup}    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const exit = ${runner}.spyOn(process, 'exit').mockImplementation(code => { finish(code); });
    const fallbackTimer = setTimeout(() => finish(undefined), 50);
    try {
        require(${source});
        const exitCode = await completed;
        expect(exit).toHaveBeenCalled();
        ${mode === 'connect' || mode === 'write' ? 'expect(exitCode).toBe(1);' : 'expect([0, 1, undefined]).toContain(exitCode);'}
    } finally {
        clearTimeout(fallbackTimer);
        exit.mockRestore();
${builtinRestore}${envRestore}${cleanup}    }
});`;
    }).join('\n');

    return {
        explanation: 'Isolate import-time CommonJS dependencies and intercept process.exit before loading the script.',
        fullUpdatedContent: setup + bodyCode.trimStart() + '\n',
    };
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
        !/\n(?:order|payment|category|admin)Seeding\(\w+\)\s*;?\s*$/.test(sourceCode) ||
        !sourceCode.includes('process.exit(0)') || !sourceCode.includes('process.exit(1)')) {
        return proposeImportTimeExitScriptDraft({ sourceCode, sourceFile, testFile, framework, original });
    }

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
