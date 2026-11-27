import test from "node:test";
import assert from "node:assert/strict";
import {
  parseContentDispositionFilename,
  buildClientExportFilename,
  computeExportScopePreview,
} from "./portfolioExport.utils.js";

test("parseContentDispositionFilename parses quoted, RFC 5987 UTF-8, and fallback filenames", () => {
  assert.equal(
    parseContentDispositionFilename(
      'attachment; filename="covai-portfolio-report-active-kpi-2026-11-27.pdf"',
      "fallback.pdf",
    ),
    "covai-portfolio-report-active-kpi-2026-11-27.pdf",
  );
  assert.equal(
    parseContentDispositionFilename(
      "attachment; filename*=UTF-8''covai%20report%20test.csv",
      "fallback.csv",
    ),
    "covai report test.csv",
  );
  assert.equal(parseContentDispositionFilename("", "fallback.json"), "fallback.json");
});

test("buildClientExportFilename formats scope slug and extension", () => {
  const fixedDate = new Date("2026-11-27T04:00:00.000Z");
  assert.equal(
    buildClientExportFilename({ scope: "active_kpi", format: "pdf", date: fixedDate }),
    "covai-portfolio-report-active-kpi-2026-11-27.pdf",
  );
  assert.equal(
    buildClientExportFilename({ scope: "all", format: "csv", date: fixedDate }),
    "covai-portfolio-report-all-2026-11-27.csv",
  );
  assert.equal(
    buildClientExportFilename({ scope: "filtered", format: "json", date: fixedDate }),
    "covai-portfolio-report-filtered-2026-11-27.json",
  );
});

test("computeExportScopePreview computes counts & zero-Doing warnings accurately across scopes", () => {
  const allProjects = [
    { id: "p1", name: "API", lifecycleStatus: "DOING", gateStatus: "PASSED" },
    { id: "p2", name: "Web", lifecycleStatus: "DOING", gateStatus: "UNTESTED" },
    { id: "p3", name: "Old", lifecycleStatus: "COMPLETED", gateStatus: "PASSED" },
    { id: "p4", name: "Backlog", lifecycleStatus: "NOT_STARTED", gateStatus: "UNTESTED" },
  ];

  const activePreview = computeExportScopePreview({
    scope: "active_kpi",
    allProjects,
    filteredProjects: allProjects.slice(0, 2),
  });
  assert.equal(activePreview.projectCount, 2);
  assert.equal(activePreview.doingCount, 2);
  assert.equal(activePreview.excludedCount, 0);
  assert.equal(activePreview.untestedDoingCount, 1);
  assert.equal(activePreview.hasZeroDoing, false);
  assert.deepEqual(activePreview.selectedProjectIds, ["p1", "p2"]);

  const allPreview = computeExportScopePreview({
    scope: "all",
    allProjects,
  });
  assert.equal(allPreview.projectCount, 4);
  assert.equal(allPreview.doingCount, 2);
  assert.equal(allPreview.excludedCount, 2);
  assert.match(allPreview.warningMessage, /2 non-Doing/i);

  const filteredPreview = computeExportScopePreview({
    scope: "filtered",
    allProjects,
    filteredProjects: [allProjects[2]],
    isFiltered: true,
  });
  assert.equal(filteredPreview.projectCount, 1);
  assert.equal(filteredPreview.doingCount, 0);
  assert.equal(filteredPreview.excludedCount, 1);
  assert.deepEqual(filteredPreview.selectedProjectIds, ["p3"]);

  const zeroDoingActive = computeExportScopePreview({
    scope: "active_kpi",
    allProjects: [allProjects[2], allProjects[3]],
  });
  assert.equal(zeroDoingActive.projectCount, 0);
  assert.equal(zeroDoingActive.hasZeroDoing, true);
  assert.match(zeroDoingActive.warningMessage, /0 projects are currently in Doing/i);
});
