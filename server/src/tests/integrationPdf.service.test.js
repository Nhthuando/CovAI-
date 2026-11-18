import { describe, expect, it } from "@jest/globals";
import {
  buildIntegrationExportDto,
  renderIntegrationReportPdf,
} from "../services/integrationPdf.service.js";

const pageCount = (buffer) =>
  [...buffer.toString("latin1").matchAll(/\/Type \/Page\b/g)].length;

describe("integrationPdf.service", () => {
  it("builds a canonical JSON export DTO with case coverage and metrics", () => {
    const dto = buildIntegrationExportDto({
      project: { id: "proj-1", name: "Class Management API" },
      snapshotId: "snap-1",
      report: {
        overview: { snapshotId: "snap-1", totalScenarios: 2, hasScannedEndpoints: true, hasExecutedCoverage: true },
        apiCoverage: { discoveredApis: 2, testedApis: 1, uncoveredApis: 1, coveragePercentage: 50 },
        latestExecution: { testRunId: "tr-1", totalTests: 2, passedTests: 1, failedTests: 1, durationMs: 1200 },
        routeMatrix: [
          {
            method: "GET",
            path: "/api/students",
            handler: "listStudents",
            sourceFile: "src/routes/students.js",
            status: "COVERED",
            scenarioCount: 1,
            passedCount: 1,
            failedCount: 0,
            scenarios: [{ title: "GET /api/students 200", status: "passed", expectedStatus: 200 }],
          },
          {
            method: "POST",
            path: "/api/students",
            handler: "createStudent",
            sourceFile: "src/routes/students.js",
            status: "FAILED",
            scenarioCount: 1,
            passedCount: 0,
            failedCount: 1,
            scenarios: [{ title: "POST /api/students invalid", status: "failed", expectedStatus: 400 }],
          },
        ],
        failureLogs: [
          {
            id: "f1",
            targetEndpoint: "POST /api/students",
            failureLayer: "ASSERTION_FAILED",
            expectedStatus: 400,
            responseStatus: 500,
            errorMessage: "Expected 400 Bad Request, received 500",
          },
        ],
      },
    });

    expect(dto.schemaVersion).toBe("1.0");
    expect(dto.reportType).toBe("integration");
    expect(dto.project.name).toBe("Class Management API");
    expect(dto.overview.totalDiscoveredEndpoints).toBe(2);
    expect(dto.overview.totalTestedEndpoints).toBe(1);
    expect(dto.latestExecution.totalFailed).toBe(1);
    expect(dto.routeMatrix).toHaveLength(2);
    expect(dto.routeMatrix[0].caseCoverage.totalRequired).toBeGreaterThanOrEqual(1);
    expect(dto.failureLogs).toHaveLength(1);
  });

  it("renders a valid paginated A4 vector PDF with embedded fonts", async () => {
    const dto = buildIntegrationExportDto({
      project: { id: "proj-1", name: "Dự án Quản lý Sinh viên" },
      snapshotId: "snap-1",
      report: {
        overview: { snapshotId: "snap-1", totalScenarios: 60, hasScannedEndpoints: true, hasExecutedCoverage: true },
        latestExecution: { testRunId: "tr-1", totalTests: 60, passedTests: 58, failedTests: 2, durationMs: 4200 },
        routeMatrix: Array.from({ length: 45 }, (_, i) => ({
          method: i % 2 === 0 ? "GET" : "POST",
          path: `/api/v1/resource-${i}/items`,
          handler: `handler_${i}`,
          sourceFile: `src/routes/resource-${i}.js`,
          status: i === 0 ? "FAILED" : i % 3 === 0 ? "UNCOVERED" : "COVERED",
          scenarioCount: i % 3 === 0 ? 0 : 2,
          passedCount: i === 0 ? 1 : i % 3 === 0 ? 0 : 2,
          failedCount: i === 0 ? 1 : 0,
        })),
        failureLogs: [
          {
            id: "f1",
            targetEndpoint: "GET /api/v1/resource-0/items",
            failureLayer: "CONTROLLER_CRASH",
            expectedStatus: 200,
            responseStatus: 500,
            errorMessage: "TypeError: Cannot read properties of undefined",
          },
        ],
      },
    });

    const pdfBuffer = await renderIntegrationReportPdf(dto);
    expect(pdfBuffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdfBuffer)).toBeGreaterThanOrEqual(2);
    expect(pdfBuffer.toString("latin1")).toContain("/FontFile2");
    expect(pdfBuffer.toString("latin1")).toContain("/ToUnicode");
  });
});
