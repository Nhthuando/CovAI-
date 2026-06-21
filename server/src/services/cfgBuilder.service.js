import { ServiceError } from "../utils/serviceError.js";

/**
 * CFG Builder Service
 * Traverses an AST node and generates a Control Flow Graph.
 */

const createNode = (id, type, line = null) => ({ id, type, line });
const createEdge = (from, to, label = null) => ({ from, to, label });

export const buildCFG = (astNode, metadata = {}) => {
  if (!astNode || typeof astNode !== "object") {
    throw new ServiceError("Invalid AST node", 400);
  }

  const nodes = [];
  const edges = [];
  let nodeCounter = 0;

  const generateId = (prefix) => `${prefix}_${++nodeCounter}`;

  const traverse = (node, parentId = "start") => {
    if (!node || typeof node !== "object") return parentId;

    let currentId = parentId;
    const line = node.loc && node.loc.start ? node.loc.start.line : null;

    switch (node.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        const startNode = createNode("start", "start", line);
        nodes.push(startNode);
        traverse(node.body, "start");
        break;

      case "BlockStatement":
        let blockParent = parentId;
        if (node.body && Array.isArray(node.body)) {
          node.body.forEach((stmt) => {
            blockParent = traverse(stmt, blockParent) || blockParent;
          });
        }
        currentId = blockParent;
        break;

      case "IfStatement":
        const ifId = generateId("if");
        nodes.push(createNode(ifId, "condition", line));
        edges.push(createEdge(parentId, ifId));

        traverse(node.consequent, ifId);
        if (node.alternate) {
          traverse(node.alternate, ifId);
        }
        currentId = ifId; // Branches out, so returning ifId is okay for simplified CFG
        break;

      case "ReturnStatement":
        const retId = generateId("return");
        nodes.push(createNode(retId, "return", line));
        edges.push(createEdge(parentId, retId));
        currentId = retId;
        break;

      case "ExpressionStatement":
      case "VariableDeclaration":
      case "AwaitExpression":
        const stmtId = generateId("stmt");
        nodes.push(createNode(stmtId, "statement", line));
        edges.push(createEdge(parentId, stmtId));
        currentId = stmtId;
        break;

      case "TryStatement":
        const tryId = generateId("try");
        nodes.push(createNode(tryId, "statement", line));
        edges.push(createEdge(parentId, tryId));
        traverse(node.block, tryId);
        if (node.handler) {
          const catchLine = node.handler.loc?.start?.line || line;
          const catchId = generateId("catch");
          nodes.push(createNode(catchId, "condition", catchLine));
          edges.push(createEdge(tryId, catchId, "error"));
          traverse(node.handler.body, catchId);
        }
        if (node.finalizer) {
          const finallyLine = node.finalizer.loc?.start?.line || line;
          const finallyId = generateId("finally");
          nodes.push(createNode(finallyId, "statement", finallyLine));
          edges.push(createEdge(tryId, finallyId));
          traverse(node.finalizer, finallyId);
        }
        currentId = tryId;
        break;

      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        const loopId = generateId("loop");
        nodes.push(createNode(loopId, "condition", line));
        edges.push(createEdge(parentId, loopId));
        traverse(node.body, loopId);
        edges.push(createEdge(loopId, loopId, "next"));
        currentId = loopId;
        break;

      case "SwitchStatement":
        const switchId = generateId("switch");
        nodes.push(createNode(switchId, "condition", line));
        edges.push(createEdge(parentId, switchId));
        if (node.cases) {
          node.cases.forEach(c => {
            const caseLine = c.loc?.start?.line || line;
            const caseId = generateId("case");
            nodes.push(createNode(caseId, "condition", caseLine));
            edges.push(createEdge(switchId, caseId));
            if (c.consequent) {
              c.consequent.forEach(stmt => traverse(stmt, caseId));
            }
          });
        }
        currentId = switchId;
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
          edges.push(createEdge(parentId, fallbackId));
          genericId = fallbackId;
        }
        currentId = genericId;
        break;
    }
    return currentId;
  };

  try {
    traverse(astNode);
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
