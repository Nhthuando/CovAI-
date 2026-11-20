import { parseJavaScriptCode } from "./babelParser.service.js";

/**
 * Coordinate position & bounding box containment helpers
 */
export const isPositionLte = (p1, p2) => {
    if (!p1 || !p2) return false;
    const l1 = p1.line ?? 0;
    const l2 = p2.line ?? 0;
    if (l1 < l2) return true;
    if (l1 === l2) return (p1.column ?? 0) <= (p2.column ?? 0);
    return false;
};

export const isPositionGte = (p1, p2) => {
    if (!p1 || !p2) return false;
    const l1 = p1.line ?? 0;
    const l2 = p2.line ?? 0;
    if (l1 > l2) return true;
    if (l1 === l2) return (p1.column ?? 0) >= (p2.column ?? 0);
    return false;
};

export const isPositionLt = (p1, p2) => {
    if (!p1 || !p2) return false;
    const l1 = p1.line ?? 0;
    const l2 = p2.line ?? 0;
    if (l1 < l2) return true;
    if (l1 === l2) return (p1.column ?? 0) < (p2.column ?? 0);
    return false;
};

export const isLocContained = (outerLoc, innerLoc) => {
    if (!outerLoc || !innerLoc) return false;
    const outStart = outerLoc.start || { line: outerLoc.line || 1, column: 0 };
    const outEnd = outerLoc.end || { line: outerLoc.line || outStart.line, column: 99999 };
    const inStart = innerLoc.start || { line: innerLoc.line || 1, column: 0 };
    const inEnd = innerLoc.end || { line: innerLoc.line || inStart.line, column: 99999 };

    return isPositionLte(outStart, inStart) && isPositionGte(outEnd, inEnd);
};

export const isLocOverlapping = (locA, locB) => {
    if (!locA || !locB) return false;
    const aStart = locA.start || { line: locA.line || 1, column: 0 };
    const aEnd = locA.end || { line: locA.line || aStart.line, column: 99999 };
    const bStart = locB.start || { line: locB.line || 1, column: 0 };
    const bEnd = locB.end || { line: locB.line || bStart.line, column: 99999 };

    const aBeforeB = isPositionLt(aEnd, bStart);
    const bBeforeA = isPositionLt(bEnd, aStart);

    return !aBeforeB && !bBeforeA;
};

/**
 * Evaluates whether an expression node represents a compile-time static truthy/falsy value.
 */
export const evaluateStaticTruthiness = (node) => {
    if (!node || typeof node !== "object") return { isConstant: false };

    if (node.type === "BooleanLiteral") {
        return { isConstant: true, value: Boolean(node.value) };
    }
    if (node.type === "NumericLiteral") {
        return { isConstant: true, value: node.value !== 0 };
    }
    if (node.type === "StringLiteral") {
        return { isConstant: true, value: node.value !== "" };
    }
    if (node.type === "NullLiteral") {
        return { isConstant: true, value: false };
    }
    if (node.type === "Identifier") {
        if (node.name === "undefined" || node.name === "NaN") {
            return { isConstant: true, value: false };
        }
    }
    if (node.type === "UnaryExpression") {
        if (node.operator === "!") {
            const inner = evaluateStaticTruthiness(node.argument);
            if (inner.isConstant) {
                return { isConstant: true, value: !inner.value };
            }
        } else if (node.operator === "void") {
            return { isConstant: true, value: false };
        }
    }
    if (node.type === "BinaryExpression") {
        const left = evaluateStaticTruthiness(node.left);
        const right = evaluateStaticTruthiness(node.right);
        if (left.isConstant && right.isConstant && typeof node.left.value !== "undefined" && typeof node.right.value !== "undefined") {
            let res = null;
            if (node.operator === "===" || node.operator === "==") res = (node.left.value === node.right.value);
            else if (node.operator === "!==" || node.operator === "!=") res = (node.left.value !== node.right.value);
            else if (node.operator === "<") res = (node.left.value < node.right.value);
            else if (node.operator === "<=") res = (node.left.value <= node.right.value);
            else if (node.operator === ">") res = (node.left.value > node.right.value);
            else if (node.operator === ">=") res = (node.left.value >= node.right.value);
            if (res !== null) {
                return { isConstant: true, value: Boolean(res) };
            }
        }
    }

    return { isConstant: false };
};

/**
 * Checks if a member expression accesses process.env.<VAR>, process.platform, or process.arch.
 */
const inspectProcessMember = (node) => {
    if (!node || node.type !== "MemberExpression") return null;

    // process.env.<PROP>
    if (
        node.object?.type === "MemberExpression" &&
        node.object.object?.type === "Identifier" &&
        node.object.object.name === "process" &&
        (node.object.property?.name === "env" || node.object.property?.value === "env")
    ) {
        const prop = node.property?.name || node.property?.value;
        return { kind: "env", prop };
    }

    // process.platform or process.arch
    if (node.object?.type === "Identifier" && node.object.name === "process") {
        const prop = node.property?.name || node.property?.value;
        if (prop === "platform" || prop === "arch") {
            return { kind: prop, prop };
        }
    }

    return null;
};

/**
 * Checks whether an AST condition is an environment-dependent guard.
 */
export const inspectEnvironmentGuard = (conditionNode, sourceSnippet = "") => {
    if (!conditionNode) return null;

    // Check direct BinaryExpression: process.env.NODE_ENV === 'production'
    if (conditionNode.type === "BinaryExpression") {
        const leftProc = inspectProcessMember(conditionNode.left);
        const rightProc = inspectProcessMember(conditionNode.right);

        const procInfo = leftProc || rightProc;
        const otherNode = leftProc ? conditionNode.right : conditionNode.left;

        if (procInfo) {
            let litVal = null;
            if (otherNode?.type === "StringLiteral") litVal = otherNode.value;
            else if (otherNode?.type === "BooleanLiteral") litVal = String(otherNode.value);
            else if (otherNode?.type === "Identifier") litVal = otherNode.name;

            const op = conditionNode.operator;

            if (procInfo.prop === "NODE_ENV") {
                if (op === "===" || op === "==") {
                    if (litVal !== "test") {
                        return {
                            affectsBranch: "TRUE_BRANCH",
                            unreachableBranch: "consequent",
                            justification: `Guarded by process.env.NODE_ENV === '${litVal}'. Test suites execute hermetically in NODE_ENV='test'. Keep as environment safeguard; fake assertions suppressed.`,
                            reason: `Guarded by process.env.NODE_ENV === '${litVal}'`,
                            conditionText: sourceSnippet || `process.env.NODE_ENV === '${litVal}'`
                        };
                    } else {
                        return {
                            affectsBranch: "FALSE_BRANCH",
                            unreachableBranch: "alternate",
                            justification: `Guarded by process.env.NODE_ENV === 'test'. Condition is always true in hermetic unit test environments; alternate branch is unreachable.`,
                            reason: `Guarded by process.env.NODE_ENV === 'test'`,
                            conditionText: sourceSnippet || `process.env.NODE_ENV === 'test'`
                        };
                    }
                } else if (op === "!==" || op === "!=") {
                    if (litVal === "test") {
                        return {
                            affectsBranch: "TRUE_BRANCH",
                            unreachableBranch: "consequent",
                            justification: `Guarded by process.env.NODE_ENV !== 'test'. Test suites execute hermetically in NODE_ENV='test'. Keep as environment safeguard; fake assertions suppressed.`,
                            reason: `Guarded by process.env.NODE_ENV !== 'test'`,
                            conditionText: sourceSnippet || `process.env.NODE_ENV !== 'test'`
                        };
                    } else {
                        return {
                            affectsBranch: "FALSE_BRANCH",
                            unreachableBranch: "alternate",
                            justification: `Guarded by process.env.NODE_ENV !== '${litVal}'. Condition is always true in hermetic unit test environments; alternate branch is unreachable.`,
                            reason: `Guarded by process.env.NODE_ENV !== '${litVal}'`,
                            conditionText: sourceSnippet || `process.env.NODE_ENV !== '${litVal}'`
                        };
                    }
                }
            }

            if (procInfo.prop === "CI") {
                if (op === "===" || op === "==") {
                    return {
                        affectsBranch: "TRUE_BRANCH",
                        unreachableBranch: "consequent",
                        justification: `Guarded by CI environment check (process.env.CI === '${litVal}'). Unit test runs are environment-agnostic; condition branch is environment-dependent.`,
                        reason: `Guarded by process.env.CI check`,
                        conditionText: sourceSnippet || `process.env.CI === '${litVal}'`
                    };
                }
            }

            if (procInfo.kind === "platform") {
                if (op === "===" || op === "==") {
                    return {
                        affectsBranch: "TRUE_BRANCH",
                        unreachableBranch: "consequent",
                        justification: `Guarded by platform-specific check (process.platform === '${litVal}'). Unit test suites execute in a platform-neutral environment; condition branch is environment-dependent.`,
                        reason: `Guarded by process.platform === '${litVal}'`,
                        conditionText: sourceSnippet || `process.platform === '${litVal}'`
                    };
                }
            }

            if (procInfo.kind === "arch") {
                if (op === "===" || op === "==") {
                    return {
                        affectsBranch: "TRUE_BRANCH",
                        unreachableBranch: "consequent",
                        justification: `Guarded by architecture-specific check (process.arch === '${litVal}'). Unit test suites execute in architecture-neutral environment.`,
                        reason: `Guarded by process.arch === '${litVal}'`,
                        conditionText: sourceSnippet || `process.arch === '${litVal}'`
                    };
                }
            }
        }
    }

    // Inspect logical sub-expressions e.g. (process.env.NODE_ENV === 'production' && other)
    if (conditionNode.type === "LogicalExpression") {
        if (conditionNode.operator === "&&") {
            const leftRes = inspectEnvironmentGuard(conditionNode.left, sourceSnippet);
            if (leftRes && leftRes.affectsBranch === "TRUE_BRANCH") {
                return leftRes;
            }
        }
    }

    return null;
};

/**
 * Checks if a statement is an unconditional terminating jump statement.
 */
export const checkUnconditionalJump = (stmt) => {
    if (!stmt || typeof stmt !== "object") return null;

    if (stmt.type === "ReturnStatement") {
        return { type: "ReturnStatement", loc: stmt.loc };
    }
    if (stmt.type === "ThrowStatement") {
        return { type: "ThrowStatement", loc: stmt.loc };
    }
    if (stmt.type === "BreakStatement") {
        return { type: "BreakStatement", loc: stmt.loc };
    }
    if (stmt.type === "ContinueStatement") {
        return { type: "ContinueStatement", loc: stmt.loc };
    }

    // process.exit(...)
    if (
        stmt.type === "ExpressionStatement" &&
        stmt.expression?.type === "CallExpression" &&
        stmt.expression.callee?.type === "MemberExpression" &&
        stmt.expression.callee.object?.name === "process" &&
        stmt.expression.callee.property?.name === "exit"
    ) {
        return { type: "ProcessExit", loc: stmt.loc };
    }

    // IfStatement where BOTH branches terminate unconditionally
    if (stmt.type === "IfStatement" && stmt.consequent && stmt.alternate) {
        const consTerm = isBlockUnconditionallyTerminated(stmt.consequent);
        const altTerm = isBlockUnconditionallyTerminated(stmt.alternate);
        if (consTerm && altTerm) {
            return { type: "DualTerminatingIfElse", loc: stmt.loc };
        }
    }

    return null;
};

const isBlockUnconditionallyTerminated = (node) => {
    if (!node) return false;
    if (checkUnconditionalJump(node)) return true;
    if (node.type === "BlockStatement" && Array.isArray(node.body)) {
        for (const s of node.body) {
            if (checkUnconditionalJump(s)) return true;
        }
    }
    return false;
};

/**
 * Determines whether an expression is mathematically infallible (cannot throw in JS).
 */
const isInfallibleExpression = (expr) => {
    if (!expr || typeof expr !== "object") return false;

    // Literals never throw
    if (
        expr.type === "NumericLiteral" ||
        expr.type === "StringLiteral" ||
        expr.type === "BooleanLiteral" ||
        expr.type === "NullLiteral" ||
        expr.type === "RegExpLiteral"
    ) {
        return true;
    }

    // Identifiers never throw
    if (expr.type === "Identifier") {
        return true;
    }

    // Arrays with infallible elements
    if (expr.type === "ArrayExpression") {
        return expr.elements.every(el => el === null || isInfallibleExpression(el));
    }

    // Objects with infallible property values
    if (expr.type === "ObjectExpression") {
        return expr.properties.every(p => {
            if (p.type === "ObjectProperty" && !p.computed) {
                return isInfallibleExpression(p.value);
            }
            return false;
        });
    }

    // Safe unary operations (!, +, -, ~, typeof, void)
    if (expr.type === "UnaryExpression") {
        if (["!", "+", "-", "~", "typeof", "void"].includes(expr.operator)) {
            return isInfallibleExpression(expr.argument);
        }
    }

    // Safe arithmetic, logical, and equality binary operations
    if (expr.type === "BinaryExpression" || expr.type === "LogicalExpression") {
        const safeOps = ["+", "-", "*", "/", "%", "===", "==", "!==", "!=", "<", "<=", ">", ">=", "&&", "||", "??"];
        if (safeOps.includes(expr.operator)) {
            return isInfallibleExpression(expr.left) && isInfallibleExpression(expr.right);
        }
    }

    // Known built-in infallible function calls
    if (expr.type === "CallExpression") {
        const callee = expr.callee;
        let isKnownInfallible = false;

        // Math.* (Math.min, Math.max, Math.abs, Math.round, Math.floor, Math.ceil, Math.sqrt, etc.)
        if (callee?.type === "MemberExpression" && callee.object?.name === "Math") {
            isKnownInfallible = true;
        }
        // Array.isArray
        else if (callee?.type === "MemberExpression" && callee.object?.name === "Array" && callee.property?.name === "isArray") {
            isKnownInfallible = true;
        }
        // Number.isInteger, Number.isNaN, Number.isFinite
        else if (callee?.type === "MemberExpression" && callee.object?.name === "Number" && ["isInteger", "isNaN", "isFinite"].includes(callee.property?.name)) {
            isKnownInfallible = true;
        }
        // Boolean(...)
        else if (callee?.type === "Identifier" && callee.name === "Boolean") {
            isKnownInfallible = true;
        }

        if (isKnownInfallible) {
            return expr.arguments.every(arg => isInfallibleExpression(arg));
        }
    }

    return false;
};

/**
 * Checks whether all statements inside a try body cannot throw.
 */
const isTryBodyInfallible = (tryBlock) => {
    if (!tryBlock || !Array.isArray(tryBlock.body)) return false;
    if (tryBlock.body.length === 0) return true;

    for (const stmt of tryBlock.body) {
        if (stmt.type === "VariableDeclaration") {
            const allDeclarationsInfallible = (stmt.declarations || []).every(d => !d.init || isInfallibleExpression(d.init));
            if (!allDeclarationsInfallible) return false;
        } else if (stmt.type === "ExpressionStatement") {
            if (!isInfallibleExpression(stmt.expression)) return false;
        } else if (stmt.type === "ReturnStatement") {
            if (stmt.argument && !isInfallibleExpression(stmt.argument)) return false;
        } else {
            // Any control flow, throw, or unknown statement is considered potentially fallible
            return false;
        }
    }

    return true;
};

/**
 * Main Detection Engine:
 * Analyzes Babel AST and identifies dead, unreachable, environment-dependent,
 * and logically infeasible code blocks across the 5 standard categories.
 *
 * @param {object} ast - Babel AST
 * @param {string} sourceCode - Raw source code string
 * @returns {Array<object>} Detected infeasible code blocks
 */
export const detectInfeasibleAstNodes = (ast, sourceCode = "") => {
    let targetAst = ast;
    if (!targetAst && sourceCode) {
        const parseRes = parseJavaScriptCode(sourceCode);
        targetAst = parseRes.ast;
    }

    if (!targetAst || typeof targetAst !== "object") {
        return [];
    }

    const infeasibleBlocks = [];
    const lines = sourceCode ? sourceCode.split(/\r?\n/) : [];
    const getSnippet = (startLine, endLine) => {
        if (!startLine || !lines.length) return "";
        const el = endLine || startLine;
        return lines.slice(startLine - 1, el).join(" ").trim();
    };

    const getNodeSnippet = (n) => {
        if (!n) return "";
        if (sourceCode && typeof n.start === "number" && typeof n.end === "number") {
            return sourceCode.slice(n.start, n.end).trim();
        }
        return getSnippet(n.loc?.start?.line, n.loc?.end?.line);
    };

    const walk = (node, parent) => {
        if (!node || typeof node !== "object") return;

        // =========================================================================
        // CATEGORY 1: ENVIRONMENT-DEPENDENT GUARDS
        // =========================================================================
        if (node.type === "IfStatement" || node.type === "ConditionalExpression") {
            const snippet = getNodeSnippet(node.test);
            const envCheck = inspectEnvironmentGuard(node.test, snippet);
            if (envCheck) {
                const targetLoc = (envCheck.affectsBranch === "TRUE_BRANCH")
                    ? (node.consequent?.loc || node.loc)
                    : (node.alternate?.loc || node.loc);

                infeasibleBlocks.push({
                    type: "ENVIRONMENT_GUARD",
                    line: node.loc?.start?.line || 1,
                    loc: targetLoc,
                    justification: envCheck.justification,
                    category: "ENVIRONMENT",
                    affectsBranch: envCheck.affectsBranch,
                    unreachableBranch: envCheck.unreachableBranch,
                    reason: envCheck.reason,
                    conditionText: envCheck.conditionText
                });
            }
        }

        // =========================================================================
        // CATEGORY 2: DEAD CODE POST JUMP STATEMENTS
        // =========================================================================
        const statementLists = [];
        if (Array.isArray(node.body)) {
            statementLists.push(node.body);
        } else if (node.type === "SwitchCase" && Array.isArray(node.consequent)) {
            statementLists.push(node.consequent);
        }

        for (const stmts of statementLists) {
            let terminatingJump = null;
            for (let i = 0; i < stmts.length; i++) {
                const stmt = stmts[i];
                if (terminatingJump) {
                    infeasibleBlocks.push({
                        type: "DEAD_CODE_POST_JUMP",
                        line: stmt.loc?.start?.line || 1,
                        loc: stmt.loc,
                        justification: `Dead code located after unconditional jump statement (${terminatingJump.type}). Path is structurally unreachable. Recommend code cleanup or refactoring.`,
                        category: "DEAD_CODE",
                        affectsBranch: "BOTH",
                        unreachableBranch: "all",
                        reason: `Dead code following ${terminatingJump.type}`
                    });
                } else {
                    const jump = checkUnconditionalJump(stmt);
                    if (jump) {
                        terminatingJump = jump;
                    }
                }
            }
        }

        // =========================================================================
        // CATEGORY 3: CONSTANT BOOLEAN CONDITIONS & STATIC TRUTHINESS
        // =========================================================================
        if (node.type === "IfStatement" || node.type === "ConditionalExpression") {
            const staticResult = evaluateStaticTruthiness(node.test);
            if (staticResult.isConstant) {
                const condText = getNodeSnippet(node.test) || String(staticResult.value);
                if (staticResult.value === false) {
                    // True branch (consequent) is impossible
                    infeasibleBlocks.push({
                        type: "CONSTANT_CONDITION",
                        line: node.consequent?.loc?.start?.line || node.loc?.start?.line || 1,
                        loc: node.consequent?.loc || node.loc,
                        justification: `Condition '${condText}' is a compile-time constant false. The consequent (True) branch is logically impossible to traverse. Coverage statistic accurately reflects single feasible path.`,
                        category: "LOGIC",
                        affectsBranch: "TRUE_BRANCH",
                        unreachableBranch: "consequent",
                        reason: `Compile-time false condition (${condText})`,
                        conditionText: condText
                    });
                } else if (staticResult.value === true) {
                    // False branch (alternate) is impossible
                    infeasibleBlocks.push({
                        type: "CONSTANT_CONDITION",
                        line: node.alternate?.loc?.start?.line || node.loc?.start?.line || 1,
                        loc: node.alternate?.loc || node.loc,
                        justification: `Condition '${condText}' is a compile-time constant true. The alternate (False) branch is logically impossible to traverse. Coverage statistic accurately reflects single feasible path.`,
                        category: "LOGIC",
                        affectsBranch: "FALSE_BRANCH",
                        unreachableBranch: "alternate",
                        reason: `Compile-time true condition (${condText})`,
                        conditionText: condText
                    });
                }
            }
        } else if (node.type === "WhileStatement") {
            const staticResult = evaluateStaticTruthiness(node.test);
            if (staticResult.isConstant && staticResult.value === false) {
                infeasibleBlocks.push({
                    type: "CONSTANT_CONDITION",
                    line: node.body?.loc?.start?.line || node.loc?.start?.line || 1,
                    loc: node.body?.loc || node.loc,
                    justification: `While loop condition is compile-time constant false. Loop body is structurally unreachable.`,
                    category: "LOGIC",
                    affectsBranch: "TRUE_BRANCH",
                    unreachableBranch: "consequent",
                    reason: `While condition is constant false`
                });
            }
        }

        // =========================================================================
        // CATEGORY 4: DEFENSIVE NULL CHECKS ON INFALLIBLE LOCAL OBJECTS
        // =========================================================================
        if (node.type === "BlockStatement" || node.type === "Program") {
            const localInfallibleVars = new Map();
            const bodyStmts = node.body || [];

            for (const stmt of bodyStmts) {
                // Track declarations of {} or [] or new Object/Map/Set
                if (stmt.type === "VariableDeclaration") {
                    for (const decl of stmt.declarations || []) {
                        if (decl.id?.type === "Identifier" && decl.init) {
                            const isObjLiteral = decl.init.type === "ObjectExpression";
                            const isArrLiteral = decl.init.type === "ArrayExpression";
                            const isNewInfallible = decl.init.type === "NewExpression" && ["Map", "Set", "Object", "Array"].includes(decl.init.callee?.name);

                            if (isObjLiteral || isArrLiteral || isNewInfallible) {
                                localInfallibleVars.set(decl.id.name, {
                                    name: decl.id.name,
                                    line: decl.loc?.start?.line || 1,
                                    type: isObjLiteral ? "object" : (isArrLiteral ? "array" : decl.init.callee.name)
                                });
                            }
                        }
                    }
                }

                // If variable is reassigned to something else, remove from tracked infallibles
                if (stmt.type === "ExpressionStatement" && stmt.expression?.type === "AssignmentExpression") {
                    if (stmt.expression.left?.type === "Identifier") {
                        localInfallibleVars.delete(stmt.expression.left.name);
                    }
                }

                // Check IfStatement testing !x, x == null, x === null, x === undefined
                if (stmt.type === "IfStatement" && stmt.test) {
                    let testedVar = null;

                    // if (!x)
                    if (stmt.test.type === "UnaryExpression" && stmt.test.operator === "!" && stmt.test.argument?.type === "Identifier") {
                        if (localInfallibleVars.has(stmt.test.argument.name)) {
                            testedVar = stmt.test.argument.name;
                        }
                    }
                    // if (x == null || x === null || x === undefined)
                    else if (stmt.test.type === "BinaryExpression" && ["==", "==="].includes(stmt.test.operator)) {
                        const leftId = stmt.test.left?.type === "Identifier" ? stmt.test.left.name : null;
                        const rightId = stmt.test.right?.type === "Identifier" ? stmt.test.right.name : null;
                        const isRightNull = stmt.test.right?.type === "NullLiteral" || (stmt.test.right?.type === "Identifier" && stmt.test.right.name === "undefined");
                        const isLeftNull = stmt.test.left?.type === "NullLiteral" || (stmt.test.left?.type === "Identifier" && stmt.test.left.name === "undefined");

                        if (leftId && isRightNull && localInfallibleVars.has(leftId)) {
                            testedVar = leftId;
                        } else if (rightId && isLeftNull && localInfallibleVars.has(rightId)) {
                            testedVar = rightId;
                        }
                    }

                    if (testedVar) {
                        const info = localInfallibleVars.get(testedVar);
                        infeasibleBlocks.push({
                            type: "DEFENSIVE_NULL_CHECK",
                            line: stmt.consequent?.loc?.start?.line || stmt.loc?.start?.line || 1,
                            loc: stmt.consequent?.loc || stmt.loc,
                            justification: `Redundant defensive null check on locally instantiated ${info.type} ('${testedVar}'). Guard branch is mathematically unreachable. Safe defensive coding pattern preserved without fake assertions.`,
                            category: "DEFENSIVE",
                            affectsBranch: "TRUE_BRANCH",
                            unreachableBranch: "consequent",
                            reason: `Defensive check on guaranteed non-null local ${info.type} '${testedVar}'`
                        });
                    }
                }
            }
        }

        // =========================================================================
        // CATEGORY 5: INFALLIBLE TRY/CATCH EXCEPTION BLOCKS
        // =========================================================================
        if (node.type === "TryStatement" && node.handler) {
            if (isTryBodyInfallible(node.block)) {
                infeasibleBlocks.push({
                    type: "INFALLIBLE_TRY_CATCH",
                    line: node.handler.loc?.start?.line || node.loc?.start?.line || 1,
                    loc: node.handler.loc || node.loc,
                    justification: `Catch clause wraps infallible built-in operations. Exception path cannot be triggered without corrupting JavaScript runtime built-ins.`,
                    category: "DEFENSIVE",
                    affectsBranch: "TRUE_BRANCH",
                    unreachableBranch: "consequent",
                    reason: "Infallible try block operations"
                });
            }
        }

        // =========================================================================
        // CATEGORY 6: CONTRADICTORY / DUPLICATE ELSE-IF BRANCH CONDITIONS
        // =========================================================================
        if (node.type === "IfStatement" && node.alternate?.type === "IfStatement") {
            const firstTestStr = getNodeSnippet(node.test);
            const secondTestStr = getNodeSnippet(node.alternate.test);

            if (firstTestStr && secondTestStr && firstTestStr === secondTestStr) {
                infeasibleBlocks.push({
                    type: "CONTRADICTORY_BRANCH",
                    line: node.alternate.consequent?.loc?.start?.line || node.alternate.loc?.start?.line || 1,
                    loc: node.alternate.consequent?.loc || node.alternate.loc,
                    justification: `Condition '${secondTestStr}' is identical to preceding guard in if-else chain. Branch is logically impossible to enter. Flagged for review; no fake assertions generated.`,
                    category: "LOGIC",
                    affectsBranch: "TRUE_BRANCH",
                    unreachableBranch: "consequent",
                    reason: `Subsumed duplicate condition '${secondTestStr}'`
                });
            }
        }

        // Recurse into child AST nodes
        for (const key of Object.keys(node)) {
            if (key === "loc" || key === "comments" || key === "leadingComments" || key === "trailingComments") continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const c of child) walk(c, node);
            } else if (child && typeof child === "object") {
                walk(child, node);
            }
        }
    };

    walk(targetAst, null);

    return infeasibleBlocks;
};
