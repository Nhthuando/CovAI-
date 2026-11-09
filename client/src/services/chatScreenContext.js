export { chatErrorMessage } from '../../../shared/chatMessages.js';
const TEST_TYPES = new Set(['unit', 'integration', 'system']);
const LABELS = {
  explorer: 'your project code', overview: 'your project quality overview',
  architecture: 'your project architecture', jobs: 'your run history', activity: 'your run history',
  settings: 'project settings', 'version-control': 'version control', git: 'version control',
  trustworthiness: 'AI trustworthiness evaluation', 'logic-analysis': 'logic analysis',
  'projects-portfolio': 'your projects',
};
export function normalizeChatScreenContext(context) {
  if (!context?.activity) return undefined;
  const result = { contextVersion: 1, activity: context.activity };
  if (context.activity === 'coverage' && TEST_TYPES.has(context.testType)) result.testType = context.testType;
  if (context.filePath) result.filePath = context.filePath;
  if (Number.isInteger(context.workspaceRevision)) result.workspaceRevision = context.workspaceRevision;
  for (const key of ['testRunId', 'scenarioId', 'jobId']) if (context[key]) result[key] = context[key];
  return result;
}
export function chatScreenLabel(context) {
  if (context?.activity === 'explorer' && context.filePath) return `the file ${context.filePath}`;
  if (context?.activity === 'coverage') return ({ unit: 'Unit Test', integration: 'Integration Test', system: 'System Test' })[context.testType] || 'testing';
  return LABELS[context?.activity] || 'your project';
}
export const chatGreeting = context => `How can I help with ${chatScreenLabel(context)}?`;

