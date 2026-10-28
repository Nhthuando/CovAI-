/**
 * Snapshot Reuse Constants
 */
export const REQUIRED_ARTIFACTS = [
  'CoverageSummary',
  'CoverageFile',
  'CoverageFunction',
  'Cfg',
  'Cyclomatic',
  'AiSuggestion',
  'AiTest'
];

export const JOB_TYPES = {
  PARSE_COVERAGE: 'PARSE_COVERAGE',
  BUILD_CFG: 'BUILD_CFG',
  AI_SUGGEST: 'AI_SUGGEST',
  AI_TESTS: 'AI_TESTS'
};
