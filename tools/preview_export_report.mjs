// Generates deterministic demonstration PDFs for visual review, without a database.
// Run from the repository root: node tools/preview_export_report.mjs
import fs from "node:fs/promises";
import { renderAnalysisPdf } from "../server/src/services/analysisPdf.service.js";

const report = {
  schemaVersion: 1,
  exportedAt: "2026-10-09T06:30:00Z",
  project: { id: "demo-project", name: "CovAI - Dự án kiểm thử", description: "Báo cáo phân tích chất lượng mã nguồn và kết quả kiểm thử. Demonstration report with illustrative data for layout review.", repoUrl: "https://github.com/example/covai-demo" },
  snapshot: { id: "demo-snapshot-20261009", source: "GITHUB", commitSha: "4ab8c712edc467a01234", createdAt: "2026-10-09T03:15:00Z" },
  warnings: ["DEMONSTRATION DATA - These values illustrate the report layout and are not measurements of the CovAI repository."],
  analysis: {
    coverage: {
      summary: { linesPct: 86.4, branchesPct: 72.8, funcsPct: 91.2, stmtsPct: 85.7, createdAt: "2026-10-09T04:10:00Z" },
      files: Array.from({ length: 24 }, (_, i) => ({ filePath: `src/${i % 2 ? "services" : "controllers"}/${i === 5 ? "project/analysis/exports/snapshot-" : ""}${["project", "coverage", "analysis", "quality"][i % 4]}-${i + 1}.js`, linesPct: 55 + i * 1.8, branchesPct: 42 + i * 2, funcsPct: 75 + i, stmtsPct: 60 + i * 1.5 })),
      functions: Array.from({ length: 128 }, () => ({})),
    },
    complexity: Array.from({ length: 14 }, (_, i) => ({ filePath: `src/services/${["project", "coverage", "analysis"][i % 3]}.service.js`, functionName: ["resolveSnapshot", "buildAnalysis", "collectCoverage", "validateProject"][i % 4], value: 18 - i })),
    quality: { overallScore: 84.5, maintainabilityScore: 81, securityScore: 94, performanceScore: 79, coverageScore: 84, createdAt: "2026-10-09T05:00:00Z", aiAvailable: true },
    structure: { summary: { totalFiles: 67, totalFunctions: 128, exportedFunctionCount: 92, moduleFormat: "ESM", domains: ["Project", "Coverage", "Analysis", "Quality"], externalDependencies: ["express", "react", "prisma", "bullmq", "pdfkit"] } },
    testRuns: [
      { type: "JEST", executionMode: "unit", status: "PASSED", totalTests: 124, passedTests: 122, failedTests: 0, skippedTests: 2, durationMs: 18450, finishedAt: "2026-10-09T04:10:00Z", createdAt: "2026-10-09T04:10:00Z", scenarios: [] },
      { type: "SUPERTEST", executionMode: "backend", status: "FAILED", totalTests: 32, passedTests: 31, failedTests: 1, skippedTests: 0, durationMs: 8240, finishedAt: "2026-10-09T04:20:00Z", createdAt: "2026-10-09T04:20:00Z", scenarios: [{ title: "Từ chối truy cập snapshot của người dùng khác", testFile: "tests/project.authorization.test.js", status: "FAILED", failureCategory: "ASSERTION" }] },
      { type: "PLAYWRIGHT", executionMode: "frontend", status: "PASSED", totalTests: 18, passedTests: 18, failedTests: 0, skippedTests: 0, durationMs: 42000, finishedAt: "2026-10-09T04:30:00Z", createdAt: "2026-10-09T04:30:00Z", scenarios: [] },
    ],
    vulnerabilities: [{ severity: "WARNING", file: "src/controllers/demo.controller.js", line: 42, description: "Kiểm tra lại dữ liệu đầu vào trước khi sử dụng trong truy vấn. Illustrative finding." }],
    suggestions: [
      { priority: "HIGH", filePath: "src/services/analysis.service.js", functionName: "buildAnalysis", message: "Bổ sung kiểm thử cho nhánh xử lý dữ liệu phân tích chưa hoàn tất và snapshot không tồn tại." },
      { priority: "MEDIUM", filePath: "src/services/project.service.js", functionName: "resolveSnapshot", message: "Tách bước xác thực quyền sở hữu để giảm độ phức tạp và cải thiện khả năng kiểm thử." },
    ],
  },
};
await fs.mkdir("output/pdf", { recursive: true });
await fs.mkdir("tmp/pdfs", { recursive: true });
await fs.writeFile("output/pdf/covai-analysis-report-demo.pdf", await renderAnalysisPdf(report));
const empty = structuredClone(report);
empty.project = { name: "Dự án mới chưa phân tích" };
empty.warnings = [];
empty.analysis = { coverage: { summary: null, files: [], functions: [] }, complexity: [], quality: null, structure: null, testRuns: [], vulnerabilities: [], suggestions: [] };
await fs.writeFile("tmp/pdfs/covai-analysis-report-empty.pdf", await renderAnalysisPdf(empty));
console.log("Created demo and empty-state PDFs for visual review.");
