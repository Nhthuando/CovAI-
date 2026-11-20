export const questionGroups = {
  HAPPY_PATH: 'Common questions',
  MULTI_TURN: 'Follow-up conversations',
  OUT_OF_SCOPE: 'Off-topic questions',
  ADVERSARIAL: 'Tricky or unsafe requests',
};

export const questionTypes = {
  KNOWLEDGE_QA: 'Knowledge Q&A',
  USAGE_GUIDANCE: 'Usage guidance',
  ACTION_TOOL: 'Action tool',
  ...questionGroups,
};
