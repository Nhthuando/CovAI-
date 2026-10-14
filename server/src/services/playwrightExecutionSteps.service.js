import traverseModule from '@babel/traverse';
import { validateGeneratedTestCode } from '../validators/aiTestCode.validator.js';
import { ServiceError } from '../utils/serviceError.js';

const traverse = traverseModule.default || traverseModule;

export const PLAYWRIGHT_EXECUTION_STEP_RULES = `Execution report requirements: In EVERY Playwright scenario, use awaited test.step('descriptive English action or verification', async () => { ... }) blocks for navigation, input, clicks, API requests and assertions. Separate meaningful actions and their outcome checks, e.g. 'Enter new todo', 'Submit new todo', 'Verify todo persists after reload'. Keep shared locators, response variables and test data in scenario scope; return values from a step when needed. Preserve assertions, branching, cleanup and error propagation. Do not wrap the entire scenario in one generic step, do not add empty steps or steps claiming work that was not performed, and never include passwords/tokens/input values in step titles. Preserve existing meaningful step names during repairs. Do not use test.step.skip or omit awaiting a step.`;

const actionLabels = {
    goto: 'Open application page', reload: 'Reload application page',
    fill: 'Enter input value', click: 'Click control', dblclick: 'Double-click control',
    press: 'Press key', check: 'Check input', uncheck: 'Uncheck input',
    selectOption: 'Select option', hover: 'Hover control', clear: 'Clear input',
    get: 'Send GET request', post: 'Send POST request', put: 'Send PUT request',
    patch: 'Send PATCH request', delete: 'Send DELETE request', fetch: 'Send application request',
    isVisible: 'Check element visibility', isEnabled: 'Check control availability',
    count: 'Count matching elements', json: 'Read response JSON', text: 'Read response text',
    waitFor: 'Wait for element state', waitForURL: 'Wait for route', waitForResponse: 'Wait for application response',
    evaluate: 'Read or update application state',
    inputValue: 'Read input value', setContent: 'Render test page',
};
const assertionLabels = {
    toBeVisible: 'Verify element visibility', toBeHidden: 'Verify element is hidden',
    toHaveURL: 'Verify route URL', toHaveText: 'Verify displayed text', toContainText: 'Verify displayed text',
    toHaveValue: 'Verify input value', toHaveCount: 'Verify element count',
    toBeEnabled: 'Verify control availability', toBeDisabled: 'Verify control availability',
};
const property = node => node?.type === 'MemberExpression' && !node.computed ? node.property?.name : null;
const rootIdentifier = node => {
    if (node?.type === 'Identifier') return node.name;
    if (node?.type === 'CallExpression') return rootIdentifier(node.callee);
    if (node?.type === 'MemberExpression') return rootIdentifier(node.object);
    return null;
};

/** Add report steps at the generation boundary, without moving declarations or rewriting assertions. */
export const ensurePlaywrightExecutionSteps = code => {
    const { ast } = validateGeneratedTestCode(code);
    const tests = new Map();
    const expects = new Map();
    const namespaces = new Map();
    traverse(ast, {
        ImportDeclaration(p) {
            if (p.node.source.value !== '@playwright/test') return;
            for (const spec of p.node.specifiers) {
                const binding = p.scope.getBinding(spec.local.name);
                if (spec.type === 'ImportNamespaceSpecifier') namespaces.set(spec.local.name, binding);
                if (spec.imported?.name === 'test') tests.set(spec.local.name, binding);
                if (spec.imported?.name === 'expect') expects.set(spec.local.name, binding);
            }
        },
        VariableDeclarator(p) {
            const init = p.node.init;
            if (init?.type !== 'CallExpression' || init.callee?.name !== 'require' || init.arguments[0]?.value !== '@playwright/test') return;
            if (p.node.id.type === 'Identifier') namespaces.set(p.node.id.name, p.scope.getBinding(p.node.id.name));
            if (p.node.id.type === 'ObjectPattern') for (const spec of p.node.id.properties) {
                if (spec.type !== 'ObjectProperty' || spec.value.type !== 'Identifier') continue;
                const binding = p.scope.getBinding(spec.value.name);
                if (spec.key.name === 'test') tests.set(spec.value.name, binding);
                if (spec.key.name === 'expect') expects.set(spec.value.name, binding);
            }
        },
    });
    const bound = (p, name, bindings) => bindings.has(name) && p.scope.getBinding(name) === bindings.get(name);
    const testReference = (p, node) => {
        if (node?.type === 'Identifier' && bound(p, node.name, tests)) return node;
        if (property(node) === 'test' && node.object.type === 'Identifier' && bound(p, node.object.name, namespaces)) return node;
        return null;
    };
    const stepCall = p => p.isCallExpression() && property(p.node.callee) === 'step' && testReference(p, p.node.callee.object);
    const assertion = (p, node) => {
        const name = rootIdentifier(node);
        return bound(p, name, expects) || (bound(p, name, namespaces) && code.slice(node.start, node.end).startsWith(`${name}.expect(`));
    };
    const edits = [];
    let scenarios = 0;
    traverse(ast, {
        CallExpression(p) {
            let ref = testReference(p, p.node.callee);
            if (!ref && ['only', 'skip', 'fixme'].includes(property(p.node.callee))) ref = testReference(p, p.node.callee.object);
            if (!ref) return;
            const args = p.get('arguments');
            const callback = args.at(-1);
            if (!callback || !(callback.isArrowFunctionExpression() || callback.isFunctionExpression())) {
                throw new ServiceError('Generated Playwright scenarios need inline callbacks to collect execution steps.', 422);
            }
            scenarios++;
            const refText = code.slice(ref.start, ref.end);
            const refName = rootIdentifier(ref);
            const refBinding = p.scope.getBinding(refName);
            let stepCount = 0;
            let needsAsync = false;
            const inStep = operation => !!operation.findParent(parent => parent !== callback && stepCall(parent));
            const coveredByExpression = operation => !!operation.findParent(parent => {
                if (parent === callback) return false;
                if (parent === callback.get('body') && parent.isCallExpression()) return true;
                if (parent.getFunctionParent() !== callback) return false;
                if (parent.isExpressionStatement()) return parent.node.expression.type === 'CallExpression' && assertion(parent, parent.node.expression);
                return parent.isReturnStatement() && parent.node.argument?.type === 'CallExpression';
            });
            const wrap = (operation, expression, awaited) => {
                if (operation.scope.getBinding(refName) !== refBinding) throw new ServiceError('Playwright test binding is shadowed inside a scenario; use a distinct local name.', 422);
                const method = property(expression.callee);
                const label = assertion(operation, expression) ? assertionLabels[method] || 'Verify expected result' : actionLabels[method] || 'Wait for operation result';
                edits.push({ start: expression.start, end: expression.end, prefix: `${awaited ? '' : 'await '}${refText}.step(${JSON.stringify(label)}, async () => (`, suffix: '))' });
                if (!callback.node.async) needsAsync = true;
                stepCount++;
            };
            callback.traverse({
                CallExpression(operation) {
                    if (testReference(operation, operation.node.callee)) throw new ServiceError('Playwright scenarios cannot declare nested scenarios.', 422);
                    if (!stepCall(operation)) return;
                    const title = operation.node.arguments[0];
                    if (title?.type !== 'StringLiteral' || !title.value.trim()) throw new ServiceError('Execution steps need non-empty literal titles.', 422);
                    const body = operation.node.arguments[1]?.body;
                    if (body?.type === 'BlockStatement' && !body.body.length) throw new ServiceError('Execution steps must contain real actions or assertions, not empty callbacks.', 422);
                    const implicitReturn = operation.parentPath.isArrowFunctionExpression() && operation.parentPath.node.body === operation.node;
                    if (!operation.parentPath.isAwaitExpression() && !operation.parentPath.isReturnStatement() && !implicitReturn) throw new ServiceError('Execution steps must be awaited or returned so the scenario waits for them.', 422);
                    stepCount++;
                },
                AwaitExpression(operation) {
                    if (inStep(operation) || stepCall(operation.get('argument')) || coveredByExpression(operation)) return;
                    // An outer awaited assertion/action already records its nested awaits.
                    if (operation.findParent(parent => parent !== callback && parent.isAwaitExpression())) return;
                    wrap(operation, operation.node.argument, true);
                },
                ExpressionStatement(operation) {
                    if (operation.getFunctionParent() !== callback || inStep(operation)) return;
                    if (operation.node.expression.type === 'CallExpression' && assertion(operation, operation.node.expression)) wrap(operation, operation.node.expression, false);
                },
                ReturnStatement(operation) {
                    if (operation.getFunctionParent() !== callback || inStep(operation) || operation.node.argument?.type !== 'CallExpression' || stepCall(operation.get('argument'))) return;
                    wrap(operation, operation.node.argument, false);
                },
            });
            if (callback.node.body.type === 'CallExpression' && !stepCall(callback.get('body'))) wrap(callback, callback.node.body, false);
            if (needsAsync) edits.push({ start: callback.node.start, end: callback.node.start, prefix: 'async ', suffix: '' });
            if (!stepCount) throw new ServiceError('Every generated Playwright scenario must record real actions or assertions in execution steps.', 422);
        },
    });
    if (!scenarios) throw new ServiceError('No imported Playwright scenarios found for execution step recording.', 422);
    // Edits are disjoint operation expressions; insert from right to left to preserve source spans.
    let result = code;
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.prefix + result.slice(edit.start, edit.end) + edit.suffix + result.slice(edit.end);
    validateGeneratedTestCode(result);
    return result;
};
