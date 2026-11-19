import traverseModule from '@babel/traverse';
import { parseJavaScriptCode } from './babelParser.service.js';

const traverse = traverseModule.default || traverseModule;

function vitestMethod(callee, scope) {
    if (callee?.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier') return null;
    const name = callee.object.name;
    const binding = scope.getBinding(name);
    if (!binding ? name !== 'vi' : !(binding.path.isImportSpecifier() &&
        binding.path.node.imported.name === 'vi' && binding.path.parent.source.value === 'vitest')) return null;
    return callee.property.name;
}

function inspect(ast) {
    const issues = [];
    traverse(ast, { CallExpression(call) {
        const method = vitestMethod(call.node.callee, call.scope);
        if (!['mock', 'hoisted'].includes(method)) return;
        const index = method === 'mock' ? 1 : 0;
        const factory = call.get('arguments.' + index);
        if (method === 'mock' && !factory.node) return;
        if (!factory.isFunction()) {
            issues.push({ call, reason: 'Use an inline Vitest factory.', bindings: [] });
            return;
        }
        if (method === 'hoisted') {
            const parent = call.parentPath;
            if (!parent.isExpressionStatement() && !parent.isVariableDeclarator() ||
                !parent.scope.path.isProgram()) {
                issues.push({ call, reason: 'vi.hoisted must run at module scope.', bindings: [] });
            }
        }
        const bindings = new Set();
        factory.traverse({
            Function(inner) {
                // Immediately invoked functions execute while the factory is being evaluated.
                if (!inner.parentPath.isCallExpression() || inner.parent.callee !== inner.node) inner.skip();
            },
            ReferencedIdentifier(reference) {
                const binding = reference.scope.getBinding(reference.node.name);
                if (!binding?.scope.path.isProgram()) return;
                if (binding.path.parentPath?.isImportDeclaration() && binding.path.parent.source.value === 'vitest') return;
                const init = binding.path.node.init;
                if (vitestMethod(init?.callee, binding.scope) === 'hoisted' && init.start < call.node.start) return;
                bindings.add(binding);
            },
        });
        if (bindings.size) issues.push({ call,
            reason: method === 'mock' ? 'A hoisted Vitest factory reads bindings before normal module initialization.' :
                'A vi.hoisted initializer reads bindings before they are available.', bindings: [...bindings], method });
    } });
    return issues;
}

export function vitestHoistingFindings(ast) {
    return inspect(ast).map(({ call, reason, bindings }) => ({
        line: call.node.loc.start.line, reason,
        evidence: bindings.map(binding => binding.identifier.name),
    }));
}

function movable(node, scope) {
    if (!node) return false;
    if (['StringLiteral', 'BooleanLiteral', 'NumericLiteral', 'NullLiteral', 'ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) return true;
    if (node.type === 'ObjectExpression') return node.properties.every(prop =>
        prop.type === 'ObjectProperty' && !prop.computed && movable(prop.value, scope));
    if (node.type === 'ArrayExpression') return node.elements.every(item => movable(item, scope));
    if (node.type !== 'CallExpression') return false;
    if (vitestMethod(node.callee, scope) === 'fn') return node.arguments.every(arg => movable(arg, scope));
    const { callee } = node;
    return callee.type === 'MemberExpression' && !callee.computed &&
        /^mock(?:ReturnValue|ResolvedValue|RejectedValue|Implementation)(?:Once)?$/.test(callee.property.name) &&
        movable(callee.object, scope) && node.arguments.every(arg => movable(arg, scope));
}

/** Move only independent mock data. Factories and assertion bindings retain their identity. */
export function hoistGeneratedVitestMocks(code, { framework, original = '' } = {}) {
    if (framework !== 'vitest' || !code) return code;
    const parsed = parseJavaScriptCode(code);
    if (!parsed.success) return code;
    const edits = new Map();
    for (const issue of inspect(parsed.ast).filter(issue => issue.method === 'mock')) {
        const mock = issue.call.parentPath;
        if (!mock.isExpressionStatement() || !mock.parentPath.isProgram() ||
            original.includes(code.slice(mock.node.start, mock.node.end))) continue;
        for (const binding of issue.bindings) {
            const declaration = binding.path.parentPath;
            const value = binding.path.node.init;
            if (!binding.constant || !binding.path.isVariableDeclarator() || binding.path.node.id.type !== 'Identifier' ||
                declaration.node.declarations.length !== 1 || !['const', 'let'].includes(declaration.node.kind) ||
                !movable(value, binding.scope) || original.includes(code.slice(declaration.node.start, declaration.node.end))) continue;
            const previous = edits.get(declaration.node.start);
            if (!previous || previous.before > mock.node.start) edits.set(declaration.node.start, {
                name: binding.identifier.name, end: declaration.node.end, before: mock.node.start,
                init: code.slice(value.start, value.end), runner: issue.call.node.callee.object.name,
            });
        }
    }
    const byOffset = new Map();
    for (const [start, edit] of edits) {
        byOffset.set(start, { ...byOffset.get(start), end: edit.end });
        const insertion = byOffset.get(edit.before) || {};
        const statement = `const { ${edit.name} } = ${edit.runner}.hoisted(() => ({ ${edit.name}: ${edit.init} }));\n`;
        byOffset.set(edit.before, { ...insertion, text: (insertion.text || '') + statement });
    }
    for (const [offset, edit] of [...byOffset].sort(([a], [b]) => b - a)) {
        code = code.slice(0, offset) + (edit.text || '') + code.slice(edit.end ?? offset);
    }
    return code;
}
