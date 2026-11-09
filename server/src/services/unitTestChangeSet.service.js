import { createHash } from 'node:crypto';
import generateModule from '@babel/generator';
import { parseJavaScriptCode } from './babelParser.service.js';
import { existingTestContractsPreserved } from './unitTestVerification.service.js';
import { ServiceError } from '../utils/serviceError.js';

const generate = generateModule.default || generateModule;
export const testContentHash = content => createHash('sha256').update(content).digest('hex');

// Only generated candidates pass through this cleanup. Existing files and direct
// Apply requests retain the strict composition guard below. AST comment ranges
// avoid altering directive text in strings, snapshots or template literals.
export function removeGeneratedNoCheckDirective(code, testFile = '') {
    const parsed = parseJavaScriptCode(code, {filePath: testFile});
    if (!parsed.success) return code;
    const comments = (parsed.ast.comments || []).filter(comment =>
        comment.type === 'CommentLine' && /^\s*@ts-nocheck\b/.test(comment.value));
    let result = code;
    for (const comment of comments.sort((a,b) => b.start - a.start)) {
        result = result.slice(0,comment.start) + result.slice(comment.end);
    }
    return result;
}
const signature = node => JSON.stringify(node, (key, value) => ['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(key) ? undefined : value);
const sameModule = (a,b) => a === b || (a.startsWith('.') && b.startsWith('.') && a.replace(/\.[cm]?[jt]sx?$/,'') === b.replace(/\.[cm]?[jt]sx?$/,''));

function unwrapExpression(node) {
    let curr = node;
    while (curr && (curr.type === 'TSAsExpression' || curr.type === 'TSTypeAssertion' || curr.type === 'TypeCastExpression' || curr.type === 'ParenthesizedExpression')) {
        curr = curr.expression;
    }
    return curr;
}

function extractRequireInfo(node) {
    const unwrapped = unwrapExpression(node);
    if (!unwrapped || typeof unwrapped !== 'object') return null;
    if (unwrapped.type === 'CallExpression' && unwrapped.callee?.type === 'Identifier' && unwrapped.callee.name === 'require' && unwrapped.arguments?.[0]?.type === 'StringLiteral') {
        return { source: unwrapped.arguments[0].value, member: null };
    }
    if (unwrapped.type === 'MemberExpression') {
        const base = extractRequireInfo(unwrapped.object);
        if (base) {
            const propName = unwrapped.property?.name || (unwrapped.property?.type === 'StringLiteral' ? unwrapped.property.value : null);
            return {
                source: base.source,
                member: base.member ? `${base.member}.${propName}` : propName
            };
        }
    }
    return null;
}

function isImportOrRequireStatement(node) {
    if (!node) return false;
    if (node.type === 'ImportDeclaration') return true;
    if (node.type === 'VariableDeclaration') {
        return (node.declarations || []).some(decl => extractRequireInfo(decl.init) !== null);
    }
    if (node.type === 'ExpressionStatement' && node.expression?.type === 'CallExpression') {
        const unwrapped = unwrapExpression(node.expression);
        const callee = unwrapped.callee;
        if (callee?.type === 'Identifier' && callee.name === 'require') return true;
        let obj = callee;
        while (obj?.type === 'MemberExpression') obj = obj.object;
        if (['jest', 'vi'].includes(obj?.name)) return true;
    }
    return false;
}

function containsTest(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'CallExpression') {
        let callee = node.callee;
        while (['MemberExpression','CallExpression'].includes(callee?.type)) callee = callee.object || callee.callee;
        if (['test','it','fit','xit','xtest'].includes(callee?.name)) return true;
    }
    return Object.entries(node).some(([key,value]) => !['loc','comments','tokens'].includes(key) && (Array.isArray(value) ? value.some(containsTest) : containsTest(value)));
}
function declaration(statement) {
    const call = statement?.type === 'ExpressionStatement' && statement.expression;
    if (call?.type !== 'CallExpression') return null;
    let callee = call.callee;
    while (callee?.type === 'MemberExpression') callee = callee.object;
    if (!['describe','test','it','xit','xtest'].includes(callee?.name) || call.arguments[0]?.type !== 'StringLiteral') return null;
    const callback = call.arguments.find(arg => ['ArrowFunctionExpression','FunctionExpression'].includes(arg.type));
    return { type: callee.name === 'describe' ? 'suite' : 'test', name: call.arguments[0].value, callback, call };
}

export function applyTestRepairEdits(original, repairs = []) {
    let content = original;
    let boundary = original.length;
    for (const edit of [...repairs].sort((a,b) => b.start - a.start)) {
        if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end > boundary || edit.start >= edit.end ||
            typeof edit.replacement !== 'string' || testContentHash(original.slice(edit.start,edit.end)) !== edit.beforeHash) throw new Error('Stale or overlapping test repair. Regenerate and review the proposal.');
        content = content.slice(0,edit.start) + edit.replacement + content.slice(edit.end);
        boundary = edit.start;
    }
    return content;
}

// A batch or refinement may assemble the same additions in several passes.
// Allow different separators at insertion boundaries, while matching every
// byte of the original file and each approved addition in order.
function matchesReviewedLayout(original, insertions, reviewed) {
    const parts = [];
    let previous = 0;
    for (const [position, additions] of insertions) {
        parts.push(original.slice(previous, position), ...additions);
        previous = position;
    }
    parts.push(original.slice(previous));

    let cursor = 0;
    const whitespace = /[ \t\r\n]*/y;
    for (const [index, part] of parts.entries()) {
        if (index > 0) {
            whitespace.lastIndex = cursor;
            const run = whitespace.exec(reviewed)[0];
            const prefix = /^[ \t\r\n]*/.exec(part)[0];
            if (part === prefix && index < parts.length - 1) {
                const offset = run.indexOf(part);
                if (offset < 0) return false;
                cursor += offset;
            } else {
                if (!run.endsWith(prefix)) return false;
                cursor += run.length - prefix.length;
            }
        }
        if (!reviewed.startsWith(part, cursor)) return false;
        cursor += part.length;
    }
    return cursor === reviewed.length;
}

/** Preserve the original bytes and insert only novel declarations. A model's
 * purported full file is evidence for additions, never replacement authority. */
export function assembleUnitTestCandidate({ original = '', proposed = '', testFile = '', repairs = [], strictRepairs = false, preserveReviewedLayout = false }) {
    const repaired = applyTestRepairEdits(original, repairs);
    const base = parseJavaScriptCode(repaired, { filePath: testFile });
    const next = parseJavaScriptCode(proposed, { filePath: testFile });
    if (!base.success || !next.success) throw new Error('Test syntax must be repaired explicitly before composing this proposal.');
    const disablesChecking = ast => ast.comments?.some(comment => comment.type === 'CommentLine' && /^\s*@ts-nocheck\b/.test(comment.value));
    if (!disablesChecking(base.ast) && disablesChecking(next.ast)) throw new ServiceError('A test proposal must not introduce @ts-nocheck. Repair the actual TypeScript issue.',422,'INVALID_TEST_PROPOSAL');
    if (!original.trim()) return { schemaVersion:3,testFile,content: proposed, baseHash: testContentHash(original), candidateHash: testContentHash(proposed), additions: [], repairs, needsReview: [] };
    const inserts = new Map();
    const additions = [];
    const needsReview = [];
    const inlinePositions = new Set();
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const add = (position,text) => inserts.set(position,[...(inserts.get(position) || []),text.replace(/\r?\n/g,eol)]);
    const addInline = (position, text) => {
        inlinePositions.add(position);
        inserts.set(position, [...(inserts.get(position) || []), text]);
    };

    const originalBindings = new Map();
    const existingCjsDestructures = new Map();

    for (const node of base.ast.program.body) {
        if (node.type === 'ImportDeclaration') {
            for (const spec of node.specifiers) {
                const importedName = spec.type === 'ImportDefaultSpecifier' ? 'default' : (spec.type === 'ImportNamespaceSpecifier' ? '*' : (spec.imported?.name || spec.imported?.value));
                originalBindings.set(spec.local.name, {
                    source: node.source.value,
                    spec: signature(spec),
                    isRequire: false,
                    importedName,
                    localName: spec.local.name,
                    node
                });
            }
        } else if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations || []) {
                const reqInfo = extractRequireInfo(decl.init);
                if (reqInfo) {
                    if (decl.id.type === 'ObjectPattern') {
                        const propList = [];
                        for (const prop of decl.id.properties || []) {
                            if (prop.type === 'ObjectProperty') {
                                const localName = prop.value?.name || (prop.value?.type === 'AssignmentPattern' ? prop.value.left?.name : null) || prop.key?.name;
                                const importedName = prop.key?.name || prop.key?.value;
                                if (localName) {
                                    originalBindings.set(localName, {
                                        source: reqInfo.source,
                                        member: reqInfo.member,
                                        spec: signature(prop),
                                        isRequire: true,
                                        isDestructure: true,
                                        importedName,
                                        localName,
                                        declarationNode: node,
                                        declaratorNode: decl,
                                        propertyNode: prop
                                    });
                                    propList.push({ prop, localName, importedName });
                                }
                            }
                        }
                        if (propList.length > 0 && !reqInfo.member) {
                            existingCjsDestructures.set(reqInfo.source, {
                                declarationNode: node,
                                declaratorNode: decl,
                                properties: propList,
                                objectPattern: decl.id
                            });
                        }
                    } else if (decl.id.type === 'Identifier') {
                        originalBindings.set(decl.id.name, {
                            source: reqInfo.source,
                            member: reqInfo.member,
                            spec: signature(decl.id),
                            isRequire: true,
                            isDestructure: false,
                            importedName: reqInfo.member || 'default',
                            localName: decl.id.name,
                            declarationNode: node,
                            declaratorNode: decl
                        });
                    }
                }
            }
        }
    }

    const isBaseCommonJs = base.ast.program.body.some(n => n.type === 'VariableDeclaration' && (n.declarations || []).some(d => extractRequireInfo(d.init) !== null)) && !base.ast.program.body.some(n => n.type === 'ImportDeclaration');
    const importBlockPosition = base.ast.program.body.find(n => !isImportOrRequireStatement(n))?.start ?? repaired.length;

    function merge(oldStatements, statements, position, parents = []) {
        const known = new Set(oldStatements.map(signature));
        const names = new Map();
        for (const node of oldStatements) {
            const info = declaration(node);
            if (info) { const key = `${info.type}:${info.name}`; names.set(key,[...(names.get(key)||[]),{node,...info}]); }
        }
        for (const node of statements) {
            if (known.has(signature(node))) continue;
            if (node.type === 'ImportDeclaration') {
                const missing = [];
                for (const spec of node.specifiers) {
                    const localName = spec.local.name;
                    const importedName = spec.type === 'ImportDefaultSpecifier' ? 'default' : (spec.type === 'ImportNamespaceSpecifier' ? '*' : (spec.imported?.name || spec.imported?.value));
                    const existing = originalBindings.get(localName);
                    if (!existing) {
                        missing.push(spec);
                        originalBindings.set(localName, { source: node.source.value, spec: signature(spec), isRequire: false, importedName, localName });
                    } else {
                        const moduleMatches = sameModule(existing.source, node.source.value);
                        const specMatches = existing.spec === signature(spec) || (existing.importedName && existing.importedName === importedName);
                        if (!moduleMatches || !specMatches) {
                            throw new Error(`Conflicting import binding '${localName}'. Review the test setup.`);
                        }
                    }
                }
                if (missing.length || !node.specifiers.length) {
                    if (isBaseCommonJs) {
                        const cjsEntry = [...existingCjsDestructures.entries()].find(([mod]) => sameModule(mod, node.source.value))?.[1];
                        const namedSpecs = missing.filter(s => s.type === 'ImportSpecifier');
                        const defaultSpec = missing.find(s => s.type === 'ImportDefaultSpecifier');
                        if (namedSpecs.length > 0 && cjsEntry && cjsEntry.properties.length > 0) {
                            const lastProp = cjsEntry.properties[cjsEntry.properties.length - 1].prop;
                            const newPropsText = namedSpecs.map(s => s.imported.name === s.local.name ? s.local.name : `${s.imported.name}: ${s.local.name}`).join(', ');
                            addInline(lastProp.end, `, ${newPropsText}`);
                            for (const s of namedSpecs) {
                                cjsEntry.properties.push({ prop: { end: lastProp.end }, localName: s.local.name, importedName: s.imported.name });
                            }
                        } else if (namedSpecs.length > 0) {
                            const newPropsText = namedSpecs.map(s => s.imported.name === s.local.name ? s.local.name : `${s.imported.name}: ${s.local.name}`).join(', ');
                            add(importBlockPosition, `const { ${newPropsText} } = require('${node.source.value}');`);
                        }
                        if (defaultSpec) {
                            add(importBlockPosition, `const ${defaultSpec.local.name} = require('${node.source.value}');`);
                        }
                        if (!node.specifiers.length) {
                            add(importBlockPosition, `require('${node.source.value}');`);
                        }
                    } else {
                        add(importBlockPosition, generate({ ...node, specifiers: missing }).code);
                    }
                }
                continue;
            }

            if (node.type === 'VariableDeclaration') {
                const reqDecls = (node.declarations || []).map(decl => ({ decl, reqInfo: extractRequireInfo(decl.init) })).filter(item => item.reqInfo !== null);
                if (reqDecls.length > 0) {
                    for (const { decl, reqInfo } of reqDecls) {
                        if (decl.id.type === 'ObjectPattern') {
                            const missingProps = [];
                            for (const prop of decl.id.properties || []) {
                                if (prop.type === 'ObjectProperty') {
                                    const localName = prop.value?.name || (prop.value?.type === 'AssignmentPattern' ? prop.value.left?.name : null) || prop.key?.name;
                                    const importedName = prop.key?.name || prop.key?.value;
                                    const existing = originalBindings.get(localName);
                                    if (!existing) {
                                        missingProps.push({ prop, localName, importedName });
                                        originalBindings.set(localName, {
                                            source: reqInfo.source,
                                            member: reqInfo.member,
                                            spec: signature(prop),
                                            isRequire: true,
                                            isDestructure: true,
                                            importedName,
                                            localName
                                        });
                                    } else {
                                        const moduleMatches = sameModule(existing.source, reqInfo.source);
                                        const propMatches = existing.importedName ? existing.importedName === importedName : existing.spec === signature(prop);
                                        if (!moduleMatches || !propMatches) {
                                            throw new Error(`Conflicting import binding '${localName}'. Review the test setup.`);
                                        }
                                    }
                                }
                            }
                            if (missingProps.length > 0) {
                                const cjsEntry = [...existingCjsDestructures.entries()].find(([mod]) => sameModule(mod, reqInfo.source))?.[1];
                                if (cjsEntry && cjsEntry.properties.length > 0) {
                                    const lastProp = cjsEntry.properties[cjsEntry.properties.length - 1].prop;
                                    const newPropsText = missingProps.map(m => generate(m.prop).code).join(', ');
                                    addInline(lastProp.end, `, ${newPropsText}`);
                                    for (const m of missingProps) {
                                        cjsEntry.properties.push({ prop: { end: lastProp.end }, localName: m.localName, importedName: m.importedName });
                                    }
                                } else {
                                    const newPropsText = missingProps.map(m => generate(m.prop).code).join(', ');
                                    const newStmt = `const { ${newPropsText} } = require('${reqInfo.source}');`;
                                    add(importBlockPosition, newStmt);
                                    existingCjsDestructures.set(reqInfo.source, {
                                        properties: missingProps.map(m => ({ prop: m.prop, localName: m.localName, importedName: m.importedName }))
                                    });
                                }
                            }
                        } else if (decl.id.type === 'Identifier') {
                            const localName = decl.id.name;
                            const existing = originalBindings.get(localName);
                            if (!existing) {
                                originalBindings.set(localName, {
                                    source: reqInfo.source,
                                    member: reqInfo.member,
                                    spec: signature(decl.id),
                                    isRequire: true,
                                    isDestructure: false,
                                    importedName: reqInfo.member || 'default',
                                    localName
                                });
                                add(importBlockPosition, generate({ type: 'VariableDeclaration', kind: node.kind || 'const', declarations: [decl] }).code);
                            } else {
                                const moduleMatches = sameModule(existing.source, reqInfo.source);
                                if (!moduleMatches) {
                                    throw new Error(`Conflicting import binding '${localName}'. Review the test setup.`);
                                }
                            }
                        }
                    }
                    continue;
                }
            }

            const info = declaration(node);
            const matches = info && names.get(`${info.type}:${info.name}`);
            if (info?.type === 'suite' && !containsTest(info.callback?.body)) {
                needsReview.push({type:'ADD_TEST',testName:[...parents,info.name].join(' '),reason:'The proposed suite contains no executable test cases.'});
                continue;
            }
            if (matches?.length) {
                if (matches.length !== 1 || info.type === 'test') {
                    const testName = [...parents,info.name].join(' ');
                    if (strictRepairs || !repairs.some(repair => repair.testName === testName)) needsReview.push({type:'REPAIR_TEST',testName,reason:'An existing case differs. Preserve it until a baseline failure and contract justify a scoped repair.'});
                    continue;
                }
                const existing = matches[0];
                if (existing.callback?.body.type !== 'BlockStatement' || info.callback?.body.type !== 'BlockStatement' || signature(existing.call.callee) !== signature(info.call.callee)) throw new Error('Ambiguous suite modification. Preserve the original suite and review this proposal.');
                merge(existing.callback.body.body,info.callback.body.body,existing.callback.body.end - 1,[...parents,info.name]);
                continue;
            }
            if (!info) {
                const bindingName = node.id?.name || node.declarations?.[0]?.id?.name;
                if (bindingName && oldStatements.some(old => old.id?.name === bindingName || old.declarations?.some(d => d.id?.name === bindingName))) throw new Error(`Existing helper '${bindingName}' requires an explicit setup repair.`);
                if (parents.length && /^(?:before|after)(?:Each|All)$/.test(node.expression?.callee?.name || '')) throw new Error('A shared hook change requires an explicit setup repair.');
            }
            const text = proposed.slice(node.start,node.end);
            add(position,text);
            additions.push({type:info?.type === 'test' || info?.type === 'suite' ? 'ADD_TEST' : 'ADD_SETUP',testName:info ? [...parents,info.name].join(' ') : null});
            known.add(signature(node));
        }
    }
    merge(base.ast.program.body,next.ast.program.body,repaired.length);
    let content = repaired;
    const insertions = [...inserts].sort((a,b) => a[0]-b[0]);
    if (preserveReviewedLayout && matchesReviewedLayout(repaired, insertions, proposed)) {
        content = proposed;
    } else {
        for (const [position, text] of insertions.reverse()) {
            if (inlinePositions.has(position)) {
                content = content.slice(0, position) + text.join(', ') + content.slice(position);
            } else {
                content = content.slice(0, position) + eol + text.join(eol + eol) + eol + content.slice(position);
            }
        }
    }
    if (!parseJavaScriptCode(content,{filePath:testFile}).success || !existingTestContractsPreserved(repaired,content)) throw new Error('The proposal changes existing test contracts outside the reviewed repair.');
    return {schemaVersion:3,testFile,content, baseHash:testContentHash(original), candidateHash:testContentHash(content), additions, repairs, needsReview };
}
