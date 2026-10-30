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
                // Follow expect(actual).not.toHaveText(...) as one assertion,
                // preserving the matcher, negation and expected value in its hash.
                let expression=node,matcher=null,call=null;
                for(let index=parents.length-1;index>=0;index--) {
                    const parent=parents[index];
                    if(parent.type==='MemberExpression' && parent.object===expression){expression=parent;matcher=parent;continue;}
                    if(parent.type==='CallExpression' && parent.callee===expression)call=parent;
                    break;
                }
                const site = call || node;
                const constant = ['BooleanLiteral', 'StringLiteral', 'NumericLiteral'].includes(node.arguments[0]?.type);
                const smoke = /(?:locator|getByRole)\(['"](?:body|main)['"]/.test(content.slice(node.start, node.end));
                if (constant) finding('CONSTANT_ACTUAL', node, 'The assertion checks a constant rather than application behavior.');
                if (smoke) finding('SMOKE_ASSERTION', node, 'Page visibility alone does not verify a business outcome.');
                const isStepReturn = parents[parents.length - 1]?.type === 'ArrowFunctionExpression' && (parents[parents.length - 1].body === call || (parents[parents.length - 1].body?.type === 'BlockStatement' && parents[parents.length - 1].body.body?.some?.(s => s.type === 'ReturnStatement' && s.argument === call)));
                const awaited = parents.some(parent => parent.type === 'AwaitExpression' && (parent.argument === call || (isStepReturn && parent.argument?.type === 'CallExpression' && (parent.argument.callee?.property?.name === 'step' || parent.argument.callee?.name === 'step'))));
                const webMatchers = new Set(['toBeAttached','toBeChecked','toBeDisabled','toBeEditable','toBeEmpty','toBeEnabled','toBeFocused','toBeHidden','toBeInViewport','toBeVisible','toContainText','toContainClass','toHaveAccessibleDescription','toHaveAccessibleName','toHaveAttribute','toHaveClass','toHaveCount','toHaveCSS','toHaveId','toHaveJSProperty','toHaveRole','toHaveText','toHaveValue','toHaveValues','toHaveTitle','toHaveURL','toHaveScreenshot','toMatchAriaSnapshot','toBeOK']);
                if (!awaited && matcher && webMatchers.has(matcher.property?.name)) finding('ASSERTION_NOT_AWAITED', site, 'Async web assertions must be awaited.');
                const enclosing = [...parents].reverse().find(parent => parent.type === 'CallExpression' && testNames.has(parent.callee?.name));
                // APIResponse.status()/ok() and awaited JSON are synchronous values.
                // They do not require awaiting expect(...).toBe/toEqual. Trace only
                // request-derived values; arbitrary constants still cannot qualify.
                const responseValues=new Set();
                const responseDerived=(value,hasAwait=false)=>{
                    if(!value)return false;
                    if(value.type==='Identifier')return responseValues.has(value.name);
                    if(value.type==='AwaitExpression')return responseDerived(value.argument,true);
                    if(value.type==='MemberExpression')return responseDerived(value.object);
                    if(value.type==='CallExpression'){
                        const receiver=value.callee?.object,method=value.callee?.property?.name;
                        if(['get','post','put','patch','delete','head','fetch'].includes(method) && (receiver?.name==='request' || receiver?.type==='MemberExpression' && receiver.property?.name==='request' && receiver.object?.name==='page'))return hasAwait;
                        if(['json','text','body'].includes(method) && !hasAwait)return false;
                        return responseDerived(receiver);
                    }
                    return false;
                };
                if(enclosing)walkAst(enclosing,child=>{
                    if(child.start>=node.start)return;
                    if(child.type==='VariableDeclarator' && child.id?.type==='Identifier' && child.init?.type==='AwaitExpression' && responseDerived(child.init))responseValues.add(child.id.name);
                    if(child.type==='AssignmentExpression' && child.left?.type==='Identifier')responseValues.delete(child.left.name);
                });
                const apiValue=!webMatchers.has(matcher?.property?.name) && responseDerived(node.arguments[0]);
                assertionSites.push({ id: digest(`${filePath}:${site.loc.start.line}:${site.loc.start.column}:${digest(normalizeAst(site))}`), filePath, line: site.loc.start.line, start: site.start, end: site.end, hash: digest(normalizeAst(site)), scenarioLine: enclosing?.loc.start.line, matcher: matcher?.property?.name, code: content.slice(site.start, site.end), supported: Boolean((awaited || apiValue) && call && !constant && !smoke && enclosing && !parents.some(parent => ['IfStatement', 'ConditionalExpression', 'TryStatement', 'ForStatement', 'WhileStatement'].includes(parent.type))) });
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
    if (mode === 'FIX_BREAKPOINT' && next.scenarioSites.length !== old.scenarioSites.length) throw new ServiceError('Breakpoint repairs cannot add or remove scenarios',422);
    for (const site of old.assertionSites) if (!next.assertionSites.some(candidate => candidate.hash === site.hash)) throw new ServiceError('AI changed or removed an existing assertion', 422);
    for (const scenario of old.scenarioSites) {
        const matches = next.scenarioSites.filter(candidate => candidate.title === scenario.title);
        if (matches.length !== old.scenarioSites.filter(candidate => candidate.title === scenario.title).length) throw new ServiceError('AI changed existing scenario identities', 422);
        if (mode === 'BOOST_COVERAGE' && !matches.some(candidate => candidate.hash === scenario.hash)) throw new ServiceError('Additional-test proposals must preserve existing scenario code', 422);
        if (mode === 'FIX_BREAKPOINT') {
            const assertionsFor = (analysis,site) => analysis.assertionSites.filter(assertion=>assertion.start>=site.start && assertion.end<=site.end).map(assertion=>assertion.hash).sort();
            if (!matches.some(candidate=>JSON.stringify(assertionsFor(old,scenario))===JSON.stringify(assertionsFor(next,candidate)))) throw new ServiceError('Breakpoint repairs must preserve every scenario assertion and expected outcome',422);
        }
    }
    if (next.findings.some(finding => ['SELECTIVE_EXECUTION', 'CONSTANT_ACTUAL', 'SWALLOWED_ERROR', 'ASSERTION_NOT_AWAITED'].includes(finding.rule))) throw new ServiceError('Candidate contains an unsafe test verification pattern', 422);
    return next;
};

// Apply the stricter minimum to additions only; legacy scenarios remain intact.
export const validateAdditionalTestQuality = (before, after, filePath) => {
    const old = analyzeSystemTestFile({content: before, filePath});
    const next = analyzeSystemTestFile({content: after, filePath});
    const titles = new Set(old.scenarioSites.map(site => site.title));
    const added = next.scenarioSites.filter(site => !titles.has(site.title));
    const imports = parse(after,{sourceType:'module',plugins:['typescript','jsx']}).program.body;
    const expectNames = new Set(imports.flatMap(node => node.type==='ImportDeclaration' && node.source.value==='@playwright/test' ? node.specifiers.filter(spec=>spec.imported?.name==='expect').map(spec=>spec.local.name) : []));
    for (const scenario of added) {
        if (!next.assertionSites.some(site => site.start >= scenario.start && site.end <= scenario.end && site.supported)) {
            throw new ServiceError(`New scenario "${scenario.title}" needs a supported assertion about the application outcome (await web assertions; API status/JSON assertions may be synchronous)`, 422);
        }
        const findings = next.findings.filter(site => site.line >= scenario.line && site.line <= after.slice(0, scenario.end).split('\n').length);
        if (findings.some(site => ['SMOKE_ASSERTION', 'FIXED_WAIT'].includes(site.rule))) throw new ServiceError(`New scenario "${scenario.title}" contains a smoke assertion or fixed wait`, 422);
        const tree = parse(after.slice(scenario.start, scenario.end), {sourceType: 'module', plugins: ['typescript','jsx']});
        const textFilteredRows = new Set();
        const usesTextFilter = expression => {
            let found = expression?.type==='Identifier' && textFilteredRows.has(expression.name);
            walkAst(expression,child=>{if(child.type==='ObjectProperty' && (child.key?.name || child.key?.value)==='hasText') found=true;});
            return found;
        };
        walkAst(tree,node=>{
            if(node.type!=='VariableDeclarator' || node.id?.type!=='Identifier') return;
            if(usesTextFilter(node.init)) textFilteredRows.add(node.id.name);
        });
        walkAst(tree, node => {
            if(node.type==='CallExpression' && node.callee?.property?.name==='locator' && typeof node.arguments[0]?.value==='string' && /(?<!\\)\.(?:hover|focus|focus-visible|active|disabled|sm|md|lg|xl|dark):(?:bg|text|border|ring|opacity|flex|grid|p|m|w|h)-/.test(node.arguments[0].value)) throw new ServiceError(`New scenario "${scenario.title}" uses an unescaped Tailwind class as CSS. Use an exact observed icon selector or [class~="hover:text-purple-400"] attribute syntax instead of .hover:text-purple-400`,422);
            if(node.type==='CallExpression' && usesTextFilter(node.callee?.object)) {
                const method=node.callee.property?.name,selector=node.arguments[0]?.value;
                const nonTextInput=typeof selector==='string' && /^input\[type\s*=\s*['"]?(?:checkbox|radio|button|submit|reset|file|hidden|range|color)['"]?\]$/.test(selector.trim());
                if((method==='locator' && typeof selector==='string' && /\b(input|textarea|form)\b/.test(selector) && !nonTextInput) || (method==='getByRole' && selector==='textbox')) throw new ServiceError(`New scenario "${scenario.title}" uses a text-filtered row for an edit input. Enter edit mode, then reacquire a stable form/input from page using source-supported structure; input values are not visible text and filling changes them`,422);
            }
            if (node.type === 'CallExpression' && expectNames.has(node.callee?.name)) {
                const actual = node.arguments[0];
                if (['NullLiteral','ArrayExpression','ObjectExpression'].includes(actual?.type) || actual?.type==='TemplateLiteral' && !actual.expressions.length) throw new ServiceError(`New scenario "${scenario.title}" must assert application state, not literal values`,422);
            }
            if (node.type === 'CallExpression' && node.callee?.property?.name === 'catch') {
                const callback = node.arguments[0];
                let rethrows = false;
                walkAst(callback,child=>{if(child.type==='ThrowStatement') rethrows=true;});
                if (!rethrows) throw new ServiceError(`New scenario "${scenario.title}" cannot ignore rejected actions or assertions`,422);
            }
            if (node.type === 'CallExpression' && ['isVisible','isEnabled'].includes(node.callee?.property?.name)) {
                throw new ServiceError(`New scenario "${scenario.title}" must use web-first assertions instead of conditional action fallbacks`, 422);
            }
        });
    }
    return {addedScenarios: added.map(site => site.title), addedAssertions: next.assertionSites.filter(site => added.some(scenario => site.start >= scenario.start && site.end <= scenario.end) && site.supported).length};
};
