import {
    normalizePath,
    matchesFilePath,
    parseAssertionFailuresForFile,
    extractLineCoverage,
    extractStatementFlow,
    extractBranchFlow,
    extractFunctionFlow
} from "../services/fileCoverage.service.js";

describe("fileCoverage.service unit tests", () => {
    describe("path helpers", () => {
        test("normalizes windows and unix paths correctly", () => {
            expect(normalizePath("src\\controllers\\user.js")).toBe("src/controllers/user.js");
            expect(normalizePath("./src/controllers/user.js")).toBe("src/controllers/user.js");
            expect(normalizePath("/src/controllers/user.js")).toBe("src/controllers/user.js");
        });

        test("matchesFilePath compares relative and container paths", () => {
            const target = "src/calculator.js";
            expect(matchesFilePath("/app/uploads/snapshots/snap1/src/calculator.js", target)).toBe(true);
            expect(matchesFilePath("D:\\repo\\src\\calculator.js", target)).toBe(true);
            expect(matchesFilePath("src/calculator.js", target)).toBe(true);
            expect(matchesFilePath("src/other.js", target)).toBe(false);
        });
    });

    describe("parseAssertionFailuresForFile", () => {
        test("extracts line numbers from stack traces matching the target file", () => {
            const testResults = {
                testResults: [
                    {
                        assertionResults: [
                            {
                                status: "failed",
                                failureMessages: [
                                    "Error: expect(received).toBe(expected)\nExpected: 4\nReceived: 5\n    at Object.<anonymous> (/workspace/src/calculator.js:19:12)\n    at Object.test (/workspace/tests/calc.test.js:10:5)"
                                ]
                            }
                        ]
                    }
                ]
            };

            const failures = parseAssertionFailuresForFile(testResults, "src/calculator.js");
            expect(failures["19"]).toBeDefined();
            expect(failures["19"].line).toBe(19);
            expect(failures["19"].message).toContain("Error: expect(received).toBe(expected)");
            expect(failures["10"]).toBeUndefined(); // Belongs to tests/calc.test.js, not src/calculator.js
        });

        test("quality rule: does not mark any line failed if stack trace does not mention the target file", () => {
            const testResults = {
                testResults: [
                    {
                        assertionResults: [
                            {
                                status: "failed",
                                failureMessages: [
                                    "Error: network error\n    at Object.<anonymous> (/workspace/src/api.js:55:10)"
                                ]
                            }
                        ]
                    }
                ]
            };

            const failures = parseAssertionFailuresForFile(testResults, "src/calculator.js");
            expect(Object.keys(failures).length).toBe(0);
        });
    });

    describe("extractLineCoverage", () => {
        const sampleCoverage = {
            statementMap: {
                "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } },
                "1": { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
                "2": { start: { line: 5, column: 4 }, end: { line: 5, column: 25 } },
                "3": { start: { line: 8, column: 4 }, end: { line: 8, column: 20 } }
            },
            s: {
                "0": 2, // covered
                "1": 2, // covered
                "2": 0, // uncovered statement
                "3": 1  // covered
            },
            branchMap: {
                "0": {
                    line: 8,
                    type: "if",
                    locations: [
                        { start: { line: 8, column: 4 }, end: { line: 8, column: 20 } },
                        { start: { line: 9, column: 4 }, end: { line: 9, column: 20 } }
                    ]
                }
            },
            b: {
                "0": [1, 0] // branch 1 taken, branch 2 missed
            }
        };

        test("classifies lines into covered (✓), uncovered (⚑), and failed (×)", () => {
            const assertionFailures = {
                "2": { line: 2, message: "AssertionError: expected true", fullStack: "..." }
            };

            const result = extractLineCoverage(sampleCoverage, assertionFailures);

            // Line 1: covered
            expect(result.lines[1]).toBeDefined();
            expect(result.lines[1].status).toBe("covered");
            expect(result.lines[1].icon).toBe("✓");

            // Line 2: failed assertion (priority over covered)
            expect(result.lines[2]).toBeDefined();
            expect(result.lines[2].status).toBe("failed");
            expect(result.lines[2].icon).toBe("×");

            // Line 5: uncovered statement
            expect(result.lines[5]).toBeDefined();
            expect(result.lines[5].status).toBe("uncovered");
            expect(result.lines[5].icon).toBe("⚑");

            // Line 9: uncovered branch
            expect(result.lines[9]).toBeDefined();
            expect(result.lines[9].status).toBe("uncovered");
            expect(result.lines[9].icon).toBe("⚑");
        });
    });

    describe("extractStatementFlow, extractBranchFlow, extractFunctionFlow", () => {
        const sampleCode = [
            "export const add = (a, b) => a + b;",
            "export const divide = (a, b) => {",
            "    if (b === 0) throw new Error('Divide by zero');",
            "    return a / b;",
            "};"
        ].join("\n");

        const sampleCoverage = {
            statementMap: {
                "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 35 } },
                "1": { start: { line: 2, column: 0 }, end: { line: 5, column: 2 } },
                "2": { start: { line: 3, column: 4 }, end: { line: 3, column: 51 } },
                "3": { start: { line: 4, column: 4 }, end: { line: 4, column: 17 } }
            },
            s: { "0": 6, "1": 7, "2": 7, "3": 4 },
            branchMap: {
                "0": {
                    line: 3,
                    type: "if",
                    locations: [
                        { start: { line: 3, column: 17 }, end: { line: 3, column: 51 } },
                        { start: { line: 4, column: 4 }, end: { line: 4, column: 17 } }
                    ]
                }
            },
            b: { "0": [3, 4] },
            fnMap: {
                "0": { name: "(anonymous_0)", line: 1, loc: { start: { line: 1, column: 19 }, end: { line: 1, column: 35 } } },
                "1": { name: "(anonymous_1)", line: 2, loc: { start: { line: 2, column: 22 }, end: { line: 5, column: 1 } } }
            },
            f: { "0": 6, "1": 7 }
        };

        test("extractStatementFlow creates ordered statement steps with code snippets and hits", () => {
            const stmts = extractStatementFlow(sampleCoverage, sampleCode);
            expect(stmts.length).toBe(4);
            expect(stmts[0].stepIndex).toBe(1);
            expect(stmts[0].startLine).toBe(1);
            expect(stmts[0].hits).toBe(6);
            expect(stmts[0].covered).toBe(true);

            expect(stmts[2].startLine).toBe(3);
            expect(stmts[2].type).toBe("condition");
            expect(stmts[2].codeSnippet).toContain("if (b === 0)");
        });

        test("extractBranchFlow creates decision points with True/False paths and hit counts", () => {
            const branches = extractBranchFlow(sampleCoverage, sampleCode);
            expect(branches.length).toBe(1);
            const br = branches[0];
            expect(br.line).toBe(3);
            expect(br.type).toBe("if");
            expect(br.condition).toBe("b === 0");
            expect(br.totalHits).toBe(7);
            expect(br.status).toBe("fully_covered");
            expect(br.paths.length).toBe(2);

            expect(br.paths[0].type).toBe("True");
            expect(br.paths[0].hits).toBe(3);
            expect(br.paths[0].covered).toBe(true);

            expect(br.paths[1].type).toBe("False");
            expect(br.paths[1].hits).toBe(4);
            expect(br.paths[1].covered).toBe(true);
        });

        test("extractFunctionFlow resolves real function names from arrow function declarations", () => {
            const fns = extractFunctionFlow(sampleCoverage, sampleCode);
            expect(fns.length).toBe(2);
            expect(fns[0].name).toBe("(anonymous_0)");
            expect(fns[0].realName).toBe("add");
            expect(fns[0].hits).toBe(6);
            expect(fns[0].covered).toBe(true);

            expect(fns[1].name).toBe("(anonymous_1)");
            expect(fns[1].realName).toBe("divide");
            expect(fns[1].hits).toBe(7);
        });
    });
});

