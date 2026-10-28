import { describe, expect, it } from "@jest/globals";
import { renderAnalysisPdf } from "../services/analysisPdf.service.js";

const report = () => ({
    project: { name: "Dự án kiểm thử chuyên nghiệp", description: "Báo cáo chất lượng phần mềm" },
    snapshot: { id: "snapshot-1", source: "ZIP", createdAt: "2026-10-01T00:00:00Z" },
    exportedAt: "2026-10-09T00:00:00Z", warnings: [],
    analysis: { coverage: { summary: null, files: [], functions: [] }, quality: null, complexity: [], structure: null, testRuns: [], suggestions: [], vulnerabilities: [] },
});
const pageCount = (buffer) => [...buffer.toString("latin1").matchAll(/\/Type \/Page\b/g)].length;

describe("analysis PDF layout", () => {
    it("renders a compact empty report with embedded Vietnamese fonts", async () => {
        const pdf = await renderAnalysisPdf(report());
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(pageCount(pdf)).toBeGreaterThan(0);
        expect(pageCount(pdf)).toBeLessThanOrEqual(2);
        expect(pdf.toString("latin1")).toContain("/FontFile2");
        expect(pdf.toString("latin1")).toContain("/ToUnicode");
    });
    it("paginates long file names and bounded detail rather than creating an unbounded report", async () => {
        const data = report();
        data.analysis.coverage.summary = { linesPct: 0, branchesPct: 83, funcsPct: 92, stmtsPct: 75 };
        data.analysis.coverage.files = Array.from({ length: 180 }, (_, i) => ({ filePath: `src/${"very-long-folder-name/".repeat(7)}file-${i}.js`, linesPct: i % 100, branchesPct: 88, funcsPct: 75, stmtsPct: 62 }));
        const pdf = await renderAnalysisPdf(data);
        expect(pageCount(pdf)).toBeGreaterThan(3);
        expect(pageCount(pdf)).toBeLessThan(20);
    });
});
