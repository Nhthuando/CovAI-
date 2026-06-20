import esprima from 'esprima';
import estraverse from 'estraverse';

export function extractFunctions(code) {
    const functions = [];
    try {
        const ast = esprima.parseScript(code, { range: true, loc: true });

        estraverse.traverse(ast, {
            enter: function (node) {
                if (
                    node.type === 'FunctionDeclaration' ||
                    node.type === 'FunctionExpression' ||
                    node.type === 'ArrowFunctionExpression' ||
                    node.type === 'MethodDefinition' ||
                    node.type === 'Property' && (node.value.type === 'FunctionExpression' || node.value.type === 'ArrowFunctionExpression')
                ) {
                    let functionName = 'anonymous';
                    if (node.type === 'FunctionDeclaration') {
                        functionName = node.id ? node.id.name : 'anonymous';
                    } else if (node.type === 'MethodDefinition') {
                        functionName = node.key.name;
                    } else if (node.type === 'Property') {
                        functionName = node.key.name;
                    } else if (node.id) {
                        functionName = node.id.name;
                    }

                    functions.push({
                        functionName,
                        startLine: node.loc.start.line,
                        endLine: node.loc.end.line,
                        node: node // Lưu node để tính complexity
                    });
                }
            }
        });
    } catch (e) {
        console.error("Error extracting functions:", e);
    }
    return functions;
}