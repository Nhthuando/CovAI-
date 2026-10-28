import { parse } from "@babel/parser";
import { ServiceError } from "../utils/serviceError.js";

const FORBIDDEN_IDENTIFIERS = ["eval"];
const FORBIDDEN_MODULES = ["child_process", "node:child_process"];
const FORBIDDEN_CALLS = ["process.exit", "fs.rmSync", "fs.rm", "rmdirSync"];

/**
 * Validates generated test code using Babel AST parser and checks for forbidden/dangerous APIs.
 *
 * @param {string} code - The JavaScript / TypeScript source code to validate
 * @returns {{ valid: boolean, ast: object }}
 * @throws {ServiceError} If syntax is invalid or dangerous APIs are present
 */
export const validateGeneratedTestCode = (code) => {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new ServiceError("Generated test code is empty", 422);
  }

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (error) {
    throw new ServiceError(
      `Generated test code has invalid JS/TS syntax: ${error.message}`,
      422,
    );
  }

  // Check AST nodes for forbidden imports and dangerous function calls
  const checkNode = (node) => {
    if (!node || typeof node !== "object") return;

    // Check imports: import ... from 'child_process'
    if (node.type === "ImportDeclaration" && node.source?.value) {
      if (FORBIDDEN_MODULES.includes(node.source.value)) {
        throw new ServiceError(
          `Generated test code contains forbidden module import: ${node.source.value}`,
          422,
        );
      }
    }

    // Check require: require('child_process')
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments?.[0]?.value &&
      FORBIDDEN_MODULES.includes(node.arguments[0].value)
    ) {
      throw new ServiceError(
        `Generated test code contains forbidden module require: ${node.arguments[0].value}`,
        422,
      );
    }

    // Check eval(...)
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      FORBIDDEN_IDENTIFIERS.includes(node.callee.name)
    ) {
      throw new ServiceError(
        `Generated test code contains forbidden call: ${node.callee.name}()`,
        422,
      );
    }

    // Check process.exit, fs.rmSync
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression"
    ) {
      const obj = node.callee.object?.name;
      const prop = node.callee.property?.name;
      const fullCall = `${obj}.${prop}`;
      if (FORBIDDEN_CALLS.includes(fullCall)) {
        throw new ServiceError(
          `Generated test code contains forbidden call: ${fullCall}()`,
          422,
        );
      }
    }

    // Recurse down AST
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) checkNode(item);
      } else if (child && typeof child === "object" && child.type) {
        checkNode(child);
      }
    }
  };

  checkNode(ast.program);

  return { valid: true, ast };
};
