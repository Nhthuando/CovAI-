import traverseModule from '@babel/traverse';
import path from 'node:path';
import { parseJavaScriptCode } from './babelParser.service.js';
import { analyzeMongooseSchemas } from './mongooseSchemaAnalyzer.service.js';

const traverse = traverseModule.default || traverseModule;

export function definesMongooseModel(sourceCode = '') {
    return /['"]mongoose['"]/.test(sourceCode) && analyzeMongooseSchemas(sourceCode).some(model => model.fields.length || model.complete);
}

const VALID_OBJECT_ID_HEX = '507f1f77bcf86cd799439011';

function buildSampleValueForField(field) {
    if (!field) return 'sample';
    if (Array.isArray(field.enum) && field.enum.length > 0) {
        return field.enum[0];
    }
    if (field.array || field.type === 'Array') {
        if (Array.isArray(field.nested) && field.nested.length > 0) {
            return [buildValidMongooseDocumentFixture({ fields: field.nested })];
        }
        return [];
    }
    if (Array.isArray(field.nested) && field.nested.length > 0) {
        return buildValidMongooseDocumentFixture({ fields: field.nested });
    }
    const typeName = String(field.type || '');
    if (/ObjectId/i.test(typeName) || field.reference) {
        return VALID_OBJECT_ID_HEX;
    }
    if (/Number/i.test(typeName)) {
        if (typeof field.min === 'number') return field.min;
        return 1;
    }
    if (/Boolean/i.test(typeName)) {
        return true;
    }
    if (/Date/i.test(typeName)) {
        return '2025-01-01T00:00:00.000Z';
    }
    if (/Mixed|Object|Map/i.test(typeName)) {
        return {};
    }
    const lower = String(field.path || '').toLowerCase();
    if (lower.includes('email')) return 'sample@example.com';
    const minLen = typeof field.minlength === 'number' ? field.minlength : 0;
    const base = `sample-${field.path || 'value'}`;
    return base.length >= minLen ? base : base.padEnd(minLen, 'x');
}

export function buildValidMongooseDocumentFixture(model, options = {}) {
    const { omitDefaulted = false } = options;
    const doc = {};
    for (const field of model?.fields || []) {
        if (!field?.path) continue;
        if (omitDefaulted && field.default) continue;
        if (field.required === true || !omitDefaulted) {
            doc[field.path] = buildSampleValueForField(field);
        }
    }
    return doc;
}

/** Check only explicit object literals constructed with this model in a success case. */
export function mongooseDocumentFixtureViolations(callback, model, testFile, sourceFile) {
    const findings = [];
    callback.traverse({ NewExpression(p) {
        const { callee, arguments: args } = p.node;
        if (callee.type !== 'Identifier' || args[0]?.type !== 'ObjectExpression') return;
        const binding = p.scope.getBinding(callee.name)?.path;
        const declaration = binding?.node;
        let specifier = null;
        if (binding?.isImportDefaultSpecifier() || binding?.isImportSpecifier()) {
            specifier = binding.parent.source.value;
        } else if (binding?.isVariableDeclarator() && declaration.init?.callee?.name === 'require') {
            specifier = declaration.init.arguments[0]?.value;
        } else if (binding?.parentPath?.isObjectProperty() &&
            binding.parentPath.parentPath?.isObjectPattern() &&
            binding.parentPath.parentPath.parentPath?.isVariableDeclarator() &&
            binding.parentPath.parentPath.parentPath.node.init?.callee?.name === 'require') {
            specifier = binding.parentPath.parentPath.parentPath.node.init.arguments[0]?.value;
        }
        if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;
        const withoutExtension = file => file.replace(/\.[cm]?[jt]sx?$/, '');
        if (withoutExtension(path.resolve(path.dirname(testFile), specifier)) !== withoutExtension(path.resolve(sourceFile))) return;
        const properties = args[0].properties;
        if (properties.some(prop => prop.type !== 'ObjectProperty' || prop.computed)) return;
        const supplied = new Map(properties.map(prop => [prop.key.name ?? prop.key.value, prop.value]));
        for (const field of model.fields) {
            const actual = supplied.get(field.path);
            if (field.transformsInput || field.array || field.type === 'Array' || field.nested) continue;
            const isMissing = !actual || actual.type === 'NullLiteral' || (actual.type === 'Identifier' && actual.name === 'undefined');
            if (field.required === true && !field.default && isMissing) {
                findings.push({ line: p.node.loc.start.line, schemaLine: field.line, reason: `The document fixture omits required schema path '${field.path}'.` });
            } else if (/ObjectId/i.test(String(field.type || '')) && actual?.type === 'StringLiteral' && !/^[0-9a-fA-F]{24}$/.test(actual.value)) {
                findings.push({ line: p.node.loc.start.line, schemaLine: field.line, reason: `The document fixture uses an invalid ObjectId string for '${field.path}'.` });
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
                !['mock', 'doMock', 'unstable_mockModule'].includes(callee.property.name) || args[0]?.value !== 'mongoose' ||
                original.includes(code.slice(start, end))) return;
            const factory = code.slice(start, end);
            if (/\b(?:requireActual|importActual)\b/.test(factory)) return;
            const load = runner === 'vi' ? "const namespace = await vi.importActual('mongoose');\n    const actual = namespace.default || namespace;" :
                "const actual = jest.requireActual('mongoose');";
            const exports = runner === 'vi' ? '{ ...namespace, connect: isolated.connect, createConnection: isolated.createConnection, disconnect: isolated.disconnect, default: isolated }' : 'isolated';
            edits.push({ start, end, text: `${runner}.${callee.property.name}('mongoose', ${runner === 'vi' ? 'async ' : ''}() => {
    ${load}
    const isolated = Object.create(actual);
    Object.defineProperties(isolated, {
        default: { value: isolated },
        model: { value: actual.model.bind(actual), writable: true },
        connect: { value: ${runner}.fn().mockResolvedValue(isolated), writable: true },
        createConnection: { value: ${runner}.fn(() => actual.createConnection()), writable: true },
        disconnect: { value: ${runner}.fn().mockResolvedValue(undefined), writable: true },
    });
    return ${exports};
})` });
        },
    });
    for (const { start, end, text } of edits.reverse()) code = code.slice(0, start) + text + code.slice(end);
    return code;
}

export function proposeMongooseModelFallbackTests({
    sourceCode = '',
    sourceFile = '',
    testFile = '',
    framework = 'jest',
    cleanImportPath = '',
    existingContent = ''
} = {}) {
    if (!definesMongooseModel(sourceCode)) return null;
    const models = analyzeMongooseSchemas(sourceCode);
    const primaryModel = models.find(m => m.fields.length || m.complete) || models[0];
    if (!primaryModel) return null;

    const isVitest = framework === 'vitest';
    const isTs = /\.[cm]?tsx?$/i.test(sourceFile || '') || /\.[cm]?tsx?$/i.test(testFile || '');
    const hasEsm = /^\s*(?:import|export)\s+/m.test(sourceCode);
    const hasCjs = /module\.exports|exports\.[a-zA-Z0-9_$]+\s*=/.test(sourceCode);
    const isCommonJS = !isVitest && !isTs && !hasEsm && hasCjs;

    const parsedSource = parseJavaScriptCode(sourceCode);
    let importExpr = `const Model = require('${cleanImportPath}');`;
    let modelRef = 'Model';
    if (parsedSource.success) {
        const body = parsedSource.ast.program.body;
        const cjsObj = body.find(st =>
            st.type === 'ExpressionStatement' &&
            st.expression?.type === 'AssignmentExpression' &&
            st.expression.left?.object?.name === 'module' &&
            st.expression.left?.property?.name === 'exports' &&
            st.expression.right?.type === 'ObjectExpression'
        );
        const namedEsm = body.find(st => st.type === 'ExportNamedDeclaration');
        if (cjsObj) {
            const firstKey = cjsObj.expression.right.properties.find(p => p.key?.name || p.key?.value);
            const propName = firstKey?.key?.name || firstKey?.key?.value || primaryModel.modelName || 'Model';
            importExpr = isCommonJS
                ? `const { ${propName} } = require('${cleanImportPath}');`
                : `import { ${propName} } from '${cleanImportPath}';`;
            modelRef = propName;
        } else if (namedEsm && !body.some(st => st.type === 'ExportDefaultDeclaration')) {
            const propName = namedEsm.declaration?.id?.name ||
                namedEsm.declaration?.declarations?.[0]?.id?.name ||
                namedEsm.specifiers?.[0]?.exported?.name ||
                primaryModel.modelName || 'Model';
            importExpr = isCommonJS
                ? `const { ${propName} } = require('${cleanImportPath}');`
                : `import { ${propName} } from '${cleanImportPath}';`;
            modelRef = propName;
        } else if (!isCommonJS) {
            importExpr = `import Model from '${cleanImportPath}';`;
            modelRef = 'Model';
        }
    } else if (!isCommonJS) {
        importExpr = `import Model from '${cleanImportPath}';`;
    }

    const validFixture = buildValidMongooseDocumentFixture(primaryModel, { omitDefaulted: false });
    const defaultFixture = buildValidMongooseDocumentFixture(primaryModel, { omitDefaulted: true });
    const literalDefaults = primaryModel.fields.filter(f => f.default?.kind === 'literal');
    const requiredField = primaryModel.fields.find(f => f.required === true && !f.default && !f.nested && !f.array && f.type !== 'Array');
    const enumField = primaryModel.fields.find(f => Array.isArray(f.enum) && f.enum.length > 0 && f.type === 'String');

    const runnerImport = isVitest
        ? `import { describe, test, expect, vi } from 'vitest';\n`
        : (isTs ? `import { describe, test, expect } from '@jest/globals';\n` : '');
    const mongoosePreserveMock = isVitest
        ? `vi.mock('mongoose', async () => {\n  const namespace = await vi.importActual('mongoose');\n  const actual = namespace.default || namespace;\n  const isolated = Object.create(actual);\n  Object.defineProperties(isolated, {\n    default: { value: isolated },\n    model: { value: actual.model.bind(actual), writable: true },\n    connect: { value: vi.fn().mockResolvedValue(isolated), writable: true },\n    createConnection: { value: vi.fn(() => actual.createConnection()), writable: true },\n    disconnect: { value: vi.fn().mockResolvedValue(undefined), writable: true },\n  });\n  return { ...namespace, connect: isolated.connect, createConnection: isolated.createConnection, disconnect: isolated.disconnect, default: isolated };\n});\n`
        : `jest.mock('mongoose', () => {\n  const actual = jest.requireActual('mongoose');\n  const isolated = Object.create(actual);\n  Object.defineProperties(isolated, {\n    default: { value: isolated },\n    model: { value: actual.model.bind(actual), writable: true },\n    connect: { value: jest.fn().mockResolvedValue(isolated), writable: true },\n    createConnection: { value: jest.fn(() => actual.createConnection()), writable: true },\n    disconnect: { value: jest.fn().mockResolvedValue(undefined), writable: true },\n  });\n  return isolated;\n});\n`;

    const tests = [];
    tests.push(`    test('validates a complete ${primaryModel.modelName || 'model'} document with validateSync()', () => {
        const doc = new ${modelRef}(${JSON.stringify(validFixture)});
        const err = doc.validateSync();
        expect(err).toBeUndefined();
    });`);

    if (literalDefaults.length > 0) {
        const defaultAssertions = literalDefaults
            .map(f => `        expect(doc.${f.path}).toBe(${JSON.stringify(f.default.value)});`)
            .join('\n');
        tests.push(`    test('applies declared schema default values when omitted', () => {
        const doc = new ${modelRef}(${JSON.stringify(defaultFixture)});
        expect(doc.validateSync()).toBeUndefined();
${defaultAssertions}
    });`);
    }

    if (requiredField) {
        const missingFixture = { ...validFixture };
        delete missingFixture[requiredField.path];
        tests.push(`    test('rejects missing required path ${requiredField.path}', () => {
        const doc = new ${modelRef}(${JSON.stringify(missingFixture)});
        const err = doc.validateSync();
        expect(err).toBeDefined();
        expect(err.errors['${requiredField.path}']).toBeDefined();
    });`);
    }

    if (enumField) {
        const invalidEnumFixture = { ...validFixture, [enumField.path]: '__INVALID_ENUM_VALUE__' };
        tests.push(`    test('rejects invalid enum value for ${enumField.path}', () => {
        const doc = new ${modelRef}(${JSON.stringify(invalidEnumFixture)});
        const err = doc.validateSync();
        expect(err).toBeDefined();
        expect(err.errors['${enumField.path}']).toBeDefined();
    });`);
    }

    if (primaryModel.modelName) {
        tests.push(`    test('exposes schema and modelName metadata', () => {
        expect(${modelRef}.modelName).toBe(${JSON.stringify(primaryModel.modelName)});
        expect(${modelRef}.schema).toBeDefined();
    });`);
    }

    const suiteBlock = `describe('${primaryModel.modelName || 'MongooseModel'} schema validation', () => {\n${tests.join('\n\n')}\n});\n`;

    if (existingContent && existingContent.trim()) {
        const full = existingContent.trimEnd() + '\n\n' + suiteBlock;
        return {
            explanation: `Mongoose schema validation tests for ${primaryModel.modelName || 'model'} using real Schema and validateSync().`,
            suggestedTestCode: suiteBlock.trim(),
            fullUpdatedContent: full
        };
    }

    const fullCode = `${runnerImport}${mongoosePreserveMock}${importExpr}\n\n${suiteBlock}`;
    return {
        explanation: `Mongoose schema validation tests for ${primaryModel.modelName || 'model'} using real Schema and validateSync().`,
        suggestedTestCode: fullCode.trim(),
        fullUpdatedContent: fullCode
    };
}
