import {
    clampScore,
    getGrade,
    computeCoverageScore,
    computePerformanceScore,
    computeMaintainabilityScore,
    computeOverallScore,
} from "./qualityScoring.service.js";

describe("qualityScoring", () => {
    describe("clampScore", () => {
        test("clamps negative to 0", () => {
            expect(clampScore(-5)).toBe(0);
        });
        test("clamps above 100 to 100", () => {
            expect(clampScore(120)).toBe(100);
        });
        test("rounds to 1 decimal", () => {
            expect(clampScore(72.456)).toBe(72.5);
        });
        test("passes through valid score", () => {
            expect(clampScore(85)).toBe(85);
        });
    });

    describe("getGrade", () => {
        test("A for 90-100", () => {
            expect(getGrade(95)).toBe("A");
            expect(getGrade(90)).toBe("A");
        });
        test("B for 75-89", () => {
            expect(getGrade(80)).toBe("B");
            expect(getGrade(75)).toBe("B");
        });
        test("C for 60-74", () => {
            expect(getGrade(65)).toBe("C");
        });
        test("D for 40-59", () => {
            expect(getGrade(50)).toBe("D");
        });
        test("F for below 40", () => {
            expect(getGrade(20)).toBe("F");
        });
    });

    describe("computeCoverageScore", () => {
        test("returns average of 4 coverage metrics", () => {
            const result = computeCoverageScore({
                linesPct: 80, branchesPct: 60, funcsPct: 90, stmtsPct: 70,
            });
            expect(result.score).toBe(75);
            expect(result.details.linesPct).toBe(80);
        });
        test("returns 0 when no coverage data", () => {
            const result = computeCoverageScore(null);
            expect(result.score).toBe(0);
        });
    });

    describe("computePerformanceScore", () => {
        test("high score for low complexity project", () => {
            const cyclomatics = [
                { value: 2, functionName: "a", filePath: "a.js" },
                { value: 3, functionName: "b", filePath: "b.js" },
            ];
            const structure = {
                summary: { totalFiles: 2, totalFunctions: 2 },
                graph: {
                    nodes: [
                        { id: "a", relativePath: "a.js", imports: ["b"], importedBy: [], functions: [{ exported: false }] },
                        { id: "b", relativePath: "b.js", imports: [], importedBy: ["a"], functions: [{ exported: true }] },
                    ],
                    edges: [{ from: "a", to: "b", type: "internal" }],
                },
            };
            const result = computePerformanceScore(cyclomatics, structure);
            expect(result.score).toBeGreaterThanOrEqual(80);
            expect(result.details.hotspots).toHaveLength(0);
        });

        test("lower score for high complexity", () => {
            const cyclomatics = [
                { value: 25, functionName: "complex", filePath: "x.js" },
                { value: 15, functionName: "medium", filePath: "x.js" },
                { value: 3, functionName: "simple", filePath: "y.js" },
            ];
            const structure = {
                summary: { totalFiles: 2, totalFunctions: 3 },
                graph: { nodes: [], edges: [] },
            };
            const result = computePerformanceScore(cyclomatics, structure);
            expect(result.score).toBeLessThan(60);
            expect(result.details.hotspots.length).toBeGreaterThan(0);
        });

        test("returns 50 when no data", () => {
            const result = computePerformanceScore([], null);
            expect(result.score).toBe(50);
        });
    });

    describe("computeMaintainabilityScore", () => {
        test("scores based on CC and structure", () => {
            const cyclomatics = [{ value: 4 }, { value: 6 }];
            const structure = {
                summary: { totalFiles: 5, moduleFormat: "ESM" },
                graph: { nodes: Array.from({ length: 5 }, () => ({ role: "service", functions: [{}] })) },
            };
            const result = computeMaintainabilityScore(cyclomatics, structure);
            expect(result.score).toBeGreaterThan(0);
            expect(result.score).toBeLessThanOrEqual(100);
        });

        test("lower score for mixed module format", () => {
            const cyclomatics = [{ value: 4 }];
            const structureESM = {
                summary: { moduleFormat: "ESM" },
                graph: { nodes: [{ role: "service", functions: [{}] }] },
            };
            const structureMixed = {
                summary: { moduleFormat: "Mixed" },
                graph: { nodes: [{ role: "service", functions: [{}] }] },
            };
            const esmResult = computeMaintainabilityScore(cyclomatics, structureESM);
            const mixedResult = computeMaintainabilityScore(cyclomatics, structureMixed);
            expect(esmResult.score).toBeGreaterThan(mixedResult.score);
        });
    });

    describe("computeOverallScore", () => {
        test("weighted formula", () => {
            const result = computeOverallScore(80, 70, 90, 60);
            // 0.30*80 + 0.25*70 + 0.25*90 + 0.20*60 = 24+17.5+22.5+12 = 76
            expect(result).toBe(76);
        });

        test("clamps result", () => {
            const result = computeOverallScore(100, 100, 100, 100);
            expect(result).toBe(100);
        });

        test("handles zeros", () => {
            const result = computeOverallScore(0, 0, 0, 0);
            expect(result).toBe(0);
        });
    });
});
