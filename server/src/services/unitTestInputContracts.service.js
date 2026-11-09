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
    if (node.type === 'MemberExpression') return getRootIdentifier(node.object);
    if (node.type === 'CallExpression') return getRootIdentifier(node.callee);
    return null;
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

        // Array methods: .map, .filter, .forEach, .reduce, .find, .some, .every
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
            const root = getRootIdentifier(node.callee.object);
            const method = node.callee.property?.name;
            if (['map', 'filter', 'forEach', 'reduce', 'find', 'some', 'every', 'flatMap'].includes(method) && root?.name) {
                for (const [pName, set] of aliases) {
                    if (set.has(root.name)) {
                        arrayParams.add(pName);
                        const cb = node.arguments[0];
                        if (cb && ['ArrowFunctionExpression', 'FunctionExpression'].includes(cb.type)) {
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

        // Direct property accesses: options.maxTurns
        if (node.type === 'MemberExpression' && !node.computed && node.object?.type === 'Identifier') {
            for (const [pName, set] of aliases) {
                if (set.has(node.object.name)) {
                    const prop = node.property?.name || (node.property?.type === 'StringLiteral' ? node.property.value : null);
                    if (prop && prop !== 'length') {
                        if (!directProperties.get(pName).has(prop)) {
                            directProperties.get(pName).set(prop, { kind: 'string', sampleValues: new Set() });
                        }
                    }
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

    return { arrayParams, itemProperties, directProperties };
}

export function sourceInputContracts(source, { rootDir, sourceFile } = {}) {
    const parsed = parseJavaScriptCode(source);
    if (!parsed.success) return { functions: new Map(), evidence: source };
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

    // Index top-level functions for specifier/export matching
    const topLevelFns = new Map();
    for (const item of parsed.ast.program.body) {
        if (item.type === 'FunctionDeclaration' && item.id?.name) {
            topLevelFns.set(item.id.name, item);
        } else if (item.type === 'VariableDeclaration') {
            for (const decl of item.declarations) {
                if (decl.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(decl.init?.type)) {
                    topLevelFns.set(decl.id.name, decl.init);
                }
            }
        }
    }

    const functions = new Map();

    for (const item of parsed.ast.program.body) {
        let entries = [];
        const jsdoc = parseJsdocComments(item.leadingComments || item.declaration?.leadingComments || []);

        if (item.type === 'ExportNamedDeclaration') {
            const declaration = item.declaration;
            if (declaration?.type === 'FunctionDeclaration') {
                entries = [[declaration.id.name, declaration]];
            } else if (declaration?.type === 'VariableDeclaration') {
                entries = declaration.declarations
                    .filter(d => d.id.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(d.init?.type))
                    .map(d => [d.id.name, d.init]);
            } else if (item.specifiers) {
                for (const spec of item.specifiers) {
                    const local = spec.local?.name;
                    const exp = spec.exported?.name || local;
                    if (topLevelFns.has(local)) entries.push([exp, topLevelFns.get(local)]);
                }
            }
        } else if (item.type === 'ExportDefaultDeclaration') {
            const decl = item.declaration;
            if (decl.type === 'FunctionDeclaration') {
                entries = [[decl.id?.name || 'default', decl]];
            } else if (['ArrowFunctionExpression', 'FunctionExpression'].includes(decl.type)) {
                entries = [['default', decl]];
            } else if (decl.type === 'Identifier' && topLevelFns.has(decl.name)) {
                entries = [[decl.name, topLevelFns.get(decl.name)]];
            }
        } else if (item.type === 'ExpressionStatement' && item.expression?.type === 'AssignmentExpression') {
            const left = item.expression.left;
            const right = item.expression.right;
            if (left.type === 'MemberExpression' && left.object?.name === 'module' && left.property?.name === 'exports') {
                if (right.type === 'ObjectExpression') {
                    for (const prop of right.properties) {
                        if (prop.type === 'ObjectProperty') {
                            const expName = prop.key?.name || prop.key?.value;
                            const val = prop.value;
                            if (['ArrowFunctionExpression', 'FunctionExpression'].includes(val?.type)) {
                                entries.push([expName, val]);
                            } else if (val?.type === 'Identifier' && topLevelFns.has(val.name)) {
                                entries.push([expName, topLevelFns.get(val.name)]);
                            }
                        }
                    }
                } else if (['ArrowFunctionExpression', 'FunctionExpression'].includes(right.type)) {
                    entries.push(['default', right]);
                } else if (right.type === 'Identifier' && topLevelFns.has(right.name)) {
                    entries.push([right.name, topLevelFns.get(right.name)]);
                }
            }
            if (left.type === 'MemberExpression' && (
                left.object?.name === 'exports' ||
                (left.object?.type === 'MemberExpression' && left.object.object?.name === 'module' && left.object.property?.name === 'exports')
            )) {
                const expName = left.property?.name || left.property?.value;
                if (expName) {
                    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(right.type)) {
                        entries.push([expName, right]);
                    } else if (right.type === 'Identifier' && topLevelFns.has(right.name)) {
                        entries.push([expName, topLevelFns.get(right.name)]);
                    }
                }
            }
        }

        for (const [name, fn] of entries) {
            const bodyInference = inferParamUsagesFromBody(fn, jsdoc);

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

                // 5. AST body object inference (only fill missing fields without overwriting TS/JSDoc nested structures)
                if (type.kind === 'unknown' || type.kind === 'object') {
                    const dMap = bodyInference.directProperties.get(pName);
                    if (dMap && dMap.size > 0) {
                        type.kind = 'object';
                        const fields = { ...(type.fields || {}) };
                        for (const [fName, fInfo] of dMap) {
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

            functions.set(name, { name, parameters });
        }
    }

    return { functions, evidence };
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
    return alternatives(call.node.callee, call.scope).flatMap(({ node, scope }) => {
        if (node?.type !== 'Identifier' || importedSource({ node: { callee: node }, scope }, testFile, rootDir) !== sourceFile) return [];
        const binding = scope.getBinding(node.name), name = binding.path.node.imported?.name;
        return contracts.has(name) ? [{ ...contracts.get(name), localName: node.name }] : [];
    });
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
                        if (reason) violations.push({ functionName: target.name, parameter: param.name, reason, callStart: call.node.start });
                    }
                });
            }
        }
    });
    return violations;
}
