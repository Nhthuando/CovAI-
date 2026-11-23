// System Test evidence features are part of the default product flow: the
// dashboard's "Run automatically", live runner and measured coverage all depend
// on them. They stay on unless an operator explicitly opts out with "false".
// Mutation testing edits source in a trusted local runtime, so it stays opt-in.
const optOut = name => String(process.env[name] ?? '').trim().toLowerCase() !== 'false';
const optIn = name => String(process.env[name] ?? '').trim().toLowerCase() === 'true';

export const systemAssessmentEnabled = () => optOut('SYSTEM_ASSESSMENT_ENABLED');
export const systemMeasuredCoverageEnabled = () => optOut('SYSTEM_MEASURED_COVERAGE_ENABLED');
export const systemAiImprovementEnabled = () => optOut('SYSTEM_AI_IMPROVEMENT_ENABLED');
export const systemMutationEnabled = () => optIn('SYSTEM_MUTATION_ENABLED') && optIn('SYSTEM_MUTATION_TRUSTED_LOCAL');
