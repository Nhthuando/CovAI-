import { describe, it, expect } from "@jest/globals";
import { replaceBalancedMethodCall } from "../services/applyTestSuggestion.service.js";
import { cleanAndDeduplicateTestContent } from "../services/testSanitizer.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";

describe("Assertion Regex Parenthesis Safety & Syntax Error Auto-Healing", () => {
    describe("replaceBalancedMethodCall", () => {
        it("safely replaces .toContain with regex arguments containing capture group parentheses", () => {
            const input = "      expect(generateStepCode(stepsWithArgs, 0)).toContain('/^I have (.*) item$/');";
            const result = replaceBalancedMethodCall(input, ["toContain"], ".toBeDefined()");
            expect(result).toBe("      expect(generateStepCode(stepsWithArgs, 0)).toBeDefined();");
            expect(result).not.toContain("item$/'");
        });

        it("safely replaces .toEqual with nested function calls containing parentheses", () => {
            const input = "expect(format(new Date(123456789))).toEqual(buildExpected(a, b));";
            const result = replaceBalancedMethodCall(input, ["toBe", "toEqual"], ".toBeUndefined()");
            expect(result).toBe("expect(format(new Date(123456789))).toBeUndefined();");
        });

        it("safely replaces .toBe with string literal containing escaped characters and parens", () => {
            const input = "expect(res).toBe('value with (parentheses) and \\\'quotes\\\'');";
            const result = replaceBalancedMethodCall(input, ["toBe", "toEqual"], ".toEqual('received')");
            expect(result).toBe("expect(res).toEqual('received');");
        });

        it("safely replaces when argument contains escaped dollar sign and escaped quotes", () => {
            const input = "expect(generateStepCode(stepsWithArgs, 4)).toContain('escaped \\\' chars \\\\$');";
            const result = replaceBalancedMethodCall(input, ["toContain"], ".toBeDefined()");
            expect(result).toBe("expect(generateStepCode(stepsWithArgs, 4)).toBeDefined();");
        });

        it("returns original line if method name does not match", () => {
            const input = "expect(a).toBeGreaterThan(5);";
            const result = replaceBalancedMethodCall(input, ["toContain"], ".toBeDefined()");
            expect(result).toBe("expect(a).toBeGreaterThan(5);");
        });
    });

    describe("cleanAndDeduplicateTestContent syntax healing", () => {
        it("heals orphaned trailing tokens after .toBeDefined() like item$/');", () => {
            const corrupted = `
describe('step-generation', () => {
  it('should generate step code', () => {
    expect(generateStepCode(stepsWithArgs, 0)).toBeDefined() item$/');
  });
});
`;
            const healed = cleanAndDeduplicateTestContent(corrupted, "", "tests/step-generation.test.ts");
            expect(healed).toContain("expect(generateStepCode(stepsWithArgs, 0)).toBeDefined();");
            expect(healed).not.toContain("item$/'");
            
            const parsed = parseJavaScriptCode(healed);
            expect(parsed.success).toBe(true);
            expect(parsed.error).toBeUndefined();
        });

        it("heals orphaned trailing tokens with double semicolons", () => {
            const corrupted = `
describe('suite', () => {
  it('test', () => {
    expect(target).toBeDefined() item$/');;
  });
});
`;
            const healed = cleanAndDeduplicateTestContent(corrupted);
            expect(healed).toContain("expect(target).toBeDefined();");
            expect(healed).not.toContain("item$/'");
            
            const parsed = parseJavaScriptCode(healed);
            expect(parsed.success).toBe(true);
        });

        it("heals orphaned tokens after .toBeUndefined()", () => {
            const corrupted = `
describe('suite', () => {
  it('test', () => {
    expect(fn()).toBeUndefined() randomGarbage();
  });
});
`;
            const healed = cleanAndDeduplicateTestContent(corrupted);
            expect(healed).toContain("expect(fn()).toBeUndefined();");
            expect(healed).not.toContain("randomGarbage");
            
            const parsed = parseJavaScriptCode(healed);
            expect(parsed.success).toBe(true);
        });

        it("preserves valid inline comments following .toBeDefined()", () => {
            const valid = `
describe('suite', () => {
  it('test', () => {
    expect(res).toBeDefined(); // valid comment
  });
});
`;
            const result = cleanAndDeduplicateTestContent(valid);
            expect(result).toContain("expect(res).toBeDefined(); // valid comment");
            
            const parsed = parseJavaScriptCode(result);
            expect(parsed.success).toBe(true);
        });

        it("handles realistic step-generation.test.ts scenario without syntax errors", () => {
            const code = `
import { generateStepCode } from '../../src/code-generation/step-generation';

describe('Indirect coverage of internal helpers', () => {
  it('should indirectly cover convertStepTextToRegex with different argument types', () => {
    const stepsWithArgs = [
      { keyword: 'Given', stepText: 'I have {int} item', stepArgument: undefined, line: 1, id: '1' }
    ];
    expect(generateStepCode(stepsWithArgs, 0)).toBeDefined() item$/');
    expect(generateStepCode(stepsWithArgs, 1)).toContain('/^Name is \"(.*)\"$/');
  });
});
`;
            const healed = cleanAndDeduplicateTestContent(code, "", "tests/code-generation/step-generation.test.ts");
            const parsed = parseJavaScriptCode(healed);
            expect(parsed.success).toBe(true);
            expect(healed).toContain("expect(generateStepCode(stepsWithArgs, 0)).toBeDefined();");
        });
    });
});
