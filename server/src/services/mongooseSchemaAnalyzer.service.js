import traverseModule from '@babel/traverse';
import { parseJavaScriptCode } from './babelParser.service.js';

const traverse = traverseModule.default || traverseModule;
const key = property => property.type === 'ObjectProperty' && !property.computed
    ? property.key.name ?? property.key.value : undefined;
const dotted = node => node?.type === 'Identifier' ? node.name :
    node?.type === 'MemberExpression' && !node.computed ? [dotted(node.object), node.property.name].join('.') : null;

/** Read declarations only. Dynamic expressions stay unresolved and are never invoked. */
export function analyzeMongooseSchemas(sourceCode = '') {
    const parsed = parseJavaScriptCode(sourceCode);
    const models = [];
    if (!parsed.success) return models;
    const mongoose = new Set();
    const schemas = new Set();
    const modelFactories = new Set();
    const connections = new Set();

    const extractPatternAlias = (pattern, targetPropName) => {
        if (!pattern || pattern.type !== 'ObjectPattern') return null;
        for (const prop of pattern.properties || []) {
            if (key(prop) !== targetPropName) continue;
            if (prop.value?.type === 'Identifier') return prop.value.name;
            if (prop.value?.type === 'AssignmentPattern' && prop.value.left?.type === 'Identifier') return prop.value.left.name;
        }
        return null;
    };

    for (const statement of parsed.ast.program.body) {
        if (statement.type === 'ImportDeclaration' && statement.source.value === 'mongoose') {
            for (const specifier of statement.specifiers) {
                if (!specifier.imported) mongoose.add(specifier.local.name);
                if (specifier.imported?.name === 'Schema') schemas.add(specifier.local.name);
                if (specifier.imported?.name === 'model') modelFactories.add(specifier.local.name);
                if (specifier.imported?.name === 'connection') connections.add(specifier.local.name);
            }
        }
        const decls = statement.declaration?.declarations || statement.declarations || [];
        for (const declaration of decls) {
            const value = declaration.init;
            if (!value) continue;
            // Direct require('mongoose')
            if (value.callee?.name === 'require' && value.arguments?.[0]?.value === 'mongoose') {
                if (declaration.id?.type === 'Identifier') mongoose.add(declaration.id.name);
                if (declaration.id?.type === 'ObjectPattern') {
                    const sAlias = extractPatternAlias(declaration.id, 'Schema');
                    if (sAlias) schemas.add(sAlias);
                    const mAlias = extractPatternAlias(declaration.id, 'model');
                    if (mAlias) modelFactories.add(mAlias);
                    const cAlias = extractPatternAlias(declaration.id, 'connection');
                    if (cAlias) connections.add(cAlias);
                }
                continue;
            }
            // const Schema = require('mongoose').Schema; / const model = require('mongoose').model;
            if (value.type === 'MemberExpression' && !value.computed &&
                value.object?.callee?.name === 'require' && value.object.arguments?.[0]?.value === 'mongoose') {
                if (declaration.id?.type === 'Identifier') {
                    if (value.property?.name === 'Schema') schemas.add(declaration.id.name);
                    if (value.property?.name === 'model') modelFactories.add(declaration.id.name);
                    if (value.property?.name === 'connection') connections.add(declaration.id.name);
                }
                continue;
            }
            // const Schema = mongoose.Schema; / const S = mongoose.Schema; / const { Schema } = mongoose;
            if (value.type === 'Identifier' && mongoose.has(value.name)) {
                if (declaration.id?.type === 'ObjectPattern') {
                    const sAlias = extractPatternAlias(declaration.id, 'Schema');
                    if (sAlias) schemas.add(sAlias);
                    const mAlias = extractPatternAlias(declaration.id, 'model');
                    if (mAlias) modelFactories.add(mAlias);
                    const cAlias = extractPatternAlias(declaration.id, 'connection');
                    if (cAlias) connections.add(cAlias);
                }
                continue;
            }
            if (value.type === 'MemberExpression' && !value.computed &&
                value.object?.type === 'Identifier' && mongoose.has(value.object.name)) {
                if (declaration.id?.type === 'Identifier') {
                    if (value.property?.name === 'Schema') schemas.add(declaration.id.name);
                    if (value.property?.name === 'model') modelFactories.add(declaration.id.name);
                    if (value.property?.name === 'connection') connections.add(declaration.id.name);
                }
                continue;
            }
            // const db = mongoose.createConnection(...)
            if (value.type === 'CallExpression' && value.callee?.type === 'MemberExpression' && !value.callee.computed &&
                value.callee.object?.type === 'Identifier' && mongoose.has(value.callee.object.name) &&
                value.callee.property?.name === 'createConnection' && declaration.id?.type === 'Identifier') {
                connections.add(declaration.id.name);
            }
        }
    }
    const schemaConstructor = name => Boolean(name) && (
        schemas.has(name) ||
        [...mongoose].some(id => name === id + '.Schema')
    );
    const modelFactory = name => Boolean(name) && (
        modelFactories.has(name) ||
        [...mongoose].some(id => name === id + '.model' || name === id + '.connection.model') ||
        [...connections].some(id => name === id + '.model')
    );
    const resolve = (node, scope, limit = 8) => {
        if (node?.type !== 'Identifier' || limit <= 0) return node;
        const binding = scope.getBinding(node.name);
        const next = binding?.constant && binding.path.isVariableDeclarator() && binding.path.node.init;
        return next ? resolve(next, binding.path.scope, limit - 1) : node;
    };
    const literal = (node, scope) => {
        const value = resolve(node, scope);
        if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(value?.type)) return value.value;
        if (value?.type === 'NullLiteral') return null;
        if (value?.type === 'UnaryExpression' && value.operator === '-' && value.argument.type === 'NumericLiteral') return -value.argument.value;
        if (value?.type === 'ArrayExpression') {
            const values = value.elements.map(element => literal(element, scope));
            return values.includes(undefined) ? undefined : values;
        }
        return undefined;
    };

    const readSchema = (value, scope, depth = 0) => {
        const node = resolve(value, scope);
        const fields = [];
        const call = schemaConstructor(dotted(node?.callee));
        const definition = resolve(call ? node.arguments[0] : node, scope);
        const options = resolve(call ? node.arguments[1] : null, scope);
        if (depth > 6 || definition?.type !== 'ObjectExpression') return { fields, complete: false };
        let complete = true;
        for (const property of definition.properties) {
            const name = key(property);
            if (name === undefined) { complete = false; continue; }
            const field = resolve(property.value, scope);
            const entries = field.type === 'ObjectExpression' ? new Map(field.properties.map(prop => [key(prop), prop.value])) : null;
            const typeKey = options?.type === 'ObjectExpression' && options.properties.find(prop => key(prop) === 'typeKey');
            const type = entries?.get(literal(typeKey?.value, scope) || 'type');
            const declared = resolve(type || field, scope);
            const child = resolve(declared.type === 'ArrayExpression' ? declared.elements[0] : declared, scope);
            const nested = child?.type === 'ObjectExpression' || schemaConstructor(dotted(child?.callee))
                ? readSchema(child, scope, depth + 1) : null;
            const required = literal(entries?.get('required'), scope);
            const accepts = resolve(entries?.get('enum'), scope);
            const enumValues = literal(accepts?.type === 'ObjectExpression'
                ? accepts.properties.find(prop => key(prop) === 'values')?.value : accepts, scope);
            const ref = entries?.get('ref') || entries?.get('refPath');
            const minRaw = literal(entries?.get('min'), scope);
            const maxRaw = literal(entries?.get('max'), scope);
            const minLenRaw = literal(entries?.get('minlength') ?? entries?.get('minLength'), scope);
            const maxLenRaw = literal(entries?.get('maxlength') ?? entries?.get('maxLength'), scope);
            const minNum = Array.isArray(minRaw) ? minRaw[0] : minRaw;
            const maxNum = Array.isArray(maxRaw) ? maxRaw[0] : maxRaw;
            const minLenNum = Array.isArray(minLenRaw) ? minLenRaw[0] : minLenRaw;
            const maxLenNum = Array.isArray(maxLenRaw) ? maxLenRaw[0] : maxLenRaw;
            fields.push({ path: name, line: property.loc.start.line, type: declared.type === 'ArrayExpression' ? 'Array' : dotted(declared),
                ...(entries?.has('required') && { required: Array.isArray(required) ? required[0] : required ?? 'dynamic' }),
                ...(entries?.has('default') && { default: literal(entries.get('default'), scope) === undefined
                    ? { kind: 'dynamic' } : { kind: 'literal', value: literal(entries.get('default'), scope) } }),
                ...(Array.isArray(enumValues) && { enum: enumValues }),
                ...(typeof minNum === 'number' && { min: minNum }),
                ...(typeof maxNum === 'number' && { max: maxNum }),
                ...(typeof minLenNum === 'number' && { minlength: minLenNum }),
                ...(typeof maxLenNum === 'number' && { maxlength: maxLenNum }),
                ...(['set', 'trim', 'lowercase', 'uppercase', 'alias'].some(option => entries?.has(option)) && { transformsInput: true }),
                ...(ref && { reference: { kind: entries.has('ref') ? 'ref' : 'refPath', value: literal(ref, scope) ?? dotted(ref) } }),
                ...(nested && { nested: nested.fields, array: declared.type === 'ArrayExpression' }),
            });
            if (entries?.has(undefined) || (nested && !nested.complete)) complete = false;
        }
        return { fields, complete, collection: literal(options?.properties?.find(prop => key(prop) === 'collection')?.value, scope) };
    };

    traverse(parsed.ast, { CallExpression(p) {
        const calleeName = dotted(p.node.callee);
        if (p.node.arguments.length < 2) return;
        const [model, definition, collection] = p.node.arguments;
        const resolvedDef = resolve(definition, p.scope);
        const isDirectModelFactory = modelFactory(calleeName);
        const isConnModelFallback = !isDirectModelFactory && calleeName?.endsWith('.model') &&
            resolvedDef?.type === 'NewExpression' && schemaConstructor(dotted(resolvedDef.callee));
        if (!isDirectModelFactory && !isConnModelFallback) return;
        const schema = readSchema(definition, p.scope);
        models.push({ modelName: literal(model, p.scope) ?? null, collectionName: literal(collection, p.scope) ?? schema.collection ?? null,
            fields: schema.fields, complete: schema.complete,
            validation: 'Run actual document construction and validateSync(); a valid document has no validation error. Treat defaults and required checks marked dynamic as runtime behavior.',
        });
    } });
    return models;
}
