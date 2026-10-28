import { IssueType, Severity } from '../../constants/codeHygiene.constants.js';

export const ConsoleRule = Object.freeze({
    id: 'console-statements',
    name: 'Console statements',
    description: 'Finds console output left in source code.',
    category: 'debug-code',
    defaultSeverity: Severity.INFO,
    version: '1.0.0',
    tags: Object.freeze(['debug', 'logging', 'production-readiness']),
    check(node) {
        if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return null;
        if (node.callee.object?.name !== 'console') return null;

        const method = node.callee.property?.name;
        if (!['log', 'debug', 'warn', 'error'].includes(method)) return null;

        return {
            type: IssueType.CONSOLE_LOG,
            severity: ['warn', 'error'].includes(method) ? Severity.WARNING : Severity.INFO,
            message: `Remove console.${method} before production.`
        };
    }
});
