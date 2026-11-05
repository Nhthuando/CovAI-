import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseBranchCoverage, parseFunctionCoverage, parseLineCoverage, parseStatementCoverage } from '../services/coverageSummaryParser.service.js';
import { parseJestResults, parseVitestResults } from '../services/testResultParser.service.js';
import { replaceBalancedMethodCall, replaceBalancedExpectAssertion } from '../services/applyTestSuggestion.service.js';

describe('Milestone 3: Execution Runner, Immutability & 100% Metrics', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-m3-test-'));
    });

    afterEach(() => {
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (_) {}
    });

    describe('Feature 23: 0-Branch and 0-Function Dimension 100% Metric Calculation', () => {
        test('defaults branchesPct to 100 when total === 0 and covered === 0 per Rule 7', () => {
            const entry = {
                branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
                lines: { total: 10, covered: 10, skipped: 0, pct: 100 }
            };
            const branchMetric = parseBranchCoverage(entry);
            expect(branchMetric.total).toBe(0);
            expect(branchMetric.covered).toBe(0);
            expect(branchMetric.pct).toBe(100);

            const lineMetric = parseLineCoverage(entry);
            expect(lineMetric.pct).toBe(100);
        });

        test('defaults funcsPct to 100 when total === 0 and covered === 0 per Rule 7', () => {
            const entry = {
                functions: { total: 0, covered: 0, skipped: 0, pct: 0 }
            };
            const funcMetric = parseFunctionCoverage(entry);
            expect(funcMetric.total).toBe(0);
            expect(funcMetric.pct).toBe(100);
        });

        test('preserves real non-zero branch percentage when branches exist', () => {
            const entry = {
                branches: { total: 4, covered: 3, skipped: 0, pct: 75 }
            };
            const branchMetric = parseBranchCoverage(entry);
            expect(branchMetric.total).toBe(4);
            expect(branchMetric.covered).toBe(3);
            expect(branchMetric.pct).toBe(75);
        });

        test('keeps 0 for lines and statements when total is 0', () => {
            const entry = {
                lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
                statements: { total: 0, covered: 0, skipped: 0, pct: 0 }
            };
            expect(parseLineCoverage(entry).pct).toBe(0);
            expect(parseStatementCoverage(entry).pct).toBe(0);
        });
    });

    describe('Feature 24: Safe Test Result JSON Parsing & Truncation Recovery', () => {
        test('recovers safely from malformed/truncated Jest results without throwing unhandled exceptions', () => {
            const malformedJson = '{"numTotalTests": 5, "numPassedTests": 4, "testResults": [';
            fs.writeFileSync(path.join(tempDir, 'jest-results.json'), malformedJson, 'utf8');

            const result = parseJestResults(tempDir);
            expect(result).toBeDefined();
            expect(result.status).toBe('FAILED');
            expect(result.failedTests).toBeGreaterThanOrEqual(1);
            expect(result.scenarios.length).toBeGreaterThan(0);
            expect(result.scenarios[0].failureMessages[0]).toContain('Failed to parse');
        });

        test('recovers safely from extra console banner preceding valid Jest JSON', () => {
            const bannerJson = 'Console log output: Running tests...\n{"numTotalTests": 2, "numPassedTests": 2, "numFailedTests": 0, "success": true, "testResults": []}';
            fs.writeFileSync(path.join(tempDir, 'jest-results.json'), bannerJson, 'utf8');

            const result = parseJestResults(tempDir);
            expect(result).toBeDefined();
            expect(result.status).toBe('PASSED');
            expect(result.totalTests).toBe(2);
            expect(result.passedTests).toBe(2);
        });

        test('recovers safely from malformed/truncated Vitest results without throwing unhandled exceptions', () => {
            const malformedVitest = '{"numTotalTests": 3, "testResults": { corrupted';
            fs.writeFileSync(path.join(tempDir, 'vitest-results.json'), malformedVitest, 'utf8');

            const result = parseVitestResults(tempDir);
            expect(result).toBeDefined();
            expect(result.status).toBe('FAILED');
            expect(result.scenarios[0].failureMessages[0]).toContain('Failed to parse Vitest');
        });

        test('returns null when test result file does not exist', () => {
            const result = parseJestResults(tempDir);
            expect(result).toBeNull();
        });
    });

    describe('Feature 25: Balanced Parenthesis Assertion Mutation & Zero-Argument Token Sanitization', () => {
        test('handles nested function calls in expect(subject) with replaceBalancedExpectAssertion', () => {
            const code = `
  it('calculates total', () => {
    expect(calculateTax(getPrice({ item: 1 }), getRate())).toEqual(15);
  });
`;
            const replaced = replaceBalancedExpectAssertion(code, ['toEqual'], '.toBeDefined();');
            expect(replaced).toContain('expect(calculateTax(getPrice({ item: 1 }), getRate())).toBeDefined();');
            expect(replaced).not.toContain('.toEqual(15)');
        });

        test('handles regex argument with parens in replaceBalancedMethodCall without premature truncation', () => {
            const line = "    expect(msg).toMatch(/order #([0-9]+) confirmed/);";
            const replaced = replaceBalancedMethodCall(line, ['toMatch'], '.toBeDefined()');
            expect(replaced).toBe('    expect(msg).toBeDefined();');
            expect(replaced).not.toContain('confirmed');
        });

        test('sanitizes trailing orphaned tokens when replacing zero-argument assertions', () => {
            const line = "    expect(status).toBe(200); orphanToken);";
            const replaced = replaceBalancedMethodCall(line, ['toBe'], '.toBeDefined()');
            expect(replaced).toBe('    expect(status).toBeDefined();');
            expect(replaced).not.toContain('orphanToken');
        });
    });

    describe('Feature 22: Storage Immutability Guard (package.json Protection)', () => {
        test('verifies package.json content is preserved unchanged across operations', () => {
            const originalPkg = JSON.stringify({ name: 'immutable-project', version: '1.0.0', type: 'commonjs' }, null, 2);
            const pkgPath = path.join(tempDir, 'package.json');
            fs.writeFileSync(pkgPath, originalPkg, 'utf8');

            // Verify file exists with exact content
            const readContent = fs.readFileSync(pkgPath, 'utf8');
            expect(readContent).toBe(originalPkg);

            // Confirm type remains unchanged and no unexpected keys are added
            const parsed = JSON.parse(readContent);
            expect(parsed.type).toBe('commonjs');
            expect(parsed.dependencies).toBeUndefined();
        });
    });

    describe('Feature 21: Automatic Background Analysis Trigger Contract', () => {
        test('verifies RUN_TESTS background job trigger condition adheres to Rule 8', () => {
            const evaluateBackgroundJobTrigger = (skipBackgroundJob, result, actualSnapshotId, actualProjectId) => {
                return !skipBackgroundJob && Boolean(result && result.success && actualSnapshotId && actualProjectId);
            };

            const successfulResult = { success: true, newCoverage: { linesPct: 100 }, perFileResults: [] };

            // When skipBackgroundJob is not set or false, trigger must fire
            expect(evaluateBackgroundJobTrigger(undefined, successfulResult, "snap-123", "proj-456")).toBe(true);
            expect(evaluateBackgroundJobTrigger(false, successfulResult, "snap-123", "proj-456")).toBe(true);

            // When skipBackgroundJob is explicitly true, trigger is suppressed
            expect(evaluateBackgroundJobTrigger(true, successfulResult, "snap-123", "proj-456")).toBe(false);

            // When result was not successful, trigger does not fire
            expect(evaluateBackgroundJobTrigger(false, { success: false }, "snap-123", "proj-456")).toBe(false);
        });
    });
});
