import { describe, expect, it } from "@jest/globals";
import { coverageResultFromSummary } from "../services/runTestsJob.service.js";

describe("coverageResultFromSummary", () => {
    it("maps the multi-framework aggregator result into the job result contract", () => {
        expect(coverageResultFromSummary({
            summary: { linesPct: 80, branchesPct: 70, funcsPct: 60, stmtsPct: 90 },
            fileCount: 3,
        })).toEqual({ lines: 80, branches: 70, functions: 60, statements: 90 });
    });

    it("returns null when aggregation did not produce a summary", () => {
        expect(coverageResultFromSummary(null)).toBeNull();
    });
});
