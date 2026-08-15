import { describe, expect, it } from "@jest/globals";
import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { extractFunctions } from "../services/functionExtraction.service.js";

describe("function extraction contract", () => {
  it("records stable source data for ESM and CommonJS exports", () => {
    const ast = parseJavaScriptCode("export async function api({ id }, ...rest) {}\nmodule.exports.helper = () => 1;").ast;
    const first = extractFunctions(ast, "src/api.js");
    const second = extractFunctions(ast, "src/api.js");
    expect(first).toEqual(second);
    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "api", exported: true, async: true, parameters: ["pattern", "...rest"] }),
      expect.objectContaining({ name: "helper", exported: true }),
    ]));
  });
});
