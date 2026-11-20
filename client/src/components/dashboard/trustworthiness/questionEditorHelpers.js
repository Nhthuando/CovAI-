export const normalizeModel = model => String(model || '').trim().toLowerCase().replace(/^models\//, '');
export const freshCase = () => ({
  caseKey: `case-${crypto.randomUUID().slice(0, 8)}`,
  title: 'New question',
  taskType: 'KNOWLEDGE_QA',
  turns: [{ content: '' }],
  context: '',
  expectedBehavior: '',
  risk: 'LOW',
  weight: 1,
  repetitions: 1,
  initialState: {},
  confirmationScript: [],
  criteria: [{
    key: 'correctness',
    method: 'rule',
    enabled: true,
    required: true,
    blocking: false,
    weight: 1,
    rule: { type: 'containsAll', expected: [] },
    sourceIds: [],
  }],
});

export function modelOptions(models) {
  const items = Array.isArray(models) ? models : Object.entries(models || {}).map(([id, item]) =>
    typeof item === 'string' ? { id, name: item } : { id, ...item });
  return items.map(item => {
    if (typeof item === 'string') return { id: item, label: item };
    return {
      id: item.id || item.value || item.model,
      label: item.label || item.name || item.id || item.model,
    };
  }).filter(item => item.id);
}

