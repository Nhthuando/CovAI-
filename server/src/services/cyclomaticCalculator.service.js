/**
 * Tính toán Cyclomatic Complexity từ nút AST của hàm.
 * Hỗ trợ các nút AST từ Babel (@babel/parser), tương thích đầy đủ với ES2024+.
 * CC = 1 + Decision Points (If, Loops, Catch, Switch cases, Logical &&, ||, ??).
 * @param {object} astNode - Nút AST của hàm
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

            // SwitchCase chỉ tính là điểm rẽ nhánh khi có điều kiện test (không phải default)
            if (type === 'SwitchCase' && node.test !== null && node.test !== undefined) {
                decisionPoints++;
            }

            // LogicalExpression: &&, || và ?? (Nullish Coalescing)
            if (
                type === 'LogicalExpression' &&
                (node.operator === '&&' || node.operator === '||' || node.operator === '??')
            ) {
                decisionPoints++;
            }

            // Duyệt đệ quy tất cả thuộc tính con của node (an toàn, không lỗi unknown node type)
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

        // Duyệt phần thân hàm (node.body) nếu có, hoặc duyệt chính astNode
        countDecisions(astNode.body || astNode);
    } catch (err) {
        console.warn('Failed to calculate complexity from AST:', err.message);
    }

    return {
        value: 1 + decisionPoints,
        decisionPoints
    };
}