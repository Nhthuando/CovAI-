import { jest } from '@jest/globals';
import {
    extractBackwardPathConstraints,
    findUncoveredBranches,
    getIntegrationGuidance,
    extractConstraintsFromCoverage
} from '../services/integrationGuidance.service.js';
import {
    buildSupertestPrompt,
    includePathConstraints
} from '../services/supertestPromptBuilder.service.js';
import { detectSupertest } from '../services/supertestDetection.service.js';

describe('Priority 1: Backward Path Slicing', () => {

    describe('1. AST extractBackwardPathConstraints()', () => {
        it('identifies if/else consequent branch condition as TRUE', () => {
            const sourceCode = `
function processPayment(order) {
    if (order.amount > 100) {
        applyDiscount(order);
    } else {
        standardFee(order);
    }
}
`;
            // Line 4 is applyDiscount(order) inside consequent
            const constraints = extractBackwardPathConstraints(sourceCode, 4);
            expect(constraints).toHaveLength(1);
            expect(constraints[0]).toMatchObject({
                type: 'IF',
                condition: 'order.amount > 100',
                requiredBranch: 'TRUE',
                line: 3
            });
        });

        it('identifies if/else alternate branch condition as FALSE', () => {
            const sourceCode = `
function processPayment(order) {
    if (order.amount > 100) {
        applyDiscount(order);
    } else {
        standardFee(order);
    }
}
`;
            // Line 6 is standardFee(order) inside alternate
            const constraints = extractBackwardPathConstraints(sourceCode, 6);
            expect(constraints).toHaveLength(1);
            expect(constraints[0]).toMatchObject({
                type: 'IF',
                condition: 'order.amount > 100',
                requiredBranch: 'FALSE',
                line: 3
            });
        });

        it('identifies chained else-if branches correctly', () => {
            const sourceCode = `
function evaluateGrade(score) {
    if (score >= 90) {
        return 'A';
    } else if (score >= 80) {
        return 'B';
    } else {
        return 'C';
    }
}
`;
            // Line 6 is return 'B';
            // Must satisfy: score >= 90 is FALSE, and score >= 80 is TRUE
            const constraints = extractBackwardPathConstraints(sourceCode, 6);
            expect(constraints.length).toBeGreaterThanOrEqual(2);
            expect(constraints[0]).toMatchObject({
                type: 'IF',
                condition: 'score >= 90',
                requiredBranch: 'FALSE'
            });
            expect(constraints[1]).toMatchObject({
                type: 'IF',
                condition: 'score >= 80',
                requiredBranch: 'TRUE'
            });
        });

        it('extracts nested conditions in top-down order without duplicates', () => {
            const sourceCode = `
function checkAccess(user, resource) {
    if (user && user.isAuthenticated) {
        if (user.role === 'admin') {
            if (resource.isSensitive) {
                auditLog(user, resource);
            }
        }
    }
}
`;
            // Line 6 is auditLog(user, resource)
            const constraints = extractBackwardPathConstraints(sourceCode, 6);
            expect(constraints).toHaveLength(3);
            expect(constraints[0]).toMatchObject({
                type: 'IF',
                condition: 'user && user.isAuthenticated',
                requiredBranch: 'TRUE',
                line: 3
            });
            expect(constraints[1]).toMatchObject({
                type: 'IF',
                condition: "user.role === 'admin'",
                requiredBranch: 'TRUE',
                line: 4
            });
            expect(constraints[2]).toMatchObject({
                type: 'IF',
                condition: 'resource.isSensitive',
                requiredBranch: 'TRUE',
                line: 5
            });
        });

        it('extracts switch case conditions with discriminant and required MATCH', () => {
            const sourceCode = `
function handleAction(action) {
    switch (action.type) {
        case 'PAYMENT_SUCCESS':
            markAsPaid();
            break;
        case 'PAYMENT_FAILED':
            notifyUser();
            break;
        default:
            logUnknown();
            break;
    }
}
`;
            // Line 5 is markAsPaid()
            const constraints = extractBackwardPathConstraints(sourceCode, 5);
            expect(constraints).toHaveLength(1);
            expect(constraints[0]).toMatchObject({
                type: 'SWITCH',
                condition: "action.type === 'PAYMENT_SUCCESS'",
                requiredBranch: 'MATCH',
                line: 4
            });
        });

        it('extracts switch default case condition with required DEFAULT', () => {
            const sourceCode = `
function handleAction(action) {
    switch (action.type) {
        case 'PAYMENT_SUCCESS':
            markAsPaid();
            break;
        default:
            logUnknown();
            break;
    }
}
`;
            // Line 8 is logUnknown() inside default
            const constraints = extractBackwardPathConstraints(sourceCode, 8);
            expect(constraints).toHaveLength(1);
            expect(constraints[0]).toMatchObject({
                type: 'SWITCH',
                condition: 'action.type (default)',
                requiredBranch: 'DEFAULT',
                line: 7
            });
        });

        it('extracts try/catch/finally paths correctly', () => {
            const sourceCode = `
function executeTransaction(tx) {
    try {
        validateTransaction(tx);
        commitTransaction(tx);
    } catch (err) {
        rollbackTransaction(tx);
    } finally {
        cleanup();
    }
}
`;
            // Catch line 7 is rollbackTransaction(tx)
            const catchConstraints = extractBackwardPathConstraints(sourceCode, 7);
            expect(catchConstraints).toHaveLength(1);
            expect(catchConstraints[0]).toMatchObject({
                type: 'TRY_CATCH',
                condition: 'Exception must be thrown',
                requiredBranch: 'CATCH'
            });

            // Try line 5 is commitTransaction(tx)
            const tryConstraints = extractBackwardPathConstraints(sourceCode, 5);
            expect(tryConstraints).toHaveLength(1);
            expect(tryConstraints[0]).toMatchObject({
                type: 'TRY_CATCH',
                condition: 'No exception before statement',
                requiredBranch: 'TRY'
            });

            // Finally line 9 is cleanup() - unconditionally executed on all paths; not treated as an independently selectable conditional branch
            const finallyConstraints = extractBackwardPathConstraints(sourceCode, 9);
            expect(finallyConstraints).toHaveLength(0);
        });

        it('extracts ternary operator conditions', () => {
            const sourceCode = `
function getStatus(user) {
    const status = user.isBanned ? 'BANNED' : 'ACTIVE';
    return status;
}
`;
            const constraints = extractBackwardPathConstraints(sourceCode, 3);
            expect(constraints.length).toBeGreaterThanOrEqual(1);
            expect(constraints[0].type).toBe('TERNARY');
            expect(constraints[0].condition).toBe('user.isBanned');
        });

        it('handles invalid inputs, missing lines, and parse errors gracefully', () => {
            expect(extractBackwardPathConstraints(null, 10)).toEqual([]);
            expect(extractBackwardPathConstraints('', 10)).toEqual([]);
            expect(extractBackwardPathConstraints('function foo() {}', -1)).toEqual([]);
            expect(extractBackwardPathConstraints('function foo() {}', 0)).toEqual([]);
            expect(extractBackwardPathConstraints('function foo() {}', 999)).toEqual([]);

            // Code with unrecoverable syntax error
            const badCode = 'function invalidSyntax{{{';
            const constraints = extractBackwardPathConstraints(badCode, 1);
            expect(Array.isArray(constraints)).toBe(true);
        });
    });

    describe('2. Istanbul findUncoveredBranches()', () => {
        const mockCoverageFinal = {
            'D:/NCKH/CovAI-/server/src/controllers/payment.controller.js': {
                path: 'D:/NCKH/CovAI-/server/src/controllers/payment.controller.js',
                b: {
                    '0': [1, 0], // Branch 0: consequent hit, alternate uncovered
                    '1': [2, 3]  // Branch 1: both hit (covered)
                },
                branchMap: {
                    '0': {
                        loc: { start: { line: 15, column: 4 }, end: { line: 22, column: 5 } },
                        type: 'if',
                        locations: [
                            { start: { line: 15, column: 4 }, end: { line: 18, column: 5 } },
                            { start: { line: 19, column: 11 }, end: { line: 22, column: 5 } }
                        ],
                        line: 15
                    },
                    '1': {
                        loc: { start: { line: 30, column: 4 }, end: { line: 35, column: 5 } },
                        type: 'if',
                        locations: [
                            { start: { line: 30, column: 4 }, end: { line: 32, column: 5 } },
                            { start: { line: 33, column: 11 }, end: { line: 35, column: 5 } }
                        ],
                        line: 30
                    }
                }
            }
        };

        it('identifies exact uncovered branches with branchId, branchIndex, and locations', () => {
            const uncovered = findUncoveredBranches(
                mockCoverageFinal,
                'D:/NCKH/CovAI-/server/src/controllers/payment.controller.js'
            );

            expect(uncovered).toHaveLength(1);
            expect(uncovered[0]).toEqual({
                branchId: '0',
                branchIndex: 1,
                hitCount: 0,
                type: 'if',
                line: 15,
                location: {
                    start: { line: 19, column: 11 },
                    end: { line: 22, column: 5 }
                }
            });
        });

        it('handles Windows backslash path normalization', () => {
            const uncovered = findUncoveredBranches(
                mockCoverageFinal,
                'D:\\NCKH\\CovAI-\\server\\src\\controllers\\payment.controller.js'
            );
            expect(uncovered).toHaveLength(1);
            expect(uncovered[0].branchId).toBe('0');
        });

        it('handles relative path matching', () => {
            const uncovered = findUncoveredBranches(
                mockCoverageFinal,
                'server/src/controllers/payment.controller.js'
            );
            expect(uncovered).toHaveLength(1);
            expect(uncovered[0].branchId).toBe('0');
        });

        it('returns empty array when file coverage is missing or null', () => {
            expect(findUncoveredBranches(null, 'any.js')).toEqual([]);
            expect(findUncoveredBranches({}, 'missing.js')).toEqual([]);
            expect(findUncoveredBranches(mockCoverageFinal, 'unknown.js')).toEqual([]);
        });

        it('returns empty array when coverage entry has no branchMap or b', () => {
            const incompleteCoverage = {
                'file.js': { lines: {} }
            };
            expect(findUncoveredBranches(incompleteCoverage, 'file.js')).toEqual([]);
        });

        it('returns empty array when all branches are covered', () => {
            const allCovered = {
                'file.js': {
                    b: { '0': [1, 2] },
                    branchMap: {
                        '0': { line: 10, type: 'if', locations: [] }
                    }
                }
            };
            expect(findUncoveredBranches(allCovered, 'file.js')).toEqual([]);
        });
    });

    describe('3. extractConstraintsFromCoverage() Integration', () => {
        it('correlates uncovered Istanbul branches with AST path slicing', () => {
            const sourceCode = `
export function checkAccess(req, res) {
    if (req.user) {
        if (req.user.isAdmin) {
            return res.json({ secret: 'admin-only' });
        } else {
            return res.status(403).json({ error: 'forbidden' });
        }
    }
    return res.status(401).json({ error: 'unauthorized' });
}
`;
            // Simulated coverage: req.user.isAdmin alternate (forbidden, line 7) was never executed!
            const coverageFinal = {
                'controllers/access.controller.js': {
                    b: {
                        '0': [1, 1], // outer if was both hit
                        '1': [1, 0]  // inner if: consequent hit (1), alternate uncovered (0)
                    },
                    branchMap: {
                        '0': { line: 3, type: 'if', locations: [{ start: { line: 3, column: 4 }, end: { line: 10, column: 5 } }] },
                        '1': {
                            line: 4,
                            type: 'if',
                            locations: [
                                { start: { line: 4, column: 8 }, end: { line: 6, column: 9 } },
                                { start: { line: 7, column: 15 }, end: { line: 9, column: 9 } }
                            ]
                        }
                    }
                }
            };

            const constraints = extractConstraintsFromCoverage(
                coverageFinal,
                sourceCode,
                'controllers/access.controller.js'
            );

            expect(constraints.length).toBeGreaterThanOrEqual(1);
            // Slicing at line 7 should trace enclosing conditions:
            // req.user must be TRUE, req.user.isAdmin must be FALSE
            const userCondition = constraints.find(c => c.condition === 'req.user');
            const adminCondition = constraints.find(c => c.condition === 'req.user.isAdmin');

            expect(userCondition).toBeDefined();
            expect(userCondition.requiredBranch).toBe('TRUE');

            expect(adminCondition).toBeDefined();
            expect(adminCondition.requiredBranch).toBe('FALSE');
            expect(adminCondition.uncoveredLine).toBe(7);
            expect(adminCondition.branchId).toBe('1');
        });
    });

    describe('4. Supertest Detection Pathway Classification', () => {
        it('classifies pathway as BROWNFIELD when existing supertest files exist', async () => {
            const result = await detectSupertest(process.cwd());
            expect(result).toHaveProperty('pathway');
            expect(['BROWNFIELD', 'GREENFIELD']).toContain(result.pathway);
            if (result.supertestFiles.length > 0) {
                expect(result.pathway).toBe('BROWNFIELD');
            } else {
                expect(result.pathway).toBe('GREENFIELD');
            }
        });
    });

    describe('5. Supertest Prompt Builder with Path Constraints', () => {
        const mockPayload = {
            sourceCode: [
                {
                    path: 'src/controllers/order.controller.js',
                    content: 'export const createOrder = async (req, res) => { if (req.body.items) { ... } };'
                }
            ],
            testFiles: []
        };

        const mockConstraints = [
            {
                type: 'IF',
                condition: "req.user && req.user.role === 'admin'",
                requiredBranch: 'TRUE',
                line: 25,
                uncoveredLine: 28,
                filePath: 'src/controllers/order.controller.js'
            },
            {
                type: 'TRY_CATCH',
                condition: 'Exception must be thrown',
                requiredBranch: 'CATCH',
                line: 40,
                uncoveredLine: 42,
                filePath: 'src/controllers/order.controller.js'
            }
        ];

        it('includePathConstraints() formats conditions clearly for AI prompt', () => {
            const promptSegment = includePathConstraints(mockConstraints);
            expect(promptSegment).toContain('Backward Path Slicing & Uncovered Branch Constraints');
            expect(promptSegment).toContain("req.user && req.user.role === 'admin'");
            expect(promptSegment).toContain('TRUE');
            expect(promptSegment).toContain('CATCH');
            expect(promptSegment).toContain('Line 25');
            expect(promptSegment).toContain('Uncovered target line 28');
        });

        it('includePathConstraints() returns empty string when constraints are empty', () => {
            expect(includePathConstraints([])).toBe('');
            expect(includePathConstraints(null)).toBe('');
        });

        it('includePathConstraints() handles unresolved conditions cleanly', () => {
            const unresolvedConstraint = [{
                type: 'BRANCH',
                condition: 'unresolved',
                status: 'UNRESOLVED',
                line: 55,
                uncoveredLine: 55,
                filePath: 'src/services/unknown.js'
            }];
            const segment = includePathConstraints(unresolvedConstraint);
            expect(segment).toContain('Unresolved expression');
            expect(segment).toContain('Line 55');
        });

        it('buildSupertestPrompt() embeds path constraints section when provided', () => {
            const prompt = buildSupertestPrompt(mockPayload, null, mockConstraints);
            expect(prompt).toContain('Backward Path Slicing & Uncovered Branch Constraints');
            expect(prompt).toContain("req.user && req.user.role === 'admin'");
        });

        it('buildSupertestPrompt() embeds path constraints from payload.pathConstraints', () => {
            const payloadWithConstraints = {
                ...mockPayload,
                pathConstraints: mockConstraints
            };
            const prompt = buildSupertestPrompt(payloadWithConstraints);
            expect(prompt).toContain('Backward Path Slicing & Uncovered Branch Constraints');
        });

        it('buildSupertestPrompt() omits path constraints section when none are provided', () => {
            const prompt = buildSupertestPrompt(mockPayload);
            expect(prompt).not.toContain('Backward Path Slicing & Uncovered Branch Constraints');
        });
    });

    describe('6. getIntegrationGuidance() with Real Path Constraints', () => {
        it('populates pathConstraints on RULE_COVERAGE_ZERO when provided in options', async () => {
            const sourceCode = `
function handler(req, res) {
    if (req.headers.authorization) {
        return res.status(200).send('OK');
    }
    return res.status(401).send('No Auth');
}
`;
            const coverageFinal = {
                'src/controllers/auth.controller.js': {
                    b: { '0': [0, 1] }, // Consequent (line 3) is uncovered (0)
                    branchMap: {
                        '0': {
                            line: 2,
                            type: 'if',
                            locations: [
                                { start: { line: 3, column: 8 }, end: { line: 3, column: 42 } },
                                { start: { line: 5, column: 4 }, end: { line: 5, column: 43 } }
                            ]
                        }
                    }
                }
            };

            const mockZeroAnalytics = {
                snapshotId: 'snap-zero',
                overview: { snapshotId: 'snap-zero', totalScenarios: 2 },
                latestExecution: { id: 'run-0', totalTests: 2, passedTests: 2, failedTests: 0, skippedTests: 0 },
                history: {
                    executions: [{ id: 'run-0', status: 'SUCCESS' }],
                    coverage: [{ snapshotId: 'snap-zero', stmtsPct: 0 }]
                }
            };

            const guidance = await getIntegrationGuidance('test-proj', {
                analytics: mockZeroAnalytics,
                coverageFinal,
                sourceCode,
                filePath: 'src/controllers/auth.controller.js'
            });

            expect(guidance.success).toBe(true);
            const covZeroRule = guidance.data.rules.find(r => r.id === 'RULE_COVERAGE_ZERO');
            expect(covZeroRule).toBeDefined();
            expect(Array.isArray(covZeroRule.pathConstraints)).toBe(true);
            expect(covZeroRule.pathConstraints.length).toBeGreaterThan(0);
            expect(covZeroRule.pathConstraints[0]).toMatchObject({
                type: 'IF',
                condition: 'req.headers.authorization',
                requiredBranch: 'TRUE'
            });
        });
    });

    describe('7. End-to-End Acceptance: Coverage Artifact -> Guidance API -> Prompt Builder Pipeline', () => {
        const fixtureControllerCode = `export async function checkout(req, res) {
    if (!req.body.items || req.body.items.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
    }
    if (req.user && req.user.isVip) {
        return res.status(200).json({ status: 'VIP_DISCOUNT_APPLIED' });
    } else {
        return res.status(200).json({ status: 'STANDARD_CHECKOUT' });
    }
}`;

        // Deterministic Istanbul artifact:
        // Branch 0: (!req.body.items || req.body.items.length === 0) -> Both taken (1, 1)
        // Branch 1: (req.user && req.user.isVip) -> Consequent hit (1), but Alternate/Standard customer was UNCOVERED (0)!
        const fixtureCoverageFinal = {
            'src/controllers/checkout.controller.js': {
                path: 'src/controllers/checkout.controller.js',
                b: {
                    '0': [1, 2],
                    '1': [1, 0] // Alternate branch (line 8, standard checkout) was never hit!
                },
                branchMap: {
                    '0': {
                        line: 2,
                        type: 'if',
                        locations: [
                            { start: { line: 3, column: 8 }, end: { line: 3, column: 63 } },
                            { start: { line: 5, column: 4 }, end: { line: 9, column: 5 } }
                        ]
                    },
                    '1': {
                        line: 5,
                        type: 'if',
                        locations: [
                            { start: { line: 6, column: 8 }, end: { line: 6, column: 73 } },
                            { start: { line: 8, column: 8 }, end: { line: 8, column: 69 } }
                        ]
                    }
                }
            }
        };

        const mockGapsAnalytics = {
            snapshotId: 'snap-gaps',
            overview: { snapshotId: 'snap-gaps', totalScenarios: 2 },
            latestExecution: { id: 'run-gaps', totalTests: 2, passedTests: 2, failedTests: 0, skippedTests: 0 },
            history: {
                executions: [{ id: 'run-gaps', status: 'SUCCESS' }],
                coverage: [{ snapshotId: 'snap-gaps', stmtsPct: 75 }]
            }
        };

        it('demonstrates end-to-end data flow from Istanbul coverage artifact to Guidance API to prompt', async () => {
            // Step 1: Guidance API identifies uncovered branch and extracts constraints
            const guidance = await getIntegrationGuidance('proj-e2e', {
                analytics: mockGapsAnalytics,
                coverageFinal: fixtureCoverageFinal,
                sourceCode: fixtureControllerCode,
                filePath: 'src/controllers/checkout.controller.js'
            });

            expect(guidance.success).toBe(true);
            const branchGapsRule = guidance.data.rules.find(r => r.id === 'RULE_BRANCH_COVERAGE_GAPS' || r.id === 'RULE_COVERAGE_ZERO');
            expect(branchGapsRule).toBeDefined();
            expect(Array.isArray(branchGapsRule.pathConstraints)).toBe(true);
            expect(branchGapsRule.pathConstraints.length).toBeGreaterThan(0);

            const uncoveredConstraint = branchGapsRule.pathConstraints.find(
                c => c.condition === 'req.user && req.user.isVip'
            );
            expect(uncoveredConstraint).toBeDefined();
            expect(uncoveredConstraint.requiredBranch).toBe('FALSE');
            expect(uncoveredConstraint.uncoveredLine).toBe(8);
            expect(uncoveredConstraint.filePath).toBe('src/controllers/checkout.controller.js');

            // Step 2: Feed verified constraints directly into the production prompt builder
            const generationPayload = {
                sourceCode: [
                    {
                        path: 'src/controllers/checkout.controller.js',
                        content: fixtureControllerCode
                    }
                ],
                testFiles: [],
                pathConstraints: branchGapsRule.pathConstraints
            };

            const targetEndpoints = [
                {
                    method: 'POST',
                    fullPath: '/api/checkout',
                    path: '/api/checkout',
                    controllerFile: 'src/controllers/checkout.controller.js',
                    missingCoverageRequested: ['Error Edge Case (400/404/500)']
                }
            ];

            const generatedPrompt = buildSupertestPrompt(generationPayload, targetEndpoints, branchGapsRule.pathConstraints);

            // Step 3: Verify the prompt contains the source-grounded backward path constraint instructions
            expect(generatedPrompt).toContain('Backward Path Slicing & Uncovered Branch Constraints');
            expect(generatedPrompt).toContain('src/controllers/checkout.controller.js');
            expect(generatedPrompt).toContain('req.user && req.user.isVip');
            expect(generatedPrompt).toContain('FALSE');
            expect(generatedPrompt).toContain('Uncovered target line 8');
            expect(generatedPrompt).toContain('MUST target these specific branch conditions');
        });
    });

    describe('8. AST Audit: Complex Branch-to-Location Mappings & Unresolved Safety', () => {
        it('correctly handles if statement without else (implicit else) with branchIndex 1', () => {
            const code = `function checkRole(user) {
    if (user.isAdmin) {
        grantAdminAccess();
    }
    return false;
}`;
            // BranchIndex 1 corresponds to user.isAdmin being FALSE (implicit else)
            const constraints = extractBackwardPathConstraints(code, 2, { branchIndex: 1 });
            expect(constraints.length).toBeGreaterThanOrEqual(1);
            expect(constraints[0]).toMatchObject({
                type: 'IF',
                condition: 'user.isAdmin',
                requiredBranch: 'FALSE',
                line: 2
            });
        });

        it('correctly handles switch default branch with discriminant', () => {
            const code = `function dispatch(event) {
    switch (event.name) {
        case 'INIT':
            init();
            break;
        default:
            fallback();
            break;
    }
}`;
            // Line 7 is fallback()
            const constraints = extractBackwardPathConstraints(code, 7);
            expect(constraints).toHaveLength(1);
            expect(constraints[0]).toMatchObject({
                type: 'SWITCH',
                condition: 'event.name (default)',
                requiredBranch: 'DEFAULT',
                line: 6
            });
        });

        it('marks unresolved conditions explicitly as UNRESOLVED without guessing', () => {
            // A node whose test cannot be formatted or has broken syntax
            const brokenLoc = [{
                type: 'BRANCH',
                condition: 'unresolved',
                status: 'UNRESOLVED',
                line: 12,
                uncoveredLine: 12,
                filePath: 'src/unknown.js'
            }];

            const rendered = includePathConstraints(brokenLoc);
            expect(rendered).toContain('Unresolved expression');
            expect(rendered).toContain('Line 12');
            expect(rendered).not.toContain('undefined');
        });
    });
});
