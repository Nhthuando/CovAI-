import { parse } from '@babel/parser';
import { walkAst, digest } from './systemTestStaticAnalysis.service.js';

export const enumerateMutations = ({ content, filePath }) => {
    const ast = parse(content, { sourceType: 'unambiguous' });
    const mutations = [];
    const operators = { '===': '!==', '!==': '===', '<': '<=', '<=': '<', '>': '>=', '>=': '>' };
    walkAst(ast, node => {
        if (node.type !== 'BinaryExpression' || !operators[node.operator]) return;
        const before = content.slice(node.start, node.end);
        const operatorStart = content.indexOf(node.operator, node.left.end);
        if (operatorStart >= node.right.start) return;
        const replacement = before.slice(0, operatorStart - node.start) + operators[node.operator] + before.slice(operatorStart - node.start + node.operator.length);
        mutations.push({ id: digest(`${filePath}:${node.start}:${before}`), filePath, line: node.loc.start.line, start: node.start, end: node.end, original: before, replacement, operator: `${node.operator}->${operators[node.operator]}` });
    });
    return mutations;
};
export const classifyMutation = ({ startupHealthy, activated, targetExecuted, timedOut, assertionFailures = [], approvedTargetBindingIds = [] }) => {
    if (!startupHealthy) return { status: 'INFRA_ERROR', reasonCodes: ['AUT_NOT_HEALTHY'] };
    if (timedOut) return { status: 'TIMEOUT', reasonCodes: ['EXECUTION_TIMEOUT'] };
    if (!activated || targetExecuted === undefined) return { status: 'AMBIGUOUS', reasonCodes: ['MISSING_ACTIVATION_OR_TARGET_EVIDENCE'] };
    if (!targetExecuted) return { status: 'NOT_EXERCISED', reasonCodes: [] };
    if (assertionFailures.some(failure => approvedTargetBindingIds.includes(failure.bindingId))) return { status: 'KILLED_ASSERTION', reasonCodes: [] };
    if (assertionFailures.length) return { status: 'AMBIGUOUS', reasonCodes: ['UNRELATED_ASSERTION_FAILURE'] };
    return { status: 'SURVIVED', reasonCodes: [] };
};
