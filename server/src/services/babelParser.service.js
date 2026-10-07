import { parse } from "@babel/parser";
import fs from "fs";

const parserOptions = {
  sourceType: "unambiguous",
  plugins: [
    "jsx",
    "typescript",
    "classProperties",
    "classPrivateMethods",
    "classPrivateProperties",
    "optionalChaining",
    "nullishCoalescingOperator",
    "dynamicImport",
    "objectRestSpread",
    "topLevelAwait",
  ],
  errorRecovery: false,
};

const safeError = (error, fallback) => String(error?.message || fallback).replace(/[A-Za-z]:\\[^\n]+/g, "source file").slice(0, 300);

export const parseJavaScriptCode = (codeString) => {
    try { return { success: true, ast: parse(codeString, parserOptions) }; }
    catch (error) { return { success: false, ast: null, error: safeError(error, "Unable to parse source") }; }
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
      ...parseJavaScriptCode(code),
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
