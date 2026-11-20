/**
 * Normalizes multi-turn chat history for Google Gemini:
 * 1. Converts 'assistant' role to 'model'.
 * 2. Filters out turns with empty text or invalid roles.
 * 3. Merges consecutive turns of the same role.
 * 4. Prunes leading 'model' turns (e.g. initial greeting) so history starts with 'user'.
 * 5. Ensures history ends with 'model' so the new user prompt alternates cleanly.
 */
export function normalizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    return [];
  }

  const normalized = [];

  for (const turn of rawHistory) {
    if (!turn || typeof turn !== 'object') continue;

    let role = turn.role;
    if (role === 'assistant') {
      role = 'model';
    }

    if (role !== 'user' && role !== 'model') {
      continue;
    }

    const text = typeof turn.text === 'string'
      ? turn.text.trim()
      : typeof turn.content === 'string'
        ? turn.content.trim()
        : '';

    if (!text) continue;

    // Merge consecutive turns from the same role
    if (normalized.length > 0 && normalized[normalized.length - 1].role === role) {
      normalized[normalized.length - 1].text += `\n${text}`;
    } else {
      normalized.push({ role, text });
    }
  }

  // Ensure conversation starts with 'user'
  while (normalized.length > 0 && normalized[0].role !== 'user') {
    normalized.shift();
  }

  // Ensure conversation ends with 'model' so the upcoming message is a valid 'user' turn
  while (normalized.length > 0 && normalized[normalized.length - 1].role !== 'model') {
    normalized.pop();
  }

  return normalized;
}
