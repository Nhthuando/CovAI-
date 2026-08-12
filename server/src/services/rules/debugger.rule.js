import { IssueType, Severity } from '../../constants/codeHygiene.constants.js';

export const DebuggerRule = Object.freeze({
    id: 'debugger-statements',
    name: 'Debugger statements',
    description: 'Finds debugger statements that pause execution.',
    category: 'debug-code',
    defaultSeverity: Severity.HIGH,
    version: '1.0.0',
    tags: Object.freeze(['debug', 'production-readiness']),
    check(node) {
        if (node.type !== 'DebuggerStatement') return null;
        return {
            type: IssueType.DEBUGGER,
            severity: Severity.HIGH,
            message: 'Remove debugger statement.'
        };
    }
});
