import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { extractFunctions } from "../services/functionExtraction.service.js";

describe('Function Extraction Service', () => {
    const filePath = 'test.js';

    test('should return empty array for null AST', () => {
        expect(extractFunctions(null, filePath)).toEqual([]);
    });

    test('should extract all function types correctly', () => {
        const code = `
            function decl() {}
            const arrow = () => {};
            const expr = function() {};
            class Cls { method() {} logout = () => {}; save = function() {}; }
            const obj = { method() {}, prop: () => {}, multiply: function() {} };
            [].map(function(i) { return i; });
            setTimeout(()=>{}, 1000);
        `;
        const ast = parseJavaScriptCode(code).ast;
        const functions = extractFunctions(ast, filePath);

        expect(functions).toContainEqual(expect.objectContaining({ name: 'decl', type: 'FunctionDeclaration', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'arrow', type: 'ArrowFunctionExpression', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'expr', type: 'FunctionExpression', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'method', type: 'ClassMethod', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'logout', type: 'ArrowFunctionExpression', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'save', type: 'FunctionExpression', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'method', type: 'ObjectMethod', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'prop', type: 'ArrowFunctionExpression', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'multiply', type: 'FunctionExpression', isAnonymous: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'anonymous', type: 'FunctionExpression', isAnonymous: true }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'anonymous', type: 'ArrowFunctionExpression', isAnonymous: true }));
    });

    test('should handle async and generator flags', () => {
        const code = `
            async function asyncFunc() {}
            function* genFunc() {}
        `;
        const ast = parseJavaScriptCode(code).ast;
        const functions = extractFunctions(ast, filePath);

        expect(functions).toContainEqual(expect.objectContaining({ name: 'asyncFunc', async: true, generator: false }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'genFunc', async: false, generator: true }));
    });

    test('should handle various key types', () => {
        const code = `
            const obj = {
                "hello"() {},
                123() {},
                ["save"]() {}
            };
        `;
        const ast = parseJavaScriptCode(code).ast;
        const functions = extractFunctions(ast, filePath);

        expect(functions).toContainEqual(expect.objectContaining({ name: 'hello', type: 'ObjectMethod' }));
        expect(functions).toContainEqual(expect.objectContaining({ name: '123', type: 'ObjectMethod' }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'save', type: 'ObjectMethod' }));
    });

    test('should handle nested functions', () => {
        const code = `
            function outer() {
                function inner() {}
            }
        `;
        const ast = parseJavaScriptCode(code).ast;
        const functions = extractFunctions(ast, filePath);

        expect(functions).toContainEqual(expect.objectContaining({ name: 'outer' }));
        expect(functions).toContainEqual(expect.objectContaining({ name: 'inner' }));
    });
});