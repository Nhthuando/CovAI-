/**
 * Service to build specialized full test generation prompts for Gemini.
 * Orchestrates segments to produce high-quality, runnable Jest test files.
 */
import {
  includeSourceCode,
  includeCoverageMetrics,
  includeCfgInformation,
  includeComplexityScores,
} from "./aiPromptBuilder.service.js";

/**
 * Builds the full test prompt for the AI.
 *
 * @param {Object} input
 * @param {string} input.sourceCode
 * @param {any} input.coverageData
 * @param {any} input.cfgData
 * @param {any} input.cyclomaticData
 * @param {string[]} [input.existingTests]
 * @returns {string} The formatted prompt string
 */
export const buildFullTestPrompt = ({
  sourceCode,
  coverageData,
  cfgData,
  cyclomaticData,
  existingTests = [],
}) => {
  let prompt =
    "You are a senior Software Engineer and testing expert. Your task is to generate robust, runnable Jest test files.\n\n";

  // 1. Context Injection
  prompt += "### Context\n";
  prompt += includeSourceCode(sourceCode);
  prompt += includeCoverageMetrics(coverageData);
  prompt += includeCfgInformation(cfgData);
  prompt += includeComplexityScores(cyclomaticData);

  if (existingTests && existingTests.length > 0) {
    prompt += "### Existing Tests\n";
    prompt += "The following tests currently exist for this module:\n";
    existingTests.forEach((test) => (prompt += `- ${test}\n`));
    prompt += "\n";
  }

  // 2. Clear Instructions
  prompt += "### Task Instructions\n";
  prompt +=
    "- Generate a single, complete, runnable Jest test file for the provided source code.\n";
  prompt +=
    "- Focus on covering uncovered branches and lines indicated by the coverage metrics.\n";
  prompt +=
    "- Include comprehensive tests for edge cases and boundary conditions identified in the CFG data.\n";
  prompt +=
    "- Use mocks for all external dependencies and side effects (API calls, filesystem, etc.).\n";
  prompt +=
    "- Follow Jest best practices (e.g., use `describe`, `it`, `expect`, `beforeEach` correctly).\n";
  prompt += "- Output ONLY valid JavaScript code for the test file.\n";
  prompt +=
    "- Do NOT provide explanations, analysis, or conversational text outside the code block.\n";
  prompt +=
    "- Wrap your code in a markdown code block (e.g., ```javascript ... ```).\n";

  return prompt;
};
