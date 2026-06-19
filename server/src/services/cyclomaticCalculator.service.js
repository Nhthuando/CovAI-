import estraverse from 'estraverse';

export function calculateComplexityFromAst(astNode) {
    let decisionPoints = 0;

    estraverse.traverse(astNode, {
        enter: function (node) {
            if (
                node.type === 'IfStatement' ||
                node.type === 'WhileStatement' ||
                node.type === 'DoWhileStatement' ||
                node.type === 'ForStatement' ||
                node.type === 'ForInStatement' ||
                node.type === 'ForOfStatement' ||
                node.type === 'ConditionalExpression' ||
                node.type === 'CatchClause' ||
                node.type === 'SwitchCase'
            ) {
                // SwitchCase chỉ tính nếu không phải default
                if (node.type === 'SwitchCase' && node.test === null) return;
                decisionPoints++;
            }

            if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
                decisionPoints++;
            }
        }
    });

    return {
        value: 1 + decisionPoints,
        decisionPoints
    };
}