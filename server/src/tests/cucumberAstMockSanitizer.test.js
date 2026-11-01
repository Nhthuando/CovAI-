import { jest } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    healCucumberAstMocks,
    cleanAndDeduplicateTestContent
} from "../services/testSanitizer.service.js";
import { autoHealTestFailures } from "../services/applyTestSuggestion.service.js";

describe("Cucumber AST Mock Sanitizer & TypeError Auto-Healing", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cucumber-heal-test-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("healCucumberAstMocks injects stepText and keyword when text is provided", () => {
        const input = `
describe('test', () => {
  const mockFeature = {
    scenarioOutlines: [
      {
        lineNumber: 10,
        steps: [
          { lineNumber: 11, text: 'Given a step in outline' },
        ],
      },
    ],
  };
});
`;
        const healed = healCucumberAstMocks(input);
        expect(healed).toContain("stepText: 'Given a step in outline'");
        expect(healed).toContain("keyword: 'Given'");
        expect(healed).toContain("title: 'Scenario 10'");
    });

    test("healCucumberAstMocks injects title and empty steps for scenario outlines and scenarios", () => {
        const input = `
  const featureWithCustomType = {
    scenarioOutlines: [],
    scenarios: [
      {
        lineNumber: 30,
        steps: [],
      },
    ],
  };
`;
        const healed = healCucumberAstMocks(input);
        expect(healed).toContain("title: 'Scenario 30'");
        expect(healed).toContain("lineNumber: 30");
        expect(healed).toContain("steps: []");
    });

    test("cleanAndDeduplicateTestContent automatically runs healCucumberAstMocks", () => {
        const input = `
import { generateCodeFromFeature } from '../../src/code-generation/generate-code-by-line-number';

describe('generate-code-by-line-number', () => {
  const mockFeature: any = {
    scenarios: [
      {
        lineNumber: 20,
        steps: [
          { lineNumber: 21, text: 'Given a step in scenario' },
        ],
      },
    ],
  };

  it('should generate code', () => {
    expect(mockFeature).toBeDefined();
  });
});
`;
        const cleaned = cleanAndDeduplicateTestContent(input, "", "tests/code-generation/generate-code-by-line-number.test.ts");
        expect(cleaned).toContain("stepText: 'Given a step in scenario'");
        expect(cleaned).toContain("keyword: 'Given'");
        expect(cleaned).toContain("title: 'Scenario 20'");
    });

    test("autoHealTestFailures heals test file encountering TypeError: Cannot read properties of undefined (reading 'match')", () => {
        const testFile = path.join(tempDir, "tests", "generate-code-by-line-number.test.ts");
        fs.mkdirSync(path.dirname(testFile), { recursive: true });
        fs.writeFileSync(testFile, `
// @ts-nocheck
import { generateCodeFromFeature } from '../../src/code-generation/generate-code-by-line-number';

describe('generate-code-by-line-number', () => {
  const mockFeature: any = {
    scenarioOutlines: [
      {
        lineNumber: 10,
        steps: [
          { lineNumber: 11, text: 'Given a step in outline' },
        ],
      },
    ],
  };

  it('should generate code', () => {
    const res = generateCodeFromFeature(mockFeature, 10);
    expect(res).toBeDefined();
  });
});
`, "utf8");

        const rawOutput = `
FAIL tests/generate-code-by-line-number.test.ts
  ● generate-code-by-line-number › should generate code

    TypeError: Cannot read properties of undefined (reading 'match')

      78 |   let stepMatcher: string = '';
      79 |
    > 80 |   if (step.stepText.match(stepTextArgumentRegex)) {
         |                     ^

      at getStepMatcher (src/code-generation/step-generation.ts:80:21)
      at generateStepCode (src/code-generation/step-generation.ts:96:23)
      at Object.<anonymous> (tests/generate-code-by-line-number.test.ts:16:17)
`;

        const testResults = {
            testResults: [
                {
                    name: testFile,
                    status: "failed",
                    assertionResults: [
                        {
                            title: "should generate code",
                            status: "failed",
                            failureMessages: [
                                "TypeError: Cannot read properties of undefined (reading 'match')\n    at getStepMatcher (src/code-generation/step-generation.ts:80:21)"
                            ]
                        }
                    ]
                }
            ]
        };

        const healed = autoHealTestFailures(tempDir, [testFile], testResults, rawOutput);
        expect(healed).toBe(true);

        const healedContent = fs.readFileSync(testFile, "utf8");
        expect(healedContent).toContain("stepText: 'Given a step in outline'");
        expect(healedContent).toContain("title: 'Scenario 10'");
    });
});
