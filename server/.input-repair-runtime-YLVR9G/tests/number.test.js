import { describe, test, expect } from 'vitest';
import { readNumber } from '../src/number.js';
describe('readNumber', () => {
  test('rejects non-number results', () => {
    const res = readNumber('1 > 0');
    expect(res).toEqual({ result: '', error: 'non-number result' });
  });
  test('reads numbers', () => { expect(readNumber('12')).toEqual({ result: '12' }); });
});