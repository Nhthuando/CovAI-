import { parse, parseExpression } from '@babel/parser';

const unwrap = node => ['AwaitExpression', 'TSAsExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node?.type) ? unwrap(node.argument || node.expression) : node;
const property = node => node?.property?.name || node?.property?.value;
const quote = value => { const text=String(value);return JSON.stringify(text.length>160?text.slice(0,157)+'...':text); };

export { isVagueExpectedOutcome } from '../../../shared/systemExpectedOutcome.js';

// Resolve local locator names without executing test code or inventing business meaning.
export const outcomeBindings = content => {
    const bindings = new Map();
    try {
        const ast = parse(content, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
        const visit = node => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
                bindings.set(node.id.name, bindings.has(node.id.name) ? null : node.init);
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value?.type) visit(value);
            }
        };
        visit(ast);
    } catch { /* Unresolved values remain explicit below. */ }
    return bindings;
};

export const describeAssertionOutcome = (code, bindings = new Map()) => {
    const resolve = (node, depth = 0) => {
        node = unwrap(node);
        if (node?.type === 'Identifier' && bindings.get(node.name) && depth < 5) return resolve(bindings.get(node.name), depth + 1);
        return node;
    };
    const value = node => {
        node = resolve(node);
        if (!node) return null;
        if (node.type === 'StringLiteral') return quote(node.value);
        if (['NumericLiteral', 'BooleanLiteral'].includes(node.type)) return JSON.stringify(node.value);
        if (node.type === 'NullLiteral') return 'null';
        if (node.type === 'TemplateLiteral' && !node.expressions.length) return quote(node.quasis.map(part => part.value.cooked).join(''));
        if (node.type === 'Identifier') return `the value of ${quote(node.name)}`;
        if (node.type === 'ArrayExpression') {
            const items = node.elements.map(item => value(item));
            return items.every(Boolean) ? `[${items.join(', ')}]` : null;
        }
        return null;
    };
    const subject = node => {
        node = resolve(node);
        if (!node) return null;
        if (node.type === 'Identifier') return `The value of ${quote(node.name)}`;
        if (node.type === 'MemberExpression') return `${subject(node.object) || 'The object'} property ${quote(property(node))}`;
        if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return null;
        const method = property(node.callee), argument = resolve(node.arguments[0]);
        const literal = argument?.type === 'StringLiteral' ? argument.value : null;
        if (method === 'getByRole') {
            const name = resolve(node.arguments[1])?.properties?.find(item => (item.key?.name || item.key?.value) === 'name')?.value;
            return `${literal ? literal.charAt(0).toUpperCase() + literal.slice(1) : 'Element'}${name && value(name) ? ` ${value(name)}` : ''}`;
        }
        if (['getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId'].includes(method)) {
            const label = { getByText: 'Text', getByLabel: 'Field labeled', getByPlaceholder: 'Field with placeholder', getByTestId: 'Element with test ID' }[method];
            return value(argument) ? `${label} ${value(argument)}` : null;
        }
        if (method === 'locator') {
            if (literal?.startsWith('text=')) return `Text ${quote(literal.slice(5))}`;
            return literal ? `Element matching ${quote(literal)}` : null;
        }
        if (['first', 'last', 'nth', 'filter'].includes(method)) return subject(node.callee.object);
        if (method === 'status') return 'Response status';
        if (method === 'ok') return 'Response success';
        if (method === 'url') return 'Page URL';
        if (method === 'textContent') return `Text content of ${subject(node.callee.object) || 'the selected element'}`;
        if (method === 'inputValue') return `Input value of ${subject(node.callee.object) || 'the selected field'}`;
        return null;
    };
    try {
        const assertion = unwrap(parseExpression(code.replace(/;\s*$/, ''), { plugins: ['typescript'], allowAwaitOutsideFunction: true }));
        if (assertion?.type !== 'CallExpression' || assertion.callee.type !== 'MemberExpression') return null;
        const matcher = property(assertion.callee);
        let target = assertion.callee.object, negated = false;
        while (target?.type === 'MemberExpression') {
            if (property(target) === 'not') negated = !negated;
            target = target.object;
        }
        if (target?.type !== 'CallExpression') return null;
        const name = subject(target.arguments[0]);
        if (!name) return null;
        const not = negated ? 'not ' : '';
        const expected = value(assertion.arguments[0]);
        const states = { toBeVisible: 'visible', toBeHidden: 'hidden', toBeEnabled: 'enabled', toBeDisabled: 'disabled', toBeChecked: 'checked', toBeEmpty: 'empty' };
        if (states[matcher]) return `${name} is ${not}${states[matcher]}.`;
        if (matcher === 'toHaveCount' && expected !== null) return `${name} ${negated ? 'does not have' : 'has'} ${expected} matching item(s).`;
        const comparisons = { toHaveText: 'have text', toContainText: 'contain text', toHaveValue: 'have value', toHaveClass: 'have class', toHaveURL: 'have URL', toBe: 'equal', toEqual: 'equal', toStrictEqual: 'equal' };
        if (comparisons[matcher] && expected !== null) {
            const verb = negated ? `does not ${comparisons[matcher]}` : comparisons[matcher].replace(/^have\b/, 'has').replace(/^contain\b/, 'contains').replace(/^equal\b/, 'equals');
            return `${name} ${verb} ${expected}.`;
        }
        return null;
    } catch { return null; }
};
