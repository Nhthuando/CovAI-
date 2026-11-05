import { describe, test, expect } from '@jest/globals';
import { classifyFeasibleCoverage } from '../services/feasibleCoverageClassifier.service.js';

describe('Feasible Coverage Classifier Service', () => {
    test('returns safe fallback object when coverage data is null, undefined, or empty', () => {
        const nullRes = classifyFeasibleCoverage(null, []);
        expect(nullRes.isFeasibleLogicCovered).toBe(false);
        expect(nullRes.actionableGaps).toEqual({ lines: 0, branches: 0, functions: 0, statements: 0 });
        expect(nullRes.rawCoverage.lines).toBe(0);

        const emptyRes = classifyFeasibleCoverage({}, []);
        expect(emptyRes.isFeasibleLogicCovered).toBe(false);
        expect(emptyRes.actionableLines).toEqual([]);
        expect(emptyRes.actionableBranches).toEqual([]);
    });

    test('marks isFeasibleLogicCovered: true when all uncovered branches are within verified infeasible blocks', () => {
        const coverageData = {
            metrics: {
                lines: { pct: 88 },
                branches: { pct: 87.5 },
                functions: { pct: 100 },
                statements: { pct: 90 },
            },
            uncoveredLines: [42],
            uncoveredBranches: [
                { line: 42, branchIndex: 0, missedTrue: true, type: 'True' }
            ],
            uncoveredFunctions: [],
            failedLines: [],
        };

        const infeasibleBlocks = [
            {
                line: 42,
                type: 'ENVIRONMENT_GUARD',
                category: 'ENV_GUARD',
                affectsBranch: 'TRUE_BRANCH',
                justification: 'Guarded by process.env.NODE_ENV === "production"',
            }
        ];

        const result = classifyFeasibleCoverage(coverageData, infeasibleBlocks);
        expect(result.isFeasibleLogicCovered).toBe(true);
        expect(result.actionableLines).toEqual([]);
        expect(result.actionableBranches).toEqual([]);
        expect(result.infeasibleBranches.length).toBe(1);
        expect(result.feasibleCoverage.branchesPct).toBe(100);
        // Raw Istanbul metrics strictly preserved
        expect(result.rawCoverage.branchesPct).toBe(87.5);
    });

    test('marks isFeasibleLogicCovered: false when actionable uncovered branches remain outside infeasible blocks', () => {
        const coverageData = {
            metrics: {
                lines: { pct: 70 },
                branches: { pct: 50 },
                functions: { pct: 100 },
                statements: { pct: 70 },
            },
            uncoveredLines: [15, 42],
            uncoveredBranches: [
                { line: 15, branchIndex: 1, missedFalse: true, type: 'False' },
                { line: 42, branchIndex: 0, missedTrue: true, type: 'True' }
            ],
            uncoveredFunctions: [],
            failedLines: [],
        };

        const infeasibleBlocks = [
            {
                line: 42,
                type: 'ENVIRONMENT_GUARD',
                affectsBranch: 'TRUE_BRANCH',
                justification: 'Guarded',
            }
        ];

        const result = classifyFeasibleCoverage(coverageData, infeasibleBlocks);
        expect(result.isFeasibleLogicCovered).toBe(false);
        expect(result.actionableLines).toEqual([15]);
        expect(result.actionableBranches.length).toBe(1);
        expect(result.actionableBranches[0].line).toBe(15);
        expect(result.feasibleCoverage.branchesPct).toBe(50);
        expect(result.rawCoverage.branchesPct).toBe(50);
    });

    test('distinguishes affectsBranch FALSE_BRANCH vs TRUE_BRANCH correctly', () => {
        const coverageData = {
            metrics: { lines: { pct: 90 }, branches: { pct: 50 } },
            uncoveredLines: [],
            uncoveredBranches: [
                { line: 20, branchIndex: 1, missedFalse: true, type: 'False' }
            ],
            uncoveredFunctions: [],
            failedLines: [],
        };

        const falseBranchGuard = [
            {
                line: 20,
                type: 'DEAD_CODE',
                affectsBranch: 'FALSE_BRANCH',
                justification: 'Constant false condition',
            }
        ];

        const result = classifyFeasibleCoverage(coverageData, falseBranchGuard);
        expect(result.isFeasibleLogicCovered).toBe(true);
        expect(result.actionableBranches).toEqual([]);
    });

    test('marks isFeasibleLogicCovered: false if failedLines are present', () => {
        const coverageData = {
            metrics: { lines: { pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, statements: { pct: 100 } },
            uncoveredLines: [],
            uncoveredBranches: [],
            uncoveredFunctions: [],
            failedLines: [10],
        };

        const result = classifyFeasibleCoverage(coverageData, []);
        expect(result.isFeasibleLogicCovered).toBe(false);
    });

    test('handles zero branches total (100% linear execution)', () => {
        const coverageData = {
            metrics: { lines: { pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, statements: { pct: 100 } },
            uncoveredLines: [],
            uncoveredBranches: [],
            uncoveredFunctions: [],
            failedLines: [],
        };

        const result = classifyFeasibleCoverage(coverageData, []);
        expect(result.isFeasibleLogicCovered).toBe(true);
        expect(result.actionableGaps.branches).toBe(0);
        expect(result.feasibleCoverage.branchesPct).toBe(100);
        expect(result.rawCoverage.branchesPct).toBe(100);
    });
});
