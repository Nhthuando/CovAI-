import fs from "fs";
import path from "path";
import vm from "vm";
import { describe, test, expect } from "@jest/globals";
import { createInstrumenter } from "istanbul-lib-instrument";
import libCoverage from "istanbul-lib-coverage";
import { evaluateUncoverageDiagnostics, UNCOVERAGE_REASON_CATEGORIES } from "../services/uncoverageDiagnostic.service.js";
import { extractLineCoverage, extractStatementFlow, extractBranchFlow, extractFunctionFlow } from "../services/fileCoverage.service.js";
import { generateFallbackUnitTests } from "../services/unitTestSuggestion.service.js";
import { sourceInputContracts } from "../services/unitTestInputContracts.service.js";

describe("Uncoverage Diagnostics & 100% Target Function Coverage Verification", () => {
    const historyNormalizerPath = path.resolve(process.cwd(), "src/utils/historyNormalizer.js");
    const historyNormalizerCode = fs.readFileSync(historyNormalizerPath, "utf8");

    test("1. Diagnoses DEFENSIVE_EARLY_EXIT when normalizeHistory is only called with guard-tripping inputs ([] / null)", () => {
        const instrumenter = createInstrumenter({ esModules: false, compact: false, produceSourceMap: true });
        const cleanCode = historyNormalizerCode.replace(/export\s+function\s+normalizeHistory/, "function normalizeHistory");
        const instrumented = instrumenter.instrumentSync(cleanCode, "server/src/utils/historyNormalizer.js");

        const coverageGlobal = {};
        const ctx = { console, Array, Object, __coverage__: coverageGlobal };
        vm.createContext(ctx);
        vm.runInContext(`${instrumented}\nglobalThis.normalizeHistory = normalizeHistory;`, ctx);

        // Only guard-tripping inputs (reproducing the screenshot bug: 5 calls all hitting L10-L12)
        ctx.normalizeHistory(null);
        ctx.normalizeHistory(undefined);
        ctx.normalizeHistory([]);
        ctx.normalizeHistory({});
        ctx.normalizeHistory(0);

        const fileCovData = Object.values(coverageGlobal)[0];
        const lineCov = extractLineCoverage(fileCovData);
        const statements = extractStatementFlow(fileCovData, historyNormalizerCode);
        const branches = extractBranchFlow(fileCovData, historyNormalizerCode);
        const functions = extractFunctionFlow(fileCovData, historyNormalizerCode);

        const diagnostics = evaluateUncoverageDiagnostics({
            sourceCode: historyNormalizerCode,
            statements,
            branches,
            functions,
            lineCoverage: lineCov
        });

        expect(diagnostics).toBeDefined();
        expect(diagnostics.summary.totalUncoveredLines).toBeGreaterThan(10);
        expect(diagnostics.summary.byReasonCategory[UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT]).toBeGreaterThan(0);

        // Verify L10 branch has DEFENSIVE_EARLY_EXIT explaining False branch was never executed
        const branchL10 = diagnostics.branches.find((b) => b.line === 10);
        expect(branchL10).toBeDefined();
        expect(branchL10.reasonCategory).toBe(UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT);
        expect(branchL10.reason).toMatch(/False branch|early return/i);

        // Verify main logic statements (e.g. L14+) are diagnosed as bypassed by early return guard
        const mainLogicLine = diagnostics.lines.find((l) => l.line >= 14);
        expect(mainLogicLine).toBeDefined();
        expect(mainLogicLine.reasonCategory).toBe(UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT);
        expect(mainLogicLine.reason).toMatch(/bypassed|early-return guard/i);
    });

    test("2. Diagnoses UNREACHABLE_CODE, EXCEPTION_PATH, UNEXERCISED_BRANCH, and UNEXERCISED_FUNCTION accurately", () => {
        const sampleSource = `function processOrder(order) {
    if (!order) {
        return { ok: false };
    }
    try {
        if (order.discount > 50) {
            return { ok: true, vip: true };
            const deadVar = 123;
        }
        return { ok: true, vip: false };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}
function unusedHelper() {
    return 42;
}`;
        const instrumenter = createInstrumenter({ esModules: false, compact: false, produceSourceMap: true });
        const instrumented = instrumenter.instrumentSync(sampleSource, "src/order.js");
        const coverageGlobal = {};
        const ctx = { console, __coverage__: coverageGlobal };
        vm.createContext(ctx);
        vm.runInContext(`${instrumented}\nglobalThis.processOrder = processOrder;`, ctx);

        // Call only with valid order with discount = 10
        ctx.processOrder({ discount: 10 });

        const fileCovData = Object.values(coverageGlobal)[0];
        const lineCov = extractLineCoverage(fileCovData);
        const statements = extractStatementFlow(fileCovData, sampleSource);
        const branches = extractBranchFlow(fileCovData, sampleSource);
        const functions = extractFunctionFlow(fileCovData, sampleSource);

        const diagnostics = evaluateUncoverageDiagnostics({
            sourceCode: sampleSource,
            statements,
            branches,
            functions,
            lineCoverage: lineCov
        });

        const categoriesFound = new Set(diagnostics.items.map((i) => i.reasonCategory));
        expect(categoriesFound.has(UNCOVERAGE_REASON_CATEGORIES.DEFENSIVE_EARLY_EXIT)).toBe(true);
        expect(categoriesFound.has(UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_BRANCH)).toBe(true);
        expect(categoriesFound.has(UNCOVERAGE_REASON_CATEGORIES.EXCEPTION_PATH)).toBe(true);
        expect(categoriesFound.has(UNCOVERAGE_REASON_CATEGORIES.UNEXERCISED_FUNCTION)).toBe(true);
    });

    test("3. Enhanced generateFallbackUnitTests achieves 100% Lines, 100% Statements, 100% Functions, and 100% Branches on historyNormalizer.js", async () => {
        const fallback = generateFallbackUnitTests({
            framework: "vitest",
            sourceFile: "server/src/utils/historyNormalizer.js",
            targetTestFile: "server/tests/utils/historyNormalizer.vitest.test.js",
            baseName: "historyNormalizer",
            uncoveredLines: [14, 15, 16, 17, 18, 20, 24, 28, 34, 37, 45, 50, 54],
            existingContent: "",
            sourceCode: historyNormalizerCode
        });

        expect(fallback.suggestedTestCode).toContain("import { normalizeHistory }");

        const instrumenter = createInstrumenter({ esModules: false, compact: false, produceSourceMap: true });
        const cleanCode = historyNormalizerCode.replace(/export\s+function\s+normalizeHistory/, "function normalizeHistory");
        const instrumented = instrumenter.instrumentSync(cleanCode, "server/src/utils/historyNormalizer.js");

        const coverageGlobal = {};
        const registeredTests = [];
        const expectChain = {
            toBeDefined: () => { },
            toBe: () => { },
            toEqual: () => { }
        };
        const ctx = {
            console,
            setTimeout,
            clearTimeout,
            Promise,
            Set,
            Map,
            Array,
            Object,
            __coverage__: coverageGlobal,
            describe: (_name, fn) => fn(),
            test: (name, fn) => registeredTests.push({ name, fn }),
            it: (name, fn) => registeredTests.push({ name, fn }),
            expect: () => expectChain
        };
        vm.createContext(ctx);
        vm.runInContext(`${instrumented}\nglobalThis.normalizeHistory = normalizeHistory;`, ctx);

        // Strip top-level import lines from generated test code and run all generated tests against instrumented normalizeHistory
        const runnableTestCode = fallback.suggestedTestCode
            .replace(/^\s*import\s+.*?;?\s*$/gm, "")
            .replace(/^\s*const\s+\{[^}]*normalizeHistory[^}]*\}\s*=\s*require\(.*?\);?\s*$/gm, "");

        vm.runInContext(runnableTestCode, ctx);
        expect(registeredTests.length).toBeGreaterThanOrEqual(4);

        for (const t of registeredTests) {
            await t.fn();
        }

        const covMap = libCoverage.createCoverageMap(coverageGlobal);
        const fileCov = covMap.fileCoverageFor("server/src/utils/historyNormalizer.js");
        const summary = fileCov.toSummary();

        expect(summary.lines.pct).toBe(100);
        expect(summary.statements.pct).toBe(100);
        expect(summary.functions.pct).toBe(100);
        expect(summary.branches.pct).toBe(100);
    });

    test("4. sourceInputContracts infers array element schema and synthesizes valid multi-turn history fixture for historyNormalizer.js", () => {
        const result = sourceInputContracts(historyNormalizerCode, {
            sourceFile: historyNormalizerPath
        });
        const fnContract = result.functions.get("normalizeHistory");
        expect(fnContract).toBeDefined();
        expect(fnContract.parameters[0].kind).toBe("array");
        const fixture = fnContract.parameters[0].synthesizedFixture;
        expect(Array.isArray(fixture)).toBe(true);
        expect(fixture.length).toBeGreaterThanOrEqual(2);
        expect(fixture[0].role).toBe("user");
        expect(fixture[1].role).toBe("model");
    });
});

