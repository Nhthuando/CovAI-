import { afterEach, describe, expect, it } from "@jest/globals";
import { analyzeProjectStructure } from "../services/projectStructureAnalyzer.service.js";
import { createProjectStructureFixture } from "./helpers/projectStructureTestUtils.js";

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(({ cleanup }) => cleanup()));

describe("project structure dependencies", () => {
  it("resolves ESM, CommonJS, index files, externals, and unresolved dynamic imports", () => {
    const fixture = createProjectStructureFixture({
      "src/index.js": "import { service } from './service'; const c = require('chalk'); import(value); export { service };",
      "src/service/index.ts": "export const service = () => true;",
      "package.json": JSON.stringify({ dependencies: { chalk: "1.0.0" } }),
    });
    fixtures.push(fixture);
    const result = analyzeProjectStructure(fixture.rootDir);
    const source = result.graph.nodes.find((node) => node.relativePath === "src/index.js");
    expect(result.summary.moduleFormat).toBe("Mixed");
    expect(source.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "internal", path: "src/service/index.ts" }),
      expect.objectContaining({ type: "external", package: "chalk" }),
      expect.objectContaining({ type: "unresolved", reason: expect.stringContaining("not a string literal") }),
    ]));
    expect(result.graph.nodes.find((node) => node.relativePath === "src/service/index.ts").importedBy).toEqual([{ path: "src/index.js", relationship: "import" }]);
  });
});
