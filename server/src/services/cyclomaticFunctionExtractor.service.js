import esprima from 'esprima';
import estraverse from 'estraverse';

export function extractFunctions(code) {
    const functions = [];
    try {
        const ast = esprima.parseModule(code, { range: true, loc: true, tolerant: true });

        estraverse.traverse(ast, {
            enter: function (node, parent) {
                if (
                    node.type === 'FunctionDeclaration' ||
                    node.type === 'FunctionExpression' ||
                    node.type === 'ArrowFunctionExpression' ||
                    node.type === 'MethodDefinition' ||
                    (node.type === 'Property' && (node.value?.type === 'FunctionExpression' || node.value?.type === 'ArrowFunctionExpression'))
                ) {
                    let functionName = 'anonymous';
                    if (node.type === 'FunctionDeclaration') {
                        functionName = node.id ? node.id.name : 'anonymous';
                    } else if (node.type === 'MethodDefinition') {
                        functionName = node.key?.name || 'anonymous';
                    } else if (node.type === 'Property') {
                        functionName = node.key?.name || 'anonymous';
                    } else if (node.id) {
                        functionName = node.id.name;
                    } else if (parent && parent.type === 'VariableDeclarator' && parent.id) {
                        functionName = parent.id.name;
                    } else if (parent && parent.type === 'Property' && parent.key) {
                        functionName = parent.key.name;
                    } else if (parent && parent.type === 'AssignmentExpression' && parent.left && parent.left.property) {
                        functionName = parent.left.property.name;
                    }

                    if (functionName === 'anonymous' && node.loc && node.loc.start) {
                        functionName = `<anonymous@L${node.loc.start.line}C${node.loc.start.column}>`;
                    }

                    // Only push if it's the actual function node, not the Property wrapper
                    if (node.type !== 'Property') {
                        functions.push({
                            functionName,
                            startLine: node.loc.start.line,
                            endLine: node.loc.end.line,
                            node: node // Lưu node để tính complexity
                        });
                    }
                }
            }
        });
    } catch (e) {
        console.error("Error extracting functions:", e.message);
    }
    return functions;
}