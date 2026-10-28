import { afterEach, describe, expect, it } from "@jest/globals";
import { analyzeProjectStructure } from "../services/projectStructureAnalyzer.service.js";
import { createProjectStructureFixture } from "./helpers/projectStructureTestUtils.js";

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(({ cleanup }) => cleanup()));

describe("project structure performance", () => {
  it("analyzes 1,000 supported files within the 30-second acceptance ceiling", () => {
    const files = {};
    for (let index = 0; index < 1000; index += 1) files[`src/module-${index}.js`] = `export const value${index} = ${index};`;
    const fixture = createProjectStructureFixture(files);
    fixtures.push(fixture);
    const started = Date.now();
    const result = analyzeProjectStructure(fixture.rootDir, { snapshotId: "performance-snapshot" });
    const elapsed = Date.now() - started;
    expect(result.summary.totalFiles).toBe(1000);
    expect(elapsed).toBeLessThan(30000);
  });
});
