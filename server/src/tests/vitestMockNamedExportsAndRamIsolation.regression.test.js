import { describe, it, expect } from "@jest/globals";
import { generateMathjsMockCode, buildIsolationMockContracts } from "../services/unitTestContextEngineering.service.js";
import { extractSourceImportsAst } from "../services/businessLogicAstAnalyzer.service.js";

describe("Vitest Mock Named Exports and RAM Isolation Regression Tests", () => {
    describe("R1: Specific mathjs RAM Mock Resolution", () => {
        it("generates a complete Vitest mock for mathjs with create, all, and evaluator stubs", () => {
            const mockCode = generateMathjsMockCode("vitest");
            expect(mockCode).toContain("vi.mock('mathjs'");
            expect(mockCode).toContain("create");
            expect(mockCode).toContain("all");
            expect(mockCode).toContain("evaluate");
            expect(mockCode).toContain("compile");
            expect(mockCode).toContain("parse");
            expect(mockCode).toContain("simplify");
            expect(mockCode).toContain("derivative");
            expect(mockCode).toContain("add");
            expect(mockCode).toContain("subtract");
            expect(mockCode).toContain("multiply");
            expect(mockCode).toContain("divide");
        });

        it("generates a complete Jest mock for mathjs with virtual: true", () => {
            const mockCode = generateMathjsMockCode("jest");
            expect(mockCode).toContain("jest.mock('mathjs'");
            expect(mockCode).toContain("virtual: true");
            expect(mockCode).toContain("create");
            expect(mockCode).toContain("all");
        });

        it("automatically injects mathjs mock into isolation contracts when source code uses mathjs", () => {
            const sourceCode = `
                import { create, all } from 'mathjs';
                const math = create(all);
                export function evaluateFormula(expr) {
                    return math.evaluate(expr);
                }
            `;
            const contracts = buildIsolationMockContracts({
                sourceCode,
                framework: "vitest"
            });
            expect(contracts.detectedDependencies).toContain("mathjs");
            expect(contracts.mockPreambleCode).toContain("vi.mock('mathjs'");
            expect(contracts.mockPreambleCode).toContain("create");
            expect(contracts.mockPreambleCode).toContain("all");
        });
    });

    describe("R2: AST-Guided Universal Named Export Extraction", () => {
        it("extracts named imports and default imports from ES Modules", () => {
            const code = `
                import { create, all, evaluate as mathEval } from 'mathjs';
                import express, { Router } from 'express';
                import * as utils from './utils.js';
            `;
            const result = extractSourceImportsAst(code);
            expect(result["mathjs"]).toBeDefined();
            expect(result["mathjs"].names).toContain("create");
            expect(result["mathjs"].names).toContain("all");
            expect(result["mathjs"].names).toContain("evaluate");

            expect(result["express"]).toBeDefined();
            expect(result["express"].default).toBe(true);
            expect(result["express"].names).toContain("Router");

            expect(result["./utils.js"]).toBeDefined();
            expect(result["./utils.js"].namespace).toBe(true);
        });

        it("extracts destructured and default requires from CommonJS", () => {
            const code = `
                const { create, all } = require('mathjs');
                const lodash = require('lodash');
                const { get, set: setProp } = require('lodash');
            `;
            const result = extractSourceImportsAst(code);
            expect(result["mathjs"]).toBeDefined();
            expect(result["mathjs"].names).toContain("create");
            expect(result["mathjs"].names).toContain("all");

            expect(result["lodash"]).toBeDefined();
            expect(result["lodash"].default).toBe(true);
            expect(result["lodash"].names).toContain("get");
            expect(result["lodash"].names).toContain("set");
        });
    });
});
