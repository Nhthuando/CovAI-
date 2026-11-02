/**
 * Calculates Cyclomatic Complexity from function AST node.
 * Supports Babel (@babel/parser) AST nodes with full ES2024+ compatibility.
 * CC = 1 + Decision Points (If, Loops, Catch, Switch cases, Logical &&, ||, ??).
 * @param {object} astNode - Function AST node
 * @returns {{value: number, decisionPoints: number}}
 */
export function calculateComplexityFromAst(astNode) {
    let decisionPoints = 0;
    if (!astNode || typeof astNode !== 'object') {
        return { value: 1, decisionPoints: 0 };
    }

    try {
        const countDecisions = (node) => {
            if (!node || typeof node !== 'object') return;
            const type = node.type;

            if (
                type === 'IfStatement' ||
                type === 'WhileStatement' ||
                type === 'DoWhileStatement' ||
                type === 'ForStatement' ||
                type === 'ForInStatement' ||
                type === 'ForOfStatement' ||
                type === 'ConditionalExpression' ||
                type === 'CatchClause'
            ) {
                decisionPoints++;
            }

            // SwitchCase is only a decision point if it has a test condition (not default)
            if (type === 'SwitchCase' && node.test !== null && node.test !== undefined) {
                decisionPoints++;
            }

            // LogicalExpression: &&, ||, and ?? (Nullish Coalescing)
            if (
                type === 'LogicalExpression' &&
                (node.operator === '&&' || node.operator === '||' || node.operator === '??')
            ) {
                decisionPoints++;
            }

            // Recursively traverse all node child properties (safe, avoids unknown node type errors)
            for (const key of Object.keys(node)) {
                if (
                    key === 'loc' ||
                    key === 'parent' ||
                    key === 'leadingComments' ||
                    key === 'trailingComments' ||
                    key === 'innerComments' ||
                    key === 'extra'
                ) {
                    continue;
                }
                const child = node[key];
                if (Array.isArray(child)) {
                    for (const item of child) {
                        countDecisions(item);
                    }
                } else if (child && typeof child === 'object') {
                    countDecisions(child);
                }
            }
        };

        // Traverse function body (node.body) if present, or traverse astNode directly
        countDecisions(astNode.body || astNode);
    } catch (err) {
        console.warn('Failed to calculate complexity from AST:', err.message);
    }

    return {
        value: 1 + decisionPoints,
        decisionPoints
    };
}