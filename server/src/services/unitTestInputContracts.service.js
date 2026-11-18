import fs from 'node:fs';
import path from 'node:path';
import { parseJavaScriptCode } from './babelParser.service.js';
import { importedSource, localFile } from './generatedTestInputRepair.service.js';

const unwrap = node => ['TSAsExpression','TSTypeAssertion','TSNonNullExpression','ParenthesizedExpression'].includes(node?.type) ? unwrap(node.expression) : node;

function schema(node, types, seen = new Set()) {
    node = node?.typeAnnotation || node;
    const primitive = { TSStringKeyword: 'string', TSNumberKeyword: 'number', TSBooleanKeyword: 'boolean', TSNullKeyword: 'null', TSUndefinedKeyword: 'undefined' }[node?.type];
    if (primitive) return { kind: primitive };
    if (node?.type === 'TSLiteralType') return schema({ type: { StringLiteral: 'TSStringKeyword', NumericLiteral: 'TSNumberKeyword', BooleanLiteral: 'TSBooleanKeyword', NullLiteral: 'TSNullKeyword' }[node.literal.type] }, types, seen);
    if (node?.type === 'TSUnionType') return { kind: 'union', items: node.types.map(type => schema(type, types, seen)) };
    if (node?.type === 'TSArrayType') return { kind: 'array', element: schema(node.elementType, types, seen) };
    if (node?.type === 'TSTypeReference' && node.typeName?.type === 'Identifier') {
        const name = node.typeName.name;
        if (name === 'Array' || name === 'ReadonlyArray') return { kind: 'array', element: schema(node.typeParameters?.params?.[0], types, seen) };
        if (!seen.has(name) && types.has(name)) { const next = new Set(seen).add(name); return schema(types.get(name), types, next); }
        return { kind: 'unknown', name };
    }
    const members = node?.type === 'TSInterfaceDeclaration' ? node.body.body : node?.type === 'TSTypeLiteral' ? node.members : null;
    if (members) return { kind: 'object', fields: Object.fromEntries(members.filter(member => member.type === 'TSPropertySignature' && member.key?.name).map(member => [member.key.name, { ...schema(member.typeAnnotation, types, seen), optional: Boolean(member.optional) }])) };
    if (node?.type === 'TSTypeAliasDeclaration') return schema(node.typeAnnotation, types, seen);
    return { kind: 'unknown' };
}

// -------------------------------------------------------------
// AST PARAMETER USAGE & JSDOC INFERENCE FOR JAVASCRIPT MODULES
// -------------------------------------------------------------

function walkAst(node, visitor) {
    if (!node || typeof node !== 'object') return;
    visitor(node);
    for (const key of Object.keys(node)) {
        if (['loc', 'comments', 'leadingComments', 'trailingComments'].includes(key)) continue;
        const child = node[key];
        if (Array.isArray(child)) {
            for (const c of child) walkAst(c, visitor);
        } else if (child && typeof child === 'object') {
            walkAst(child, visitor);
        }
    }
}

function getRootIdentifier(node) {
    if (!node) return null;
    if (node.type === 'Identifier') return node;
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') return getRootIdentifier(node.object);
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') return getRootIdentifier(node.callee);
    return null;
}

function requestAccesses(fn) {
    const accesses = new Map();
    const req = fn.params[0]?.name;
    if (req !== 'req') return [];
    walkAst(fn.body, node => {
        if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return;
        const segments = [];
        let current = node;
        while (current?.type === 'MemberExpression' || current?.type === 'OptionalMemberExpression') {
            const property = current.computed
                ? current.property.type === 'StringLiteral' && current.property.value
                : current.property.name;
            if (!property) return;
            segments.unshift(property);
            current = current.object;
        }
        if (current?.name !== req || !['body', 'params', 'user', 'cookies', 'query', 'headers'].includes(segments[0])) return;
        const access = [req, ...segments].join('.');
        accesses.set(access, { segments, access, line: node.loc?.start.line });
    });
    return [...accesses.values()];
}

function inferRequestFields(declared, accesses) {
    const fields = { ...declared };
    for (const { segments, access, line } of accesses) {
        let container = fields;
        for (const [index, name] of segments.entries()) {
            const nested = index < segments.length - 1;
            const existing = container[name];
            if (existing && !['object', 'unknown'].includes(existing.kind)) break;
            const field = { kind: 'unknown', optional: true, evidence: { access, line }, ...existing };
            if (nested) {
                field.kind = 'object';
                field.fields = { ...field.fields };
            }
            container[name] = field;
            container = field.fields;
        }
    }
    return fields;
}

function findRegisteredRequestContracts(rootDir, sourceFile, functions) {
    if (!rootDir || !sourceFile || ![...functions.values()].some(fn => fn.requestEvidence.length)) return [];
    const directory = path.join(path.dirname(path.dirname(sourceFile)), 'routes');
    let files;
    try { files = fs.readdirSync(directory).filter(file => /\.[cm]?[jt]s$/.test(file)).slice(0, 80); }
    catch { return []; }
    const results = [];
    const resolve = (file, specifier) => typeof specifier === 'string' && specifier.startsWith('.') &&
        ['', '.js', '.cjs', '.ts'].map(ext => localFile(rootDir, path.resolve(path.dirname(file), specifier + ext))).find(Boolean);
    for (const name of files) {
        const file = localFile(rootDir, path.join(directory, name));
        if (!file || fs.statSync(file).size > 100000) continue;
        const parsed = parseJavaScriptCode(fs.readFileSync(file, 'utf8'));
        if (!parsed.success) continue;
        const bindings = new Map();
        for (const statement of parsed.ast.program.body) {
            for (const decl of statement.declarations || []) {
                if (decl.id.type === 'Identifier' && decl.init?.callee?.name === 'require') {
                    bindings.set(decl.id.name, resolve(file, decl.init.arguments[0]?.value));
                }
            }
        }
        if (![...bindings.values()].includes(sourceFile)) continue;
        for (const statement of parsed.ast.program.body) {
            const call = statement.expression;
            const args = call?.arguments || [];
            const handler = args.at(-1);
            const fn = handler?.type === 'MemberExpression' && bindings.get(handler.object.name) === sourceFile &&
                functions.get(handler.property.name);
            if (!fn || args[0]?.type !== 'StringLiteral') continue;
            const middleware = args.slice(1, -1).flatMap(arg => {
                const target = bindings.get(arg.name);
                if (!target || fs.statSync(target).size > 100000) return [];
                const ast = parseJavaScriptCode(fs.readFileSync(target, 'utf8'));
                if (!ast.success) return [];
                const writes = [];
                walkAst(ast.ast.program, node => {
                    const left = node.left;
                    if (node.type === 'AssignmentExpression' && left.type === 'MemberExpression' &&
                        left.object.name === 'req' && left.property.name === 'user') {
                        writes.push({ access: 'req.user', line: node.loc.start.line, valueKind: valueKind(node.right) });
                    }
                });
                return writes.length ? [{ file: path.relative(rootDir, target).replaceAll('\\', '/'), writes }] : [];
            });
            const routeParams = [...args[0].value.matchAll(/:([\w]+)/g)].map(match => match[1]);
            const contract = { functionName: fn.name, route: args[0].value, file: path.relative(rootDir, file).replaceAll('\\', '/'),
                line: statement.loc.start.line, routeParams, middleware };
            const nestedUser = fn.requestEvidence.find(access => access.access.startsWith('req.user.'));
            if (nestedUser && middleware.some(item => item.writes.length === 1 && ['null', 'string', 'number', 'boolean'].includes(item.writes[0].valueKind))) {
                contract.potentialConflict = { access: nestedUser.access, line: nestedUser.line };
            }
            results.push(contract);
        }
    }
    return results;
}

function observableContract(fn, dependencies) {
    const returns = [];
    const calls = new Set();
    const visit = node => {
        if (!node?.type || (node !== fn.body && /(?:Function|Method)/.test(node.type))) return;
        if (node.type === 'ReturnStatement') {
            const argument = node.argument;
            const observed = argument ? { kind: argument.type, ...(Object.hasOwn(argument, 'value') && { value: argument.value }) } : { kind: 'void' };
            returns.push(observed);
        }
        if (node.type === 'CallExpression') {
            const target = getRootIdentifier(node.callee)?.name;
            if (dependencies.has(target)) calls.add(node.callee.property?.name ? target + '.' + node.callee.property.name : target);
        }
        for (const child of Object.values(node)) {
            if (Array.isArray(child)) child.forEach(visit);
            else if (child?.type) visit(child);
        }
    };
    visit(fn.body);
    return { async: Boolean(fn.async), returns, dependencyCalls: [...calls] };
}

function parseJsdocTypeString(str) {
    str = (str || '').trim();
    if (!str) return { kind: 'unknown' };
    if (['string', 'String'].includes(str)) return { kind: 'string' };
    if (['number', 'Number'].includes(str)) return { kind: 'number' };
    if (['boolean', 'Boolean'].includes(str)) return { kind: 'boolean' };
    if (['null', 'undefined'].includes(str)) return { kind: str };
    if (str.endsWith('[]')) return { kind: 'array', element: parseJsdocTypeString(str.slice(0, -2)) };
    if (/^Array<(.+)>$/i.test(str)) return { kind: 'array', element: parseJsdocTypeString(str.replace(/^Array<(.+)>$/i, '$1')) };
    if (str.startsWith('{') && str.endsWith('}')) {
        const body = str.slice(1, -1).trim();
        const fields = {};
        const parts = body.split(/,(?![^{]*\})/);
        for (const p of parts) {
            const [key, type] = p.split(':').map(s => s.trim());
            if (key) {
                const optional = key.endsWith('?');
                const cleanKey = optional ? key.slice(0, -1) : key;
                fields[cleanKey] = { ...parseJsdocTypeString(type), optional };
            }
        }
        return { kind: 'object', fields };
    }
    if (['object', 'Object'].includes(str)) return { kind: 'object', fields: {} };
    return { kind: 'unknown', name: str };
}

function parseJsdocComments(comments = []) {
    const jsdoc = new Map();
    for (const comment of comments) {
        if (comment.type !== 'CommentBlock' || !comment.value.includes('@param')) continue;
        const cleanedComment = comment.value.replace(/\r\n/g, '\n').replace(/\n\s*\*\s?/g, ' ');
        const paramRegex = /@param\s+/g;
        let match;
        while ((match = paramRegex.exec(cleanedComment)) !== null) {
            const after = cleanedComment.slice(match.index + match[0].length).trim();
            let typeStr = '', rest = after;
            if (after.startsWith('{')) {
                let depth = 0, closeIdx = -1;
                for (let i = 0; i < after.length; i++) {
                    if (after[i] === '{') depth++;
                    else if (after[i] === '}') { depth--; if (depth === 0) { closeIdx = i; break; } }
                }
                if (closeIdx !== -1) {
                    typeStr = after.slice(1, closeIdx).trim();
                    rest = after.slice(closeIdx + 1).trim();
                }
            }
            const nameMatch = rest.match(/^(\[?[\w$.]+(?:=[^\]]+)?\]?)/);
            if (nameMatch) {
                let rawName = nameMatch[1];
                const optional = rawName.startsWith('[') && rawName.endsWith(']');
                if (optional) rawName = rawName.slice(1, -1);
                const [paramPath, defaultValue] = rawName.split('=');
                jsdoc.set(paramPath.trim(), {
                    schema: parseJsdocTypeString(typeStr),
                    optional,
                    defaultValue: defaultValue?.trim()
                });
            }
        }
    }
    return jsdoc;
}

export function synthesizeFixture(contract, paramName = '', index = 0) {
    if (!contract) return null;
    const kind = contract.kind;

    if (kind === 'string') {
        const lower = (paramName || '').toLowerCase();
        if (lower.includes('role') && contract.sampleValues && contract.sampleValues.includes('user') && contract.sampleValues.includes('model')) {
            if (index === 0) return 'user';
            if (index === 1) return 'model';
            const others = contract.sampleValues.filter(v => v !== 'user' && v !== 'model');
            return others.length > 0 ? others[(index - 2) % others.length] : 'user';
        }
        if (contract.sampleValues && contract.sampleValues.length > 0) {
            return contract.sampleValues[index % contract.sampleValues.length];
        }
        if (lower.includes('role')) return index === 0 ? 'user' : 'model';
        if (lower.includes('content') || lower.includes('text') || lower.includes('msg')) {
            return index === 0 ? 'Sample user query' : 'Sample model response';
        }
        if (lower.includes('id')) return `id-${index + 1}`;
        if (lower.includes('name')) return `sample-${index + 1}`;
        return `sample_${paramName || 'string'}_${index + 1}`;
    }

    if (kind === 'number') {
        if (contract.default !== undefined) return contract.default;
        if (contract.sampleValues && contract.sampleValues.length > 0) {
            return contract.sampleValues[index % contract.sampleValues.length];
        }
        const lower = (paramName || '').toLowerCase();
        if (lower.includes('turn') || lower.includes('limit') || lower.includes('max')) return 10;
        if (lower.includes('time') || lower.includes('date')) return 1700000000000 + index * 1000;
        return index + 1;
    }

    if (kind === 'boolean') {
        if (contract.default !== undefined) return contract.default;
        return index === 0;
    }

    if (kind === 'object') {
        const res = {};
        for (const [key, fieldContract] of Object.entries(contract.fields || {})) {
            res[key] = synthesizeFixture(fieldContract, key, index);
        }
        return res;
    }

    if (kind === 'array') {
        const elContract = contract.element || { kind: 'object', fields: { id: { kind: 'string' } } };
        return [
            synthesizeFixture(elContract, (paramName || 'item') + '_0', 0),
            synthesizeFixture(elContract, (paramName || 'item') + '_1', 1)
        ];
    }

    const lower = (paramName || '').toLowerCase();
    if (lower.includes('history') || lower.includes('messages') || lower.includes('items') || lower.includes('list') || lower.includes('turns')) {
        return [
            { role: 'user', content: 'Sample user query', text: 'Sample user query', timestamp: 1700000000000 },
            { role: 'model', content: 'Sample model response', text: 'Sample model response', timestamp: 1700000001000 }
        ];
    }
    if (lower.includes('option') || lower.includes('config') || lower.includes('setting')) {
        return { maxTurns: 10, preserveSystem: true };
    }
    return 'sample_value';
}

const STRING_ONLY_PROTOTYPE_METHODS = new Set([
    'trim', 'trimStart', 'trimEnd', 'trimLeft', 'trimRight',
    'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase',
    'split', 'startsWith', 'endsWith', 'replace', 'replaceAll',
    'match', 'matchAll', 'search', 'substring', 'substr',
    'charAt', 'charCodeAt', 'codePointAt',
    'padStart', 'padEnd', 'repeat', 'normalize', 'localeCompare',
    'isWellFormed', 'toWellFormed',
    'anchor', 'big', 'blink', 'bold', 'fixed', 'fontcolor', 'fontsize',
    'italics', 'link', 'small', 'strike', 'sub', 'sup'
]);

const STRING_OR_ARRAY_PROTOTYPE_METHODS = new Set([
    'slice', 'includes', 'indexOf', 'lastIndexOf', 'concat', 'at'
]);

const ARRAY_ONLY_PROTOTYPE_METHODS = new Set([
    'map', 'filter', 'forEach', 'reduce', 'reduceRight', 'find', 'findIndex',
    'findLast', 'findLastIndex', 'some', 'every', 'flatMap', 'flat',
    'push', 'pop', 'shift', 'unshift', 'splice', 'join', 'sort', 'reverse',
    'toReversed', 'toSorted', 'toSpliced', 'with', 'fill', 'copyWithin', 'entries', 'keys', 'values'
]);

const COMMON_PROTOTYPE_PROPERTIES = new Set([
    'length', 'toString', 'valueOf', 'hasOwnProperty', 'constructor'
]);

const LOCAL_MODULE_EXTENSIONS = [
    '', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
    '/index.ts', '/index.tsx', '/index.mts', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs'
];

function resolveLocalModule(rootDir, fromFile, specifier) {
    if (!rootDir || !fromFile || typeof specifier !== 'string' || !specifier.startsWith('.')) return null;
    const absFrom = path.isAbsolute(fromFile) ? fromFile : path.join(rootDir, fromFile);
    const rawTarget = path.resolve(path.dirname(absFrom), specifier);
    const bases = [rawTarget];
    if (/\.[cm]?jsx?$/i.test(rawTarget)) {
        bases.push(rawTarget.replace(/\.[cm]?jsx?$/i, ''));
    }
    for (const base of bases) {
        for (const ext of LOCAL_MODULE_EXTENSIONS) {
            const hit = localFile(rootDir, base + ext);
            if (hit) return hit;
        }
    }
    return null;
}

function inferParamUsagesFromBody(fn, jsdocMap) {
    const paramNames = (fn.params || []).map(p => {
        const v = p.type === 'AssignmentPattern' ? p.left : p.type === 'RestElement' ? p.argument : p;
        return v.name || 'param';
    });

    const aliases = new Map();
    for (const p of paramNames) aliases.set(p, new Set([p]));

    // Track local aliases: const list = history; or const opts = options || {};
    walkAst(fn.body, node => {
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
            const varName = node.id.name;
            if (node.init.type === 'Identifier' && aliases.has(node.init.name)) {
                aliases.get(node.init.name).add(varName);
            } else if (node.init.type === 'LogicalExpression' && node.init.left?.type === 'Identifier' && aliases.has(node.init.left.name)) {
                aliases.get(node.init.left.name).add(varName);
            }
        }
    });

    const arrayParams = new Set();
    const stringParams = new Set();
    const stringOrArrayParams = new Set();
    const itemVars = new Map();
    const itemProperties = new Map();
    const directProperties = new Map();
    const itemPropAliases = new Map(); // varName -> { pName, prop }

    for (const p of paramNames) {
        itemVars.set(p, new Set());
        itemProperties.set(p, new Map());
        directProperties.set(p, new Map());
    }

    walkAst(fn.body, node => {
        // Array.isArray(alias)
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' &&
            node.callee.object?.name === 'Array' && node.callee.property?.name === 'isArray') {
            const arg = node.arguments[0];
            if (arg?.type === 'Identifier') {
                for (const [pName, set] of aliases) {
                    if (set.has(arg.name)) arrayParams.add(pName);
                }
            }
        }

        // Array methods: .map, .filter, .forEach, .reduce, .find, .some, .every, etc.
        if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression') &&
            (node.callee?.type === 'MemberExpression' || node.callee?.type === 'OptionalMemberExpression')) {
            const root = getRootIdentifier(node.callee.object);
            const method = node.callee.property?.name;
            if (ARRAY_ONLY_PROTOTYPE_METHODS.has(method) && root?.name) {
                for (const [pName, set] of aliases) {
                    if (set.has(root.name)) {
                        arrayParams.add(pName);
                        const cb = node.arguments[0];
                        if (['map', 'filter', 'forEach', 'reduce', 'find', 'some', 'every', 'flatMap'].includes(method) &&
                            cb && ['ArrowFunctionExpression', 'FunctionExpression'].includes(cb.type)) {
                            const itemParam = method === 'reduce' ? cb.params[1] : cb.params[0];
                            if (itemParam?.type === 'Identifier') {
                                itemVars.get(pName).add(itemParam.name);
                            } else if (itemParam?.type === 'ObjectPattern') {
                                for (const prop of itemParam.properties) {
                                    const fieldName = prop.key?.name || prop.key?.value;
                                    const localVar = prop.value?.type === 'Identifier' ? prop.value.name : (prop.value?.type === 'AssignmentPattern' && prop.value.left?.type === 'Identifier' ? prop.value.left.name : fieldName);
                                    if (fieldName) {
                                        if (!itemProperties.get(pName).has(fieldName)) {
                                            itemProperties.get(pName).set(fieldName, { kind: 'string', sampleValues: new Set() });
                                        }
                                        if (localVar) itemPropAliases.set(localVar, { pName, prop: fieldName });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // for (const item of list)
        if (node.type === 'ForOfStatement' && node.right) {
            const rightRoot = getRootIdentifier(node.right);
            if (rightRoot) {
                for (const [pName, set] of aliases) {
                    if (set.has(rightRoot.name)) {
                        arrayParams.add(pName);
                        if (node.left?.type === 'VariableDeclaration') {
                            const decl = node.left.declarations[0];
                            if (decl?.id?.type === 'Identifier') {
                                itemVars.get(pName).add(decl.id.name);
                            } else if (decl?.id?.type === 'ObjectPattern') {
                                for (const prop of decl.id.properties) {
                                    const fieldName = prop.key?.name || prop.key?.value;
                                    const localVar = prop.value?.type === 'Identifier' ? prop.value.name : (prop.value?.type === 'AssignmentPattern' && prop.value.left?.type === 'Identifier' ? prop.value.left.name : fieldName);
                                    if (fieldName) {
                                        if (!itemProperties.get(pName).has(fieldName)) {
                                            itemProperties.get(pName).set(fieldName, { kind: 'string', sampleValues: new Set() });
                                        }
                                        if (localVar) itemPropAliases.set(localVar, { pName, prop: fieldName });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Direct property accesses: options.maxTurns (excluding String/Array/common prototype members)
        if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && !node.computed && node.object?.type === 'Identifier') {
            for (const [pName, set] of aliases) {
                if (set.has(node.object.name)) {
                    const prop = node.property?.name || (node.property?.type === 'StringLiteral' ? node.property.value : null);
                    if (!prop || COMMON_PROTOTYPE_PROPERTIES.has(prop)) continue;
                    if (STRING_ONLY_PROTOTYPE_METHODS.has(prop)) {
                        stringParams.add(pName);
                        continue;
                    }
                    if (STRING_OR_ARRAY_PROTOTYPE_METHODS.has(prop)) {
                        stringOrArrayParams.add(pName);
                        continue;
                    }
                    if (ARRAY_ONLY_PROTOTYPE_METHODS.has(prop)) {
                        arrayParams.add(pName);
                        continue;
                    }
                    if (!directProperties.get(pName).has(prop)) {
                        directProperties.get(pName).set(prop, { kind: 'string', sampleValues: new Set() });
                    }
                }
            }
        }

        // Chained string/array prototype calls on parameter (e.g. msg.trim().toLowerCase(), msg.slice(0, 2).includes('a'))
        if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression') &&
            (node.callee?.type === 'MemberExpression' || node.callee?.type === 'OptionalMemberExpression')) {
            const root = getRootIdentifier(node.callee.object);
            const method = node.callee.property?.name;
            if (root?.name && method) {
                for (const [pName, set] of aliases) {
                    if (set.has(root.name)) {
                        if (STRING_ONLY_PROTOTYPE_METHODS.has(method)) {
                            stringParams.add(pName);
                        } else if (STRING_OR_ARRAY_PROTOTYPE_METHODS.has(method)) {
                            stringOrArrayParams.add(pName);
                        }
                    }
                }
            }
        }

        // typeof param === 'string'
        if (node.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(node.operator)) {
            const typeofSide = node.left?.type === 'UnaryExpression' && node.left.operator === 'typeof' ? node.left
                : (node.right?.type === 'UnaryExpression' && node.right.operator === 'typeof' ? node.right : null);
            const litSide = typeofSide === node.left ? node.right : node.left;
            if (typeofSide?.argument?.type === 'Identifier' && litSide?.type === 'StringLiteral' && litSide.value === 'string') {
                for (const [pName, set] of aliases) {
                    if (set.has(typeofSide.argument.name)) stringParams.add(pName);
                }
            }
        }

        // Logical fallback: options.maxTurns || 10
        if (node.type === 'LogicalExpression' && ['||', '??'].includes(node.operator)) {
            if (node.left?.type === 'MemberExpression' && node.left.object?.type === 'Identifier') {
                for (const [pName, set] of aliases) {
                    if (set.has(node.left.object.name)) {
                        const prop = node.left.property?.name;
                        if (prop && node.right) {
                            const kind = node.right.type === 'NumericLiteral' ? 'number' : node.right.type === 'BooleanLiteral' ? 'boolean' : node.right.type === 'StringLiteral' ? 'string' : 'unknown';
                            if (kind !== 'unknown') {
                                directProperties.get(pName).set(prop, { kind, default: node.right.value, sampleValues: new Set([node.right.value]) });
                            }
                        }
                    }
                }
            }
        }

        // Index assignments: const item = history[i];
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init?.type === 'MemberExpression' && node.init.computed === true) {
            for (const [pName, set] of aliases) {
                if (set.has(node.init.object?.name)) {
                    arrayParams.add(pName);
                    itemVars.get(pName).add(node.id.name);
                }
            }
        }
    });

    // Track local aliases to item properties: let role = turn.role;
    walkAst(fn.body, node => {
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init?.type === 'MemberExpression') {
            for (const [pName, iSet] of itemVars) {
                if (iSet.has(node.init.object?.name)) {
                    const prop = node.init.property?.name || (node.init.property?.type === 'StringLiteral' ? node.init.property.value : null);
                    if (prop) {
                        itemPropAliases.set(node.id.name, { pName, prop });
                    }
                }
            }
        }
    });

    // Inspect property accesses on item variables
    walkAst(fn.body, node => {
        if (node.type === 'MemberExpression' && node.object?.type === 'Identifier') {
            for (const [pName, iSet] of itemVars) {
                if (iSet.has(node.object.name)) {
                    const prop = node.property?.name || (node.property?.type === 'StringLiteral' ? node.property.value : null);
                    if (prop && !itemProperties.get(pName).has(prop)) {
                        itemProperties.get(pName).set(prop, { kind: 'string', sampleValues: new Set() });
                    }
                }
            }
        }

        // Comparisons: item.role === 'user' or typeof item.timestamp === 'number' or role === 'assistant'
        if (node.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(node.operator)) {
            // typeof guard
            if (node.left?.type === 'UnaryExpression' && node.left.operator === 'typeof' && node.left.argument?.type === 'MemberExpression' && node.right?.type === 'StringLiteral') {
                for (const [pName, iSet] of itemVars) {
                    if (iSet.has(node.left.argument.object?.name)) {
                        const prop = node.left.argument.property?.name;
                        if (prop && itemProperties.get(pName).has(prop)) {
                            itemProperties.get(pName).get(prop).kind = node.right.value;
                        }
                    }
                }
            }
            // Literal equality comparison on MemberExpression
            let member = null, lit = null;
            if (node.left?.type === 'MemberExpression' && ['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.right?.type)) {
                member = node.left; lit = node.right;
            } else if (node.right?.type === 'MemberExpression' && ['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.left?.type)) {
                member = node.right; lit = node.left;
            }
            if (member && lit && member.object?.type === 'Identifier') {
                for (const [pName, iSet] of itemVars) {
                    if (iSet.has(member.object.name)) {
                        const prop = member.property?.name || member.property?.value;
                        if (prop) {
                            if (!itemProperties.get(pName).has(prop)) {
                                itemProperties.get(pName).set(prop, { kind: typeof lit.value, sampleValues: new Set() });
                            }
                            const info = itemProperties.get(pName).get(prop);
                            info.kind = typeof lit.value;
                            info.sampleValues.add(lit.value);
                        }
                    }
                }
            }

            // Literal equality comparison on aliased item property: role === 'assistant'
            let ident = null;
            if (node.left?.type === 'Identifier' && ['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.right?.type)) {
                ident = node.left; lit = node.right;
            } else if (node.right?.type === 'Identifier' && ['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.left?.type)) {
                ident = node.right; lit = node.left;
            }
            if (ident && lit && itemPropAliases.has(ident.name)) {
                const { pName, prop } = itemPropAliases.get(ident.name);
                if (!itemProperties.get(pName).has(prop)) {
                    itemProperties.get(pName).set(prop, { kind: typeof lit.value, sampleValues: new Set() });
                }
                const info = itemProperties.get(pName).get(prop);
                info.kind = typeof lit.value;
                info.sampleValues.add(lit.value);
            }
        }
    });

    return { arrayParams, stringParams, stringOrArrayParams, itemProperties, directProperties };
}

function collectExitInfoFromBody(node) {
    const exitCodes = [];
    let callsProcessExit = false;
    walkAst(node, n => {
        if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' &&
            !n.callee.computed && n.callee.object?.name === 'process' &&
            ['exit', 'abort'].includes(n.callee.property?.name)) {
            callsProcessExit = true;
            const arg0 = n.arguments?.[0];
            if (arg0?.type === 'NumericLiteral') exitCodes.push(arg0.value);
        }
    });
    return { callsProcessExit, exitCodes: [...new Set(exitCodes)] };
}

function unwrapTopLevelCall(expr) {
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

export function sourceInputContracts(source, { rootDir, sourceFile, _depth = 0 } = {}) {
    const parsed = parseJavaScriptCode(source);
    if (!parsed.success) return { functions: new Map(), exportedValues: new Map(), evidence: source };
    const types = new Map();
    let evidence = source;

    const appendEvidence = (code, node) => {
        const snippet = code.slice(node.start, node.end);
        if (evidence.length + snippet.length < 60000) evidence += '\n' + snippet;
    };

    const collect = (ast, code, wanted) => {
        for (const item of ast.program.body) {
            const node = item.declaration || item;
            if (['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(node.type) && (!wanted || wanted.has(node.id.name))) {
                types.set(node.id.name, node);
                if (wanted) appendEvidence(code, node);
            }
            if (wanted && node.type === 'VariableDeclaration') {
                for (const declaration of node.declarations) {
                    if (wanted.has(declaration.id?.name)) appendEvidence(code, node);
                }
            }
        }
    };

    collect(parsed.ast, source);

    if (rootDir && sourceFile) {
        for (const node of parsed.ast.program.body) {
            if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
            const base = path.resolve(path.dirname(sourceFile), node.source.value);
            const file = ['', '.ts', '.tsx', '/index.ts'].map(suffix => localFile(rootDir, base + suffix)).find(Boolean);
            if (!file) continue;
            const code = fs.readFileSync(file, 'utf8');
            if (code.length > 100000) continue;
            const imported = parseJavaScriptCode(code);
            if (!imported.success) continue;
            const wanted = new Set(node.specifiers.filter(spec => spec.type === 'ImportSpecifier').map(spec => spec.imported.name));
            collect(imported.ast, code, wanted);
            for (const spec of node.specifiers) {
                if (spec.type === 'ImportSpecifier' && types.has(spec.imported.name)) {
                    types.set(spec.local.name, types.get(spec.imported.name));
                }
            }
        }
    }

    // Index top-level functions and values for specifier/export matching
    const topLevelFns = new Map();
    const topLevelValues = new Map();
    const dependencies = new Set();
    for (const item of parsed.ast.program.body) {
        if (item.type === 'ImportDeclaration' && item.importKind !== 'type') {
            item.specifiers.forEach(specifier => dependencies.add(specifier.local.name));
        }
        if (item.type === 'FunctionDeclaration' && item.id?.name) {
            topLevelFns.set(item.id.name, item);
        } else if (item.type === 'VariableDeclaration') {
            for (const decl of item.declarations) {
                if (decl.init?.callee?.name === 'require' && decl.init.arguments[0]?.type === 'StringLiteral') {
                    if (decl.id.type === 'Identifier') dependencies.add(decl.id.name);
                    for (const property of decl.id.properties || []) {
                        if (property.value?.type === 'Identifier') dependencies.add(property.value.name);
                    }
                }
                if (decl.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(decl.init?.type)) {
                    topLevelFns.set(decl.id.name, decl.init);
                } else if (decl.id?.type === 'Identifier' && decl.init) {
                    topLevelValues.set(decl.id.name, decl.init.type);
                }
            }
        } else if (item.type === 'ClassDeclaration' && item.id?.name) {
            topLevelValues.set(item.id.name, 'ClassDeclaration');
        }
    }

    const functions = new Map();
    const exportedValues = new Map();

    const loadReExportContracts = (specifier) => {
        if (!rootDir || !sourceFile || _depth >= 1 || !specifier?.startsWith('.')) return null;
        const resolved = resolveLocalModule(rootDir, sourceFile, specifier);
        if (!resolved) return null;
        try {
            const targetCode = fs.readFileSync(resolved, 'utf8');
            if (targetCode.length > 250000) return null;
            return sourceInputContracts(targetCode, { rootDir, sourceFile: resolved, _depth: _depth + 1 });
        } catch {
            return null;
        }
    };

    for (const item of parsed.ast.program.body) {
        let entries = [];
        const jsdoc = parseJsdocComments(item.leadingComments || item.declaration?.leadingComments || []);

        if (item.type === 'ExportAllDeclaration') {
            if (item.exportKind === 'type') continue;
            const targetContracts = loadReExportContracts(item.source?.value);
            if (targetContracts) {
                for (const [fnName, contract] of targetContracts.functions.entries()) {
                    if (fnName !== 'default' && !contract.isDefault && !functions.has(fnName)) {
                        functions.set(fnName, { ...contract, isDefault: false });
                    }
                }
                for (const [valName, valMeta] of (targetContracts.exportedValues || new Map()).entries()) {
                    if (valName !== 'default' && !valMeta.isDefault && !exportedValues.has(valName)) {
                        exportedValues.set(valName, { ...valMeta, isDefault: false });
                    }
                }
            }
            continue;
        }

        if (item.type === 'ExportNamedDeclaration') {
            if (item.exportKind === 'type') continue;
            const declaration = item.declaration;
            if (declaration?.type === 'FunctionDeclaration') {
                entries = [[declaration.id.name, declaration, false]];
            } else if (declaration?.type === 'VariableDeclaration') {
                for (const d of declaration.declarations) {
                    if (d.id.type !== 'Identifier') continue;
                    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(d.init?.type)) {
                        entries.push([d.id.name, d.init, false]);
                    } else if (d.init?.type === 'Identifier' && topLevelFns.has(d.init.name)) {
                        entries.push([d.id.name, topLevelFns.get(d.init.name), false]);
                    } else {
                        exportedValues.set(d.id.name, { name: d.id.name, kind: d.init?.type || 'constant', isDefault: false });
                    }
                }
            } else if (declaration?.type === 'ClassDeclaration' && declaration.id?.name) {
                exportedValues.set(declaration.id.name, { name: declaration.id.name, kind: 'ClassDeclaration', isDefault: false });
            } else if (item.specifiers) {
                const targetContracts = item.source?.value ? loadReExportContracts(item.source.value) : null;
                for (const spec of item.specifiers) {
                    if (spec.exportKind === 'type') continue;
                    const local = spec.local?.name;
                    const exp = spec.exported?.name || spec.exported?.value || local;
                    const isDef = exp === 'default';
                    if (targetContracts) {
                        const targetFn = local === 'default'
                            ? (targetContracts.functions.get('default') || [...targetContracts.functions.values()].find(f => f.isDefault))
                            : targetContracts.functions.get(local);
                        if (targetFn) {
                            functions.set(exp, { ...targetFn, name: exp, isDefault: isDef });
                        } else if (exp) {
                            exportedValues.set(exp, { name: exp, kind: 're-export', isDefault: isDef });
                        }
                    } else if (topLevelFns.has(local)) {
                        entries.push([exp, topLevelFns.get(local), isDef]);
                    } else if (exp) {
                        exportedValues.set(exp, { name: exp, kind: topLevelValues.get(local) || 'named-export', isDefault: isDef });
                    }
                }
            }
        } else if (item.type === 'ExportDefaultDeclaration') {
            const decl = item.declaration;
            if (decl.type === 'FunctionDeclaration') {
                entries = [[decl.id?.name || 'default', decl, true]];
            } else if (['ArrowFunctionExpression', 'FunctionExpression'].includes(decl.type)) {
                entries = [['default', decl, true]];
            } else if (decl.type === 'Identifier' && topLevelFns.has(decl.name)) {
                entries = [[decl.name, topLevelFns.get(decl.name), true]];
            } else if (decl.type === 'Identifier') {
                exportedValues.set(decl.name, { name: decl.name, kind: topLevelValues.get(decl.name) || 'constant', isDefault: true });
            } else {
                exportedValues.set('default', { name: 'default', kind: decl.type || 'object', isDefault: true });
            }
        } else if (item.type === 'ExpressionStatement' && item.expression?.type === 'AssignmentExpression') {
            const left = item.expression.left;
            const right = item.expression.right;
            if (left.type === 'MemberExpression' && !left.computed && left.object?.name === 'module' && left.property?.name === 'exports') {
                if (right.type === 'ObjectExpression') {
                    for (const prop of right.properties) {
                        if (prop.type === 'ObjectMethod') {
                            const expName = prop.key?.name || prop.key?.value;
                            if (expName) entries.push([expName, prop, false]);
                        } else if (prop.type === 'ObjectProperty') {
                            const expName = prop.key?.name || prop.key?.value;
                            const val = prop.value;
                            if (['ArrowFunctionExpression', 'FunctionExpression'].includes(val?.type)) {
                                entries.push([expName, val, false]);
                            } else if (val?.type === 'Identifier' && topLevelFns.has(val.name)) {
                                entries.push([expName, topLevelFns.get(val.name), false]);
                            } else if (expName) {
                                exportedValues.set(expName, { name: expName, kind: val?.type || 'constant', isDefault: false });
                            }
                        }
                    }
                } else if (['ArrowFunctionExpression', 'FunctionExpression'].includes(right.type)) {
                    entries.push(['default', right, true]);
                } else if (right.type === 'Identifier' && topLevelFns.has(right.name)) {
                    entries.push([right.name, topLevelFns.get(right.name), true]);
                } else if (right.type === 'Identifier') {
                    exportedValues.set(right.name, { name: right.name, kind: topLevelValues.get(right.name) || 'constant', isDefault: true });
                }
            } else if (left.type === 'MemberExpression' && !left.computed && (
                left.object?.name === 'exports' ||
                (left.object?.type === 'MemberExpression' && !left.object.computed && left.object.object?.name === 'module' && left.object.property?.name === 'exports')
            )) {
                const expName = left.property?.name || left.property?.value;
                if (expName) {
                    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(right.type)) {
                        entries.push([expName, right, false]);
                    } else if (right.type === 'Identifier' && topLevelFns.has(right.name)) {
                        entries.push([expName, topLevelFns.get(right.name), false]);
                    } else {
                        exportedValues.set(expName, { name: expName, kind: right?.type || 'constant', isDefault: false });
                    }
                }
            }
        }

        for (const [name, fn, isDefaultExport = false] of entries) {
            const bodyInference = inferParamUsagesFromBody(fn, jsdoc);
            const requestEvidence = requestAccesses(fn);

            const parameters = (fn.params || []).map(param => {
                const value = param.type === 'AssignmentPattern' ? param.left : param.type === 'RestElement' ? param.argument : param;
                const pName = value.name || 'input';
                const isOptional = Boolean(value.optional || param.type === 'AssignmentPattern' || param.type === 'RestElement');
                const isRest = param.type === 'RestElement';

                // 1. Base TypeScript schema (if TS annotations exist)
                let type = schema(param.type === 'RestElement' ? param.typeAnnotation : value.typeAnnotation, types);
                if (param.type === 'RestElement') type = type.kind === 'array' ? type.element : { kind: 'unknown' };

                // 1b. Top-level ObjectPattern destructured parameter: function fn({ a, b = 1 })
                if (type.kind === 'unknown' && value.type === 'ObjectPattern') {
                    const fields = {};
                    for (const prop of value.properties || []) {
                        if (prop.type === 'ObjectProperty') {
                            const keyName = prop.key?.name || prop.key?.value;
                            if (!keyName) continue;
                            let fKind = 'string';
                            let fDefault = undefined;
                            const valNode = prop.value;
                            if (valNode?.type === 'AssignmentPattern' && valNode.right) {
                                if (valNode.right.type === 'NumericLiteral') { fKind = 'number'; fDefault = valNode.right.value; }
                                else if (valNode.right.type === 'BooleanLiteral') { fKind = 'boolean'; fDefault = valNode.right.value; }
                                else if (valNode.right.type === 'StringLiteral') { fKind = 'string'; fDefault = valNode.right.value; }
                                else if (valNode.right.type === 'ArrayExpression') { fKind = 'array'; }
                                else if (valNode.right.type === 'ObjectExpression') { fKind = 'object'; }
                            }
                            fields[keyName] = { kind: fKind, optional: valNode?.type === 'AssignmentPattern', default: fDefault };
                        }
                    }
                    type = { kind: 'object', fields };
                }

                // 2. JSDoc tag inference (if kind is unknown)
                if (type.kind === 'unknown' && jsdoc.has(pName)) {
                    const jInfo = jsdoc.get(pName);
                    type = { ...type, ...jInfo.schema };
                }

                // 3. Default parameter values in AssignmentPattern
                let defaultValue = undefined;
                if (param.type === 'AssignmentPattern' && param.right) {
                    if (param.right.type === 'ArrayExpression' && type.kind === 'unknown') type.kind = 'array';
                    else if (param.right.type === 'ObjectExpression' && type.kind === 'unknown') type.kind = 'object';
                    else if (param.right.type === 'NumericLiteral') { if (type.kind === 'unknown') type.kind = 'number'; defaultValue = param.right.value; }
                    else if (param.right.type === 'BooleanLiteral') { if (type.kind === 'unknown') type.kind = 'boolean'; defaultValue = param.right.value; }
                    else if (param.right.type === 'StringLiteral') { if (type.kind === 'unknown') type.kind = 'string'; defaultValue = param.right.value; }
                }

                // 4. AST body array inference
                if (bodyInference.arrayParams.has(pName)) {
                    type.kind = 'array';
                    const fMap = bodyInference.itemProperties.get(pName);
                    if (fMap && fMap.size > 0) {
                        const fields = {};
                        for (const [fName, fInfo] of fMap) {
                            fields[fName] = { kind: fInfo.kind, sampleValues: [...fInfo.sampleValues] };
                        }
                        type.element = { kind: 'object', fields };
                    } else if (!type.element) {
                        type.element = { kind: 'object', fields: { id: { kind: 'string' } } };
                    }
                }

                // 4b. AST body string inference (String.prototype methods keep/infer kind: 'string' instead of 'object')
                const dMap = bodyInference.directProperties.get(pName);
                const hasDirectProps = Boolean(dMap && dMap.size > 0);
                if (type.kind === 'unknown' && !bodyInference.arrayParams.has(pName) &&
                    (bodyInference.stringParams.has(pName) || (bodyInference.stringOrArrayParams.has(pName) && !hasDirectProps))) {
                    type.kind = 'string';
                }

                // 5. AST body object inference (only fill missing fields without overwriting TS/JSDoc/string structures)
                if ((type.kind === 'unknown' || type.kind === 'object') && !bodyInference.stringParams.has(pName)) {
                    if (dMap && dMap.size > 0) {
                        type.kind = 'object';
                        const fields = { ...(type.fields || {}) };
                        for (const [fName, fInfo] of dMap) {
                            if (pName === 'req' && requestEvidence.some(item => item.segments[0] === fName)) continue;
                            if (!fields[fName]) {
                                fields[fName] = {
                                    kind: fInfo.kind,
                                    optional: true,
                                    default: fInfo.default,
                                    sampleValues: [...fInfo.sampleValues]
                                };
                            }
                        }
                        type.fields = fields;
                    }
                }
                if (pName === 'req' && requestEvidence.length && ['unknown', 'object'].includes(type.kind)) {
                    type = { ...type, kind: 'object', fields: inferRequestFields(type.fields, requestEvidence) };
                }

                const contractObj = {
                    name: pName,
                    ...type,
                    rest: isRest,
                    optional: isOptional,
                    default: defaultValue
                };

                contractObj.synthesizedFixture = synthesizeFixture(contractObj, pName);
                return contractObj;
            });

            functions.set(name, { name, isDefault: Boolean(isDefaultExport), parameters, ...observableContract(fn, dependencies), requestEvidence });
        }
    }

    const entryPoints = parsed.ast.program.body.flatMap(statement => {
        if (statement.type !== 'ExpressionStatement') return [];
        const call = unwrapTopLevelCall(statement.expression);
        if (call?.type !== 'CallExpression') return [];
        if (call.callee?.type === 'MemberExpression' && !call.callee.computed &&
            call.callee.object?.name === 'process' && ['exit', 'abort'].includes(call.callee.property?.name)) {
            const arg0 = call.arguments?.[0];
            return [{
                name: 'top-level-process-exit',
                importTime: true,
                parameters: [],
                callsProcessExit: true,
                exitCodes: arg0?.type === 'NumericLiteral' ? [arg0.value] : [],
                async: false,
                returns: [],
                dependencyCalls: []
            }];
        }
        if (['ArrowFunctionExpression', 'FunctionExpression'].includes(call.callee?.type)) {
            const exitInfo = collectExitInfoFromBody(call.callee.body);
            return [{
                name: call.callee.id?.name || '<iife>',
                importTime: true,
                isIife: true,
                parameters: (call.callee.params || []).map(p => p.name || p.left?.name || null),
                ...exitInfo,
                ...observableContract(call.callee, dependencies)
            }];
        }
        const name = call.callee?.name;
        const fn = name && topLevelFns.get(name);
        if (fn) {
            const exitInfo = collectExitInfoFromBody(fn.body);
            return [{
                name,
                importTime: true,
                parameters: fn.params.map(param => param.name || param.left?.name || null),
                ...exitInfo,
                ...observableContract(fn, dependencies)
            }];
        }
        if (call.callee?.type === 'MemberExpression' && call.arguments?.some(a => ['ArrowFunctionExpression', 'FunctionExpression'].includes(a?.type))) {
            let callsExit = false;
            const exitCodes = new Set();
            for (const arg of call.arguments) {
                if (['ArrowFunctionExpression', 'FunctionExpression'].includes(arg?.type)) {
                    const info = collectExitInfoFromBody(arg.body);
                    if (info.callsProcessExit) callsExit = true;
                    info.exitCodes.forEach(c => exitCodes.add(c));
                }
            }
            if (callsExit) {
                return [{
                    name: `${getRootIdentifier(call.callee)?.name || 'chain'}.${call.callee.property?.name || 'call'}`,
                    importTime: true,
                    parameters: [],
                    callsProcessExit: true,
                    exitCodes: [...exitCodes],
                    async: true,
                    returns: [],
                    dependencyCalls: []
                }];
            }
        }
        return [];
    });
    const requestRoutes = findRegisteredRequestContracts(rootDir, sourceFile, functions);
    for (const fn of functions.values()) {
        const registrations = requestRoutes.filter(route => route.functionName === fn.name);
        if (!registrations.length) continue;
        const fields = fn.parameters[0]?.fields?.params?.fields;
        for (const [name, field] of Object.entries(fields || {})) {
            if (field.kind === 'unknown' && registrations.every(route => route.routeParams.includes(name))) {
                field.kind = 'string';
                field.routeEvidence = registrations.map(({ file, line, route }) => ({ file, line, route }));
            }
        }
    }
    return { functions, exportedValues, evidence, entryPoints, requestRoutes };
}

// Expand only finite local fixtures; never evaluate project code to discover inputs.
function alternatives(node, scope, depth = 0) {
    node = unwrap(node);
    if (!node || depth > 8) return [];
    if (node.type !== 'Identifier' || node.name === 'undefined') return [{ node, scope }];
    const binding = scope.getBinding(node.name);
    if (!binding) return [];
    const declaration = binding.path;
    if (declaration.isVariableDeclarator()) {
        const loop = declaration.parentPath.parentPath;
        if (loop?.isForOfStatement()) return elements(loop.node.right, loop.scope, depth + 1);
        if (binding.constant) return alternatives(declaration.node.init, declaration.scope, depth + 1);
    }
    if (declaration.isIdentifier() && declaration.parentPath.isFunction()) {
        const fn = declaration.parentPath, call = fn.parentPath;
        if (call.isCallExpression() && call.node.callee.type === 'MemberExpression' && call.node.callee.property.name === 'forEach' && fn.node.params[0] === declaration.node)
            return elements(call.node.callee.object, call.scope, depth + 1);
    }
    return [{ node, scope }];
}

function elements(node, scope, depth) {
    return alternatives(node, scope, depth).flatMap(item => item.node.type === 'ArrayExpression' ? item.node.elements.filter(Boolean).flatMap(element => alternatives(element, item.scope, depth + 1)) : []).slice(0, 32);
}

function valueKind(node) {
    return {
        StringLiteral: 'string',
        NumericLiteral: 'number',
        BooleanLiteral: 'boolean',
        NullLiteral: 'null',
        ArrayExpression: 'array',
        ObjectExpression: 'object'
    }[node?.type] || (node?.type === 'Identifier' && node.name === 'undefined' ? 'undefined' : node?.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral' ? 'number' : 'unknown');
}

function mismatch(node, scope, contract, label, depth = 0) {
    if (depth > 8 || contract.kind === 'unknown') return null;
    if (contract.kind === 'union') {
        const reasons = contract.items.map(item => mismatch(node, scope, item, label, depth + 1));
        return reasons.every(Boolean) ? reasons.find(reason => reason.startsWith(`${label}.`)) || `${label} violates its declared union type` : null;
    }
    const kind = valueKind(node);
    if (kind === 'unknown') return null;
    if (kind === 'undefined' && contract.optional) return null;
    if (kind !== contract.kind) return `${label} requires ${contract.kind}, received ${kind}`;
    if (kind === 'object') {
        for (const property of node.properties || []) {
            if (property.type !== 'ObjectProperty' || property.computed) continue;
            const name = property.key.name || property.key.value, field = contract.fields?.[name];
            if (!field) continue;
            for (const value of alternatives(property.value, scope)) {
                const reason = mismatch(value.node, value.scope, field, `${label}.${name}`, depth + 1);
                if (reason) return reason;
            }
        }
    }
    return null;
}

export function sourceTargets(call, testFile, rootDir, sourceFile, contracts) {
    const candidates = [{ node: call.node.callee, scope: call.scope }, ...alternatives(call.node.callee, call.scope)];
    const matches = candidates.flatMap(({ node, scope }) => {
        const target = node?.type === 'MemberExpression' && !node.computed ? node.object : node;
        if (target?.type !== 'Identifier') return [];
        const binding = scope.getBinding(target.name);
        if (!binding) return [];
        const imported = importedSource({ node: { callee: target }, scope }, testFile, rootDir);
        const init = binding.path.node.init;
        const specifier = init?.callee?.name === 'require' ? init.arguments[0]?.value : null;
        const dependency = resolveLocalModule(rootDir, testFile, specifier);
        if (imported !== sourceFile && dependency !== sourceFile) return [];
        const property = binding.path.node.id?.properties?.find(prop => prop.value?.name === target.name);
        const isDefaultImport = binding.path.isImportDefaultSpecifier() ||
            (binding.path.isVariableDeclarator() && binding.path.node.id?.type === 'Identifier' && node.type !== 'MemberExpression');
        let name = node.property?.name || binding.path.node.imported?.name || property?.key.name || null;
        if (!name && isDefaultImport) {
            if (contracts.has('default')) {
                name = 'default';
            } else {
                const defaultEntry = [...contracts.values()].find(c => c.isDefault);
                name = defaultEntry?.name || (contracts.size === 1 ? contracts.keys().next().value : null);
            }
        }
        if (!name && contracts.size === 1) {
            name = contracts.keys().next().value;
        }
        return contracts.has(name) ? [{ ...contracts.get(name), localName: target.name }] : [];
    });
    return [...new Map(matches.map(target => [target.name, target])).values()];
}

export function inputContractViolations(block, testFile, rootDir, sourceFile, contracts) {
    const violations = [];
    block.callback.traverse({
        CallExpression(call) {
            const targets = sourceTargets(call, testFile, rootDir, sourceFile, contracts);
            for (const target of targets) {
                target.parameters.forEach((param, index) => {
                    const argumentsToCheck = param.rest ? call.node.arguments.slice(index) : [call.node.arguments[index]];
                    const values = argumentsToCheck.flatMap(argument => argument ? alternatives(argument, call.scope) : [{ node: { type: 'Identifier', name: 'undefined' }, scope: call.scope }]);
                    for (const value of values) {
                        const reason = mismatch(value.node, value.scope, param, param.name);
                        if (reason) {
                            const field = reason.split(' requires ')[0];
                            const evidence = target.requestEvidence?.find(item => item.access.startsWith(field + '.')) ||
                                target.requestEvidence?.find(item => item.access === field);
                            violations.push({ functionName: target.name, parameter: param.name, reason, callStart: call.node.start, evidence });
                        }
                    }
                });
            }
        }
    });
    return violations;
}
