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
    for (const statement of parsed.ast.program.body) {
        if (statement.type === 'ImportDeclaration' && statement.source.value === 'mongoose') {
            for (const specifier of statement.specifiers) {
                if (!specifier.imported) mongoose.add(specifier.local.name);
                if (specifier.imported?.name === 'Schema') schemas.add(specifier.local.name);
                if (specifier.imported?.name === 'model') modelFactories.add(specifier.local.name);
            }
        }
        for (const declaration of statement.declarations || []) {
            const value = declaration.init;
            if (value?.callee?.name !== 'require' || value.arguments?.[0]?.value !== 'mongoose') continue;
            if (declaration.id.type === 'Identifier') mongoose.add(declaration.id.name);
            for (const prop of declaration.id.properties || []) {
                if (key(prop) === 'Schema') schemas.add(prop.value.name);
                if (key(prop) === 'model') modelFactories.add(prop.value.name);
            }
        }
    }
    const schemaConstructor = name => schemas.has(name) || [...mongoose].some(id => name === id + '.Schema');
    const modelFactory = name => modelFactories.has(name) || [...mongoose].some(id => name === id + '.model');
    const resolve = (node, scope, limit = 8) => {
        if (node?.type !== 'Identifier' || limit <= 0) return node;
        const binding = scope.getBinding(node.name);
        const next = binding?.constant && binding.kind === 'const' && binding.path.isVariableDeclarator() && binding.path.node.init;
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
            fields.push({ path: name, line: property.loc.start.line, type: declared.type === 'ArrayExpression' ? 'Array' : dotted(declared),
                ...(entries?.has('required') && { required: Array.isArray(required) ? required[0] : required ?? 'dynamic' }),
                ...(entries?.has('default') && { default: literal(entries.get('default'), scope) === undefined
                    ? { kind: 'dynamic' } : { kind: 'literal', value: literal(entries.get('default'), scope) } }),
                ...(Array.isArray(enumValues) && { enum: enumValues }),
                ...(['set', 'trim', 'lowercase', 'uppercase', 'alias'].some(option => entries?.has(option)) && { transformsInput: true }),
                ...(ref && { reference: { kind: entries.has('ref') ? 'ref' : 'refPath', value: literal(ref, scope) ?? dotted(ref) } }),
                ...(nested && { nested: nested.fields, array: declared.type === 'ArrayExpression' }),
            });
            if (entries?.has(undefined) || (nested && !nested.complete)) complete = false;
        }
        return { fields, complete, collection: literal(options?.properties?.find(prop => key(prop) === 'collection')?.value, scope) };
    };

    traverse(parsed.ast, { CallExpression(p) {
        if (!modelFactory(dotted(p.node.callee)) || p.node.arguments.length < 2) return;
        const [model, definition, collection] = p.node.arguments;
        const schema = readSchema(definition, p.scope);
        models.push({ modelName: literal(model, p.scope) ?? null, collectionName: literal(collection, p.scope) ?? schema.collection ?? null,
            fields: schema.fields, complete: schema.complete,
            validation: 'Run actual document construction and validateSync(); a valid document has no validation error. Treat defaults and required checks marked dynamic as runtime behavior.',
        });
    } });
    return models;
}
