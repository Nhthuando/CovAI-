import path from 'node:path';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;
const moduleBodies = new WeakMap();
const wrappers = new Set(['AwaitExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSInstantiationExpression', 'ParenthesizedExpression', 'TypeCastExpression']);
const builtIns = new Set(['length', 'map', 'then', 'toString', 'hasOwnProperty', 'filter', 'slice', 'constructor', 'valueOf', 'catch', 'finally', 'toLocaleString', 'isPrototypeOf', 'propertyIsEnumerable', '__proto__']);
const replyKeys = ['reply', 'answer', 'botReply', 'aiResponse', 'assistantMessage', 'response', 'output', 'completion', 'message', 'text', 'content', 'result', 'data'];
const weakReplyKeys = new Set(['message', 'result', 'data']);
const ignoredReplyKeys = new Set(['error', 'success', 'status', 'code', 'model', 'id', 'sessionId', 'conversationId', 'role', 'timestamp', 'usage', 'history', 'messages', 'sources', 'citations']);
const historyKeys = new Set(['history', 'conversationHistory', 'chatHistory', 'chat_history', 'previousMessages', 'pastMessages', 'conversation', 'pastConversation', 'chatLog', 'prevMessages']);
const failure = Symbol('failure');

export function resolveRelativeSource(filePath, source, files) {
    if (!source?.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), source));
    const extensions = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '/index.js', '/index.ts', '/index.mjs'];
    const candidates = [base, ...extensions.map(ext => base + ext)];
    if (base.endsWith('.js')) candidates.splice(1, 0, base.slice(0, -3) + '.ts');
    return candidates.find(candidate => files.has(candidate)) || null;
}

function unwrap(p) {
    while (wrappers.has(p?.node?.type)) p = p.get(p.isAwaitExpression() ? 'argument' : 'expression');
    return p;
}

function nameOf(node, computed = false) {
    if (!computed && node?.type === 'Identifier') return node.name;
    return node?.type === 'StringLiteral' || node?.type === 'NumericLiteral' ? String(node.value) : null;
}

function isMember(p) {
    return p?.isMemberExpression() || p?.isOptionalMemberExpression();
}

function isCall(p) {
    return p?.isCallExpression() || p?.isOptionalCallExpression();
}

function memberName(p) {
    return isMember(p) ? nameOf(p.node.property, p.node.computed) : null;
}

function propertyName(p) {
    return nameOf(p.node.key, p.node.computed);
}

function patternBinding(pattern, name) {
    if (pattern.isAssignmentPattern()) pattern = pattern.get('left');
    if (pattern.isIdentifier({ name })) return [];
    if (!pattern.isObjectPattern()) return null;
    for (const prop of pattern.get('properties')) {
        if (!prop.isObjectProperty()) continue;
        const key = propertyName(prop);
        const nested = key === null ? null : patternBinding(prop.get('value'), name);
        if (nested) return [key, ...nested];
    }
    return null;
}

function programBody(file) {
    if (!file?.ast) return [];
    if (!moduleBodies.has(file)) {
        traverse(file.ast, {
            Program(p) {
                moduleBodies.set(file, p.get('body'));
                p.stop();
            },
        });
    }
    return moduleBodies.get(file) || [];
}

function exportedValues(file, name) {
    const values = [];
    for (const statement of programBody(file)) {
        if (statement.isExportDefaultDeclaration() && name === 'default') {
            values.push({ value: statement.get('declaration') });
        } else if (statement.isExportNamedDeclaration()) {
            const declaration = statement.get('declaration');
            if (declaration.node?.id?.name === name) values.push({ value: declaration });
            if (declaration.isVariableDeclaration()) {
                for (const item of declaration.get('declarations')) {
                    const keys = patternBinding(item.get('id'), name);
                    if (keys) values.push({ value: item.get('init'), keys });
                }
            }
            for (const spec of statement.get('specifiers')) {
                if (nameOf(spec.node.exported) !== name) continue;
                if (statement.node.source) values.push({ source: statement.node.source.value, name: spec.isExportNamespaceSpecifier() ? '*' : nameOf(spec.node.local) });
                else values.push({ value: spec.get('local') });
            }
        } else if (statement.isExpressionStatement()) {
            const expression = statement.get('expression');
            if (!expression.isAssignmentExpression({ operator: '=' })) continue;
            const left = expression.get('left');
            if (!isMember(left)) continue;
            const object = left.get('object');
            const moduleExports = p => memberName(p) === 'exports' && p.get('object').isIdentifier({ name: 'module' });
            if (memberName(left) === name && (object.isIdentifier({ name: 'exports' }) || moduleExports(object))) {
                values.push({ value: expression.get('right') });
            } else if (moduleExports(left)) {
                values.push({ value: expression.get('right'), keys: name === 'default' ? [] : [name] });
            }
        }
    }
    return values;
}

function createResolver(modules, functionsOnly) {
    const active = new Set();

    function fromExport(file, name, keys, depth, instance = false) {
        if (!file || !name || depth > 8) return null;
        if (name === '*') return fromExport(file, keys[0], keys.slice(1), depth, instance);
        const marker = JSON.stringify([file.path, name, keys]);
        if (active.has(marker)) return null;
        active.add(marker);
        try {
            for (const item of exportedValues(file, name)) {
                const found = item.source
                    ? fromExport(modules.get(resolveRelativeSource(file.path, item.source, modules)), item.name, keys, depth + 1, instance)
                    : resolve(item.value, file, [...(item.keys || []), ...keys], depth, instance);
                if (found) return found;
            }
            return null;
        } finally {
            active.delete(marker);
        }
    }

    function resolve(p, file, keys = [], depth = 0, instance = false) {
        p = unwrap(p);
        if (!p?.node || depth > 8 || active.has(p.node)) return null;
        active.add(p.node);
        try {
            const next = (value, remaining = keys, asInstance = instance) => resolve(value, file, remaining, depth + 1, asInstance);
            if (!keys.length && p.isFunction()) return { path: p, file };
            if (p.isIdentifier()) {
                const binding = p.scope.getBinding(p.node.name)?.path;
                if (binding?.isVariableDeclarator()) {
                    const props = patternBinding(binding.get('id'), p.node.name);
                    return props ? next(binding.get('init'), [...props, ...keys]) : null;
                }
                if (binding?.isFunctionDeclaration() || binding?.isClassDeclaration()) return next(binding);
                if (!binding || binding.isImportSpecifier() || binding.isImportDefaultSpecifier() || binding.isImportNamespaceSpecifier()) {
                    const imported = file.imports.get(p.node.name);
                    if (imported) return fromExport(modules.get(resolveRelativeSource(file.path, imported.source, modules)), imported.imported, keys, depth + 1, instance);
                }
            } else if (isMember(p)) {
                const name = memberName(p);
                if (name !== null) return next(p.get('object'), [name, ...keys]);
            } else if (p.isThisExpression()) {
                const owner = p.findParent(parent => parent.isClass());
                const method = p.findParent(parent => parent.isClassMethod() || parent.isClassProperty());
                return next(owner, keys, !method?.node.static);
            } else if (p.isNewExpression() && keys.length) {
                return next(p.get('callee'), keys, true);
            } else if (p.isClass() && keys.length) {
                const matches = p.get('body.body').filter(item => (item.isClassMethod() || item.isClassProperty()) && propertyName(item) === keys[0]);
                matches.sort((a, b) => Number(Boolean(a.node.static) === instance) - Number(Boolean(b.node.static) === instance));
                for (const item of matches) {
                    const found = next(item.isClassMethod() ? item : item.get('value'), keys.slice(1), false);
                    if (found) return found;
                }
            } else if (p.isObjectExpression() && keys.length) {
                for (const prop of p.get('properties').reverse()) {
                    if (prop.isSpreadElement()) {
                        const found = next(prop.get('argument'));
                        if (found) return found;
                    } else if (propertyName(prop) === keys[0]) {
                        return next(prop.isObjectMethod() ? prop : prop.get('value'), keys.slice(1));
                    }
                }
            } else if (isCall(p)) {
                const callee = p.get('callee');
                const args = p.get('arguments');
                if (callee.isIdentifier({ name: 'require' }) && args[0]?.isStringLiteral()) {
                    const source = modules.get(resolveRelativeSource(file.path, args[0].node.value, modules));
                    return (keys.length && fromExport(source, keys[0], keys.slice(1), depth + 1, instance))
                        || fromExport(source, 'default', keys, depth + 1, instance);
                }
                if (functionsOnly) {
                    if (memberName(callee) === 'bind') return next(callee.get('object'));
                    for (const arg of args) {
                        const found = next(arg);
                        if (found) return found;
                    }
                }
            } else if (p.isArrayExpression() && functionsOnly) {
                for (const item of p.get('elements').reverse()) {
                    const found = next(item);
                    if (found) return found;
                }
            }
            return !functionsOnly && !keys.length ? { path: p, file } : null;
        } finally {
            active.delete(p.node);
        }
    }

    return { resolve, fromExport };
}

export function resolveFunction(exprPath, file, modules) {
    try {
        return createResolver(modules, true).resolve(exprPath, file);
    } catch {
        return null;
    }
}

export function resolveModuleFunction(file, name, modules) {
    try {
        return createResolver(modules, true).fromExport(file, name, [], 0);
    } catch {
        return null;
    }
}

export function resolveValue(exprPath, file, modules) {
    try {
        return createResolver(modules, false).resolve(exprPath, file);
    } catch {
        return null;
    }
}

function walkFunction(fn, visitors) {
    fn.traverse({ Function(p) { p.skip(); }, ...visitors });
}

function callName(p) {
    return isCall(p) ? memberName(p.get('callee')) : null;
}

function callsMember(p, object, method) {
    return callName(p) === method && p.get('callee.object').isIdentifier({ name: object });
}

function trackedReference(p, parameters, active = new Set()) {
    p = unwrap(p);
    if (!p?.node || active.has(p.node)) return null;
    active.add(p.node);
    try {
        const read = other => trackedReference(other, parameters, active);
        if (p.isIdentifier()) {
            const binding = p.scope.getBinding(p.node.name);
            if (parameters.has(binding?.identifier)) return parameters.get(binding.identifier);
            if (!binding?.path.isVariableDeclarator()) return null;
            const keys = patternBinding(binding.path.get('id'), p.node.name);
            let value = read(binding.path.get('init'));
            for (const key of keys || []) value = trackedProperty(value, key);
            return keys ? value : null;
        }
        if (isMember(p) && !p.node.computed) return trackedProperty(read(p.get('object')), memberName(p));
        if (p.isLogicalExpression() && ['||', '??'].includes(p.node.operator)
            && p.get('right').isObjectExpression() && !p.node.right.properties.length) return read(p.get('left'));
        if (p.isObjectExpression() && p.get('properties').some(prop => prop.isSpreadElement() && read(prop.get('argument'))?.kind === 'body')) {
            return { kind: 'body' };
        }
        if (isCall(p)) {
            const args = p.get('arguments');
            const method = callName(p);
            if (method === 'json' && read(p.get('callee.object'))?.kind === 'request') return { kind: 'body' };
            if (callsMember(p, 'Object', 'assign') && args[0]?.isObjectExpression() && !args[0].node.properties.length
                && args.slice(1).some(arg => read(arg)?.kind === 'body')) return { kind: 'body' };
            if (['parse', 'parseAsync', 'safeParse'].includes(method) && read(args[0])?.kind === 'body') {
                return { kind: method === 'safeParse' ? 'parseResult' : 'body' };
            }
        }
        return null;
    } finally {
        active.delete(p.node);
    }
}

function trackedProperty(reference, key) {
    if (reference?.kind === 'body' && key && !builtIns.has(key)) return { kind: 'field', field: key };
    if (key === 'body' || (key === 'data' && reference?.kind === 'parseResult')) return { kind: 'body' };
    if (key === 'req' && reference?.kind === 'request') return { kind: 'request' };
    return null;
}

function registerPattern(pattern, reference, parameters, fields, defaults, hasDefault = false) {
    if (!reference || !pattern?.node) return;
    if (pattern.isAssignmentPattern()) {
        registerPattern(pattern.get('left'), reference, parameters, fields, defaults, true);
        return;
    }
    if (reference.kind === 'field') {
        fields.add(reference.field);
        if (hasDefault) defaults.add(reference.field);
    }
    if (pattern.isIdentifier()) {
        parameters.set(pattern.node, reference);
    } else if (pattern.isObjectPattern() && reference.kind !== 'field') {
        for (const prop of pattern.get('properties')) {
            if (!prop.isObjectProperty()) continue;
            registerPattern(prop.get('value'), trackedProperty(reference, propertyName(prop)), parameters, fields, defaults);
        }
    }
}

function statusCode(p) {
    const arg = p.get('arguments')[0];
    return arg?.isNumericLiteral() ? arg.node.value : null;
}

function responseOptionStatus(options) {
    if (!options?.isObjectExpression()) return null;
    const status = options.get('properties').find(prop => prop.isObjectProperty() && propertyName(prop) === 'status');
    return status?.get('value').isNumericLiteral() ? status.node.value.value : null;
}

function rejectsRequest(consequent) {
    let rejects = consequent.isThrowStatement();
    let returnsBadRequest = false;
    function checkReturn(p) {
        const arg = p.get('argument');
        const checkStatus = call => {
            const method = callName(call);
            let code;
            if (method === 'status' || method === 'code') code = statusCode(call);
            else if (callsMember(call, 'NextResponse', 'json') || callsMember(call, 'Response', 'json')
                || (call.isNewExpression() && call.get('callee').isIdentifier({ name: 'Response' }))) {
                code = responseOptionStatus(call.get('arguments')[1]);
            }
            if (code >= 400 && code < 500) rejects = true;
            if (method === 'status' && code === 400) returnsBadRequest = true;
        };
        if (!arg.node) return;
        checkStatus(arg);
        walkFunction(arg, { CallExpression: checkStatus, OptionalCallExpression: checkStatus, NewExpression: checkStatus });
    }
    if (consequent.isReturnStatement()) checkReturn(consequent);
    walkFunction(consequent, {
        ReturnStatement: checkReturn,
        ThrowStatement() { rejects = true; },
    });
    return { rejects, returnsBadRequest };
}

function negatedReferences(test) {
    if (test.isLogicalExpression() && ['||', '&&'].includes(test.node.operator)) {
        return [...negatedReferences(test.get('left')), ...negatedReferences(test.get('right'))];
    }
    return test.isUnaryExpression({ operator: '!' }) ? [unwrap(test.get('argument'))] : [];
}

function replyPointer(shape) {
    let level = [[shape, '']];
    let fallback = null;
    while (level.length) {
        const next = [];
        const leaves = new Map();
        for (const [object, prefix] of level) {
            if (!(object instanceof Map)) continue;
            for (const [key, value] of object) {
                if (value === failure || ignoredReplyKeys.has(key)) continue;
                const pointer = `${prefix}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
                if (value instanceof Map) next.push([value, pointer]);
                else if (!leaves.has(key)) leaves.set(key, pointer);
            }
        }
        for (const key of replyKeys) {
            if (!leaves.has(key)) continue;
            if (!weakReplyKeys.has(key)) return leaves.get(key);
            fallback ||= leaves.get(key);
        }
        level = next;
    }
    return fallback;
}

function returnedExpressions(fn) {
    const body = fn.get('body');
    if (!body.isBlockStatement()) return [body];
    const returns = [];
    walkFunction(fn, {
        CatchClause(p) { p.skip(); },
        ReturnStatement(p) { if (p.node.argument) returns.push(p.get('argument')); },
    });
    return returns;
}

function shapeOf(expression, file, modules, visit, depth = 0, active = new Set()) {
    const p = unwrap(expression);
    if (!p?.node || active.has(p.node)) return null;
    active.add(p.node);
    try {
        const shape = item => shapeOf(item, file, modules, visit, depth, active);
        if (p.isObjectExpression()) {
            const object = new Map();
            for (const prop of p.get('properties')) {
                if (prop.isSpreadElement()) {
                    const spread = shape(prop.get('argument'));
                    if (spread === failure) return failure;
                    if (spread instanceof Map) for (const [key, value] of spread) object.set(key, value);
                } else {
                    const key = propertyName(prop);
                    if (key === null) continue;
                    if (key === 'error' || (key === 'success' && prop.isObjectProperty() && unwrap(prop.get('value')).isBooleanLiteral({ value: false }))) return failure;
                    object.set(key, prop.isObjectProperty() ? shape(prop.get('value')) : null);
                }
            }
            return object;
        }
        if (p.isIdentifier()) {
            const binding = p.scope.getBinding(p.node.name)?.path;
            if (!binding?.isVariableDeclarator()) return null;
            const keys = patternBinding(binding.get('id'), p.node.name);
            let result = shape(binding.get('init'));
            for (const key of keys || []) result = memberShape(result, key);
            return result;
        }
        if (isMember(p)) return memberShape(shape(p.get('object')), memberName(p));
        if (isCall(p) && depth < 5) {
            const target = resolveFunction(p.get('callee'), file, modules);
            if (!target) return null;
            visit(target, -1, depth + 1);
            return firstReplyShape(returnedExpressions(target.path), item => shapeOf(item, target.file, modules, visit, depth + 1, active));
        }
        if (p.isConditionalExpression()) return firstReplyShape([p.get('consequent'), p.get('alternate')], shape);
        if (p.isLogicalExpression()) return firstReplyShape([p.get('left'), p.get('right')], shape);
        return null;
    } finally {
        active.delete(p.node);
    }
}

function memberShape(shape, key) {
    if (shape === failure) return failure;
    return shape instanceof Map ? shape.get(key) ?? null : null;
}

function firstReplyShape(expressions, shapeOfExpression) {
    let first;
    for (const expression of expressions) {
        const shape = shapeOfExpression(expression);
        if (replyPointer(shape)) return shape;
        if (shape !== failure && first === undefined) first = shape;
    }
    return first === undefined ? (expressions.length ? failure : null) : first;
}

function responsePayload(expression, handler) {
    const p = unwrap(expression);
    const isResponseConstructor = p.isNewExpression() && p.get('callee').isIdentifier({ name: 'Response' });
    if (!isCall(p) && !isResponseConstructor) return null;
    const [arg, options] = p.get('arguments');
    if (!arg?.node) return null;
    const method = callName(p);
    const receiver = isResponseConstructor ? p.get('callee') : p.get('callee.object');
    const isWebResponse = isResponseConstructor || receiver?.isIdentifier({ name: 'Response' }) || receiver?.isIdentifier({ name: 'NextResponse' });
    if (isWebResponse && responseOptionStatus(options) >= 400) return null;
    const status = ['status', 'code'].includes(callName(receiver)) ? receiver : null;
    if (status && (statusCode(status) < 200 || statusCode(status) >= 300)) return null;
    const root = status ? status.get('callee.object') : receiver;
    const rootName = root?.isIdentifier() && root.node.name;
    const responseParam = handler.get('params')[1];
    const isResponse = isWebResponse || ['res', 'reply', 'c'].includes(rootName)
        || (rootName && responseParam?.isIdentifier() && root.scope.getBinding(rootName)?.identifier === responseParam.node);
    if (!isResponse) return null;
    if (rootName === 'c' && options?.isNumericLiteral() && options.node.value >= 400) return null;
    if (['json', 'send'].includes(method)) return arg;
    if ((method === 'end' || isResponseConstructor) && callsMember(arg, 'JSON', 'stringify')) return arg.get('arguments')[0];
    return null;
}

function responseExpressions(handler) {
    const expressions = [];
    const addCall = p => {
        const payload = responsePayload(p, handler);
        if (payload?.node) expressions.push(payload);
    };
    const addReturn = p => {
        if (!p?.node) return;
        addCall(p);
        expressions.push(p);
    };
    if (!handler.get('body').isBlockStatement()) addReturn(handler.get('body'));
    walkFunction(handler, {
        CatchClause(p) { p.skip(); },
        ReturnStatement(p) { addReturn(p.get('argument')); },
        CallExpression: addCall,
        OptionalCallExpression: addCall,
        NewExpression: addCall,
        AssignmentExpression(p) {
            const left = p.get('left');
            if (memberName(left) === 'body' && left.get('object').isIdentifier({ name: 'ctx' })) expressions.push(p.get('right'));
        },
    });
    return expressions;
}

export function inferChatContract(handler, modules) {
    const fields = new Set();
    const defaults = new Set();
    const required = new Set();
    const legacyGuards = new Set();
    const visitedFiles = new Set();
    const visitedParams = new Map();
    const sources = new Set();
    const pending = [];
    const enqueue = (target, paramIndex, depth) => pending.push({ target, paramIndex, depth });
    let hasRawChatHistory = false;

    function visit(target, paramIndex, depth) {
        const { path: fn, file } = target;
        const seen = visitedParams.get(fn.node) || new Set();
        if (depth > 5 || seen.has(paramIndex)) return;
        const firstVisit = !seen.size;
        seen.add(paramIndex);
        visitedParams.set(fn.node, seen);
        visitedFiles.add(file.path);
        if (firstVisit) sources.add(file.content.slice(fn.node.start, fn.node.end));

        const parameters = new Map();
        const params = fn.get('params');
        if (fn.node === handler.path.node) registerPattern(params[0], { kind: 'request' }, parameters, fields, defaults);
        if (paramIndex >= 0) registerPattern(params[paramIndex], { kind: 'body' }, parameters, fields, defaults);
        const reference = p => trackedReference(p, parameters);
        const readMember = p => {
            if (p.node.computed || reference(p.get('object'))?.kind !== 'body') return;
            const key = memberName(p);
            if (key && !builtIns.has(key)) fields.add(key);
        };
        const readCall = p => {
            const args = p.get('arguments');
            const method = callName(p);
            if (method === 'startChat' && args[0]?.isObjectExpression()) {
                hasRawChatHistory ||= args[0].get('properties').some(prop => prop.isObjectProperty() && propertyName(prop) === 'history'
                    && historyKeys.has(reference(prop.get('value'))?.field));
            }
            if (['parse', 'parseAsync', 'safeParse'].includes(method) && reference(args[0])?.kind === 'body') {
                const schema = resolveValue(p.get('callee.object'), file, modules);
                for (const key of schemaFields(schema)) {
                    if (!builtIns.has(key)) fields.add(key);
                }
            }
            if (depth >= 5) return;
            const callee = resolveFunction(p.get('callee'), file, modules);
            if (!callee) return;
            let passedBody = false;
            for (const [i, arg] of args.entries()) {
                if (reference(arg)?.kind !== 'body') continue;
                passedBody = true;
                enqueue(callee, i, depth + 1);
            }
            if (!passedBody) enqueue(callee, -1, depth + 1);
        };
        walkFunction(fn, {
            VariableDeclarator(p) {
                if (p.get('id').isObjectPattern()) registerPattern(p.get('id'), reference(p.get('init')), parameters, fields, defaults);
            },
            MemberExpression: readMember,
            OptionalMemberExpression: readMember,
            CallExpression: readCall,
            OptionalCallExpression: readCall,
            IfStatement(p) {
                const test = p.get('test');
                const negations = negatedReferences(test);
                if (!negations.length) return;
                const { rejects, returnsBadRequest } = rejectsRequest(p.get('consequent'));
                if (!rejects) return;
                for (const arg of negations) {
                    const field = reference(arg)?.field;
                    if (field) required.add(field);
                    else if (returnsBadRequest && fn.node === handler.path.node && test.isUnaryExpression() && arg.isIdentifier()) legacyGuards.add(arg.node.name);
                }
            },
        });
    }

    enqueue(handler, -1, 0);
    let cursor = 0;
    const visitPending = () => {
        while (cursor < pending.length) {
            const { target, paramIndex, depth } = pending[cursor++];
            visit(target, paramIndex, depth);
        }
    };
    visitPending();
    let responsePointer = null;
    for (const expression of responseExpressions(handler.path)) {
        responsePointer = replyPointer(shapeOf(expression, handler.file, modules, enqueue));
        if (responsePointer) break;
    }
    visitPending();
    for (const field of legacyGuards) if (fields.has(field)) required.add(field);
    const usesAssistantRole = [...sources].some(source => /['"]assistant['"]/.test(source));
    const usesModelRole = [...sources].some(source => /\brole\s*={2,3}\s*(['"])model\1|(['"])model\2\s*={2,3}\s*(?:\w+\.)*role\b/.test(source));
    return {
        fields,
        required: [...required].filter(field => !defaults.has(field)),
        responsePointer,
        historyFormat: hasRawChatHistory ? 'gemini' : usesModelRole && !usesAssistantRole ? 'model' : 'chat',
        visitedFiles,
    };
}

function schemaFields(schema) {
    if (callName(schema?.path) !== 'object') return [];
    const receiver = schema.path.get('callee.object');
    const builder = receiver.isIdentifier() ? receiver.node.name : memberName(receiver);
    const source = schema.file.imports.get(builder)?.source;
    if (!['z', 'Joi', 'joi'].includes(builder) && !['zod', 'joi', '@hapi/joi'].includes(source)) return [];
    const object = schema.path.get('arguments')[0];
    return object?.isObjectExpression() ? object.get('properties').filter(prop => prop.isObjectProperty()).map(propertyName).filter(Boolean) : [];
}
