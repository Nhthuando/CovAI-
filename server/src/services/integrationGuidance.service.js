import fs from 'fs';
import path from 'path';
import prisma from '../config/prisma.js';
import { getIntegrationAnalytics } from './integrationReport.service.js';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

const traverseAst = _traverse.default || _traverse;
const generateCode = _generate.default || _generate;

export const getIntegrationGuidance = async (projectId, options = {}) => {
    const analytics = options.analytics || await getIntegrationAnalytics(projectId);
    const rules = [];

    // Precedence 1: RULE_NO_DATA
    if (!analytics.overview || (!analytics.overview.totalScenarios && analytics.history.executions.length === 0 && analytics.history.coverage.length === 0)) {
        rules.push({
            id: 'RULE_NO_DATA',
            severity: 'INFO',
            finding: 'No Integration Test Data',
            meaning: 'The Integration Testing pipeline has not been initialized for this project.',
            evidence: {
                source: 'Integration Database',
                snapshotId: analytics.snapshotId || null,
                details: '0 AiTest, 0 TestRun, and 0 CoverageSummary records found.'
            },
            calculation: 'Count of records == 0',
            scope: 'Integration Test Suite',
            impact: 'API health and test coverage cannot be tracked.',
            recommendedAction: 'Run Generate Tests to establish the initial test suite.',
            actionType: 'OPEN_GENERATE_MODAL',
            verification: 'After generation, check that scenarios exist in the summary.'
        });
        return { success: true, data: { rules } };
    }

    // Precedence 2: RULE_NO_EXECUTION
    if (analytics.overview && analytics.overview.totalScenarios > 0 && !analytics.latestExecution) {
        rules.push({
            id: 'RULE_NO_EXECUTION',
            severity: 'WARNING',
            finding: 'No Execution Data',
            meaning: 'Scenarios exist but have not been executed.',
            evidence: {
                source: 'Execution Runner',
                snapshotId: analytics.snapshotId || null,
                details: `${analytics.overview.totalScenarios} AiTest scenarios exist; 0 TestRun records found.`
            },
            calculation: 'Total Scenarios > 0 AND TestRuns == 0',
            scope: 'Test Runner',
            impact: 'Scenarios are not validated against the active codebase.',
            recommendedAction: 'Execute Tests in the Integration Workbench.',
            actionType: 'EXECUTE_TESTS',
            verification: 'After execution, an Execution Summary should appear.'
        });
        return { success: true, data: { rules } };
    }

    const latestRun = analytics.latestExecution;
    
    // Evaluate semanticState from Phase 6B
    let semanticState = "NOT_EXECUTED";
    if (latestRun) {
       if (latestRun.totalTests === 0) semanticState = "FAILED_BEFORE_TEST_EXECUTION";
       else if (latestRun.failedTests > 0) semanticState = "TESTS_FAILED";
       else if (latestRun.passedTests === 0 && latestRun.skippedTests > 0) semanticState = "SKIPPED";
       else semanticState = "SUCCESS";
    }

    // 3.1 RULE_INFRASTRUCTURE_FAILURE
    if (semanticState === "FAILED_BEFORE_TEST_EXECUTION") {
        rules.push({
            id: 'RULE_INFRASTRUCTURE_FAILURE',
            severity: 'ERROR',
            finding: 'Infrastructure Failure',
            meaning: 'The test runner crashed or failed to execute any tests.',
            evidence: {
                source: 'Pipeline Job',
                snapshotId: analytics.snapshotId || null,
                jobId: latestRun?.jobId || null,
                details: '0 tests were executed.'
            },
            calculation: 'Total Tests Executed == 0',
            scope: 'Docker / Test Runner',
            impact: 'Test execution is completely blocked.',
            recommendedAction: 'Inspect the Job logs and retry the execution.',
            actionType: 'VIEW_HISTORY',
            verification: 'After retry, check if tests successfully run.'
        });
    }

    // 3.2 RULE_SOME_FAILED
    if (semanticState === "TESTS_FAILED") {
        rules.push({
            id: 'RULE_SOME_FAILED',
            severity: 'ERROR',
            finding: 'Failed Scenarios',
            meaning: 'One or more integration scenarios did not pass validation.',
            evidence: {
                source: 'TestRun Report',
                snapshotId: analytics.snapshotId || null,
                testRunId: latestRun.id,
                details: `${latestRun.failedTests} failed tests out of ${latestRun.totalTests}.`
            },
            calculation: `${latestRun.failedTests} / ${latestRun.totalTests}`,
            scope: 'Integration Scenarios',
            impact: 'The tested APIs are failing their behavioral assertions.',
            recommendedAction: 'Open Scenario Review to inspect and fix failed tests.',
            actionType: 'REVIEW_SCENARIOS',
            verification: 'After fix and re-execution, Failed count should be 0.'
        });
    }

    // 3.3 RULE_ENDPOINTS_UNCOVERED
    if (analytics.apiCoverage && analytics.apiCoverage.uncoveredApis > 0) {
        const { uncoveredApis, discoveredApis, testedApis } = analytics.apiCoverage;
        rules.push({
            id: 'RULE_ENDPOINTS_UNCOVERED',
            severity: 'WARNING',
            finding: `${uncoveredApis} uncovered endpoints`,
            meaning: `${uncoveredApis} of ${discoveredApis} discovered endpoints currently have no mapped Integration scenario.`,
            evidence: {
                source: 'Endpoint Analysis',
                snapshotId: analytics.snapshotId || null,
                details: 'Static mapping state'
            },
            calculation: `${uncoveredApis} / ${discoveredApis}`,
            scope: 'API Endpoints',
            impact: 'These endpoints currently have no Integration scenario.',
            recommendedAction: 'Generate scenarios for uncovered endpoints.',
            actionType: 'OPEN_GENERATE_MODAL',
            verification: `After generation/re-analysis, check if uncovered endpoints decrease from ${uncoveredApis}.`
        });
    }

    // 3.4 RULE_COVERAGE_MISSING, VALID 0%, or UNCOVERED BRANCH CONSTRAINTS
    if (semanticState === "SUCCESS" || semanticState === "TESTS_FAILED") {
        const coverageHistory = analytics.history?.coverage || [];
        const currentCoverage = coverageHistory[coverageHistory.length - 1];
        if (!currentCoverage) {
            rules.push({
                id: 'RULE_COVERAGE_MISSING',
                severity: 'WARNING',
                finding: 'Coverage Not Collected',
                meaning: 'The test execution completed, but Istanbul/V8 coverage parsing failed.',
                evidence: {
                    source: 'Coverage Parser',
                    snapshotId: analytics.snapshotId || null,
                    testRunId: latestRun?.id || null
                },
                calculation: 'CoverageSummary == null',
                scope: 'Project Code Coverage',
                impact: 'Code execution visibility is lost.',
                recommendedAction: 'Check parser logs in History.',
                actionType: 'VIEW_HISTORY',
                verification: 'After retry, code coverage metrics should be populated.'
            });
        } else if (currentCoverage.stmtsPct === 0) {
            const diagnostics = options.diagnostics || [];
            const pathConstraints = await resolvePathConstraintsForProject(analytics, { ...options, diagnostics });
            const realIssues = diagnostics.filter(d => d.type !== 'FIRST_RUN_NO_COVERAGE');
            rules.push({
                id: 'RULE_COVERAGE_ZERO',
                severity: 'WARNING',
                finding: 'Valid 0% Coverage',
                meaning: 'Coverage was successfully collected, but no project statements were executed by integration tests.',
                evidence: {
                    source: 'Coverage Parser',
                    snapshotId: analytics.snapshotId || null,
                    testRunId: latestRun?.id || null,
                    details: 'Statements: 0%',
                    ...(realIssues.length > 0 ? { diagnostics: realIssues } : {})
                },
                pathConstraints, // V2: Backward Path Slicing constraints
                calculation: 'Executed Statements == 0',
                scope: 'Project Code Coverage',
                impact: 'The tests may be mocking out the entire application or not hitting local logic.',
                recommendedAction: pathConstraints.length > 0
                    ? `Target ${pathConstraints.length} identified branch condition(s) to reach uncovered logic.`
                    : 'Review the generated scenarios to ensure they make real HTTP calls.',
                actionType: 'REVIEW_SCENARIOS',
                verification: 'After editing tests, execute them and expect >0% coverage.'
            });
        } else {
            // stmtsPct > 0: Check if there are uncovered branches that can be sliced
            const diagnostics = options.diagnostics || [];
            const pathConstraints = await resolvePathConstraintsForProject(analytics, { ...options, diagnostics });
            const realIssues = diagnostics.filter(d => d.type !== 'FIRST_RUN_NO_COVERAGE');
            if (pathConstraints.length > 0 || realIssues.length > 0) {
                rules.push({
                    id: 'RULE_BRANCH_COVERAGE_GAPS',
                    severity: 'WARNING',
                    finding: pathConstraints.length > 0
                        ? `${pathConstraints.length} Uncovered Branch Constraint(s)`
                        : 'Branch Path Analysis Diagnostics',
                    meaning: pathConstraints.length > 0
                        ? 'Certain code branches remain unreached because specific execution conditions were not satisfied by tests.'
                        : 'Branch path analysis encountered file or coverage resolution issues.',
                    evidence: {
                        source: 'Istanbul Coverage & AST Slicer',
                        snapshotId: analytics.snapshotId || null,
                        testRunId: latestRun?.id || null,
                        details: `${pathConstraints.length} uncovered branch path constraint(s) identified.`,
                        ...(realIssues.length > 0 ? { diagnostics: realIssues } : {})
                    },
                    pathConstraints,
                    calculation: `Uncovered branch paths == ${pathConstraints.length}`,
                    scope: 'Branch Coverage',
                    impact: 'Uncovered decision branches may hide unhandled exceptions or logic bugs.',
                    recommendedAction: pathConstraints.length > 0
                        ? `Create targeted test scenarios that satisfy the ${pathConstraints.length} branch condition(s).`
                        : 'Review diagnostics and ensure source files and coverage artifacts are synchronized.',
                    actionType: 'REVIEW_SCENARIOS',
                    verification: 'After adding branch-targeted tests, branch coverage should increase.'
                });
            }
        }
    }

    // 3.5 RULE_SKIPPED_SCENARIOS
    if (semanticState === "SKIPPED" || (latestRun && latestRun.skippedTests > 0)) {
        rules.push({
            id: 'RULE_SKIPPED_SCENARIOS',
            severity: 'WARNING',
            finding: 'Skipped Scenarios',
            meaning: 'Scenarios were disabled and bypassed during the test run.',
            evidence: {
                source: 'TestRun Report',
                snapshotId: analytics.snapshotId || null,
                testRunId: latestRun.id,
                details: `${latestRun.skippedTests} skipped tests.`
            },
            calculation: `Skipped Tests == ${latestRun.skippedTests}`,
            scope: 'Integration Scenarios',
            impact: 'Skipped scenarios provide no validation.',
            recommendedAction: 'Open Scenario Review filtered to skipped tests to re-enable them.',
            actionType: 'REVIEW_SCENARIOS',
            verification: 'After re-enabling and executing, skipped count should be 0.'
        });
    }

    // Sort by severity (ERROR -> WARNING -> SUCCESS -> INFO), 
    // maintaining deterministic order for rules with the same severity using stable sort behavior
    const severityOrder = { ERROR: 1, WARNING: 2, SUCCESS: 3, INFO: 4 };
    
    // Add original index to preserve deterministic order on ties
    const mappedRules = rules.map((r, i) => ({ ...r, originalIndex: i }));
    mappedRules.sort((a, b) => {
        const sDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (sDiff !== 0) return sDiff;
        return a.originalIndex - b.originalIndex;
    });

    const finalRules = mappedRules.map(r => {
        const { originalIndex, ...rest } = r;
        return rest;
    });

    return { success: true, data: { rules: finalRules } };
};

// ============================================================
// V2 UPGRADE: Backward Path Slicing
// Extracts branching conditions (if/else, switch, try/catch, ternary)
// that gate uncovered code lines, enabling targeted test generation.
// ============================================================

/**
 * Determines if a given target line falls within an AST node's source location.
 * @param {number} targetLine
 * @param {object} loc - Babel SourceLocation { start: { line, column }, end: { line, column } }
 * @returns {boolean}
 */
function isLineInLoc(targetLine, loc) {
    if (!loc || typeof targetLine !== 'number') return false;
    return loc.start.line <= targetLine && loc.end.line >= targetLine;
}

/**
 * Extracts backward path constraints for a target uncovered line.
 * Walks up the AST from the target line, collecting all branching
 * conditions (if/else, switch/case, try/catch, ternary) that gate execution of that line.
 *
 * @param {string} sourceCode - Controller or service source code
 * @param {number} targetLine - 1-based line number that is not covered
 * @returns {Array<{type: string, condition: string, requiredBranch: string, line: number, status?: string}>}
 */
export function extractBackwardPathConstraints(sourceCode, targetLine, options = {}) {
    if (!sourceCode || typeof targetLine !== 'number' || targetLine <= 0) {
        return [];
    }

    let ast;
    try {
        ast = parse(sourceCode, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript'],
            ranges: true,
            errorRecovery: true
        });
    } catch (e) {
        console.warn('[BackwardPathSlicing] Failed to parse source code:', e.message);
        return [];
    }

    // Find innermost node covering targetLine
    let targetPath = null;
    let smallestSpan = Infinity;

    traverseAst(ast, {
        enter(path) {
            const loc = path.node.loc;
            if (!loc) return;
            if (isLineInLoc(targetLine, loc)) {
                const lineSpan = loc.end.line - loc.start.line;
                const colSpan = (loc.end.column ?? 0) - (loc.start.column ?? 0);
                const span = lineSpan * 1000 + colSpan;
                if (span <= smallestSpan) {
                    smallestSpan = span;
                    targetPath = path;
                }
            }
        }
    });

    if (!targetPath) {
        return [];
    }

    const rawConstraints = [];
    let current = targetPath;
    let prev = null;

    while (current) {
        const node = current.node;
        if (!node || !node.loc) {
            prev = current;
            current = current.parentPath;
            continue;
        }

        // 1. IfStatement
        if (current.isIfStatement()) {
            let requiredBranch = 'TRUE';
            const inConsequent = node.consequent && (prev?.node === node.consequent || isLineInLoc(targetLine, node.consequent.loc));
            const inAlternate = node.alternate && (prev?.node === node.alternate || isLineInLoc(targetLine, node.alternate.loc));

            if (options.branchIndex !== undefined && node.loc.start.line === targetLine) {
                requiredBranch = options.branchIndex === 0 ? 'TRUE' : 'FALSE';
            } else if (inConsequent && inAlternate) {
                requiredBranch = prev?.node === node.consequent ? 'TRUE' : 'FALSE';
            } else if (inConsequent) {
                if (options.branchIndex === 1 && node.loc.start.line === targetLine && !node.alternate) {
                    requiredBranch = 'FALSE';
                } else {
                    requiredBranch = 'TRUE';
                }
            } else if (inAlternate) {
                requiredBranch = 'FALSE';
            } else if (options.branchIndex !== undefined && node.loc.start.line === targetLine) {
                requiredBranch = options.branchIndex === 0 ? 'TRUE' : 'FALSE';
            } else {
                prev = current;
                current = current.parentPath;
                continue;
            }

            let condCode = 'unresolved';
            let isUnresolved = false;
            try {
                const gen = generateCode(node.test);
                if (gen && gen.code) {
                    condCode = gen.code.trim();
                } else {
                    isUnresolved = true;
                }
            } catch (_) {
                isUnresolved = true;
            }

            rawConstraints.push({
                type: 'IF',
                condition: condCode,
                requiredBranch,
                line: node.loc.start.line,
                ...(isUnresolved ? { status: 'UNRESOLVED' } : {})
            });
        }

        // 2. ConditionalExpression (ternary: test ? consequent : alternate)
        else if (current.isConditionalExpression()) {
            let requiredBranch = 'TRUE';
            const inConsequent = node.consequent && (prev?.node === node.consequent || isLineInLoc(targetLine, node.consequent.loc));
            const inAlternate = node.alternate && (prev?.node === node.alternate || isLineInLoc(targetLine, node.alternate.loc));

            if (options.branchIndex !== undefined && node.loc.start.line === targetLine) {
                requiredBranch = options.branchIndex === 0 ? 'TRUE' : 'FALSE';
            } else if (inConsequent) {
                requiredBranch = 'TRUE';
            } else if (inAlternate) {
                requiredBranch = 'FALSE';
            } else {
                prev = current;
                current = current.parentPath;
                continue;
            }

            let condCode = 'unresolved';
            let isUnresolved = false;
            try {
                const gen = generateCode(node.test);
                if (gen && gen.code) condCode = gen.code.trim();
                else isUnresolved = true;
            } catch (_) {
                isUnresolved = true;
            }

            rawConstraints.push({
                type: 'TERNARY',
                condition: condCode,
                requiredBranch,
                line: node.loc.start.line,
                ...(isUnresolved ? { status: 'UNRESOLVED' } : {})
            });
        }

        // 3. SwitchCase
        else if (current.isSwitchCase()) {
            const parentSwitch = current.parentPath?.isSwitchStatement() ? current.parentPath.node : null;
            let discriminantStr = '';
            if (parentSwitch?.discriminant) {
                try {
                    const dGen = generateCode(parentSwitch.discriminant);
                    if (dGen?.code) discriminantStr = dGen.code.trim();
                } catch (_) {}
            }

            if (node.test) {
                let caseVal = 'unresolved';
                try {
                    const cGen = generateCode(node.test);
                    if (cGen?.code) caseVal = cGen.code.trim();
                } catch (_) {}

                const condition = discriminantStr ? `${discriminantStr} === ${caseVal}` : caseVal;
                rawConstraints.push({
                    type: 'SWITCH',
                    condition,
                    requiredBranch: 'MATCH',
                    line: node.loc.start.line
                });
            } else {
                const condition = discriminantStr ? `${discriminantStr} (default)` : 'default';
                rawConstraints.push({
                    type: 'SWITCH',
                    condition,
                    requiredBranch: 'DEFAULT',
                    line: node.loc.start.line
                });
            }
        }

        // 4. TryStatement
        else if (current.isTryStatement()) {
            const inCatch = node.handler && (prev?.node === node.handler || isLineInLoc(targetLine, node.handler.loc));
            const inTry = node.block && (prev?.node === node.block || isLineInLoc(targetLine, node.block.loc));
            const inFinally = node.finalizer && (prev?.node === node.finalizer || isLineInLoc(targetLine, node.finalizer.loc));

            if (inCatch) {
                rawConstraints.push({
                    type: 'TRY_CATCH',
                    condition: 'Exception must be thrown',
                    requiredBranch: 'CATCH',
                    line: node.handler.loc?.start?.line || node.loc.start.line
                });
            } else if (inTry) {
                rawConstraints.push({
                    type: 'TRY_CATCH',
                    condition: 'No exception before statement',
                    requiredBranch: 'TRY',
                    line: node.loc.start.line
                });
            }
            // Note: finally blocks are unconditionally executed on all paths.
            // A finally block is never treated as an independently selectable conditional branch.
        }

        prev = current;
        current = current.parentPath;
    }

    // Constraints are gathered bottom-up (innermost to outermost).
    // Reverse to present outermost first -> innermost last.
    const reversed = rawConstraints.reverse();

    // Deduplicate
    const seen = new Set();
    return reversed.filter(c => {
        const key = `${c.type}-${c.line}-${c.condition}-${c.requiredBranch}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Finds uncovered branches from Istanbul coverage-final.json for a specific file.
 * Each entry in coverage-final.json has a branchMap (metadata) and b (hit counts).
 *
 * @param {object} coverageFinal - Parsed coverage-final.json object
 * @param {string} filePath - Absolute or relative path of the source file to inspect
 * @returns {Array<{branchId: string, branchIndex: number, hitCount: number, location: object|null, type: string, line: number|null}>}
 */
export function findUncoveredBranches(coverageFinal, filePath) {
    if (!coverageFinal || typeof coverageFinal !== 'object' || !filePath) return [];

    let fileCoverage = coverageFinal[filePath];

    if (!fileCoverage) {
        const normTarget = filePath.replace(/\\/g, '/').toLowerCase();
        for (const [key, val] of Object.entries(coverageFinal)) {
            const normKey = key.replace(/\\/g, '/').toLowerCase();
            if (normKey === normTarget || normKey.endsWith('/' + normTarget) || normTarget.endsWith('/' + normKey)) {
                fileCoverage = val;
                break;
            }
        }
    }

    if (!fileCoverage || !fileCoverage.b || !fileCoverage.branchMap) return [];

    const uncovered = [];
    for (const [branchId, hits] of Object.entries(fileCoverage.b)) {
        if (!Array.isArray(hits)) continue;
        const branchMeta = fileCoverage.branchMap[branchId];
        hits.forEach((hitCount, branchIndex) => {
            if (hitCount === 0) {
                const loc = branchMeta?.locations?.[branchIndex] || branchMeta?.loc || null;
                uncovered.push({
                    branchId: String(branchId),
                    branchIndex,
                    hitCount: 0,
                    location: loc ? {
                        start: { line: loc.start?.line, column: loc.start?.column },
                        end: { line: loc.end?.line, column: loc.end?.column }
                    } : null,
                    type: branchMeta?.type || 'unknown',
                    line: branchMeta?.line || loc?.start?.line || null
                });
            }
        });
    }

    return uncovered;
}

/**
 * Resolves verified backward path constraints for uncovered branches in the project.
 * Uses real Istanbul coverage-final.json and source code files from the snapshot.
 *
 * @param {object} analytics - Integration analytics result
 * @param {object} [options] - Optional overrides for testing or direct memory processing
 * @returns {Promise<Array<object>>}
 */
export async function resolvePathConstraintsForProject(analytics, options = {}) {
    // 1. Direct memory / test payload mode
    if (options.coverageFinal && (options.sourceCode || options.sourceFiles)) {
        return extractConstraintsFromCoverage(options.coverageFinal, options.sourceCode || options.sourceFiles, options.filePath);
    }

    const snapshotId = analytics?.snapshotId || analytics?.overview?.snapshotId;
    if (!snapshotId) return [];

    try {
        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            select: { id: true, rootDir: true }
        });
        if (!snapshot?.rootDir) return [];

        const candidatePaths = [
            path.join(snapshot.rootDir, 'coverage', 'coverage-final.json'),
            path.join(snapshot.rootDir, 'coverage-final.json')
        ];

        let coverageFinal = null;
        let coverageFileFound = false;

        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                coverageFileFound = true;
                try {
                    coverageFinal = JSON.parse(fs.readFileSync(p, 'utf8'));
                    break;
                } catch (parseErr) {
                    console.warn(`[resolvePathConstraintsForProject] Corrupted coverage artifact at ${p}:`, parseErr.message);
                    if (Array.isArray(options.diagnostics)) {
                        options.diagnostics.push({
                            type: 'CORRUPTED_COVERAGE_JSON',
                            path: p,
                            error: parseErr.message
                        });
                    }
                }
            }
        }

        // Expected first-run state: no test execution has taken place yet, so no coverage artifact exists.
        if (!coverageFileFound) {
            if (Array.isArray(options.diagnostics)) {
                options.diagnostics.push({
                    type: 'FIRST_RUN_NO_COVERAGE',
                    message: 'No coverage-final.json found. Initial test generation will proceed without branch path constraints.'
                });
            }
            return [];
        }

        if (!coverageFinal || typeof coverageFinal !== 'object') {
            return [];
        }

        const allConstraints = [];
        for (const [coveredFilePath, covEntry] of Object.entries(coverageFinal)) {
            const uncoveredBranches = findUncoveredBranches(coverageFinal, coveredFilePath);
            if (!uncoveredBranches.length) continue;

            let code = null;
            if (fs.existsSync(coveredFilePath)) {
                try { code = fs.readFileSync(coveredFilePath, 'utf8'); } catch (_) {}
            } else {
                const altPath = path.isAbsolute(coveredFilePath) ? coveredFilePath : path.join(snapshot.rootDir, coveredFilePath);
                if (fs.existsSync(altPath)) {
                    try { code = fs.readFileSync(altPath, 'utf8'); } catch (_) {}
                }
            }

            if (!code && options.sourceFiles && Array.isArray(options.sourceFiles)) {
                const normTarget = coveredFilePath.replace(/\\/g, '/').toLowerCase();
                const matched = options.sourceFiles.find(f => {
                    const normP = (f.path || '').replace(/\\/g, '/').toLowerCase();
                    return normTarget === normP || normTarget.endsWith('/' + normP) || normP.endsWith('/' + normTarget);
                });
                if (matched?.content) {
                    code = matched.content;
                }
            }

            if (!code) {
                try {
                    const { loadSourceCode } = await import("./aiContextBuilder.service.js");
                    const loadedFiles = await loadSourceCode(snapshotId);
                    const normTarget = coveredFilePath.replace(/\\/g, '/').toLowerCase();
                    const matched = loadedFiles.find(f => {
                        const normP = (f.path || '').replace(/\\/g, '/').toLowerCase();
                        return normTarget === normP || normTarget.endsWith('/' + normP) || normP.endsWith('/' + normTarget);
                    });
                    if (matched?.content) code = matched.content;
                } catch (_) {}
            }

            if (!code) {
                console.warn(`[resolvePathConstraintsForProject] Source file could not be resolved for covered path: ${coveredFilePath}`);
                if (Array.isArray(options.diagnostics)) {
                    options.diagnostics.push({
                        type: 'SOURCE_FILE_UNRESOLVED',
                        filePath: coveredFilePath,
                        uncoveredBranchCount: uncoveredBranches.length
                    });
                }
                continue;
            }

            const isSubPath = snapshot.rootDir && (
                coveredFilePath.startsWith(snapshot.rootDir) ||
                path.resolve(coveredFilePath).toLowerCase().startsWith(path.resolve(snapshot.rootDir).toLowerCase())
            );
            const relativeFilePath = isSubPath
                ? path.relative(snapshot.rootDir, coveredFilePath).replace(/\\/g, '/')
                : coveredFilePath.replace(/\\/g, '/');

            for (const branch of uncoveredBranches) {
                const targetLine = branch.location?.start?.line || branch.line;
                if (!targetLine) {
                    allConstraints.push({
                        type: branch.type?.toUpperCase() || 'UNKNOWN',
                        condition: 'unresolved',
                        status: 'UNRESOLVED',
                        requiredBranch: 'UNKNOWN',
                        line: null,
                        uncoveredLine: null,
                        branchId: branch.branchId,
                        branchIndex: branch.branchIndex,
                        filePath: relativeFilePath
                    });
                    continue;
                }

                const constraints = extractBackwardPathConstraints(code, targetLine, {
                    branchIndex: branch.branchIndex,
                    branchType: branch.type,
                    location: branch.location
                });
                if (constraints.length > 0) {
                    constraints.forEach(c => {
                        allConstraints.push({
                            ...c,
                            uncoveredLine: targetLine,
                            branchId: branch.branchId,
                            branchIndex: branch.branchIndex,
                            filePath: relativeFilePath
                        });
                    });
                } else {
                    allConstraints.push({
                        type: branch.type?.toUpperCase() || 'BRANCH',
                        condition: 'unresolved',
                        status: 'UNRESOLVED',
                        requiredBranch: branch.branchIndex === 0 ? 'TRUE' : 'FALSE',
                        line: targetLine,
                        uncoveredLine: targetLine,
                        branchId: branch.branchId,
                        branchIndex: branch.branchIndex,
                        filePath: relativeFilePath
                    });
                }
            }
        }

        return allConstraints;
    } catch (err) {
        console.warn('[resolvePathConstraintsForProject] Unexpected failure during constraint resolution:', err.message);
        if (Array.isArray(options.diagnostics)) {
            options.diagnostics.push({
                type: 'INTERNAL_ERROR',
                error: err.message
            });
        }
        return [];
    }
}

/**
 * Extracts constraints directly from coverageFinal and source code (in memory).
 */
export function extractConstraintsFromCoverage(coverageFinal, sourceCodeOrFiles, defaultFilePath = null) {
    if (!coverageFinal || typeof coverageFinal !== 'object') return [];
    const results = [];

    if (typeof sourceCodeOrFiles === 'string') {
        const filePath = defaultFilePath || Object.keys(coverageFinal)[0] || 'source.js';
        const uncovered = findUncoveredBranches(coverageFinal, filePath);
        for (const branch of uncovered) {
            const targetLine = branch.location?.start?.line || branch.line;
            if (!targetLine) {
                results.push({
                    type: branch.type?.toUpperCase() || 'UNKNOWN',
                    condition: 'unresolved',
                    status: 'UNRESOLVED',
                    requiredBranch: 'UNKNOWN',
                    line: null,
                    uncoveredLine: null,
                    branchId: branch.branchId,
                    branchIndex: branch.branchIndex,
                    filePath
                });
                continue;
            }
            const constraints = extractBackwardPathConstraints(sourceCodeOrFiles, targetLine, {
                branchIndex: branch.branchIndex,
                branchType: branch.type,
                location: branch.location
            });
            if (constraints.length > 0) {
                constraints.forEach(c => results.push({
                    ...c,
                    uncoveredLine: targetLine,
                    branchId: branch.branchId,
                    branchIndex: branch.branchIndex,
                    filePath
                }));
            } else {
                results.push({
                    type: branch.type?.toUpperCase() || 'BRANCH',
                    condition: 'unresolved',
                    status: 'UNRESOLVED',
                    requiredBranch: branch.branchIndex === 0 ? 'TRUE' : 'FALSE',
                    line: targetLine,
                    uncoveredLine: targetLine,
                    branchId: branch.branchId,
                    branchIndex: branch.branchIndex,
                    filePath
                });
            }
        }
    } else if (Array.isArray(sourceCodeOrFiles)) {
        for (const file of sourceCodeOrFiles) {
            const uncovered = findUncoveredBranches(coverageFinal, file.path);
            for (const branch of uncovered) {
                const targetLine = branch.location?.start?.line || branch.line;
                if (!targetLine) continue;
                const constraints = extractBackwardPathConstraints(file.content, targetLine, {
                    branchIndex: branch.branchIndex,
                    branchType: branch.type,
                    location: branch.location
                });
                if (constraints.length > 0) {
                    constraints.forEach(c => results.push({
                        ...c,
                        uncoveredLine: targetLine,
                        branchId: branch.branchId,
                        branchIndex: branch.branchIndex,
                        filePath: file.path
                    }));
                } else {
                    results.push({
                        type: branch.type?.toUpperCase() || 'BRANCH',
                        condition: 'unresolved',
                        status: 'UNRESOLVED',
                        requiredBranch: branch.branchIndex === 0 ? 'TRUE' : 'FALSE',
                        line: targetLine,
                        uncoveredLine: targetLine,
                        branchId: branch.branchId,
                        branchIndex: branch.branchIndex,
                        filePath: file.path
                    });
                }
            }
        }
    }

    return results;
}
