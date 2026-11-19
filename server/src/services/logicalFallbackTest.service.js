import path from 'node:path';
import traverseModule from '@babel/traverse';
import { parseJavaScriptCode } from './babelParser.service.js';
import { testBlocks } from './generatedTestInputRepair.service.js';

const traverse = traverseModule.default || traverseModule;
const member = (node, property) => node?.type === 'MemberExpression' && !node.computed && node.property.name === property;
const withoutExtension = value => value.replace(/\.[cm]?[jt]sx?$/, '');

/** Reuse an existing passing-shape test when an omitted field takes the same
 * empty-array result through an uncovered logical fallback. No setup is changed. */
export function proposeEmptyArrayFallbackTest({ sourceCode, sourceFile, testFile, original, coverageDetails = {} }) {
    const branches = coverageDetails.branches || coverageDetails.branchFlow || coverageDetails.uncoveredBranches || [];
    const gaps = branches.filter(branch => branch.status !== 'fully_covered' && !branch.isInfeasible);
    if (!original || coverageDetails.uncoveredLines?.length || gaps.length !== 1) return null;
    const gap = gaps[0];
    const counts = gap.counts || gap.paths?.map(operand => operand.hits);
    if (!['binary-expr', 'logical-expr'].includes(gap.type) || counts?.length !== 2 || counts[0] <= 0 || counts[1] !== 0) return null;

    const source = parseJavaScriptCode(sourceCode, { filePath: sourceFile });
    if (!source.success) return null;
    const fallbacks = [];
    traverse(source.ast, { LogicalExpression(expression) {
        const node = expression.node;
        if (node.loc.start.line !== Number(gap.line) || !['||', '??'].includes(node.operator) ||
            node.right.type !== 'ArrayExpression' || node.right.elements.length ||
            node.left.type !== 'MemberExpression' || node.left.computed || !member(node.left.object, 'body')) return;
        const fn = expression.getFunctionParent();
        if (!fn?.node || fn.node.params[0]?.name !== node.left.object.object.name) return;
        const request = fn.scope.getBinding(fn.node.params[0].name);
        if (!request || request.referencePaths.some(reference => reference.node !== node.left.object.object)) return;
        const assignment = fn.parentPath?.node;
        const exported = assignment?.type === 'AssignmentExpression' && assignment.left.type === 'MemberExpression' &&
            (assignment.left.object.name === 'exports' || member(assignment.left.object, 'exports'));
        const name = exported ? assignment.left.property.name : fn.parentPath?.isExportNamedDeclaration() ? fn.node.id?.name : null;
        if (name) fallbacks.push({ name, field: node.left.property.name, operator: node.operator });
    } });
    if (fallbacks.length !== 1) return null;
    const { name, field, operator } = fallbacks[0];
    const normalizedSource = withoutExtension(path.posix.normalize(sourceFile.replaceAll('\\', '/')));
    const suiteDirectory = path.posix.dirname(testFile.replaceAll('\\', '/'));
    const title = name + ' uses the empty array fallback when body.' + field + ' is omitted';
    const blocks = testBlocks(original);
    if (blocks.some(block => block.title === title)) return null;

    for (const block of blocks) {
        const statements = block.callback.node.body.body;
        if (statements?.length !== 3) continue;
        const [fixture, invocation, assertion] = statements.map(statement => statement.expression);
        const call = invocation?.type === 'AwaitExpression' ? invocation.argument : null;
        if (!call || call.type !== 'CallExpression' || !member(call.callee, name) || call.arguments.length !== 2 ||
            call.arguments.some(arg => arg.type !== 'Identifier')) continue;
        const [request, response] = call.arguments.map(argument => argument.name);
        const target = block.callback.scope.getBinding(call.callee.object.name)?.path.node.init;
        const specifier = target?.type === 'CallExpression' && target.callee.name === 'require' && target.arguments[0]?.value;
        if (typeof specifier !== 'string' || !specifier.startsWith('.') ||
            withoutExtension(path.posix.normalize(path.posix.join(suiteDirectory, specifier))) !== normalizedSource) continue;
        if (fixture?.type !== 'AssignmentExpression' || fixture.operator !== '=' || !member(fixture.left, 'body') ||
            fixture.left.object.name !== request || fixture.right.type !== 'ObjectExpression' || fixture.right.properties.length !== 1) continue;
        const property = fixture.right.properties[0];
        if (property.type !== 'ObjectProperty' || property.computed || (property.key.name || property.key.value) !== field ||
            property.value.type !== 'ArrayExpression' || property.value.elements.length) continue;
        const expectCall = assertion?.callee?.object;
        if (assertion?.type !== 'CallExpression' || !member(assertion.callee, 'toHaveBeenCalledWith') ||
            expectCall?.callee?.name !== 'expect' || !member(expectCall.arguments[0], 'json') ||
            expectCall.arguments[0].object.name !== response || assertion.arguments[0]?.type !== 'ObjectExpression') continue;
        const expectedBody = parseJavaScriptCode('(' + original.slice(assertion.arguments[0].start, assertion.arguments[0].end) + ')');
        // An assertion that reads the request can change its meaning when the field is omitted.
        let readsRequest = false;
        if (expectedBody.success) traverse(expectedBody.ast, {
            ReferencedIdentifier(reference) { if (reference.node.name === request) readsRequest = true; },
        });
        if (!expectedBody.success || readsRequest) continue;

        const start = block.node.start;
        const originalTitle = block.node.arguments[0];
        const clone = original.slice(start, originalTitle.start) + JSON.stringify(title) +
            original.slice(originalTitle.end, fixture.right.start) + '{}' + original.slice(fixture.right.end, block.node.end);
        const insertion = block.node.end + (original[block.node.end] === ';' ? 1 : 0);
        const indentation = original.slice(original.lastIndexOf('\n', start) + 1, start).match(/^\s*/)[0];
        const eol = original.includes('\r\n') ? '\r\n' : '\n';
        return {
            explanation: 'Omit body.' + field + ' to evaluate the right operand of ' + operator + ' on line ' + gap.line + '.',
            fullUpdatedContent: original.slice(0, insertion) + eol + eol + indentation + clone + ';' + original.slice(insertion),
        };
    }
    return null;
}
