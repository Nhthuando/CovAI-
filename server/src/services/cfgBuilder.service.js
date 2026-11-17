import { ServiceError } from "../utils/serviceError.js";

/**
 * CFG Builder Service
 * Traverses an AST node and generates a Control Flow Graph.
 */

const createNode = (id, type, line = null) => ({ id, type, line });
const createEdge = (from, to, label = null) => ({ from, to, label });
const functionTypes = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
]);

const collectDecisions = (root) => {
  const decisions = [];
  const visit = (node) => {
    if (!node || typeof node !== "object" || functionTypes.has(node.type)) return;
    if (node.type === "ConditionalExpression" ||
        (node.type === "LogicalExpression" && ["&&", "||", "??"].includes(node.operator))) {
      decisions.push(node);
    }
    for (const [key, child] of Object.entries(node)) {
      if (["loc", "parent", "extra", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(root);
  return decisions.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
};

export const buildCFG = (astNode, metadata = {}) => {
  if (!astNode || typeof astNode !== "object") {
    throw new ServiceError("Invalid AST node", 400);
  }

  const nodes = [];
  const edges = [];
  let nodeCounter = 0;

  const generateId = (prefix) => `${prefix}_${++nodeCounter}`;
  const connect = (from, to, label = null) => {
    if (from !== null) edges.push(createEdge(from, to, label));
  };
  const chainDecisions = (expression, previous) => {
    for (const decision of collectDecisions(expression)) {
      const line = decision.loc?.start?.line ?? null;
      const condition = generateId("decision");
      const alternate = generateId("alt");
      const join = generateId("join");
      nodes.push(createNode(condition, "condition", line),
        createNode(alternate, "statement", line), createNode(join, "statement"));
      connect(previous, condition);
      connect(condition, alternate, decision.operator ?? "ternary");
      connect(alternate, join);
      connect(condition, join);
      previous = join;
    }
    return previous;
  };
  const breakTargets = [];
  const continueTargets = [];

  const traverse = (node, parentId = "start") => {
    if (!node || typeof node !== "object") return parentId;

    let currentId = parentId;
    const line = node.loc && node.loc.start ? node.loc.start.line : null;

    switch (node.type) {
      case "ClassMethod":
      case "ClassPrivateMethod":
      case "ObjectMethod":
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node !== astNode) {
          const nestedId = generateId("stmt");
          nodes.push(createNode(nestedId, "statement", line));
          connect(parentId, nestedId);
          return nestedId;
        }
        const startNode = createNode("start", "start", line);
        nodes.push(startNode);
        traverse(node.body, "start");
        break;

      case "BlockStatement":
        let blockParent = parentId;
        if (node.body && Array.isArray(node.body)) {
          for (const stmt of node.body) {
            blockParent = traverse(stmt, blockParent);
          }
        }
        currentId = blockParent;
        break;

      case "IfStatement":
        parentId = chainDecisions(node.test, parentId);
        const ifId = generateId("if");
        nodes.push(createNode(ifId, "condition", line));
        connect(parentId, ifId);

        const thenEnd = traverse(node.consequent, ifId);
        const elseEnd = node.alternate ? traverse(node.alternate, ifId) : ifId;
        // Only branches that fall through can reach the following statement.
        const continuing = [thenEnd, elseEnd].filter((id) => id !== null);
        if (continuing.length === 0) return null;
        const joinId = generateId("join");
        nodes.push(createNode(joinId, "statement"));
        for (const endId of continuing) edges.push(createEdge(endId, joinId));
        currentId = joinId;
        break;

      case "ReturnStatement":
      case "ThrowStatement":
        parentId = chainDecisions(node.argument, parentId);
        const retId = generateId("return");
        nodes.push(createNode(retId, node.type === "ThrowStatement" ? "throw" : "return", line));
        connect(parentId, retId);
        return null;

      case "BreakStatement":
      case "ContinueStatement":
        const jumpId = generateId("stmt");
        nodes.push(createNode(jumpId, "statement", line));
        connect(parentId, jumpId);
        const targets = node.type === "BreakStatement" ? breakTargets : continueTargets;
        if (targets.length) connect(jumpId, targets[targets.length - 1]);
        return null;

      case "ExpressionStatement":
      case "VariableDeclaration":
      case "AwaitExpression":
        parentId = chainDecisions(node, parentId);
        const stmtId = generateId("stmt");
        nodes.push(createNode(stmtId, "statement", line));
        connect(parentId, stmtId);
        currentId = stmtId;
        break;

      case "TryStatement":
        const tryId = generateId("try");
        nodes.push(createNode(tryId, "statement", line));
        connect(parentId, tryId);
        const tryEnd = traverse(node.block, tryId);
        const tryEnds = [tryEnd];
        if (node.handler) {
          const catchLine = node.handler.loc?.start?.line || line;
          const catchId = generateId("catch");
          nodes.push(createNode(catchId, "condition", catchLine));
          edges.push(createEdge(tryId, catchId, "error"));
          tryEnds.push(traverse(node.handler.body, catchId));
        }
        const liveEnds = tryEnds.filter(id => id !== null);
        let tryJoin = null;
        if (liveEnds.length) {
          tryJoin = generateId("join");
          nodes.push(createNode(tryJoin, "statement"));
          liveEnds.forEach(id => connect(id, tryJoin));
        }
        if (node.finalizer) {
          const finallyLine = node.finalizer.loc?.start?.line || line;
          const finallyId = generateId("finally");
          nodes.push(createNode(finallyId, "statement", finallyLine));
          connect(tryJoin, finallyId);
          tryJoin = traverse(node.finalizer, finallyId);
        }
        currentId = tryJoin;
        break;

      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        for (const expression of [node.init, node.left, node.right, node.test, node.update]) {
          parentId = chainDecisions(expression, parentId);
        }
        const loopId = generateId("loop");
        const loopExit = generateId("join");
        nodes.push(createNode(loopId, "condition", line));
        nodes.push(createNode(loopExit, "statement"));
        connect(parentId, loopId);
        breakTargets.push(loopExit);
        continueTargets.push(loopId);
        const loopEnd = traverse(node.body, loopId);
        continueTargets.pop();
        breakTargets.pop();
        connect(loopEnd, loopId, "next");
        connect(loopId, loopExit);
        currentId = loopExit;
        break;

      case "SwitchStatement":
        parentId = chainDecisions(node.discriminant, parentId);
        const switchId = generateId("switch");
        nodes.push(createNode(switchId, "condition", line));
        connect(parentId, switchId);
        const switchExit = generateId("join");
        nodes.push(createNode(switchExit, "statement"));
        breakTargets.push(switchExit);
        let testEnd = switchId;
        const entries = new Map();
        for (const c of node.cases || []) {
          const entry = generateId("case_body");
          nodes.push(createNode(entry, "statement", c.loc?.start?.line ?? line));
          entries.set(c, entry);
          if (c.test) {
            testEnd = chainDecisions(c.test, testEnd);
            const caseId = generateId("case");
            nodes.push(createNode(caseId, "condition", c.loc?.start?.line ?? line));
            connect(testEnd, caseId);
            connect(caseId, entry, "match");
            testEnd = caseId;
          }
        }
        const defaultCase = (node.cases || []).find(c => !c.test);
        connect(testEnd, defaultCase ? entries.get(defaultCase) : switchExit, "default");
        let fallthrough = null;
        for (const c of node.cases || []) {
          const entry = entries.get(c);
          connect(fallthrough, entry);
          fallthrough = entry;
          for (const stmt of c.consequent || []) fallthrough = traverse(stmt, fallthrough);
        }
        connect(fallthrough, switchExit);
        breakTargets.pop();
        if (edges.some(edge => edge.to === switchExit)) currentId = switchExit;
        else {
          nodes.splice(nodes.findIndex(n => n.id === switchExit), 1);
          currentId = null;
        }
        break;

      default:
        // Handle unsupported or generic nodes by traversing their children
        let genericId = parentId;
        if (node.body) {
          if (Array.isArray(node.body)) {
            node.body.forEach((stmt) => { genericId = traverse(stmt, genericId) || genericId; });
          } else {
            genericId = traverse(node.body, genericId) || genericId;
          }
        } else if (node.consequent && Array.isArray(node.consequent)) {
          node.consequent.forEach((stmt) => { genericId = traverse(stmt, genericId) || genericId; });
        } else {
          // It's a terminal generic node
          const fallbackId = generateId("expr");
          nodes.push(createNode(fallbackId, "statement", line));
          parentId = chainDecisions(node, parentId);
          connect(parentId, fallbackId);
          genericId = fallbackId;
        }
        currentId = genericId;
        break;
    }
    return currentId;
  };

  try {
    traverse(astNode);
    if (nodes.length === 1 && nodes[0].type === "start") nodes.length = 0;
  } catch (err) {
    throw new ServiceError(`Failed to generate CFG: ${err.message}`, 500);
  }

  return {
    graphJson: {
      nodes,
      edges,
    },
  };
};
