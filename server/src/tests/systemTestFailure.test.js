import { describe, it, expect } from '@jest/globals';
import { formatSystemTestFailure } from '../utils/systemTestFailure.js';

describe('system test failure display', () => {
  it('extracts the failing scenario instead of displaying reporter configuration', () => {
    const stdout = JSON.stringify({config:{argv:['playwright']}, suites:[{specs:[{title:'add todo',tests:[{status:'unexpected',results:[{errors:[{message:'strict mode violation: 4 buttons'}]}]}]}]}]});
    expect(formatSystemTestFailure({stdout,exitCode:1})).toBe('add todo: strict mode violation: 4 buttons');
  });
  it('preserves non-JSON infrastructure errors', () => {
    expect(formatSystemTestFailure({stderr:'Browser not installed',exitCode:1})).toBe('Browser not installed');
  });
});
