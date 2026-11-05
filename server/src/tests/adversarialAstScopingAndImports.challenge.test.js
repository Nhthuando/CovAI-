import {
    analyzeSourceAst,
    analyzeBusinessLogicFile,
    extractSourceImportsAst
} from "../services/businessLogicAstAnalyzer.service.js";
import { assembleUnitTestContext } from "../services/unitTestContextEngineering.service.js";

describe("Adversarial AST Scoping & Imports Challenge Test Suite", () => {
    describe("Category 1: Extreme and Boundary Inputs", () => {
        const nonStringInputs = [
            null,
            undefined,
            0,
            -1,
            42,
            NaN,
            Infinity,
            -Infinity,
            Number.MAX_SAFE_INTEGER,
            12345678901234567890n,
            Symbol("adversarial-symbol"),
            true,
            false,
            {},
            { a: 1, nested: { b: null } },
            [],
            [1, "two", {}],
            () => { return "fn"; },
            new Date(),
            new RegExp("test-pattern"),
            Buffer.from("binary-buffer")
        ];

        test.each(nonStringInputs)("safely handles non-string primitive / object input: %p without throwing", (input) => {
            expect(() => analyzeSourceAst(input)).not.toThrow();
            expect(() => analyzeBusinessLogicFile(input, "some/path.js")).not.toThrow();
            expect(() => extractSourceImportsAst(input)).not.toThrow();

            const astResult = analyzeSourceAst(input);
            const aliasResult = analyzeBusinessLogicFile(input, "some/path.js");

            expect(astResult).toBeDefined();
            expect(astResult.ast).toBeNull();
            expect(astResult.imports).toEqual({});
            expect(astResult.sourceImports).toEqual({});
            expect(astResult.formattedImports).toEqual({});
            expect(astResult.exportedSymbols).toEqual([]);
            expect(astResult.internalFunctions).toEqual([]);
            expect(astResult.callEdges).toEqual([]);
            expect(astResult.cyclomaticComplexity).toBe(1);
            expect(astResult.basisPathsCount).toBe(1);

            expect(aliasResult).toEqual(astResult);
            expect(extractSourceImportsAst(input)).toEqual({});
        });

        test("safely handles circular / recursive object without throwing", () => {
            const circular = { name: "circular" };
            circular.self = circular;

            expect(() => analyzeSourceAst(circular)).not.toThrow();
            expect(() => analyzeBusinessLogicFile(circular)).not.toThrow();
            const res = analyzeSourceAst(circular);
            expect(res.imports).toEqual({});
            expect(res.sourceImports).toEqual({});
            expect(res.formattedImports).toEqual({});
        });

        test("safely handles empty string and whitespace variants", () => {
            const whitespaceCases = [
                "",
                " ",
                "\t",
                "\n",
                "\r\n",
                "   \r\n\t   \n  "
            ];

            for (const ws of whitespaceCases) {
                expect(() => analyzeSourceAst(ws)).not.toThrow();
                const res = analyzeSourceAst(ws);
                expect(res.imports).toEqual({});
                expect(res.sourceImports).toEqual({});
                expect(res.formattedImports).toEqual({});
                expect(res.exportedSymbols).toEqual([]);
            }
        });

        test("safely handles comments-only and semicolons-only source code", () => {
            const commentsAndSemicolons = [
                "// single line comment",
                "// comment 1\n// comment 2\n// comment 3",
                "/* multi-line comment */",
                "/*\n * Line 1\n * Line 2\n */",
                ";",
                ";;;;;;;;",
                "// comment\n;\n/* block */\n;\n"
            ];

            for (const code of commentsAndSemicolons) {
                expect(() => analyzeSourceAst(code)).not.toThrow();
                const res = analyzeSourceAst(code);
                expect(res.imports).toEqual({});
                expect(res.sourceImports).toEqual({});
                expect(res.formattedImports).toEqual({});
                expect(res.exportedSymbols).toEqual([]);
                expect(res.internalFunctions).toEqual([]);
            }
        });

        test("handles large payload stress test without throwing or memory leaks", () => {
            const lines = [];
            for (let i = 0; i < 2000; i++) {
                lines.push(`import { item_${i} } from 'module_${i % 10}';`);
                lines.push(`export function func_${i}(x) { return x + ${i}; }`);
            }
            const largeCode = lines.join("\n");

            expect(() => analyzeSourceAst(largeCode)).not.toThrow();
            const res = analyzeSourceAst(largeCode);
            expect(Object.keys(res.imports).length).toBe(10);
            expect(res.exportedSymbols.length).toBe(2000);
            expect(res.imports["module_0"].names.length).toBe(200);
        });
    });

    describe("Category 2: Malformed JavaScript and Syntax Errors", () => {
        const malformedCodeSamples = [
            { desc: "unclosed function signature", code: "export function broken(a, b { return a + ;" },
            { desc: "unexpected tokens", code: "const x = ???; const y = %%%;" },
            { desc: "unclosed string literal", code: "const str = \"unclosed string literal;\nexport const a = 1;" },
            { desc: "unclosed template literal", code: "const tpl = `unterminated template literal ${val};\nexport const b = 2;" },
            { desc: "unbalanced brackets & braces", code: "function test() { const arr = [1, 2, { a: ; return arr;" },
            { desc: "broken import syntax", code: "import { foo, from 'bar';\nimport , from 'baz';" },
            { desc: "broken export syntax", code: "export { a, from 'foo';\nexport class {" },
            { desc: "git merge conflict markers", code: "<<<<<<< HEAD\nexport const a = 1;\n=======\nexport const a = 2;\n>>>>>>> main" },
            { desc: "truncated source file", code: "export async function doTask(req, res) {\n    if (req.user) {\n        const data = await fetch(" },
            { desc: "invalid regex literal", code: "const r = /?unclosed-regex;" },
            { desc: "incomplete try/catch", code: "try { risky(); } catch (" }
        ];

        test.each(malformedCodeSamples)("gracefully handles $desc without throwing ReferenceError", ({ code }) => {
            expect(() => analyzeSourceAst(code)).not.toThrow();
            expect(() => analyzeBusinessLogicFile(code, "test.js")).not.toThrow();
            expect(() => extractSourceImportsAst(code)).not.toThrow();

            const res = analyzeSourceAst(code);
            expect(res).toBeDefined();
            expect(res.ast).toBeNull();
            expect(res.imports).toEqual({});
            expect(res.sourceImports).toEqual({});
            expect(res.formattedImports).toEqual({});
            expect(Array.isArray(res.exportedSymbols)).toBe(true);
            expect(Array.isArray(res.internalFunctions)).toBe(true);
            expect(Array.isArray(res.callEdges)).toBe(true);
        });

        test("falls back to regex symbol extraction on malformed syntax containing valid export fragments", () => {
            const partialCode = `
export function validLookingExport(a, b) {
    return a + b;
}
export const STATUS_OK = 200;
function malformedTail( { ???
`;
            const res = analyzeSourceAst(partialCode);
            expect(res.ast).toBeNull();
            expect(res.exportedSymbolNames).toContain("validLookingExport");
            expect(res.exportedSymbolNames).toContain("STATUS_OK");
            expect(res.imports).toEqual({});
            expect(res.sourceImports).toEqual({});
            expect(res.formattedImports).toEqual({});
        });
    });

    describe("Category 3: Non-Standard Imports and Dynamic Requires", () => {
        test("dynamic imports do not break AST traversal or cause ReferenceError", () => {
            const dynamicImportCode = `
export async function loadDynamically() {
    const _ = await import('lodash');
    const { helper } = await import('./localHelper');
    const dynamicPath = './runtime-' + Date.now();
    await import(dynamicPath);
    return _.isEqual(1, 1);
}
`;
            expect(() => analyzeSourceAst(dynamicImportCode)).not.toThrow();
            const res = analyzeSourceAst(dynamicImportCode);
            expect(res.exportedSymbolNames).toContain("loadDynamically");
            expect(res.imports).toBeDefined();
            expect(res.sourceImports).toBeDefined();
            expect(res.formattedImports).toBeDefined();
        });

        test("multiple imports of the same module merge default, named, and namespace specifiers cleanly", () => {
            const multiImportCode = `
import defaultEngine from 'search-engine';
import { query, filter, sort } from 'search-engine';
import { paginate } from 'search-engine';
import * as searchNamespace from 'search-engine';

export function runSearch(q) {
    const res = query(q);
    return filter(res);
}
`;
            const res = analyzeSourceAst(multiImportCode);
            expect(res.imports["search-engine"]).toBeDefined();
            expect(res.imports["search-engine"].default).toBe(true);
            expect(res.imports["search-engine"].namespace).toBe(true);

            const names = res.imports["search-engine"].names;
            expect(names).toContain("query");
            expect(names).toContain("filter");
            expect(names).toContain("sort");
            expect(names).toContain("paginate");
        });

        test("duplicate specifier in ESM imports (JS SyntaxError) is handled gracefully without ReferenceError", () => {
            const duplicateSpecifierCode = `
import { query } from 'search-engine';
import { query } from 'search-engine';
export function search() { return query(); }
`;
            expect(() => analyzeSourceAst(duplicateSpecifierCode)).not.toThrow();
            const res = analyzeSourceAst(duplicateSpecifierCode);
            expect(res.ast).toBeNull();
            expect(res.imports).toEqual({});
            expect(res.sourceImports).toEqual({});
            expect(res.formattedImports).toEqual({});
        });

        test("side-effect imports (without specifiers) are tracked with empty names array", () => {
            const sideEffectCode = `
import 'reflect-metadata';
import 'dotenv/config';
import './polyfills.js';

export function bootstrap() {
    return true;
}
`;
            const res = analyzeSourceAst(sideEffectCode);
            expect(res.imports["reflect-metadata"]).toEqual({
                default: false,
                namespace: false,
                names: []
            });
            expect(res.imports["dotenv/config"]).toEqual({
                default: false,
                namespace: false,
                names: []
            });
            expect(res.imports["./polyfills.js"]).toEqual({
                default: false,
                namespace: false,
                names: []
            });
        });

        test("namespace imports are cleanly tracked with namespace flag set to true", () => {
            const namespaceCode = `
import * as path from 'path';
import * as fs from 'fs';

export function getAbsPath(rel) {
    return path.resolve(rel);
}
`;
            const res = analyzeSourceAst(namespaceCode);
            expect(res.imports["path"]).toEqual({
                default: false,
                namespace: true,
                names: []
            });
            expect(res.imports["fs"]).toEqual({
                default: false,
                namespace: true,
                names: []
            });
        });

        test("CommonJS require without variable assignment or as expression statements", () => {
            const cjsSideEffectCode = `
require('dotenv').config();
require('module-alias/register');
require('./custom-instrumentation');

function run() {
    return process.env.PORT;
}

module.exports = { run };
`;
            expect(() => analyzeSourceAst(cjsSideEffectCode)).not.toThrow();
            const res = analyzeSourceAst(cjsSideEffectCode);
            expect(res.exportedSymbolNames).toContain("run");
            expect(res.imports).toBeDefined();
        });

        test("CommonJS nested requires inside functions, if-conditions, and try-catch blocks", () => {
            const nestedRequireCode = `
function lazyLoader(type) {
    if (type === 'heavy') {
        const { heavyProcessor } = require('./heavyProcessor');
        return heavyProcessor();
    } else {
        try {
            const fallback = require('./fallbackProcessor');
            return fallback.process();
        } catch (e) {
            const { emergency } = require('./emergency');
            return emergency();
        }
    }
}

module.exports = { lazyLoader };
`;
            const res = analyzeSourceAst(nestedRequireCode);
            expect(res.imports["./heavyProcessor"]).toEqual({
                default: false,
                namespace: false,
                names: ["heavyProcessor"]
            });
            expect(res.imports["./fallbackProcessor"]).toEqual({
                default: true,
                namespace: false,
                names: []
            });
            expect(res.imports["./emergency"]).toEqual({
                default: false,
                namespace: false,
                names: ["emergency"]
            });
        });

        test("CommonJS require with destructuring aliases and rest properties", () => {
            const complexDestructuringCode = `
const { originalName: aliasName, standardField, ...remaining } = require('complex-package');
const [ firstItem, secondItem ] = require('array-package');

function inspect() {
    return aliasName(standardField);
}

module.exports = { inspect };
`;
            expect(() => analyzeSourceAst(complexDestructuringCode)).not.toThrow();
            const res = analyzeSourceAst(complexDestructuringCode);
            expect(res.imports["complex-package"]).toBeDefined();
            expect(res.imports["complex-package"].names).toContain("originalName");
            expect(res.imports["complex-package"].names).toContain("standardField");
            expect(res.imports["array-package"]).toBeDefined();
        });

        test("CommonJS require with dynamic, computed, or non-literal arguments", () => {
            const dynamicRequireCode = `
function loadDynamic(modName) {
    const modA = require(modName);
    const modB = require();
    const modC = require(999);
    const modD = require('./static-path');
    return { modA, modB, modC, modD };
}

module.exports = { loadDynamic };
`;
            expect(() => analyzeSourceAst(dynamicRequireCode)).not.toThrow();
            const res = analyzeSourceAst(dynamicRequireCode);
            expect(res.imports["./static-path"]).toEqual({
                default: true,
                namespace: false,
                names: []
            });
            expect(res.imports).toBeDefined();
        });

        test("Chained require calls do not crash AST extraction", () => {
            const chainedCode = `
const readFile = require('fs').promises.readFile;
const resolved = require('path').resolve(__dirname, 'test');

module.exports = { readFile, resolved };
`;
            expect(() => analyzeSourceAst(chainedCode)).not.toThrow();
            const res = analyzeSourceAst(chainedCode);
            expect(res.exportedSymbolNames).toContain("readFile");
            expect(res.exportedSymbolNames).toContain("resolved");
        });

        test("Mixed ESM imports and CommonJS requires in the same file", () => {
            const mixedCode = `
import { esmFn } from 'esm-lib';
import esmDefault from 'esm-default-lib';
import * as esmNs from 'esm-ns-lib';
import 'esm-side-effect';

const cjsDefault = require('cjs-default-lib');
const { cjsNamed } = require('cjs-named-lib');
require('cjs-side-effect').run();

export function mixedPipeline(x) {
    return esmFn(cjsDefault(cjsNamed(x)));
}
`;
            const res = analyzeSourceAst(mixedCode);
            expect(res.imports["esm-lib"].names).toContain("esmFn");
            expect(res.imports["esm-default-lib"].default).toBe(true);
            expect(res.imports["esm-ns-lib"].namespace).toBe(true);
            expect(res.imports["esm-side-effect"]).toEqual({ default: false, namespace: false, names: [] });

            expect(res.imports["cjs-default-lib"].default).toBe(true);
            expect(res.imports["cjs-named-lib"].names).toContain("cjsNamed");
        });
    });

    describe("Category 4: Scoping and Invariant Verification", () => {
        test("analyzeSourceAst and analyzeBusinessLogicFile behave identically across multiple files", () => {
            const testFiles = [
                "export const x = 1;",
                "const fs = require('fs'); module.exports = { fs };",
                "import axios from 'axios'; export async function get() { return axios.get('/api'); }",
                "",
                "{ invalid syntax"
            ];

            for (const code of testFiles) {
                const r1 = analyzeSourceAst(code);
                const r2 = analyzeBusinessLogicFile(code, "virtual/path.js");

                expect(r1).toEqual(r2);
                expect(r1.imports).toEqual(r1.sourceImports);
                expect(r1.imports).toEqual(r1.formattedImports);
            }
        });

        test("extractSourceImportsAst mirrors analyzeSourceAst imports contract exactly", () => {
            const sampleCode = `
import { map, filter } from 'lodash';
import express from 'express';
import * as utils from './utils';
import 'polyfill';

const { query } = require('pg');
const redis = require('redis');
`;
            const astRes = analyzeSourceAst(sampleCode);
            const extRes = extractSourceImportsAst(sampleCode);

            expect(extRes).toEqual(astRes.imports);
            expect(extRes).toEqual(astRes.sourceImports);
            expect(extRes).toEqual(astRes.formattedImports);
        });

        test("guarantees return object structural integrity under all circumstances", () => {
            const samples = [null, undefined, "", "bad code @@@", "export function ok() {}"];
            const requiredProperties = [
                "exportedSymbols",
                "internalFunctions",
                "decisionPoints",
                "exceptionPoints",
                "cyclomaticComplexity",
                "basisPathsCount",
                "classes",
                "classMethods",
                "declaredObjects",
                "mongooseModels",
                "unexportedFunctions",
                "exportedSymbolNames",
                "infeasibleNodes",
                "ast",
                "callEdges",
                "imports",
                "sourceImports",
                "formattedImports"
            ];

            for (const sample of samples) {
                const res = analyzeSourceAst(sample);
                for (const prop of requiredProperties) {
                    expect(res).toHaveProperty(prop);
                }
                expect(typeof res.imports).toBe("object");
                expect(typeof res.sourceImports).toBe("object");
                expect(typeof res.formattedImports).toBe("object");
                expect(res.imports).not.toBeNull();
            }
        });
    });

    describe("Category 5: Downstream Integration Safety Harness (assembleUnitTestContext)", () => {
        test("assembleUnitTestContext executes without throwing when given edge cases and malformed inputs", () => {
            const problematicInputs = [
                "",
                "   \n\t  ",
                "export function calculate() { return 10; }",
                "invalid javascript ;;; {{{{",
                "import { nonexistent } from 'unknown-lib'; export default function() {}"
            ];

            for (const sourceCode of problematicInputs) {
                expect(() => assembleUnitTestContext({
                    sourceCode,
                    coverageDetails: null,
                    framework: "jest",
                    existingTestCode: ""
                })).not.toThrow();

                const context = assembleUnitTestContext({
                    sourceCode,
                    coverageDetails: null,
                    framework: "jest",
                    existingTestCode: ""
                });

                expect(context).toBeDefined();
                expect(context).toHaveProperty("astMetadata");
                expect(context).toHaveProperty("decisionTable");
                expect(context.astMetadata).toHaveProperty("imports");
                expect(context.astMetadata).toHaveProperty("sourceImports");
                expect(context.astMetadata).toHaveProperty("formattedImports");
            }
        });
    });
});
