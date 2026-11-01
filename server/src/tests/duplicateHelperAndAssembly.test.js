import {
    deduplicateAstDeclarations,
    inspectAstScopeDuplicates,
    assembleDeterministicTestFile,
    CANONICAL_BUILTIN_HELPERS
} from "../services/testHelperRegistry.service.js";
import { validateTestCodeAst, autoRepairTestSyntaxWithAst } from "../validators/aiTestCode.validator.js";
import { generateFallbackUnitTests } from "../services/unitTestSuggestion.service.js";
import { cleanAndDeduplicateTestContent } from "../services/testSanitizer.service.js";
import { insertCodeIntoTestFile } from "../services/applyTestSuggestion.service.js";

describe("Duplicate Helper Declarations & AST Assembly Invariant Tests", () => {
    // Scenario 1: Single helper generated once parses cleanly
    test("Scenario 1: Single helper generated once is valid AST", () => {
        const code = `
        describe('suite', () => {
            ${CANONICAL_BUILTIN_HELPERS._collectCallableMembers}
            test('case 1', () => {
                const members = _collectCallableMembers({});
                expect(members).toBeDefined();
            });
        });
        `;
        const val = validateTestCodeAst(code);
        expect(val.valid).toBe(true);
        expect(val.errors.length).toBe(0);
    });

    // Scenario 2: Exact user bug reproduction fixture (47 repeated helpers at ~180 line intervals)
    test("Scenario 2: Exact user bug reproduction (47 duplicate _collectCallableMembers) is cleanly healed to exactly 1 declaration", () => {
        const helperBlock = `    const _collectCallableMembers = (target: any) => {
        const list: { name: string; fn: Function }[] = [];
        if (!target) return list;
        if (typeof target === 'function') {
            for (const p of Object.getOwnPropertyNames(target)) {
                if (!['length', 'name', 'prototype', 'caller', 'arguments', 'constructor'].includes(p) && typeof target[p] === 'function') {
                    list.push({ name: p, fn: target[p].bind(target) });
                }
            }
        }
        return list;
    };`;

        const testBlock = (fnIdx) => `    test('fn${fnIdx} happy path', () => {
        const members = _collectCallableMembers({});
        expect(members).toBeDefined();
    });`;

        // Build code with 47 duplicate declarations inside the same describe block
        const chunks = [];
        for (let i = 1; i <= 47; i++) {
            chunks.push(helperBlock + "\n" + testBlock(i));
        }
        const fullBuggyCode = `// @ts-nocheck
describe('cartController unit tests', () => {
${chunks.join("\n\n")}
});
`;

        // Before repair: should detect duplicate declarations
        const preVal = validateTestCodeAst(fullBuggyCode);
        expect(preVal.valid).toBe(false);
        const dupErrors = preVal.errors.filter(e => e.message.includes("has already been declared"));
        expect(dupErrors.length).toBeGreaterThan(0);

        // Auto-repair with AST deduplication
        const repaired = autoRepairTestSyntaxWithAst(fullBuggyCode);
        expect(repaired.repaired).toBe(true);
        expect(repaired.errors.length).toBe(0);

        // Verify that in the repaired code, _collectCallableMembers is declared exactly ONCE
        const matches = [...repaired.code.matchAll(/\bconst\s+_collectCallableMembers\s*=/g)];
        expect(matches.length).toBe(1);

        // Verify it still contains all 47 test cases
        for (let i = 1; i <= 47; i++) {
            expect(repaired.code).toContain(`test('fn${i} happy path'`);
        }
    });

    // Scenario 3: Scaling across 10, 50, and 100 fragments
    test("Scenario 3: Scaling across 10, 50, and 100 fragments maintains single declaration and valid syntax", () => {
        for (const count of [10, 50, 100]) {
            const fragments = [];
            for (let i = 0; i < count; i++) {
                fragments.push(`
                const _getMock = () => jest.fn().mockReturnThis();
                test('case_${i}', () => {
                    const mock = _getMock();
                    expect(mock).toBeDefined();
                });
                `);
            }
            const combined = `describe('scale_${count}', () => {\n${fragments.join("\n")}\n});`;
            const deduped = deduplicateAstDeclarations(combined);
            expect(deduped.changed).toBe(true);
            const matches = [...deduped.code.matchAll(/\bconst\s+_getMock\s*=/g)];
            expect(matches.length).toBe(1);
            const val = validateTestCodeAst(deduped.code);
            expect(val.valid).toBe(true);
        }
    });

    // Scenario 4: Conflicting helper implementations in the same scope
    test("Scenario 4: Conflicting implementations in same scope are flagged and not silently overwritten", () => {
        const conflictingCode = `
        describe('conflictSuite', () => {
            const calculateTax = (amount) => amount * 0.1;
            const calculateTax = (amount) => amount * 0.999 + 500;
            test('test 1', () => {
                expect(calculateTax(100)).toBeDefined();
            });
        });
        `;
        const val = validateTestCodeAst(conflictingCode);
        expect(val.valid).toBe(false);
        const conflictErr = val.errors.find(e => e.construct === "DuplicateDeclarationConflict");
        expect(conflictErr).toBeDefined();
        expect(conflictErr.message).toContain("calculateTax");
    });

    // Scenario 5: Same helper name in independent lexical scopes
    test("Scenario 5: Same helper name in independent lexical scopes is preserved", () => {
        const independentScopesCode = `
        describe('Suite A', () => {
            test('Test 1', () => {
                const req = { id: 1 };
                expect(req.id).toBe(1);
            });
            test('Test 2', () => {
                const req = { id: 2, other: true };
                expect(req.id).toBe(2);
            });
        });
        describe('Suite B', () => {
            test('Test 3', () => {
                const req = { special: true };
                expect(req.special).toBe(true);
            });
        });
        `;
        const val = validateTestCodeAst(independentScopesCode);
        expect(val.valid).toBe(true);
        const dedupResult = deduplicateAstDeclarations(independentScopesCode);
        expect(dedupResult.changed).toBe(false);
        expect(dedupResult.code).toContain("const req = { id: 1 }");
        expect(dedupResult.code).toContain("const req = { id: 2, other: true }");
        expect(dedupResult.code).toContain("const req = { special: true }");
    });

    // Scenario 6: Nested helper declarations inside helper functions
    test("Scenario 6: Nested helper declarations are handled without clobbering inner or outer scopes", () => {
        const nestedCode = `
        describe('nestedSuite', () => {
            const outerHelper = (x) => {
                const innerHelper = (y) => y * 2;
                return innerHelper(x) + 1;
            };
            test('nested test', () => {
                expect(outerHelper(5)).toBe(11);
            });
        });
        `;
        const val = validateTestCodeAst(nestedCode);
        expect(val.valid).toBe(true);
        const dedupResult = deduplicateAstDeclarations(nestedCode);
        expect(dedupResult.changed).toBe(false);
    });

    // Scenario 7: Multiple interdependent helpers
    test("Scenario 7: Multiple interdependent helpers maintain declaration order and references", () => {
        const interdependentCode = `
        describe('interdependentSuite', () => {
            const _isDangerous = (name) => name === 'exit' || name === 'destroy';
            const _collectSafe = (obj) => {
                return Object.keys(obj).filter(k => !_isDangerous(k));
            };
            test('interdependent test', () => {
                expect(_collectSafe({ a: 1, exit: 2 })).toEqual(['a']);
            });
        });
        `;
        const val = validateTestCodeAst(interdependentCode);
        expect(val.valid).toBe(true);
        const dedupResult = deduplicateAstDeclarations(interdependentCode);
        expect(dedupResult.changed).toBe(false);
        expect(dedupResult.code).toContain("_isDangerous");
        expect(dedupResult.code).toContain("_collectSafe");
    });

    // Scenario 8: Repeated generation and retry idempotence
    test("Scenario 8: Repeated generation and retry leaves zero duplicate helpers", () => {
        let code = `
        const defaultExport = require('../src/controllers/cartController');
        describe('cartController unit tests', () => {
            const _collectCallableMembers = (target) => [target];
            test('initial test', () => {
                expect(true).toBe(true);
            });
        });
        `;
        const deltaSnippet = `
        describe('cartController unit tests', () => {
            const _collectCallableMembers = (target) => [target];
            test('delta test 1', () => {
                expect(true).toBe(true);
            });
        });
        `;

        // Apply delta 3 times
        for (let pass = 1; pass <= 3; pass++) {
            code = insertCodeIntoTestFile(code, deltaSnippet, "tests/cart.test.js");
        }

        const count = [...code.matchAll(/\bconst\s+_collectCallableMembers\s*=/g)].length;
        expect(count).toBe(1);
        const val = validateTestCodeAst(code);
        expect(val.valid).toBe(true);
    });

    // Scenario 9: Repeated assembly idempotence A(A(F)) == A(F)
    test("Scenario 9: Repeated assembly is strictly idempotent", () => {
        const initial = assembleDeterministicTestFile({
            headerDirectives: "// @ts-nocheck",
            imports: ["import { describe, test, expect } from 'vitest';", "import { cartController } from './cart';"],
            mocks: ["vi.mock('./db');"],
            helpers: [CANONICAL_BUILTIN_HELPERS._collectCallableMembers, CANONICAL_BUILTIN_HELPERS._getMock],
            setups: ["beforeEach(() => { vi.clearAllMocks(); });"],
            testSuites: [
                `describe('Cart Suite', () => {
                    test('executes cart', () => {
                        expect(true).toBe(true);
                    });
                });`
            ]
        });

        const pass1 = deduplicateAstDeclarations(initial).code;
        const pass2 = deduplicateAstDeclarations(pass1).code;
        const pass3 = cleanAndDeduplicateTestContent(pass2, "", "cart.test.ts");
        const pass4 = deduplicateAstDeclarations(pass3).code;

        expect(pass2).toEqual(pass1);
        expect(pass4).toEqual(pass3);
    });

    // Scenario 10: Deduplication across FunctionDeclaration, VariableDeclaration, ClassDeclaration, ObjectMethod, and Imports
    test("Scenario 10: Deduplicates various declaration node types in same scope", () => {
        const mixedCode = `
        import { fnA } from './utils';
        import { fnA, fnB } from './utils';

        function sharedTool() { return 'tool'; }
        function sharedTool() { return 'tool'; }

        class MockClient { ping() { return true; } }
        class MockClient { ping() { return true; } }

        describe('various nodes', () => {
            const helperVar = () => 42;
            const helperVar = () => 42;
            test('test node dedup', () => {
                expect(sharedTool()).toBe('tool');
            });
        });
        `;
        const deduped = deduplicateAstDeclarations(mixedCode);
        expect(deduped.changed).toBe(true);
        expect([...deduped.code.matchAll(/\bfunction\s+sharedTool\b/g)].length).toBe(1);
        expect([...deduped.code.matchAll(/\bclass\s+MockClient\b/g)].length).toBe(1);
        expect([...deduped.code.matchAll(/\bconst\s+helperVar\b/g)].length).toBe(1);
        const val = validateTestCodeAst(deduped.code);
        expect(val.valid).toBe(true);
    });

    // Scenario 11: Both JavaScript and TypeScript outputs parse cleanly
    test("Scenario 11: Both JavaScript and TypeScript syntaxes are supported", () => {
        const tsCode = `// @ts-nocheck
        interface CartItem { id: string; qty: number; }
        const _collect = (t: any): CartItem[] => [];
        const _collect = (t: any): CartItem[] => [];
        describe('TS Suite', () => {
            test('types work', () => {
                const res: CartItem[] = _collect({});
                expect(res).toBeDefined();
            });
        });`;

        const dedupedTs = deduplicateAstDeclarations(tsCode);
        expect(dedupedTs.changed).toBe(true);
        expect([...dedupedTs.code.matchAll(/\bconst\s+_collect\s*=/g)].length).toBe(1);
        expect(validateTestCodeAst(dedupedTs.code).valid).toBe(true);

        const jsCode = `
        const _collect = (t) => [];
        const _collect = (t) => [];
        describe('JS Suite', () => {
            test('js works', () => {
                expect(_collect({})).toBeDefined();
            });
        });`;
        const dedupedJs = deduplicateAstDeclarations(jsCode);
        expect(dedupedJs.changed).toBe(true);
        expect([...dedupedJs.code.matchAll(/\bconst\s+_collect\s*=/g)].length).toBe(1);
        expect(validateTestCodeAst(dedupedJs.code).valid).toBe(true);
    });

    // Scenario 12: Both Jest and Vitest outputs supported
    test("Scenario 12: Both Jest and Vitest test code syntaxes supported", () => {
        const vitestCode = `
        import { describe, test, expect, vi } from 'vitest';
        const _getMock = () => vi.fn();
        const _getMock = () => vi.fn();
        describe('vitestSuite', () => {
            test('runs', () => {
                expect(_getMock()).toBeDefined();
            });
        });
        `;
        const dedupedVitest = deduplicateAstDeclarations(vitestCode);
        expect(dedupedVitest.changed).toBe(true);
        expect([...dedupedVitest.code.matchAll(/\bconst\s+_getMock\s*=/g)].length).toBe(1);
        expect(validateTestCodeAst(dedupedVitest.code).valid).toBe(true);

        const jestCode = `
        const _getMock = () => jest.fn();
        const _getMock = () => jest.fn();
        describe('jestSuite', () => {
            test('runs', () => {
                expect(_getMock()).toBeDefined();
            });
        });
        `;
        const dedupedJest = deduplicateAstDeclarations(jestCode);
        expect(dedupedJest.changed).toBe(true);
        expect([...dedupedJest.code.matchAll(/\bconst\s+_getMock\s*=/g)].length).toBe(1);
        expect(validateTestCodeAst(dedupedJest.code).valid).toBe(true);
    });

    // Scenario 13: generateFallbackUnitTests with 47 exported functions produces 0 duplicates
    test("Scenario 13: generateFallbackUnitTests with 47 exported functions emits exactly 1 _collectCallableMembers", () => {
        const dummyExports = [];
        for (let i = 1; i <= 47; i++) {
            dummyExports.push(`fn${i}`);
        }
        const sourceCode = dummyExports.map(fn => `export const ${fn} = () => {};`).join("\n");

        const result = generateFallbackUnitTests({
            sourceFile: "src/utils/bigService.js",
            sourceCode,
            uncoveredLines: [10, 20, 30],
            framework: "jest",
            targetTestFile: "tests/unit/bigService.test.js"
        });

        expect(result.suggestedTestCode).toBeDefined();
        const matches = [...result.suggestedTestCode.matchAll(/\bconst\s+_collectCallableMembers\s*=/g)];
        expect(matches.length).toBe(1);
        const val = validateTestCodeAst(result.suggestedTestCode);
        expect(val.valid).toBe(true);
        expect(val.errors.length).toBe(0);
    });

    // Scenario 14: generateFallbackUnitTests with controller exports produces exactly 1 _collectControllerActions
    test("Scenario 14: generateFallbackUnitTests with controller emits exactly 1 _collectControllerActions", () => {
        const dummyControllerFns = ["checkout", "validateCart", "addItem", "removeItem", "clearCart"];
        const sourceCode = dummyControllerFns.map(fn => `exports.${fn} = (req, res) => {};`).join("\n");

        const result = generateFallbackUnitTests({
            sourceFile: "server/controllers/cartController.js",
            sourceCode,
            uncoveredLines: [15, 25],
            framework: "jest",
            targetTestFile: "server/tests/cartController.test.js"
        });

        expect(result.suggestedTestCode).toBeDefined();
        const matches = [...result.suggestedTestCode.matchAll(/\bconst\s+_collectControllerActions\s*=/g)];
        expect(matches.length).toBe(1);
        const val = validateTestCodeAst(result.suggestedTestCode);
        expect(val.valid).toBe(true);
        expect(val.errors.length).toBe(0);
    });
});

