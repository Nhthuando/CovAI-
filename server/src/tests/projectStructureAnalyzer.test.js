import { afterEach, describe, expect, it } from "@jest/globals";
import { analyzeProjectStructure } from "../services/projectStructureAnalyzer.service.js";
import { comparableAnalysis, createProjectStructureFixture } from "./helpers/projectStructureTestUtils.js";

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(({ cleanup }) => cleanup()));

describe("analyzeProjectStructure", () => {
    it("returns a serializable inventory, graph, tree, and catalog", () => {
        const fixture = createProjectStructureFixture({
            "src/routes/users.js": "import service from '../services/users.js'; export const list = () => service();",
            "src/services/users.js": "export default function users() { return 1; }",
            "package.json": JSON.stringify({ dependencies: { express: "1.0.0" } }),
        });
        fixtures.push(fixture);

        const result = analyzeProjectStructure(fixture.rootDir, { snapshotId: "snapshot-1" });
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
        expect(result.summary).toMatchObject({ totalFiles: 2, totalFunctions: 2, exportedFunctionCount: 2, externalDependencies: ["express"] });
        expect(result.graph.edges).toHaveLength(1);
        expect(result.tree[0]).toMatchObject({ type: "folder", name: "src" });
        expect(result.functions.every((item) => item.filePath.startsWith("src/"))).toBe(true);
    });

    it("is stable across repeated analyses except for the analysis timestamp", () => {
        const fixture = createProjectStructureFixture({ "src/index.js": "export const value = async (item) => item;" });
        fixtures.push(fixture);
        expect(comparableAnalysis(analyzeProjectStructure(fixture.rootDir))).toEqual(comparableAnalysis(analyzeProjectStructure(fixture.rootDir)));
    });

    it("returns a safe valid result for empty roots and malformed files", () => {
        const empty = createProjectStructureFixture({});
        const invalid = createProjectStructureFixture({ "src/broken.ts": "const = ;", "src/good.js": "export function good() {}" });
        fixtures.push(empty, invalid);
        expect(analyzeProjectStructure(empty.rootDir).summary.totalFiles).toBe(0);
        const result = analyzeProjectStructure(invalid.rootDir);
        expect(result.summary.totalFiles).toBe(2);
        expect(result.diagnostics.some((item) => item.path === "src/broken.ts" && item.category === "parse")).toBe(true);
    });
});
