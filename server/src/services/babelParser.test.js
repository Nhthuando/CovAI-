import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { parseJavaScriptCode, parseJavaScriptFile } from "./babelParser.service.js";

const files = [];
afterEach(() => files.splice(0).forEach((filePath) => fs.rmSync(filePath, { force: true })));

describe("Babel parser service", () => {
  it("parses JavaScript, JSX, TypeScript, CommonJS, and modern module syntax", () => {
    const code = `import value from "pkg"; const element = <h1>{value?.name ?? "fallback"}</h1>; export const fn = async (x: number) => await import("./x.js"); module.exports.element = element;`;
    const result = parseJavaScriptCode(code);
    expect(result.success).toBe(true);
    expect(result.ast.type).toBe("File");
  });

  it("returns a safe error for malformed source", () => {
    const result = parseJavaScriptCode("const = ;");
    expect(result).toMatchObject({ success: false, ast: null });
    expect(result.error).toBeTruthy();
  });

  it("parses a readable source file and rejects missing or invalid paths", () => {
    const filePath = path.join(os.tmpdir(), `covai-parser-${Date.now()}.js`);
    files.push(filePath);
    fs.writeFileSync(filePath, "export const answer = 42;");
    expect(parseJavaScriptFile(filePath)).toMatchObject({ success: true });
    expect(parseJavaScriptFile(`${filePath}.missing`)).toMatchObject({ success: false, ast: null });
    expect(parseJavaScriptFile(null)).toMatchObject({ success: false, ast: null });
  });
});
