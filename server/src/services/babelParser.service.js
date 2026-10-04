import { parse } from "@babel/parser";
import fs from "fs";

const parserOptions = {
    sourceType: "unambiguous",
    errorRecovery: false,
    plugins: ["jsx", "typescript", "classProperties", "classPrivateMethods", "classPrivateProperties", "dynamicImport", "objectRestSpread", "topLevelAwait"],
};

const safeError = (error, fallback) => String(error?.message || fallback).replace(/[A-Za-z]:\\[^\n]+/g, "source file").slice(0, 300);

export const parseJavaScriptCode = (codeString) => {
    try { return { success: true, ast: parse(codeString, parserOptions) }; }
    catch (error) { return { success: false, ast: null, error: safeError(error, "Unable to parse source") }; }
};

export const parseJavaScriptFile = (filePath) => {
    if (typeof filePath !== "string") return { success: false, ast: null, error: "Invalid source file" };
    try { return parseJavaScriptCode(fs.readFileSync(filePath, "utf8")); }
    catch (error) { return { success: false, ast: null, error: safeError(error, "Unable to read source") }; }
};
