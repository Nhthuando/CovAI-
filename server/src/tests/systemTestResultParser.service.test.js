import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { parseSystemTestResult } from "../services/systemTestResultParser.service.js";

const paths = [];
const report = (name, value) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-system-report-"));
  paths.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};
afterEach(() => paths.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("parseSystemTestResult", () => {
  const startedAt = new Date("2026-08-22T00:00:00Z");
  const finishedAt = new Date("2026-08-22T00:00:02Z");
  it('retains bounded API method/path/status evidence without query or response secrets', () => {
    const calls = [{ method: 'GET', path: '/api/orders', status: 200, durationMs: 42, requestId: 'req-1' }, { method: 'GET', path: '/api/orders?token=secret', status: 200 }];
    const resultPath = report('api.json', { suites: [{ specs: [{ title: 'orders', tests: [{ results: [{ status: 'passed', attachments: [{ name: 'covai-api-evidence', contentType: 'application/json', body: Buffer.from(JSON.stringify(calls)).toString('base64') }] }] }] }] }] });
    const parsed = parseSystemTestResult({ runner: 'playwright', resultPath, startedAt, finishedAt });
    expect(parsed.scenarios[0].apiCalls).toEqual([{ method: 'GET', path: '/api/orders', status: 200, durationMs: 42, requestId: 'req-1' }]);
  });
  it('retains runtime icon controls from inline and file-backed failure attachments', () => {
    const controls={controls:[{tag:'button',icons:['lucide lucide-pencil']}]};
    const resultPath=report('controls.json',{});
    const rootDir=path.dirname(resultPath);
    const evidencePath=path.join(rootDir,'dom.json');
    fs.writeFileSync(evidencePath,JSON.stringify(controls));
    for(const attachment of [{body:Buffer.from(JSON.stringify(controls)).toString('base64')},{path:evidencePath}]) {
      fs.writeFileSync(resultPath,JSON.stringify({suites:[{specs:[{title:'edit',tests:[{results:[{status:'failed',error:{message:'locator.click: timeout'},attachments:[{name:'covai-interaction-evidence',contentType:'application/json',...attachment}]}]}]}]}]}));
      const parsed=parseSystemTestResult({runner:'playwright',resultPath,startedAt,finishedAt,rootDir});
      expect(JSON.parse(parsed.scenarios[0].domSnapshot)).toEqual(controls);
    }
  });

  it('ignores failure evidence outside the workspace and malformed inline evidence',()=>{
    const resultPath=report('unsafe-controls.json',{}),rootDir=path.dirname(resultPath);
    for(const attachment of [{path:path.join(rootDir,'..','private.json')},{body:'bm90LWpzb24='}]) {
      fs.writeFileSync(resultPath,JSON.stringify({suites:[{specs:[{title:'edit',tests:[{results:[{status:'failed',attachments:[{name:'covai-interaction-evidence',contentType:'application/json',...attachment}]}]}]}]}]}));
      expect(parseSystemTestResult({runner:'playwright',resultPath,startedAt,finishedAt,rootDir}).scenarios[0].domSnapshot).toBeNull();
    }
  });
  it('retains the complete source step plan when execution stops early', () => {
    const resultPath = report('steps.json', { suites: [{ specs: [{ file: 'checkout.spec.js', line: 1, title: 'checkout', tests: [{ results: [{ status: 'failed', steps: [
      { title: 'open', category: 'test.step', duration: 10 },
      { title: 'pay', category: 'test.step', duration: 10, error: { message: 'Payment unavailable' } },
    ] }] }] }] }] });
    const rootDir = path.dirname(resultPath);
    fs.writeFileSync(path.join(rootDir, 'checkout.spec.js'), `test('checkout', async () => {
      await test.step('open', async () => {});
      await test.step('pay', async () => {});
      await test.step('receipt', async () => {});
    });`);
    const parsed = parseSystemTestResult({ runner: 'playwright', resultPath, startedAt, finishedAt, rootDir });
    expect(parsed.scenarios[0].executionDetails.plannedSteps).toEqual(['open', 'pay', 'receipt']);
    expect(parsed.scenarios[0].executionDetails.attempts[0].steps).toHaveLength(2);
  });

  it('prefers the inline outcome checkpoint over an automatic screenshot after cleanup',()=>{
    const resultPath=report('checkpoint.json',{stats:{expected:1},suites:[{specs:[{title:'create task',tests:[{results:[{status:'passed',attachments:[
      {name:'evidence',contentType:'image/png',body:'aW1hZ2U='},
      {name:'screenshot',contentType:'image/png',path:'/after-cleanup.png'},
    ]}]}]}]}]});
    const parsed=parseSystemTestResult({runner:'playwright',resultPath,startedAt,finishedAt});
    expect(parsed.scenarios[0].screenshotSource).toEqual({body:'aW1hZ2U='});
  });

  it("normalizes nested Playwright results", () => {
    const resultPath = report("playwright.json", {
      stats: { duration: 1200 },
      suites: [{ specs: [{ tests: [
        { results: [{ status: "passed" }] },
        { results: [{ status: "failed" }] },
        { results: [{ status: "skipped" }] },
      ] }] }],
    });
    expect(parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt }))
      .toMatchObject({ totalTests: 3, passedTests: 1, failedTests: 1, skippedTests: 1, durationMs: 1200, status: "FAILED" });
  });

  it("normalizes Cypress Mocha JSON", () => {
    const resultPath = report("cypress.json", { stats: { tests: 4, passes: 3, failures: 1, pending: 0, duration: 800 } });
    expect(parseSystemTestResult({ runner: "cypress", resultPath, startedAt, finishedAt }))
      .toMatchObject({ totalTests: 4, passedTests: 3, failedTests: 1, skippedTests: 0, durationMs: 800, status: "FAILED" });
  });

  it("identifies flaky Playwright tests that pass after retry", () => {
    const resultPath = report("playwright-flaky.json", {
      stats: { duration: 2500 },
      suites: [
        {
          title: "login.spec.js",
          file: "tests/e2e/login.spec.js",
          specs: [
            {
              title: "login with credentials",
              tests: [
                {
                  status: "flaky",
                  results: [
                    { status: "failed", duration: 1000, error: { message: "timeout waiting for selector" } },
                    { status: "passed", duration: 800 },
                  ],
                },
              ],
            },
            {
              title: "login with invalid email",
              tests: [
                {
                  status: "expected",
                  results: [{ status: "passed", duration: 700 }],
                },
              ],
            },
          ],
        },
      ],
    });
    const parsed = parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt });
    expect(parsed).toMatchObject({
      totalTests: 2,
      passedTests: 1,
      failedTests: 0,
      flakyTests: 1,
      skippedTests: 0,
      status: "PASSED",
    });
    expect(parsed.scenarios).toHaveLength(2);
    expect(parsed.scenarios[0]).toMatchObject({
      title: "login with credentials",
      status: "flaky",
      suiteName: "login.spec.js",
      failureMessages: ["timeout waiting for selector"],
    });
    expect(parsed.scenarios[1]).toMatchObject({
      title: "login with invalid email",
      status: "passed",
    });
  });

  it("rejects runner errors instead of inventing test cases", () => {
    const resultPath = report("playwright-errors.json", {
      stats: { duration: 92, expected: 0, unexpected: 0 },
      suites: [],
      errors: [
        { message: "Error: Cannot find package '@playwright/test'" },
        { message: "Error: No tests found" },
      ],
    });
    expect(() => parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt })).toThrow("Playwright execution failed");
  });

  it('retains actual parallel starts and each retry step instead of summing away detail', () => {
    const resultPath = report('timeline.json', { suites: [{ specs: [{ title: 'Retry login', tests: [{ status: 'flaky', results: [
      { status: 'failed', startTime: startedAt.toISOString(), duration: 20, steps: [{ title: 'Login', duration: 0, error: { message: 'timeout' } }] },
      { status: 'passed', startTime: finishedAt.toISOString(), duration: 30 },
    ] }] }, { title: 'Parallel', tests: [{ status: 'expected', results: [{ status: 'passed', startTime: startedAt.toISOString(), duration: 10 }] }] }] }] });
    const parsed = parseSystemTestResult({ runner: 'playwright', resultPath, startedAt, finishedAt });
    expect(parsed.scenarios[0].executionDetails.attempts).toHaveLength(2);
    expect(parsed.scenarios[0].executionDetails.attempts[0].steps[0]).toMatchObject({ durationMs: 0, status: 'failed' });
    expect(parsed.scenarios[0].executionDetails.attempts[0].startTime).toBe(parsed.scenarios[1].executionDetails.attempts[0].startTime);
    expect(parsed.scenarios[0].durationMs).toBe(50);
  });

  it('retains flat Cypress Mocha records including pending cases without fabricated timing', () => {
    const pass = { title: 'Home', fullTitle: 'App Home', duration: 0, err: {} };
    const skip = { title: 'Skipped', fullTitle: 'App Skipped', duration: 0, err: {} };
    const fail = { title: 'Login', fullTitle: 'App Login', duration: 13, err: { message: 'bad login' } };
    const resultPath = report('mocha.json', { stats: { tests: 3, passes: 1, failures: 1, pending: 1 }, tests: [pass, skip, fail], passes: [pass], failures: [fail], pending: [skip] });
    const parsed = parseSystemTestResult({ runner: 'cypress', resultPath, startedAt, finishedAt });
    expect(parsed.scenarios.map(s => s.status)).toEqual(['passed', 'skipped', 'failed']);
    expect(parsed.scenarios[0].executionDetails.attempts[0]).toMatchObject({ durationMs: 0, startTime: null, steps: [] });
    expect(parsed.scenarios[2].executionDetails.attempts[0].errors).toEqual(['bad login']);
  });

  it("counts expected failures as passing and skipped cases as skipped", () => {
    const resultPath = report("expected.json", { suites: [{ specs: [{ tests: [
      { status: "expected", expectedStatus: "failed", results: [{ status: "failed" }] },
      { status: "skipped", results: [{ status: "skipped" }] },
    ] }] }] });
    const parsed = parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt });
    expect(parsed).toMatchObject({ totalTests: 2, passedTests: 1, failedTests: 0, skippedTests: 1 });
    expect(parsed.scenarios.map((scenario) => scenario.status)).toEqual(["passed", "skipped"]);
  });

  it("rejects empty execution", () => {
    const resultPath = report("empty.json", { suites: [], stats: { expected: 0 } });
    expect(() => parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt })).toThrow("did not execute any tests");
  });

  it("rejects a missing report", () => {
    expect(() => parseSystemTestResult({ runner: "playwright", resultPath: "missing.json", startedAt, finishedAt }))
      .toThrow(expect.objectContaining({ statusCode: 422 }));
  });
});
