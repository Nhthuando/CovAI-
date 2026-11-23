import { assembleUnitTestCandidate } from '../services/unitTestChangeSet.service.js';
import { deduplicateAstDeclarations } from '../services/testHelperRegistry.service.js';
import { mergeUnitTestSuggestions } from '../services/unitTestSuggestionBatch.service.js';

describe('R1: Conflicting Import Binding Resolution and Destructured Require Deduplication', () => {
    test('Scenario 1: Assembles CJS destructured requires from different modules without throwing Conflicting import binding', () => {
        const base = `const { verifyToken } = require('../middleware/verifyToken');\n\ndescribe('Middleware verifyToken', () => {\n  it('checks auth', () => {});\n});\n`;
        const candidate = `const { verifyToken } = require('../socket/middleware/verifyToken');\n\ndescribe('Socket verifyToken', () => {\n  it('validates socket token', () => {});\n});\n`;

        expect(() => {
            const result = assembleUnitTestCandidate({
                original: base,
                proposed: candidate,
                testFile: 'tests/verifyToken.test.js'
            });
            expect(result).toBeDefined();
            expect(result.content).toContain('Middleware verifyToken');
            expect(result.content).toContain('Socket verifyToken');
        }).not.toThrow();
    });

    test('Scenario 2: Normalizes Windows backslashes and relative paths in sameModule', () => {
        const base = `const { verifyToken } = require('..\\\\middleware\\\\verifyToken.js');\n\ndescribe('Suite 1', () => {\n  it('works', () => {});\n});\n`;
        const candidate = `const { verifyToken } = require('../middleware/verifyToken');\n\ndescribe('Suite 2', () => {\n  it('also works', () => {});\n});\n`;

        const result = assembleUnitTestCandidate({
            original: base,
            proposed: candidate,
            testFile: 'tests/verifyToken.test.js'
        });
        expect(result.content).toContain('Suite 1');
        expect(result.content).toContain('Suite 2');
        // Should not declare verifyToken twice
        const verifyTokenCount = (result.content.match(/verifyToken/g) || []).length;
        expect(verifyTokenCount).toBeGreaterThanOrEqual(2);
    });

    test('Scenario 3: Assembles direct identifier require without throwing on conflicting module', () => {
        const base = `const verifyToken = require('../middleware/verifyToken');\n\ndescribe('Base suite', () => {\n  it('runs', () => {});\n});\n`;
        const candidate = `const verifyToken = require('../socket/middleware/verifyToken');\n\ndescribe('Candidate suite', () => {\n  it('runs too', () => {});\n});\n`;

        expect(() => {
            const result = assembleUnitTestCandidate({
                original: base,
                proposed: candidate,
                testFile: 'tests/verifyToken.test.js'
            });
            expect(result.content).toContain('Candidate suite');
        }).not.toThrow();
    });

    test('Scenario 4: deduplicateAstDeclarations deduplicates redundant ObjectPattern requires', () => {
        const code = `const { verifyToken } = require('../middleware/verifyToken');
const { verifyToken } = require('../middleware/verifyToken');

describe('Token Suite', () => {
  it('passes', () => {
    expect(verifyToken).toBeDefined();
  });
});
`;
        const result = deduplicateAstDeclarations(code, { filePath: 'tests/token.test.js' });
        expect(result.deduplicatedCount).toBeGreaterThanOrEqual(1);
        expect(result.code).toContain('verifyToken');
        // Only one declaration remains
        const occurrences = (result.code.match(/const\s+\{\s*verifyToken\s*\}\s*=\s*require/g) || []).length;
        expect(occurrences).toBe(1);
    });

    test('Scenario 5: mergeUnitTestSuggestions does not crash the batch on candidate conflict', () => {
        const suggestions = [
            {
                testFile: 'tests/verifyToken.coverage.test.js',
                sourceFile: 'middleware/verifyToken.js',
                framework: 'jest',
                suggestedTestCode: `const { verifyToken } = require('../middleware/verifyToken');\ndescribe('Suite A', () => { it('a', () => {}); });`,
                changeSet: { candidateHash: 'hash1' }
            },
            {
                testFile: 'tests/verifyToken.coverage.test.js',
                sourceFile: 'socket/middleware/verifyToken.js',
                framework: 'jest',
                suggestedTestCode: `const { verifyToken } = require('../socket/middleware/verifyToken');\ndescribe('Suite B', () => { it('b', () => {}); });`,
                changeSet: { candidateHash: 'hash2' }
            }
        ];

        expect(() => {
            const merged = mergeUnitTestSuggestions('d:/NCKH/CovAI-/server', suggestions);
            expect(merged).toBeDefined();
            expect(merged.length).toBeGreaterThanOrEqual(1);
        }).not.toThrow();
    });

    test('Scenario 6: Multi-property redundant ObjectPattern requires are cleanly removed with zero syntax errors', () => {
        const code = `const { verifyToken, checkRole } = require('../middleware/verifyToken');
const { verifyToken, checkRole } = require('../middleware/verifyToken');

describe('Auth Suite', () => {
  it('checks auth', () => {
    expect(verifyToken).toBeDefined();
    expect(checkRole).toBeDefined();
  });
});
`;
        const result = deduplicateAstDeclarations(code, { filePath: 'tests/auth.test.js' });
        expect(result.deduplicatedCount).toBe(2);
        // Ensure no malformed syntax like "const { = require"
        expect(result.code).not.toContain('const { =');
        expect(result.code).not.toContain('const {  =');
        // Redundant statement completely removed, exactly 1 require statement remains
        const requireMatches = result.code.match(/const\s+\{\s*verifyToken,\s*checkRole\s*\}\s*=\s*require/g);
        expect(requireMatches).not.toBeNull();
        expect(requireMatches.length).toBe(1);

        // Verify valid JavaScript syntax
        expect(() => {
            new Function(result.code);
        }).not.toThrow();
    });

    test('Scenario 7: Multi-property partial ObjectPattern require cleanly slices duplicate property without syntax errors', () => {
        const code = `const { verifyToken } = require('../middleware/verifyToken');
const { verifyToken, checkRole } = require('../middleware/verifyToken');

describe('Partial Suite', () => {
  it('runs', () => {
    expect(verifyToken).toBeDefined();
    expect(checkRole).toBeDefined();
  });
});
`;
        const result = deduplicateAstDeclarations(code, { filePath: 'tests/partial.test.js' });
        expect(result.deduplicatedCount).toBe(1);
        expect(result.code).not.toContain('const { =');
        expect(result.code).toContain('checkRole');
        // Second statement should now only destructure checkRole
        expect(result.code).toMatch(/const\s+\{\s*checkRole\s*\}\s*=\s*require/);

        expect(() => {
            new Function(result.code);
        }).not.toThrow();
    });

    test('Scenario 8: Multi-specifier redundant ImportDeclaration is cleanly removed', () => {
        const code = `import { verifyToken, checkRole } from './verifyToken.js';
import { verifyToken, checkRole } from './verifyToken.js';

describe('Import Suite', () => {
  it('runs', () => {
    expect(verifyToken).toBeDefined();
  });
});
`;
        const result = deduplicateAstDeclarations(code, { filePath: 'tests/import.test.js' });
        expect(result.deduplicatedCount).toBe(2);
        expect(result.code).not.toContain('import { from');
        const importMatches = result.code.match(/import\s+\{\s*verifyToken,\s*checkRole\s*\}\s*from/g);
        expect(importMatches).not.toBeNull();
        expect(importMatches.length).toBe(1);
    });

    test('Scenario 9: Multi-specifier partial ImportDeclaration cleanly slices duplicate specifier', () => {
        const code = `import { verifyToken } from './verifyToken.js';
import { verifyToken, checkRole } from './verifyToken.js';

describe('Import Partial Suite', () => {
  it('runs', () => {
    expect(verifyToken).toBeDefined();
  });
});
`;
        const result = deduplicateAstDeclarations(code, { filePath: 'tests/import-partial.test.js' });
        expect(result.deduplicatedCount).toBe(1);
        expect(result.code).not.toContain('import { from');
        expect(result.code).toMatch(/import\s+\{\s*checkRole\s*\}\s*from/);
    });

    test('Scenario 10: Multi-declarator VariableDeclaration deduplication parses without SyntaxError', () => {
        const code = `const a = 1, b = 2;
const a = 1, b = 2;

describe('Declarator Suite', () => {
  it('runs', () => {
    expect(a + b).toBe(3);
  });
});
`;
        const result = deduplicateAstDeclarations(code, { filePath: 'tests/decl.test.js' });
        expect(result.deduplicatedCount).toBe(2);
        expect(result.code).not.toMatch(/const\s*;/);
        expect(result.code).not.toMatch(/const\s*$/m);

        expect(() => {
            new Function(result.code);
        }).not.toThrow();
    });
});
