import * as babelParser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default?.default || traverseModule.default || traverseModule;

/**
 * Trích xuất danh sách hàm từ mã nguồn JavaScript/TypeScript/JSX sử dụng Babel Parser.
 * Hỗ trợ toàn diện cú pháp ES2024+, Optional Chaining (?.), Nullish Coalescing (??), TypeScript & JSX.
 * @param {string} code - Nội dung mã nguồn
 * @returns {Array<{functionName: string, startLine: number, endLine: number, node: object}>}
 */
export function extractFunctions(code) {
    const functions = [];
    if (!code || typeof code !== 'string') return functions;

    try {
        const parseFn = babelParser.parse || babelParser.default?.parse;
        const ast = parseFn(code, {
            sourceType: 'unambiguous',
            errorRecovery: true,
            plugins: [
                'typescript',
                'jsx',
                'classProperties',
                'classPrivateProperties',
                'classPrivateMethods',
                'exportDefaultFrom'
            ]
        });

        traverse(ast, {
            enter(path) {
                const node = path.node;
                const parent = path.parent;

                if (
                    node.type === 'FunctionDeclaration' ||
                    node.type === 'FunctionExpression' ||
                    node.type === 'ArrowFunctionExpression' ||
                    node.type === 'ClassMethod' ||
                    node.type === 'ClassPrivateMethod' ||
                    node.type === 'ObjectMethod'
                ) {
                    let functionName = 'anonymous';

                    if (node.id && node.id.name) {
                        functionName = node.id.name;
                    } else if (node.key && node.key.name) {
                        functionName = node.key.name;
                    } else if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.name) {
                        functionName = parent.id.name;
                    } else if (parent && parent.type === 'AssignmentExpression') {
                        if (parent.left && parent.left.property && parent.left.property.name) {
                            functionName = parent.left.property.name;
                        } else if (parent.left && parent.left.name) {
                            functionName = parent.left.name;
                        }
                    } else if (parent && (parent.type === 'ObjectProperty' || parent.type === 'Property') && parent.key && parent.key.name) {
                        functionName = parent.key.name;
                    }

                    if (functionName === 'anonymous' && node.loc && node.loc.start) {
                        functionName = `<anonymous@L${node.loc.start.line}C${node.loc.start.column}>`;
                    }

                    const startLine = node.loc ? node.loc.start.line : 1;
                    const endLine = node.loc ? node.loc.end.line : startLine;

                    functions.push({
                        functionName,
                        startLine,
                        endLine,
                        node: node // Store node for complexity & CFG computation
                    });
                }
            }
        });
    } catch (e) {
        console.error("Error extracting functions with Babel:", e.message);
    }
    return functions;
}