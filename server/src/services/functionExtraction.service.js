import traverse from "@babel/traverse";
import { buildCFG } from "./cfgBuilder.service.js";
import { createFunctionId } from "../utils/projectStructureId.util.js";

/**
 * Extracts metadata for all functions found in a Babel AST.
 * @param {Object} ast - The Babel AST.
 * @param {string} filePath - The path of the file being analyzed.
 * @returns {Array} Array of FunctionMetadata objects.
 */
export const extractFunctions = (ast, filePath) => {
  if (!ast) return [];
  const functions = [];
  const add = (functionPath) => {
    functions.push(getFunctionMetadata(functionPath, functionPath.node.type, filePath));
  };

  traverse(ast, {
    FunctionDeclaration: add,
    FunctionExpression: add,
    ArrowFunctionExpression: add,
    ClassMethod: add,
    ObjectMethod: add,
  });

  return functions.sort((left, right) =>
    left.startLine - right.startLine || left.endLine - right.endLine || left.id.localeCompare(right.id),
  );
};

/**
 * Helper to extract metadata from a function node path.
 * @param {Object} path - The Babel path object.
 * @param {string} type - The type of function.
 * @param {string} filePath - The file path.
 * @returns {Object} FunctionMetadata object.
 */
const parameterName = (parameter) => {
  if (!parameter) return "pattern";
  if (parameter.type === "Identifier") return parameter.name;
  if (parameter.type === "RestElement") return `...${parameterName(parameter.argument)}`;
  if (parameter.type === "AssignmentPattern") return parameterName(parameter.left);
  return "pattern";
};

const assignmentName = (assignment) => {
  const left = assignment?.left;
  if (left?.type !== "MemberExpression") return null;
  const property = left.property;
  if (property?.type === "Identifier") return property.name;
  if (property?.type === "StringLiteral") return property.value;
  return null;
};

const isCommonJsExport = (assignment) => {
  const left = assignment?.left;
  if (left?.type !== "MemberExpression") return false;
  const object = left.object;
  return object?.name === "exports"
    || (object?.type === "MemberExpression" && object.object?.name === "module" && object.property?.name === "exports");
};

const findAssignment = (functionPath) => functionPath.findParent((ancestor) => ancestor.isAssignmentExpression?.());

const functionName = (functionPath) => {
  const node = functionPath.node;
  if (node.id?.name) return node.id.name;
  if (node.key) return getNameFromKey(node.key);
  const parent = functionPath.parentPath;
  if (parent?.isVariableDeclarator?.() && parent.node.id.type === "Identifier") return parent.node.id.name;
  if ((parent?.isObjectProperty?.() || parent?.isClassProperty?.()) && parent.node.key) return getNameFromKey(parent.node.key);
  const assignment = findAssignment(functionPath);
  return assignmentName(assignment?.node) || "anonymous";
};

const isExported = (functionPath) => {
  if (functionPath.findParent((ancestor) => ancestor.isExportNamedDeclaration?.() || ancestor.isExportDefaultDeclaration?.())) return true;
  return isCommonJsExport(findAssignment(functionPath)?.node);
};

const getFunctionMetadata = (functionPath, type, filePath) => {
  const node = functionPath.node;
  const name = functionName(functionPath);
  const isAnonymous = name === "anonymous";
  let controlFlow = { nodes: [], edges: [] };
  try { controlFlow = buildCFG(node).graphJson; } catch { /* Catalog remains usable if CFG generation cannot classify a construct. */ }

  return {
    id: createFunctionId(filePath, node.loc?.start.line, node.loc?.end.line, type),
    name,
    label: isAnonymous ? `anonymous@L${node.loc?.start.line ?? 0}` : name,
    type,
    filePath,
    startLine: node.loc?.start.line ?? null,
    endLine: node.loc?.end.line ?? null,
    parameters: (node.params || []).map(parameterName),
    async: !!node.async,
    generator: !!node.generator,
    exported: isExported(functionPath),
    isAnonymous,
    controlFlow,
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
