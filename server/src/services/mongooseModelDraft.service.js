import traverseModule from '@babel/traverse';
import path from 'node:path';
import { parseJavaScriptCode } from './babelParser.service.js';
import { analyzeMongooseSchemas } from './mongooseSchemaAnalyzer.service.js';

const traverse = traverseModule.default || traverseModule;

export function definesMongooseModel(sourceCode = '') {
    return /['"]mongoose['"]/.test(sourceCode) && analyzeMongooseSchemas(sourceCode).some(model => model.fields.length || model.complete);
}

/** Check only explicit object literals constructed with this model in a success case. */
export function mongooseDocumentFixtureViolations(callback, model, testFile, sourceFile) {
    const findings = [];
    callback.traverse({ NewExpression(p) {
        const { callee, arguments: args } = p.node;
        if (callee.type !== 'Identifier' || args[0]?.type !== 'ObjectExpression') return;
        const binding = p.scope.getBinding(callee.name)?.path;
        const declaration = binding?.node;
        const specifier = binding?.isImportDefaultSpecifier() ? binding.parent.source.value :
            binding?.isVariableDeclarator() && declaration.init?.callee?.name === 'require' ? declaration.init.arguments[0]?.value : null;
        if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;
        const withoutExtension = file => file.replace(/\.[cm]?[jt]sx?$/, '');
        if (withoutExtension(path.resolve(path.dirname(testFile), specifier)) !== withoutExtension(path.resolve(sourceFile))) return;
        const properties = args[0].properties;
        if (properties.some(prop => prop.type !== 'ObjectProperty' || prop.computed)) return;
        const supplied = new Map(properties.map(prop => [prop.key.name ?? prop.key.value, prop.value]));
        for (const field of model.fields) {
            const actual = supplied.get(field.path);
            if (field.transformsInput || field.array || field.type === 'Array' || field.nested) continue;
            if (field.required === true && !field.default && (!actual || actual.type === 'NullLiteral')) {
                findings.push({ line: p.node.loc.start.line, schemaLine: field.line, reason: `The document fixture omits required schema path '${field.path}'.` });
            } else if (field.enum?.every(value => typeof value === 'string') && field.type === 'String' &&
                actual?.type === 'StringLiteral' && !field.enum.includes(actual.value)) {
                findings.push({ line: p.node.loc.start.line, schemaLine: field.line, reason: `The document fixture uses an undeclared enum value for '${field.path}'.` });
            }
        }
    } });
    return findings;
}

/** A model test must exercise the installed Schema and Model implementations. */
export function preserveMongooseSchemaInDraft({ code, sourceCode, original = '', framework }) {
    if (!definesMongooseModel(sourceCode)) return code;
    const parsed = parseJavaScriptCode(code);
    if (!parsed.success) return code;
    const edits = [];
    const runner = framework === 'vitest' ? 'vi' : 'jest';
    traverse(parsed.ast, {
        CallExpression(call) {
            const { callee, arguments: args, start, end } = call.node;
            if (callee.type !== 'MemberExpression' || callee.computed || callee.object.name !== runner ||
                !['mock', 'doMock'].includes(callee.property.name) || args[0]?.value !== 'mongoose' ||
                original.includes(code.slice(start, end))) return;
            const factory = code.slice(start, end);
            if (/\b(?:requireActual|importActual)\b/.test(factory)) return;
            const load = runner === 'vi' ? "const namespace = await vi.importActual('mongoose');\n    const actual = namespace.default || namespace;" :
                "const actual = jest.requireActual('mongoose');";
            const exports = runner === 'vi' ? '{ ...namespace, connect: isolated.connect, createConnection: isolated.createConnection, default: isolated }' : 'isolated';
            edits.push({ start, end, text: `${runner}.${callee.property.name}('mongoose', ${runner === 'vi' ? 'async ' : ''}() => {
    ${load}
    const isolated = Object.create(actual);
    Object.defineProperties(isolated, {
        default: { value: isolated },
        model: { value: actual.model.bind(actual), writable: true },
        connect: { value: ${runner}.fn().mockResolvedValue(isolated), writable: true },
        createConnection: { value: ${runner}.fn(() => actual.createConnection()), writable: true },
    });
    return ${exports};
})` });
        },
    });
    for (const { start, end, text } of edits.reverse()) code = code.slice(0, start) + text + code.slice(end);
    return code;
}
