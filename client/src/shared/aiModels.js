export const AI_MODELS = [
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', provider: 'Google', badge: 'Default', badgeColor: '#a78bfa', desc: 'Gemini 3.5 Flash Lite' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', provider: 'Google', badge: 'Lite', badgeColor: '#4ade80', desc: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google', badge: 'Flash', badgeColor: '#38bdf8', desc: 'Gemini 2.5 Flash' },
];

export const MODEL_ALIASES = {
  'gemini-3.5-flash': 'gemini-3.5-flash-lite',
  'gemini-3.1-flash': 'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.0-flash': 'gemini-2.5-flash',
  'gemini-2-flash': 'gemini-2.5-flash',
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-1.5-flash': 'gemini-2.5-flash',
  'gemini-1.5-flash-8b': 'gemini-3.5-flash-lite',
  'gemini-1.5-pro': 'gemini-2.5-flash',
};

export const normalizeModelId = (model) => {
  if (!model || typeof model !== 'string') return model;
  const trimmed = model.trim();
  return MODEL_ALIASES[trimmed] || trimmed;
};

export const GEMINI_MODEL_IDS = [
  ...AI_MODELS.map(model => model.id),
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2-flash',
  'gemini-2.0-flash-lite',
  'gemini-2-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
];
