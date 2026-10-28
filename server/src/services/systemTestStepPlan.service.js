import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const walk = (node, visit) => {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(child => walk(child, visit));
        else if (value && typeof value === 'object') walk(value, visit);
    }
};
const stepCall = node => node?.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
    && node.callee.object?.name === 'test' && node.callee.property?.name === 'step' && !node.callee.computed;

/** Only unconditional, top-level named steps form a reliable denominator. */
export function plannedPlaywrightSteps(source, { title, line } = {}) {
    try {
        const tree = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
        const matches = [];
        walk(tree, node => {
            if (node.type !== 'CallExpression' || node.arguments?.[0]?.value !== title) return;
            const callback = node.arguments.at(-1);
            if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(callback?.type) || callback.body?.type !== 'BlockStatement') return;
            if (line && node.loc.start.line !== line) return;
            let callee = node.callee;
            while (callee?.type === 'MemberExpression') callee = callee.object;
            if (callee?.name === 'test') matches.push(callback);
        });
        if (matches.length !== 1) return null;
        const callback = matches[0];
        const calls = callback.body.body.flatMap(statement => statement.type === 'ExpressionStatement' ? [statement.expression]
            : statement.type === 'VariableDeclaration' ? statement.declarations.map(declaration => declaration.init)
            : statement.type === 'ReturnStatement' ? [statement.argument] : [])
            .map(expression => expression?.type === 'AwaitExpression' ? expression.argument : expression).filter(stepCall);
        let allCalls = 0;
        walk(callback.body, node => { if (stepCall(node)) allCalls++; });
        if (!calls.length || calls.length !== allCalls || calls.length > 200) return null;
        const names = calls.map(call => call.arguments[0]?.type === 'StringLiteral' ? call.arguments[0].value : null);
        return names.every(name => typeof name === 'string' && name.length <= 512) ? names : null;
    } catch { return null; }
}

export function readPlaywrightStepPlan(rootDir, spec) {
    if (!rootDir || !spec.file) return null;
    const root = path.resolve(rootDir);
    const file = path.resolve(root, spec.file);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    try {
        if (fs.statSync(file).size > 500000) return null;
        return plannedPlaywrightSteps(fs.readFileSync(file, 'utf8'), spec);
    } catch { return null; }
}
