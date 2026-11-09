import {it, expect} from '@jest/globals';
import {requireFullStackMode} from '../services/systemExecutionPolicy.service.js';
import {systemSuiteError, assertSystemSuiteStorage} from '../services/systemSuiteAvailability.service.js';

it('defaults new operations to Full Stack and rejects explicitly requested Frontend mode',()=>{
    expect(requireFullStackMode()).toBe('full');
    expect(requireFullStackMode('full')).toBe('full');
    expect(()=>requireFullStackMode('frontend')).toThrow('Full Stack only');
});
it('returns an actionable schema error without exposing raw database errors',()=>{
    expect(systemSuiteError({code:'P2021',message:'raw SQL details'})).toMatchObject({statusCode:503,code:'SYSTEM_VERSION_SCHEMA_REQUIRED'});
    expect(()=>assertSystemSuiteStorage({})).toThrow('database migration');
    const failure=new Error('unexpected');expect(systemSuiteError(failure)).toBe(failure);
});
