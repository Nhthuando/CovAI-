import { parseJavaScriptCode } from "./babelParser.service.js";

export const UNCOVERAGE_REASON_CATEGORIES = {
    UNREACHABLE_CODE: "UNREACHABLE_CODE",
    DEFENSIVE_EARLY_EXIT: "DEFENSIVE_EARLY_EXIT",
    UNEXERCISED_BRANCH: "UNEXERCISED_BRANCH",
    EXCEPTION_PATH: "EXCEPTION_PATH",
    UNEXERCISED_FUNCTION: "UNEXERCISED_FUNCTION"
};

/**
 * Walks a Babel AST safely to extract function ranges, guard clauses, catch blocks,
 * loops, and post-jump unreachable statements.
 */
function extractAstStructuralRanges(sourceCode = "") {
    const functions = [];
    const guards = [];
    const catchRanges = [];
    const unreachableRanges = [];
    const branchConditionsByLine = new Map();

    if (!sourceCode || typeof sourceCode !== "string") {
        return { functions, guards, catchRanges, unreachableRanges, branchConditionsByLine };
    }

    const parsed = parseJavaScriptCode(sourceCode);
    const ast = parsed?.ast;
    const codeLines = sourceCode.split(/\r?\n/);

    const sliceConditionText = (node) => {
        if (!node?.loc) return "";
        const sLine = node.loc.start.line;
        const eLine = node.loc.end.line;
        if (sLine === eLine && codeLines[sLine - 1]) {
            return codeLines[sLine - 1].slice(node.loc.start.column, node.loc.end.column).trim();
        }
        return (codeLines[sLine - 1] || "").trim();
    };

    const isJumpStatement = (stmt) =>
        stmt && ["ReturnStatement", "ThrowStatement", "ContinueStatement", "BreakStatement"].includes(stmt.type);

    const blockEndsWithJump = (node) => {
        if (!node) return false;
        if (isJumpStatement(node)) return true;
        if (node.type === "BlockStatement" && Array.isArray(node.body) && node.body.length > 0) {
            return isJumpStatement(node.body[node.body.length - 1]);
        }
        return false;
    };

    const isDefensiveGuardCondition = (condText = "") => {
        if (!condText) return false;
        return /(?:!\s*[a-zA-Z0-9_$.]+|Array\.isArray|\.length\s*(?:===|==|<=|<)\s*0|typeof\s+[^\s]+\s*(?:===|!==|==|!=)|===\s*(?:null|undefined)|==\s*null)/i.test(condText);
    };

    const visit = (node, parentFn = null) => {
        if (!node || typeof node !== "object") return;

        let currentFn = parentFn;
        if (
            ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod"].includes(node.type) &&
            node.loc
        ) {
            const fnName =
                node.id?.name ||
                node.key?.name ||
                "anonymous";
            currentFn = {
                name: fnName,
                startLine: node.loc.start.line,
                endLine: node.loc.end.line
            };
            functions.push(currentFn);
        }

        if (node.type === "CatchClause" && node.loc) {
            catchRanges.push({
                startLine: node.loc.start.line,
                endLine: node.loc.end.line,
                paramName: node.param?.name || "err"
            });
        }

        if (node.type === "BlockStatement" && Array.isArray(node.body)) {
            let jumpSeen = null;
            for (const stmt of node.body) {
                if (jumpSeen && stmt?.loc) {
                    unreachableRanges.push({
                        startLine: stmt.loc.start.line,
                        endLine: stmt.loc.end.line,
                        jumpType: jumpSeen.type,
                        jumpLine: jumpSeen.loc?.start?.line
                    });
                } else if (isJumpStatement(stmt)) {
                    jumpSeen = stmt;
                }
            }
        }

        if (node.type === "IfStatement" && node.loc) {
            const condText = sliceConditionText(node.test);
            const line = node.loc.start.line;
            if (condText) {
                branchConditionsByLine.set(line, condText);
            }
            if (!node.alternate && blockEndsWithJump(node.consequent)) {
                const consStart = node.consequent.loc?.start?.line || line;
                const consEnd = node.consequent.loc?.end?.line || consStart;
                guards.push({
                    line,
                    startLine: line,
                    endLine: consEnd,
                    condition: condText || (codeLines[line - 1] || "").trim(),
                    isDefensive: isDefensiveGuardCondition(condText),
                    fnStartLine: currentFn?.startLine || 1,
                    fnEndLine: currentFn?.endLine || codeLines.length,
                    fnName: currentFn?.name || null
                });
            }
        }

        if ((node.type === "WhileStatement" || node.type === "ForStatement" || node.type === "ForOfStatement") && node.loc) {
            const condText = node.test ? sliceConditionText(node.test) : sliceConditionText(node);
            if (condText) {
                branchConditionsByLine.set(node.loc.start.line, condText);
            }
        }

        for (const key of Object.keys(node)) {
            if (key === "loc" || key === " leadingComments" || key === "trailingComments") continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) visit(item, currentFn);
            } else if (child && typeof child === "object" && child.type) {
                visit(child, currentFn);
            }
        }
    };

    if (ast) {
        visit(ast, null);
    }

    return { functions, guards, catchRanges, unreachableRanges, branchConditionsByLine };
}

/**
 * Evaluates uncovered lines, branches, and statements for a file and assigns
 * explicit diagnostic categories and human-readable explanations.
 */
export function evaluateUncoverageDiagnostics({
    sourceCode = "",
    statements = [],
    branches = [],
    functions = [],
    lineCoverage = {},
    astMetadata = null,
    coverageGapAnalysis = null
} = {}) {
    const codeLines = sourceCode ? sourceCode.split(/\r?\n/) : [];
    const astStructure = extractAstStructuralRanges(sourceCode);

    const infeasibleBlocks = [
        ...(coverageGapAnalysis?.infeasibleCodeBlocks || []),
        ...(astMetadata?.infeasibleNodes || [])
    ];

    const findInfeasibleForLine = (line) => {
        for (const inf of infeasibleBlocks) {
            const sLine = inf.startLine || inf.line || inf.loc?.start?.line;
            const eLine = inf.endLine || inf.loc?.end?.line || sLine;
            if (sLine && line >= sLine && line <= eLine) return inf;
        }
        for (const u of astStructure.unreachableRanges) {
            if (line >= u.startLine && line <= u.endLine) {
                return {
                    type: "DEAD_CODE_POST_JUMP",
                    line: u.startLine,
                    justification: `Unreachable code: Located after unconditional jump statement (${u.jumpType} at line ${u.jumpLine}); structurally impossible to execute.`
                };
            }
        }
        return null;
    };

    const findCatchForLine = (line) =>
        astStructure.catchRanges.find((c) => line >= c.startLine && line <= c.endLine) ||
        (astMetadata?.exceptionPoints || []).find((ep) => ep.line === line || (ep.startLine && line >= ep.startLine && line <= ep.endLine));

    const findUnexercisedFunctionForLine = (line) =>
        (functions || []).find((f) => !f.covered && (f.hits || 0) === 0 && line >= (f.startLine || f.line || 0) && line <= (f.endLine || f.line || 0));

    // Determine which guards tripped early and blocked the rest of their function
    const blockingGuards = [];
    for (const guard of astStructure.guards) {
        const guardBranch = (branches || []).find((b) => Math.abs((b.line || 0) - guard.line) <= 1);
        const stmtsBeforeOrInGuard = (statements || []).filter(
            (s) => s.startLine >= guard.startLine && s.startLine <= guard.endLine
        );
        const stmtsAfterGuard = (statements || []).filter(
            (s) => s.startLine > guard.endLine && s.startLine <= guard.fnEndLine
        );
        const guardExecuted =
            stmtsBeforeOrInGuard.some((s) => (s.hits || 0) > 0) ||
            (guardBranch && (guardBranch.totalHits || 0) > 0);
        const allAfterUncovered =
            stmtsAfterGuard.length > 0 && stmtsAfterGuard.every((s) => (s.hits || 0) === 0);

        if (guardExecuted && allAfterUncovered) {
            blockingGuards.push(guard);
        }
    }

    const findBlockingGuardForLine = (line) =>
        blockingGuards.find((g) => line > g.endLine && line <= g.fnEndLine);

    const findGuardContainingLine = (line) =>
        astStructure.guards.find((g) => line >= g.startLine && line <= g.endLine);

    const byReasonCategory = {
        UNREACHABLE_CODE: 0,
        DEFENSIVE_EARLY_EXIT: 0,
        UNEXERCISED_BRANCH: 0,
        EXCEPTION_PATH: 0,
        UNEXERCISED_FUNCTION: 0
    };

    const diagnosticBranches = [];
    const branchDiagnosticsByLine = new Map();

    // 1. Evaluate Branches
    for (const b of branches || []) {
        if (b.status === "fully_covered") continue;

        const counts = Array.isArray(b.counts)
            ? b.counts
            : Array.isArray(b.paths)
              ? b.paths.map((p) => p.hits || 0)
              : [];
        const trueHits = counts[0] ?? 0;
        const falseHits = counts[1] ?? 0;
        const missedTrue = b.missedTrue ?? trueHits === 0;
        const missedFalse = b.missedFalse ?? (counts.length > 1 ? falseHits === 0 : false);
        const cond = b.condition || astStructure.branchConditionsByLine.get(b.line) || (codeLines[(b.line || 1) - 1] || "").trim();

        let reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_BRANCH;
        let reason = "";

        const inf = b.isInfeasible ? (b.infeasibleMeta || { justification: "Unreachable or environment-guarded branch." }) : findInfeasibleForLine(b.line);
        const catchBlock = findCatchForLine(b.line);
        const unexercisedFn = findUnexercisedFunctionForLine(b.line);
        const blockingGuard = findBlockingGuardForLine(b.line);
        const ownGuard = findGuardContainingLine(b.line);

        if (inf) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNREACHABLE_CODE;
            reason = inf.actionableJustification || inf.justification || `Unreachable branch at line ${b.line}: Condition '${cond}' cannot be satisfied in standard unit test execution.`;
        } else if (unexercisedFn) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_FUNCTION;
            reason = `Unexercised function: Branch '${cond}' at line ${b.line} was not reached because enclosing function '${unexercisedFn.name}きたいと思います' was never invoked.`.replace("きたいと思います", "");
        } else if (catchBlock) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.EXCEPTION_PATH;
            reason = `Unhandled exception path: Error branch '${cond}' at line ${b.line} was not reached because tests did not trigger an exception or rejected promise.`;
        } else if (blockingGuard) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT;
            reason = `Defensive early exit: Branch '${cond}' at line ${b.line} was bypassed because all test inputs triggered the early-return guard '${blockingGuard.condition}' at line ${blockingGuard.line}.`;
        } else if (ownGuard) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT;
            if (missedFalse && !missedTrue) {
                reason = `Defensive early exit: False branch (valid input continuing past guard '${cond}') was never executed because all test inputs triggered the early return at line ${b.line}.`;
            } else if (missedTrue && !missedFalse) {
                reason = `Defensive early exit: Guard clause '${cond}' at line ${b.line} was not triggered because test inputs did not provide boundary, empty, or invalid values.`;
            } else {
                reason = `Defensive early exit: Guard clause '${cond}' at line ${b.line} was not fully exercised across both valid and invalid inputs.`;
            }
        } else {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_BRANCH;
            if (missedTrue && !missedFalse) {
                reason = `Unexercised branch condition: True path of '${cond}' at line ${b.line} was not taken (0 hits). Provide test inputs that satisfy '${cond}'.`;
            } else if (missedFalse && !missedTrue) {
                reason = `Unexercised branch condition: False path of '${cond}' at line ${b.line} was not taken (0 hits). Provide test inputs where '${cond}' evaluates to false.`;
            } else {
                reason = `Unexercised branch condition: Neither True nor False path of '${cond}' at line ${b.line} was executed. Provide test inputs reaching line ${b.line}.`;
            }
        }

        b.reasonCategory = reasonCategory;
        b.uncoverageReason = reason;
        b.reason = reason;
        b.missedTrue = missedTrue;
        b.missedFalse = missedFalse;

        const diagItem = {
            branchId: `b-${b.id ?? b.line}`,
            line: b.line,
            type: b.type || "if",
            condition: cond,
            status: b.status,
            uncoveredPath: missedTrue && missedFalse ? "Both branches" : missedTrue ? "True branch" : "False branch",
            reasonCategory,
            reason,
            missedTrue,
            missedFalse,
            isInfeasible: Boolean(inf || b.isInfeasible)
        };
        diagnosticBranches.push(diagItem);
        if (!branchDiagnosticsByLine.has(b.line)) {
            branchDiagnosticsByLine.set(b.line, diagItem);
        }
    }

    // 2. Evaluate Statements
    const diagnosticStatements = [];
    const stmtDiagnosticsByLine = new Map();

    for (const s of statements || []) {
        if (s.covered || (s.hits || 0) > 0) continue;

        const line = s.startLine || s.line || 1;
        const snippet = s.codeSnippet || (codeLines[line - 1] || "").trim();
        let reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_BRANCH;
        let reason = "";

        const inf = findInfeasibleForLine(line);
        const catchBlock = findCatchForLine(line);
        const unexercisedFn = findUnexercisedFunctionForLine(line);
        const blockingGuard = findBlockingGuardForLine(line);
        const ownGuard = findGuardContainingLine(line);
        const branchOnLine = branchDiagnosticsByLine.get(line);

        if (inf) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNREACHABLE_CODE;
            reason = inf.actionableJustification || inf.justification || `Unreachable code at line ${line}: Statement is structurally unreachable after an unconditional jump or constant guard.`;
        } else if (unexercisedFn) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_FUNCTION;
            reason = `Unexercised function: Statement at line ${line} was never executed because function '${unexercisedFn.name}' was never called by any test.`;
        } else if (catchBlock || s.type === "exception" || /^\s*catch\b/.test(snippet)) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.EXCEPTION_PATH;
            reason = `Unhandled exception path: Catch/error statement at line ${line} was not executed because tests did not simulate thrown errors or rejected promises.`;
        } else if (blockingGuard) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT;
            reason = `Defensive early exit: Main logic statement at line ${line} was bypassed because test inputs only triggered the early-return guard (${blockingGuard.condition}) at line ${blockingGuard.line}.`;
        } else if (ownGuard) {
            reasonCategory = UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT;
            reason = `Defensive early exit: Early-exit statement at line ${line} inside guard (${ownGuard.condition}) was not triggered because test inputs only supplied valid non-boundary values.`;
        } else if (branchOnLine) {
            reasonCategory = branchOnLine.reasonCategory;
            reason = branchOnLine.reason;
        } else {
            // Find nearest preceding uncovered/partially covered branch in the same function
            const precedingBranch = [...diagnosticBranches]
                .reverse()
                .find((db) => db.line <= line && line - db.line <= 25);
            if (precedingBranch) {
                reasonCategory = precedingBranch.reasonCategory;
                reason =
                    precedingBranch.reasonCategory === UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT
                        ? `Defensive early exit: Statement at line ${line} was bypassed due to early exit guard '${precedingBranch.condition}' at line ${precedingBranch.line}.`
                        : `Unexercised branch condition: Statement at line ${line} is gated by '${precedingBranch.condition}' (line ${precedingBranch.line}), whose ${precedingBranch.uncoveredPath.toLowerCase()} was not taken.`;
            } else {
                reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_BRANCH;
                reason = `Unexercised statement at line ${line}: Code path was not reached by current unit test inputs.`;
            }
        }

        s.reasonCategory = reasonCategory;
        s.uncoverageReason = reason;
        s.reason = reason;

        const diagStmt = {
            stmtId: `s-${s.id ?? line}`,
            line,
            startCol: s.startCol ?? 0,
            endCol: s.endCol,
            codeSnippet: snippet,
            type: s.type || "statement",
            reasonCategory,
            reason,
            isInfeasible: Boolean(inf)
        };
        diagnosticStatements.push(diagStmt);
        if (!stmtDiagnosticsByLine.has(line)) {
            stmtDiagnosticsByLine.set(line, diagStmt);
        }
    }

    // 3. Evaluate & Enrich Lines
    const diagnosticLines = [];
    const linesObj = lineCoverage?.lines || {};
    const allLineNums = Object.keys(linesObj)
        .map(Number)
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);

    for (const lineNum of allLineNums) {
        const entry = linesObj[lineNum];
        if (!entry || entry.status === "covered") continue;

        const snippet = (codeLines[lineNum - 1] || "").trim();
        const stmtDiag = stmtDiagnosticsByLine.get(lineNum);
        const branchDiag = branchDiagnosticsByLine.get(lineNum);

        let reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_BRANCH;
        let reason = entry.reason || "";

        if (entry.status === "partially_covered" && branchDiag) {
            reasonCategory = branchDiag.reasonCategory;
            reason = branchDiag.reason;
        } else if (stmtDiag) {
            reasonCategory = stmtDiag.reasonCategory;
            reason = stmtDiag.reason;
        } else if (branchDiag) {
            reasonCategory = branchDiag.reasonCategory;
            reason = branchDiag.reason;
        } else {
            const inf = findInfeasibleForLine(lineNum);
            const catchBlock = findCatchForLine(lineNum);
            const unexercisedFn = findUnexercisedFunctionForLine(lineNum);
            const blockingGuard = findBlockingGuardForLine(lineNum);
            const ownGuard = findGuardContainingLine(lineNum);

            if (inf) {
                reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNREACHABLE_CODE;
                reason = inf.actionableJustification || inf.justification || `Unreachable code at line ${lineNum}.`;
            } else if (unexercisedFn) {
                reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_FUNCTION;
                reason = `Unexercised function: Line ${lineNum} inside '${unexercisedFn.name}' was never executed.`;
            } else if (catchBlock) {
                reasonCategory = UNCOVERAGE_REASON_CATEGORIES.EXCEPTION_PATH;
                reason = `Unhandled exception path: Line ${lineNum} inside catch/error handler was not triggered.`;
            } else if (blockingGuard) {
                reasonCategory = UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT;
                reason = `Defensive early exit: Main logic at line ${lineNum} was bypassed because tests only triggered early-return guard '${blockingGuard.condition}' at line ${blockingGuard.line}.`;
            } else if (ownGuard) {
                reasonCategory = UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT;
                reason = `Defensive early exit: Guard clause at line ${lineNum} (${ownGuard.condition}) was not triggered by test inputs.`;
            } else {
                reasonCategory = UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_BRANCH;
                reason = `Unexercised code path at line ${lineNum}: Not reached by current test inputs.`;
            }
        }

        entry.reasonCategory = reasonCategory;
        entry.uncoverageReason = reason;
        entry.reason = reason;

        if (entry.status === "uncovered" || entry.status === "partially_covered") {
            byReasonCategory[reasonCategory] = (byReasonCategory[reasonCategory] || 0) + 1;
            const fnOwner = astStructure.functions.find(
                (f) => lineNum >= f.startLine && lineNum <= f.endLine
            );
            diagnosticLines.push({
                line: lineNum,
                status: entry.status,
                reasonCategory,
                reason,
                snippet,
                functionName: fnOwner?.name || null,
                isInfeasible: reasonCategory === UNCOVERAGE_REASON_CATEGORIES.UNREACHABLE_CODE
            });
        }
    }

    // Build unified items list combining distinct line & branch diagnostics for UI drawers
    const items = [];
    const seenLineBranch = new Set();
    for (const b of diagnosticBranches) {
        seenLineBranch.add(`b:${b.line}`);
        items.push({
            kind: "branch",
            line: b.line,
            reasonCategory: b.reasonCategory,
            reason: b.reason,
            condition: b.condition,
            uncoveredPath: b.uncoveredPath,
            snippet: b.condition,
            isInfeasible: b.isInfeasible
        });
    }
    for (const l of diagnosticLines) {
        if (!seenLineBranch.has(`b:${l.line}`)) {
            items.push({
                kind: "line",
                line: l.line,
                reasonCategory: l.reasonCategory,
                reason: l.reason,
                snippet: l.snippet,
                functionName: l.functionName,
                isInfeasible: l.isInfeasible
            });
        }
    }
    items.sort((a, b) => (a.line || 0) - (b.line || 0));

    return {
        summary: {
            totalUncoveredLines: (lineCoverage?.uncoveredLines || []).length,
            totalUncoveredBranches: diagnosticBranches.length,
            totalUncoveredStatements: diagnosticStatements.length,
            byReasonCategory
        },
        lines: diagnosticLines,
        branches: diagnosticBranches,
        statements: diagnosticStatements,
        items
    };
}

