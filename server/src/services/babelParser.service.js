import { parse } from "@babel/parser";
import fs from "fs";

export const getParserPlugins = (isJsx = true) => [
  "decorators-legacy",
  "typescript",
  ...(isJsx ? ["jsx"] : []),
  "classProperties",
  "classPrivateMethods",
  "classPrivateProperties",
  "optionalChaining",
  "nullishCoalescingOperator",
  "dynamicImport",
  "objectRestSpread",
  "topLevelAwait",
  "asyncGenerators",
  "exportDefaultFrom",
  "exportNamespaceFrom",
];

const safeError = (error, fallback) => String(error?.message || fallback).replace(/[A-Za-z]:\\[^\n]+/g, "source file").slice(0, 300);

export const parseJavaScriptCode = (codeString, options = {}) => {
  const filePath = typeof options === "string" ? options : (options?.filePath || "");
  const isExplicitJsx = /\.[jt]sx$/i.test(filePath);
  const isPureTs = /\.ts$/i.test(filePath);

  // If pure TS (.ts), do not include JSX by default to avoid generic arrow collision (<T>(x: T) => x)
  const preferJsx = isExplicitJsx || (!isPureTs && /<[a-zA-Z0-9_$]+(?:\s+[^>]*)?>[\s\S]*<\/[a-zA-Z0-9_$]+>|<[a-zA-Z0-9_$]+(?:\s+[^>]*)?\/>/.test(codeString));

  const primaryPlugins = getParserPlugins(preferJsx);
  const fallbackPlugins = getParserPlugins(!preferJsx);

  const parseOpts = (plugins) => ({
    sourceType: "unambiguous",
    plugins,
    errorRecovery: true,
    ...(typeof options === "object" ? options : {}),
  });

  try {
    const ast = parse(codeString, parseOpts(primaryPlugins));
    if (ast?.errors && ast.errors.length > 0 && !options.allowRecoveredAst) {
      return { success: false, ast, error: safeError(ast.errors[0], "Syntax error in source") };
    }
    return { success: true, ast };
  } catch (primaryError) {
    try {
      const ast = parse(codeString, parseOpts(fallbackPlugins));
      if (ast?.errors && ast.errors.length > 0 && !options.allowRecoveredAst) {
        return { success: false, ast, error: safeError(ast.errors[0], "Syntax error in source") };
      }
      return { success: true, ast };
    } catch (_) {
      return { success: false, ast: null, error: safeError(primaryError, "Unable to parse source") };
    }
  }
};

export const parseJavaScriptFile = (filePath) => {
  if (typeof filePath !== "string") {
    return { success: false, ast: null, error: "Invalid file path" };
  }

  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      ast: null,
      error: `File does not exist: ${filePath}`,
    };
  }

  try {
    const code = fs.readFileSync(filePath, "utf-8");
    const lineCount = code ? code.split(/\r?\n/).length : 0;
    return {
      ...parseJavaScriptCode(code, { filePath }),
      lineCount,
    };
  } catch (error) {
    return {
      success: false,
      ast: null,
      lineCount: 0,
      error: `Failed to read file: ${safeError(error, "Unable to read source")}`,
    };
  }
};
