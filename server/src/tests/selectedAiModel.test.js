import {it,expect} from '@jest/globals';
import {requestedAiModel} from '../utils/selectedAiModel.js';
it('takes the current chat model header before a stale request body',()=>{
    expect(requestedAiModel({headers:{'x-covai-ai-model':'gemini-3.5-flash-lite'},body:{model:'gemini-3.8-flash'}})).toBe('gemini-3.5-flash-lite');
});
it('normalizes model aliases like gemini-3.5-flash to gemini-3.5-flash-lite',()=>{
    expect(requestedAiModel({headers:{'x-covai-ai-model':'gemini-3.5-flash'}})).toBe('gemini-3.5-flash-lite');
    expect(requestedAiModel({body:{model:'gemini-3.1-flash'}})).toBe('gemini-3.1-flash-lite');
});
it('rejects an unsupported model before generating tests',()=>{
    expect(()=>requestedAiModel({headers:{'x-covai-ai-model':'gpt-4o'}})).toThrow('supported Gemini');
});
