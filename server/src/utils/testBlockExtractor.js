import { parse as babelParse } from "@babel/parser";

const PARSER_PLUGINS = [
  "jsx",
  "typescript",
  "decorators-legacy",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "optionalChaining",
  "nullishCoalescingOperator",
];

export function parseTestAst(code) {
  return babelParse(code, {
    sourceType: "unambiguous",
    plugins: PARSER_PLUGINS,
    errorRecovery: false,
  });
}

function resolveCalleeLabel(callee) {
  if (!callee) return "";
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") {
    const obj = callee.object?.type === "Identifier" ? callee.object.name : resolveCalleeLabel(callee.object);
    const prop = callee.property?.type === "Identifier" ? callee.property.name : "";
    return obj && prop ? `${obj}.${prop}` : prop || obj;
  }
  return "";
}

function extractStringLiteral(node) {
  if (!node) return "";
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.quasis?.length === 1 && node.expressions?.length === 0) {
    return node.quasis[0].value?.cooked ?? "";
  }
  return "";
}

/**
 * Extracts `test(...)` / `it(...)` and describe blocks from JS/TS test files with exact offsets.
 */
function extractBlocksInternal(code = "", { supportSystemDescribe = false, logLabel = "testBlockExtractor" } = {}) {
  let ast;
  try {
    ast = parseTestAst(code);
  } catch (err) {
    console.warn(`[${logLabel}] AST parse warning:`, err.message);
    return [];
  }

  const blocks = [];
  const describeBlocks = [];

  const isDescribeCall = (callee) =>
    callee === "describe" ||
    (supportSystemDescribe &&
      (callee === "test.describe" ||
        callee === "test.describe.serial" ||
        callee === "test.describe.parallel"));

  const isTestCall = (callee) =>
    callee === "it" ||
    callee === "test" ||
    callee === "it.only" ||
    callee === "test.only" ||
    (!supportSystemDescribe && (callee === "it.skip" || callee === "test.skip"));

  const visit = (node, suitePath = []) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, suitePath);
      return;
    }

    if (node.type === "ExpressionStatement" && node.expression?.type === "CallExpression") {
      const call = node.expression;
      const callee = resolveCalleeLabel(call.callee);
      const baseCallee = callee.includes(".") ? callee : callee;
      const title = extractStringLiteral(call.arguments?.[0]);

      if (isDescribeCall(baseCallee) && title) {
        describeBlocks.push({
          title,
          start: node.start,
          end: node.end,
          bodyStart: call.arguments?.[1]?.body?.start ?? null,
          bodyEnd: call.arguments?.[1]?.body?.end ?? null,
        });
        visit(call.arguments?.[1], [...suitePath, title]);
        return;
      }

      if (isTestCall(baseCallee) && title) {
        const titleArg = call.arguments?.[0];
        blocks.push({
          title,
          suiteName: suitePath.join(" > "),
          start: node.start,
          end: node.end,
          titleStart: titleArg?.start ?? null,
          titleEnd: titleArg?.end ?? null,
          startLine: node.loc?.start?.line ?? 1,
          endLine: node.loc?.end?.line ?? 1,
          code: code.slice(node.start, node.end),
        });
        return;
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = node[key];
      if (val && typeof val === "object") visit(val, suitePath);
    }
  };

  visit(ast.program?.body || [], []);
  blocks.describeBlocks = describeBlocks;
  return blocks;
}

export function extractUnitTestBlocks(code = "") {
  return extractBlocksInternal(code, { supportSystemDescribe: false, logLabel: "unitTestCaseOperations" });
}

export function extractSystemTestBlocks(code = "") {
  return extractBlocksInternal(code, { supportSystemDescribe: true, logLabel: "systemTestCaseOperations" });
}
