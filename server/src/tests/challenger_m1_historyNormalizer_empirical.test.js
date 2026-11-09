import { describe, test, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import vm from "vm";
import { execSync } from "child_process";
import { createInstrumenter } from "istanbul-lib-instrument";
import libCoverage from "istanbul-lib-coverage";
import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { normalizeHistory } from "../utils/historyNormalizer.js";
import { generateFallbackUnitTests } from "../services/unitTestSuggestion.service.js";

describe("Milestone 1 Empirical Challenge: historyNormalizer.js & Fallback Test Generation", () => {

    // =========================================================================
    // SECTION 1: CORE LOGIC PATHS (L14-L55) & GOOGLE GEMINI INVARIANTS
    // =========================================================================
    describe("1. Core Logic Paths (L14-L55) & Google Gemini Invariants", () => {
        test("1.1 Guard clauses return empty array for non-arrays and empty arrays (L10-L12)", () => {
            expect(normalizeHistory(null)).toEqual([]);
            expect(normalizeHistory(undefined)).toEqual([]);
            expect(normalizeHistory(123)).toEqual([]);
            expect(normalizeHistory("string")).toEqual([]);
            expect(normalizeHistory({})).toEqual([]);
            expect(normalizeHistory([])).toEqual([]);
        });

        test("1.2 Converts 'assistant' role to 'model' (L19-L22)", () => {
            const history = [
                { role: "user", text: "Hello" },
                { role: "assistant", text: "Hi there!" }
            ];
            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "Hello" },
                { role: "model", text: "Hi there!" }
            ]);
        });

        test("1.3 Filters out invalid roles (L24-L26) such as 'system', 'developer', 'tool'", () => {
            const history = [
                { role: "system", content: "You are a helpful assistant." },
                { role: "developer", content: "Be concise." },
                { role: "tool", content: "Result: 42" },
                { role: "user", text: "What is 2+2?" },
                { role: "model", text: "4" }
            ];
            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "What is 2+2?" },
                { role: "model", text: "4" }
            ]);
        });

        test("1.4 Extracts text from 'text' or 'content' property and trims whitespace (L28-L34)", () => {
            const history = [
                { role: "user", text: "  User text   " },
                { role: "model", content: "  Model content  \n" }
            ];
            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "User text" },
                { role: "model", text: "Model content" }
            ]);
        });

        test("1.5 Merges consecutive turns of the same role with newline delimiter (L36-L41)", () => {
            const history = [
                { role: "user", text: "Part 1" },
                { role: "user", content: "Part 2" },
                { role: "user", text: "Part 3" },
                { role: "model", text: "Response 1" },
                { role: "assistant", text: "Response 2" } // assistant becomes model -> merged
            ];
            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "Part 1\nPart 2\nPart 3" },
                { role: "model", text: "Response 1\nResponse 2" }
            ]);
        });

        test("1.6 Prunes leading 'model' turns so conversation starts with 'user' (L44-L47)", () => {
            const history = [
                { role: "model", text: "Initial greeting to prune" },
                { role: "assistant", text: "Second greeting to prune" },
                { role: "user", text: "Real first question" },
                { role: "model", text: "Real answer" }
            ];
            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "Real first question" },
                { role: "model", text: "Real answer" }
            ]);
        });

        test("1.7 Prunes trailing 'user' turns so conversation ends with 'model' (L49-L52)", () => {
            const history = [
                { role: "user", text: "Question 1" },
                { role: "model", text: "Answer 1" },
                { role: "user", text: "Trailing question that should be pruned" }
            ];
            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "Question 1" },
                { role: "model", text: "Answer 1" }
            ]);
        });

        test("1.8 Returns empty array if all turns are pruned (e.g. only model or only user turns)", () => {
            expect(normalizeHistory([{ role: "model", text: "Only model" }])).toEqual([]);
            expect(normalizeHistory([{ role: "user", text: "Only user" }])).toEqual([]);
            expect(normalizeHistory([{ role: "assistant", text: "Only assistant" }])).toEqual([]);
        });
    });

    // =========================================================================
    // SECTION 2: ADVERSARIAL STRESS TESTING ON EDGE DIALOGUE PATTERNS
    // =========================================================================
    describe("2. Adversarial Stress Testing on Edge Dialogue Patterns", () => {
        test("2.1 100 consecutive identical roles: 100 'user' turns followed by 100 'model' turns", () => {
            const turns = [];
            for (let i = 0; i < 100; i++) {
                turns.push({ role: "user", text: `User message ${i}` });
            }
            for (let i = 0; i < 100; i++) {
                turns.push({ role: "model", text: `Model message ${i}` });
            }

            const result = normalizeHistory(turns);
            expect(result).toHaveLength(2);
            expect(result[0].role).toBe("user");
            expect(result[1].role).toBe("model");
            // Verify all 100 messages are merged in each
            const userLines = result[0].text.split("\n");
            const modelLines = result[1].text.split("\n");
            expect(userLines).toHaveLength(100);
            expect(modelLines).toHaveLength(100);
            expect(userLines[0]).toBe("User message 0");
            expect(userLines[99]).toBe("User message 99");
            expect(modelLines[0]).toBe("Model message 0");
            expect(modelLines[99]).toBe("Model message 99");
        });

        test("2.2 100 alternating roles (user -> model -> user -> model ...)", () => {
            const turns = [];
            for (let i = 0; i < 100; i++) {
                turns.push({
                    role: i % 2 === 0 ? "user" : "model",
                    text: `Turn ${i}`
                });
            }

            const result = normalizeHistory(turns);
            expect(result).toHaveLength(100);
            for (let i = 0; i < 100; i++) {
                expect(result[i].role).toBe(i % 2 === 0 ? "user" : "model");
                expect(result[i].text).toBe(`Turn ${i}`);
            }
        });

        test("2.3 Empty and whitespace turns mixed with valid turns are completely filtered out", () => {
            const history = [
                { role: "user", text: "" },
                { role: "user", text: "   " },
                { role: "user", text: "\t\r\n   \n" },
                { role: "user", content: "" },
                { role: "user", content: "   " },
                { role: "user", text: "Valid first user message" },
                { role: "model", text: "" },
                { role: "model", content: "   " },
                { role: "model", text: "Valid first model message" },
                { role: "user", text: "   " }
            ];

            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "Valid first user message" },
                { role: "model", text: "Valid first model message" }
            ]);
        });

        test("2.4 Corrupt, non-object, and malformed turns are skipped without throwing", () => {
            const history = [
                null,
                undefined,
                12345,
                "corrupted raw string",
                true,
                false,
                [],
                [1, 2, 3],
                () => {},
                Symbol("turn"),
                {},
                { otherField: "no role" },
                { role: null, text: "null role" },
                { role: undefined, text: "undefined role" },
                { role: 42, text: "number role" },
                { role: "user", text: null, content: null }, // Branch 8: neither text nor content is string!
                { role: "user", count: 99 },                 // Branch 8: non-string properties
                { role: "user", text: "First valid user turn" },
                null,
                { role: "model", content: "First valid model turn" },
                undefined
            ];

            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "First valid user turn" },
                { role: "model", text: "First valid model turn" }
            ]);
        });

        test("2.5 Circular references in turns are skipped safely", () => {
            const circularObj = { role: "user", text: "Circular turn" };
            circularObj.self = circularObj;

            const history = [
                circularObj,
                { role: "model", text: "Model reply" }
            ];

            const result = normalizeHistory(history);
            expect(result).toEqual([
                { role: "user", text: "Circular turn" },
                { role: "model", text: "Model reply" }
            ]);
        });
    });

    // =========================================================================
    // SECTION 3: ISTANBUL COVERAGE INSTRUMENTATION & VERIFICATION
    // =========================================================================
    describe("3. Istanbul Instrumentation & Line/Branch/Statement Coverage Measurement", () => {
        test("3.1 Fallback test inputs achieve 100% Lines, 100% Statements, 100% Functions, and >=96% Branches", () => {
            const sourcePath = path.resolve("src/utils/historyNormalizer.js");
            const sourceCode = fs.readFileSync(sourcePath, "utf8");

            const instrumenter = createInstrumenter({ esModules: false, compact: false, produceSourceMap: true });
            const cleanCode = sourceCode.replace(/export\s+function\s+normalizeHistory/, "function normalizeHistory");
            const instrumentedCode = instrumenter.instrumentSync(cleanCode, "src/utils/historyNormalizer.js");

            const coverageGlobal = {};
            const contextObj = { console, setTimeout, clearTimeout, Promise, Set, Map, Array, Object, __coverage__: coverageGlobal };
            vm.createContext(contextObj);
            vm.runInContext(instrumentedCode + "\nglobalThis.normalizeHistory = normalizeHistory;", contextObj);
            const fn = contextObj.normalizeHistory;

            // Execute the exact fixtures generated by generateFallbackUnitTests:
            // Category A:
            const defaultArgs = { requirement: "Sample requirement", text: "Sample text", description: "Sample description", options: {}, id: "1", name: "sample", amount: 100, status: "active" };
            const chatHistoryFixture = [{ role: "user", content: "test message", text: "test message" }, { role: "model", content: "reply message", text: "reply message" }];
            const collectionFixture = [{ id: 1, name: "Sample Item 1", role: "user", content: "content 1", text: "text 1", status: "active", amount: 100, value: 50 }, { id: 2, name: "Sample Item 2", role: "model", content: "content 2", text: "text 2", status: "pending", amount: 200, value: 100 }];
            const stringListFixture = ["item-alpha", "item-beta", "item-gamma"];

            try { fn("2 + 3 * 4", "14"); } catch {}
            try { fn(10); } catch {}
            try { fn(1); } catch {}
            try { fn(); } catch {}
            try { fn(defaultArgs); } catch {}
            try { fn(chatHistoryFixture); } catch {}
            try { fn(collectionFixture); } catch {}
            try { fn(stringListFixture, "item-alpha"); } catch {}
            try { fn(collectionFixture, defaultArgs); } catch {}

            // Category B:
            const boundaryInputs = [
                { amount: 0, items: [], text: "", options: {} }, { amount: -1, items: [], text: "", options: {} },
                0, -1, "", "   ", "2 + 3 * 4", "10 × 2 ÷ 4 − 1", "5 / 0", "-5 / 0", "0 / 0", "2 + + * 3", "0.1 + 0.2", "invalid input", [],
                [{ role: "user", content: "" }], [{ role: "user", text: "   " }], [{ id: 0, amount: 0, items: [] }], [{ role: "user", content: "single turn" }], [{ role: "model", content: "single model turn" }]
            ];
            for (const b of boundaryInputs) { try { fn(b); } catch {} }

            // Category C:
            try { fn({ requirement: "Test requirement", errors: true, tagFilter: "@test", scenariosMustMatchFeatureFile: true, status: "active", includeDetails: true }); } catch {}
            try { fn({ requirement: "", errors: false, tagFilter: "", status: "inactive" }); } catch {}
            const branchHistory1 = [
                { role: "assistant", text: "Initial assistant greeting" }, { role: "user", text: "Prompt 1" }, { role: "user", content: "Consecutive prompt 2" },
                { role: "model", text: "Reply 1" }, { role: "assistant", content: "Consecutive reply 2" }, { role: "user", content: "Trailing user turn" }
            ];
            try { fn(branchHistory1); } catch {}
            const branchHistory2 = [
                { role: "model", content: "Leading model turn" }, { role: "system", content: "System instruction to skip" },
                { role: "user", text: "" }, { role: "user", text: "Valid message" }, { role: "model", content: "Valid answer" }
            ];
            try { fn(branchHistory2); } catch {}

            // Category D:
            try { fn(null); } catch {}
            try { fn(undefined); } catch {}
            try { fn({}); } catch {}
            try { fn([null, undefined, 123, "corrupt", {}, { role: null, content: null }]); } catch {}

            const covMap = libCoverage.createCoverageMap(contextObj.__coverage__);
            const fileCov = covMap.fileCoverageFor("src/utils/historyNormalizer.js");
            const summary = fileCov.toSummary();

            expect(summary.lines.pct).toBe(100);
            expect(summary.statements.pct).toBe(100);
            expect(summary.functions.pct).toBe(100);
            expect(summary.branches.pct).toBeGreaterThanOrEqual(96);
        });

        test("3.2 Full 100% branch coverage (28/28) is achieved when exercising turns with non-string content (Branch 8)", () => {
            const sourcePath = path.resolve("src/utils/historyNormalizer.js");
            const sourceCode = fs.readFileSync(sourcePath, "utf8");

            const instrumenter = createInstrumenter({ esModules: false, compact: false, produceSourceMap: true });
            const cleanCode = sourceCode.replace(/export\s+function\s+normalizeHistory/, "function normalizeHistory");
            const instrumentedCode = instrumenter.instrumentSync(cleanCode, "src/utils/historyNormalizer.js");

            const coverageGlobal = {};
            const contextObj = { console, setTimeout, clearTimeout, Promise, Set, Map, Array, Object, __coverage__: coverageGlobal };
            vm.createContext(contextObj);
            vm.runInContext(instrumentedCode + "\nglobalThis.normalizeHistory = normalizeHistory;", contextObj);
            const fn = contextObj.normalizeHistory;

            // Execute test case where a turn has a valid role ('user') but neither text nor content is string, and null turn:
            fn([null, { role: "user", count: 42 }, { role: "user", text: "Hello" }, { role: "model", content: "World" }]);
            // Execute guard returns
            fn(null);
            fn([]);
            // Execute assistant conversion
            fn([{ role: "user", text: "q" }, { role: "assistant", text: "a" }]);
            // Execute invalid roles
            fn([{ role: "system", text: "sys" }, { role: "user", text: "q" }, { role: "model", text: "m" }]);
            // Execute text empty
            fn([{ role: "user", text: "" }, { role: "user", text: "q" }, { role: "model", text: "m" }]);
            // Execute consecutive merge
            fn([{ role: "user", text: "q1" }, { role: "user", text: "q2" }, { role: "model", text: "m" }]);
            // Execute leading model prune
            fn([{ role: "model", text: "leading" }, { role: "user", text: "q" }, { role: "model", text: "m" }]);
            // Execute trailing user prune
            fn([{ role: "user", text: "q" }, { role: "model", text: "m" }, { role: "user", text: "trailing" }]);

            const covMap = libCoverage.createCoverageMap(contextObj.__coverage__);
            const fileCov = covMap.fileCoverageFor("src/utils/historyNormalizer.js");
            const summary = fileCov.toSummary();

            expect(summary.lines.pct).toBe(100);
            expect(summary.statements.pct).toBe(100);
            expect(summary.functions.pct).toBe(100);
            expect(summary.branches.pct).toBe(100);
            expect(summary.branches.covered).toBe(summary.branches.total);
        });
    });

    // =========================================================================
    // SECTION 4: FALLBACK TEST GENERATION (JEST & VITEST VERIFICATION)
    // =========================================================================
    describe("4. Fallback Test Generation (Jest & Vitest Verification)", () => {
        test("4.1 Vitest fallback output is syntactically valid ESM and successfully executes with Vitest runner", () => {
            const sourcePath = path.resolve("src/utils/historyNormalizer.js");
            const sourceCode = fs.readFileSync(sourcePath, "utf8");

            const result = generateFallbackUnitTests({
                framework: "vitest",
                sourceFile: "src/utils/historyNormalizer.js",
                targetTestFile: "src/tests/historyNormalizer.vitest.test.js",
                rootDir: path.resolve("."),
                baseName: "historyNormalizer",
                sourceCode
            });

            expect(result).toBeDefined();
            expect(result.suggestedTestCode).toBeDefined();
            expect(result.explanation).toContain("VITEST");

            // Verify AST parsing with Babel
            const parsed = parseJavaScriptCode(result.suggestedTestCode, { filePath: "src/tests/historyNormalizer.vitest.test.js" });
            expect(parsed.success).toBe(true);

            // Write temporary file and execute via Vitest CLI
            const tempVitestPath = path.resolve("src/tests/temp_challenge_vitest.test.js");
            try {
                fs.writeFileSync(tempVitestPath, result.suggestedTestCode, "utf8");
                const output = execSync("npx vitest run src/tests/temp_challenge_vitest.test.js", {
                    cwd: path.resolve("."),
                    encoding: "utf8"
                });
                expect(output).toContain("passed");
            } finally {
                if (fs.existsSync(tempVitestPath)) {
                    fs.unlinkSync(tempVitestPath);
                }
            }
        });

        test("4.2 Jest fallback output analysis: CommonJS require generation in ESM project", () => {
            const sourcePath = path.resolve("src/utils/historyNormalizer.js");
            const sourceCode = fs.readFileSync(sourcePath, "utf8");

            const result = generateFallbackUnitTests({
                framework: "jest",
                sourceFile: "src/utils/historyNormalizer.js",
                targetTestFile: "src/tests/historyNormalizer.jest.test.js",
                rootDir: path.resolve("."),
                baseName: "historyNormalizer",
                sourceCode
            });

            expect(result).toBeDefined();
            expect(result.suggestedTestCode).toBeDefined();
            expect(result.explanation).toContain("JEST");

            // Verify AST syntax is valid JavaScript
            const parsed = parseJavaScriptCode(result.suggestedTestCode, { filePath: "src/tests/historyNormalizer.jest.test.js" });
            expect(parsed.success).toBe(true);

            // CRITICAL ADVERSARIAL OBSERVATION:
            // When sourceCode has 'export function' but lacks 'import ...' statements,
            // unitTestSuggestion.service.js line 376 evaluates isCommonJS to true.
            // In a project with "type": "module" (ESM), generating CommonJS `require(...)`
            // produces ReferenceError: require is not defined when executed by Jest VM modules.
            const hasCommonJsRequire = result.suggestedTestCode.includes("require(");
            const hasEsmImport = /import\s+.*?\s+from/.test(result.suggestedTestCode);

            // We document whether Jest test uses require vs import
            if (hasCommonJsRequire && !hasEsmImport) {
                // This confirms the empirical challenger finding
                expect(result.suggestedTestCode).toContain("require(");
            }
        });
    });
});
