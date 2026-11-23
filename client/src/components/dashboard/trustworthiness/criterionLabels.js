export const CRITERION_LABELS = {
  faithfulness: 'Sticks to your documents',
  completeness: 'Answers fully',
  contextRetention: 'Remembers the conversation',
  appropriateRefusal: 'Refuses when it should',
  keyFacts: 'Key facts (checked by rules)',
};
export const GROUP_LABELS = {
  HAPPY_PATH: 'Common questions',
  MULTI_TURN: 'Follow-up conversations',
  OUT_OF_SCOPE: 'Off-topic questions',
  ADVERSARIAL: 'Tricky or unsafe requests',
};
export const RESULT_LABELS = {
  PASSED: 'Passed',
  FAILED: 'Failed',
  ERROR: 'Not graded',
  INSUFFICIENT_EVIDENCE: 'Not enough answers',
  NOT_APPLICABLE: 'Not checked',
  NOT_EVALUATED: 'Not checked',
};
export function criterionLabel(key) { return CRITERION_LABELS[key] || key; }
export function groupLabel(key) { return GROUP_LABELS[key] || key; }
export function resultLabel(key) { return RESULT_LABELS[key] || key; }
