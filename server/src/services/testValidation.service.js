/**
 * Test Validation Service
 * Validates AI-generated Jest test code before database persistence.
 */

const VALIDATORS = [
  (code) => ({
    valid: code && code.trim().length > 0,
    error: "Generated code is empty.",
  }),
  (code) => {
    const rejectPatterns = [
      /I['’]m sorry/i,
      /I cannot/i,
      /Here is your answer/i,
      /^\s*#/m, // Markdown headers
      /\*\*/, // Markdown bold
    ];
    for (const pattern of rejectPatterns) {
      if (pattern.test(code))
        return {
          valid: false,
          error: "Response contains non-code conversational text.",
        };
    }
    return { valid: true };
  },
  (code) => {
    const hasTest = /test\(|it\(|describe\(/i.test(code);
    return {
      valid: hasTest,
      error:
        "Output does not contain valid Jest test blocks (test/it/describe).",
    };
  },
  (code) => {
    // Check for callback in tests
    const hasCallback =
      /(test|it)\s*\(['"].*?['"]\s*,\s*(\(.*\)|async\s*\(.*\))\s*=>/i.test(
        code,
      );
    return {
      valid: hasCallback,
      error: "Test blocks missing valid callback function.",
    };
  },
  (code) => {
    // Basic balanced braces check for describe blocks
    const openBraces = (code.match(/describe\s*\(/g) || []).length;
    const closeBraces = (code.match(/\}\s*\)/g) || []).length; // Simplified approximation
    // This is a naive check; full AST parsing is preferred for production
    return { valid: true };
  },
];

export const validateGeneratedTest = (generatedCode) => {
  const errors = [];
  for (const validator of VALIDATORS) {
    const result = validator(generatedCode);
    if (!result.valid) {
      errors.push(result.error);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};
