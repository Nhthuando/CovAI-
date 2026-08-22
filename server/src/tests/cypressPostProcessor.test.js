import { describe, it, expect } from '@jest/globals';

import {
    validateCypressSyntax,
    removeMarkdownWrappers,
    normalizeWhitespace,
    classifyScenarioType,
    extractCypressMetadata,
    validateCypressOutputFormat,
    generateCypressSummary,
    processSingleCypressTest,
    processCypressTests,
} from '../services/cypressPostProcessor.service.js';

// ─── validateCypressSyntax ───────────────────────────────────────────────────

describe('validateCypressSyntax', () => {
    it('should return false for null or empty content', () => {
        expect(validateCypressSyntax(null)).toBe(false);
        expect(validateCypressSyntax('')).toBe(false);
    });

    it('should return false when describe() is missing', () => {
        const code = "it('test', () => { cy.visit('/'); })";
        expect(validateCypressSyntax(code)).toBe(false);
    });

    it('should return false when cy. commands are missing', () => {
        const code = "describe('suite', () => { it('test', () => {}); })";
        expect(validateCypressSyntax(code)).toBe(false);
    });

    it('should return true for valid Cypress test code', () => {
        const code = `
describe('Auth', () => {
  it('should login', () => {
    cy.visit('/login');
    cy.get('[data-testid="username"]').type('user');
    cy.get('[data-testid="submit"]').click();
  });
});`;
        expect(validateCypressSyntax(code)).toBe(true);
    });

    it('should return true when using cy.request()', () => {
        const code = `
describe('API', () => {
  it('should return 200', () => {
    cy.request('POST', '/api/login', { user: 'a', pass: 'b' })
      .its('status').should('eq', 200);
  });
});`;
        expect(validateCypressSyntax(code)).toBe(true);
    });
});

// ─── removeMarkdownWrappers ──────────────────────────────────────────────────

describe('removeMarkdownWrappers', () => {
    it('should return empty string for null', () => {
        expect(removeMarkdownWrappers(null)).toBe('');
    });

    it('should strip javascript code block markers', () => {
        const code = '```javascript\ncy.visit(\'/\');\n```';
        expect(removeMarkdownWrappers(code)).toBe("cy.visit('/');");
    });

    it('should strip generic code block markers', () => {
        const code = '```\ncy.visit(\'/\');\n```';
        expect(removeMarkdownWrappers(code)).toBe("cy.visit('/');");
    });

    it('should handle cypress-specific markers', () => {
        const code = '```cypress\ncy.visit(\'/\');\n```';
        expect(removeMarkdownWrappers(code)).toBe("cy.visit('/');");
    });

    it('should return unchanged content when no markers', () => {
        const code = "cy.visit('/');";
        expect(removeMarkdownWrappers(code)).toBe("cy.visit('/');");
    });
});

// ─── normalizeWhitespace ─────────────────────────────────────────────────────

describe('normalizeWhitespace', () => {
    it('should return empty string for null', () => {
        expect(normalizeWhitespace(null)).toBe('');
    });

    it('should collapse 3+ consecutive newlines to 2', () => {
        const code = "line1\n\n\n\nline2";
        expect(normalizeWhitespace(code)).toBe('line1\n\nline2');
    });
});

// ─── classifyScenarioType ────────────────────────────────────────────────────

describe('classifyScenarioType', () => {
    it('should return explicitType when provided and valid', () => {
        expect(classifyScenarioType('any content', 'positive')).toBe('positive');
        expect(classifyScenarioType('any content', 'negative')).toBe('negative');
        expect(classifyScenarioType('any content', 'boundary')).toBe('boundary');
    });

    it('should ignore invalid explicitType and fallback to content detection', () => {
        const result = classifyScenarioType('// @positive\nsome test', 'invalid');
        expect(result).toBe('positive');
    });

    it('should detect @positive tag in content', () => {
        expect(classifyScenarioType('// @positive\nsome test')).toBe('positive');
    });

    it('should detect @negative tag in content', () => {
        expect(classifyScenarioType('// @negative\nsome test')).toBe('negative');
    });

    it('should detect @boundary tag in content', () => {
        expect(classifyScenarioType('// @boundary\nsome test')).toBe('boundary');
    });

    it('should detect negative from keywords', () => {
        // Use explicit negative keyword that won't be matched by positive rules
        expect(classifyScenarioType('should reject unauthorized request')).toBe('negative');
    });

    it('should detect boundary from keywords', () => {
        expect(classifyScenarioType('test for empty string edge case')).toBe('boundary');
    });

    it('should return unknown when no signals found', () => {
        expect(classifyScenarioType('some ambiguous test')).toBe('unknown');
    });
});

// ─── extractCypressMetadata ──────────────────────────────────────────────────

describe('extractCypressMetadata', () => {
    it('should return zeros for empty content', () => {
        const meta = extractCypressMetadata(null);
        expect(meta.describeCount).toBe(0);
        expect(meta.testCount).toBe(0);
        expect(meta.hasCypressCommands).toBe(false);
    });

    it('should count describe and it blocks', () => {
        const code = `
describe('A', () => {
  it('test1', () => { cy.visit('/'); });
  it('test2', () => { cy.request('/api'); });
});`;
        const meta = extractCypressMetadata(code, 'positive');
        expect(meta.describeCount).toBe(1);
        expect(meta.testCount).toBe(2);
        expect(meta.hasCypressCommands).toBe(true);
        expect(meta.scenarioType).toBe('positive');
    });
});

// ─── validateCypressOutputFormat ─────────────────────────────────────────────

describe('validateCypressOutputFormat', () => {
    it('should fail for null or non-object', () => {
        expect(validateCypressOutputFormat(null).valid).toBe(false);
        expect(validateCypressOutputFormat('string').valid).toBe(false);
    });

    it('should fail when all arrays are empty', () => {
        const result = validateCypressOutputFormat({
            positiveTests: [],
            negativeTests: [],
            boundaryTests: [],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should fail when a key is not an array', () => {
        const result = validateCypressOutputFormat({
            positiveTests: 'not-an-array',
            negativeTests: [],
            boundaryTests: [],
        });
        expect(result.valid).toBe(false);
    });

    it('should pass with at least one non-empty array', () => {
        const result = validateCypressOutputFormat({
            positiveTests: [{ filePath: 'f.cy.js', content: 'describe()' }],
            negativeTests: [],
            boundaryTests: [],
        });
        expect(result.valid).toBe(true);
    });
});

// ─── generateCypressSummary ──────────────────────────────────────────────────

describe('generateCypressSummary', () => {
    it('should count files from each category', () => {
        const summary = generateCypressSummary({
            positiveTests: [{}],
            negativeTests: [{}, {}],
            boundaryTests: [{}],
        });
        expect(summary.totalFiles).toBe(4);
        expect(summary.byScenario.positive).toBe(1);
        expect(summary.byScenario.negative).toBe(2);
        expect(summary.byScenario.boundary).toBe(1);
    });

    it('should produce a readable summary message', () => {
        const summary = generateCypressSummary({
            positiveTests: [{}],
            negativeTests: [],
            boundaryTests: [],
        });
        expect(summary.message).toContain('1 positive');
        expect(summary.message).toContain('0 negative');
    });
});

// ─── processSingleCypressTest ────────────────────────────────────────────────

describe('processSingleCypressTest', () => {
    const ctx = { projectId: 'proj-1', snapshotId: 'snap-1' };

    it('should return null for missing filePath', () => {
        const result = processSingleCypressTest({ content: 'code' }, 'positive', ctx);
        expect(result).toBeNull();
    });

    it('should return null for missing content', () => {
        const result = processSingleCypressTest({ filePath: 'f.cy.js' }, 'positive', ctx);
        expect(result).toBeNull();
    });

    it('should return a processed record with correct fields', () => {
        const raw = {
            filePath: 'cypress/e2e/auth.positive.cy.js',
            content: `describe('Auth', () => { it('login', () => { cy.visit('/'); }); });`,
        };
        const result = processSingleCypressTest(raw, 'positive', ctx);

        expect(result).not.toBeNull();
        expect(result.projectId).toBe('proj-1');
        expect(result.snapshotId).toBe('snap-1');
        expect(result.mode).toBe('CYPRESS');
        expect(result.filePath).toBe('cypress/e2e/auth.positive.cy.js');
        expect(result.content).toContain('// @positive');
        expect(result.content).toContain('[AI GENERATED]');
        expect(result.metaJson).toBeDefined();
    });

    it('should not duplicate the @positive tag if already present', () => {
        const raw = {
            filePath: 'cypress/e2e/auth.positive.cy.js',
            content: `// @positive\ndescribe('Auth', () => { it('test', () => { cy.visit('/'); }); });`,
        };
        const result = processSingleCypressTest(raw, 'positive', ctx);
        const occurrences = (result.content.match(/@positive/g) || []).length;
        expect(occurrences).toBe(1);
    });
});

// ─── processCypressTests (integration) ───────────────────────────────────────

describe('processCypressTests', () => {
    const ctx = { projectId: 'proj-1', snapshotId: 'snap-1' };

    /**
     * Helper: build a JSON string in the format that Gemini would return,
     * wrapped in a ```json block so parseAiResponse can extract it.
     */
    const buildAiResponse = (data) => {
        return '```json\n' + JSON.stringify(data) + '\n```';
    };

    it('should correctly parse and classify tests from AI response', () => {
        const positiveContent = `describe('Auth+', () => { it('login', () => { cy.visit('/'); }); });`;
        const negativeContent = `describe('Auth-', () => { it('reject', () => { cy.request('POST', '/api/login', {}).its('status').should('eq', 401); }); });`;

        const responseText = buildAiResponse({
            positiveTests: [{ filePath: 'cypress/e2e/auth.positive.cy.js', content: positiveContent }],
            negativeTests: [{ filePath: 'cypress/e2e/auth.negative.cy.js', content: negativeContent }],
            boundaryTests: [],
        });

        const result = processCypressTests(responseText, ctx);

        expect(result.positiveTests).toHaveLength(1);
        expect(result.negativeTests).toHaveLength(1);
        expect(result.boundaryTests).toHaveLength(0);
        expect(result.allTests).toHaveLength(2);
        expect(result.summary.totalFiles).toBe(2);
        expect(result.summary.message).toContain('2 Cypress test file');
    });

    it('should skip entries with missing content', () => {
        const responseText = buildAiResponse({
            positiveTests: [{ filePath: 'cypress/e2e/file.cy.js' }], // missing content
            negativeTests: [],
            boundaryTests: [],
        });

        const result = processCypressTests(responseText, ctx);
        expect(result.allTests).toHaveLength(0);
    });

    it('should handle missing arrays gracefully (partial AI response)', () => {
        // AI only returned positiveTests, missing negative and boundary
        const positiveContent = `describe('X', () => { it('t', () => { cy.visit('/'); }); });`;
        const responseText = buildAiResponse({
            positiveTests: [{ filePath: 'cypress/e2e/x.positive.cy.js', content: positiveContent }],
        });

        const result = processCypressTests(responseText, ctx);
        expect(result.negativeTests).toHaveLength(0);
        expect(result.boundaryTests).toHaveLength(0);
        expect(result.allTests).toHaveLength(1);
    });

    it('should add scenario tags and watermark to output', () => {
        const content = `describe('B', () => { it('x', () => { cy.request('/api/test').its('status').should('eq', 200); }); });`;
        const responseText = buildAiResponse({
            positiveTests: [],
            negativeTests: [],
            boundaryTests: [{ filePath: 'cypress/e2e/x.boundary.cy.js', content }],
        });

        const result = processCypressTests(responseText, ctx);
        expect(result.boundaryTests).toHaveLength(1);
        expect(result.boundaryTests[0].content).toContain('// @boundary');
        expect(result.boundaryTests[0].content).toContain('[AI GENERATED]');
        expect(result.boundaryTests[0].mode).toBe('CYPRESS');
    });
});
