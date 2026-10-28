import { afterEach, describe, expect, it } from "@jest/globals";
import { analyzeProjectStructure } from "../services/projectStructureAnalyzer.service.js";
import { createProjectStructureFixture, comparableAnalysis } from "./helpers/projectStructureTestUtils.js";

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(({ cleanup }) => cleanup()));

describe("project structure conformance", () => {
  it("reports mixed formats and accurate dependency/function context", () => {
    const fixture = createProjectStructureFixture({
      "src/routes/users.js": "import service from '../services/users.js'; export const listUsers = (id) => service(id);",
      "src/services/users.js": "module.exports = function users(id) { return id; };",
      "package.json": JSON.stringify({ dependencies: { express: "1.0.0" }, devDependencies: { jest: "1.0.0" } }),
    });
    fixtures.push(fixture);
    const result = analyzeProjectStructure(fixture.rootDir, { snapshotId: "conformance-snapshot" });
    expect(result.summary.moduleFormat).toBe("Mixed");
    expect(result.graph.edges).toEqual(expect.arrayContaining([expect.objectContaining({ type: "internal" })]));
    expect(result.functions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "listUsers", exported: true, parameters: ["id"] }),
      expect.objectContaining({ name: "users", startLine: 1 }),
    ]));
  });

  it("keeps identifiers and graph relationships stable across repeated runs", () => {
    const fixture = createProjectStructureFixture({ "src/index.js": "export const value = () => 1;" });
    fixtures.push(fixture);
    const first = analyzeProjectStructure(fixture.rootDir);
    const second = analyzeProjectStructure(fixture.rootDir);
    expect(comparableAnalysis(first)).toEqual(comparableAnalysis(second));
  });

  it("continues after malformed files with diagnostics", () => {
    const fixture = createProjectStructureFixture({ "src/good.js": "export const good = true;", "src/broken.ts": "const = ;" });
    fixtures.push(fixture);
    const result = analyzeProjectStructure(fixture.rootDir);
    expect(result.summary.totalFiles).toBe(2);
    expect(result.graph.nodes.find((node) => node.relativePath === "src/good.js").diagnostics).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ path: "src/broken.ts", category: "parse" })]));
  });

  it("analyzes at least 99% of the remaining supported files after one parse failure", () => {
    const files = { "src/broken.ts": "const = ;" };
    for (let index = 0; index < 100; index += 1) files[`src/ok-${index}.js`] = `export const ok${index} = true;`;
    const fixture = createProjectStructureFixture(files);
    fixtures.push(fixture);
    const result = analyzeProjectStructure(fixture.rootDir);
    const diagnosed = new Set(result.diagnostics.filter((item) => item.path).map((item) => item.path));
    const analyzedFiles = result.graph.nodes.filter((node) => !diagnosed.has(node.relativePath)).length;
    expect(analyzedFiles / result.summary.totalFiles).toBeGreaterThanOrEqual(0.99);
  });
});
