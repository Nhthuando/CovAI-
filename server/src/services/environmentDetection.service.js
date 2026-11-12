import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { findLogicSourceFiles, findUnitFiles } from "./runTestsJob.service.js";
import { projectEditableWorkspaceRoot, readVersionedProjectFile } from "./projectFileVersion.service.js";
import { mutateProjectWorkspace } from "./projectMutation.service.js";
import prisma from "../config/prisma.js";
import { snapshotWorkspaceRoot } from "../utils/snapshotWorkspace.js";

const traverse = _traverse?.default || _traverse;
const generate = _generate?.default || _generate;

/**
 * Verifies whether the identifier 'process' in the given scope refers to the
 * legitimate Node.js process runtime rather than a shadowed parameter or local variable.
 */
export const isProcessIdentifierValid = (scope) => {
  if (!scope || typeof scope.hasBinding !== "function") return true;
  if (!scope.hasBinding("process")) return true;

  const binding = scope.getBinding("process");
  if (!binding) return false;

  // Legitimate ESM import: import process from "node:process" or "process";
  // or import * as process from "node:process";
  if (binding.kind === "module") {
    const parent = binding.path?.parent;
    if (parent?.type === "ImportDeclaration") {
      const source = parent.source?.value;
      if (source === "process" || source === "node:process") {
        return true;
      }
    }
  }

  // Legitimate CJS require: const process = require("node:process") or require("process");
  if (binding.path?.isVariableDeclarator?.()) {
    const init = binding.path.node.init;
    if (
      init?.type === "CallExpression" &&
      init.callee?.type === "Identifier" &&
      init.callee.name === "require" &&
      (init.arguments?.[0]?.value === "process" || init.arguments?.[0]?.value === "node:process")
    ) {
      return true;
    }
  }

  // Any other binding (param, const, let, var, catch, class) shadows global process
  return false;
};

/**
 * Checks if AST node represents `process.env` or `process?.env`,
 * verifying that `process` is not shadowed by a local binding or parameter.
 */
export const isProcessEnvNode = (node, scope = null) => {
  if (!node) return false;
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return false;
  const obj = node.object;
  const prop = node.property;
  if (obj?.type === "Identifier" && obj.name === "process") {
    if (scope && !isProcessIdentifierValid(scope)) {
      return false;
    }
    if (!node.computed && prop?.type === "Identifier" && prop.name === "env") return true;
    if (node.computed && prop?.type === "StringLiteral" && prop.value === "env") return true;
  }
  return false;
};

/**
 * Unwraps TypeScript type assertions, satisfies expressions, and parenthesized expressions
 */
export const unwrapTsAndParens = (node) => {
  let curr = node;
  while (
    curr &&
    (curr.type === "TSAsExpression" ||
      curr.type === "TSTypeAssertion" ||
      curr.type === "TSNonNullExpression" ||
      curr.type === "TSSatisfiesExpression" ||
      curr.type === "ParenthesizedExpression" ||
      curr.type === "TypeCastExpression")
  ) {
    curr = curr.expression;
  }
  return curr;
};

/**
 * Recursively unwraps TypeScript casts, parenthesized expressions, and logical fallback operators (||, ??).
 */
export const unwrapTsAndLogical = (node) => {
  let curr = unwrapTsAndParens(node);
  let changed = true;
  while (curr && changed) {
    changed = false;
    if (
      curr.type === "LogicalExpression" &&
      (curr.operator === "||" || curr.operator === "??")
    ) {
      curr = unwrapTsAndParens(curr.left);
      changed = true;
    }
  }
  return curr;
};

/**
 * Verifies if node represents the global unshadowed `process` object
 */
export const isProcessNode = (node, scope = null) => {
  if (!node) return false;
  const unwrapped = unwrapTsAndParens(node);
  if (unwrapped?.type === "Identifier" && unwrapped.name === "process") {
    return isProcessIdentifierValid(scope);
  }
  return false;
};

/**
 * Checks if node is an identifier aliased to `process.env` (through local declaration or function parameter)
 */
export const isEnvObjectOrAlias = (node, scope, depth = 0) => {
  if (!node || depth > 5) return false;
  const unwrapped = unwrapTsAndLogical(node);
  if (!unwrapped) return false;

  if (isProcessEnvNode(unwrapped, scope)) return true;
  if (unwrapped.type !== "Identifier" || !scope) return false;

  const binding = scope.getBinding(unwrapped.name);
  if (!binding) return false;
  const decl = binding.path.node;

  // 1. const myEnv = process.env; or const { env } = process;
  if (decl?.type === "VariableDeclarator") {
    if (decl.id?.type === "ObjectPattern" && isProcessNode(decl.init, binding.path.scope)) {
      const match = decl.id.properties.find(
        (p) =>
          p.type === "ObjectProperty" &&
          !p.computed &&
          p.key?.type === "Identifier" &&
          p.key.name === "env" &&
          ((p.value?.type === "Identifier" && p.value.name === unwrapped.name) ||
            (p.value?.type === "AssignmentPattern" && p.value.left?.name === unwrapped.name))
      );
      if (match) return true;
    }
    return isEnvObjectOrAlias(decl.init, binding.path.scope, depth + 1);
  }

  // 2. AssignmentPattern (e.g. parameter: function fn(env = process.env))
  if (decl?.type === "AssignmentPattern") {
    if (decl.left?.type === "Identifier" && decl.left.name === unwrapped.name) {
      return isEnvObjectOrAlias(decl.right, binding.path.scope, depth + 1);
    }
    // function fn({ env = process.env } = {})
    if (decl.left?.type === "ObjectPattern") {
      const match = decl.left.properties.find(
        (p) =>
          p.type === "ObjectProperty" &&
          p.value?.type === "AssignmentPattern" &&
          p.value.left?.name === unwrapped.name
      );
      if (match) {
        return isEnvObjectOrAlias(match.value.right, binding.path.scope, depth + 1);
      }
    }
  }

  // 3. ObjectPattern without outer default: function fn({ env = process.env })
  if (decl?.type === "ObjectPattern") {
    const match = decl.properties.find(
      (p) =>
        p.type === "ObjectProperty" &&
        p.value?.type === "AssignmentPattern" &&
        p.value.left?.name === unwrapped.name
    );
    if (match) {
      return isEnvObjectOrAlias(match.value.right, binding.path.scope, depth + 1);
    }
  }

  // 4. Parameter binding directly
  if (binding.path.isAssignmentPattern()) {
    if (binding.path.node.left?.name === unwrapped.name) {
      return isEnvObjectOrAlias(binding.path.node.right, binding.path.scope, depth + 1);
    }
  }

  return false;
};

/**
 * Extracts static property name from MemberExpression or OptionalMemberExpression
 */
export const extractPropertyName = (node) => {
  if (!node) return null;
  if (!node.computed && node.property?.type === "Identifier") {
    return node.property.name;
  }
  if (node.computed) {
    if (node.property?.type === "StringLiteral") return node.property.value;
    if (
      node.property?.type === "TemplateLiteral" &&
      node.property.quasis.length === 1 &&
      node.property.expressions.length === 0
    ) {
      return node.property.quasis[0].value.cooked;
    }
  }
  return null;
};

/**
 * Unwraps TypeScript type assertions, satisfies expressions, and parenthesized expressions
 */
export const getEffectiveParentPath = (path) => {
  let current = path?.parentPath;
  while (
    current &&
    (current.isTSAsExpression?.() ||
      current.isTSTypeAssertion?.() ||
      current.isTSNonNullExpression?.() ||
      current.isTSSatisfiesExpression?.() ||
      current.isParenthesizedExpression?.() ||
      current.isTypeCastExpression?.())
  ) {
    current = current.parentPath;
  }
  return current;
};

/**
 * Extracts literal or formatted default string representation from AST node
 */
export const extractDefaultValueFromNode = (node) => {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "NumericLiteral") return String(node.value);
  if (node.type === "BooleanLiteral") return String(node.value);
  if (node.type === "NullLiteral") return "null";
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.raw ?? node.quasis[0]?.value?.cooked ?? null;
  }
  if (node.type === "UnaryExpression" && (node.operator === "-" || node.operator === "+")) {
    if (node.argument?.type === "NumericLiteral") {
      return `${node.operator}${node.argument.value}`;
    }
  }
  if (node.type === "Identifier") {
    if (node.name === "undefined") return null;
    return node.name;
  }
  try {
    return generate(node).code;
  } catch {
    return null;
  }
};

/**
 * Unwraps right-hand chains of logical expressions (||, ??) and TS casts
 * to locate the final fallback operand at the end of the chain.
 */
export const getTerminalRightNode = (node) => {
  let curr = node;
  while (curr) {
    if (
      curr.type === "TSAsExpression" ||
      curr.type === "TSTypeAssertion" ||
      curr.type === "TSNonNullExpression" ||
      curr.type === "TSSatisfiesExpression" ||
      curr.type === "ParenthesizedExpression" ||
      curr.type === "TypeCastExpression"
    ) {
      curr = curr.expression;
      continue;
    }
    if (curr.type === "LogicalExpression" && (curr.operator === "||" || curr.operator === "??")) {
      curr = curr.right;
      continue;
    }
    break;
  }
  return curr;
};

/**
 * Checks whether an AST node is a reference to a process.env member or alias.
 */
export const isProcessEnvReference = (node, scope = null) => {
  if (!node) return false;
  const unwrapped = unwrapTsAndLogical(node);
  if (!unwrapped) return false;

  // MemberExpression: process.env.VAR or env.VAR
  if (unwrapped.type === "MemberExpression" || unwrapped.type === "OptionalMemberExpression") {
    return isEnvObjectOrAlias(unwrapped.object, scope);
  }

  // Identifier aliasing process.env or process.env.VAR
  if (unwrapped.type === "Identifier" && scope) {
    if (isEnvObjectOrAlias(unwrapped, scope)) return true;
    const binding = scope.getBinding(unwrapped.name);
    if (binding) {
      const decl = binding.path.node;
      if (decl?.type === "VariableDeclarator" && decl.init) {
        return isProcessEnvReference(decl.init, binding.path.scope);
      }
    }
  }

  return false;
};

/**
 * Critical environment variable name keywords
 */
export const CRITICAL_ENV_REGEX =
  /^(?:DATABASE_URL|DB_URL|DB_CONNECTION|MONGO(?:DB)?_URI|MONGO(?:DB)?_URL|REDIS_URL|REDIS_HOST|POSTGRES(?:QL)?_URL|MYSQL_URL|DB_PASSWORD|PGPASSWORD|PGHOST|PGUSER|PGDATABASE|JWT_SECRET|AUTH_SECRET|SESSION_SECRET|SECRET_KEY|ENCRYPTION_KEY|COOKIE_SECRET|ACCESS_TOKEN_SECRET|REFRESH_TOKEN_SECRET|NEXTAUTH_SECRET|STRIPE_SECRET_KEY|STRIPE_KEY|STRIPE_API_KEY|PAYPAL_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY)$/i;

/**
 * Checks whether an environment variable is critical to startup / execution
 */
export const isCriticalEnvironmentVariable = (name, callContext = null) => {
  if (!name || typeof name !== "string") return false;
  if (CRITICAL_ENV_REGEX.test(name.trim())) return true;
  if (callContext && typeof callContext === "string") {
    if (/^(?:jwt\.sign|jwt\.verify|bcrypt|crypto\.createHmac)$/i.test(callContext)) return true;
    if (/(?:mongoose\.connect|PrismaClient|Stripe|OpenAI)/i.test(callContext)) return true;
  }
  return false;
};

/**
 * Walks up the logical expression tree to find the right-side fallback in `||` or `??`
 */
export const findLogicalFallbackNode = (path) => {
  let curr = path;
  let effectiveParent = getEffectiveParentPath(curr);
  while (effectiveParent && effectiveParent.isLogicalExpression()) {
    const op = effectiveParent.node.operator;
    if (op === "||" || op === "??") {
      if (effectiveParent.node.left === curr.node || effectiveParent.get("left").isAncestor(curr)) {
        let outer = effectiveParent;
        let rightNode = outer.node.right;
        while (outer.parentPath?.isLogicalExpression?.()) {
          const outerOp = outer.parentPath.node.operator;
          if (
            (outerOp === "||" || outerOp === "??") &&
            (outer.parentPath.node.left === outer.node || outer.parentPath.get("left").isAncestor(outer))
          ) {
            outer = outer.parentPath;
            rightNode = outer.node.right;
          } else {
            break;
          }
        }

        // Locate the terminal right operand in the chain
        const terminal = getTerminalRightNode(rightNode);

        // If the terminal right operand is another environment variable,
        // it cannot serve as a literal default value.
        if (isProcessEnvReference(terminal, path.scope)) {
          return null;
        }

        return terminal;
      }
    }
    curr = effectiveParent;
    effectiveParent = getEffectiveParentPath(curr);
  }
  return null;
};

/**
 * Checks whether a member expression has any fallback expression (||, ??, ternary)
 */
export const hasFallbackExpression = (nodePath) => {
  let curr = nodePath;
  while (curr && curr.parentPath) {
    const parent = curr.parentPath;
    if (parent.isLogicalExpression()) {
      const op = parent.node.operator;
      if (op === "||" || op === "??") {
        if (parent.node.left === curr.node || parent.get("left").isAncestor(curr)) {
          return true;
        }
      }
    }
    if (parent.isConditionalExpression()) {
      if (parent.node.test === curr.node || parent.get("test").isAncestor(curr)) {
        return true;
      }
      if (parent.node.alternate === curr.node || parent.get("alternate").isAncestor(curr)) {
        if (parent.node.test?.type === "UnaryExpression" && parent.node.test.operator === "!") {
          return true;
        }
      }
    }
    if (parent.isStatement()) break;
    curr = parent;
  }
  return false;
};

/**
 * Extracts variable names from an AST test expression
 */
const extractVarNamesFromNode = (node, scope = null) => {
  const names = [];
  if (!node) return names;
  if (isProcessEnvNode(node.object, scope) || isEnvObjectOrAlias(node.object, scope)) {
    const name = extractPropertyName(node);
    if (name) names.push(name);
  }
  if (node.type === "UnaryExpression" && node.argument) {
    names.push(...extractVarNamesFromNode(node.argument, scope));
  }
  if (node.type === "BinaryExpression") {
    names.push(...extractVarNamesFromNode(node.left, scope), ...extractVarNamesFromNode(node.right, scope));
  }
  return names;
};

/**
 * Determines if an AST reference path is part of an "is-missing" condition check:
 * 1. !process.env.VAR
 * 2. process.env.VAR === undefined / == null
 * 3. undefined === process.env.VAR / null == process.env.VAR (Yoda)
 * 4. typeof process.env.VAR === "undefined" / "undefined" === typeof process.env.VAR
 */
export const detectMissingEnvCondition = (path) => {
  const effectiveParent = getEffectiveParentPath(path);
  if (!effectiveParent) return null;

  // 1. Negation: !process.env.VAR
  if (effectiveParent.isUnaryExpression() && effectiveParent.node.operator === "!") {
    return effectiveParent;
  }

  // 2. Binary equality with null or undefined (both standard and Yoda orders)
  if (effectiveParent.isBinaryExpression()) {
    const op = effectiveParent.node.operator;
    if (op === "==" || op === "===") {
      const leftNode = unwrapTsAndParens(effectiveParent.node.left);
      const rightNode = unwrapTsAndParens(effectiveParent.node.right);

      const isNil = (n) =>
        n?.type === "NullLiteral" ||
        (n?.type === "Identifier" && n.name === "undefined") ||
        (n?.type === "UnaryExpression" && n.operator === "void");

      if (isNil(rightNode) || isNil(leftNode)) {
        return effectiveParent;
      }
    }
  }

  // 3. typeof check: typeof process.env.VAR === "undefined"
  if (effectiveParent.isUnaryExpression() && effectiveParent.node.operator === "typeof") {
    const typeofParent = getEffectiveParentPath(effectiveParent);
    if (typeofParent && typeofParent.isBinaryExpression()) {
      const op = typeofParent.node.operator;
      if (op === "==" || op === "===") {
        const leftNode = unwrapTsAndParens(typeofParent.node.left);
        const rightNode = unwrapTsAndParens(typeofParent.node.right);
        if (
          (rightNode?.type === "StringLiteral" && rightNode.value === "undefined") ||
          (leftNode?.type === "StringLiteral" && leftNode.value === "undefined")
        ) {
          return typeofParent;
        }
      }
    }
  }

  return null;
};

/**
 * Ascends from a condition node through compound LogicalExpression ('||')
 * to locate the enclosing IfStatement test
 */
export const findEnclosingIfGuard = (condPath) => {
  let curr = condPath;
  while (curr && curr.parentPath) {
    const parent = curr.parentPath;
    if (parent.isIfStatement()) {
      if (parent.node.test === curr.node || parent.get("test").isAncestor(curr)) {
        return parent.node;
      }
      return null;
    }
    if (parent.isLogicalExpression()) {
      if (parent.node.operator === "||") {
        curr = parent;
        continue;
      }
      // If connected by '&&', missing this variable alone does not trigger the consequent
      return null;
    }
    if (
      parent.isParenthesizedExpression?.() ||
      parent.isTSAsExpression?.() ||
      parent.isTSTypeAssertion?.() ||
      parent.isTSNonNullExpression?.() ||
      parent.isTSSatisfiesExpression?.()
    ) {
      curr = parent;
      continue;
    }
    break;
  }
  return null;
};

/**
 * Checks if an expression node invokes process.exit(...) or process.abort(...)
 */
export const isExitOrAbortCall = (exprNode) => {
  if (!exprNode) return false;
  const unwrapped = unwrapTsAndParens(exprNode);
  if (unwrapped.type !== "CallExpression" && unwrapped.type !== "OptionalCallExpression") return false;
  const callee = unwrapped.callee;
  if (!callee) return false;
  if (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") {
    const obj = callee.object;
    const prop = callee.property;
    if (obj?.type === "Identifier" && obj.name === "process") {
      const propName = !callee.computed && prop?.type === "Identifier" ? prop.name : null;
      if (propName === "exit" || propName === "abort") return true;
    }
  }
  return false;
};

/**
 * Checks if a statement represents a mandatory guard termination (throw, process.exit, or return process.exit)
 */
export const isThrowOrExitStatement = (stmt) => {
  if (!stmt) return false;
  if (stmt.type === "ThrowStatement") return true;
  if (stmt.type === "ExpressionStatement") {
    return isExitOrAbortCall(stmt.expression);
  }
  if (stmt.type === "ReturnStatement") {
    let arg = stmt.argument;
    if (!arg) return false;
    if (arg.type === "UnaryExpression" && arg.operator === "void") {
      arg = arg.argument;
    }
    return isExitOrAbortCall(arg);
  }
  return false;
};

/**
 * Verifies whether the left side of an assignment matches the target variable name
 */
export const isTargetMatchingVar = (targetNode, varName, scope) => {
  if (!targetNode) return false;
  const unwrapped = unwrapTsAndParens(targetNode);
  if (unwrapped.type === "Identifier") {
    return unwrapped.name === varName;
  }
  if (unwrapped.type === "MemberExpression" || unwrapped.type === "OptionalMemberExpression") {
    if (isProcessEnvNode(unwrapped.object, scope) || isEnvObjectOrAlias(unwrapped.object, scope)) {
      return extractPropertyName(unwrapped) === varName;
    }
  }
  return false;
};

/**
 * Analyzes fallback and guard clause patterns for a single AST reference
 */
export const analyzeReferenceFallbackAndGuard = (path, varName, relFilePath = "") => {
  const line = path.node?.loc?.start?.line || 1;
  const parentPath = getEffectiveParentPath(path);
  const parent = parentPath?.node;

  // 1. Logical fallback: process.env.VAR || 'default' or process.env.VAR ?? 'default'
  const fallbackRight = findLogicalFallbackNode(path);
  if (fallbackRight) {
    const defVal = extractDefaultValueFromNode(fallbackRight);
    if (defVal !== null && defVal !== "undefined") {
      return {
        name: varName,
        line,
        file: relFilePath,
        hasDefault: true,
        defaultValue: defVal,
        required: false,
        guardType: "logical_fallback",
      };
    }
  }

  // 2. Logical assignment: process.env.VAR ||= 'default', ??=
  if (parent?.type === "AssignmentExpression" && (parent.operator === "||=" || parent.operator === "??=")) {
    if (parent.left === path.node || parentPath.get("left").isAncestor(path)) {
      const terminal = getTerminalRightNode(parent.right);
      if (!isProcessEnvReference(terminal, path.scope)) {
        const defVal = extractDefaultValueFromNode(terminal);
        if (defVal !== null && defVal !== "undefined") {
          return {
            name: varName,
            line,
            file: relFilePath,
            hasDefault: true,
            defaultValue: defVal,
            required: false,
            guardType: "logical_assignment",
          };
        }
      }
    }
  }

  // 3. Conditional / Ternary: process.env.VAR ? process.env.VAR : 'default'
  let condParentPath = parentPath;
  if ((condParentPath?.isUnaryExpression?.() || condParentPath?.node?.type === "UnaryExpression") && condParentPath.node?.operator === "!") {
    condParentPath = getEffectiveParentPath(condParentPath);
  }
  if (condParentPath?.isConditionalExpression?.() || condParentPath?.node?.type === "ConditionalExpression") {
    const condNode = condParentPath.node;
    if (condNode.test === path.node || condParentPath.get("test").isAncestor(path)) {
      if (condNode.test?.type === "UnaryExpression" && condNode.test.operator === "!") {
        const defVal = extractDefaultValueFromNode(condNode.consequent);
        return {
          name: varName,
          line,
          file: relFilePath,
          hasDefault: true,
          defaultValue: defVal,
          required: false,
          guardType: "ternary_negated",
        };
      }
      const defVal = extractDefaultValueFromNode(condNode.alternate);
      return {
        name: varName,
        line,
        file: relFilePath,
        hasDefault: true,
        defaultValue: defVal,
        required: false,
        guardType: "ternary_test",
      };
    }
    if (condNode.consequent === path.node || condParentPath.get("consequent").isAncestor(path)) {
      const testNames = extractVarNamesFromNode(condNode.test, path.scope);
      if (testNames.includes(varName)) {
        const defVal = extractDefaultValueFromNode(condNode.alternate);
        return {
          name: varName,
          line,
          file: relFilePath,
          hasDefault: true,
          defaultValue: defVal,
          required: false,
          guardType: "ternary_guarded_consequent",
        };
      }
    }
    if (condNode.alternate === path.node || condParentPath.get("alternate").isAncestor(path)) {
      if (condNode.test?.type === "UnaryExpression" && condNode.test.operator === "!") {
        const testNames = extractVarNamesFromNode(condNode.test, path.scope);
        if (testNames.includes(varName)) {
          const defVal = extractDefaultValueFromNode(condNode.consequent);
          return {
            name: varName,
            line,
            file: relFilePath,
            hasDefault: true,
            defaultValue: defVal,
            required: false,
            guardType: "ternary_negated_alternate",
          };
        }
      }
    }
  }

  // 4. Guard clauses in IfStatement: if (!process.env.VAR) ...
  const condPath = detectMissingEnvCondition(path);
  if (condPath) {
    const ifParent = findEnclosingIfGuard(condPath);
    if (ifParent) {
      const stmts = ifParent.consequent.type === "BlockStatement"
        ? ifParent.consequent.body
        : [ifParent.consequent];

      const throwsOrExits = stmts.some(isThrowOrExitStatement);
      if (throwsOrExits) {
        return {
          name: varName,
          line,
          file: relFilePath,
          hasDefault: false,
          defaultValue: null,
          required: true,
          guardType: "guard_throw_mandatory",
        };
      }

      const fallbackAssign = stmts.find((s) => {
        if (s.type === "ExpressionStatement") {
          const expr = s.expression;
          if (expr?.type === "AssignmentExpression" && expr.operator === "=") {
            return isTargetMatchingVar(expr.left, varName, path.scope);
          }
        }
        return false;
      });

      if (fallbackAssign) {
        const defVal = extractDefaultValueFromNode(fallbackAssign.expression.right);
        return {
          name: varName,
          line,
          file: relFilePath,
          hasDefault: true,
          defaultValue: defVal,
          required: false,
          guardType: "guard_assign_fallback",
        };
      }
    }
  }

  // 5. Assertion calls: assert(process.env.VAR) or assert.ok(process.env.VAR)
  const callParent = path.findParent((p) => p.isCallExpression());
  if (callParent) {
    const callee = callParent.node.callee;
    if (callee.name === "assert" || (callee.object?.name === "assert" && callee.property?.name === "ok")) {
      return {
        name: varName,
        line,
        file: relFilePath,
        hasDefault: false,
        defaultValue: null,
        required: true,
        guardType: "assert_guard",
      };
    }
    const callContext =
      callee.name ||
      (callee.object && callee.property ? `${callee.object.name || callee.object.type}.${callee.property.name}` : null);
    if (isCriticalEnvironmentVariable(varName, callContext)) {
      return {
        name: varName,
        line,
        file: relFilePath,
        hasDefault: false,
        defaultValue: null,
        required: true,
        guardType: "critical_operation_call",
      };
    }
  }

  // 6. Unadorned reference
  const critical = isCriticalEnvironmentVariable(varName);
  return {
    name: varName,
    line,
    file: relFilePath,
    hasDefault: false,
    defaultValue: null,
    required: critical,
    guardType: critical ? "critical_unadorned" : "unadorned_reference",
  };
};

/**
 * Extracts environment variable references from code AST
 */
export const extractEnvReferencesFromAst = (ast, relFilePath = "") => {
  const references = [];

  const processObjectPatternProperties = (pattern, isDefaulted = false) => {
    if (!pattern || pattern.type !== "ObjectPattern") return;
    for (const prop of pattern.properties) {
      if (prop.type === "RestElement") continue;
      if (prop.type !== "ObjectProperty") continue;

      // 1. Recursive nested ObjectPattern: { server: { port = 3000 } }
      if (prop.value?.type === "ObjectPattern") {
        processObjectPatternProperties(prop.value, isDefaulted);
        continue;
      }

      // 2. Recursive nested ObjectPattern with container default: { server: { port = 3000 } = {} }
      if (prop.value?.type === "AssignmentPattern" && prop.value.left?.type === "ObjectPattern") {
        processObjectPatternProperties(prop.value.left, isDefaulted);
        continue;
      }

      // 3. Leaf property: extract environment variable name
      let name = null;
      if (!prop.computed && prop.key.type === "Identifier") name = prop.key.name;
      else if (prop.key.type === "StringLiteral") name = prop.key.value;
      else if (
        prop.key.type === "TemplateLiteral" &&
        prop.key.quasis.length === 1 &&
        prop.key.expressions.length === 0
      ) {
        name = prop.key.quasis[0].value.cooked;
      }

      if (name && /^[A-Za-z_]\w*$/.test(name)) {
        const isAssignment = prop.value?.type === "AssignmentPattern";
        const hasDefault = isDefaulted || isAssignment;
        const defaultValue = isAssignment ? extractDefaultValueFromNode(prop.value.right) : null;
        const critical = isCriticalEnvironmentVariable(name);

        references.push({
          name,
          hasDefault,
          defaultValue,
          required: hasDefault ? false : critical,
          guardType: hasDefault ? "destructuring_default" : (critical ? "critical_unadorned" : "unadorned_reference"),
          line: prop.loc?.start?.line || 1,
          file: relFilePath,
        });
      }
    }
  };

  const processDirectProcessPattern = (pattern) => {
    if (!pattern || pattern.type !== "ObjectPattern") return;
    for (const prop of pattern.properties) {
      if (prop.type !== "ObjectProperty") continue;
      let keyName = null;
      if (!prop.computed && prop.key.type === "Identifier") keyName = prop.key.name;
      else if (prop.key.type === "StringLiteral") keyName = prop.key.value;

      if (keyName === "env") {
        if (prop.value?.type === "ObjectPattern") {
          processObjectPatternProperties(prop.value, false);
        } else if (prop.value?.type === "AssignmentPattern" && prop.value.left?.type === "ObjectPattern") {
          processObjectPatternProperties(prop.value.left, false);
        }
      }
    }
  };

  traverse(ast, {
    // 1. Direct & computed member expressions
    "MemberExpression|OptionalMemberExpression"(path) {
      if (isEnvObjectOrAlias(path.node.object, path.scope)) {
        const name = extractPropertyName(path.node);
        if (name && /^[A-Za-z_]\w*$/.test(name)) {
          const analysis = analyzeReferenceFallbackAndGuard(path, name, relFilePath);
          references.push(analysis);
        }
      }
    },

    // 2. Destructuring declaration: const { PORT = 3000, DB_USER } = process.env;
    //    Also supports const { env: { PORT } } = process;
    VariableDeclarator(path) {
      const init = unwrapTsAndLogical(path.node.init);
      if (path.node.id?.type === "ObjectPattern") {
        if (isEnvObjectOrAlias(init, path.scope)) {
          processObjectPatternProperties(path.node.id, false);
        } else if (isProcessNode(init, path.scope)) {
          processDirectProcessPattern(path.node.id);
        }
      }
    },

    // 3. Destructuring assignment: ({ PORT = 3000 } = process.env);
    AssignmentExpression(path) {
      const right = unwrapTsAndLogical(path.node.right);
      if (path.node.left?.type === "ObjectPattern") {
        if (isEnvObjectOrAlias(right, path.scope)) {
          processObjectPatternProperties(path.node.left, false);
        } else if (isProcessNode(right, path.scope)) {
          processDirectProcessPattern(path.node.left);
        }
      }
    },

    // 4. Function parameter destructuring: function({ PORT = 3000 } = process.env)
    AssignmentPattern(path) {
      const right = unwrapTsAndLogical(path.node.right);
      if (path.node.left?.type === "ObjectPattern") {
        if (isEnvObjectOrAlias(right, path.scope)) {
          processObjectPatternProperties(path.node.left, false);
        } else if (isProcessNode(right, path.scope)) {
          processDirectProcessPattern(path.node.left);
        }
      }
    },
  });

  return references;
};

/**
 * Merges multi-file and multi-reference instances of a variable
 */
export const mergeVariableReferences = (
  varName,
  references = [],
  existingEnv = {},
  generateHermeticMock = null
) => {
  const isDefined = Boolean(
    existingEnv[varName] !== undefined &&
      existingEnv[varName] !== null &&
      String(existingEnv[varName]).trim().length > 0
  );
  const hasThrowGuard = references.some(
    (r) => r.guardType === "guard_throw_mandatory" || r.guardType === "assert_guard"
  );
  const anyRefHasDefault = references.some((r) => r.hasDefault);
  const allRefsHaveDefault = references.length > 0 && references.every((r) => r.hasDefault);
  const critical =
    isCriticalEnvironmentVariable(varName) ||
    references.some((r) => r.guardType === "critical_operation_call");

  const defaultRef = references.find((r) => r.defaultValue != null && String(r.defaultValue).trim() !== "");
  const explicitDefault = defaultRef ? defaultRef.defaultValue : null;

  let required = false;
  let hasDefault = false;

  if (hasThrowGuard || (critical && !allRefsHaveDefault)) {
    required = true;
    hasDefault = false;
  } else if (allRefsHaveDefault || (anyRefHasDefault && !critical)) {
    required = false;
    hasDefault = true;
  } else {
    required = false;
    hasDefault = false;
  }

  const fallbackMock = generateHermeticMock ? generateHermeticMock(varName) : inferMockValue(varName);
  const inferredMock = explicitDefault || fallbackMock;

  const seenRefs = new Set();
  const dedupedReferences = [];
  for (const r of references) {
    const key = `${r.file}:${r.line}`;
    if (!seenRefs.has(key)) {
      seenRefs.add(key);
      dedupedReferences.push({ file: r.file || "", line: r.line || 1 });
    }
  }

  return {
    name: varName,
    isDefined,
    required,
    hasDefault,
    inferredMock,
    references: dedupedReferences,
  };
};

/**
 * Lossless .env AST Tokenizer
 */
export const parseEnv = (content) => {
  if (typeof content !== "string" || content === "") return { entries: [], variables: {} };

  const lines = content.split(/\r?\n/);
  const entries = [];
  const variables = {};

  let i = 0;
  while (i < lines.length) {
    const startLineIdx = i;
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Blank line
    if (!trimmed) {
      entries.push({ type: "empty", raw: line });
      i++;
      continue;
    }

    // 2. Full line comment
    if (trimmed.startsWith("#")) {
      entries.push({ type: "comment", raw: line });
      i++;
      continue;
    }

    // 3. Key-Value pair
    let lineToParse = trimmed;
    let exportPrefix = false;
    if (/^export\s+/.test(lineToParse)) {
      exportPrefix = true;
      lineToParse = lineToParse.replace(/^export\s+/, "");
    }

    const eqIdx = lineToParse.indexOf("=");
    if (eqIdx === -1) {
      entries.push({ type: "raw", raw: line });
      i++;
      continue;
    }

    const rawKey = lineToParse.slice(0, eqIdx).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawKey)) {
      entries.push({ type: "raw", raw: line });
      i++;
      continue;
    }

    const rest = lineToParse.slice(eqIdx + 1).trim();
    let value = "";
    let quote = null;
    let inlineComment = null;

    if (rest.startsWith('"')) {
      quote = '"';
      let accumulated = rest.slice(1);
      let foundClose = false;
      let closeIdx = -1;

      while (true) {
        for (let c = 0; c < accumulated.length; c++) {
          if (accumulated[c] === '"') {
            let backslashes = 0;
            for (let b = c - 1; b >= 0 && accumulated[b] === "\\"; b--) {
              backslashes++;
            }
            if (backslashes % 2 === 0) {
              closeIdx = c;
              foundClose = true;
              break;
            }
          }
        }
        if (foundClose) {
          // Unescape backslash escapes in a single pass to prevent exponential expansion and collision
          value = accumulated.slice(0, closeIdx).replace(/\\([\\"nrt])/g, (_, ch) => {
            switch (ch) {
              case "\\": return "\\";
              case '"': return '"';
              case "n": return "\n";
              case "r": return "\r";
              case "t": return "\t";
              default: return "\\" + ch;
            }
          });
          const remainder = accumulated.slice(closeIdx + 1).trim();
          if (remainder.startsWith("#")) {
            inlineComment = " " + remainder;
          }
          break;
        }
        i++;
        if (i >= lines.length) {
          value = accumulated;
          break;
        }
        accumulated += "\n" + lines[i];
      }
    } else if (rest.startsWith("'")) {
      quote = "'";
      let accumulated = rest.slice(1);
      let foundClose = false;
      let closeIdx = -1;

      while (true) {
        closeIdx = accumulated.indexOf("'");
        if (closeIdx !== -1) {
          foundClose = true;
          value = accumulated.slice(0, closeIdx);
          const remainder = accumulated.slice(closeIdx + 1).trim();
          if (remainder.startsWith("#")) {
            inlineComment = " " + remainder;
          }
          break;
        }
        i++;
        if (i >= lines.length) {
          value = accumulated;
          break;
        }
        accumulated += "\n" + lines[i];
      }
    } else {
      // Unquoted value: inline comment MUST be preceded by whitespace (e.g. " # comment")
      const commentMatch = rest.match(/(\s+#.*)$/);
      if (commentMatch) {
        value = rest.slice(0, commentMatch.index).trim();
        inlineComment = commentMatch[1];
      } else {
        value = rest;
      }
    }

    variables[rawKey] = value;
    // Capture the entire slice of physical lines consumed during multiline parsing
    const endLineIdx = Math.min(i, lines.length - 1);
    const rawContent = lines.slice(startLineIdx, endLineIdx + 1).join("\n");
    entries.push({
      type: "pair",
      raw: rawContent,
      key: rawKey,
      value,
      quote,
      exportPrefix,
      inlineComment,
    });
    i++;
  }

  return { entries, variables };
};

/**
 * Comment-preserving .env serializer
 */
export const serializeEnv = (existingContentOrEntries, updatedVariables = {}) => {
  let entries = [];
  if (typeof existingContentOrEntries === "string") {
    entries = parseEnv(existingContentOrEntries).entries;
  } else if (Array.isArray(existingContentOrEntries)) {
    entries = [...existingContentOrEntries];
  }

  const safeUpdates = updatedVariables && typeof updatedVariables === "object" ? updatedVariables : {};
  const appliedKeys = new Set();
  const formattedLines = [];

  const formatValue = (val, preferredQuote) => {
    const strVal = String(val ?? "");
    const needsQuotes = /[\s#"'\n\r=]/.test(strVal) || strVal === "";

    if (preferredQuote === "'" && !strVal.includes("'") && !strVal.includes("\n")) {
      return `'${strVal}'`;
    }
    if (preferredQuote === '"' || needsQuotes) {
      const escaped = strVal.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      return `"${escaped}"`;
    }
    return strVal;
  };

  // 1. Update existing entries in-place
  for (const entry of entries) {
    if (entry.type === "pair") {
      if (Object.prototype.hasOwnProperty.call(safeUpdates, entry.key)) {
        appliedKeys.add(entry.key);
        const newVal = safeUpdates[entry.key];
        const quoteStyle = entry.quote || (typeof newVal === "string" && /[\s#"'\n\r=]/.test(newVal) ? '"' : null);
        const valFormatted = formatValue(newVal, quoteStyle);
        const prefix = entry.exportPrefix ? "export " : "";
        const comment = entry.inlineComment || "";
        formattedLines.push(`${prefix}${entry.key}=${valFormatted}${comment}`);
      } else {
        formattedLines.push(entry.raw);
      }
    } else {
      formattedLines.push(entry.raw);
    }
  }

  // 2. Append new variables at bottom
  const newKeys = Object.keys(safeUpdates).filter((k) => !appliedKeys.has(k));
  if (newKeys.length > 0) {
    if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1].trim() !== "") {
      formattedLines.push("");
    }
    for (const k of newKeys) {
      formattedLines.push(`${k}=${formatValue(safeUpdates[k], null)}`);
    }
  }

  return formattedLines.join("\n");
};

/**
 * Infers typed, realistic mock values for environment variables in hermetic RAM testing
 */
export const inferMockValue = (varName) => {
  if (typeof varName !== "string" || !varName.trim()) return "mock_value";
  const name = varName.trim();
  const upper = name.toUpperCase();

  // 1. Environment mode
  if (upper === "NODE_ENV") return "test";

  // 2. Database connection strings (Check before URLs/URIs)
  if (
    /^(?:DATABASE|DB|POSTGRES|PG|MONGO|MONGODB|MYSQL|REDIS|SQLITE|AMQP|RABBITMQ)_(?:URL|URI|CONNECTION|CONN|DSN)$/i.test(
      upper
    ) ||
    upper === "DATABASE_URL" ||
    upper === "DB_CONNECTION" ||
    upper === "SQLITE_URL" ||
    upper === "SQLITE_CONNECTION"
  ) {
    if (/MONGO/i.test(upper)) return "mongodb://localhost:27017/mock_db";
    if (/REDIS/i.test(upper)) return "redis://localhost:6379";
    if (/MYSQL/i.test(upper)) return "mysql://mock_user:mock_pass@localhost:3306/mock_db";
    if (/SQLITE/i.test(upper)) return "sqlite://mock.db";
    if (/AMQP|RABBIT/i.test(upper)) return "amqp://localhost:5672";
    return "postgresql://mock_user:mock_pass@localhost:5432/mock_db";
  }

  // 3. URLs, URIs, Endpoints, Hosts
  if (
    /(?:_|^)(?:URL|URI|ENDPOINT|HOST_URL|API_URL|WEBHOOK_URL|CLIENT_URL|SERVER_URL|BASE_URL|DOMAIN|ORIGIN)(?:$|_)/i.test(
      upper
    )
  ) {
    if (/WEBHOOK/i.test(upper)) return "http://mock-service.local/webhook";
    if (/(?:CLIENT|FRONTEND|UI|(?:^|_)WEB(?:_|$))/i.test(upper)) return "http://localhost:5173";
    return "http://localhost:3000";
  }

  // 4. Ports (Supports delimited _PORT as well as standard non-delimited prefixes e.g. PGPORT, DBPORT)
  if (
    /(?:^|_|PG|DB|SERVER|HTTP|HTTPS|API|APP|CLIENT|FRONTEND|MYSQL|REDIS|MONGO)PORT(?:$|_|[0-9]+)/i.test(
      upper
    )
  ) {
    if (/REDIS/i.test(upper)) return "6379";
    if (/DB|POSTGRES|PG/i.test(upper)) return "5432";
    if (/MYSQL/i.test(upper)) return "3306";
    if (/MONGO/i.test(upper)) return "27017";
    if (/CLIENT|FRONTEND/i.test(upper)) return "5173";
    return "3000";
  }

  // 5. Secrets, Keys, Passwords, Tokens, Signatures (>= 32 chars for crypto / JWT safety)
  if (/(?:SECRET|KEY|TOKEN|PASSWORD|PASS|PASSWD|AUTH|PRIVATE|PEPPER|SALT|SIGNATURE)/i.test(upper)) {
    if (/HEX|ENCRYPTION/i.test(upper)) {
      return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 hex chars
    }
    if (/AWS_ACCESS_KEY_ID/i.test(upper)) return "AKIAIOSFODNN7EXAMPLE";
    if (/AWS_SECRET_ACCESS_KEY/i.test(upper)) return "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    return "covai_mock_secret_key_32chars_test";
  }

  // 6. Emails
  if (/(?:EMAIL|MAIL|MAILER|RECIPIENT|SENDER)/i.test(upper)) {
    return "mock_user@example.com";
  }

  // 7. Booleans & Feature Toggles
  if (
    /(?:_|^)(?:ENABLE|ENABLED|DISABLE|DISABLED|DEBUG|VERBOSE|STRICT|IS_[A-Z0-9_]+|SHOULD_[A-Z0-9_]+)(?:$|_)/i.test(
      upper
    )
  ) {
    return "false";
  }

  // 8. Durations, Timeouts, Limits
  if (/(?:TIMEOUT|INTERVAL|RETRY|RETRIES|LIMIT|MAX|MIN|TTL|EXPIRATION|EXPIRES)/i.test(upper)) {
    if (/MS$/i.test(upper)) return "5000";
    if (/TTL|EXPIRES/i.test(upper)) return "3600";
    return "10";
  }

  // 9. AWS Regions
  if (/AWS_REGION|DEFAULT_REGION/i.test(upper)) return "us-east-1";

  // 10. Default Fallback
  return `mock_${name.toLowerCase()}`;
};

/**
 * Synthesizes a complete hermetic mock environment in RAM
 */
export const generateHermeticMockEnvironment = (detectedVariables = [], existingVariables = {}) => {
  const mockEnv = { ...(existingVariables || {}) };

  const vars = Array.isArray(detectedVariables) ? detectedVariables : [];
  for (const v of vars) {
    const name = typeof v === "string" ? v : v?.name;
    if (!name || typeof name !== "string") continue;

    if (mockEnv[name] === undefined || mockEnv[name] === null || mockEnv[name] === "") {
      mockEnv[name] = inferMockValue(name);
    }
  }

  if (!mockEnv.NODE_ENV) {
    mockEnv.NODE_ENV = "test";
  }

  return mockEnv;
};

/**
 * Safely loads and parses workspace root .env
 */
export const loadWorkspaceEnv = async (snapshotOrRootDir) => {
  let rootDir = null;
  if (typeof snapshotOrRootDir === "string") {
    rootDir = snapshotOrRootDir;
  } else if (snapshotOrRootDir?.rootDir) {
    try {
      rootDir = snapshotWorkspaceRoot(snapshotOrRootDir) || snapshotOrRootDir.rootDir;
    } catch {
      rootDir = snapshotOrRootDir.rootDir;
    }
  } else if (snapshotOrRootDir) {
    try {
      rootDir = projectEditableWorkspaceRoot(snapshotOrRootDir);
    } catch {
      rootDir = null;
    }
  }

  if (!rootDir || typeof rootDir !== "string") {
    return { exists: false, path: ".env", variables: {}, rawContent: "", entries: [] };
  }

  const envPath = path.join(rootDir, ".env");
  try {
    const rawContent = await fsp.readFile(envPath, "utf8");
    const { entries, variables } = parseEnv(rawContent);
    return { exists: true, path: ".env", variables, rawContent, entries };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { exists: false, path: ".env", variables: {}, rawContent: "", entries: [] };
    }
    throw err;
  }
};

/**
 * @deprecated Deprecated under R1 (Zero-.env Mock Architecture).
 * Unit test execution must never write or mutate .env files on user workspace disk.
 * Instead, use in-memory hermetic mocks via generateHermeticMockEnvironment.
 * Maintained only for legacy backward compatibility.
 */
export const saveWorkspaceEnv = async ({
  snapshot,
  envVariables,
  userId,
  db = prisma,
  requestId,
  mutateWorkspaceFn = mutateProjectWorkspace,
}) => {
  console.warn("[saveWorkspaceEnv] DEPRECATED: Writing .env to workspace is deprecated under R1 zero-.env architecture.");
  if (!snapshot) {
    throw new Error("Snapshot or workspace root is required");
  }

  let rootDir = null;
  if (typeof snapshot === "string") {
    rootDir = snapshot;
  } else if (snapshot && typeof snapshot === "object") {
    try {
      rootDir = projectEditableWorkspaceRoot(snapshot);
    } catch {
      rootDir = snapshot.rootDir;
    }
    if (!rootDir) rootDir = snapshot.rootDir;
  }

  const existing = await loadWorkspaceEnv(rootDir);
  const newContent = serializeEnv(existing.rawContent, envVariables || {});

  // If this is a project snapshot with projectId and snapshotId, persist via mutateProjectWorkspace
  if (snapshot && typeof snapshot === "object" && snapshot.projectId && snapshot.id) {
    const kind = existing.exists ? "WRITE_FILE" : "CREATE_FILE";

    let expectedVersion = undefined;
    let expectedWorkspaceRevision = undefined;

    if (existing.exists) {
      let resolvedVersion = false;
      if (typeof readVersionedProjectFile === "function") {
        try {
          const fileData = await readVersionedProjectFile({
            projectId: snapshot.projectId,
            snapshotId: snapshot.id,
            userId,
            path: ".env",
            db,
          });
          if (fileData?.version) {
            expectedVersion = fileData.version;
            resolvedVersion = true;
          }
          if (fileData?.workspaceRevision !== undefined) {
            expectedWorkspaceRevision = fileData.workspaceRevision;
          }
        } catch (_) {}
      }
      if (!resolvedVersion && db) {
        try {
          if (typeof db.projectFileVersion?.findUnique === "function") {
            const row = await db.projectFileVersion.findUnique({
              where: { snapshotId_relativePath: { snapshotId: snapshot.id, relativePath: ".env" } },
            });
            if (row) {
              expectedVersion = { revision: row.revision, sha256: row.sha256 };
            }
          }
          if (typeof db.project?.findUnique === "function") {
            const project = await db.project.findUnique({
              where: { id: snapshot.projectId },
              select: { workspaceRevision: true },
            });
            if (project?.workspaceRevision !== undefined) {
              expectedWorkspaceRevision = project.workspaceRevision;
            }
          }
        } catch (e) {
          if (e.message !== "Prisma client is not initialized") throw e;
        }
      }
    } else if (db) {
      try {
        if (typeof db.project?.findUnique === "function") {
          const project = await db.project.findUnique({
            where: { id: snapshot.projectId },
            select: { workspaceRevision: true },
          });
          expectedWorkspaceRevision = project?.workspaceRevision;
        }
      } catch (e) {
        if (e.message !== "Prisma client is not initialized") throw e;
      }
    }

    const mutation = await mutateWorkspaceFn({
      projectId: snapshot.projectId,
      snapshotId: snapshot.id,
      userId,
      capability: "files.write",
      kind,
      path: ".env",
      content: newContent,
      expectedVersion,
      expectedWorkspaceRevision,
      db,
      requestId,
    });

    return {
      path: ".env",
      persisted: true,
      envVariables: envVariables || {},
      workspaceRevision: mutation?.workspaceRevision ?? 1,
    };
  }

  // Fallback for direct directory path or filesystem tests
  const envPath = path.join(rootDir, ".env");
  await fsp.writeFile(envPath, newContent, "utf8");
  return {
    path: ".env",
    persisted: true,
    envVariables: envVariables || {},
    workspaceRevision: 1,
  };
};

/**
 * Orchestrator: scans project source files, tests, and entry points for process.env
 */
export const detectProjectEnvironment = async (rootDirOrSnapshot, options = {}) => {
  let rootDir = null;
  if (typeof rootDirOrSnapshot === "string") {
    rootDir = rootDirOrSnapshot;
  } else if (rootDirOrSnapshot?.rootDir) {
    try {
      rootDir = snapshotWorkspaceRoot(rootDirOrSnapshot) || rootDirOrSnapshot.rootDir;
    } catch {
      rootDir = rootDirOrSnapshot.rootDir;
    }
  } else if (rootDirOrSnapshot) {
    try {
      rootDir = projectEditableWorkspaceRoot(rootDirOrSnapshot);
    } catch {
      rootDir = null;
    }
  }

  if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
    return {
      requiresPrompt: false,
      missingRequired: [],
      detectedVariables: [],
      existingVariables: {},
    };
  }

  // 1. Discover files to scan
  const filesToScan = new Set();

  if (Array.isArray(options.files)) {
    for (const f of options.files) {
      filesToScan.add(f);
    }
  } else {
    // A. Business logic files
    try {
      const logicFiles = findLogicSourceFiles(rootDir, { bypassCache: options.bypassCache ?? true });
      if (Array.isArray(logicFiles)) {
        for (const lf of logicFiles) {
          const rel = lf.relativePath || path.relative(rootDir, lf.absolutePath);
          filesToScan.add(rel.replace(/\\/g, "/"));
        }
      }
    } catch {
      // Ignore discovery errors
    }

    // B. Unit test files
    try {
      const unitFiles = findUnitFiles(rootDir);
      if (unitFiles) {
        for (const f of unitFiles.jestFiles || []) {
          filesToScan.add(f.replace(/\\/g, "/"));
        }
        for (const f of unitFiles.vitestFiles || []) {
          filesToScan.add(f.replace(/\\/g, "/"));
        }
      }
    } catch {
      // Ignore discovery errors
    }

    // C. Common root/src entry points
    const commonEntries = [
      "server.js",
      "app.js",
      "index.js",
      "main.js",
      "server.mjs",
      "app.mjs",
      "index.mjs",
      "main.mjs",
      "server.ts",
      "app.ts",
      "index.ts",
      "main.ts",
      "src/server.js",
      "src/app.js",
      "src/index.js",
      "src/main.js",
      "src/server.ts",
      "src/app.ts",
      "src/index.ts",
      "src/main.ts",
    ];
    for (const entry of commonEntries) {
      const full = path.join(rootDir, entry);
      if (fs.existsSync(full)) {
        filesToScan.add(entry.replace(/\\/g, "/"));
      }
    }
  }

  // 2. Scan each file for env references
  const allReferences = [];

  for (const relPath of filesToScan) {
    const fullPath = path.isAbsolute(relPath) ? relPath : path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }

    const parseResult = parseJavaScriptCode(content, {
      filePath: relPath,
      allowRecoveredAst: true,
    });

    if (!parseResult?.ast) {
      // Skip syntax errors safely
      continue;
    }

    try {
      const refs = extractEnvReferencesFromAst(parseResult.ast, relPath);
      allReferences.push(...refs);
    } catch {
      // Continue if traversal error on single file
    }
  }

  // 3. Load existing workspace .env
  const workspaceEnv = await loadWorkspaceEnv(rootDir);
  const existingVariables = {
    ...(workspaceEnv?.variables || {}),
    ...(options.existingVariables || {}),
  };

  // 4. Group references by variable name
  const grouped = new Map();
  for (const ref of allReferences) {
    if (!ref.name) continue;
    if (!grouped.has(ref.name)) {
      grouped.set(ref.name, []);
    }
    grouped.get(ref.name).push(ref);
  }

  // 5. Merge references for each variable
  const detectedVariables = [];
  for (const [varName, refs] of grouped.entries()) {
    const merged = mergeVariableReferences(varName, refs, existingVariables, inferMockValue);
    detectedVariables.push(merged);
  }

  detectedVariables.sort((a, b) => a.name.localeCompare(b.name));

  // 6. Compute missingRequired and requiresPrompt
  const missingRequired = detectedVariables
    .filter((v) => v.required && !v.isDefined)
    .map((v) => v.name);

  // In zero-.env / hermetic mock architecture, unit tests never require user prompt
  // when options.zeroEnv is true or when running without explicit analysis files.
  // When options.files is provided and options.zeroEnv is not true, preserve detection analysis result for test suite.
  const requiresPrompt = (options.zeroEnv === true || !options.files) ? false : missingRequired.length > 0;

  return {
    requiresPrompt,
    missingRequired,
    detectedVariables,
    existingVariables,
  };
};
