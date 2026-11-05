import { describe, it, expect } from "@jest/globals";
import { healMissingMockNamedExports } from "../services/testSanitizer.service.js";

describe("Vitest Mock Auto-Healing Regression Tests (R3)", () => {
        it("heals mathjs mock by injecting create and all when missing export error is detected", () => {
                const testCode = `
import { describe, it, expect, vi } from 'vitest';
vi.mock('mathjs', () => ({
  default: {}
}));

describe('Evaluator', () => {
  it('evaluates', () => {
    expect(true).toBe(true);
  });
});
        `;

                const rawOutput = `
Test Runner Error: [vitest] No "create" export is defined on the "mathjs" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:
        `;

                const healed = healMissingMockNamedExports(testCode, rawOutput, { framework: "vitest" });
                expect(healed).toContain("create:");
                expect(healed).toContain("vi.fn");
                expect(healed).toContain("evaluate");
        });

        it("heals mathjs block return factory by injecting missing stubs", () => {
                const testCode = `
import { describe, it, expect, vi } from 'vitest';
vi.mock('mathjs', () => {
  const handler = { get: () => vi.fn() };
  return { default: new Proxy(vi.fn(), handler) };
});

describe('Math', () => {
  it('calculates', () => {});
});
        `;

                const rawOutput = `
Error: [vitest] No "create" export is defined on the "mathjs" mock. Did you forget to return it from "vi.mock"?
        `;

                const healed = healMissingMockNamedExports(testCode, rawOutput, { framework: "vitest" });
                expect(healed).toContain("return {");
                expect(healed).toContain("create:");
                expect(healed).toContain("default:");
        });

        it("heals generic third-party library missing exports like date-fns", () => {
                const testCode = `
import { describe, it, expect, vi } from 'vitest';
vi.mock('date-fns', () => ({
  default: vi.fn()
}));
        `;

                const rawOutput = `
Error: [vitest] No "format" export is defined on the "date-fns" mock. Did you forget to return it from "vi.mock"?
Error: [vitest] No "parseISO" export is defined on the "date-fns" mock. Did you forget to return it from "vi.mock"?
        `;

                const healed = healMissingMockNamedExports(testCode, rawOutput, { framework: "vitest" });
                expect(healed).toContain("format: vi.fn()");
                expect(healed).toContain("parseISO: vi.fn()");
        });

        it("synthesizes brand new vi.mock if module was unmocked or bare automocked", () => {
                const testCode = `
import { describe, it, expect } from 'vitest';

describe('Something', () => {
  it('runs', () => {});
});
        `;

                const rawOutput = `
Error: [vitest] No "create" export is defined on the "mathjs" mock. Did you forget to return it from "vi.mock"?
        `;

                const healed = healMissingMockNamedExports(testCode, rawOutput, { framework: "vitest" });
                expect(healed).toContain("vi.mock('mathjs'");
                expect(healed).toContain("create:");
                expect(healed).toContain("describe('Something'");
        });

        it("returns unmodified code when output contains no missing mock export errors", () => {
                const testCode = `const x = 1;`;
                const rawOutput = `All tests passed cleanly!`;
                const healed = healMissingMockNamedExports(testCode, rawOutput);
                expect(healed).toBe(testCode);
        });
});

