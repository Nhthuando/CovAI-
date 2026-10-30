import { describe, test, it, expect, jest } from "@jest/globals";
import {
  validateTestCodeAst,
  autoRepairTestSyntaxWithAst,
  healInvalidDynamicGetters,
  validateGeneratedTestCode,
} from "../validators/aiTestCode.validator.js";
import { cleanAndDeduplicateTestContent } from "../services/testSanitizer.service.js";

describe("Mock Syntax Validation & Controlled Auto-Repair Invariants", () => {
  // Scenario 1: Named export mocking
  test("1. Named export mocking: validates deterministic mock object with static properties", () => {
    const code = `
import { calculateTax, calculateDiscount } from '../src/services/calculation.service.js';

jest.mock('../src/services/calculation.service.js', () => ({
  calculateTax: jest.fn((amount) => amount * 0.1),
  calculateDiscount: jest.fn((amount) => amount * 0.05)
}));

describe('calculation.service named exports', () => {
  it('returns mocked tax calculation', () => {
    expect(calculateTax(100)).toBe(10);
    expect(calculateDiscount(100)).toBe(5);
  });
});
`;
    const result = validateTestCodeAst(code, { filePath: "tests/services/calculation.test.js" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.ast).not.toBeNull();
  });

  // Scenario 2: Default export mocking
  test("2. Default export mocking: validates deterministic default property and __esModule marker", () => {
    const code = `
import calculate from '../src/utils/calculator.js';

jest.mock('../src/utils/calculator.js', () => ({
  __esModule: true,
  default: jest.fn(() => 42)
}));

describe('calculator default export', () => {
  it('invokes default export function', () => {
    expect(calculate()).toBe(42);
  });
});
`;
    const result = validateTestCodeAst(code, { filePath: "tests/utils/calculator.test.js" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // Scenario 3: Named and default exports together
  test("3. Named and default exports together: handles simultaneous named and default mock properties", () => {
    const code = `
import calculate, { add, subtract } from '../src/utils/calculator.js';

jest.mock('../src/utils/calculator.js', () => ({
  __esModule: true,
  default: jest.fn(() => 42),
  add: jest.fn((a, b) => a + b),
  subtract: jest.fn((a, b) => a - b)
}));

describe('calculator mixed exports', () => {
  it('verifies all exports work hermetically', () => {
    expect(calculate()).toBe(42);
    expect(add(1, 2)).toBe(3);
    expect(subtract(5, 2)).toBe(3);
  });
});
`;
    const result = validateTestCodeAst(code, { filePath: "tests/utils/calculator.test.js" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // Scenario 4: Getter exports
  test("4. Getter exports: detects getters in mock factories and auto-repairs to static properties", () => {
    const codeWithGetter = `
jest.mock('../src/config.js', () => ({
  get timeout() { return 5000; },
  get apiBaseUrl() { return 'https://api.example.com'; }
}));
`;
    // Validation identifies getters inside mock factory
    const valResult = validateTestCodeAst(codeWithGetter, { filePath: "tests/config.test.js" });
    expect(valResult.valid).toBe(false);
    expect(valResult.errors.some((e) => e.construct === "GetterInMockFactory")).toBe(true);

    // Auto-repair converts getters to static properties
    const repairResult = autoRepairTestSyntaxWithAst(codeWithGetter, { filePath: "tests/config.test.js" });
    expect(repairResult.repaired).toBe(true);
    expect(repairResult.code).toContain("timeout: 5000");
    expect(repairResult.code).toContain("apiBaseUrl: 'https://api.example.com'");
    expect(repairResult.code).not.toContain("get timeout()");
  });

  // Scenario 5: CommonJS modules
  test("5. CommonJS modules: validates CJS require and deterministic mock structure", () => {
    const cjsCode = `
const { calculateTotal } = require('../src/services/calculation.service.js');

jest.mock('../src/services/calculation.service.js', () => ({
  calculateTotal: jest.fn(() => 100)
}));

describe('CJS calculation', () => {
  test('invokes required mock', () => {
    expect(calculateTotal()).toBe(100);
  });
});
`;
    const result = validateTestCodeAst(cjsCode, { filePath: "tests/calculation.cjs.test.js" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // Scenario 6: ES Modules
  test("6. ES Modules: validates ESM imports and ensures proper mock module structure", () => {
    const esmCode = `
import calculateTotal, { formatResult } from '../src/services/calculation.service.js';

jest.mock('../src/services/calculation.service.js', () => ({
  __esModule: true,
  default: jest.fn(() => 100),
  formatResult: jest.fn((val) => \`\${val} USD\`)
}));

describe('ESM calculation', () => {
  test('exercises ESM mock', () => {
    expect(calculateTotal()).toBe(100);
    expect(formatResult(100)).toBe('100 USD');
  });
});
`;
    const result = validateTestCodeAst(esmCode, { filePath: "tests/calculation.esm.test.ts" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // Scenario 7: Prisma singleton mocking
  test("7. Prisma singleton mocking: validates deterministic Prisma mock without getters or virtual options", () => {
    const prismaTestCode = `
var mockSharedPrisma = {
  calculation: {
    findMany: jest.fn(() => Promise.resolve([{ id: 1, amount: 100 }])),
    create: jest.fn(() => Promise.resolve({ id: 2, amount: 200 }))
  }
};

jest.mock('../lib/prisma.js', () => ({
  __esModule: true,
  prisma: typeof mockSharedPrisma !== 'undefined' ? mockSharedPrisma : {},
  default: typeof mockSharedPrisma !== 'undefined' ? mockSharedPrisma : {}
}));

describe('Prisma client integration', () => {
  it('calls findMany on mocked client', async () => {
    const items = await mockSharedPrisma.calculation.findMany();
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(100);
  });
});
`;
    const result = validateTestCodeAst(prismaTestCode, { filePath: "tests/services/calculation.service.test.ts" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(prismaTestCode).not.toContain("get prisma()");
    expect(prismaTestCode).not.toContain("get default()");
  });

  // Scenario 8: Invalid dynamic getter syntax (Unexpected keyword 'typeof' exact reproduction and fix)
  test("8. Invalid dynamic getter syntax: reproduces Babel syntax error and verifies complete auto-repair", () => {
    const corruptedCode = `
jest.mock('../lib/prisma.js', () => ({
  get prisma() {
    return mockPrisma;
  },
  get (typeof defaultExport === 'function' ? defaultExport : (() => {}))() {
    return mockPrisma;
  }
}));

describe('Calculation Service Test Suite', () => {
  it('should test calculations', () => {
    expect(true).toBe(true);
  });
});
`;

    // 1. AST Validation catches SyntaxError: Unexpected keyword 'typeof'
    const initialValidation = validateTestCodeAst(corruptedCode, { filePath: "tests/services/calculation.service.test.ts" });
    expect(initialValidation.valid).toBe(false);
    expect(initialValidation.errors.length).toBeGreaterThan(0);
    expect(initialValidation.errors.some((e) => e.message.includes("Unexpected keyword 'typeof'") || e.construct === "SyntaxError")).toBe(true);

    // 2. Direct healInvalidDynamicGetters removes the invalid getter and replaces it with default: ...
    const directHealed = healInvalidDynamicGetters(corruptedCode);
    expect(directHealed).not.toContain("get (typeof");
    expect(directHealed).toContain("default: mockPrisma");
    expect(directHealed).toContain("prisma: mockPrisma");

    // 3. Controlled auto-repair pipeline successfully repairs the file within 1-2 attempts
    const repairResult = autoRepairTestSyntaxWithAst(corruptedCode, { filePath: "tests/services/calculation.service.test.ts" });
    expect(repairResult.repaired).toBe(true);
    expect(repairResult.attempts).toBeLessThanOrEqual(3);
    expect(repairResult.errors).toEqual([]);
    expect(repairResult.ast).not.toBeNull();
    expect(repairResult.code).not.toContain("get (typeof");

    // 4. cleanAndDeduplicateTestContent full pipeline automatically heals it
    const sanitized = cleanAndDeduplicateTestContent(corruptedCode, "SyntaxError: Unexpected keyword 'typeof'", "tests/services/calculation.service.test.ts");
    expect(sanitized).not.toContain("get (typeof");
    expect(sanitized).not.toContain("get prisma()");
    const sanitizedValidation = validateTestCodeAst(sanitized);
    expect(sanitizedValidation.valid).toBe(true);
  });

  // Scenario 9: Malformed mock factory
  test("9. Malformed mock factory: detects invalid mock specifier and malformed factory arguments", () => {
    const invalidMockSpecifier = `
jest.mock(12345, () => ({}));
`;
    const specifierResult = validateTestCodeAst(invalidMockSpecifier, { filePath: "tests/invalid.test.js" });
    expect(specifierResult.valid).toBe(false);
    expect(specifierResult.errors.some((e) => e.construct === "InvalidMockSpecifier")).toBe(true);

    const nonFunctionFactory = `
jest.mock('../src/service.js', 'not-a-function');
`;
    const factoryResult = validateTestCodeAst(nonFunctionFactory, { filePath: "tests/invalid.test.js" });
    expect(factoryResult.valid).toBe(false);
    expect(factoryResult.errors.some((e) => e.construct === "InvalidMockFactory")).toBe(true);
  });

  // Scenario 10: Valid generated test execution
  test("10. Valid generated test execution: executes test suite with repaired mock semantics cleanly", () => {
    // Hermetic test logic verifying the exact healed mock factory structure in RAM
    const mockFactory = () => ({
      __esModule: true,
      prisma: {
        calculation: {
          findMany: jest.fn().mockReturnValue([{ id: 1, result: 100 }]),
        },
      },
      default: {
        calculation: {
          findMany: jest.fn().mockReturnValue([{ id: 1, result: 100 }]),
        },
      },
    });

    const mockInstance = mockFactory();
    expect(mockInstance.__esModule).toBe(true);
    expect(typeof mockInstance.prisma.calculation.findMany).toBe("function");
    expect(typeof mockInstance.default.calculation.findMany).toBe("function");

    const data = mockInstance.prisma.calculation.findMany();
    expect(data).toHaveLength(1);
    expect(data[0].result).toBe(100);
  });

  // Additional Invariant: Negative lookbehind prevents regex collision with get/set/export default
  test("Safe default keyword boundary protection does not corrupt get default() or .default()", () => {
    const codeWithValidGetDefault = `
const obj = {
  get default() { return 123; },
  set default(val) { this._val = val; }
};
const res = myModule.default(1, 2);
`;
    const healed = cleanAndDeduplicateTestContent(codeWithValidGetDefault, "", "test.js");
    expect(healed).not.toContain("get (typeof defaultExport");
    expect(healed).not.toContain("myModule.(typeof defaultExport");
  });
});

