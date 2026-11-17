import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { deriveRunStatusNotices, parseJestResults } from "../services/testResultParser.service.js";
import { stripAnsi } from "../utils/pathSanitizer.js";

describe("stripAnsi", () => {
    it("removes ANSI codes from Jest failure snippets", () => {
        const snippet = "\u001b[0m\u001b[31m\u001b[1m>\u001b[22m\u001b[39m\u001b[90m 1 |\u001b[39m require(\u001b[32m'x'\u001b[39m)";
        expect(stripAnsi(snippet)).toBe("> 1 | require('x')");
    });

    it("leaves plain text unchanged", () => {
        expect(stripAnsi("Cannot find module 'x'")).toBe("Cannot find module 'x'");
    });

    it("removes lone escape characters and preserves nullish values", () => {
        expect(stripAnsi("before\u001bafter")).toBe("beforeafter");
        expect(stripAnsi(null)).toBeNull();
        expect(stripAnsi(undefined)).toBeUndefined();
    });
});

describe("unit run status notices", () => {
    let coverageDir;

    beforeEach(() => {
        coverageDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-unit-status-"));
        jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(coverageDir, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    const parse = (raw) => {
        fs.writeFileSync(path.join(coverageDir, "jest-results.json"), JSON.stringify(raw));
        return parseJestResults(coverageDir, { rootDir: coverageDir });
    };

    const partialRun = () => ({
        success: false,
        numTotalTests: 7,
        numPassedTests: 6,
        numFailedTests: 1,
        testResults: [{
            testFilePath: "tests/basic.test.js",
            status: "failed",
            assertionResults: Array.from({ length: 7 }, (_, i) => ({
                title: `assertion ${i + 1}`,
                status: i < 6 ? "passed" : "failed",
                failureMessages: i < 6 ? [] : ["Expected 2, received 1"],
            })),
        }],
    });

    it("preserves Jest suite-load errors and their suite path", () => {
        const result = parse({
            success: false,
            numRuntimeErrorTestSuites: 1,
            testResults: [{
                name: "tests/basic.test.js",
                status: "failed",
                assertionResults: [],
                failureMessage: "Cannot find module 'covai-qa-nonexistent-module'",
            }],
        });

        expect(result.status).toBe("FAILED");
        expect(result.scenarios).toEqual([expect.objectContaining({
            isSuiteLevelFailure: true,
            testFile: "tests/basic.test.js",
            failureMessages: [expect.stringContaining("Cannot find module 'covai-qa-nonexistent-module'")],
        })]);
        expect(deriveRunStatusNotices(result)).toMatchObject({
            latestRunStatus: "failed",
            failedSuites: ["tests/basic.test.js"],
        });
    });

    it("preserves runtime errors supplied through testExecError", () => {
        const result = parse({ testResults: [{
            testFilePath: "tests/basic.test.js",
            assertionResults: [],
            testExecError: { message: "SyntaxError: Unexpected token" },
        }] });
        expect(result.scenarios[0]).toMatchObject({
            isSuiteLevelFailure: true,
            testFile: "tests/basic.test.js",
            failureMessages: ["SyntaxError: Unexpected token"],
        });
    });

    it("preserves six passing assertions and one failing assertion with its suite path", () => {
        const result = parse(partialRun());
        expect(result).toMatchObject({ totalTests: 7, passedTests: 6, failedTests: 1 });
        expect(result.scenarios.find(s => s.status === "failed").testFile).toBe("tests/basic.test.js");
        expect(deriveRunStatusNotices(result, { status: "SUCCESS" })).toMatchObject({
            latestRunStatus: "passed_with_failures",
            isFatalFailure: false,
            failedSuites: ["tests/basic.test.js"],
        });
    });

    it("derives counts from assertions when Jest omits the top-level counts", () => {
        const raw = partialRun();
        delete raw.numTotalTests;
        delete raw.numPassedTests;
        delete raw.numFailedTests;
        expect(parse(raw)).toMatchObject({ totalTests: 7, passedTests: 6, failedTests: 1 });
    });

    it("derives fatal status from a persisted failed job without a suite marker", () => {
        const result = parse(partialRun());
        expect(deriveRunStatusNotices(result, { status: "FAILED", errorMessage: "Runner stopped" }))
            .toMatchObject({ latestRunStatus: "failed", failedSuites: ["tests/basic.test.js"] });
    });

    it("lists every failed suite even when failure messages are absent", () => {
        expect(deriveRunStatusNotices({
            failedTests: 3,
            scenarios: ["tests/basic.test.js", "tests/other.test.js", "tests/basic.test.js"]
                .map(testFile => ({ status: "failed", testFile, failureMessages: [] })),
        })).toMatchObject({
            latestRunStatus: "passed_with_failures",
            failedSuites: ["tests/basic.test.js", "tests/other.test.js"],
        });
    });
});
