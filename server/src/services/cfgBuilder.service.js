import { ServiceError } from "../utils/serviceError.js";

/**
 * CFG Builder Service
 * Traverses an AST node and generates a Control Flow Graph.
 */

const createNode = (id, type) => ({ id, type });
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
    if (!node) return;

    switch (node.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        const startNode = createNode("start", "start");
        nodes.push(startNode);
        traverse(node.body, "start");
        break;

      case "BlockStatement":
        node.body.forEach((stmt) => traverse(stmt, parentId));
        break;

      case "IfStatement":
        const ifId = generateId("if");
        nodes.push(createNode(ifId, "condition"));
        edges.push(createEdge(parentId, ifId));

        traverse(node.consequent, ifId);
        if (node.alternate) {
          traverse(node.alternate, ifId);
        }
        break;

      case "ReturnStatement":
        const retId = generateId("return");
        nodes.push(createNode(retId, "return"));
        edges.push(createEdge(parentId, retId));
        break;

      case "ExpressionStatement":
      case "VariableDeclaration":
        const stmtId = generateId("stmt");
        nodes.push(createNode(stmtId, "statement"));
        edges.push(createEdge(parentId, stmtId));
        break;

      default:
        // Handle unsupported or generic nodes
        break;
    }
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
