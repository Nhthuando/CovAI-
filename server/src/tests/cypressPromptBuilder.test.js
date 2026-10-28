import { describe, it, expect } from '@jest/globals';

import {
    includeCypressSourceCode,
    includeRouteContext,
    includeCypressScenarioInstructions,
    includeCypressOutputFormat,
    includeCypressCodingConventions,
    buildCypressPrompt,
} from '../services/cypressPromptBuilder.service.js';

// ─── includeCypressSourceCode ────────────────────────────────────────────────

describe('includeCypressSourceCode', () => {
    it('should return a no-source message when given empty array', () => {
        const result = includeCypressSourceCode([]);
        expect(result).toContain('No source code available');
    });

    it('should return a no-source message when given null', () => {
        const result = includeCypressSourceCode(null);
        expect(result).toContain('No source code available');
    });

    it('should format source files correctly', () => {
        const sourceCode = [
            { path: 'src/auth.js', content: 'export function login() {}' },
        ];
        const result = includeCypressSourceCode(sourceCode);
        expect(result).toContain('src/auth.js');
        expect(result).toContain('export function login() {}');
        expect(result).toContain('```javascript');
    });

    it('should limit output to first 10 files and show omit notice', () => {
        const sourceCode = Array.from({ length: 15 }, (_, i) => ({
            path: `src/file${i}.js`,
            content: `// file ${i}`,
        }));
        const result = includeCypressSourceCode(sourceCode);
        expect(result).toContain('and 5 more files');
    });

    it('should not show omit notice when 10 or fewer files', () => {
        const sourceCode = Array.from({ length: 10 }, (_, i) => ({
            path: `src/file${i}.js`,
            content: `// file ${i}`,
        }));
        const result = includeCypressSourceCode(sourceCode);
        expect(result).not.toContain('more files');
    });
});

// ─── includeRouteContext ─────────────────────────────────────────────────────

describe('includeRouteContext', () => {
    it('should return empty string when no source code', () => {
        expect(includeRouteContext(null)).toBe('');
        expect(includeRouteContext([])).toBe('');
    });

    it('should return empty string when no route/controller files found', () => {
        const source = [{ path: 'src/utils/helper.js', content: '' }];
        expect(includeRouteContext(source)).toBe('');
    });

    it('should detect files with "route" in the path', () => {
        const source = [{ path: 'src/routes/auth.route.js', content: '' }];
        const result = includeRouteContext(source);
        expect(result).toContain('src/routes/auth.route.js');
        expect(result).toContain('Detected API Routes');
    });

    it('should detect files with "controller" in the path', () => {
        const source = [{ path: 'src/controllers/user.controller.js', content: '' }];
        const result = includeRouteContext(source);
        expect(result).toContain('src/controllers/user.controller.js');
    });
});

// ─── includeCypressScenarioInstructions ─────────────────────────────────────

describe('includeCypressScenarioInstructions', () => {
    it('should contain all three scenario categories', () => {
        const result = includeCypressScenarioInstructions();
        expect(result).toContain('Positive Scenarios');
        expect(result).toContain('Negative Scenarios');
        expect(result).toContain('Boundary Scenarios');
    });

    it('should include @positive, @negative, @boundary tag references', () => {
        const result = includeCypressScenarioInstructions();
        expect(result).toContain('@positive');
        expect(result).toContain('@negative');
        expect(result).toContain('@boundary');
    });
});

// ─── includeCypressOutputFormat ──────────────────────────────────────────────

describe('includeCypressOutputFormat', () => {
    it('should contain all three required JSON keys', () => {
        const result = includeCypressOutputFormat();
        expect(result).toContain('positiveTests');
        expect(result).toContain('negativeTests');
        expect(result).toContain('boundaryTests');
    });

    it('should include filePath and content field descriptions', () => {
        const result = includeCypressOutputFormat();
        expect(result).toContain('filePath');
        expect(result).toContain('content');
    });

    it('should mention cypress/e2e path convention', () => {
        const result = includeCypressOutputFormat();
        expect(result).toContain('cypress/e2e');
    });
});

// ─── includeCypressCodingConventions ─────────────────────────────────────────

describe('includeCypressCodingConventions', () => {
    it('should mention cy.intercept', () => {
        const result = includeCypressCodingConventions();
        expect(result).toContain('cy.intercept()');
    });

    it('should mention beforeEach', () => {
        const result = includeCypressCodingConventions();
        expect(result).toContain('beforeEach()');
    });
});

// ─── buildCypressPrompt ───────────────────────────────────────────────────────

describe('buildCypressPrompt', () => {
    const mockPayload = {
        sourceCode: [
            { path: 'src/auth.js', content: 'export function login(user, pass) { return fetch("/api/login", { method: "POST", body: JSON.stringify({ user, pass }) }); }' },
            { path: 'src/routes/auth.route.js', content: 'router.post("/login", loginHandler);' },
        ],
    };

    it('should return a non-empty string', () => {
        const prompt = buildCypressPrompt(mockPayload);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(100);
    });

    it('should contain Cypress E2E expertise introduction', () => {
        const prompt = buildCypressPrompt(mockPayload);
        expect(prompt).toContain('Cypress E2E test engineer');
    });

    it('should contain all three scenario type instructions', () => {
        const prompt = buildCypressPrompt(mockPayload);
        expect(prompt).toContain('Positive Scenarios');
        expect(prompt).toContain('Negative Scenarios');
        expect(prompt).toContain('Boundary Scenarios');
    });

    it('should contain the source file paths in the prompt', () => {
        const prompt = buildCypressPrompt(mockPayload);
        expect(prompt).toContain('src/auth.js');
        expect(prompt).toContain('src/routes/auth.route.js');
    });

    it('should contain output format JSON keys', () => {
        const prompt = buildCypressPrompt(mockPayload);
        expect(prompt).toContain('positiveTests');
        expect(prompt).toContain('negativeTests');
        expect(prompt).toContain('boundaryTests');
    });

    it('should include final instruction at end of prompt', () => {
        const prompt = buildCypressPrompt(mockPayload);
        expect(prompt).toContain('ONLY the JSON object inside a markdown code block');
    });

    it('should handle empty payload gracefully', () => {
        const prompt = buildCypressPrompt({});
        expect(typeof prompt).toBe('string');
        expect(prompt).toContain('Cypress E2E test engineer');
    });
});
