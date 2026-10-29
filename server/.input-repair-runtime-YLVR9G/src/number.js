export function readNumber(input) {
  if (!/^[0-9nulfase\s]+$/.test(input)) return { result: '', error: 'invalid characters' };
  const value = JSON.parse(input);
  if (typeof value !== 'number') return { result: '', error: 'non-number result' };
  return { result: String(value) };
}