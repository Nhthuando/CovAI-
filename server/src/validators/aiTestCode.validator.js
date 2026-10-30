import { parse } from "@babel/parser";
import { ServiceError } from "../utils/serviceError.js";
import {
  deduplicateAstDeclarations,
  inspectAstScopeDuplicates
} from "../services/testHelperRegistry.service.js";

const FORBIDDEN_IDENTIFIERS = ["eval"];
const FORBIDDEN_MODULES = ["child_process", "node:child_process"];
const FORBIDDEN_CALLS = ["process.exit", "fs.rmSync", "fs.rm", "rmdirSync"];

/**
 * Heals invalid dynamic getter declarations and replaces unnecessary getters
 * in mock factories with static, syntactically valid object properties.
 *
 * @param {string} code - Source test code to sanitize
 * @returns {string} Sanitized code
 */
export const healInvalidDynamicGetters = (code) => {
  if (!code || typeof code !== "string") return code;
  if (!code.includes("get ") && !code.includes("get(") && !code.includes("get (")) return code;

  let healed = code;

  // 1. Heal corrupted `get (typeof defaultExport === 'function' ? defaultExport : (() => {}))() { return <expr>; }`
  // Negative lookbehind (?<![\.\$\w]) guarantees method calls like app.get(...) or obj.get(...) are never matched!
  if (healed.includes("typeof defaultExport")) {
    healed = healed.replace(
      /(?<![\.\$\w])get\s*\(\s*typeof\s+defaultExport[\s\S]*?\)\s*\(\s*\)\s*\{\s*return\s+([\s\S]*?);?\s*\}/g,
      "default: $1"
    );
  }

  // 2. Heal any generic dynamic getter like `get (...)() { return <expr>; }`
  // Safe bounded scanner without nested repetition (ReDoS elimination)
  if (healed.includes("() { return") || healed.includes("(){\n") || healed.includes("() { \n") || healed.includes("() {\n")) {
    healed = healed.replace(
      /(?<![\.\$\w])get\s*\([^()\r\n]{1,200}\)\s*\(\s*\)\s*\{\s*return\s+([^;{}]+?);?\s*\}/g,
      "default: $1"
    );
  }

  // 3. Heal standalone getters inside mock factories / objects:
  // e.g. `get prisma() { return <expr>; }` -> `prisma: <expr>`
  // e.g. `get default() { return <expr>; }` -> `default: <expr>`
  healed = healed.replace(
    /(?<![\.\$\w])get\s+([a-zA-Z0-9_$]+)\s*\(\s*\)\s*\{\s*return\s+([^;{}]+?);?\s*\}/g,
    (match, propName, returnVal) => {
      const val = returnVal.trim();
      // Avoid replacing if return body contains statements or nested blocks
      if (
        val.includes("if ") ||
        val.includes("switch ") ||
        val.includes("for ") ||
        val.includes("function")
      ) {
        return match;
      }
      return `${propName}: ${val}`;
    }
  );

  return healed;
};

/**
 * Validates generated test code using Babel AST parser and returns structured errors.
 *
 * @param {string} code - The JavaScript / TypeScript source code to validate
 * @param {object} [options={}] - Validation options
 * @param {string} [options.filePath] - Target file path
 * @returns {{ valid: boolean, errors: Array<{ line: number, column: number, message: string, construct?: string, filePath?: string }>, ast: object | null }}
 */
export const validateTestCodeAst = (code, options = {}) => {
  const filePath = options.filePath || "generated.test.ts";
  const errors = [];

  if (!code || typeof code !== "string" || !code.trim()) {
    return {
      valid: false,
      errors: [
        {
          line: 1,
          column: 0,
          message: "Generated test code is empty",
          construct: "EmptyContent",
          filePath,
        },
      ],
      ast: null,
    };
  }

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: [
        "jsx",
        "typescript",
        "asyncGenerators",
        "dynamicImport",
        "exportDefaultFrom",
        "objectRestSpread",
      ],
      errorRecovery: true,
    });
  } catch (parseError) {
    return {
      valid: false,
      errors: [
        {
          line: parseError.loc?.line || 1,
          column: parseError.loc?.column || 0,
          message: parseError.message,
          construct: "SyntaxError",
          filePath,
        },
      ],
      ast: null,
    };
  }

  // Handle errors collected by errorRecovery mode
  if (ast.errors && ast.errors.length > 0) {
    for (const err of ast.errors) {
      errors.push({
        line: err.loc?.line || 1,
        column: err.loc?.column || 0,
        message: err.message,
        construct: "SyntaxError",
        filePath,
      });
    }
  }

  // Inspect AST nodes for security, syntax, and mock invariants
  const inspectNode = (node) => {
    if (!node || typeof node !== "object") return;

    // Check forbidden imports
    if (node.type === "ImportDeclaration" && node.source?.value) {
      if (FORBIDDEN_MODULES.includes(node.source.value)) {
        errors.push({
          line: node.loc?.start?.line || 1,
          column: node.loc?.start?.column || 0,
          message: `Forbidden module import: ${node.source.value}`,
          construct: "ForbiddenImport",
          filePath,
        });
      }
    }

    // Check require('child_process')
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments?.[0]?.value &&
      FORBIDDEN_MODULES.includes(node.arguments[0].value)
    ) {
      errors.push({
        line: node.loc?.start?.line || 1,
        column: node.loc?.start?.column || 0,
        message: `Forbidden module require: ${node.arguments[0].value}`,
        construct: "ForbiddenRequire",
        filePath,
      });
    }

    // Check eval(...)
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      FORBIDDEN_IDENTIFIERS.includes(node.callee.name)
    ) {
      errors.push({
        line: node.loc?.start?.line || 1,
        column: node.loc?.start?.column || 0,
        message: `Forbidden call: ${node.callee.name}()`,
        construct: "ForbiddenEval",
        filePath,
      });
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
        errors.push({
          line: node.loc?.start?.line || 1,
          column: node.loc?.start?.column || 0,
          message: `Forbidden call: ${fullCall}()`,
          construct: "ForbiddenCall",
          filePath,
        });
      }
    }

    // Check dynamic/computed getters
    if (
      (node.type === "ObjectMethod" || node.type === "ClassMethod") &&
      (node.kind === "get" || node.kind === "set")
    ) {
      if (node.computed) {
        if (
          node.key?.type === "ConditionalExpression" ||
          node.key?.type === "LogicalExpression" ||
          node.key?.type === "UnaryExpression" ||
          node.key?.type === "CallExpression"
        ) {
          errors.push({
            line: node.loc?.start?.line || 1,
            column: node.loc?.start?.column || 0,
            message: `Dynamic or conditional getter declarations are invalid: get [${node.key.type}]()`,
            construct: "DynamicGetter",
            filePath,
          });
        }
      }
    }

    // Check Jest/Vitest mock calls
    if (
      node.type === "CallExpression" &&
      node.callee &&
      node.callee.type === "MemberExpression" &&
      (node.callee.object?.name === "jest" || node.callee.object?.name === "vi") &&
      (node.callee.property?.name === "mock" ||
        node.callee.property?.name === "doMock" ||
        node.callee.property?.name === "unstable_mockModule")
    ) {
      const mockTargetArg = node.arguments[0];
      const factoryArg = node.arguments[1];

      // Module specifier must be string or template literal
      if (
        !mockTargetArg ||
        (mockTargetArg.type !== "StringLiteral" &&
          mockTargetArg.type !== "TemplateLiteral")
      ) {
        errors.push({
          line: node.loc?.start?.line || 1,
          column: node.loc?.start?.column || 0,
          message: "Mock module specifier must be a valid string literal",
          construct: "InvalidMockSpecifier",
          filePath,
        });
      }

      // Check factory argument if provided
      if (factoryArg) {
        if (
          factoryArg.type !== "ArrowFunctionExpression" &&
          factoryArg.type !== "FunctionExpression"
        ) {
          errors.push({
            line: factoryArg.loc?.start?.line || 1,
            column: factoryArg.loc?.start?.column || 0,
            message: "Mock factory must be a function expression or arrow function",
            construct: "InvalidMockFactory",
            filePath,
          });
        } else {
          // Check for getter declarations inside returned object literal
          const checkReturnedObject = (expr) => {
            if (!expr || expr.type !== "ObjectExpression") return;
            for (const prop of expr.properties) {
              if (prop.type === "ObjectMethod" && (prop.kind === "get" || prop.kind === "set")) {
                errors.push({
                  line: prop.loc?.start?.line || 1,
                  column: prop.loc?.start?.column || 0,
                  message: `Getter '${prop.key?.name || "dynamic"}' used in mock factory. Use static object property instead.`,
                  construct: "GetterInMockFactory",
                  filePath,
                });
              }
            }
          };

          if (factoryArg.body?.type === "ObjectExpression") {
            checkReturnedObject(factoryArg.body);
          } else if (factoryArg.body?.type === "BlockStatement") {
            for (const stmt of factoryArg.body.body) {
              if (stmt.type === "ReturnStatement" && stmt.argument) {
                checkReturnedObject(stmt.argument);
              }
            }
          }
        }
      }
    }

    // Recurse children
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) inspectNode(item);
      } else if (child && typeof child === "object" && child.type) {
        inspectNode(child);
      }
    }
  };

  inspectNode(ast.program);

  // Inspect lexical scope duplicate declarations across Program and describe blocks
  try {
    const scopeInspection = inspectAstScopeDuplicates(ast, code);
    if (scopeInspection.conflicts && scopeInspection.conflicts.length > 0) {
      for (const conf of scopeInspection.conflicts) {
        errors.push({
          line: conf.secondLoc?.line || 1,
          column: conf.secondLoc?.column || 0,
          message: `DuplicateDeclarationConflict: Identifier '${conf.name}' has conflicting implementations in the same scope. First declared at line ${conf.firstLoc?.line || 1}.`,
          construct: "DuplicateDeclarationConflict",
          filePath,
        });
      }
    }
  } catch (_) {}

  return {
    valid: errors.length === 0,
    errors,
    ast: errors.length === 0 ? ast : null,
  };
};

/**
 * Controlled auto-repair pipeline for generated test code syntax and mock errors.
 * Attempts up to maxAttempts to heal syntax, dynamic getters, and malformed mock factories.
 *
 * @param {string} code - Test code to repair
 * @param {object} [options={}] - Repair options
 * @param {number} [options.maxAttempts=3] - Maximum repair iterations
 * @param {string} [options.filePath] - Target file path
 * @returns {{ repaired: boolean, code: string, ast: object | null, errors: Array<object>, attempts: number }}
 */
export const autoRepairTestSyntaxWithAst = (code, options = {}) => {
  const maxAttempts = options.maxAttempts || 3;
  let currentCode = code;
  let attempts = 0;
  let lastErrors = [];

  while (attempts < maxAttempts) {
    attempts++;

    // 1. Initial AST validation
    const valResult = validateTestCodeAst(currentCode, options);
    if (valResult.valid) {
      return {
        repaired: true,
        code: currentCode,
        ast: valResult.ast,
        errors: [],
        attempts,
      };
    }

    lastErrors = valResult.errors;

    // 2. Perform targeted repairs
    let modified = false;

    // A. Deduplicate AST declarations across lexical scopes if duplicate declarations exist
    const hasDuplicateErrors = lastErrors.some(
      (e) => e.message?.includes("has already been declared") || e.construct === "DuplicateDeclarationConflict"
    );
    if (hasDuplicateErrors || currentCode.includes("_collectCallableMembers") || currentCode.includes("_collectControllerActions")) {
      const dedupResult = deduplicateAstDeclarations(currentCode, options);
      if (dedupResult.changed && dedupResult.code) {
        currentCode = dedupResult.code;
        modified = true;
      }
    }

    // B. Heal invalid dynamic getters & mock factory getters
    const healedGetters = healInvalidDynamicGetters(currentCode);
    if (healedGetters !== currentCode) {
      currentCode = healedGetters;
      modified = true;
    }

    // C. Heal illegal standalone default(...) calls without breaking get/set/export/case/import/.
    const healedDefaultCalls = currentCode.replace(
      /(?<!\b(?:get|set|export|case|import)\s*|[\.\$])\bdefault\s*\(/g,
      "(typeof defaultExport === 'function' ? defaultExport : (() => {}))("
    );
    if (healedDefaultCalls !== currentCode) {
      currentCode = healedDefaultCalls;
      modified = true;
    }

    // D. Clean consecutive commas
    if (currentCode.includes(",,") || /,\s*,+/.test(currentCode)) {
      currentCode = currentCode.replace(/,\s*,+/g, ", ");
      modified = true;
    }

    // E. Strip orphan semicolons and trailing closing parentheses
    const healedTrailing = currentCode.replace(/;\s*\)+;?/g, ";");
    if (healedTrailing !== currentCode) {
      currentCode = healedTrailing;
      modified = true;
    }

    // If no modifications could be made, stop early
    if (!modified && attempts > 1) {
      break;
    }
  }

  // Final validation check after attempts
  const finalVal = validateTestCodeAst(currentCode, options);
  return {
    repaired: finalVal.valid,
    code: currentCode,
    ast: finalVal.ast,
    errors: finalVal.errors,
    attempts,
  };
};

/**
 * Validates generated test code using Babel AST parser and checks for forbidden/dangerous APIs.
 * Preserved for backward-compatibility with existing callers.
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
      422
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
          422
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
        422
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
        422
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
          422
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
