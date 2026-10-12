import {describe,it,expect,jest} from '@jest/globals';
const generateContent=jest.fn().mockResolvedValue({response:{text:()=>'{"content":"test"}',candidates:[]}});
const getGenerativeModel=jest.fn(()=>({generateContent}));
const runGeminiRequest=jest.fn(async(request)=>request({signal:new AbortController().signal}));
await jest.unstable_mockModule('@google/generative-ai',()=>({GoogleGenerativeAI:class {getGenerativeModel(...args){return getGenerativeModel(...args);}}}));
await jest.unstable_mockModule('../services/geminiRequestPolicy.service.js',()=>({runGeminiRequest,isDailyQuotaError:()=>false}));
const previousKey=process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY='unit-test-key';
const {generateText}=await import('../services/gemini.service.js');
if(previousKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previousKey;
describe('Gemini generation configuration forwarding',()=>{
  it('retains JSON schema and request options when no model name is supplied',async()=>{
    const responseSchema={type:'OBJECT',properties:{content:{type:'STRING'}}};const onRetry=jest.fn();
    await generateText('prompt',null,{responseMimeType:'application/json',responseSchema,maxOutputTokens:16000,maxAttempts:3,requestTimeoutMs:60000,onRetry});
    expect(generateContent.mock.calls.at(-1)[0].generationConfig).toEqual({responseMimeType:'application/json',responseSchema,maxOutputTokens:16000});
    expect(runGeminiRequest.mock.calls.at(-1)[1]).toMatchObject({maxAttempts:3,requestTimeoutMs:60000,onRetry});
    expect(generateContent.mock.calls.at(-1)[1].signal).toBeInstanceOf(AbortSignal);
  });
  it('retains config with an explicitly selected model',async()=>{
    await generateText('prompt','gemini-3.8-flash',null,{maxOutputTokens:2000});
    expect(getGenerativeModel.mock.calls.at(-1)[0].model).toBe('gemini-3.8-flash');
    expect(generateContent.mock.calls.at(-1)[0].generationConfig.maxOutputTokens).toBe(2000);
  });
  it.each([503,429])('does not switch model for a temporary %s response',async status=>{
    const calls=getGenerativeModel.mock.calls.length;
    generateContent.mockRejectedValueOnce(Object.assign(new Error('temporary provider error'),{status}));
    await expect(generateText('prompt','gemini-3.8-flash',null,{})).rejects.toThrow('temporary provider error');
    expect(getGenerativeModel.mock.calls.length-calls).toBe(1);
    await generateText('prompt','gemini-3.8-flash',null,{});
    expect(getGenerativeModel.mock.calls.at(-1)[0].model).toBe('gemini-3.8-flash');
  });
});
