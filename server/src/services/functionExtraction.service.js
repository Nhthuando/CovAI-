import traverse from "@babel/traverse";

/**
 * Extracts metadata for all functions found in a Babel AST.
 * @param {Object} ast - The Babel AST.
 * @param {string} filePath - The path of the file being analyzed.
 * @returns {Array} Array of FunctionMetadata objects.
 */
export const extractFunctions = (ast, filePath) => {
  if (!ast) return [];

  const functions = [];
  const processedNodes = new Set();

  try {
    traverse(ast, {
      FunctionDeclaration(path) {
        functions.push(
          getFunctionMetadata(path, "FunctionDeclaration", filePath),
        );
      },
      ArrowFunctionExpression(path) {
        if (processedNodes.has(path.node)) return;
        functions.push(
          getFunctionMetadata(path, "ArrowFunctionExpression", filePath),
        );
      },
      FunctionExpression(path) {
        if (processedNodes.has(path.node)) return;
        functions.push(
          getFunctionMetadata(path, "FunctionExpression", filePath),
        );
      },
      ClassMethod(path) {
        functions.push(getFunctionMetadata(path, "ClassMethod", filePath));
      },
      ObjectMethod(path) {
        functions.push(getFunctionMetadata(path, "ObjectMethod", filePath));
      },
      ClassProperty(path) {
        if (
          path.node.value &&
          (path.node.value.type === "ArrowFunctionExpression" ||
            path.node.value.type === "FunctionExpression")
        ) {
          processedNodes.add(path.node.value);
          functions.push(
            getFunctionMetadata(
              path.get("value"),
              path.node.value.type,
              filePath,
            ),
          );
        }
      },
      ObjectProperty(path) {
        if (
          path.node.value &&
          (path.node.value.type === "ArrowFunctionExpression" ||
            path.node.value.type === "FunctionExpression")
        ) {
          processedNodes.add(path.node.value);
          functions.push(
            getFunctionMetadata(
              path.get("value"),
              path.node.value.type,
              filePath,
            ),
          );
        }
      },
    });
  } catch (err) {
    console.error(`Error traversing AST in ${filePath}:`, err.message);
  }

  return functions;
};

/**
 * Helper to extract metadata from a function node path.
 * @param {Object} path - The Babel path object.
 * @param {string} type - The type of function.
 * @param {string} filePath - The file path.
 * @returns {Object} FunctionMetadata object.
 */
const getFunctionMetadata = (path, type, filePath) => {
  const node = path.node;
  let name = "anonymous";
  let isAnonymous = true;

  // Name extraction logic
  if (type === "FunctionDeclaration" && node.id) {
    name = node.id.name;
    isAnonymous = false;
  } else if (type === "ClassMethod" || type === "ObjectMethod") {
    name = getNameFromKey(node.key);
    isAnonymous = false;
  } else if (
    path.parent.type === "VariableDeclarator" &&
    path.parent.id.type === "Identifier"
  ) {
    name = path.parent.id.name;
    isAnonymous = false;
  } else if (
    path.parent.type === "ClassProperty" ||
    path.parent.type === "ObjectProperty"
  ) {
    name = getNameFromKey(path.parent.key);
    isAnonymous = false;
  } else if (
    path.parent.type === "CallExpression" ||
    path.parent.type === "NewExpression"
  ) {
    // Anonymous callback functions
    isAnonymous = true;
  }

  return {
    name,
    type,
    filePath,
    startLine: node.loc?.start.line ?? null,
    endLine: node.loc?.end.line ?? null,
    parameterCount: node.params?.length ?? 0,
    async: !!node.async,
    generator: !!node.generator,
    isAnonymous,
  };
};

/**
 * Helper to extract name from Identifier, StringLiteral, or Computed keys.
 */
const getNameFromKey = (key) => {
  if (!key) return "anonymous";
  switch (key.type) {
    case "Identifier":
      return key.name;
    case "StringLiteral":
      return key.value;
    case "NumericLiteral":
      return String(key.value);
    case "Computed": // Handles computed properties like ['name']
      if (key.key.type === "Identifier") return key.key.name;
      if (key.key.type === "StringLiteral") return key.key.value;
      if (key.key.type === "NumericLiteral") return String(key.key.value);
      return "anonymous";
    default:
      return "anonymous";
  }
};
