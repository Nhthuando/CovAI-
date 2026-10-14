import crypto from 'node:crypto';
import { parse } from '@babel/parser';
import { ServiceError } from '../utils/serviceError.js';

export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const walkAst = (node, visit, parents = []) => {
    if (!node || typeof node !== 'object' || !node.type) return;
    visit(node, parents);
    for (const [key, value] of Object.entries(node)) {
        if (['loc', 'comments', 'tokens'].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(child => walkAst(child, visit, [...parents, node]));
        else if (value?.type) walkAst(value, visit, [...parents, node]);
    }
};
export const normalizeAst = node => {
    if (Array.isArray(node)) return node.map(normalizeAst);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).filter(([key]) => !['start', 'end', 'loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)).map(([key, value]) => [key, normalizeAst(value)]));
};
export const analyzeSystemTestFile = ({ content, filePath, framework = 'playwright' }) => {
    const ast = parse(content, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
    const findings = [], assertionSites = [], scenarioSites = [], unsupportedFeatures = [];
    const finding = (rule, node, message) => findings.push({ id: digest(`${filePath}:${node.start}:${rule}`), rule, filePath, line: node.loc.start.line, column: node.loc.start.column, message, snippet: content.slice(node.start, node.end).slice(0, 500) });
    const testNames = new Set(); const expectNames = new Set();
    for (const node of ast.program.body) if (node.type === 'ImportDeclaration' && node.source.value === '@playwright/test') for (const spec of node.specifiers) {
        if (spec.imported?.name === 'test') testNames.add(spec.local.name);
        if (spec.imported?.name === 'expect') expectNames.add(spec.local.name);
    }
    if (framework === 'cypress') unsupportedFeatures.push('CYPRESS_ASSERTION_EVIDENCE_UNSUPPORTED');
    walkAst(ast, (node, parents) => {
        if (node.type === 'CallExpression') {
            const prop = node.callee?.property?.name;
            if (['skip', 'only', 'fixme'].includes(prop)) finding('SELECTIVE_EXECUTION', node, 'Selected or skipped tests cannot establish suite verification.');
            if (prop === 'waitForTimeout') finding('FIXED_WAIT', node, 'A fixed delay does not establish the expected application state.');
            if (node.callee.type === 'Identifier' && testNames.has(node.callee.name)) {
                if (typeof node.arguments[0]?.value !== 'string') unsupportedFeatures.push('DYNAMIC_TEST_TITLE');
                else scenarioSites.push({ id: digest(`${filePath}:${node.loc.start.line}:${node.arguments[0].value}`), title: node.arguments[0].value, line: node.loc.start.line, start: node.start, end: node.end, hash: digest(normalizeAst(node)) });
            }
            if (node.callee.type === 'Identifier' && expectNames.has(node.callee.name)) {
                const matcher = parents.at(-1)?.type === 'MemberExpression' ? parents.at(-1) : null;
                const call = parents.at(-2)?.type === 'CallExpression' ? parents.at(-2) : null;
                const site = call || node;
                const constant = ['BooleanLiteral', 'StringLiteral', 'NumericLiteral'].includes(node.arguments[0]?.type);
                const smoke = /(?:locator|getByRole)\(['"](?:body|main)['"]/.test(content.slice(node.start, node.end));
                if (constant) finding('CONSTANT_ACTUAL', node, 'The assertion checks a constant rather than application behavior.');
                if (smoke) finding('SMOKE_ASSERTION', node, 'Page visibility alone does not verify a business outcome.');
                const awaited = parents.some(parent => parent.type === 'AwaitExpression' && parent.argument === call);
                const webMatchers = new Set(['toBeAttached','toBeChecked','toBeDisabled','toBeEditable','toBeEmpty','toBeEnabled','toBeFocused','toBeHidden','toBeInViewport','toBeVisible','toContainText','toContainClass','toHaveAccessibleDescription','toHaveAccessibleName','toHaveAttribute','toHaveClass','toHaveCount','toHaveCSS','toHaveId','toHaveJSProperty','toHaveRole','toHaveText','toHaveValue','toHaveValues','toHaveTitle','toHaveURL','toHaveScreenshot','toMatchAriaSnapshot','toBeOK']);
                if (!awaited && matcher && webMatchers.has(matcher.property?.name)) finding('ASSERTION_NOT_AWAITED', site, 'Async web assertions must be awaited.');
                const enclosing = [...parents].reverse().find(parent => parent.type === 'CallExpression' && testNames.has(parent.callee?.name));
                assertionSites.push({ id: digest(`${filePath}:${site.loc.start.line}:${site.loc.start.column}:${digest(normalizeAst(site))}`), filePath, line: site.loc.start.line, start: site.start, end: site.end, hash: digest(normalizeAst(site)), scenarioLine: enclosing?.loc.start.line, matcher: matcher?.property?.name, code: content.slice(site.start, site.end), supported: Boolean(awaited && call && !constant && !smoke && enclosing && !parents.some(parent => ['IfStatement', 'ConditionalExpression', 'TryStatement', 'ForStatement', 'WhileStatement'].includes(parent.type))) });
            }
        }
        if (node.type === 'CatchClause' && !JSON.stringify(normalizeAst(node.body)).includes('ThrowStatement')) finding('SWALLOWED_ERROR', node, 'Caught failures are not rethrown. Review whether the test can pass without the expected behavior.');
    });
    if (!testNames.size) unsupportedFeatures.push('CUSTOM_FIXTURE_OR_TEST_IMPORT');
    if (!scenarioSites.length) unsupportedFeatures.push('NO_SUPPORTED_STATIC_SCENARIOS');
    return { findings, assertionSites, scenarioSites, unsupportedFeatures: [...new Set(unsupportedFeatures)] };
};

export const preserveTestIntent = (before, after, filePath, mode = 'BOOST_COVERAGE') => {
    const old = analyzeSystemTestFile({ content: before, filePath });
    const next = analyzeSystemTestFile({ content: after, filePath });
    if (old.unsupportedFeatures.length) throw new ServiceError('Automatic preservation is unsupported for this test structure; manual review is required', 422);
    if (next.unsupportedFeatures.length) throw new ServiceError('Candidate changed the supported test structure', 422);
    const infrastructure = content => {
        const tree = parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
        const names = new Set(tree.program.body.flatMap(node => node.type === 'ImportDeclaration' && node.source.value === '@playwright/test' ? node.specifiers.filter(s => s.imported?.name === 'test').map(s => s.local.name) : []));
        const strip = node => {
            if (!node || typeof node !== 'object') return node;
            if (Array.isArray(node)) return node.filter(child => !(child?.type === 'ExpressionStatement' && child.expression?.type === 'CallExpression' && names.has(child.expression.callee?.name))).map(strip);
            return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, strip(value)]));
        };
        return digest(normalizeAst(strip(tree.program)));
    };
    if (infrastructure(before) !== infrastructure(after)) throw new ServiceError('AI changed imports, helpers, hooks or suite infrastructure', 422);
    for (const site of old.assertionSites) if (!next.assertionSites.some(candidate => candidate.hash === site.hash)) throw new ServiceError('AI changed or removed an existing assertion', 422);
    for (const scenario of old.scenarioSites) {
        const matches = next.scenarioSites.filter(candidate => candidate.title === scenario.title);
        if (matches.length !== old.scenarioSites.filter(candidate => candidate.title === scenario.title).length) throw new ServiceError('AI changed existing scenario identities', 422);
        if (mode === 'BOOST_COVERAGE' && !matches.some(candidate => candidate.hash === scenario.hash)) throw new ServiceError('Additional-test proposals must preserve existing scenario code', 422);
    }
    if (next.findings.some(finding => ['SELECTIVE_EXECUTION', 'CONSTANT_ACTUAL', 'SWALLOWED_ERROR', 'ASSERTION_NOT_AWAITED'].includes(finding.rule))) throw new ServiceError('Candidate contains an unsafe test verification pattern', 422);
    return next;
};
