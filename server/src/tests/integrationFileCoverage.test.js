import { expect, it } from "@jest/globals";
import { applyIntegrationFileCoverage } from "../services/integrationFileCoverage.service.js";

const job = (resultJson) => ({ type: "SUPERTEST_COVERAGE", status: "SUCCESS", resultJson });

it("overlays the newest measurement for each file and appends files missing from the shared rows", () => {
  const newest = { filePath: "a.js", linesPct: 1, branchesPct: 2, funcsPct: 3, stmtsPct: 4 };
  const extra = { ...newest, filePath: "b.js" };
  const shared = { id: "file-1", ...newest, linesPct: 90, branchesPct: 91, funcsPct: 92, stmtsPct: 93 };
  const untouched = { ...shared, filePath: "c.js" };

  expect(applyIntegrationFileCoverage([shared, untouched], [
    job(JSON.stringify({ fileCoverages: [newest] })),
    job({ fileCoverages: [{ ...newest, linesPct: 50 }, extra] }),
  ])).toEqual([{ id: "file-1", ...newest }, untouched, extra]);
});

it("ignores malformed, legacy, non-Supertest, and unsuccessful jobs", () => {
  const shared = [{ filePath: "a.js", linesPct: 90 }];
  const resultJson = { fileCoverages: [{ filePath: "a.js", linesPct: 1 }] };

  expect(applyIntegrationFileCoverage(shared, [
    job("{invalid"),
    job({ coverage: { lines: 1 } }),
    { ...job(resultJson), type: "COVERAGE_PIPELINE" },
    { ...job(resultJson), status: "FAILED" },
  ])).toEqual(shared);
});
