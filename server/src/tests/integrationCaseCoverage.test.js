import { describe, it, expect } from "@jest/globals";
import {
  getEndpointRequiredCases,
  getEndpointCaseCoverage,
  annotateEndpointScenarios,
  summarizeIntegrationFailure,
  getScenarioCaseKey,
  detectIntegrationLanguage,
} from "../../../shared/integrationCaseCoverage.js";
import { evaluateEndpointMetrics } from "../services/integrationWorkspace.service.js";
import { extractTestRequests } from "../services/testSourceParser.service.js";
import {
  includeRouteContext,
  buildSupertestPrompt,
} from "../services/supertestPromptBuilder.service.js";
import { buildIntegrationTestPrompt } from "../services/integrationAiTestGenerator.service.js";
import { processSupertestTests } from "../services/supertestPostProcessor.service.js";
import { computeIntegrationCoverageRank } from "../services/integrationReport.service.js";

describe("Integration Case Coverage Contract (Option A)", () => {
  const deleteStudentEp = {
    method: "DELETE",
    fullPath: "/api/students/:id",
    responseStatusCodes: [400, 404, 500, 200],
  };

  it("requires Happy 2xx, Validation 400, and Not Found 404 for DELETE /api/students/:id", () => {
    const cases = getEndpointRequiredCases(deleteStudentEp);
    expect(cases.map((c) => c.key)).toEqual(["HAPPY", "VALIDATION", "NOT_FOUND"]);
  });

  it("marks endpoint as Partial (not Covered) until all required cases have passed", () => {
    const twoOfThree = [
      { title: "happy path: should delete student with 200", status: "passed", expectedStatus: 200 },
      { title: "error edge case: non-existent student with 404", status: "passed", expectedStatus: 404 },
    ];
    const cov2 = getEndpointCaseCoverage(deleteStudentEp, twoOfThree);
    expect(cov2.coveredCount).toBe(2);
    expect(cov2.passedCasesCount).toBe(2);
    expect(cov2.totalRequired).toBe(3);
    expect(cov2.isComplete).toBe(false);
    expect(cov2.isFullyVerified).toBe(false);

    const partialMetrics = evaluateEndpointMetrics({
      executedCount: 2,
      passedCount: 2,
      failedCount: 0,
      hasObservedServerResponse: true,
      caseCoverageComplete: cov2.isFullyVerified,
    });
    expect(partialMetrics.status).toBe("Partial");

    const threeOfThree = [
      ...twoOfThree,
      { title: "validation error: invalid id returns 400", status: "passed", expectedStatus: 400 },
    ];
    const cov3 = getEndpointCaseCoverage(deleteStudentEp, threeOfThree);
    expect(cov3.coveredCount).toBe(3);
    expect(cov3.passedCasesCount).toBe(3);
    expect(cov3.isComplete).toBe(true);
    expect(cov3.isFullyVerified).toBe(true);

    const coveredMetrics = evaluateEndpointMetrics({
      executedCount: 3,
      passedCount: 3,
      failedCount: 0,
      hasObservedServerResponse: true,
      caseCoverageComplete: cov3.isFullyVerified,
    });
    expect(coveredMetrics.status).toBe("Covered");
  });

  it("extracts expectedStatuses from expect([404, 400]).toContain(res.status)", () => {
    const code = `
      import request from 'supertest';
      import app from '../index.js';
      describe('DELETE /api/students/:id', () => {
        it('error edge case: should handle non-existent student with 404 or 400', async () => {
          const res = await request(app).delete('/api/students/999999');
          expect([404, 400]).toContain(res.status);
        });
      });
    `;
    const reqs = extractTestRequests(code, "tests/integration/students.test.js");
    expect(reqs).toHaveLength(1);
    expect(reqs[0].expectedStatus).toBe(404);
    expect(reqs[0].expectedStatuses).toEqual([404, 400]);
    expect(getScenarioCaseKey({ title: reqs[0].testName, expectedStatus: reqs[0].expectedStatus })).toBe("NOT_FOUND");
  });

  it("includes all required cases in Supertest prompt table when missingCoverageRequested is omitted", () => {
    const segment = includeRouteContext(
      [{ path: "server/index.js", content: "app.delete('/api/students/:id', () => {});" }],
      [deleteStudentEp],
    );
    expect(segment).toContain("Happy Path (200/201) AND Validation Error (400/422) AND Not Found / Conflict (404/409)");
    expect(segment).toContain("EXACTLY ONE dedicated `it(...)` test block for EACH individual item");
  });

  it("detects Vietnamese/English project language and classifies Vietnamese scenarios accurately", () => {
    expect(
      getScenarioCaseKey({ title: "Kịch bản 5: Ngăn chặn xóa lớp học khi lớp vẫn đang có sinh viên" }),
    ).toBe("VALIDATION");
    expect(
      getScenarioCaseKey({ title: "Không tìm thấy lớp học cần xóa" }),
    ).toBe("NOT_FOUND");
    expect(
      getScenarioCaseKey({ title: "Chưa đăng nhập hoặc không có quyền truy cập" }),
    ).toBe("AUTH");
    expect(
      getScenarioCaseKey({ title: "Xóa lớp học hợp lệ thành công" }),
    ).toBe("HAPPY");

    expect(
      detectIntegrationLanguage({
        existingScenarios: [{ testName: "Kịch bản 5: Ngăn chặn xóa lớp học khi lớp vẫn đang có sinh viên" }],
      }),
    ).toBe("vi");

    expect(
      detectIntegrationLanguage({
        existingScenarios: [{ testName: "should delete class successfully" }],
        testFiles: [{ path: "tests/classes.test.js", content: "it('should delete class', () => {})" }],
      }),
    ).toBe("en");
  });

  it("excludes existing covered scenarios and preserves Vietnamese language in AI prompts", () => {
    const deleteClassEp = {
      method: "DELETE",
      fullPath: "/api/classes/:id",
      responseStatusCodes: [400, 404, 500, 200],
      missingCoverageRequested: ["Happy Path (200/201)", "Not Found / Conflict (404/409)"],
      existingScenarios: [
        {
          testName: "Kịch bản 5: Ngăn chặn xóa lớp học khi lớp vẫn đang có sinh viên",
          expectedStatus: 400,
          caseKey: "VALIDATION",
          caseLabel: "Validation 400",
        },
      ],
    };

    const payload = {
      sourceCode: [{ path: "server/index.js", content: "app.delete('/api/classes/:id', () => {});" }],
      testFiles: [
        {
          path: "tests/classes.test.js",
          content:
            "const request = require('supertest');\nit('Kịch bản 5: Ngăn chặn xóa lớp học khi lớp vẫn đang có sinh viên', async () => { const res = await request(app).delete('/api/classes/1'); expect(res.status).toBe(400); });",
        },
      ],
    };

    const supertestPrompt = buildSupertestPrompt(payload, [deleteClassEp]);
    expect(supertestPrompt).toContain("LANGUAGE RULE (MANDATORY — VIETNAMESE)");
    expect(supertestPrompt).toContain("Existing User Scenarios (Preserved Automatically — Reference Only)");
    expect(supertestPrompt).toContain("Kịch bản 5: Ngăn chặn xóa lớp học khi lớp vẫn đang có sinh viên");
    expect(supertestPrompt).toContain("Happy Path (200/201) AND Not Found / Conflict (404/409)");
    expect(supertestPrompt).not.toContain("| DELETE | /api/classes/:id | - | - | - | - | undefined | Happy Path (200/201) AND Validation Error (400/422)");

    const integrationPrompt = buildIntegrationTestPrompt({
      endpoints: [deleteClassEp],
      sourceCode: payload.sourceCode,
      testFiles: payload.testFiles,
    });
    expect(integrationPrompt).toContain("LANGUAGE RULE (MANDATORY — VIETNAMESE)");
    expect(integrationPrompt).toContain("Existing User Scenarios (Preserved Separately — Reference Only)");
    expect(integrationPrompt).toContain("Happy Path (200/201) | Not Found / Conflict (404/409)");
  });

  it("preserves expectedStatus and expectedStatuses in Supertest post-processor metadata", () => {
    const raw = JSON.stringify({
      tests: [
        {
          filePath: "tests/integration/classes.test.js",
          content: `
            import request from 'supertest';
            import app from '../../server/index.js';
            describe('DELETE /api/classes/:id', () => {
              it('Thành công (200): Xóa lớp học hợp lệ', async () => {
                const res = await request(app).delete('/api/classes/1');
                expect(res.status).toBe(200);
              });
              it('Không tìm thấy (404): Lớp học không tồn tại', async () => {
                const res = await request(app).delete('/api/classes/999');
                expect([404, 409]).toContain(res.status);
              });
            });
          `,
        },
      ],
    });
    const processed = processSupertestTests(raw, { projectId: "p1", snapshotId: "s1" });
    const meta = JSON.parse(processed.allTests[0].metaJson);
    expect(meta.requests[0].expectedStatus).toBe(200);
    expect(meta.requests[1].expectedStatus).toBe(404);
    expect(meta.requests[1].expectedStatuses).toEqual([404, 409]);
  });

  it("ranks peak integration coverage higher than targeted single-test coverage", () => {
    const fullRunScore = computeIntegrationCoverageRank({
      coveredEndpoints: 12,
      endpointCoveragePct: 85.7,
      linesPct: 74.3,
      stmtsPct: 74.3,
      passedTests: 23,
    });
    const singleTestRunScore = computeIntegrationCoverageRank({
      coveredEndpoints: 0,
      endpointCoveragePct: 0,
      linesPct: 12.2,
      stmtsPct: 12.2,
      passedTests: 0,
    });
    expect(fullRunScore).toBeGreaterThan(singleTestRunScore);

    const partialImprovedRunScore = computeIntegrationCoverageRank({
      coveredEndpoints: 13,
      endpointCoveragePct: 92.9,
      linesPct: 78.1,
      stmtsPct: 78.1,
      passedTests: 25,
    });
    expect(partialImprovedRunScore).toBeGreaterThan(fullRunScore);
  });

  it("annotates scenarios with matched required case vs duplicate vs optional extra", () => {
    const postEventEp = {
      method: "POST",
      fullPath: "/api/events",
      responseStatusCodes: [201, 400],
    };
    const scenarios = [
      { title: "returns 201 and persists event", status: "passed", expectedStatus: 201, origin: "PROJECT_EXISTING" },
      { title: "happy path creates event successfully", status: "passed", expectedStatus: 201, origin: "AI_GENERATED" },
      { title: "returns 400 when Zod rejects payload", status: "passed", expectedStatus: 400, origin: "PROJECT_EXISTING" },
      { title: "returns 500 when downstream fails", status: "passed", expectedStatus: 500, origin: "PROJECT_EXISTING" },
    ];
    const cov = getEndpointCaseCoverage(postEventEp, scenarios);
    expect(cov.scenarioAnnotations.map((a) => a.role)).toEqual([
      "MATCHED_PASS",
      "DUPLICATE",
      "MATCHED_PASS",
      "OPTIONAL_EXTRA",
    ]);
    expect(cov.redundantCount).toBe(1);
    expect(cov.extraCount).toBe(1);
  });

  it("strips ANSI escape sequences and summarizes verbose Jest/Supertest errors concisely", () => {
    const rawAnsiWall = `\u001b[1m\u001b[22mTest suite failed to run\u001b[39m\u001b[22m Jest encountered an unexpected token.\nDetails:\nSyntaxError: Cannot use import statement outside a module (tests/integration/ai-d99a539f.test.js:3)`;
    const summary = summarizeIntegrationFailure(rawAnsiWall);
    expect(summary).not.toContain("\u001b");
    expect(summary).not.toContain("Jest encountered an unexpected token");
    expect(summary).toContain("Module syntax mismatch");
  });

  it("converts accidental ESM imports to CommonJS require() when moduleType is commonjs", () => {
    const raw = JSON.stringify({
      suggestions: [],
      tests: [
        {
          filePath: "tests/integration/ai-cjs.test.js",
          content: "import { jest } from '@jest/globals';\nimport request from 'supertest';\nimport app from '../../src/app.js';\ndescribe('GET /', () => { it('returns 200', async () => { const res = await request(app).get('/'); expect(res.status).toBe(200); }); });",
        },
      ],
    });
    const processed = processSupertestTests(raw, {
      projectId: "p1",
      snapshotId: "s1",
      moduleType: "commonjs",
    });
    const code = processed.allTests[0].content;
    expect(code).not.toContain("@jest/globals");
    expect(code).toContain("const request = require('supertest');");
    expect(code).toContain("const app = require('../../src/app.js');");
  });

  it("includes EDGE (exception/500) when source.controllerSnippet or controllerSnippet has try/catch or error handling", () => {
    const epFromParser = {
      method: "POST",
      fullPath: "/summarize",
      controllerSnippet: "static async summarize(req, res) { try { const { content } = req.body; return res.status(200).json({}); } catch (err) { return res.status(500).json({ error: err.message }); } }",
      errorHandling: { hasTryCatch: true },
    };
    const casesParser = getEndpointRequiredCases(epFromParser);
    expect(casesParser.map((c) => c.key)).toEqual(["HAPPY", "VALIDATION", "EDGE"]);

    const epFromWorkspace = {
      method: "GET",
      path: "/api/stats",
      source: {
        controllerSnippet: "const getStats = async (req, res) => { const weekly = await statsService.getWeekly(); res.status(200).json(weekly); };",
        errorHandling: { hasTryCatch: true },
      },
    };
    const casesWorkspace = getEndpointRequiredCases(epFromWorkspace);
    expect(casesWorkspace.map((c) => c.key)).toEqual(["HAPPY", "EDGE"]);
  });

  it("extracts inline scenario code block from @babel/parser AST via extractTestRequests", () => {
    const sample = [
      "import request from 'supertest';",
      "describe('AI API', () => {",
      "  it('POST /summarize returns 500 on service failure', async () => {",
      "    const res = await request(app).post('/summarize').send({ content: 'abc' });",
      "    expect(res.status).toBe(500);",
      "  });",
      "});",
    ].join("\n");
    const reqs = extractTestRequests(sample, "server/tests/integration/api-integration.test.js");
    expect(reqs).toHaveLength(1);
    expect(reqs[0].code).toBeDefined();
    expect(reqs[0].code).toContain("it('POST /summarize returns 500 on service failure'");
    expect(reqs[0].code).toContain("expect(res.status).toBe(500);");
  });

  it("does not require EDGE (500) when catch explicitly returns non-5xx status codes [200, 400]", () => {
    const ep = {
      method: "GET",
      fullPath: "/api/sandbox/payments/checkout-session/:sessionId",
      responseStatusCodes: [200, 400],
      errorHandling: { hasTryCatch: true },
      controllerSnippet:
        "static async getCheckoutSession(req, res) { try { const s = await svc.getCheckoutSession(req.params.sessionId); return res.status(200).json({ data: s }); } catch (err) { return res.status(400).json({ error: err.message }); } }",
    };
    const cases = getEndpointRequiredCases(ep);
    expect(cases.map((c) => c.key)).toEqual(["HAPPY", "VALIDATION", "NOT_FOUND"]);
  });

  it("marks endpoint status Covered when all required cases pass despite unrun duplicate scenarios", () => {
    const metrics = evaluateEndpointMetrics({
      executedCount: 5,
      passedCount: 4,
      failedCount: 0,
      testScriptErrorCount: 0,
      verifiedPassedCount: 2,
      verifiedAssertionFailedCount: 0,
      consistentPassedCount: 4,
      hasRelevantTestFile: true,
      hasObservedServerResponse: true,
      caseCoverageComplete: true,
    });
    expect(metrics.status).toBe("Covered");
  });
});
